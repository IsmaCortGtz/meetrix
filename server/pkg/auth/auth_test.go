package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/IsmaCortGtz/meetrix/server/pkg/config"
	"github.com/IsmaCortGtz/meetrix/server/pkg/permissions"
	"github.com/golang-jwt/jwt/v5"
)

func TestAllowAllAuthenticator(t *testing.T) {
	auth := NewAllowAllAuthenticator()

	resp, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID:      "test-room",
		DisplayName: "Alice",
		Metadata:    map[string]interface{}{"role": "host"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !resp.Allowed {
		t.Errorf("expected allowed true")
	}
	if resp.DisplayName != "Alice" {
		t.Errorf("expected Alice, got %s", resp.DisplayName)
	}
	if resp.Role != permissions.RoleHost {
		t.Errorf("expected host role, got %s", resp.Role)
	}
	if resp.UserID == "" {
		t.Errorf("expected auto-generated UserID")
	}
}

func TestJWTAuthenticator(t *testing.T) {
	secret := "my-secret-key-12345"
	auth, err := NewJWTAuthenticator(config.JWTAuthConfig{
		Secret:    secret,
		Algorithm: "HS256",
	})
	if err != nil {
		t.Fatalf("failed to create JWT auth: %v", err)
	}

	// 1. Valid Token
	claims := MeetrixClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user-123",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
		},
		Name:   "Bob",
		Role:   "co-host",
		RoomID: "room-abc",
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	resp, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID: "room-abc",
		Token:  tokenString,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.Allowed {
		t.Errorf("expected allowed true, got reason: %s", resp.Reason)
	}
	if resp.UserID != "user-123" {
		t.Errorf("expected user-123, got %s", resp.UserID)
	}
	if resp.DisplayName != "Bob" {
		t.Errorf("expected Bob, got %s", resp.DisplayName)
	}
	if resp.Role != permissions.RoleCoHost {
		t.Errorf("expected co-host role, got %s", resp.Role)
	}

	// 2. Room mismatch
	respMismatch, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID: "different-room",
		Token:  tokenString,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if respMismatch.Allowed {
		t.Errorf("expected token to be rejected on room mismatch")
	}

	// 3. Expired token
	expiredClaims := MeetrixClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user-expired",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
		},
		RoomID: "room-abc",
	}
	expiredToken := jwt.NewWithClaims(jwt.SigningMethodHS256, expiredClaims)
	expiredStr, _ := expiredToken.SignedString([]byte(secret))

	respExpired, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID: "room-abc",
		Token:  expiredStr,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if respExpired.Allowed {
		t.Errorf("expected expired token to be rejected")
	}

	// 4. Invalid Signature
	wrongSecretStr, _ := token.SignedString([]byte("wrong-secret"))
	respWrong, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID: "room-abc",
		Token:  wrongSecretStr,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if respWrong.Allowed {
		t.Errorf("expected invalid signature to be rejected")
	}
}

func TestWebhookAuthenticator(t *testing.T) {
	// Mock HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req AuthRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if req.Token == "valid-token" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(AuthResponse{
				Allowed:     true,
				UserID:      "webhook-user",
				DisplayName: "Charlie",
				Role:        permissions.RoleHost,
			})
		} else {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"reason": "invalid credentials",
			})
		}
	}))
	defer server.Close()

	auth := NewWebhookAuthenticator(config.WebhookAuthConfig{
		URL:       server.URL,
		TimeoutMs: 2000,
	})

	// Valid request
	resp, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID: "room-wh",
		Token:  "valid-token",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.Allowed {
		t.Errorf("expected allowed true, reason: %s", resp.Reason)
	}
	if resp.UserID != "webhook-user" {
		t.Errorf("expected webhook-user, got %s", resp.UserID)
	}
	if resp.Role != permissions.RoleHost {
		t.Errorf("expected host, got %s", resp.Role)
	}

	// Invalid request
	respBad, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID: "room-wh",
		Token:  "bad-token",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if respBad.Allowed {
		t.Errorf("expected rejected authentication")
	}
	if respBad.Reason != "invalid credentials" {
		t.Errorf("expected 'invalid credentials', got %q", respBad.Reason)
	}
}

func TestExecAuthenticator(t *testing.T) {
	// Command that outputs valid JSON AuthResponse
	auth := NewExecAuthenticator(config.ExecAuthConfig{
		Command:   "sh",
		Args:      []string{"-c", `cat > /dev/null && echo '{"allowed": true, "user_id": "cli-user", "display_name": "CLI", "role": "participant"}'`},
		TimeoutMs: 2000,
	})

	resp, err := auth.Authenticate(context.Background(), AuthRequest{
		RoomID: "cli-room",
		Token:  "cli-token",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.Allowed {
		t.Errorf("expected allowed true, got reason: %s", resp.Reason)
	}
	if resp.UserID != "cli-user" {
		t.Errorf("expected cli-user, got %s", resp.UserID)
	}

	// Command that exits with failure
	failAuth := NewExecAuthenticator(config.ExecAuthConfig{
		Command:   "sh",
		Args:      []string{"-c", "exit 1"},
		TimeoutMs: 2000,
	})
	respFail, err := failAuth.Authenticate(context.Background(), AuthRequest{
		RoomID: "cli-room",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if respFail.Allowed {
		t.Errorf("expected failed auth execution to reject")
	}
}

func TestNewAuthenticatorFactory(t *testing.T) {
	tests := []struct {
		provider string
		expected string
	}{
		{"allow_all", "*auth.AllowAllAuthenticator"},
		{"jwt", "*auth.JWTAuthenticator"},
		{"webhook", "*auth.WebhookAuthenticator"},
		{"exec", "*auth.ExecAuthenticator"},
	}

	for _, tt := range tests {
		cfg := &config.AuthConfig{
			Provider: tt.provider,
			JWT:      config.JWTAuthConfig{Secret: "test"},
		}
		auth, err := NewAuthenticator(cfg)
		if err != nil {
			t.Errorf("provider %s failed: %v", tt.provider, err)
		}
		if auth == nil {
			t.Errorf("provider %s returned nil authenticator", tt.provider)
		}
	}
}
