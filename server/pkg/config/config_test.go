package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.Server.HTTPPort != 8080 {
		t.Errorf("expected HTTPPort 8080, got %d", cfg.Server.HTTPPort)
	}
	if cfg.Server.WebRTCPortMin != 50000 || cfg.Server.WebRTCPortMax != 50200 {
		t.Errorf("expected WebRTC port range 50000-50200, got %d-%d", cfg.Server.WebRTCPortMin, cfg.Server.WebRTCPortMax)
	}
	if !cfg.Server.TURN.Enabled {
		t.Errorf("expected TURN enabled")
	}
	if cfg.Server.TURN.Port != 3478 {
		t.Errorf("expected TURN port 3478, got %d", cfg.Server.TURN.Port)
	}
	if cfg.Room.DefaultMaxParticipants != 50 {
		t.Errorf("expected MaxParticipants 50, got %d", cfg.Room.DefaultMaxParticipants)
	}
	if !cfg.Room.DefaultPolicies.AllowCamera || !cfg.Room.DefaultPolicies.AllowMic {
		t.Errorf("expected camera and mic allowed by default")
	}
	if cfg.Room.DefaultPolicies.RequireLobby {
		t.Errorf("expected lobby to be false by default")
	}
	if cfg.Auth.Provider != "allow_all" {
		t.Errorf("expected default provider allow_all, got %s", cfg.Auth.Provider)
	}
}

func TestLoadConfigFile(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "custom_config.json")

	customJSON := `{
		"server": {
			"http_port": 9090,
			"public_ip": "1.2.3.4"
		},
		"room": {
			"default_max_participants": 100,
			"default_policies": {
				"require_lobby": true
			}
		},
		"auth": {
			"provider": "jwt"
		}
	}`

	if err := os.WriteFile(configPath, []byte(customJSON), 0644); err != nil {
		t.Fatalf("failed to write test config file: %v", err)
	}

	cfg, err := LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.Server.HTTPPort != 9090 {
		t.Errorf("expected HTTPPort 9090, got %d", cfg.Server.HTTPPort)
	}
	if cfg.Server.PublicIP != "1.2.3.4" {
		t.Errorf("expected PublicIP 1.2.3.4, got %s", cfg.Server.PublicIP)
	}
	if cfg.Room.DefaultMaxParticipants != 100 {
		t.Errorf("expected MaxParticipants 100, got %d", cfg.Room.DefaultMaxParticipants)
	}
	if !cfg.Room.DefaultPolicies.RequireLobby {
		t.Errorf("expected RequireLobby true")
	}
	if cfg.Auth.Provider != "jwt" {
		t.Errorf("expected Auth provider jwt, got %s", cfg.Auth.Provider)
	}
}

func TestLoadConfigEnvOverrides(t *testing.T) {
	t.Setenv("MEETRIX_HTTP_PORT", "9999")
	t.Setenv("MEETRIX_PUBLIC_IP", "10.0.0.1")
	t.Setenv("MEETRIX_WEBRTC_PORT_MIN", "60000")
	t.Setenv("MEETRIX_WEBRTC_PORT_MAX", "60100")
	t.Setenv("MEETRIX_TURN_ENABLED", "false")
	t.Setenv("MEETRIX_TURN_PORT", "4000")
	t.Setenv("MEETRIX_AUTH_PROVIDER", "webhook")
	t.Setenv("MEETRIX_ROOM_MAX_PARTICIPANTS", "25")

	cfg, err := LoadConfig("")
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.Server.HTTPPort != 9999 {
		t.Errorf("expected HTTPPort 9999, got %d", cfg.Server.HTTPPort)
	}
	if cfg.Server.PublicIP != "10.0.0.1" {
		t.Errorf("expected PublicIP 10.0.0.1, got %s", cfg.Server.PublicIP)
	}
	if cfg.Server.WebRTCPortMin != 60000 || cfg.Server.WebRTCPortMax != 60100 {
		t.Errorf("expected WebRTC port range 60000-60100, got %d-%d", cfg.Server.WebRTCPortMin, cfg.Server.WebRTCPortMax)
	}
	if cfg.Server.TURN.Enabled {
		t.Errorf("expected TURN disabled")
	}
	if cfg.Server.TURN.Port != 4000 {
		t.Errorf("expected TURN port 4000, got %d", cfg.Server.TURN.Port)
	}
	if cfg.Auth.Provider != "webhook" {
		t.Errorf("expected Auth provider webhook, got %s", cfg.Auth.Provider)
	}
	if cfg.Room.DefaultMaxParticipants != 25 {
		t.Errorf("expected MaxParticipants 25, got %d", cfg.Room.DefaultMaxParticipants)
	}
}

func TestLoadConfigMissingFile(t *testing.T) {
	cfg, err := LoadConfig("non_existent_file.json")
	if err != nil {
		t.Fatalf("expected no error for missing file fallback, got: %v", err)
	}
	if cfg.Server.HTTPPort != 8080 {
		t.Errorf("expected default HTTPPort 8080, got %d", cfg.Server.HTTPPort)
	}
}
