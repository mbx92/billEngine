package executor

import (
	"context"
	"encoding/json"
	"time"
)

// Docker start only acknowledges process creation. Wait for the configured
// healthcheck; without one, require a stable running process on two samples.
func waitApplicationReady(ctx context.Context, name string, run CommandRunner) *Error {
	readyCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	stable := 0
	for {
		output, err := run(readyCtx, "docker", "inspect", "--format", "{{json .State}}", name)
		if err != nil {
			return commandError("readiness_inspect_failed", err, true)
		}
		var state struct {
			Running bool `json:"Running"`
			Health  *struct {
				Status string `json:"Status"`
			} `json:"Health"`
		}
		if err := json.Unmarshal(output, &state); err != nil {
			return commandError("readiness_invalid", err, false)
		}
		if !state.Running {
			return &Error{Code: "application_not_running", Message: "Application exited before readiness", Retryable: false}
		}
		if state.Health != nil && state.Health.Status == "healthy" {
			return nil
		}
		if state.Health != nil && state.Health.Status == "unhealthy" {
			return &Error{Code: "application_unhealthy", Message: "Application healthcheck failed", Retryable: false}
		}
		if state.Health == nil {
			stable++
			if stable >= 2 {
				return nil
			}
		}
		select {
		case <-readyCtx.Done():
			return &Error{Code: "application_readiness_timeout", Message: "Application did not become ready before its deadline", Retryable: false}
		case <-time.After(2 * time.Second):
		}
	}
}
