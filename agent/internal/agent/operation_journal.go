package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

// One operation executes at a time. Persist its intent before running it, then
// persist its result before reporting it. Never replay an unknown side effect.
type operationJournal struct {
	NodeID       string                               `json:"nodeId"`
	OperationID  string                               `json:"operationId"`
	AttemptCount int                                  `json:"attemptCount"`
	Result       *controlplane.OperationStatusRequest `json:"result,omitempty"`
}

func writeOperationJournal(path string, entry operationJournal) error {
	contents, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".operation-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(contents); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(file.Name(), path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func flushOperationJournal(ctx context.Context, path string, client *controlplane.Client, identity controlplane.Identity) error {
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var entry operationJournal
	if err := json.Unmarshal(contents, &entry); err != nil {
		return err
	}
	if entry.NodeID != identity.NodeID || entry.OperationID == "" || entry.AttemptCount < 1 {
		return errors.New("operation journal identity is invalid")
	}
	if entry.Result == nil {
		entry.Result = &controlplane.OperationStatusRequest{
			Status: "failed", AttemptCount: entry.AttemptCount,
			ErrorCode:    "execution_interrupted",
			ErrorMessage: "Agent restarted before a durable execution result; inspect the resource before retrying",
		}
		if err := writeOperationJournal(path, entry); err != nil {
			return err
		}
	}
	if err := client.UpdateOperation(ctx, identity.Credential, entry.OperationID, *entry.Result); err != nil {
		var response *controlplane.HTTPError
		// A cancelled/superseded attempt cannot be applied. Transient errors,
		// authentication errors and malformed requests retain the journal.
		if !errors.As(err, &response) || response.StatusCode != 409 {
			return fmt.Errorf("report durable result: %w", err)
		}
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
