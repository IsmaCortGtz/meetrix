package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

// ServerConfig defines network and media server listener configuration.
type ServerConfig struct {
	HTTPPort       int        `json:"http_port"`
	WebRTCPortMin  uint16     `json:"webrtc_port_min"`
	WebRTCPortMax  uint16     `json:"webrtc_port_max"`
	PublicIP       string     `json:"public_ip"`
	TURN           TURNConfig `json:"turn"`
}

// TURNConfig defines embedded STUN/TURN server settings.
type TURNConfig struct {
	Enabled bool              `json:"enabled"`
	Realm   string            `json:"realm"`
	Port    int               `json:"port"`
	Users   map[string]string `json:"users"`
	Secret  string            `json:"secret"`
}

// RoomPoliciesConfig defines default room media and moderation rules.
type RoomPoliciesConfig struct {
	AllowCamera      bool `json:"allow_camera"`
	AllowMic         bool `json:"allow_mic"`
	AllowScreenShare bool `json:"allow_screen_share"`
	AllowChat        bool `json:"allow_chat"`
	AllowReactions   bool `json:"allow_reactions"`
	RequireLobby     bool `json:"require_lobby"`
}

// RoomConfig defines room lifecycle, capacity, and default policy settings.
type RoomConfig struct {
	DefaultMaxParticipants   int                `json:"default_max_participants"`
	DefaultSessionTimeoutSec int                `json:"default_session_timeout_sec"`
	EmptyRoomTTLSec          int                `json:"empty_room_ttl_sec"`
	DefaultPolicies          RoomPoliciesConfig `json:"default_policies"`
}

// WebhookAuthConfig defines settings for HTTP webhook authentication.
type WebhookAuthConfig struct {
	URL       string `json:"url"`
	TimeoutMs int    `json:"timeout_ms"`
	Secret    string `json:"secret"`
}

// ExecAuthConfig defines settings for CLI executable process authentication.
type ExecAuthConfig struct {
	Command   string   `json:"command"`
	Args      []string `json:"args"`
	TimeoutMs int      `json:"timeout_ms"`
}

// JWTAuthConfig defines settings for JSON Web Token authentication.
type JWTAuthConfig struct {
	Secret    string `json:"secret"`
	Algorithm string `json:"algorithm"`
	PublicKey string `json:"public_key"`
}

// AuthConfig defines the active provider and provider-specific configurations.
type AuthConfig struct {
	Provider string            `json:"provider"` // "webhook", "exec", "jwt", "allow_all"
	Webhook  WebhookAuthConfig `json:"webhook"`
	Exec     ExecAuthConfig    `json:"exec"`
	JWT      JWTAuthConfig     `json:"jwt"`
}

// Config represents the top-level server configuration.
type Config struct {
	Server ServerConfig `json:"server"`
	Room   RoomConfig   `json:"room"`
	Auth   AuthConfig   `json:"auth"`
}

// DefaultConfig returns a configuration with sensible production defaults.
func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			HTTPPort:      8080,
			WebRTCPortMin: 50000,
			WebRTCPortMax: 50200,
			PublicIP:      "auto",
			TURN: TURNConfig{
				Enabled: true,
				Realm:   "meetrix",
				Port:    3478,
				Users: map[string]string{
					"meetrix": "meetrix-secret",
				},
				Secret: "turn-shared-secret",
			},
		},
		Room: RoomConfig{
			DefaultMaxParticipants:   50,
			DefaultSessionTimeoutSec: 3600,
			EmptyRoomTTLSec:          60,
			DefaultPolicies: RoomPoliciesConfig{
				AllowCamera:      true,
				AllowMic:         true,
				AllowScreenShare: true,
				AllowChat:        true,
				AllowReactions:   true,
				RequireLobby:     false,
			},
		},
		Auth: AuthConfig{
			Provider: "allow_all",
			Webhook: WebhookAuthConfig{
				URL:       "",
				TimeoutMs: 5000,
				Secret:    "",
			},
			Exec: ExecAuthConfig{
				Command:   "",
				Args:      []string{},
				TimeoutMs: 5000,
			},
			JWT: JWTAuthConfig{
				Secret:    "meetrix-jwt-secret",
				Algorithm: "HS256",
				PublicKey: "",
			},
		},
	}
}

// LoadConfig loads configuration from a JSON file path if specified,
// applies defaults for missing fields, and applies environment variable overrides.
func LoadConfig(path string) (*Config, error) {
	cfg := DefaultConfig()

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				return nil, fmt.Errorf("failed to read config file %q: %w", path, err)
			}
			// If file does not exist, fall through to defaults and env vars
		} else {
			if err := json.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("failed to parse config JSON from %q: %w", path, err)
			}
		}
	}

	applyEnvOverrides(cfg)
	return cfg, nil
}

// applyEnvOverrides updates configuration with values from environment variables.
func applyEnvOverrides(cfg *Config) {
	if val := os.Getenv("MEETRIX_HTTP_PORT"); val != "" {
		if port, err := strconv.Atoi(val); err == nil {
			cfg.Server.HTTPPort = port
		}
	}
	if val := os.Getenv("MEETRIX_PUBLIC_IP"); val != "" {
		cfg.Server.PublicIP = val
	}
	if val := os.Getenv("MEETRIX_WEBRTC_PORT_MIN"); val != "" {
		if p, err := strconv.ParseUint(val, 10, 16); err == nil {
			cfg.Server.WebRTCPortMin = uint16(p)
		}
	}
	if val := os.Getenv("MEETRIX_WEBRTC_PORT_MAX"); val != "" {
		if p, err := strconv.ParseUint(val, 10, 16); err == nil {
			cfg.Server.WebRTCPortMax = uint16(p)
		}
	}
	if val := os.Getenv("MEETRIX_TURN_ENABLED"); val != "" {
		cfg.Server.TURN.Enabled = val == "true" || val == "1"
	}
	if val := os.Getenv("MEETRIX_TURN_PORT"); val != "" {
		if port, err := strconv.Atoi(val); err == nil {
			cfg.Server.TURN.Port = port
		}
	}
	if val := os.Getenv("MEETRIX_TURN_REALM"); val != "" {
		cfg.Server.TURN.Realm = val
	}
	if val := os.Getenv("MEETRIX_TURN_SECRET"); val != "" {
		cfg.Server.TURN.Secret = val
	}
	if val := os.Getenv("MEETRIX_ROOM_MAX_PARTICIPANTS"); val != "" {
		if max, err := strconv.Atoi(val); err == nil {
			cfg.Room.DefaultMaxParticipants = max
		}
	}
	if val := os.Getenv("MEETRIX_ROOM_SESSION_TIMEOUT"); val != "" {
		if timeout, err := strconv.Atoi(val); err == nil {
			cfg.Room.DefaultSessionTimeoutSec = timeout
		}
	}
	if val := os.Getenv("MEETRIX_ROOM_EMPTY_TTL"); val != "" {
		if ttl, err := strconv.Atoi(val); err == nil {
			cfg.Room.EmptyRoomTTLSec = ttl
		}
	}
	if val := os.Getenv("MEETRIX_AUTH_PROVIDER"); val != "" {
		cfg.Auth.Provider = val
	}
	if val := os.Getenv("MEETRIX_AUTH_JWT_SECRET"); val != "" {
		cfg.Auth.JWT.Secret = val
	}
	if val := os.Getenv("MEETRIX_AUTH_WEBHOOK_URL"); val != "" {
		cfg.Auth.Webhook.URL = val
	}
	if val := os.Getenv("MEETRIX_AUTH_EXEC_COMMAND"); val != "" {
		cfg.Auth.Exec.Command = val
	}
}
