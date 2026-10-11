package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/IsmaCortGtz/meetrix/server/pkg/auth"
	"github.com/IsmaCortGtz/meetrix/server/pkg/config"
	"github.com/IsmaCortGtz/meetrix/server/pkg/permissions"
	"github.com/IsmaCortGtz/meetrix/server/pkg/room"
	"github.com/IsmaCortGtz/meetrix/server/pkg/sfu"
	"github.com/IsmaCortGtz/meetrix/server/pkg/signaling"
	"github.com/IsmaCortGtz/meetrix/server/pkg/turn"
)

// UserRecord represents user data stored in the developer's database or cache.
type UserRecord struct {
	UserID      string
	DisplayName string
	Role        permissions.Role
	AllowedRoom string
}

// DatabaseTokenAuthenticator demonstrates how a developer can plug in their own
// native database or in-memory session store by implementing auth.Authenticator.
type DatabaseTokenAuthenticator struct {
	mu     sync.RWMutex
	tokens map[string]UserRecord
}

// NewDatabaseTokenAuthenticator initializes the mock in-memory database store.
func NewDatabaseTokenAuthenticator() *DatabaseTokenAuthenticator {
	return &DatabaseTokenAuthenticator{
		tokens: map[string]UserRecord{
			"host-secret-token": {
				UserID:      "host_usr_01",
				DisplayName: "Dr. Alice (Host)",
				Role:        permissions.RoleHost,
				AllowedRoom: "webinar-room",
			},
			"cohost-secret-token": {
				UserID:      "cohost_usr_02",
				DisplayName: "Bob (Co-Host)",
				Role:        permissions.RoleCoHost,
				AllowedRoom: "webinar-room",
			},
			"student-token-1": {
				UserID:      "student_usr_03",
				DisplayName: "Charlie (Student)",
				Role:        permissions.RoleParticipant,
				AllowedRoom: "webinar-room",
			},
			"viewer-token-1": {
				UserID:      "viewer_usr_04",
				DisplayName: "Dave (Audience)",
				Role:        permissions.RoleViewer,
				AllowedRoom: "webinar-room",
			},
		},
	}
}

// RegisterToken allows dynamically provisioning tokens (e.g. from an internal API).
func (a *DatabaseTokenAuthenticator) RegisterToken(token string, record UserRecord) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tokens[token] = record
}

// Authenticate checks the token against the registered database records.
func (a *DatabaseTokenAuthenticator) Authenticate(ctx context.Context, req auth.AuthRequest) (*auth.AuthResponse, error) {
	a.mu.RLock()
	record, exists := a.tokens[req.Token]
	a.mu.RUnlock()

	if !exists {
		return &auth.AuthResponse{
			Allowed: false,
			Reason:  "Invalid or expired meeting token",
		}, nil
	}

	// Validate room restriction
	if record.AllowedRoom != "" && record.AllowedRoom != req.RoomID {
		return &auth.AuthResponse{
			Allowed: false,
			Reason:  fmt.Sprintf("Token is only valid for room %q", record.AllowedRoom),
		}, nil
	}

	userPerms := permissions.DefaultPermissionsForRole(record.Role)

	return &auth.AuthResponse{
		Allowed:     true,
		UserID:      record.UserID,
		DisplayName: record.DisplayName,
		Role:        record.Role,
		Permissions: &userPerms,
	}, nil
}

func main() {
	log.Println("[CustomServer] Initializing custom Meetrix Go Media Server...")

	// 1. Configure media server settings
	serverCfg := config.ServerConfig{
		HTTPPort:      8090,
		WebRTCPortMin: 50000,
		WebRTCPortMax: 50100,
		PublicIP:      "127.0.0.1",
		TURN: config.TURNConfig{
			Enabled: true,
			Realm:   "custom-meetrix",
			Port:    3479,
			Users: map[string]string{
				"custom-user": "custom-pass",
			},
		},
	}

	// 2. Configure webinar room policies (e.g. require lobby, disable participant screen share)
	roomCfg := config.RoomConfig{
		DefaultMaxParticipants:   100,
		DefaultSessionTimeoutSec: 7200, // 2-hour session
		EmptyRoomTTLSec:          30,
		DefaultPolicies: config.RoomPoliciesConfig{
			AllowCamera:      true,
			AllowMic:         true,
			AllowScreenShare: false, // Only hosts can share screen in this custom server
			AllowChat:        true,
			AllowReactions:   true,
			RequireLobby:     true, // Participants wait in lobby until admitted
		},
	}

	// 3. Start embedded STUN/TURN server
	log.Printf("[CustomServer] Starting TURN server on UDP :%d", serverCfg.TURN.Port)
	turnServer, err := turn.NewServer(serverCfg.TURN, serverCfg.PublicIP, serverCfg.WebRTCPortMin, serverCfg.WebRTCPortMax)
	if err != nil {
		log.Fatalf("Failed to initialize TURN server: %v", err)
	}

	// 4. Initialize Pion WebRTC SFU engine
	log.Println("[CustomServer] Initializing SFU Media Engine")
	sfuEngine, err := sfu.NewEngine(serverCfg)
	if err != nil {
		log.Fatalf("Failed to initialize SFU engine: %v", err)
	}

	// 5. Initialize Room Manager
	roomManager := room.NewRoomManager(roomCfg)

	// 6. Plug in custom native Authenticator
	customAuth := NewDatabaseTokenAuthenticator()

	// 7. Initialize WebSocket Signaling Hub
	hub := signaling.NewHub(roomManager, sfuEngine, customAuth)

	// 8. Setup HTTP routes
	mux := http.NewServeMux()

	// Core WebRTC signaling endpoint
	mux.HandleFunc("/ws", hub.ServeWS)

	// Health and server status
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "custom_server_healthy",
			"active_rooms": roomManager.ActiveRoomsCount(),
			"port":         serverCfg.HTTPPort,
		})
	})

	// Custom developer endpoint: provision token on the fly
	mux.HandleFunc("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload struct {
			Token       string `json:"token"`
			UserID      string `json:"user_id"`
			DisplayName string `json:"display_name"`
			Role        string `json:"role"`
			RoomID      string `json:"room_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		customAuth.RegisterToken(payload.Token, UserRecord{
			UserID:      payload.UserID,
			DisplayName: payload.DisplayName,
			Role:        permissions.Role(payload.Role),
			AllowedRoom: payload.RoomID,
		})

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "token_registered"})
	})

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", serverCfg.HTTPPort),
		Handler: mux,
	}

	go func() {
		log.Printf("[CustomServer] Server listening on http://localhost:%d", serverCfg.HTTPPort)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("[CustomServer] Shutting down gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_ = httpServer.Shutdown(shutdownCtx)
	roomManager.Close()
	_ = turnServer.Close()

	log.Println("[CustomServer] Server cleanly terminated")
}
