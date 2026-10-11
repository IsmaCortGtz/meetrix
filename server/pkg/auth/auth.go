package auth

import (
	"context"
	"fmt"

	"github.com/IsmaCortGtz/connected/server/pkg/config"
	"github.com/IsmaCortGtz/connected/server/pkg/permissions"
)

// AuthRequest contains client authentication credentials and room targeting information.
type AuthRequest struct {
	RoomID      string                 `json:"room_id"`
	Token       string                 `json:"token"`
	UserID      string                 `json:"user_id,omitempty"`
	DisplayName string                 `json:"display_name,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	RemoteAddr  string                 `json:"remote_addr,omitempty"`
}

// AuthResponse defines the authentication outcome and assigned session capabilities.
type AuthResponse struct {
	Allowed     bool                         `json:"allowed"`
	UserID      string                       `json:"user_id"`
	DisplayName string                       `json:"display_name"`
	Role        permissions.Role             `json:"role"`
	Permissions *permissions.UserPermissions `json:"permissions,omitempty"`
	RoomPolicy  *permissions.RoomPolicy      `json:"room_policy,omitempty"`
	Reason      string                       `json:"reason,omitempty"`
}

// Authenticator defines the contract for pluggable authentication mechanisms.
type Authenticator interface {
	Authenticate(ctx context.Context, req AuthRequest) (*AuthResponse, error)
}

// NewAuthenticator creates an Authenticator instance matching the configured provider.
func NewAuthenticator(cfg *config.AuthConfig) (Authenticator, error) {
	if cfg == nil {
		return NewAllowAllAuthenticator(), nil
	}

	switch cfg.Provider {
	case "allow_all", "":
		return NewAllowAllAuthenticator(), nil
	case "jwt":
		return NewJWTAuthenticator(cfg.JWT)
	case "webhook":
		return NewWebhookAuthenticator(cfg.Webhook), nil
	case "exec":
		return NewExecAuthenticator(cfg.Exec), nil
	default:
		return nil, fmt.Errorf("unknown auth provider: %q", cfg.Provider)
	}
}
