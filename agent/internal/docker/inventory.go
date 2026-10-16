package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
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

type Image struct {
	ID             string   `json:"id"`
	References     []string `json:"references"`
	SizeBytes      string   `json:"sizeBytes"`
	CreatedAt      string   `json:"createdAt"`
	Used           bool     `json:"used"`
	ContainerCount int      `json:"containerCount"`
}

type imageInspect struct {
	ID          string   `json:"Id"`
	RepoTags    []string `json:"RepoTags"`
	RepoDigests []string `json:"RepoDigests"`
	Size        int64    `json:"Size"`
	Created     string   `json:"Created"`
}

const maxInventoryImages = 1000

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

func ImageInventory(ctx context.Context) ([]Image, error) {
	return ImageInventoryWith(ctx, runCommand)
}

func ImageInventoryWith(ctx context.Context, run CommandRunner) ([]Image, error) {
	imageOutput, err := run(ctx, "docker", "image", "ls", "--all", "--no-trunc", "--quiet")
	if err != nil {
		return nil, fmt.Errorf("list docker images: %w", err)
	}

	imageIDs := uniqueNonEmptyLines(imageOutput, maxInventoryImages)
	if len(imageIDs) == 0 {
		return []Image{}, nil
	}

	containerOutput, err := run(ctx, "docker", "container", "ls", "--all", "--quiet")
	if err != nil {
		return nil, fmt.Errorf("list docker containers for image usage: %w", err)
	}
	containerIDs := uniqueNonEmptyLines(containerOutput, 0)
	containerCountByImage := make(map[string]int)
	if len(containerIDs) > 0 {
		args := append([]string{"container", "inspect", "--format", "{{.Image}}"}, containerIDs...)
		usedImageOutput, inspectErr := run(ctx, "docker", args...)
		if inspectErr != nil {
			return nil, fmt.Errorf("inspect docker container images: %w", inspectErr)
		}
		for _, imageID := range strings.Split(strings.TrimSpace(string(usedImageOutput)), "\n") {
			imageID = strings.TrimSpace(imageID)
			if imageID != "" {
				containerCountByImage[imageID]++
			}
		}
	}

	args := append([]string{"image", "inspect", "--format", "{{json .}}"}, imageIDs...)
	inspectOutput, err := run(ctx, "docker", args...)
	if err != nil {
		return nil, fmt.Errorf("inspect docker images: %w", err)
	}

	images := make([]Image, 0, len(imageIDs))
	for _, line := range strings.Split(strings.TrimSpace(string(inspectOutput)), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var inspected imageInspect
		if err := json.Unmarshal([]byte(line), &inspected); err != nil {
			return nil, fmt.Errorf("decode docker image inventory: %w", err)
		}
		references := uniqueReferences(append(inspected.RepoTags, inspected.RepoDigests...))
		containerCount := containerCountByImage[inspected.ID]
		images = append(images, Image{
			ID:             inspected.ID,
			References:     references,
			SizeBytes:      strconv.FormatInt(inspected.Size, 10),
			CreatedAt:      inspected.Created,
			Used:           containerCount > 0,
			ContainerCount: containerCount,
		})
	}
	return images, nil
}

func uniqueNonEmptyLines(output []byte, limit int) []string {
	seen := make(map[string]struct{})
	values := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		value := strings.TrimSpace(line)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
		if limit > 0 && len(values) >= limit {
			break
		}
	}
	return values
}

func uniqueReferences(values []string) []string {
	seen := make(map[string]struct{})
	references := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == "<none>:<none>" || value == "<none>@<none>" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		references = append(references, value)
		if len(references) >= 100 {
			break
		}
	}
	sort.Strings(references)
	return references
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
	case healthState == "unhealthy":
		gateway.Status = "failed"
		gateway.Error = "oc-gateway health check is unhealthy"
		healthLog, healthLogErr := runCommand(
			ctx,
			"docker",
			"inspect",
			"--format",
			"{{if .State.Health}}{{range .State.Health.Log}}{{.Output}}{{end}}{{end}}",
			"oc-gateway",
		)
		if healthLogErr == nil {
			detail := strings.Join(strings.Fields(string(healthLog)), " ")
			if len(detail) > 500 {
				detail = detail[len(detail)-500:]
			}
			if detail != "" {
				gateway.Error += ": " + detail
			}
		}
	case containerState == "running":
		gateway.Status = "unknown"
		gateway.Error = "oc-gateway has no Docker health status"
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
