# Auth Webhook Service (Node.js)

The **Auth Webhook** example demonstrates how to integrate Meetrix with an existing Node.js / Express backend service using HTTP Webhook authentication.

---

## Architecture

Whenever a client attempts to connect to the Go SFU server via WebSocket with a `join` message, the server issues a synchronous HTTP POST request to the webhook service.

```mermaid
sequenceDiagram
    autonumber
    actor Client as User (@meetrix/core)
    participant SFU as Meetrix Go SFU
    participant AuthWebhook as Auth Webhook (Node.js)
    participant Database as User Database

    Client->>SFU: WebSocket "join" (token, room_id, user_id)
    SFU->>AuthWebhook: POST /auth (AuthRequest JSON, Bearer secret)
    AuthWebhook->>Database: Query session & role permissions
    Database-->>AuthWebhook: Valid session (Role: "host")
    AuthWebhook-->>SFU: 200 OK (AuthResponse JSON)
    SFU-->>Client: WebSocket "joined" (ICE servers & room state)
```

---

## Running the Example

### 1. Install Dependencies

```bash
cd examples/auth-webhook-node
npm install
```

### 2. Start the Webhook Server

```bash
npm start
```

By default, the webhook server runs at `http://localhost:3000/auth`.

### 3. Configure Meetrix Server

Update `server/config.json` to use the webhook provider:

```json
{
  "auth": {
    "provider": "webhook",
    "webhook": {
      "url": "http://localhost:3000/auth",
      "timeout_ms": 5000,
      "secret": "my-shared-webhook-secret"
    }
  }
}
```

Or run the Go server with environment variables:

```bash
MEETRIX_AUTH_PROVIDER=webhook \
MEETRIX_AUTH_WEBHOOK_URL=http://localhost:3000/auth \
go run ./cmd/server -config config.json
```

---

## Testing via cURL

You can verify the webhook endpoint directly:

```bash
curl -X POST http://localhost:3000/auth \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-shared-webhook-secret" \
  -d '{
    "room_id": "demo-room",
    "token": "host-token-xyz",
    "user_id": "usr_101",
    "display_name": "Admin Alice"
  }'
```

Expected response:

```json
{
  "allowed": true,
  "user_id": "usr_101",
  "display_name": "Admin Alice",
  "role": "host",
  "permissions": {
    "can_publish_audio": true,
    "can_publish_video": true,
    "can_publish_screen": true,
    "can_chat": true,
    "can_react": true
  }
}
```
