package executor

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
	"github.com/mbx92/billEngine/agent/internal/objectstorage"
)

type CommandRunner func(ctx context.Context, name string, args ...string) ([]byte, error)
type InputCommandRunner func(
	ctx context.Context,
	input []byte,
	name string,
	args ...string,
) ([]byte, error)

type Error struct {
	Code      string
	Message   string
	Retryable bool
}

func (e *Error) Error() string { return e.Message }

type applicationPayload struct {
	ResourceID string          `json:"resourceId"`
	Name       string          `json:"name"`
	Kind       string          `json:"kind"`
	Revision   int             `json:"revision"`
	Spec       applicationSpec `json:"spec"`
}

type applicationSpec struct {
	Source struct {
		Type       string `json:"type"`
		Reference  string `json:"reference"`
		PullPolicy string `json:"pullPolicy"`
		NodeID     string `json:"nodeId"`
	} `json:"source"`
	Limits struct {
		CPUMilli    int    `json:"cpuMilli"`
		MemoryBytes string `json:"memoryBytes"`
	} `json:"limits"`
	Ports []struct {
		ContainerPort int    `json:"containerPort"`
		HostPort      int    `json:"hostPort"`
		Protocol      string `json:"protocol"`
	} `json:"ports"`
	Environment      map[string]string `json:"environment"`
	SecretReferences map[string]string `json:"secretReferences"`
	SecretDelivery   string            `json:"secretDelivery"`
	Volumes          []struct {
		Name        string `json:"name"`
		MountTarget string `json:"mountTarget"`
		Kind        string `json:"kind"`
	} `json:"volumes"`
	RestartPolicy string `json:"restartPolicy"`
	Healthcheck   *struct {
		Path            string `json:"path"`
		Port            int    `json:"port"`
		IntervalSeconds int    `json:"intervalSeconds"`
		TimeoutSeconds  int    `json:"timeoutSeconds"`
	} `json:"healthcheck"`
}

type lifecyclePayload struct {
	ResourceID string `json:"resourceId"`
	Revision   int    `json:"revision"`
}

type databaseClusterPayload struct {
	ClusterID           string `json:"clusterId"`
	ResourceID          string `json:"resourceId"`
	AdminDatabase       string `json:"adminDatabase"`
	ProvisionerUsername string `json:"provisionerUsername"`
}

type serviceDatabasePayload struct {
	AllocationID          string `json:"allocationId"`
	ClusterID             string `json:"clusterId"`
	ResourceID            string `json:"resourceId"`
	ApplicationResourceID string `json:"applicationResourceId"`
	AdminDatabase         string `json:"adminDatabase"`
	ProvisionerUsername   string `json:"provisionerUsername"`
	DatabaseName          string `json:"databaseName"`
	RoleName              string `json:"roleName"`
	ConnectionLimit       int    `json:"connectionLimit"`
	NetworkAlias          string `json:"networkAlias"`
}

type databaseBackupPayload struct {
	BackupID            string `json:"backupId"`
	AllocationID        string `json:"allocationId"`
	ClusterID           string `json:"clusterId"`
	ResourceID          string `json:"resourceId"`
	DatabaseName        string `json:"databaseName"`
	ProvisionerUsername string `json:"provisionerUsername"`
	StorageTargetID     string `json:"storageTargetId"`
	ObjectStorage       *struct {
		Provider  string `json:"provider"`
		Endpoint  string `json:"endpoint"`
		Region    string `json:"region"`
		Bucket    string `json:"bucket"`
		ObjectKey string `json:"objectKey"`
		PathStyle bool   `json:"pathStyle"`
	} `json:"objectStorage"`
}

type gatewayPayload struct {
	Image string `json:"image"`
}

type applicationBuildPayload struct {
	BuildID         string `json:"buildId"`
	RepositoryURL   string `json:"repositoryUrl"`
	Revision        string `json:"revision"`
	DockerfilePath  string `json:"dockerfilePath"`
	BuildContext    string `json:"buildContext"`
	ImageRepository string `json:"imageRepository"`
	ImageStorage    string `json:"imageStorage"`
	Version         string `json:"version"`
}

type imageDeletePayload struct {
	ImageID string `json:"imageId"`
}

type routePayload struct {
	RouteID            string `json:"routeId"`
	ResourceID         string `json:"resourceId"`
	Hostname           string `json:"hostname"`
	TargetPort         int    `json:"targetPort"`
	BillingGateEnabled bool   `json:"billingGateEnabled"`
	BillingGateURL     string `json:"billingGateUrl"`
}

const (
	gatewayConfigVersion      = "3"
	gatewayHealthcheckCommand = "traefik healthcheck --ping=true --ping.entrypoint=management --entrypoints.management.address=:8082"
)

var (
	uuidPattern               = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	slugPattern               = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,159}$`)
	environmentKeyPattern     = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)
	postgresIdentifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)
	gitRevisionPattern        = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$`)
	imageBuildVersionPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	imageDigestPattern        = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
)

const managedNetworkName = "oc-private"
const gatewayContainerName = "oc-gateway"

func Execute(ctx context.Context, operation controlplane.Operation) (map[string]any, *Error) {
	return ExecuteWithSecrets(ctx, operation, nil, "/var/lib/oc-agent/secrets")
}

func ExecuteWith(
	ctx context.Context,
	operation controlplane.Operation,
	run CommandRunner,
) (map[string]any, *Error) {
	return executeWith(ctx, operation, nil, "/var/lib/oc-agent/secrets", run)
}

func ExecuteWithInput(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	run CommandRunner,
	runInput InputCommandRunner,
) (map[string]any, *Error) {
	return executeWithInput(ctx, operation, secrets, nil, "/var/lib/oc-agent/secrets", run, runInput)
}

func ExecuteWithSecrets(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	secretDirectory string,
) (map[string]any, *Error) {
	return ExecuteWithOperationSecrets(ctx, operation, secrets, nil, secretDirectory)
}

func ExecuteWithOperationSecrets(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	registry *controlplane.RegistryCredential,
	secretDirectory string,
) (map[string]any, *Error) {
	return executeWithInput(
		ctx,
		operation,
		secrets,
		registry,
		secretDirectory,
		runCommand,
		runCommandWithInput,
	)
}

func executeWith(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	secretDirectory string,
	run CommandRunner,
) (map[string]any, *Error) {
	return executeWithInput(
		ctx,
		operation,
		secrets,
		nil,
		secretDirectory,
		run,
		func(ctx context.Context, input []byte, name string, args ...string) ([]byte, error) {
			if len(input) > 0 {
				return nil, errors.New("input command runner is not configured")
			}
			return run(ctx, name, args...)
		},
	)
}

func executeWithInput(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	registry *controlplane.RegistryCredential,
	secretDirectory string,
	run CommandRunner,
	runInput InputCommandRunner,
) (map[string]any, *Error) {
	switch operation.Action {
	case "gateway.ensure":
		return ensureGateway(ctx, operation, secretDirectory, run)
	case "route.configure":
		return configureRoute(ctx, operation, secrets, secretDirectory, run)
	case "route.delete":
		return deleteRoute(ctx, operation, secretDirectory, run)
	case "application.ensure", "application.redeploy":
		return ensureApplication(ctx, operation, secrets, registry, secretDirectory, run, runInput)
	case "application.build":
		return buildApplicationImage(ctx, operation, registry, secretDirectory, run, runInput)
	case "image.delete":
		return deleteImage(ctx, operation, run)
	case "application.start", "application.stop", "application.restart", "application.delete":
		return lifecycle(ctx, operation, secretDirectory, run)
	case "database.cluster.activate":
		return activateDatabaseCluster(ctx, operation, run)
	case "database.service.ensure":
		return ensureServiceDatabase(ctx, operation, secrets, run, runInput)
	case "database.backup.create":
		return createDatabaseBackup(ctx, operation, secrets, run)
	case "database.backup.restore":
		return restoreDatabaseBackup(ctx, operation, secrets, run)
	case "database.backup.delete":
		return deleteDatabaseBackup(ctx, operation, secrets)
	default:
		return nil, &Error{Code: "unsupported", Message: "agent action is not supported"}
	}
}

func deleteImage(
	ctx context.Context,
	operation controlplane.Operation,
	run CommandRunner,
) (map[string]any, *Error) {
	var payload imageDeletePayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, &Error{Code: "invalid_payload", Message: "image delete payload is invalid"}
	}
	if !imageDigestPattern.MatchString(payload.ImageID) {
		return nil, &Error{Code: "invalid_image_id", Message: "Docker image ID is invalid"}
	}

	inspectOutput, err := run(ctx, "docker", "image", "inspect", "--format", "{{json .}}", payload.ImageID)
	if err != nil {
		if strings.Contains(strings.ToLower(string(inspectOutput)), "no such image") {
			return map[string]any{
				"imageId":       payload.ImageID,
				"deleted":       false,
				"alreadyAbsent": true,
			}, nil
		}
		return nil, &Error{Code: "image_inspect_failed", Message: "Docker image could not be inspected", Retryable: true}
	}
	var inspected struct {
		ID          string   `json:"Id"`
		RepoTags    []string `json:"RepoTags"`
		RepoDigests []string `json:"RepoDigests"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(inspectOutput))), &inspected); err != nil {
		return nil, &Error{Code: "image_inspect_failed", Message: "Docker image metadata is invalid", Retryable: true}
	}
	if inspected.ID != payload.ImageID {
		return nil, &Error{Code: "image_id_mismatch", Message: "Docker returned a different image ID"}
	}

	containerOutput, err := run(ctx, "docker", "container", "ls", "--all", "--quiet")
	if err != nil {
		return nil, &Error{Code: "image_usage_check_failed", Message: "Docker containers could not be listed", Retryable: true}
	}
	containerIDs := nonEmptyLines(containerOutput)
	if len(containerIDs) > 0 {
		args := append([]string{"container", "inspect", "--format", "{{.Image}}"}, containerIDs...)
		usedImageOutput, inspectErr := run(ctx, "docker", args...)
		if inspectErr != nil {
			return nil, &Error{Code: "image_usage_check_failed", Message: "Docker container images could not be inspected", Retryable: true}
		}
		for _, imageID := range nonEmptyLines(usedImageOutput) {
			if imageID == payload.ImageID {
				return nil, &Error{Code: "image_in_use", Message: "Image is still used by a Docker container"}
			}
		}
	}

	removeTargets := make([]string, 0, len(inspected.RepoTags))
	for _, reference := range inspected.RepoTags {
		if reference != "" && reference != "<none>:<none>" {
			removeTargets = append(removeTargets, reference)
		}
	}
	if len(removeTargets) == 0 {
		for _, reference := range inspected.RepoDigests {
			if reference != "" && reference != "<none>@<none>" {
				removeTargets = append(removeTargets, reference)
			}
		}
	}
	if len(removeTargets) == 0 {
		removeTargets = append(removeTargets, payload.ImageID)
	}
	args := append([]string{"image", "rm"}, removeTargets...)
	removeOutput, err := run(ctx, "docker", args...)
	if err != nil {
		message := strings.ToLower(string(removeOutput))
		if strings.Contains(message, "used by") || strings.Contains(message, "being used") {
			return nil, &Error{Code: "image_in_use", Message: "Image became used before it could be deleted"}
		}
		return nil, &Error{Code: "image_delete_failed", Message: "Docker image could not be deleted", Retryable: true}
	}

	return map[string]any{"imageId": payload.ImageID, "deleted": true}, nil
}

func nonEmptyLines(output []byte) []string {
	lines := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if value := strings.TrimSpace(line); value != "" {
			lines = append(lines, value)
		}
	}
	return lines
}

const applicationBuildDirectory = "/var/lib/oc-agent/builds"

func buildApplicationImage(
	ctx context.Context,
	operation controlplane.Operation,
	registry *controlplane.RegistryCredential,
	secretDirectory string,
	run CommandRunner,
	runInput InputCommandRunner,
) (map[string]any, *Error) {
	var payload applicationBuildPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, invalidSpec("invalid application build payload")
	}
	if !uuidPattern.MatchString(payload.BuildID) ||
		!validGitRevision(payload.Revision) ||
		!imageBuildVersionPattern.MatchString(payload.Version) {
		return nil, invalidSpec("invalid application build identity")
	}
	repositoryURL, err := url.Parse(payload.RepositoryURL)
	if err != nil || repositoryURL.Scheme != "https" ||
		!strings.EqualFold(repositoryURL.Hostname(), "github.com") || repositoryURL.User != nil ||
		repositoryURL.RawQuery != "" || repositoryURL.Fragment != "" {
		return nil, invalidSpec("builder only accepts HTTPS github.com repositories")
	}
	local := payload.ImageStorage == "local"
	if payload.ImageStorage != "" && payload.ImageStorage != "local" && payload.ImageStorage != "registry" {
		return nil, invalidSpec("unsupported image storage mode")
	}
	if local && !regexp.MustCompile(`^oc-local/[a-z0-9][a-z0-9-]*$`).MatchString(payload.ImageRepository) {
		return nil, invalidSpec("invalid local image repository")
	}
	if !local && (registry == nil || registry.Host == "" || registry.Username == "" || registry.Token == "" ||
		!strings.HasPrefix(payload.ImageRepository, registry.Host+"/")) {
		return nil, invalidSpec("registry credential does not match the build image repository")
	}
	dockerfilePath, pathErr := safeBuildPath(payload.DockerfilePath)
	if pathErr != nil {
		return nil, invalidSpec("invalid Dockerfile path")
	}
	buildContext, pathErr := safeBuildPath(payload.BuildContext)
	if pathErr != nil {
		return nil, invalidSpec("invalid build context")
	}

	if err := os.MkdirAll(applicationBuildDirectory, 0o700); err != nil {
		return nil, commandError("build_workspace_failed", err, true)
	}
	workspace := filepath.Join(applicationBuildDirectory, payload.BuildID)
	if err := os.RemoveAll(workspace); err != nil {
		return nil, commandError("build_workspace_failed", err, true)
	}
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		return nil, commandError("build_workspace_failed", err, true)
	}
	defer os.RemoveAll(workspace)
	sourceDirectory := filepath.Join(workspace, "source")
	if _, err := run(
		ctx,
		"git",
		"clone",
		"--depth", "1",
		"--single-branch",
		"--branch", payload.Revision,
		"--", payload.RepositoryURL, sourceDirectory,
	); err != nil {
		return nil, commandError("repository_clone_failed", err, true)
	}
	commitOutput, err := run(ctx, "git", "-C", sourceDirectory, "rev-parse", "HEAD")
	if err != nil {
		return nil, commandError("repository_revision_failed", err, false)
	}
	commitSHA := strings.ToLower(strings.TrimSpace(string(commitOutput)))
	if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(commitSHA) {
		return nil, invalidSpec("repository returned an invalid commit SHA")
	}
	if local {
		return buildLocalApplicationImage(ctx, payload, sourceDirectory, dockerfilePath, buildContext, commitSHA, run)
	}

	if secretDirectory == "" || !filepath.IsAbs(secretDirectory) {
		return nil, invalidSpec("secret directory must be absolute")
	}
	if err := os.MkdirAll(secretDirectory, 0o700); err != nil {
		return nil, commandError("registry_auth_failed", err, true)
	}
	dockerConfigDirectory, err := os.MkdirTemp(secretDirectory, "builder-registry-")
	if err != nil {
		return nil, commandError("registry_auth_failed", err, true)
	}
	defer os.RemoveAll(dockerConfigDirectory)
	if err := os.Chmod(dockerConfigDirectory, 0o700); err != nil {
		return nil, commandError("registry_auth_failed", err, true)
	}
	if _, err := runInput(
		ctx,
		[]byte(registry.Token+"\n"),
		"docker",
		"--config", dockerConfigDirectory,
		"login", registry.Host,
		"--username", registry.Username,
		"--password-stdin",
	); err != nil {
		return nil, commandError("registry_auth_failed", err, true)
	}
	builderName := "oc-builder-" + strings.ReplaceAll(payload.BuildID, "-", "")
	if _, err := run(
		ctx,
		"docker",
		"--config", dockerConfigDirectory,
		"buildx", "create",
		"--name", builderName,
		"--driver", "docker-container",
		"--use",
	); err != nil {
		return nil, commandError("buildkit_start_failed", err, true)
	}
	defer func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, _ = run(
			cleanupContext,
			"docker",
			"--config", dockerConfigDirectory,
			"buildx", "rm", "--force", builderName,
		)
	}()

	metadataPath := filepath.Join(workspace, "metadata.json")
	imageTag := payload.ImageRepository + ":" + payload.Version
	buildOutput, err := run(
		ctx,
		"docker",
		"--config", dockerConfigDirectory,
		"buildx", "build",
		"--progress", "plain",
		"--file", filepath.Join(sourceDirectory, dockerfilePath),
		"--tag", imageTag,
		"--label", "org.opencontainers.image.revision="+commitSHA,
		"--label", "org.opencontainers.image.source="+payload.RepositoryURL,
		"--cache-from", "type=registry,ref="+payload.ImageRepository+":buildcache",
		"--cache-to", "type=registry,ref="+payload.ImageRepository+":buildcache,mode=max",
		"--metadata-file", metadataPath,
		"--push",
		filepath.Join(sourceDirectory, buildContext),
	)
	if err != nil {
		return nil, commandError("image_build_failed", err, false)
	}
	metadata, err := os.ReadFile(metadataPath)
	if err != nil {
		return nil, commandError("image_digest_missing", err, false)
	}
	var buildMetadata map[string]any
	if err := json.Unmarshal(metadata, &buildMetadata); err != nil {
		return nil, commandError("image_digest_invalid", err, false)
	}
	digest, _ := buildMetadata["containerimage.digest"].(string)
	digest = strings.ToLower(strings.TrimSpace(digest))
	if !imageDigestPattern.MatchString(digest) {
		return nil, &Error{Code: "image_digest_invalid", Message: "BuildKit did not return an OCI image digest"}
	}

	return map[string]any{
		"buildId":        payload.BuildID,
		"version":        payload.Version,
		"commitSha":      commitSHA,
		"imageDigest":    digest,
		"imageReference": payload.ImageRepository + "@" + digest,
		"logExcerpt":     tailText(string(buildOutput), 8000),
	}, nil
}

func buildLocalApplicationImage(
	ctx context.Context,
	payload applicationBuildPayload,
	sourceDirectory, dockerfilePath, buildContext, commitSHA string,
	run CommandRunner,
) (map[string]any, *Error) {
	// Load directly into this node's Docker image store and retain its local cache.
	imageTag := payload.ImageRepository + ":" + payload.BuildID
	output, err := run(ctx, "docker", "buildx", "build",
		"--builder", "default", "--load", "--progress", "plain",
		"--file", filepath.Join(sourceDirectory, dockerfilePath),
		"--tag", imageTag,
		"--label", "org.opencontainers.image.revision="+commitSHA,
		"--label", "org.opencontainers.image.source="+payload.RepositoryURL,
		filepath.Join(sourceDirectory, buildContext),
	)
	if err != nil {
		return nil, commandError("image_build_failed", err, false)
	}
	inspected, err := run(ctx, "docker", "image", "inspect", "--format", "{{.Id}}", imageTag)
	if err != nil {
		return nil, commandError("local_image_inspect_failed", err, false)
	}
	imageID := strings.TrimSpace(string(inspected))
	if !imageDigestPattern.MatchString(imageID) {
		return nil, &Error{Code: "image_digest_invalid", Message: "Docker did not return a valid local image ID"}
	}
	return map[string]any{
		"buildId":        payload.BuildID,
		"version":        payload.Version,
		"commitSha":      commitSHA,
		"imageDigest":    imageID,
		"imageReference": imageID,
		"logExcerpt":     tailText(string(output), 8000),
	}, nil
}

func validGitRevision(value string) bool {
	return gitRevisionPattern.MatchString(value) &&
		!strings.Contains(value, "..") &&
		!strings.Contains(value, "@{") &&
		!strings.Contains(value, "//")
}

func safeBuildPath(value string) (string, error) {
	if value == "" || filepath.IsAbs(value) || strings.ContainsRune(value, '\x00') {
		return "", errors.New("path must be relative")
	}
	cleaned := filepath.Clean(value)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes source directory")
	}
	return cleaned, nil
}

func tailText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}

const databaseBackupDirectory = "/var/lib/oc-agent/backups"

func createDatabaseBackup(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	run CommandRunner,
) (map[string]any, *Error) {
	payload, payloadErr := parseDatabaseBackupPayload(operation)
	if payloadErr != nil {
		return nil, payloadErr
	}
	name, ownershipErr := ownedPostgresContainer(ctx, payload.ResourceID, run)
	if ownershipErr != nil {
		return nil, ownershipErr
	}
	directory := filepath.Join(databaseBackupDirectory, payload.AllocationID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, commandError("backup_directory_failed", err, true)
	}
	path := filepath.Join(directory, payload.BackupID+".dump")
	temporaryPath := path + ".tmp"
	containerPath := "/tmp/oc-backup-" + payload.BackupID + ".dump"
	defer func() { _, _ = run(ctx, "docker", "exec", name, "rm", "-f", containerPath) }()

	if _, err := run(ctx, "docker", "exec", name, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "--username", payload.ProvisionerUsername, "--dbname", payload.DatabaseName, "--file", containerPath); err != nil {
		return nil, commandError("database_backup_failed", err, true)
	}
	if _, err := run(ctx, "docker", "exec", name, "pg_restore", "--list", containerPath); err != nil {
		return nil, commandError("database_backup_verify_failed", err, false)
	}
	_ = os.Remove(temporaryPath)
	if _, err := run(ctx, "docker", "cp", name+":"+containerPath, temporaryPath); err != nil {
		return nil, commandError("database_backup_copy_failed", err, true)
	}
	checksum, size, err := checksumFile(temporaryPath)
	if err != nil {
		_ = os.Remove(temporaryPath)
		return nil, commandError("database_backup_checksum_failed", err, true)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return nil, commandError("database_backup_activate_failed", err, true)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, commandError("database_backup_permissions_failed", err, true)
	}
	storagePath := path
	if payload.ObjectStorage != nil {
		if payload.ObjectStorage.Provider != "s3" || !uuidPattern.MatchString(payload.StorageTargetID) {
			return nil, invalidSpec("invalid backup object storage target")
		}
		client := objectstorage.S3Client{
			AccessKey: secrets["S3_ACCESS_KEY_ID"],
			SecretKey: secrets["S3_SECRET_ACCESS_KEY"],
		}
		if err := client.Upload(ctx, s3Target(payload), path, checksum); err != nil {
			return nil, commandError("database_backup_upload_failed", err, true)
		}
		storagePath = "s3://" + payload.ObjectStorage.Bucket + "/" + payload.ObjectStorage.ObjectKey
	}
	return map[string]any{
		"backupId": payload.BackupID, "allocationId": payload.AllocationID,
		"storagePath": storagePath, "checksumSha256": checksum, "sizeBytes": strconv.FormatInt(size, 10),
	}, nil
}

func restoreDatabaseBackup(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	run CommandRunner,
) (map[string]any, *Error) {
	payload, payloadErr := parseDatabaseBackupPayload(operation)
	if payloadErr != nil {
		return nil, payloadErr
	}
	name, ownershipErr := ownedPostgresContainer(ctx, payload.ResourceID, run)
	if ownershipErr != nil {
		return nil, ownershipErr
	}
	path := filepath.Join(databaseBackupDirectory, payload.AllocationID, payload.BackupID+".dump")
	var raw struct {
		ChecksumSHA256 string `json:"checksumSha256"`
	}
	_ = json.Unmarshal(operation.Payload, &raw)
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(raw.ChecksumSHA256) {
		return nil, invalidSpec("invalid database backup checksum")
	}
	checksum, _, err := checksumFile(path)
	if (err != nil || checksum != raw.ChecksumSHA256) && payload.ObjectStorage != nil {
		if mkdirErr := os.MkdirAll(filepath.Dir(path), 0o700); mkdirErr != nil {
			return nil, commandError("backup_directory_failed", mkdirErr, true)
		}
		client := objectstorage.S3Client{
			AccessKey: secrets["S3_ACCESS_KEY_ID"],
			SecretKey: secrets["S3_SECRET_ACCESS_KEY"],
		}
		if downloadErr := client.Download(ctx, s3Target(payload), path); downloadErr != nil {
			return nil, commandError("database_backup_download_failed", downloadErr, true)
		}
		checksum, _, err = checksumFile(path)
	}
	if err != nil {
		return nil, &Error{Code: "database_backup_missing", Message: "backup artifact is unavailable on this node"}
	}
	if checksum != raw.ChecksumSHA256 {
		return nil, &Error{Code: "database_backup_checksum_mismatch", Message: "backup checksum verification failed"}
	}
	containerPath := "/tmp/oc-restore-" + payload.BackupID + ".dump"
	defer func() { _, _ = run(ctx, "docker", "exec", name, "rm", "-f", containerPath) }()
	if _, err := run(ctx, "docker", "cp", path, name+":"+containerPath); err != nil {
		return nil, commandError("database_restore_copy_failed", err, true)
	}
	if _, err := run(ctx, "docker", "exec", name, "pg_restore", "--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--username", payload.ProvisionerUsername, "--dbname", payload.DatabaseName, containerPath); err != nil {
		return nil, commandError("database_restore_failed", err, false)
	}
	return map[string]any{"backupId": payload.BackupID, "allocationId": payload.AllocationID, "restored": true}, nil
}

func deleteDatabaseBackup(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
) (map[string]any, *Error) {
	var payload databaseBackupPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil ||
		!uuidPattern.MatchString(payload.BackupID) || !uuidPattern.MatchString(payload.AllocationID) {
		return nil, invalidSpec("invalid database backup deletion payload")
	}
	path := filepath.Join(databaseBackupDirectory, payload.AllocationID, payload.BackupID+".dump")
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, commandError("database_backup_delete_failed", err, true)
	}
	if payload.ObjectStorage != nil {
		client := objectstorage.S3Client{
			AccessKey: secrets["S3_ACCESS_KEY_ID"],
			SecretKey: secrets["S3_SECRET_ACCESS_KEY"],
		}
		if err := client.Delete(ctx, s3Target(payload)); err != nil {
			return nil, commandError("database_backup_object_delete_failed", err, true)
		}
	}
	return map[string]any{"backupId": payload.BackupID, "deleted": true}, nil
}

func s3Target(payload databaseBackupPayload) objectstorage.S3Target {
	if payload.ObjectStorage == nil {
		return objectstorage.S3Target{}
	}
	return objectstorage.S3Target{
		Endpoint:  payload.ObjectStorage.Endpoint,
		Region:    payload.ObjectStorage.Region,
		Bucket:    payload.ObjectStorage.Bucket,
		ObjectKey: payload.ObjectStorage.ObjectKey,
		PathStyle: payload.ObjectStorage.PathStyle,
	}
}

func parseDatabaseBackupPayload(operation controlplane.Operation) (databaseBackupPayload, *Error) {
	var payload databaseBackupPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return payload, invalidSpec("invalid database backup payload")
	}
	if !uuidPattern.MatchString(payload.BackupID) || !uuidPattern.MatchString(payload.AllocationID) ||
		!uuidPattern.MatchString(payload.ClusterID) || !uuidPattern.MatchString(payload.ResourceID) ||
		!postgresIdentifierPattern.MatchString(payload.DatabaseName) ||
		!postgresIdentifierPattern.MatchString(payload.ProvisionerUsername) {
		return payload, invalidSpec("invalid database backup identity")
	}
	return payload, nil
}

func ownedPostgresContainer(ctx context.Context, resourceID string, run CommandRunner) (string, *Error) {
	name := containerName(resourceID)
	owner, err := run(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "oc.resource-id"}}`, name)
	if err != nil || strings.TrimSpace(string(owner)) != resourceID {
		return "", &Error{Code: "resource_not_found", Message: "owned PostgreSQL container was not found"}
	}
	return name, nil
}

func checksumFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return "", 0, err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), size, nil
}

func deleteRoute(
	ctx context.Context,
	operation controlplane.Operation,
	secretDirectory string,
	run CommandRunner,
) (map[string]any, *Error) {
	var payload struct {
		RouteID string `json:"routeId"`
	}
	if err := json.Unmarshal(operation.Payload, &payload); err != nil || !uuidPattern.MatchString(payload.RouteID) {
		return nil, invalidSpec("invalid route delete payload")
	}
	if !filepath.IsAbs(secretDirectory) {
		return nil, invalidSpec("agent data directory must be absolute")
	}
	routeName := "route-" + strings.ReplaceAll(payload.RouteID, "-", "")
	for _, extension := range []string{".yaml", ".json"} {
		path := filepath.Join(filepath.Dir(secretDirectory), "gateway", "dynamic", routeName+extension)
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, &Error{Code: "route_delete_failed", Message: "route configuration could not be removed", Retryable: true}
		}
	}
	if _, err := runGatewayHealthcheck(ctx, run); err != nil {
		return nil, &Error{Code: "gateway_not_ready", Message: "Traefik did not accept the route deletion", Retryable: true}
	}
	return map[string]any{"routeId": payload.RouteID, "deleted": true}, nil
}

func configureRoute(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	secretDirectory string,
	run CommandRunner,
) (map[string]any, *Error) {
	var payload routePayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, invalidSpec("invalid route payload")
	}
	hostnamePattern := regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$`)
	if !uuidPattern.MatchString(payload.RouteID) || !uuidPattern.MatchString(payload.ResourceID) ||
		!hostnamePattern.MatchString(payload.Hostname) || payload.TargetPort < 1 || payload.TargetPort > 65535 {
		return nil, invalidSpec("invalid route identity, hostname, or target port")
	}
	if !filepath.IsAbs(secretDirectory) {
		return nil, invalidSpec("agent data directory must be absolute")
	}

	routeName := "route-" + strings.ReplaceAll(payload.RouteID, "-", "")
	middlewares := []string{}
	dynamicMiddlewares := map[string]any{}
	if payload.BillingGateEnabled {
		billingURL, err := url.ParseRequestURI(payload.BillingGateURL)
		if err != nil || (billingURL.Scheme != "http" && billingURL.Scheme != "https") || billingURL.Host == "" {
			return nil, invalidSpec("billing gate URL is invalid")
		}
		sharedKey := secrets["BILLING_GATE_SHARED_KEY"]
		if sharedKey == "" {
			return nil, &Error{Code: "secret_unavailable", Message: "billing gate shared key is unavailable", Retryable: true}
		}
		headerMiddleware := routeName + "-billing-key"
		authMiddleware := routeName + "-billing-auth"
		middlewares = append(middlewares, headerMiddleware, authMiddleware)
		dynamicMiddlewares[headerMiddleware] = map[string]any{
			"headers": map[string]any{"customRequestHeaders": map[string]string{"X-Billing-Gate-Key": sharedKey}},
		}
		dynamicMiddlewares[authMiddleware] = map[string]any{
			"forwardAuth": map[string]any{
				"address":            payload.BillingGateURL,
				"trustForwardHeader": true,
			},
		}
	}

	router := map[string]any{
		"rule":        fmt.Sprintf("Host(`%s`)", payload.Hostname),
		"entryPoints": []string{"web"},
		"service":     routeName,
	}
	if len(middlewares) > 0 {
		router["middlewares"] = middlewares
	}
	configuration := map[string]any{
		"http": map[string]any{
			"routers": map[string]any{routeName: router},
			"services": map[string]any{
				routeName: map[string]any{
					"loadBalancer": map[string]any{
						"servers": []map[string]string{{"url": fmt.Sprintf("http://%s:%d", containerName(payload.ResourceID), payload.TargetPort)}},
					},
				},
			},
			"middlewares": dynamicMiddlewares,
		},
	}
	// Traefik rejects an empty middleware map as a standalone configuration node.
	if len(dynamicMiddlewares) == 0 {
		delete(configuration["http"].(map[string]any), "middlewares")
	}
	contents, err := json.Marshal(configuration)
	if err != nil {
		return nil, invalidSpec("route configuration could not be encoded")
	}
	dynamicDirectory := filepath.Join(filepath.Dir(secretDirectory), "gateway", "dynamic")
	if err := os.MkdirAll(dynamicDirectory, 0o700); err != nil {
		return nil, &Error{Code: "route_write_failed", Message: "route directory could not be created", Retryable: true}
	}
	// JSON is valid YAML. Traefik's directory provider only loads .yaml/.yml/.toml.
	path := filepath.Join(dynamicDirectory, routeName+".yaml")
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, contents, 0o600); err != nil {
		return nil, &Error{Code: "route_write_failed", Message: "route configuration could not be written", Retryable: true}
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return nil, &Error{Code: "route_write_failed", Message: "route configuration could not be activated", Retryable: true}
	}
	legacyPath := filepath.Join(dynamicDirectory, routeName+".json")
	if err := os.Remove(legacyPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, &Error{Code: "route_write_failed", Message: "legacy route configuration could not be removed", Retryable: true}
	}
	if _, err := run(ctx, "docker", "kill", "--signal", "HUP", gatewayContainerName); err != nil {
		return nil, commandError("gateway_reload_failed", err, true)
	}
	if _, err := runGatewayHealthcheck(ctx, run); err != nil {
		return nil, &Error{Code: "gateway_not_ready", Message: "Traefik did not accept the route configuration", Retryable: true}
	}
	logs, _ := run(ctx, "docker", "logs", "--tail", "20", gatewayContainerName)
	logExcerpt := string(logs)
	for _, secret := range secrets {
		if secret != "" {
			logExcerpt = strings.ReplaceAll(logExcerpt, secret, "[redacted]")
		}
	}
	mounts, _ := run(ctx, "docker", "inspect", "--format", "{{json .Mounts}}", gatewayContainerName)
	return map[string]any{"routeId": payload.RouteID, "hostname": payload.Hostname, "active": true,
		"configurationFile": path, "gatewayLogExcerpt": tailText(logExcerpt, 6000), "gatewayMounts": strings.TrimSpace(string(mounts)),
	}, nil
}

func ensureGateway(
	ctx context.Context,
	operation controlplane.Operation,
	secretDirectory string,
	run CommandRunner,
) (map[string]any, *Error) {
	var payload gatewayPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, invalidSpec("invalid gateway payload")
	}
	if payload.Image == "" || strings.HasPrefix(payload.Image, "-") || strings.ContainsAny(payload.Image, " \t\r\n") {
		return nil, invalidSpec("invalid gateway image")
	}
	if !filepath.IsAbs(secretDirectory) {
		return nil, invalidSpec("agent data directory must be absolute")
	}
	if networkErr := ensureManagedNetwork(ctx, run); networkErr != nil {
		return nil, networkErr
	}

	dynamicDirectory := filepath.Join(filepath.Dir(secretDirectory), "gateway", "dynamic")
	if err := os.MkdirAll(dynamicDirectory, 0o700); err != nil {
		return nil, &Error{Code: "gateway_config_failed", Message: "gateway configuration directory could not be created", Retryable: true}
	}

	existingImage, inspectErr := run(ctx, "docker", "inspect", "--format", "{{.Config.Image}}", gatewayContainerName)
	hasExisting := inspectErr == nil && strings.TrimSpace(string(existingImage)) != ""
	if inspectErr != nil && !strings.Contains(strings.ToLower(string(existingImage)), "no such object") {
		return nil, commandError("gateway_inspect_failed", inspectErr, true)
	}
	if hasExisting {
		component, componentErr := run(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "oc.component"}}`, gatewayContainerName)
		if componentErr != nil || strings.TrimSpace(string(component)) != "gateway" {
			return nil, &Error{Code: "ownership_conflict", Message: "existing oc-gateway container is not managed by OC Agent"}
		}
		configVersion, configVersionErr := run(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "oc.gateway-config-version"}}`, gatewayContainerName)
		if configVersionErr != nil {
			return nil, commandError("gateway_inspect_failed", configVersionErr, true)
		}
		if strings.TrimSpace(string(existingImage)) != payload.Image || strings.TrimSpace(string(configVersion)) != gatewayConfigVersion {
			if _, err := run(ctx, "docker", "rm", "--force", gatewayContainerName); err != nil {
				return nil, commandError("gateway_replace_failed", err, true)
			}
			hasExisting = false
		}
	}

	if !hasExisting {
		if _, err := run(ctx, "docker", "pull", payload.Image); err != nil {
			return nil, commandError("gateway_pull_failed", err, true)
		}
		args := []string{
			"create", "--name", gatewayContainerName,
			"--network", managedNetworkName,
			"--label", "oc.managed=true",
			"--label", "oc.component=gateway",
			"--label", "oc.gateway-config-version=" + gatewayConfigVersion,
			"--restart", "unless-stopped",
			"--publish", "80:80",
			"--publish", "443:443",
			"--mount", fmt.Sprintf("type=bind,src=%s,dst=/etc/traefik/dynamic,readonly", dynamicDirectory),
			"--health-cmd", gatewayHealthcheckCommand,
			"--health-interval", "10s",
			"--health-timeout", "3s",
			"--health-retries", "3",
			payload.Image,
			"--api.dashboard=false",
			"--ping=true",
			"--ping.entrypoint=management",
			"--entryPoints.web.address=:80",
			"--entryPoints.websecure.address=:443",
			"--entryPoints.management.address=:8082",
			"--providers.file.directory=/etc/traefik/dynamic",
			"--providers.file.watch=true",
			"--log.level=INFO",
		}
		if _, err := run(ctx, "docker", args...); err != nil {
			return nil, commandError("gateway_create_failed", err, false)
		}
	}

	state, stateErr := run(ctx, "docker", "inspect", "--format", "{{.State.Status}}", gatewayContainerName)
	if stateErr != nil {
		return nil, commandError("gateway_inspect_failed", stateErr, true)
	}
	if strings.TrimSpace(string(state)) != "running" {
		if _, err := run(ctx, "docker", "start", gatewayContainerName); err != nil {
			return nil, commandError("gateway_start_failed", err, true)
		}
	}
	if _, err := runGatewayHealthcheck(ctx, run); err != nil {
		return nil, &Error{Code: "gateway_not_ready", Message: "Traefik is running but its health check is not ready", Retryable: true}
	}
	containerID, err := run(ctx, "docker", "inspect", "--format", "{{.Id}}", gatewayContainerName)
	if err != nil {
		return nil, commandError("gateway_inspect_failed", err, true)
	}
	return map[string]any{
		"containerId":   strings.TrimSpace(string(containerID)),
		"containerName": gatewayContainerName,
		"image":         payload.Image,
		"healthy":       true,
	}, nil
}

func runGatewayHealthcheck(ctx context.Context, run CommandRunner) ([]byte, error) {
	return run(
		ctx,
		"docker",
		"exec",
		gatewayContainerName,
		"traefik",
		"healthcheck",
		"--ping=true",
		"--ping.entrypoint=management",
		"--entrypoints.management.address=:8082",
	)
}

func ensureServiceDatabase(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	run CommandRunner,
	runInput InputCommandRunner,
) (map[string]any, *Error) {
	var payload serviceDatabasePayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, invalidSpec("invalid service database payload")
	}
	if !uuidPattern.MatchString(payload.AllocationID) ||
		!uuidPattern.MatchString(payload.ClusterID) ||
		!uuidPattern.MatchString(payload.ResourceID) ||
		!uuidPattern.MatchString(payload.ApplicationResourceID) {
		return nil, invalidSpec("invalid service database identity")
	}
	if !postgresIdentifierPattern.MatchString(payload.AdminDatabase) ||
		!postgresIdentifierPattern.MatchString(payload.ProvisionerUsername) ||
		!postgresIdentifierPattern.MatchString(payload.DatabaseName) ||
		!postgresIdentifierPattern.MatchString(payload.RoleName) {
		return nil, invalidSpec("invalid PostgreSQL database or role identifier")
	}
	if payload.ConnectionLimit < 1 || payload.ConnectionLimit > 10_000 ||
		!slugPattern.MatchString(payload.NetworkAlias) {
		return nil, invalidSpec("invalid database connection policy")
	}
	password := secrets["DATABASE_PASSWORD"]
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(password) {
		return nil, &Error{
			Code: "secret_unavailable", Message: "database password is unavailable or invalid", Retryable: true,
		}
	}

	name := containerName(payload.ResourceID)
	owner, err := run(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "oc.resource-id"}}`, name)
	if err != nil || strings.TrimSpace(string(owner)) != payload.ResourceID {
		return nil, &Error{Code: "resource_not_found", Message: "owned PostgreSQL container was not found"}
	}
	if networkErr := ensureManagedNetwork(ctx, run); networkErr != nil {
		return nil, networkErr
	}
	connectOutput, connectErr := run(
		ctx,
		"docker",
		"network",
		"connect",
		"--alias",
		payload.NetworkAlias,
		managedNetworkName,
		name,
	)
	if connectErr != nil && !strings.Contains(strings.ToLower(string(connectOutput)), "already exists") {
		return nil, commandError("database_network_failed", connectErr, true)
	}

	sql := serviceDatabaseSQL(payload, password)
	if _, err := runInput(
		ctx,
		[]byte(sql),
		"docker",
		"exec",
		"--interactive",
		name,
		"psql",
		"--username",
		payload.ProvisionerUsername,
		"--dbname",
		payload.AdminDatabase,
		"--set",
		"ON_ERROR_STOP=1",
		"--no-psqlrc",
	); err != nil {
		return nil, commandError("database_provision_failed", err, true)
	}
	return map[string]any{
		"allocationId": payload.AllocationID,
		"databaseName": payload.DatabaseName,
		"roleName":     payload.RoleName,
		"ready":        true,
	}, nil
}

func serviceDatabaseSQL(payload serviceDatabasePayload, password string) string {
	database := quotePostgresIdentifier(payload.DatabaseName)
	role := quotePostgresIdentifier(payload.RoleName)
	passwordLiteral := quotePostgresLiteral(password)
	return fmt.Sprintf(`DO $oc$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %s) THEN
    ALTER ROLE %s WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT %d PASSWORD %s;
  ELSE
    CREATE ROLE %s WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT %d PASSWORD %s;
  END IF;
END
$oc$;
SELECT format('CREATE DATABASE %%I OWNER %%I', %s, %s)
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = %s)\gexec
ALTER DATABASE %s OWNER TO %s;
REVOKE CONNECT ON DATABASE %s FROM PUBLIC;
GRANT CONNECT ON DATABASE %s TO %s;
\connect %s
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO %s;
ALTER DEFAULT PRIVILEGES FOR ROLE %s REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE %s REVOKE ALL ON SEQUENCES FROM PUBLIC;
`, quotePostgresLiteral(payload.RoleName), role, payload.ConnectionLimit, passwordLiteral,
		role, payload.ConnectionLimit, passwordLiteral,
		quotePostgresLiteral(payload.DatabaseName), quotePostgresLiteral(payload.RoleName),
		quotePostgresLiteral(payload.DatabaseName), database, role, database, database, role,
		payload.DatabaseName, role, role, role)
}

func quotePostgresIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func quotePostgresLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}

func activateDatabaseCluster(
	ctx context.Context,
	operation controlplane.Operation,
	run CommandRunner,
) (map[string]any, *Error) {
	var payload databaseClusterPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, invalidSpec("invalid database cluster payload")
	}
	if !uuidPattern.MatchString(payload.ClusterID) || !uuidPattern.MatchString(payload.ResourceID) {
		return nil, invalidSpec("invalid database cluster identity")
	}
	if !postgresIdentifierPattern.MatchString(payload.AdminDatabase) ||
		!postgresIdentifierPattern.MatchString(payload.ProvisionerUsername) {
		return nil, invalidSpec("invalid PostgreSQL database or role identifier")
	}

	name := containerName(payload.ResourceID)
	owner, err := run(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "oc.resource-id"}}`, name)
	if err != nil || strings.TrimSpace(string(owner)) != payload.ResourceID {
		return nil, &Error{Code: "resource_not_found", Message: "owned PostgreSQL container was not found"}
	}
	output, err := run(
		ctx,
		"docker",
		"exec",
		name,
		"pg_isready",
		"--username",
		payload.ProvisionerUsername,
		"--dbname",
		payload.AdminDatabase,
	)
	if err != nil {
		return nil, commandError("postgres_preflight_failed", err, true)
	}
	return map[string]any{
		"clusterId": payload.ClusterID,
		"ready":     true,
		"message":   strings.TrimSpace(string(output)),
	}, nil
}

func ensureApplication(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	registry *controlplane.RegistryCredential,
	secretDirectory string,
	run CommandRunner,
	runInput InputCommandRunner,
) (map[string]any, *Error) {
	var payload applicationPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return nil, invalidSpec("invalid application payload")
	}
	if !uuidPattern.MatchString(payload.ResourceID) || !slugPattern.MatchString(payload.Name) {
		return nil, invalidSpec("invalid resource identity or application name")
	}
	if payload.Spec.Source.Type != "image" || payload.Spec.Source.Reference == "" {
		return nil, &Error{Code: "unsupported", Message: "only image sources are supported by this agent version"}
	}
	if strings.HasPrefix(payload.Spec.Source.Reference, "-") {
		return nil, invalidSpec("invalid image reference")
	}
	if payload.Spec.Source.PullPolicy != "" && payload.Spec.Source.PullPolicy != "always" && payload.Spec.Source.PullPolicy != "never" {
		return nil, invalidSpec("unsupported image pull policy")
	}
	local := payload.Spec.Source.PullPolicy == "never"
	if local && (!imageDigestPattern.MatchString(payload.Spec.Source.Reference) || !uuidPattern.MatchString(payload.Spec.Source.NodeID)) {
		return nil, invalidSpec("local image requires an immutable image ID and origin node")
	}
	if local && payload.Spec.Source.NodeID != operation.NodeID {
		return nil, invalidSpec("local image belongs to a different node")
	}
	if payload.Kind == "" {
		payload.Kind = "application"
	}
	if payload.Kind != "application" && payload.Kind != "database" {
		return nil, invalidSpec("invalid resource kind")
	}
	secretFiles := map[string]string{}
	secretEnvironmentFile := ""
	if payload.Spec.SecretDelivery == "environment" {
		path, secretErr := materializeSecretEnvironment(payload, secrets, secretDirectory)
		if secretErr != nil {
			return nil, secretErr
		}
		secretEnvironmentFile = path
		if path != "" {
			defer os.Remove(path)
		}
	} else if payload.Spec.SecretDelivery == "" || payload.Spec.SecretDelivery == "files" {
		files, secretErr := materializeSecrets(payload, secrets, secretDirectory)
		if secretErr != nil {
			return nil, secretErr
		}
		secretFiles = files
	} else {
		return nil, invalidSpec("unsupported secret delivery mode")
	}
	args, err := createArgs(payload, secretFiles, secretEnvironmentFile)
	if err != nil {
		return nil, invalidSpec(err.Error())
	}
	if networkErr := ensureManagedNetwork(ctx, run); networkErr != nil {
		return nil, networkErr
	}

	containerName := containerName(payload.ResourceID)
	hasExisting := false
	existingID, inspectErr := run(ctx, "docker", "inspect", "--format", "{{.Id}}", containerName)
	if inspectErr != nil && !strings.Contains(strings.ToLower(string(existingID)), "no such object") {
		return nil, commandError("container_inspect_failed", inspectErr, true)
	}
	if inspectErr == nil && strings.TrimSpace(string(existingID)) != "" {
		hasExisting = true
		owner, ownerErr := run(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "oc.resource-id"}}`, containerName)
		if ownerErr != nil || strings.TrimSpace(string(owner)) != payload.ResourceID {
			return nil, &Error{Code: "ownership_conflict", Message: "existing container is not owned by this resource"}
		}
	}

	if local {
		inspected, err := run(ctx, "docker", "image", "inspect", "--format", "{{.Id}}", payload.Spec.Source.Reference)
		if err != nil || strings.TrimSpace(string(inspected)) != payload.Spec.Source.Reference {
			return nil, &Error{Code: "local_image_missing", Message: "Local release image is missing on this server; rebuild the application before deploying"}
		}
	} else if pullErr := pullImage(
		ctx,
		payload.Spec.Source.Reference,
		registry,
		secretDirectory,
		run,
		runInput,
	); pullErr != nil {
		return nil, pullErr
	}
	for _, volume := range payload.Spec.Volumes {
		if !slugPattern.MatchString(volume.Name) || !strings.HasPrefix(volume.MountTarget, "/") {
			return nil, invalidSpec("invalid named volume")
		}
		if _, err := run(ctx, "docker", "volume", "create", volumeName(payload.ResourceID, volume.Name)); err != nil {
			return nil, commandError("volume_create_failed", err, true)
		}
	}

	if hasExisting {
		if _, err := run(ctx, "docker", "rm", "--force", containerName); err != nil {
			return nil, commandError("replace_container", err, true)
		}
	}
	created, createErr := run(ctx, "docker", args...)
	if createErr != nil {
		return nil, commandError("container_create_failed", createErr, false)
	}
	containerID := strings.TrimSpace(string(created))
	if _, err := run(ctx, "docker", "start", containerName); err != nil {
		return nil, commandError("container_start_failed", err, true)
	}
	result := map[string]any{"externalId": containerID, "containerName": containerName}
	if local {
		result["imageDigest"] = payload.Spec.Source.Reference
	}
	if separator := strings.LastIndex(payload.Spec.Source.Reference, "@sha256:"); separator >= 0 {
		result["imageDigest"] = payload.Spec.Source.Reference[separator+1:]
	}
	return result, nil
}

func pullImage(
	ctx context.Context,
	reference string,
	registry *controlplane.RegistryCredential,
	secretDirectory string,
	run CommandRunner,
	runInput InputCommandRunner,
) *Error {
	if registry == nil {
		if _, err := run(ctx, "docker", "pull", reference); err != nil {
			return commandError("image_pull_failed", err, true)
		}
		return nil
	}
	if registry.Host == "" || registry.Username == "" || registry.Token == "" ||
		!strings.HasPrefix(reference, registry.Host+"/") {
		return invalidSpec("registry credential does not match the image reference")
	}
	if secretDirectory == "" || !filepath.IsAbs(secretDirectory) {
		return invalidSpec("secret directory must be absolute")
	}
	if err := os.MkdirAll(secretDirectory, 0o700); err != nil {
		return &Error{Code: "registry_auth_failed", Message: "registry auth directory could not be created", Retryable: true}
	}
	dockerConfigDirectory, err := os.MkdirTemp(secretDirectory, "registry-")
	if err != nil {
		return &Error{Code: "registry_auth_failed", Message: "registry auth directory could not be created", Retryable: true}
	}
	defer os.RemoveAll(dockerConfigDirectory)
	if err := os.Chmod(dockerConfigDirectory, 0o700); err != nil {
		return &Error{Code: "registry_auth_failed", Message: "registry auth directory permissions could not be set", Retryable: true}
	}
	if _, err := runInput(
		ctx,
		[]byte(registry.Token+"\n"),
		"docker",
		"--config",
		dockerConfigDirectory,
		"login",
		registry.Host,
		"--username",
		registry.Username,
		"--password-stdin",
	); err != nil {
		return commandError("registry_auth_failed", err, true)
	}
	if _, err := run(
		ctx,
		"docker",
		"--config",
		dockerConfigDirectory,
		"pull",
		reference,
	); err != nil {
		return commandError("image_pull_failed", err, true)
	}
	return nil
}

func lifecycle(
	ctx context.Context,
	operation controlplane.Operation,
	secretDirectory string,
	run CommandRunner,
) (map[string]any, *Error) {
	var payload lifecyclePayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil || !uuidPattern.MatchString(payload.ResourceID) {
		return nil, invalidSpec("invalid lifecycle payload")
	}
	name := containerName(payload.ResourceID)
	owner, err := run(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "oc.resource-id"}}`, name)
	if err != nil || strings.TrimSpace(string(owner)) != payload.ResourceID {
		return nil, &Error{Code: "resource_not_found", Message: "owned container was not found"}
	}

	var args []string
	switch operation.Action {
	case "application.start":
		args = []string{"start", name}
	case "application.stop":
		args = []string{"stop", "--time", "30", name}
	case "application.restart":
		args = []string{"restart", "--time", "30", name}
	case "application.delete":
		args = []string{"rm", "--force", name}
	}
	if _, err := run(ctx, "docker", args...); err != nil {
		return nil, commandError("lifecycle_failed", err, true)
	}
	if operation.Action == "application.delete" {
		_ = os.RemoveAll(filepath.Join(secretDirectory, payload.ResourceID))
	}
	return map[string]any{"externalId": name}, nil
}

func createArgs(payload applicationPayload, secretFiles map[string]string, secretEnvironmentFile string) ([]string, error) {
	if payload.Spec.Limits.CPUMilli < 50 {
		return nil, errors.New("CPU limit is below the minimum")
	}
	if _, err := strconv.ParseUint(payload.Spec.Limits.MemoryBytes, 10, 64); err != nil {
		return nil, errors.New("memory limit is invalid")
	}

	name := containerName(payload.ResourceID)
	args := []string{
		"create", "--name", name,
		"--network", managedNetworkName,
		"--label", "oc.managed=true",
		"--label", "oc.resource-id=" + payload.ResourceID,
		"--label", "oc.revision=" + strconv.Itoa(payload.Revision),
		"--label", "oc.application-name=" + payload.Name,
		"--label", "oc.kind=" + payload.Kind,
		"--restart", payload.Spec.RestartPolicy,
		"--cpus", strconv.FormatFloat(float64(payload.Spec.Limits.CPUMilli)/1000, 'f', 3, 64),
		"--memory", payload.Spec.Limits.MemoryBytes,
	}
	if payload.Spec.Source.PullPolicy == "never" {
		args = append(args, "--pull=never")
	}
	if secretEnvironmentFile != "" {
		args = append(args, "--env-file", secretEnvironmentFile)
	}

	environmentKeys := make([]string, 0, len(payload.Spec.Environment))
	for key := range payload.Spec.Environment {
		environmentKeys = append(environmentKeys, key)
	}
	sort.Strings(environmentKeys)
	for _, key := range environmentKeys {
		args = append(args, "--env", key+"="+payload.Spec.Environment[key])
	}
	secretKeys := make([]string, 0, len(secretFiles))
	for key := range secretFiles {
		secretKeys = append(secretKeys, key)
	}
	sort.Strings(secretKeys)
	for _, key := range secretKeys {
		containerPath := "/run/secrets/" + strings.ToLower(key)
		args = append(args,
			"--mount", fmt.Sprintf("type=bind,src=%s,dst=%s,readonly", secretFiles[key], containerPath),
			"--env", key+"_FILE="+containerPath,
		)
	}
	for _, port := range payload.Spec.Ports {
		if port.ContainerPort < 1 || port.ContainerPort > 65535 || (port.Protocol != "tcp" && port.Protocol != "udp") {
			return nil, errors.New("application port is invalid")
		}
		if port.HostPort < 0 || port.HostPort > 65535 {
			return nil, errors.New("host port is invalid")
		}
		if port.HostPort > 0 {
			args = append(args, "--publish", fmt.Sprintf("%d:%d/%s", port.HostPort, port.ContainerPort, port.Protocol))
		} else {
			args = append(args, "--expose", fmt.Sprintf("%d/%s", port.ContainerPort, port.Protocol))
		}
	}
	for _, volume := range payload.Spec.Volumes {
		args = append(args, "--mount", fmt.Sprintf("type=volume,src=%s,dst=%s", volumeName(payload.ResourceID, volume.Name), volume.MountTarget))
	}
	if payload.Spec.Healthcheck != nil {
		health := payload.Spec.Healthcheck
		args = append(args,
			"--health-cmd", fmt.Sprintf("wget -q -O /dev/null http://127.0.0.1:%d%s || exit 1", health.Port, health.Path),
			"--health-interval", strconv.Itoa(health.IntervalSeconds)+"s",
			"--health-timeout", strconv.Itoa(health.TimeoutSeconds)+"s",
		)
	}
	args = append(args, payload.Spec.Source.Reference)
	return args, nil
}

func materializeSecretEnvironment(payload applicationPayload, secrets map[string]string, secretDirectory string) (string, *Error) {
	if len(payload.Spec.SecretReferences) == 0 {
		return "", nil
	}
	if !filepath.IsAbs(secretDirectory) {
		return "", invalidSpec("secret directory must be absolute")
	}
	keys := make([]string, 0, len(payload.Spec.SecretReferences))
	for key := range payload.Spec.SecretReferences {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var content strings.Builder
	for _, key := range keys {
		if !environmentKeyPattern.MatchString(key) {
			return "", invalidSpec("invalid secret environment key")
		}
		value, ok := secrets[key]
		if !ok || value == "" {
			return "", &Error{Code: "secret_unavailable", Message: "a required operation secret is unavailable", Retryable: true}
		}
		if strings.ContainsAny(value, "\r\n\x00") {
			return "", invalidSpec("environment delivery requires single-line secret values; use file delivery for multiline secrets")
		}
		content.WriteString(key + "=" + value + "\n")
	}
	if err := os.MkdirAll(secretDirectory, 0o700); err != nil {
		return "", &Error{Code: "secret_write_failed", Message: "secret directory could not be created", Retryable: true}
	}
	file, err := os.CreateTemp(secretDirectory, payload.ResourceID+"-env-*")
	if err != nil {
		return "", &Error{Code: "secret_write_failed", Message: "secret environment could not be created", Retryable: true}
	}
	path := file.Name()
	_, writeErr := file.WriteString(content.String())
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(path)
		return "", &Error{Code: "secret_write_failed", Message: "secret environment could not be written", Retryable: true}
	}
	return path, nil
}

func materializeSecrets(
	payload applicationPayload,
	secrets map[string]string,
	secretDirectory string,
) (map[string]string, *Error) {
	files := make(map[string]string, len(payload.Spec.SecretReferences))
	if len(payload.Spec.SecretReferences) == 0 {
		return files, nil
	}
	if secretDirectory == "" || !filepath.IsAbs(secretDirectory) {
		return nil, invalidSpec("secret directory must be absolute")
	}
	resourceDirectory := filepath.Join(secretDirectory, payload.ResourceID)
	if err := os.MkdirAll(resourceDirectory, 0o700); err != nil {
		return nil, &Error{Code: "secret_write_failed", Message: "secret directory could not be created", Retryable: true}
	}
	if err := os.Chmod(resourceDirectory, 0o700); err != nil {
		return nil, &Error{Code: "secret_write_failed", Message: "secret directory permissions could not be set", Retryable: true}
	}
	for key := range payload.Spec.SecretReferences {
		if !environmentKeyPattern.MatchString(key) {
			return nil, invalidSpec("invalid secret environment key")
		}
		value, ok := secrets[key]
		if !ok || value == "" {
			return nil, &Error{Code: "secret_unavailable", Message: "a required operation secret is unavailable", Retryable: true}
		}
		path := filepath.Join(resourceDirectory, strings.ToLower(key))
		temporary := path + ".tmp"
		// The parent directory is private to oc-agent on the host. The mounted file
		// is read-only so non-root images (for example Bitnami) can consume it.
		if err := os.WriteFile(temporary, []byte(value), 0o400); err != nil {
			return nil, &Error{Code: "secret_write_failed", Message: "operation secret could not be written", Retryable: true}
		}
		if err := os.Rename(temporary, path); err != nil {
			_ = os.Remove(temporary)
			return nil, &Error{Code: "secret_write_failed", Message: "operation secret could not be activated", Retryable: true}
		}
		if err := os.Chmod(path, 0o444); err != nil {
			return nil, &Error{Code: "secret_write_failed", Message: "operation secret permissions could not be set", Retryable: true}
		}
		files[key] = path
	}
	return files, nil
}

func containerName(resourceID string) string {
	return "oc-" + strings.ReplaceAll(resourceID, "-", "")
}

func volumeName(resourceID, name string) string {
	return containerName(resourceID) + "-" + name
}

func invalidSpec(message string) *Error {
	return &Error{Code: "invalid_spec", Message: message}
}

func commandError(code string, err error, retryable bool) *Error {
	message := strings.TrimSpace(err.Error())
	if len(message) > 1000 {
		message = message[len(message)-1000:]
	}
	return &Error{Code: code, Message: message, Retryable: retryable}
}

func runCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		return output, fmt.Errorf("%w: %s", err, tailText(string(output), 2000))
	}
	return output, nil
}

func runCommandWithInput(
	ctx context.Context,
	input []byte,
	name string,
	args ...string,
) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Stdin = strings.NewReader(string(input))
	output, err := command.CombinedOutput()
	if err != nil {
		return output, fmt.Errorf("%w: %s", err, tailText(string(output), 2000))
	}
	return output, nil
}

func ensureManagedNetwork(ctx context.Context, run CommandRunner) *Error {
	if _, err := run(ctx, "docker", "network", "inspect", managedNetworkName); err == nil {
		return nil
	}
	if _, err := run(
		ctx,
		"docker",
		"network",
		"create",
		"--driver",
		"bridge",
		"--label",
		"oc.managed=true",
		managedNetworkName,
	); err != nil {
		return commandError("network_create_failed", err, true)
	}
	return nil
}
