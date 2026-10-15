package executor

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

func TestEnsureApplicationUsesStructuredDockerArguments(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"resourceId": "00000000-0000-4000-8000-000000000001",
		"name":       "example-app",
		"revision":   1,
		"spec": map[string]any{
			"source":           map[string]any{"type": "image", "reference": "ghcr.io/oc/app:1"},
			"limits":           map[string]any{"cpuMilli": 500, "memoryBytes": "536870912"},
			"ports":            []map[string]any{{"containerPort": 3000, "hostPort": 8080, "protocol": "tcp"}},
			"environment":      map[string]string{"NODE_ENV": "production"},
			"secretReferences": map[string]string{},
			"volumes":          []map[string]any{},
			"restartPolicy":    "unless-stopped",
		},
	})
	var commands [][]string
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		commands = append(commands, append([]string{name}, args...))
		if len(args) > 0 && args[0] == "inspect" {
			return []byte("Error: No such object"), errors.New("not found")
		}
		if len(args) > 0 && args[0] == "create" {
			return []byte("container-id\n"), nil
		}
		return []byte("ok"), nil
	}

	result, executionErr := ExecuteWith(context.Background(), controlplane.Operation{
		Action: "application.ensure", Payload: payload,
	}, run)
	if executionErr != nil {
		t.Fatalf("execute: %v", executionErr)
	}
	if result["externalId"] != "container-id" {
		t.Fatalf("unexpected result: %#v", result)
	}
	var create []string
	for _, command := range commands {
		if len(command) > 1 && command[1] == "create" {
			create = command
			break
		}
	}
	if create == nil {
		t.Fatalf("container create command is missing: %#v", commands)
	}
	if !slices.Contains(create, "oc.managed=true") || !slices.Contains(create, "NODE_ENV=production") {
		t.Fatalf("create args miss ownership or environment: %#v", create)
	}
	if !slices.Contains(create, "8080:3000/tcp") {
		t.Fatalf("create args miss published port: %#v", create)
	}
}

func TestEnsureApplicationRequiresResolvedSecretReferences(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"resourceId": "00000000-0000-4000-8000-000000000001",
		"name":       "example-app",
		"revision":   1,
		"spec": map[string]any{
			"source":           map[string]any{"type": "image", "reference": "ghcr.io/oc/app:1"},
			"limits":           map[string]any{"cpuMilli": 500, "memoryBytes": "536870912"},
			"secretReferences": map[string]string{"DATABASE_URL": "secret://database"},
		},
	})

	_, executionErr := executeWith(
		context.Background(),
		controlplane.Operation{Action: "application.ensure", Payload: payload},
		nil,
		t.TempDir(),
		func(context.Context, string, ...string) ([]byte, error) {
			t.Fatal("docker must not be called when a secret is unavailable")
			return nil, nil
		},
	)
	if executionErr == nil || executionErr.Code != "secret_unavailable" {
		t.Fatalf("expected secret_unavailable error, got %#v", executionErr)
	}
}

func TestEnsureApplicationMountsSecretsAsFilesWithoutExposingValues(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"resourceId": "00000000-0000-4000-8000-000000000001",
		"name":       "postgres-app",
		"revision":   1,
		"spec": map[string]any{
			"source":           map[string]any{"type": "image", "reference": "postgres:17-alpine"},
			"limits":           map[string]any{"cpuMilli": 500, "memoryBytes": "536870912"},
			"secretReferences": map[string]string{"POSTGRES_PASSWORD": "managed://secret@1"},
			"restartPolicy":    "unless-stopped",
		},
	})
	var commands [][]string
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		commands = append(commands, append([]string{name}, args...))
		if len(args) > 0 && args[0] == "inspect" {
			return []byte("Error: No such object"), errors.New("not found")
		}
		if len(args) > 0 && args[0] == "create" {
			return []byte("container-id\n"), nil
		}
		return []byte("ok"), nil
	}
	operation := controlplane.Operation{Action: "application.ensure", Payload: payload}
	result, executionErr := executeWith(
		context.Background(),
		operation,
		map[string]string{"POSTGRES_PASSWORD": "super-secret-value"},
		t.TempDir(),
		run,
	)
	if executionErr != nil {
		t.Fatalf("execute: %v", executionErr)
	}
	if result["externalId"] != "container-id" {
		t.Fatalf("unexpected result: %#v", result)
	}
	var create []string
	for _, command := range commands {
		if len(command) > 1 && command[1] == "create" {
			create = command
			break
		}
	}
	if create == nil {
		t.Fatalf("container create command is missing: %#v", commands)
	}
	joined := strings.Join(create, " ")
	if strings.Contains(joined, "super-secret-value") {
		t.Fatalf("secret value leaked to docker arguments: %s", joined)
	}
	if !strings.Contains(joined, "POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password") {
		t.Fatalf("secret file environment is missing: %s", joined)
	}
}

func TestRedeployPullsImageBeforeReplacingOwnedContainer(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"resourceId": "00000000-0000-4000-8000-000000000001",
		"name":       "example-app",
		"revision":   2,
		"spec": map[string]any{
			"source":           map[string]any{"type": "image", "reference": "nginx:alpine"},
			"limits":           map[string]any{"cpuMilli": 500, "memoryBytes": "536870912"},
			"ports":            []map[string]any{{"containerPort": 80, "hostPort": 8080, "protocol": "tcp"}},
			"environment":      map[string]string{},
			"secretReferences": map[string]string{},
			"volumes":          []map[string]any{},
			"restartPolicy":    "unless-stopped",
		},
	})
	var commands [][]string
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		command := append([]string{name}, args...)
		commands = append(commands, command)
		if len(args) > 2 && args[0] == "inspect" && args[2] == "{{.Id}}" {
			return []byte("old-container-id\n"), nil
		}
		if len(args) > 0 && args[0] == "inspect" {
			return []byte("00000000-0000-4000-8000-000000000001\n"), nil
		}
		if len(args) > 0 && args[0] == "create" {
			return []byte("new-container-id\n"), nil
		}
		return []byte("ok"), nil
	}

	result, executionErr := ExecuteWith(context.Background(), controlplane.Operation{
		Action: "application.redeploy", Payload: payload,
	}, run)
	if executionErr != nil {
		t.Fatalf("execute: %v", executionErr)
	}
	if result["externalId"] != "new-container-id" {
		t.Fatalf("unexpected result: %#v", result)
	}
	var pullIndex, removeIndex = -1, -1
	for index, command := range commands {
		if slices.Contains(command, "pull") {
			pullIndex = index
		}
		if slices.Contains(command, "rm") {
			removeIndex = index
		}
	}
	if pullIndex < 0 || removeIndex < 0 || pullIndex > removeIndex {
		t.Fatalf("image must be pulled before old container is removed: %#v", commands)
	}
}

func TestActivateDatabaseClusterRunsStructuredPostgresPreflight(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"clusterId":           "00000000-0000-4000-8000-000000000002",
		"resourceId":          "00000000-0000-4000-8000-000000000001",
		"adminDatabase":       "app",
		"provisionerUsername": "app",
	})
	var commands [][]string
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		commands = append(commands, append([]string{name}, args...))
		if len(args) > 0 && args[0] == "inspect" {
			return []byte("00000000-0000-4000-8000-000000000001\n"), nil
		}
		return []byte("accepting connections\n"), nil
	}

	result, executionErr := ExecuteWith(context.Background(), controlplane.Operation{
		Action: "database.cluster.activate", Payload: payload,
	}, run)
	if executionErr != nil {
		t.Fatalf("execute: %v", executionErr)
	}
	if result["ready"] != true {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(commands) != 2 || !slices.Contains(commands[1], "pg_isready") {
		t.Fatalf("expected structured pg_isready preflight: %#v", commands)
	}
}

func TestEnsureServiceDatabaseUsesStdinWithoutSecretArguments(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"allocationId":          "00000000-0000-4000-8000-000000000003",
		"clusterId":             "00000000-0000-4000-8000-000000000002",
		"resourceId":            "00000000-0000-4000-8000-000000000001",
		"applicationResourceId": "00000000-0000-4000-8000-000000000004",
		"adminDatabase":         "app",
		"provisionerUsername":   "app",
		"databaseName":          "oc_000000000000400080000000",
		"roleName":              "oc_000000000000400080000000_app",
		"connectionLimit":       20,
		"networkAlias":          "oc-db-00000000000040008000000000000002",
	})
	password := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
	var commands [][]string
	var sqlInput string
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		commands = append(commands, append([]string{name}, args...))
		if len(args) > 0 && args[0] == "inspect" {
			return []byte("00000000-0000-4000-8000-000000000001\n"), nil
		}
		return []byte("ok"), nil
	}
	runInput := func(_ context.Context, input []byte, name string, args ...string) ([]byte, error) {
		sqlInput = string(input)
		commands = append(commands, append([]string{name}, args...))
		return []byte("ok"), nil
	}

	result, executionErr := ExecuteWithInput(
		context.Background(),
		controlplane.Operation{Action: "database.service.ensure", Payload: payload},
		map[string]string{"DATABASE_PASSWORD": password},
		run,
		runInput,
	)
	if executionErr != nil {
		t.Fatalf("execute: %v", executionErr)
	}
	if result["ready"] != true || !strings.Contains(sqlInput, password) {
		t.Fatalf("database provisioning SQL was not sent through stdin: %#v", result)
	}
	for _, command := range commands {
		if strings.Contains(strings.Join(command, " "), password) {
			t.Fatalf("database password leaked to command arguments: %#v", command)
		}
	}
}
