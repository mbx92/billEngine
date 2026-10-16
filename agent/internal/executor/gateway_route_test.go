package executor

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

func TestGatewayRouteUsesFileProviderSupportedExtension(t *testing.T) {
	directory := t.TempDir()
	secretDirectory := filepath.Join(directory, "secrets")
	dynamicDirectory := filepath.Join(directory, "gateway", "dynamic")
	if err := os.MkdirAll(dynamicDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	routeID := "00000000-0000-4000-8000-000000000001"
	base := filepath.Join(dynamicDirectory, "route-00000000000040008000000000000001")
	if err := os.WriteFile(base+".json", []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{
		"routeId": routeID, "resourceId": "00000000-0000-4000-8000-000000000002",
		"hostname": "serene-book.example.test", "targetPort": 3000,
	})
	run := func(context.Context, string, ...string) ([]byte, error) { return []byte("OK"), nil }
	_, executionErr := configureRoute(context.Background(), controlplane.Operation{Payload: payload}, nil, secretDirectory, run)
	if executionErr != nil {
		t.Fatalf("configure route: %v", executionErr)
	}
	content, err := os.ReadFile(base + ".yaml")
	if err != nil {
		t.Fatal("Traefik does not load .json files from a configuration directory; .yaml is required")
	}
	var config map[string]any
	if err := json.Unmarshal(content, &config); err != nil {
		t.Fatal("JSON-form YAML must remain valid structured configuration")
	}
	if config["http"] == nil {
		t.Fatal("missing HTTP route configuration")
	}
	if _, exists := config["http"].(map[string]any)["middlewares"]; exists {
		t.Fatal("Traefik rejects an empty middleware map for internal applications")
	}
	if _, err := os.Stat(base + ".json"); !os.IsNotExist(err) {
		t.Fatal("obsolete generated JSON route was not removed")
	}
	_, executionErr = deleteRoute(context.Background(), controlplane.Operation{Payload: payload}, secretDirectory, run)
	if executionErr != nil {
		t.Fatalf("delete route: %v", executionErr)
	}
	if _, err := os.Stat(base + ".yaml"); !os.IsNotExist(err) {
		t.Fatal("YAML route was not removed")
	}
}
