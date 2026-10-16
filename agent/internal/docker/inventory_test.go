package docker

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestInventoryWithNormalizesManagedContainers(t *testing.T) {
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		return []byte(`{"ID":"abc123","Image":"ghcr.io/oc/app:1","Names":"customer-app","State":"running","Status":"Up 2 minutes","Labels":"oc.managed=true,oc.resource-id=00000000-0000-4000-8000-000000000001,oc.revision=7,other=ignored"}` + "\n"), nil
	}

	resources, err := InventoryWith(context.Background(), run)
	if err != nil {
		t.Fatalf("inventory: %v", err)
	}
	if len(resources) != 1 {
		t.Fatalf("expected one resource, got %d", len(resources))
	}
	resource := resources[0]
	if resource.State != "running" || resource.ObservedRevision != 7 {
		t.Fatalf("unexpected resource: %#v", resource)
	}
	if _, exists := resource.Labels["other"]; exists {
		t.Fatal("non-OC labels must not leave the agent")
	}
}

func TestImageInventoryWithMarksImagesUsedByAnyContainer(t *testing.T) {
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		command := strings.Join(args, " ")
		switch {
		case command == "image ls --all --no-trunc --quiet":
			return []byte("sha256:used\nsha256:unused\nsha256:used\n"), nil
		case command == "container ls --all --quiet":
			return []byte("container-one\n"), nil
		case strings.HasPrefix(command, "container inspect --format"):
			return []byte("sha256:used\n"), nil
		case strings.HasPrefix(command, "image inspect --format"):
			return []byte(
				`{"Id":"sha256:used","RepoTags":["oc-local/app:one"],"RepoDigests":[],"Size":1024,"Created":"2026-10-16T00:00:00Z"}` + "\n" +
					`{"Id":"sha256:unused","RepoTags":[],"RepoDigests":[],"Size":2048,"Created":"2026-10-15T00:00:00Z"}` + "\n",
			), nil
		default:
			return nil, fmt.Errorf("unexpected docker command: %s %s", name, command)
		}
	}

	images, err := ImageInventoryWith(context.Background(), run)
	if err != nil {
		t.Fatalf("image inventory: %v", err)
	}
	if len(images) != 2 {
		t.Fatalf("expected two unique images, got %d", len(images))
	}
	if !images[0].Used || images[0].ContainerCount != 1 {
		t.Fatalf("expected first image to be used: %#v", images[0])
	}
	if images[1].Used || images[1].ContainerCount != 0 {
		t.Fatalf("expected second image to be unused: %#v", images[1])
	}
}
