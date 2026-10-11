# Meetrix Authentication Webhook Server (Node.js)

This reference example demonstrates how an external Node.js backend validates meeting access and assigns roles/permissions for the Meetrix WebRTC SFU server.

## Overview
When a client connects to the Go signaling server with credentials (`room_id`, `token`, `display_name`, `metadata`), the Go server sends an HTTP `POST` to this webhook endpoint to verify authorization.

## Getting Started

### 1. Install Dependencies
From the repository root:
```bash
npm install
```
Or inside this directory:
```bash
cd examples/auth-webhook-node
npm install
```

### 2. Start the Server
```bash
node server.js
```
The server will start at `http://localhost:3001/auth/webhook`.

### 3. Server Configuration in `server/config.json`
To configure the Go Media Server to delegate authentication to this webhook, update `server/config.json`:
```json
{
  "auth": {
    "provider": "webhook",
    "webhook": {
      "url": "http://localhost:3001/auth/webhook",
      "secret": "demo-webhook-secret",
      "timeout_ms": 3000
    }
  }
}
```

### 4. Testing with cURL
```bash
curl -X POST http://localhost:3001/auth/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer demo-webhook-secret" \
  -d '{
    "room_id": "test-room",
    "token": "host-secret",
    "user_id": "usr-1",
    "display_name": "Alice"
  }'
```

**Expected Response**:
```json
{
  "allowed": true,
  "user_id": "usr-1",
  "display_name": "Alice",
  "role": "host",
  "permissions": {
    "can_publish_audio": true,
    "can_publish_video": true,
    "can_publish_screen": true,
    "can_chat": true,
    "can_react": true
  },
  "room_policy": {
    "allow_camera": true,
    "allow_mic": true,
    "allow_screen_share": true,
    "allow_chat": true,
    "allow_reactions": true,
    "require_lobby": false
  }
}
```

