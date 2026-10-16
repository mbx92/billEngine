package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mbx92/billEngine/agent/internal/platform"
)

func TestEnrollAndHeartbeat(t *testing.T) {
	t.Helper()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/infrastructure/agent/enroll":
			if request.Header.Get("Authorization") != "" {
				t.Fatal("enrollment must not send agent authorization")
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"data": map[string]string{
				"nodeId": "node-1", "nodeName": "staging-01", "environment": "staging",
				"credential": "oc_agent_secret", "protocolVersion": ProtocolVersion,
			}})
		case "/api/infrastructure/agent/heartbeat":
			if request.Header.Get("Authorization") != "Bearer oc_agent_secret" {
				t.Fatal("heartbeat credential is missing")
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"data": map[string]string{
				"role": "hybrid",
			}})
		case "/api/infrastructure/agent/inventory":
			if request.Header.Get("Authorization") != "Bearer oc_agent_secret" {
				t.Fatal("inventory credential is missing")
			}
			response.WriteHeader(http.StatusOK)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(server.URL, server.Client())
	identity, err := client.Enroll(context.Background(), EnrollmentRequest{
		Token: "token", AgentVersion: "0.1.0", ProtocolVersion: ProtocolVersion,
		OSRelease: "Ubuntu 24.04 LTS", Architecture: "amd64",
		DockerVersion: "28", ComposeVersion: "2.39",
	})
	if err != nil {
		t.Fatalf("enroll: %v", err)
	}
	if identity.Credential != "oc_agent_secret" {
		t.Fatalf("unexpected credential: %q", identity.Credential)
	}
	heartbeat, err := client.Heartbeat(context.Background(), identity.Credential, HeartbeatRequest{
		AgentVersion: "0.1.0", ProtocolVersion: ProtocolVersion,
		OSRelease: "Ubuntu 24.04 LTS", Architecture: "amd64",
		DockerVersion: "28", ComposeVersion: "2.39",
		Capacity: platform.Capacity{CPUMilli: 4000, MemoryBytes: "1024", DiskBytes: "2048"},
	})
	if err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	if heartbeat.Role != "hybrid" {
		t.Fatalf("unexpected heartbeat role: %q", heartbeat.Role)
	}
	if err := client.Inventory(context.Background(), identity.Credential, InventoryRequest{}); err != nil {
		t.Fatalf("inventory: %v", err)
	}
	if requests != 3 {
		t.Fatalf("expected 3 requests, got %d", requests)
	}
}
