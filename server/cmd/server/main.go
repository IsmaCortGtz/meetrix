package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/IsmaCortGtz/connected/server/pkg/auth"
	"github.com/IsmaCortGtz/connected/server/pkg/config"
	"github.com/IsmaCortGtz/connected/server/pkg/room"
	"github.com/IsmaCortGtz/connected/server/pkg/sfu"
	"github.com/IsmaCortGtz/connected/server/pkg/signaling"
	"github.com/IsmaCortGtz/connected/server/pkg/turn"
)

func main() {
	configPath := flag.String("config", "config.json", "Path to JSON configuration file")
	portFlag := flag.Int("port", 0, "HTTP port (overrides config)")
	flag.Parse()

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	if *portFlag > 0 {
		cfg.Server.HTTPPort = *portFlag
	}

	log.Printf("[Connected] Initializing Go Media Server on HTTP port %d", cfg.Server.HTTPPort)

	// Embedded STUN/TURN server
	var turnServer *turn.Server
	if cfg.Server.TURN.Enabled {
		log.Printf("[Connected] Starting embedded STUN/TURN server on UDP :%d (realm: %s)", cfg.Server.TURN.Port, cfg.Server.TURN.Realm)
		ts, err := turn.NewServer(cfg.Server.TURN, cfg.Server.PublicIP, cfg.Server.WebRTCPortMin, cfg.Server.WebRTCPortMax)
		if err != nil {
			log.Fatalf("Failed to start TURN server: %v", err)
		}
		turnServer = ts
	}

	// Pluggable Authenticator
	log.Printf("[Connected] Initializing authentication provider: %s", cfg.Auth.Provider)
	authProvider, err := auth.NewAuthenticator(&cfg.Auth)
	if err != nil {
		log.Fatalf("Failed to initialize authenticator: %v", err)
	}

	// SFU Media Engine
	log.Printf("[Connected] Initializing Pion WebRTC SFU (port range: %d-%d)", cfg.Server.WebRTCPortMin, cfg.Server.WebRTCPortMax)
	sfuEngine, err := sfu.NewEngine(cfg.Server)
	if err != nil {
		log.Fatalf("Failed to initialize SFU engine: %v", err)
	}

	// Room Manager
	roomManager := room.NewRoomManager(cfg.Room)

	// Signaling Hub
	hub := signaling.NewHub(roomManager, sfuEngine, authProvider)

	startTime := time.Now()
	mux := http.NewServeMux()

	// WebSocket signaling route
	mux.HandleFunc("/ws", hub.ServeWS)

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "ok",
			"uptime_sec":   int(time.Since(startTime).Seconds()),
			"active_rooms": roomManager.ActiveRoomsCount(),
			"turn_enabled": cfg.Server.TURN.Enabled,
			"timestamp":    time.Now().UTC().Format(time.RFC3339),
		})
	})

	// Public ICE / STUN / TURN configuration endpoint
	mux.HandleFunc("/ice-servers", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sfuEngine.ICEServers())
	})

	serverAddr := fmt.Sprintf("0.0.0.0:%d", cfg.Server.HTTPPort)
	httpServer := &http.Server{
		Addr:    serverAddr,
		Handler: mux,
	}

	// Start HTTP server in background goroutine
	go func() {
		log.Printf("[Connected] Media server ready and listening on %s", serverAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Graceful shutdown handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("[Connected] Shutting down gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown warning: %v", err)
	}

	roomManager.Close()

	if turnServer != nil {
		if err := turnServer.Close(); err != nil {
			log.Printf("TURN server shutdown warning: %v", err)
		}
	}

	log.Println("[Connected] Server stopped cleanly")
}
