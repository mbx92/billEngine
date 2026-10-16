package selfupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

const maxAgentBinaryBytes int64 = 128 << 20

var (
	semanticVersionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`)
	checksumPattern        = regexp.MustCompile(`^[a-f0-9]{64}$`)
	operationIDPattern     = regexp.MustCompile(`^[a-f0-9-]{36}$`)
)

type Failure struct {
	Code      string
	Message   string
	Retryable bool
}

type PreparedUpdate struct {
	TargetVersion string
	trigger       func() error
}

type Result struct {
	OperationID     string `json:"operationId"`
	Status          string `json:"status"`
	PreviousVersion string `json:"previousVersion,omitempty"`
	CurrentVersion  string `json:"currentVersion,omitempty"`
	ErrorCode       string `json:"errorCode,omitempty"`
	ErrorMessage    string `json:"errorMessage,omitempty"`
}

type operationPayload struct {
	Version      string `json:"version"`
	FromVersion  string `json:"fromVersion"`
	Architecture string `json:"architecture"`
	Checksum     string `json:"checksum"`
	Size         int64  `json:"size"`
}

func Prepare(
	ctx context.Context,
	client *controlplane.Client,
	credential string,
	operation controlplane.Operation,
	updateDirectory string,
	binaryPath string,
	currentVersion string,
) (*PreparedUpdate, *Failure) {
	if operation.Action != "agent.upgrade" && operation.Action != "agent.rollback" {
		return nil, failure("unsupported_action", "agent update action is not supported", false)
	}
	if !operationIDPattern.MatchString(operation.ID) {
		return nil, failure("invalid_operation", "operation ID is invalid", false)
	}

	var payload operationPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, failure("invalid_payload", "agent update payload is invalid", false)
	}
	if !semanticVersionPattern.MatchString(payload.Version) || payload.Version == currentVersion {
		return nil, failure("invalid_version", "target agent version is invalid", false)
	}
	if payload.FromVersion != currentVersion {
		return nil, failure("version_conflict", "agent version changed before the operation ran", false)
	}
	if payload.Architecture != runtime.GOARCH || (runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64") {
		return nil, failure("architecture_mismatch", "agent artifact architecture does not match this host", false)
	}
	if err := os.MkdirAll(updateDirectory, 0o700); err != nil {
		return nil, failure("update_directory_failed", "agent update directory is unavailable", true)
	}

	if operation.Action == "agent.rollback" {
		previousVersion, err := binaryVersion(ctx, binaryPath+".previous")
		if err != nil {
			return nil, failure("rollback_unavailable", "previous agent binary is not available", false)
		}
		if previousVersion != payload.Version {
			return nil, failure("rollback_version_mismatch", "previous agent version does not match the requested rollback", false)
		}
		return prepared(updateDirectory, operation.ID, "rollback", payload.Version), nil
	}

	if !checksumPattern.MatchString(payload.Checksum) {
		return nil, failure("invalid_checksum", "agent artifact checksum is invalid", false)
	}
	if payload.Size <= 0 || payload.Size > maxAgentBinaryBytes {
		return nil, failure("invalid_artifact_size", "agent artifact size is invalid", false)
	}

	temporary, err := os.CreateTemp(updateDirectory, "oc-agent.next-*")
	if err != nil {
		return nil, failure("stage_failed", "agent artifact could not be staged", true)
	}
	temporaryPath := temporary.Name()
	keepTemporary := false
	defer func() {
		_ = temporary.Close()
		if !keepTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()

	hash := sha256.New()
	written, err := client.DownloadAgentBinary(
		ctx,
		credential,
		payload.Architecture,
		io.MultiWriter(temporary, hash),
		maxAgentBinaryBytes,
	)
	if err != nil {
		return nil, failure("artifact_download_failed", "agent artifact download failed", true)
	}
	if written != payload.Size {
		return nil, failure("artifact_size_mismatch", "downloaded agent artifact size does not match", true)
	}
	if hex.EncodeToString(hash.Sum(nil)) != payload.Checksum {
		return nil, failure("artifact_checksum_mismatch", "downloaded agent artifact checksum does not match", false)
	}
	if err := temporary.Sync(); err != nil {
		return nil, failure("stage_failed", "staged agent artifact could not be synchronized", true)
	}
	if err := temporary.Close(); err != nil {
		return nil, failure("stage_failed", "staged agent artifact could not be closed", true)
	}
	if err := os.Chmod(temporaryPath, 0o750); err != nil {
		return nil, failure("stage_failed", "staged agent artifact permissions could not be set", true)
	}

	version, err := binaryVersion(ctx, temporaryPath)
	if err != nil || version != payload.Version {
		return nil, failure("artifact_version_mismatch", "downloaded binary does not report the requested version", false)
	}
	nextPath := filepath.Join(updateDirectory, "oc-agent.next")
	if err := os.Rename(temporaryPath, nextPath); err != nil {
		return nil, failure("stage_failed", "staged agent artifact could not be activated", true)
	}
	keepTemporary = true
	return prepared(updateDirectory, operation.ID, "upgrade", payload.Version), nil
}

func (preparedUpdate *PreparedUpdate) Trigger() error {
	return preparedUpdate.trigger()
}

func PreviousVersion(ctx context.Context, binaryPath string) string {
	version, err := binaryVersion(ctx, binaryPath+".previous")
	if err != nil || !semanticVersionPattern.MatchString(version) {
		return ""
	}
	return version
}

func MarkHealthy(updateDirectory string, version string) error {
	if err := os.MkdirAll(updateDirectory, 0o700); err != nil {
		return err
	}
	return writeAtomic(filepath.Join(updateDirectory, "healthy"), []byte(version+"\n"), 0o600)
}

func ReadResult(updateDirectory string) (*Result, error) {
	contents, err := os.ReadFile(filepath.Join(updateDirectory, "result.json"))
	if err != nil {
		return nil, err
	}
	var result Result
	if err := json.Unmarshal(contents, &result); err != nil {
		return nil, fmt.Errorf("decode update result: %w", err)
	}
	if !operationIDPattern.MatchString(result.OperationID) || (result.Status != "succeeded" && result.Status != "failed") {
		return nil, errors.New("update result is invalid")
	}
	return &result, nil
}

func RemoveResult(updateDirectory string) error {
	return os.Remove(filepath.Join(updateDirectory, "result.json"))
}

func prepared(updateDirectory string, operationID string, mode string, targetVersion string) *PreparedUpdate {
	return &PreparedUpdate{
		TargetVersion: targetVersion,
		trigger: func() error {
			request := fmt.Sprintf(
				"operation_id=%s\nmode=%s\ntarget_version=%s\n",
				operationID,
				mode,
				targetVersion,
			)
			return writeAtomic(filepath.Join(updateDirectory, "request"), []byte(request), 0o600)
		},
	}
}

func binaryVersion(parent context.Context, path string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "--version").CombinedOutput()
	if err != nil {
		return "", err
	}
	version := strings.TrimSpace(string(output))
	if !semanticVersionPattern.MatchString(version) {
		return "", errors.New("binary returned an invalid version")
	}
	return version, nil
}

func writeAtomic(path string, contents []byte, mode os.FileMode) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, contents, mode); err != nil {
		return err
	}
	if err := os.Chmod(temporary, mode); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func failure(code string, message string, retryable bool) *Failure {
	return &Failure{Code: code, Message: message, Retryable: retryable}
}
