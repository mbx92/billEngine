package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultStateFile = "/var/lib/oc-agent/identity.json"
const defaultSecretDirectory = "/var/lib/oc-agent/secrets"

type Config struct {
	ControlPlaneURL   string
	EnrollmentToken   string
	StateFile         string
	SecretDirectory   string
	AllowInsecureHTTP bool
	HeartbeatEvery    time.Duration
	OperationEvery    time.Duration
	RequestTimeout    time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		ControlPlaneURL:   strings.TrimRight(strings.TrimSpace(os.Getenv("OC_CONTROL_PLANE_URL")), "/"),
		EnrollmentToken:   strings.TrimSpace(os.Getenv("OC_ENROLLMENT_TOKEN")),
		StateFile:         valueOrDefault("OC_AGENT_STATE_FILE", defaultStateFile),
		SecretDirectory:   valueOrDefault("OC_AGENT_SECRET_DIRECTORY", defaultSecretDirectory),
		AllowInsecureHTTP: strings.EqualFold(strings.TrimSpace(os.Getenv("OC_ALLOW_INSECURE_HTTP")), "true"),
		HeartbeatEvery:    durationSeconds("OC_HEARTBEAT_SECONDS", 30),
		OperationEvery:    durationSeconds("OC_OPERATION_POLL_SECONDS", 2),
		RequestTimeout:    durationSeconds("OC_REQUEST_TIMEOUT_SECONDS", 15),
	}

	if cfg.ControlPlaneURL == "" {
		return Config{}, errors.New("OC_CONTROL_PLANE_URL is required")
	}
	parsed, err := url.Parse(cfg.ControlPlaneURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return Config{}, errors.New("OC_CONTROL_PLANE_URL must be an absolute HTTP(S) URL")
	}
	if parsed.Scheme != "https" && !isLoopbackHost(parsed.Hostname()) && !cfg.AllowInsecureHTTP {
		return Config{}, errors.New("OC_CONTROL_PLANE_URL must use HTTPS outside localhost; set OC_ALLOW_INSECURE_HTTP=true only for development")
	}
	if cfg.HeartbeatEvery < 10*time.Second || cfg.HeartbeatEvery > 5*time.Minute {
		return Config{}, errors.New("OC_HEARTBEAT_SECONDS must be between 10 and 300")
	}
	if cfg.OperationEvery < time.Second || cfg.OperationEvery > 30*time.Second {
		return Config{}, errors.New("OC_OPERATION_POLL_SECONDS must be between 1 and 30")
	}
	return cfg, nil
}

func valueOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func durationSeconds(key string, fallback int) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return time.Duration(fallback) * time.Second
	}
	seconds, err := strconv.Atoi(value)
	if err != nil {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
