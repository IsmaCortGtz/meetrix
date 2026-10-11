# Custom Go Media Server Example

This example demonstrates how an external Go developer can import the modular packages of the **Connected** WebRTC SFU framework to build a fully customized media server with proprietary authentication, room policies, and custom HTTP endpoints.

---

## Key Features Demonstrated

1. **Native Authenticator Interface (`auth.Authenticator`)**:
   Implement custom database, in-memory, or Redis token verification directly in Go without running external HTTP webhooks or child CLI processes.
   ```go
   type DatabaseTokenAuthenticator struct { ... }

   func (a *DatabaseTokenAuthenticator) Authenticate(ctx context.Context, req auth.AuthRequest) (*auth.AuthResponse, error) {
       // Validate token against internal database / cache
   }
   ```

2. **Custom Room Policies**:
   Customize policies such as webinar mode:
   - `RequireLobby: true`: Participants wait in the lobby until admitted by a host.
   - `AllowScreenShare: false`: Restrict screen sharing to hosts and co-hosts.
   - Custom session timeouts and participant limits.

3. **Hybrid HTTP Endpoints**:
   Serve custom REST APIs (such as `/api/tokens` to dynamically provision meeting tokens) alongside the `/ws` WebRTC signaling endpoint on the same HTTP server.

4. **Embedded STUN/TURN & Pion SFU**:
   Directly control the embedded TURN server port, realm, and Pion WebRTC media engine settings in code.

---

## Quickstart

### 1. Build the binary

From this directory:

```bash
go build -o custom-server main.go
```

### 2. Run the server

```bash
./custom-server
```

The server starts listening on `http://localhost:8090` and TURN UDP port `3479`.

---

## Pre-provisioned Test Tokens

The sample server comes with pre-configured tokens for testing the `webinar-room`:

| Token | User ID | Display Name | Role | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `host-secret-token` | `host_usr_01` | Dr. Alice (Host) | `host` | Bypasses lobby, can screen share & moderate |
| `cohost-secret-token` | `cohost_usr_02` | Bob (Co-Host) | `co-host` | Bypasses lobby, can admit participants |
| `student-token-1` | `student_usr_03` | Charlie (Student) | `participant` | Placed in lobby on join, screen share blocked |
| `viewer-token-1` | `viewer_usr_04` | Dave (Audience) | `viewer` | Placed in lobby, receive-only once admitted |

---

## Provisioning Tokens Dynamically

You can register new tokens dynamically via the included REST endpoint:

```bash
curl -X POST http://localhost:8090/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "token": "guest-token-123",
    "user_id": "usr_99",
    "display_name": "Guest Speaker",
    "role": "co-host",
    "room_id": "webinar-room"
  }'
```

---

## Connecting Clients

Connect using any WebSocket WebRTC client or the `@connected/core` TypeScript SDK to `ws://localhost:8090/ws`:

```json
{
  "type": "join",
  "payload": {
    "room_id": "webinar-room",
    "token": "host-secret-token"
  }
}
```
