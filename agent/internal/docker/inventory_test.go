package docker

import (
	"context"
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
