package executor

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

func TestLocalBuildLoadsImageWithoutPublishing(t *testing.T) {
	imageID := "sha256:" + strings.Repeat("a", 64)
	var commands [][]string
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		commands = append(commands, append([]string{name}, args...))
		if len(args) > 1 && args[0] == "image" && args[1] == "inspect" {
			return []byte(imageID + "\n"), nil
		}
		return []byte("build complete"), nil
	}
	payload := applicationBuildPayload{
		BuildID: "00000000-0000-4000-8000-000000000001", Version: "v1",
		ImageStorage: "local", ImageRepository: "oc-local/serene-book",
		RepositoryURL: "https://github.com/mbx92/serene-book",
	}
	result, executionErr := buildLocalApplicationImage(context.Background(), payload, t.TempDir(), "Dockerfile", ".", strings.Repeat("b", 40), run)
	if executionErr != nil {
		t.Fatalf("local build failed: %v", executionErr)
	}
	if result["imageReference"] != imageID || result["imageDigest"] != imageID {
		t.Fatalf("release must use the inspected image ID: %#v", result)
	}
	if !slices.Contains(commands[0], "--load") || !slices.Contains(commands[0], "default") {
		t.Fatalf("image must be loaded in the node Docker daemon: %#v", commands)
	}
	for _, command := range commands {
		for _, argument := range command {
			if argument == "--push" || argument == "login" || strings.Contains(argument, "type=registry") {
				t.Fatalf("local builds must not use a registry: %#v", command)
			}
		}
	}
}

func TestLocalBuildRejectsMissingImageID(t *testing.T) {
	_, executionErr := buildLocalApplicationImage(context.Background(), applicationBuildPayload{
		ImageRepository: "oc-local/example", BuildID: "00000000-0000-4000-8000-000000000001",
	}, t.TempDir(), "Dockerfile", ".", strings.Repeat("b", 40), func(context.Context, string, ...string) ([]byte, error) {
		return []byte("not-an-image-id"), nil
	})
	if executionErr == nil || executionErr.Code != "image_digest_invalid" {
		t.Fatalf("invalid local image IDs must not become releases: %#v", executionErr)
	}
}

func TestEnvironmentSecretsUsePrivateTemporaryFile(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"resourceId": "00000000-0000-4000-8000-000000000001", "name": "example-app", "revision": 1,
		"spec": map[string]any{
			"source":         map[string]any{"type": "image", "reference": "example:1"},
			"limits":         map[string]any{"cpuMilli": 500, "memoryBytes": "536870912"},
			"secretDelivery": "environment", "secretReferences": map[string]string{"SESSION_SECRET": "managed://test@1"},
			"restartPolicy": "unless-stopped",
		},
	})
	secret := "private-session-secret-with-equals=and$dollars"
	envPath := ""
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		if strings.Contains(strings.Join(args, " "), secret) {
			t.Fatal("secret leaked into command arguments")
		}
		if len(args) > 0 && args[0] == "inspect" {
			return []byte("No such object"), errors.New("not found")
		}
		if len(args) > 0 && args[0] == "create" {
			index := slices.Index(args, "--env-file")
			if index < 0 || index+1 >= len(args) {
				t.Fatal("missing secret env file")
			}
			envPath = args[index+1]
			content, err := os.ReadFile(envPath)
			if err != nil || string(content) != "SESSION_SECRET="+secret+"\n" {
				t.Fatal("secret was not delivered intact")
			}
			info, err := os.Stat(envPath)
			if err != nil || info.Mode().Perm() != 0o600 {
				t.Fatal("secret env file must be private")
			}
			if slices.Contains(args, "SESSION_SECRET_FILE=/run/secrets/session_secret") {
				t.Fatal("env delivery must not inject FILE variables")
			}
		}
		return []byte("ok"), nil
	}
	_, executionErr := executeWith(context.Background(), controlplane.Operation{Action: "application.ensure", Payload: payload}, map[string]string{"SESSION_SECRET": secret}, t.TempDir(), run)
	if executionErr != nil {
		t.Fatalf("env deployment: %v", executionErr)
	}
	if envPath == "" {
		t.Fatal("container was not created")
	}
	if _, err := os.Stat(envPath); !os.IsNotExist(err) {
		t.Fatal("temporary env file was not removed")
	}
}

func TestEnvironmentSecretsRejectMultilineValues(t *testing.T) {
	payload := applicationPayload{ResourceID: "00000000-0000-4000-8000-000000000001"}
	payload.Spec.SecretReferences = map[string]string{"SESSION_SECRET": "managed://test@1"}
	_, executionErr := materializeSecretEnvironment(payload, map[string]string{"SESSION_SECRET": "secret\nINJECTED_KEY=value"}, t.TempDir())
	if executionErr == nil || executionErr.Code != "invalid_spec" {
		t.Fatal("env file injection must be rejected")
	}
}

func TestLocalDeploymentRejectsDifferentOriginNode(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"resourceId": "00000000-0000-4000-8000-000000000001", "name": "example-app",
		"spec": map[string]any{"source": map[string]any{
			"type": "image", "reference": "sha256:" + strings.Repeat("a", 64),
			"pullPolicy": "never", "nodeId": "00000000-0000-4000-8000-000000000002",
		}},
	})
	_, executionErr := ExecuteWith(context.Background(), controlplane.Operation{
		NodeID: "00000000-0000-4000-8000-000000000001", Action: "application.ensure", Payload: payload,
	}, func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("wrong-node deployment must not execute Docker commands")
		return nil, nil
	})
	if executionErr == nil || executionErr.Code != "invalid_spec" {
		t.Fatal("expected origin-node rejection")
	}
}

func TestLocalRedeployNeverPullsAndPreservesContainerWhenImageMissing(t *testing.T) {
	for _, imagePresent := range []bool{true, false} {
		t.Run(map[bool]string{true: "present", false: "missing"}[imagePresent], func(t *testing.T) {
			resourceID := "00000000-0000-4000-8000-000000000001"
			imageID := "sha256:" + strings.Repeat("a", 64)
			payload, _ := json.Marshal(map[string]any{
				"resourceId": resourceID, "name": "example-app", "revision": 2,
				"spec": map[string]any{
					"source":        map[string]any{"type": "image", "reference": imageID, "pullPolicy": "never", "nodeId": resourceID},
					"limits":        map[string]any{"cpuMilli": 500, "memoryBytes": "536870912"},
					"restartPolicy": "unless-stopped",
				},
			})
			var commands [][]string
			run := func(_ context.Context, name string, args ...string) ([]byte, error) {
				commands = append(commands, append([]string{name}, args...))
				if len(args) > 1 && args[0] == "image" && args[1] == "inspect" {
					if !imagePresent {
						return nil, errors.New("image not found")
					}
					return []byte(imageID + "\n"), nil
				}
				if len(args) > 2 && args[0] == "inspect" {
					if args[2] == "{{.Id}}" {
						return []byte("old-container"), nil
					}
					return []byte(resourceID), nil
				}
				return []byte("ok"), nil
			}
			_, executionErr := executeWith(context.Background(), controlplane.Operation{NodeID: resourceID, Action: "application.redeploy", Payload: payload}, nil, t.TempDir(), run)
			if imagePresent && executionErr != nil {
				t.Fatalf("local redeploy failed: %v", executionErr)
			}
			if !imagePresent && (executionErr == nil || executionErr.Code != "local_image_missing") {
				t.Fatalf("expected local_image_missing: %#v", executionErr)
			}
			created := false
			for _, command := range commands {
				if slices.Contains(command, "pull") || slices.Contains(command, "login") {
					t.Fatalf("local deployment must never contact a registry: %#v", command)
				}
				if !imagePresent && (slices.Contains(command, "rm") || slices.Contains(command, "create") || slices.Contains(command, "start")) {
					t.Fatalf("missing image must preserve the old container: %#v", command)
				}
				if len(command) > 1 && command[1] == "create" {
					created = true
					if !slices.Contains(command, "--pull=never") || !slices.Contains(command, imageID) {
						t.Fatalf("container must use the immutable local ID with pulls disabled: %#v", command)
					}
				}
			}
			if imagePresent && !created {
				t.Fatal("existing local image should create a container")
			}
		})
	}
}
