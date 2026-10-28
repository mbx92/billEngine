package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

func TestJournalRetainsSuccessUntilControlPlaneAcknowledges(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("agent durability uses Linux directory fsync")
	}
	path := filepath.Join(t.TempDir(), "operation.json")
	entry := operationJournal{NodeID: "node", OperationID: "operation", AttemptCount: 1,
		Result: &controlplane.OperationStatusRequest{Status: "succeeded", AttemptCount: 1, Result: map[string]any{"externalId": "container"}}}
	if err := writeOperationJournal(path, entry); err != nil {
		t.Fatal(err)
	}
	accept := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var result controlplane.OperationStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
			t.Error(err)
		}
		if result.Status != "succeeded" || result.AttemptCount != 1 {
			t.Errorf("unexpected result: %#v", result)
		}
		if !accept {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	}))
	defer server.Close()
	client := controlplane.New(server.URL, server.Client())
	identity := controlplane.Identity{NodeID: "node", Credential: "dummy"}
	if err := flushOperationJournal(context.Background(), path, client, identity); err == nil {
		t.Fatal("expected delivery failure")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("result was lost", err)
	}
	accept = true
	if err := flushOperationJournal(context.Background(), path, client, identity); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("acknowledged result should be removed")
	}
}

func TestJournalReportsUnknownExecutionAsInterruptedWithoutReexecuting(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("agent durability uses Linux directory fsync")
	}
	path := filepath.Join(t.TempDir(), "operation.json")
	if err := writeOperationJournal(path, operationJournal{NodeID: "node", OperationID: "operation", AttemptCount: 2}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var result controlplane.OperationStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
			t.Error(err)
		}
		if result.ErrorCode != "execution_interrupted" || result.Retryable || result.AttemptCount != 2 {
			t.Errorf("unsafe recovery: %#v", result)
		}
		w.WriteHeader(200)
	}))
	defer server.Close()
	if err := flushOperationJournal(context.Background(), path, controlplane.New(server.URL, server.Client()), controlplane.Identity{NodeID: "node"}); err != nil {
		t.Fatal(err)
	}
}
