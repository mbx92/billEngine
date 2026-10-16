package platform

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

type CommandRunner func(ctx context.Context, name string, args ...string) ([]byte, error)

type HostInfo struct {
	OSRelease      string   `json:"osRelease"`
	Architecture   string   `json:"architecture"`
	DockerVersion  string   `json:"dockerVersion"`
	ComposeVersion string   `json:"composeVersion"`
	Capacity       Capacity `json:"capacity"`
}

type Capacity struct {
	CPUMilli    int    `json:"cpuMilli"`
	MemoryBytes string `json:"memoryBytes"`
	DiskBytes   string `json:"diskBytes"`
}

func DetectCapabilities(ctx context.Context) []string {
	capabilities := []string{"container-runtime"}
	if _, err := commandVersion(ctx, runCommand, "git", "--version"); err != nil {
		return capabilities
	}
	if _, err := commandVersion(ctx, runCommand, "docker", "buildx", "version"); err == nil {
		capabilities = append(capabilities, "image-build")
	}
	return capabilities
}

func Inspect(ctx context.Context) (HostInfo, error) {
	osRelease, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return HostInfo{}, fmt.Errorf("read /etc/os-release: %w", err)
	}
	return InspectWith(ctx, osRelease, runCommand, runtime.GOARCH, runtime.NumCPU())
}

func InspectWith(
	ctx context.Context,
	osRelease []byte,
	run CommandRunner,
	architecture string,
	cpuCount int,
) (HostInfo, error) {
	fields := parseOSRelease(string(osRelease))
	if !strings.EqualFold(fields["ID"], "ubuntu") {
		return HostInfo{}, errors.New("unsupported host: OC Agent requires Ubuntu Server")
	}

	dockerVersion, err := commandVersion(ctx, run, "docker", "--version")
	if err != nil {
		return HostInfo{}, fmt.Errorf("docker preflight failed: %w", err)
	}
	composeVersion, err := commandVersion(ctx, run, "docker", "compose", "version")
	if err != nil {
		return HostInfo{}, fmt.Errorf("docker compose preflight failed: %w", err)
	}
	memoryBytes, err := readMemoryBytes()
	if err != nil {
		return HostInfo{}, err
	}
	diskBytes, err := readDiskBytes(ctx, run)
	if err != nil {
		return HostInfo{}, err
	}

	release := fields["PRETTY_NAME"]
	if release == "" {
		release = "Ubuntu"
	}
	return HostInfo{
		OSRelease:      release,
		Architecture:   architecture,
		DockerVersion:  dockerVersion,
		ComposeVersion: composeVersion,
		Capacity: Capacity{
			CPUMilli:    cpuCount * 1000,
			MemoryBytes: memoryBytes,
			DiskBytes:   diskBytes,
		},
	}, nil
}

func parseOSRelease(value string) map[string]string {
	fields := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(value))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, raw, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		fields[key] = strings.Trim(strings.TrimSpace(raw), "\"")
	}
	return fields
}

func commandVersion(ctx context.Context, run CommandRunner, name string, args ...string) (string, error) {
	output, err := run(ctx, name, args...)
	if err != nil {
		return "", err
	}
	value := strings.TrimSpace(string(output))
	if value == "" {
		return "", errors.New("empty version output")
	}
	return value, nil
}

func readMemoryBytes() (string, error) {
	contents, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return "", fmt.Errorf("read memory capacity: %w", err)
	}
	for _, line := range strings.Split(string(contents), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			kilobytes, parseErr := strconv.ParseUint(fields[1], 10, 64)
			if parseErr != nil {
				return "", fmt.Errorf("parse memory capacity: %w", parseErr)
			}
			return strconv.FormatUint(kilobytes*1024, 10), nil
		}
	}
	return "", errors.New("MemTotal is missing from /proc/meminfo")
}

func readDiskBytes(ctx context.Context, run CommandRunner) (string, error) {
	output, err := run(ctx, "df", "-B1", "--output=size", "/")
	if err != nil {
		return "", fmt.Errorf("read disk capacity: %w", err)
	}
	fields := strings.Fields(string(output))
	if len(fields) < 2 {
		return "", errors.New("unexpected df output")
	}
	value := fields[len(fields)-1]
	if _, err := strconv.ParseUint(value, 10, 64); err != nil {
		return "", fmt.Errorf("parse disk capacity: %w", err)
	}
	return value, nil
}

func runCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}
