package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/mbx92/billEngine/agent/internal/config"
	"github.com/mbx92/billEngine/agent/internal/controlplane"
	"github.com/mbx92/billEngine/agent/internal/docker"
	"github.com/mbx92/billEngine/agent/internal/executor"
	"github.com/mbx92/billEngine/agent/internal/platform"
	"github.com/mbx92/billEngine/agent/internal/selfupdate"
	"github.com/mbx92/billEngine/agent/internal/version"
)

var Version = version.Value

type Agent struct {
	config config.Config
	logger *slog.Logger
}

func New(cfg config.Config, logger *slog.Logger) *Agent {
	return &Agent{config: cfg, logger: logger}
}

func (a *Agent) Run(ctx context.Context) error {
	host, err := platform.Inspect(ctx)
	if err != nil {
		return fmt.Errorf("preflight: %w", err)
	}
	capabilities := platform.DetectCapabilities(ctx)

	client := controlplane.New(a.config.ControlPlaneURL, &http.Client{Timeout: a.config.RequestTimeout})
	identity, err := loadIdentity(a.config.StateFile)
	if errors.Is(err, os.ErrNotExist) {
		if a.config.EnrollmentToken == "" {
			return errors.New("OC_ENROLLMENT_TOKEN is required for first enrollment")
		}
		identity, err = client.Enroll(ctx, controlplane.EnrollmentRequest{
			Token:           a.config.EnrollmentToken,
			AgentVersion:    Version,
			ProtocolVersion: controlplane.ProtocolVersion,
			OSRelease:       host.OSRelease,
			Architecture:    host.Architecture,
			DockerVersion:   host.DockerVersion,
			ComposeVersion:  host.ComposeVersion,
			Capabilities:    capabilities,
		})
		if err != nil {
			return fmt.Errorf("enroll: %w", err)
		}
		if err := saveIdentity(a.config.StateFile, identity); err != nil {
			return fmt.Errorf("persist identity: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("load identity: %w", err)
	}
	if identity.Role == "" {
		identity.Role = "deployment"
	}

	a.logger.Info("agent started", "node_id", identity.NodeID, "node_name", identity.NodeName, "version", Version)
	usageSampler := &platform.UsageSampler{}
	reportUpdateResult := func() error {
		result, resultErr := selfupdate.ReadResult(a.config.UpdateDirectory)
		if errors.Is(resultErr, os.ErrNotExist) {
			return nil
		}
		if resultErr != nil {
			return fmt.Errorf("read update result: %w", resultErr)
		}
		request := controlplane.OperationStatusRequest{
			Status:       result.Status,
			ErrorCode:    result.ErrorCode,
			ErrorMessage: result.ErrorMessage,
			Result: map[string]any{
				"previousVersion": result.PreviousVersion,
				"currentVersion":  result.CurrentVersion,
			},
		}
		if err := client.UpdateOperation(ctx, identity.Credential, result.OperationID, request); err != nil {
			return fmt.Errorf("report update result: %w", err)
		}
		if err := selfupdate.RemoveResult(a.config.UpdateDirectory); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove update result: %w", err)
		}
		return nil
	}
	heartbeat := func() error {
		var gateway *docker.Gateway
		if identity.Role != "builder" {
			observed := docker.InspectGateway(ctx)
			gateway = &observed
		}
		usage, usageErr := usageSampler.Sample(ctx)
		if usageErr != nil {
			a.logger.Warn("host usage could not be sampled", "error", usageErr)
		}
		var usagePayload *platform.Usage
		if usageErr == nil {
			usagePayload = &usage
		}
		err := client.Heartbeat(ctx, identity.Credential, controlplane.HeartbeatRequest{
			AgentVersion:    Version,
			ProtocolVersion: controlplane.ProtocolVersion,
			OSRelease:       host.OSRelease,
			Architecture:    host.Architecture,
			DockerVersion:   host.DockerVersion,
			ComposeVersion:  host.ComposeVersion,
			Capabilities:    capabilities,
			Capacity:        host.Capacity,
			Usage:           usagePayload,
			Gateway:         gateway,
			Update: &controlplane.AgentUpdate{
				PreviousVersion: selfupdate.PreviousVersion(ctx, a.config.BinaryPath),
			},
		})
		if err != nil {
			return err
		}
		if err := selfupdate.MarkHealthy(a.config.UpdateDirectory, Version); err != nil {
			return fmt.Errorf("mark agent healthy: %w", err)
		}
		return nil
	}
	reportInventory := func() error {
		if identity.Role == "builder" {
			return nil
		}
		resources, inventoryErr := docker.Inventory(ctx)
		if inventoryErr != nil {
			return inventoryErr
		}
		return client.Inventory(ctx, identity.Credential, controlplane.InventoryRequest{
			ObservedAt: time.Now().UTC(),
			Resources:  resources,
		})
	}
	processOperation := func() error {
		operation, operationErr := client.NextOperation(ctx, identity.Credential)
		if operationErr != nil || operation == nil {
			return operationErr
		}
		if err := client.UpdateOperation(ctx, identity.Credential, operation.ID, controlplane.OperationStatusRequest{
			Status: "running",
		}); err != nil {
			return err
		}
		if operation.Action == "agent.upgrade" || operation.Action == "agent.rollback" {
			prepared, updateFailure := selfupdate.Prepare(
				ctx,
				client,
				identity.Credential,
				*operation,
				a.config.UpdateDirectory,
				a.config.BinaryPath,
				Version,
			)
			if updateFailure != nil {
				return client.UpdateOperation(ctx, identity.Credential, operation.ID, controlplane.OperationStatusRequest{
					Status: "failed", Retryable: updateFailure.Retryable,
					ErrorCode: updateFailure.Code, ErrorMessage: updateFailure.Message,
				})
			}
			if err := prepared.Trigger(); err != nil {
				return client.UpdateOperation(ctx, identity.Credential, operation.ID, controlplane.OperationStatusRequest{
					Status: "failed", Retryable: true,
					ErrorCode: "update_trigger_failed", ErrorMessage: "agent updater could not be triggered",
				})
			}
			a.logger.Info("agent update staged", "operation_id", operation.ID, "target_version", prepared.TargetVersion)
			return nil
		}
		resolvedSecrets, secretErr := client.OperationSecrets(ctx, identity.Credential, operation.ID)
		if secretErr != nil {
			return client.UpdateOperation(ctx, identity.Credential, operation.ID, controlplane.OperationStatusRequest{
				Status: "failed", Retryable: true,
				ErrorCode: "secret_delivery_failed", ErrorMessage: "operation secrets could not be retrieved",
			})
		}
		result, executionErr := executor.ExecuteWithOperationSecrets(
			ctx,
			*operation,
			resolvedSecrets.Secrets,
			resolvedSecrets.Registry,
			a.config.SecretDirectory,
		)
		revision := operation.ExpectedResourceRevision
		if executionErr != nil {
			return client.UpdateOperation(ctx, identity.Credential, operation.ID, controlplane.OperationStatusRequest{
				Status: "failed", Retryable: executionErr.Retryable,
				ErrorCode: executionErr.Code, ErrorMessage: executionErr.Message,
			})
		}
		return client.UpdateOperation(ctx, identity.Credential, operation.ID, controlplane.OperationStatusRequest{
			Status: "succeeded", Result: result, ObservedRevision: revision,
		})
	}

	if err := heartbeat(); err != nil {
		a.logger.Warn("initial heartbeat failed", "error", err)
	} else if err := reportUpdateResult(); err != nil {
		a.logger.Warn("agent update result could not be reported", "error", err)
	}
	if err := reportInventory(); err != nil {
		a.logger.Warn("initial inventory failed", "error", err)
	}
	ticker := time.NewTicker(a.config.HeartbeatEvery)
	defer ticker.Stop()
	operationTicker := time.NewTicker(a.config.OperationEvery)
	defer operationTicker.Stop()
	operationResult := make(chan error, 1)
	operationInFlight := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := heartbeat(); err != nil {
				a.logger.Warn("heartbeat failed", "error", err)
				continue
			}
			if err := reportInventory(); err != nil {
				a.logger.Warn("inventory failed", "error", err)
			} else {
				a.logger.Debug("heartbeat and inventory accepted", "node_id", identity.NodeID)
			}
		case <-operationTicker.C:
			if err := reportUpdateResult(); err != nil {
				a.logger.Warn("agent update result could not be reported", "error", err)
			}
			if operationInFlight {
				continue
			}
			operationInFlight = true
			go func() {
				operationResult <- processOperation()
			}()
		case err := <-operationResult:
			operationInFlight = false
			if err != nil {
				a.logger.Warn("operation polling failed", "error", err)
			}
		}
	}
}

func loadIdentity(path string) (controlplane.Identity, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return controlplane.Identity{}, err
	}
	var identity controlplane.Identity
	if err := json.Unmarshal(contents, &identity); err != nil {
		return controlplane.Identity{}, err
	}
	if identity.NodeID == "" || identity.Credential == "" {
		return controlplane.Identity{}, errors.New("identity file is incomplete")
	}
	return identity, nil
}

func saveIdentity(path string, identity controlplane.Identity) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	contents, err := json.Marshal(identity)
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, contents, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return os.Chmod(path, 0o600)
}
