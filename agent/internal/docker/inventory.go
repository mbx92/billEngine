package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

type CommandRunner func(ctx context.Context, name string, args ...string) ([]byte, error)

type Resource struct {
	ResourceID       string            `json:"resourceId,omitempty"`
	ExternalID       string            `json:"externalId"`
	Kind             string            `json:"kind"`
	Name             string            `json:"name"`
	State            string            `json:"state"`
	ObservedRevision int               `json:"observedRevision"`
	ImageReference   string            `json:"imageReference,omitempty"`
	Labels           map[string]string `json:"labels"`
	Snapshot         map[string]any    `json:"snapshot"`
}

type Gateway struct {
	Status      string `json:"status"`
	Image       string `json:"image,omitempty"`
	ContainerID string `json:"containerId,omitempty"`
	Error       string `json:"error,omitempty"`
}

type containerRow struct {
	ID     string `json:"ID"`
	Image  string `json:"Image"`
	Names  string `json:"Names"`
	State  string `json:"State"`
	Status string `json:"Status"`
	Labels string `json:"Labels"`
	Ports  string `json:"Ports"`
}

func Inventory(ctx context.Context) ([]Resource, error) {
	return InventoryWith(ctx, runCommand)
}

func InspectGateway(ctx context.Context) Gateway {
	output, err := runCommand(
		ctx,
		"docker",
		"inspect",
		"--format",
		"{{.Id}}\t{{.Config.Image}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{end}}",
		"oc-gateway",
	)
	if err != nil {
		return Gateway{Status: "unknown", Error: "oc-gateway container was not found"}
	}
	parts := strings.Split(strings.TrimSpace(string(output)), "\t")
	if len(parts) < 3 {
		return Gateway{Status: "unknown", Error: "oc-gateway state could not be inspected"}
	}
	gateway := Gateway{ContainerID: parts[0], Image: parts[1]}
	containerState := parts[2]
	healthState := ""
	if len(parts) > 3 {
		healthState = parts[3]
	}
	switch {
	case containerState == "running" && healthState == "healthy":
		gateway.Status = "healthy"
	case containerState == "created" || containerState == "restarting" || healthState == "starting":
		gateway.Status = "installing"
	case containerState == "running":
		gateway.Status = "unknown"
		gateway.Error = "oc-gateway health status is unavailable"
	default:
		gateway.Status = "failed"
		gateway.Error = "oc-gateway container is " + containerState
	}
	return gateway
}

func InventoryWith(ctx context.Context, run CommandRunner) ([]Resource, error) {
	output, err := run(
		ctx,
		"docker",
		"ps",
		"--all",
		"--filter",
		"label=oc.managed=true",
		"--format",
		"{{json .}}",
	)
	if err != nil {
		return nil, fmt.Errorf("list managed containers: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	resources := make([]Resource, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var row containerRow
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return nil, fmt.Errorf("decode docker inventory: %w", err)
		}
		labels := parseLabels(row.Labels)
		if labels["oc.component"] != "" || labels["oc.resource-id"] == "" {
			continue
		}
		revision, _ := strconv.Atoi(labels["oc.revision"])
		kind := labels["oc.kind"]
		if kind != "database" {
			kind = "application"
		}
		resources = append(resources, Resource{
			ResourceID:       labels["oc.resource-id"],
			ExternalID:       row.ID,
			Kind:             kind,
			Name:             row.Names,
			State:            normalizeState(row.State),
			ObservedRevision: revision,
			ImageReference:   row.Image,
			Labels:           labels,
			Snapshot: map[string]any{
				"containerId": row.ID,
				"status":      row.Status,
				"ports":       row.Ports,
			},
		})
	}
	return resources, nil
}

func normalizeState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "running":
		return "running"
	case "exited", "dead", "created":
		return "stopped"
	case "restarting":
		return "restarting"
	case "removing":
		return "deleting"
	case "paused":
		return "degraded"
	default:
		return "unknown"
	}
}

func parseLabels(value string) map[string]string {
	labels := make(map[string]string)
	for _, item := range strings.Split(value, ",") {
		key, labelValue, ok := strings.Cut(strings.TrimSpace(item), "=")
		if ok && key != "" && strings.HasPrefix(key, "oc.") {
			labels[key] = labelValue
		}
	}
	return labels
}

func runCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}
