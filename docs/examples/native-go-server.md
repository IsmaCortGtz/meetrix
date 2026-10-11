# Native Go Server Extension

The **Native Go Server** example demonstrates how to embed Connected as an internal Go library within a custom server application, enabling direct integration with your existing Go microservices, database pools, and custom authentication handlers.

---

## Architectural Concept

Connected is designed with modular Go packages under `server/pkg/`:
- `pkg/config`: Server and room configuration models.
- `pkg/turn`: Standalone RFC 5766/8656 STUN/TURN UDP server.
- `pkg/sfu`: Pion WebRTC SFU engine and track router.
- `pkg/room`: Room lifecycle, lobby state, and session timers.
- `pkg/signaling`: Gorilla WebSocket hub and event dispatchers.
- `pkg/auth`: Pluggable authentication interfaces.
- `pkg/permissions`: Role hierarchy and moderation policy checks.

---

## Complete Custom Go Server (`main.go`)

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"

    "github.com/IsmaCortGtz/connected/server/pkg/auth"
    "github.com/IsmaCortGtz/connected/server/pkg/config"
    "github.com/IsmaCortGtz/connected/server/pkg/permissions"
    "github.com/IsmaCortGtz/connected/server/pkg/room"
    "github.com/IsmaCortGtz/connected/server/pkg/sfu"
    "github.com/IsmaCortGtz/connected/server/pkg/signaling"
    "github.com/IsmaCortGtz/connected/server/pkg/turn"
)

// CustomAuthenticator implements auth.Authenticator using custom business logic
type CustomAuthenticator struct{}

func (c *CustomAuthenticator) Authenticate(ctx context.Context, req auth.AuthRequest) (*auth.AuthResponse, error) {
    // Custom authorization rule: users starting with "admin" become hosts
    role := permissions.RoleParticipant
    if req.UserID == "admin" || req.Token == "super-admin-key" {
        role = permissions.RoleHost
    }

    perms := permissions.DefaultPermissionsForRole(role)

    return &auth.AuthResponse{
        Allowed:     true,
        UserID:      req.UserID,
        DisplayName: req.DisplayName,
        Role:        role,
        Permissions: &perms,
    }, nil
}

func main() {
    cfg := config.DefaultConfig()
    cfg.Server.HTTPPort = 8080

    // 1. Initialize embedded STUN/TURN server
    turnServer, err := turn.NewServer(cfg.Server.TURN, cfg.Server.PublicIP)
    if err != nil {
        log.Fatalf("Failed to initialize TURN server: %v", err)
    }
    defer turnServer.Close()

    // 2. Initialize Pion SFU Media Engine
    sfuEngine, err := sfu.NewEngine(cfg.Server)
    if err != nil {
        log.Fatalf("Failed to initialize SFU engine: %v", err)
    }

    // 3. Initialize Room Manager with SFU Engine
    roomManager := room.NewManager(cfg.Room, sfuEngine)

    // 4. Initialize Signaling Hub with Custom Authenticator
    customAuth := &CustomAuthenticator{}
    hub := signaling.NewHub(roomManager, customAuth)

    // 5. Setup HTTP routes
    mux := http.NewServeMux()
    mux.HandleFunc("/ws", hub.HandleWebSocket)
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        w.Write([]byte("OK"))
    })

    server := &http.Server{
        Addr:    fmt.Sprintf(":%d", cfg.Server.HTTPPort),
        Handler: mux,
    }

    // 6. Graceful shutdown handling
    go func() {
        sigChan := make(chan os.Signal, 1)
        signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
        <-sigChan

        log.Println("Shutting down server gracefully...")
        _ = server.Shutdown(context.Background())
        roomManager.Close()
    }()

    log.Printf("Custom Go Server listening on :%d", cfg.Server.HTTPPort)
    if err := server.ListenAndServe(); err != http.ErrServerClosed {
        log.Fatalf("Server error: %v", err)
    }
}
```

---

## Running the Custom Server

```bash
cd examples/custom-go-server
go run main.go
```
