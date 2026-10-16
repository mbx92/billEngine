package platform

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
)

type Usage struct {
	CPUUsageBasisPoints  *int   `json:"cpuUsageBasisPoints,omitempty"`
	MemoryUsedBytes      string `json:"memoryUsedBytes"`
	DiskUsedBytes        string `json:"diskUsedBytes"`
	DiskUsageBasisPoints int    `json:"diskUsageBasisPoints"`
}

type UsageSampler struct {
	mu        sync.Mutex
	lastTotal uint64
	lastIdle  uint64
}

func (s *UsageSampler) Sample(ctx context.Context) (Usage, error) {
	total, idle, err := readCPUStat()
	if err != nil {
		return Usage{}, err
	}
	memoryUsed, err := readMemoryUsedBytes()
	if err != nil {
		return Usage{}, err
	}
	diskUsed, diskBasisPoints, err := readDiskUsage(ctx, runCommand)
	if err != nil {
		return Usage{}, err
	}

	s.mu.Lock()
	var cpu *int
	if s.lastTotal > 0 && total > s.lastTotal && idle >= s.lastIdle {
		deltaTotal := total - s.lastTotal
		deltaIdle := idle - s.lastIdle
		if deltaIdle <= deltaTotal {
			value := int((deltaTotal - deltaIdle) * 10_000 / deltaTotal)
			cpu = &value
		}
	}
	s.lastTotal, s.lastIdle = total, idle
	s.mu.Unlock()

	return Usage{
		CPUUsageBasisPoints:  cpu,
		MemoryUsedBytes:      memoryUsed,
		DiskUsedBytes:        diskUsed,
		DiskUsageBasisPoints: diskBasisPoints,
	}, nil
}

func readCPUStat() (uint64, uint64, error) {
	contents, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, fmt.Errorf("read CPU usage: %w", err)
	}
	line, _, _ := strings.Cut(string(contents), "\n")
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, errors.New("unexpected /proc/stat CPU row")
	}
	var values []uint64
	for _, field := range fields[1:] {
		value, parseErr := strconv.ParseUint(field, 10, 64)
		if parseErr != nil {
			return 0, 0, fmt.Errorf("parse CPU usage: %w", parseErr)
		}
		values = append(values, value)
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return total, idle, nil
}

func readMemoryUsedBytes() (string, error) {
	contents, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return "", fmt.Errorf("read memory usage: %w", err)
	}
	var total, available uint64
	scanner := bufio.NewScanner(strings.NewReader(string(contents)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, parseErr := strconv.ParseUint(fields[1], 10, 64)
		if parseErr != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = value * 1024
		case "MemAvailable:":
			available = value * 1024
		}
	}
	if total == 0 || available > total {
		return "", errors.New("memory usage is missing from /proc/meminfo")
	}
	return strconv.FormatUint(total-available, 10), nil
}

func readDiskUsage(ctx context.Context, run CommandRunner) (string, int, error) {
	output, err := run(ctx, "df", "-B1", "--output=size,used", "/")
	if err != nil {
		return "", 0, fmt.Errorf("read disk usage: %w", err)
	}
	fields := strings.Fields(string(output))
	if len(fields) < 4 {
		return "", 0, errors.New("unexpected disk usage output")
	}
	total, totalErr := strconv.ParseUint(fields[len(fields)-2], 10, 64)
	used, usedErr := strconv.ParseUint(fields[len(fields)-1], 10, 64)
	if totalErr != nil || usedErr != nil || total == 0 || used > total {
		return "", 0, errors.New("invalid disk usage output")
	}
	return strconv.FormatUint(used, 10), int(used * 10_000 / total), nil
}
