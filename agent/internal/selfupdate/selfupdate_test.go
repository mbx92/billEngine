package selfupdate

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestReadResult(t *testing.T) {
	directory := t.TempDir()
	contents := []byte(`{"operationId":"00000000-0000-4000-8000-000000000001","status":"succeeded","previousVersion":"0.8.0","currentVersion":"0.9.0"}`)
	if err := os.WriteFile(filepath.Join(directory, "result.json"), contents, 0o600); err != nil {
		t.Fatalf("write result: %v", err)
	}

	result, err := ReadResult(directory)
	if err != nil {
		t.Fatalf("read result: %v", err)
	}
	if result.OperationID != "00000000-0000-4000-8000-000000000001" || result.CurrentVersion != "0.9.0" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestReadResultRejectsInvalidStatus(t *testing.T) {
	directory := t.TempDir()
	contents := []byte(`{"operationId":"00000000-0000-4000-8000-000000000001","status":"running"}`)
	if err := os.WriteFile(filepath.Join(directory, "result.json"), contents, 0o600); err != nil {
		t.Fatalf("write result: %v", err)
	}

	if _, err := ReadResult(directory); err == nil {
		t.Fatal("expected invalid update result to be rejected")
	}
}

func TestReadResultMissing(t *testing.T) {
	_, err := ReadResult(t.TempDir())
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected os.ErrNotExist, got %v", err)
	}
}
