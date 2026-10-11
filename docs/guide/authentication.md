# Authentication Modes

Connected features a pluggable authentication architecture designed to integrate with existing user directories, single sign-on (SSO) providers, custom backend services, or microservices without modifying core media server code.

Authentication is triggered when a client sends a `join` message with an authentication `token` over WebSocket.

---

## The Authentication Interface

All authentication providers implement the Go interface defined in `server/pkg/auth`:

```go
type Authenticator interface {
    Authenticate(ctx context.Context, req AuthRequest) (*AuthResponse, error)
}
```

### Incoming Request Payload (`AuthRequest`)

When authenticating, the server supplies the authenticator with:

```json
{
  "room_id": "team-standup",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "usr_99182",
  "display_name": "Alice Smith",
  "metadata": {
    "avatar_url": "https://example.com/alice.png",
    "department": "Engineering"
  },
  "remote_addr": "192.168.1.100:54321"
}
```

### Expected Response Payload (`AuthResponse`)

The authenticator must return an authorization decision:

```json
{
  "allowed": true,
  "user_id": "usr_99182",
  "display_name": "Alice Smith",
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
  },
  "reason": ""
}
```

If `allowed: false` is returned, the client is rejected with an `error` envelope and disconnected.

---

## 1. HTTP Webhook Authentication

The HTTP Webhook provider issues a synchronous `POST` request to an external HTTP endpoint whenever a user attempts to join a room.

### Server Configuration

```json
{
  "auth": {
    "provider": "webhook",
    "webhook": {
      "url": "https://auth.internal.example.com/api/v1/verify-session",
      "timeout_ms": 5000,
      "secret": "whsec_9f7a8b6c4d2e1f0a"
    }
  }
}
```

Environment variable overrides:
- `CONNECTED_AUTH_PROVIDER=webhook`
- `CONNECTED_AUTH_WEBHOOK_URL=https://auth.internal.example.com/api/v1/verify-session`

### HTTP Request Headers

Connected includes the following headers with each webhook POST:

| Header | Value | Description |
| :--- | :--- | :--- |
| `Content-Type` | `application/json` | Request MIME format |
| `Authorization` | `Bearer <secret>` | Configured shared webhook secret |
| `X-Connected-Signature` | `<secret>` | Webhook signature token verification |

### Node.js / Express Webhook Example

```javascript
import express from 'express';

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec_9f7a8b6c4d2e1f0a';

app.post('/api/v1/verify-session', (req, res) => {
  // 1. Verify authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return res.status(401).json({
      allowed: false,
      reason: 'Unauthorized webhook signature',
    });
  }

  const { room_id, token, user_id, display_name } = req.body;

  // 2. Validate token against your database, Redis, or session store
  if (!token || token === 'expired') {
    return res.status(403).json({
      allowed: false,
      reason: 'Session token has expired or is invalid',
    });
  }

  // 3. Determine participant role and capabilities
  const isHost = user_id === 'host-alice' || token.startsWith('host_');
  const role = isHost ? 'host' : 'participant';

  return res.status(200).json({
    allowed: true,
    user_id: user_id || 'anonymous_user',
    display_name: display_name || 'Guest User',
    role: role,
    permissions: {
      can_publish_audio: true,
      can_publish_video: true,
      can_publish_screen: isHost,
      can_chat: true,
      can_react: true,
    },
  });
});

app.listen(3000, () => console.log('Auth Webhook listening on port 3000'));
```

---

## 2. CLI Executable (`stdin/stdout`)

The CLI Executable provider delegates authentication to an external script or binary executed as a subprocess. The Go media server pipes the `AuthRequest` JSON to the subprocess via `stdin` and reads the `AuthResponse` JSON from `stdout`.

### Server Configuration

```json
{
  "auth": {
    "provider": "exec",
    "exec": {
      "command": "/usr/local/bin/auth-verifier",
      "args": ["--env=production"],
      "timeout_ms": 5000
    }
  }
}
```

Environment variable overrides:
- `CONNECTED_AUTH_PROVIDER=exec`
- `CONNECTED_AUTH_EXEC_COMMAND=/usr/local/bin/auth-verifier`

### Python Script Example (`auth_verifier.py`)

```python
#!/usr/bin/env python3
import sys
import json

def main():
    try:
        raw_input = sys.stdin.read()
        req = json.loads(raw_input)
        
        token = req.get("token", "")
        room_id = req.get("room_id", "")
        user_id = req.get("user_id", "guest")

        if not token:
            print(json.dumps({
                "allowed": False,
                "reason": "Missing token"
            }))
            sys.exit(0)

        # Assign role based on token prefix
        role = "host" if token.startswith("admin-") else "participant"

        response = {
            "allowed": True,
            "user_id": user_id,
            "display_name": req.get("display_name", user_id),
            "role": role,
            "permissions": {
                "can_publish_audio": True,
                "can_publish_video": True,
                "can_publish_screen": True,
                "can_chat": True,
                "can_react": True
            }
        }
        print(json.dumps(response))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({"allowed": False, "reason": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
```

### Bash Script Example (`auth_verifier.sh`)

```bash
#!/usr/bin/env bash
set -e

# Read JSON request from stdin
INPUT=$(cat)

TOKEN=$(echo "$INPUT" | jq -r '.token // empty')
USER_ID=$(echo "$INPUT" | jq -r '.user_id // empty')
DISPLAY_NAME=$(echo "$INPUT" | jq -r '.display_name // "Guest"')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "banned" ]; then
  echo '{"allowed": false, "reason": "Access Denied"}'
  exit 0
fi

cat <<EOF
{
  "allowed": true,
  "user_id": "${USER_ID:-guest}",
  "display_name": "${DISPLAY_NAME}",
  "role": "participant",
  "permissions": {
    "can_publish_audio": true,
    "can_publish_video": true,
    "can_publish_screen": false,
    "can_chat": true,
    "can_react": true
  }
}
EOF
```

### Node.js Script Example (`auth_verifier.js`)

```javascript
#!/usr/bin/env node
import fs from 'fs';

const input = fs.readFileSync(0, 'utf-8');
const req = JSON.parse(input);

if (req.token === 'secret-host-token') {
  console.log(JSON.stringify({
    allowed: true,
    user_id: req.user_id || 'host',
    display_name: req.display_name || 'Host User',
    role: 'host',
  }));
} else {
  console.log(JSON.stringify({
    allowed: true,
    user_id: req.user_id || 'guest',
    display_name: req.display_name || 'Participant',
    role: 'participant',
  }));
}
```

---

## 3. Native JWT Authentication

Connected natively parses and validates JSON Web Tokens without making network hops or spawning external processes.

### Supported Algorithms

- **Symmetric**: `HS256`, `HS384`, `HS512` (HMAC with shared secret)
- **Asymmetric RSA**: `RS256`, `RS384`, `RS512` (PEM-encoded RSA Public Key)
- **Asymmetric ECDSA**: `ES256`, `ES384`, `ES512` (PEM-encoded ECDSA Public Key)

### Server Configuration

::: code-group

```json [HS256 (HMAC Shared Secret)]
{
  "auth": {
    "provider": "jwt",
    "jwt": {
      "algorithm": "HS256",
      "secret": "super-secret-jwt-signing-key-32-bytes"
    }
  }
}
```

```json [RS256 (RSA Public Key)]
{
  "auth": {
    "provider": "jwt",
    "jwt": {
      "algorithm": "RS256",
      "public_key": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----"
    }
  }
}
```

:::

Environment variable overrides:
- `CONNECTED_AUTH_PROVIDER=jwt`
- `CONNECTED_AUTH_JWT_SECRET=super-secret-jwt-signing-key-32-bytes`

### Connected JWT Claims Schema

Connected parses the following registered and custom claims (`ConnectedClaims`):

```json
{
  "iss": "my-backend.example.com",
  "sub": "usr_99182",
  "exp": 1735689600,
  "nbf": 1704067200,
  "user_id": "usr_99182",
  "display_name": "Bob Vance",
  "role": "host",
  "room_id": "boardroom-a",
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

> [!NOTE] Room Scope Validation
> If the JWT contains a `room_id` claim, Connected validates that the token can **only** be used to enter that specific room. An attempt to join another room triggers an automatic token rejection.

### Token Minting in Node.js

```javascript
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  {
    sub: 'usr_alice_123',
    user_id: 'usr_alice_123',
    display_name: 'Alice Cooper',
    role: 'host',
    room_id: 'weekly-sync',
    permissions: {
      can_publish_audio: true,
      can_publish_video: true,
      can_publish_screen: true,
      can_chat: true,
      can_react: true,
    },
  },
  'super-secret-jwt-signing-key-32-bytes',
  { algorithm: 'HS256', expiresIn: '2h' }
);
```

### Token Minting in Go

```go
claims := auth.ConnectedClaims{
    RegisteredClaims: jwt.RegisteredClaims{
        Subject:   "usr_alice_123",
        ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
    },
    UserID:      "usr_alice_123",
    DisplayName: "Alice Cooper",
    Role:        "host",
    RoomID:      "weekly-sync",
}
token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
signedToken, err := token.SignedString([]byte("super-secret-jwt-signing-key-32-bytes"))
```

---

## 4. Native Go Code Extension

When building a custom Go media server or embedding Connected inside an existing enterprise backend, you can directly implement the `auth.Authenticator` interface in Go.

```go
package main

import (
    "context"
    "database/sql"
    "fmt"

    "github.com/connected-framework/connected/server/pkg/auth"
    "github.com/connected-framework/connected/server/pkg/permissions"
)

type DatabaseAuthenticator struct {
    db *sql.DB
}

func (d *DatabaseAuthenticator) Authenticate(ctx context.Context, req auth.AuthRequest) (*auth.AuthResponse, error) {
    var userID string
    var role string
    
    query := "SELECT user_id, role FROM sessions WHERE token = $1 AND room_id = $2 AND expires_at > NOW()"
    err := d.db.QueryRowContext(ctx, query, req.Token, req.RoomID).Scan(&userID, &role)
    if err == sql.ErrNoRows {
        return &auth.AuthResponse{
            Allowed: false,
            Reason:  "Invalid or expired room session",
        }, nil
    } else if err != nil {
        return nil, fmt.Errorf("database query failure: %w", err)
    }

    perms := permissions.DefaultPermissionsForRole(permissions.Role(role))

    return &auth.AuthResponse{
        Allowed:     true,
        UserID:      userID,
        DisplayName: req.DisplayName,
        Role:        permissions.Role(role),
        Permissions: &perms,
    }, nil
}
```

Simply pass your custom authenticator when initializing the signaling hub:

```go
customAuth := &DatabaseAuthenticator{db: dbConnection}
hub := signaling.NewHub(roomManager, customAuth)
```
