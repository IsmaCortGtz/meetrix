package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/IsmaCortGtz/connected/server/pkg/config"
	"github.com/IsmaCortGtz/connected/server/pkg/permissions"
)

// WebhookAuthenticator delegates authentication to a custom HTTP endpoint.
type WebhookAuthenticator struct {
	client  *http.Client
	url     string
	secret  string
	timeout time.Duration
}

// NewWebhookAuthenticator creates a new WebhookAuthenticator.
func NewWebhookAuthenticator(cfg config.WebhookAuthConfig) *WebhookAuthenticator {
	timeout := time.Duration(cfg.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &WebhookAuthenticator{
		client:  &http.Client{Timeout: timeout},
		url:     cfg.URL,
		secret:  cfg.Secret,
		timeout: timeout,
	}
}

// Authenticate sends an HTTP POST request to the configured webhook URL.
func (w *WebhookAuthenticator) Authenticate(ctx context.Context, req AuthRequest) (*AuthResponse, error) {
	if w.url == "" {
		return &AuthResponse{
			Allowed: false,
			Reason:  "webhook URL is not configured",
		}, nil
	}

	bodyBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to encode auth request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create http request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if w.secret != "" {
		httpReq.Header.Set("Authorization", "Bearer "+w.secret)
		httpReq.Header.Set("X-Connected-Signature", w.secret)
	}

	httpResp, err := w.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("webhook authentication request failed: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		var errResp struct {
			Reason string `json:"reason"`
		}
		_ = json.NewDecoder(httpResp.Body).Decode(&errResp)
		reason := errResp.Reason
		if reason == "" {
			reason = fmt.Sprintf("webhook rejected with status %d", httpResp.StatusCode)
		}
		return &AuthResponse{
			Allowed: false,
			Reason:  reason,
		}, nil
	}

	var authResp AuthResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&authResp); err != nil {
		return nil, fmt.Errorf("failed to decode webhook response JSON: %w", err)
	}

	// Apply default permissions if missing
	if authResp.Allowed && authResp.Permissions == nil {
		defaultPerms := permissions.DefaultPermissionsForRole(authResp.Role)
		authResp.Permissions = &defaultPerms
	}

	return &authResp, nil
}
