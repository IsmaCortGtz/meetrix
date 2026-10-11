package auth

import (
	"context"
	"crypto"
	"fmt"
	"strings"

	"github.com/IsmaCortGtz/meetrix/server/pkg/config"
	"github.com/IsmaCortGtz/meetrix/server/pkg/permissions"
	"github.com/golang-jwt/jwt/v5"
)

// MeetrixClaims represents the expected JWT payload claims for Meetrix.
type MeetrixClaims struct {
	jwt.RegisteredClaims
	UserID      string                       `json:"user_id,omitempty"`
	DisplayName string                       `json:"display_name,omitempty"`
	Name        string                       `json:"name,omitempty"`
	Role        string                       `json:"role,omitempty"`
	RoomID      string                       `json:"room_id,omitempty"`
	Permissions *permissions.UserPermissions `json:"permissions,omitempty"`
	RoomPolicy  *permissions.RoomPolicy      `json:"room_policy,omitempty"`
}

// JWTAuthenticator validates authentication tokens signed with HMAC, RSA, or ECDSA keys.
type JWTAuthenticator struct {
	secret    []byte
	publicKey crypto.PublicKey
	algorithm string
}

// NewJWTAuthenticator initializes a JWTAuthenticator based on provided configuration.
func NewJWTAuthenticator(cfg config.JWTAuthConfig) (*JWTAuthenticator, error) {
	ja := &JWTAuthenticator{
		algorithm: cfg.Algorithm,
	}
	if ja.algorithm == "" {
		ja.algorithm = "HS256"
	}

	if strings.HasPrefix(ja.algorithm, "HS") {
		ja.secret = []byte(cfg.Secret)
	} else if strings.HasPrefix(ja.algorithm, "RS") {
		if cfg.PublicKey != "" {
			pubKey, err := jwt.ParseRSAPublicKeyFromPEM([]byte(cfg.PublicKey))
			if err != nil {
				return nil, fmt.Errorf("failed to parse RSA public key: %w", err)
			}
			ja.publicKey = pubKey
		}
	} else if strings.HasPrefix(ja.algorithm, "ES") {
		if cfg.PublicKey != "" {
			pubKey, err := jwt.ParseECPublicKeyFromPEM([]byte(cfg.PublicKey))
			if err != nil {
				return nil, fmt.Errorf("failed to parse ECDSA public key: %w", err)
			}
			ja.publicKey = pubKey
		}
	}

	return ja, nil
}

// Authenticate validates the JWT provided in AuthRequest.Token.
func (j *JWTAuthenticator) Authenticate(ctx context.Context, req AuthRequest) (*AuthResponse, error) {
	if req.Token == "" {
		return &AuthResponse{
			Allowed: false,
			Reason:  "missing authentication token",
		}, nil
	}

	token, err := jwt.ParseWithClaims(req.Token, &MeetrixClaims{}, func(t *jwt.Token) (interface{}, error) {
		// Validate signing algorithm family
		if strings.HasPrefix(j.algorithm, "HS") {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return j.secret, nil
		}
		if strings.HasPrefix(j.algorithm, "RS") {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return j.publicKey, nil
		}
		if strings.HasPrefix(j.algorithm, "ES") {
			if _, ok := t.Method.(*jwt.SigningMethodECDSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return j.publicKey, nil
		}
		return nil, fmt.Errorf("unsupported algorithm: %s", j.algorithm)
	})

	if err != nil || !token.Valid {
		return &AuthResponse{
			Allowed: false,
			Reason:  fmt.Sprintf("invalid JWT token: %v", err),
		}, nil
	}

	claims, ok := token.Claims.(*MeetrixClaims)
	if !ok {
		return &AuthResponse{
			Allowed: false,
			Reason:  "malformed token claims",
		}, nil
	}

	// Validate room restriction if embedded in claims
	if claims.RoomID != "" && req.RoomID != "" && claims.RoomID != req.RoomID {
		return &AuthResponse{
			Allowed: false,
			Reason:  fmt.Sprintf("token room %q does not match requested room %q", claims.RoomID, req.RoomID),
		}, nil
	}

	userID := claims.UserID
	if userID == "" {
		userID = claims.Subject
	}
	if userID == "" {
		userID = req.UserID
	}

	displayName := claims.DisplayName
	if displayName == "" {
		displayName = claims.Name
	}
	if displayName == "" {
		displayName = req.DisplayName
	}
	if displayName == "" {
		displayName = userID
	}

	role := permissions.Role(claims.Role)
	if role == "" {
		role = permissions.RoleParticipant
	}

	userPerms := claims.Permissions
	if userPerms == nil {
		def := permissions.DefaultPermissionsForRole(role)
		userPerms = &def
	}

	return &AuthResponse{
		Allowed:     true,
		UserID:      userID,
		DisplayName: displayName,
		Role:        role,
		Permissions: userPerms,
		RoomPolicy:  claims.RoomPolicy,
	}, nil
}
