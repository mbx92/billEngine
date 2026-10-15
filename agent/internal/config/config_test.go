package config

import "testing"

func TestLoadRejectsInsecureRemoteURLByDefault(t *testing.T) {
	t.Setenv("OC_CONTROL_PLANE_URL", "http://10.5.80.141:3000")
	t.Setenv("OC_ALLOW_INSECURE_HTTP", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected insecure remote URL to be rejected")
	}
}

func TestLoadAllowsInsecureRemoteURLWithDevelopmentOptIn(t *testing.T) {
	t.Setenv("OC_CONTROL_PLANE_URL", "http://10.5.80.141:3000")
	t.Setenv("OC_ALLOW_INSECURE_HTTP", "true")

	config, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !config.AllowInsecureHTTP {
		t.Fatal("expected insecure HTTP opt-in to be recorded")
	}
}

func TestLoadAllowsLoopbackHTTPWithoutOptIn(t *testing.T) {
	t.Setenv("OC_CONTROL_PLANE_URL", "http://127.0.0.1:3000")
	t.Setenv("OC_ALLOW_INSECURE_HTTP", "")

	if _, err := Load(); err != nil {
		t.Fatalf("load config: %v", err)
	}
}
