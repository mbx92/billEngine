package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

const testDeleteImageID = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestDeleteImageRejectsContainerReference(t *testing.T) {
	payload, _ := json.Marshal(imageDeletePayload{ImageID: testDeleteImageID})
	removeCalled := false
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		command := strings.Join(args, " ")
		switch {
		case strings.HasPrefix(command, "image inspect"):
			return []byte(`{"Id":"` + testDeleteImageID + `","RepoTags":["oc-local/app:one"]}`), nil
		case command == "container ls --all --quiet":
			return []byte("container-one\n"), nil
		case strings.HasPrefix(command, "container inspect"):
			return []byte(testDeleteImageID + "\n"), nil
		case strings.HasPrefix(command, "image rm"):
			removeCalled = true
			return nil, nil
		default:
			return nil, fmt.Errorf("unexpected command: %s", command)
		}
	}

	_, executionErr := ExecuteWith(context.Background(), controlplane.Operation{
		Action:  "image.delete",
		Payload: payload,
	}, run)
	if executionErr == nil || executionErr.Code != "image_in_use" {
		t.Fatalf("expected image_in_use, got %#v", executionErr)
	}
	if removeCalled {
		t.Fatal("used image must not be removed")
	}
}

func TestDeleteImageRemovesAllLocalTagsWithoutForce(t *testing.T) {
	payload, _ := json.Marshal(imageDeletePayload{ImageID: testDeleteImageID})
	var removeCommand string
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		command := strings.Join(args, " ")
		switch {
		case strings.HasPrefix(command, "image inspect"):
			return []byte(`{"Id":"` + testDeleteImageID + `","RepoTags":["oc-local/app:one","oc-local/app:latest"]}`), nil
		case command == "container ls --all --quiet":
			return []byte{}, nil
		case strings.HasPrefix(command, "image rm"):
			removeCommand = command
			return []byte("Deleted: " + testDeleteImageID), nil
		default:
			return nil, fmt.Errorf("unexpected command: %s", command)
		}
	}

	result, executionErr := ExecuteWith(context.Background(), controlplane.Operation{
		Action:  "image.delete",
		Payload: payload,
	}, run)
	if executionErr != nil {
		t.Fatalf("delete image: %v", executionErr)
	}
	if result["deleted"] != true {
		t.Fatalf("unexpected result: %#v", result)
	}
	if removeCommand != "image rm oc-local/app:one oc-local/app:latest" {
		t.Fatalf("unexpected remove command: %q", removeCommand)
	}
	if strings.Contains(removeCommand, "--force") {
		t.Fatal("image deletion must not use --force")
	}
}
