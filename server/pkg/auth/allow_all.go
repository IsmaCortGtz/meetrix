package auth

import (
	"context"
	"fmt"

	"github.com/connected-framework/connected/server/pkg/permissions"
	"github.com/google/uuid"
)

// AllowAllAuthenticator is a permissive authenticator for local development and testing.
type AllowAllAuthenticator struct{}

// NewAllowAllAuthenticator creates a new AllowAllAuthenticator.
func NewAllowAllAuthenticator() *AllowAllAuthenticator {
	return &AllowAllAuthenticator{}
}

// Authenticate admits any request, auto-generating user IDs and assigning appropriate roles.
func (a *AllowAllAuthenticator) Authenticate(ctx context.Context, req AuthRequest) (*AuthResponse, error) {
	userID := req.UserID
	if userID == "" {
		userID = fmt.Sprintf("user_%s", uuid.New().String()[:8])
	}

	displayName := req.DisplayName
	if displayName == "" {
		displayName = userID
	}

	role := permissions.RoleParticipant
	if req.Metadata != nil {
		if r, ok := req.Metadata["role"].(string); ok && r != "" {
			role = permissions.Role(r)
		}
	}

	perms := permissions.DefaultPermissionsForRole(role)

	return &AuthResponse{
		Allowed:     true,
		UserID:      userID,
		DisplayName: displayName,
		Role:        role,
		Permissions: &perms,
	}, nil
}
