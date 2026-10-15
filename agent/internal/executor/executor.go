package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
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
		Type      string `json:"type"`
		Reference string `json:"reference"`
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

var (
	uuidPattern               = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	slugPattern               = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,159}$`)
	environmentKeyPattern     = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)
	postgresIdentifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)
)

const managedNetworkName = "oc-private"

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
	return executeWithInput(ctx, operation, secrets, "/var/lib/oc-agent/secrets", run, runInput)
}

func ExecuteWithSecrets(
	ctx context.Context,
	operation controlplane.Operation,
	secrets map[string]string,
	secretDirectory string,
) (map[string]any, *Error) {
	return executeWithInput(
		ctx,
		operation,
		secrets,
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
	secretDirectory string,
	run CommandRunner,
	runInput InputCommandRunner,
) (map[string]any, *Error) {
	switch operation.Action {
	case "application.ensure", "application.redeploy":
		return ensureApplication(ctx, operation, secrets, secretDirectory, run)
	case "application.start", "application.stop", "application.restart", "application.delete":
		return lifecycle(ctx, operation, secretDirectory, run)
	case "database.cluster.activate":
		return activateDatabaseCluster(ctx, operation, run)
	case "database.service.ensure":
		return ensureServiceDatabase(ctx, operation, secrets, run, runInput)
	default:
		return nil, &Error{Code: "unsupported", Message: "agent action is not supported"}
	}
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
	secretDirectory string,
	run CommandRunner,
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
	if payload.Kind == "" {
		payload.Kind = "application"
	}
	if payload.Kind != "application" && payload.Kind != "database" {
		return nil, invalidSpec("invalid resource kind")
	}
	secretFiles, secretErr := materializeSecrets(payload, secrets, secretDirectory)
	if secretErr != nil {
		return nil, secretErr
	}
	args, err := createArgs(payload, secretFiles)
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

	if _, err := run(ctx, "docker", "pull", payload.Spec.Source.Reference); err != nil {
		return nil, commandError("image_pull_failed", err, true)
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
	return map[string]any{"externalId": containerID, "containerName": containerName}, nil
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

func createArgs(payload applicationPayload, secretFiles map[string]string) ([]string, error) {
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
	if len(message) > 500 {
		message = message[:500]
	}
	return &Error{Code: code, Message: message, Retryable: retryable}
}

func runCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func runCommandWithInput(
	ctx context.Context,
	input []byte,
	name string,
	args ...string,
) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Stdin = strings.NewReader(string(input))
	return command.CombinedOutput()
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
