# Go Server Configuration Reference

This document provides a complete reference for all configuration options available in the Connected Go Media Server. Configuration can be defined via a JSON configuration file (e.g., `config.json`) or overridden dynamically using environment variables.

---

## Configuration Loading Priority

Connected applies configuration in the following order of precedence:
1. **Environment Variables**: Overrides any file values.
2. **JSON File**: Specified via `-config <path>` command-line flag.
3. **Internal Defaults**: Safe defaults embedded in the binary.

---

## Complete `config.json` Template

```json
{
  "server": {
    "http_port": 8080,
    "webrtc_port_min": 50000,
    "webrtc_port_max": 50200,
    "public_ip": "auto",
    "turn": {
      "enabled": true,
      "realm": "connected",
      "port": 3478,
      "users": {
        "connected": "connected-secret"
      },
      "secret": "turn-shared-secret"
    }
  },
  "room": {
    "default_max_participants": 50,
    "default_session_timeout_sec": 3600,
    "empty_room_ttl_sec": 60,
    "default_policies": {
      "allow_camera": true,
      "allow_mic": true,
      "allow_screen_share": true,
      "allow_chat": true,
      "allow_reactions": true,
      "require_lobby": false
    }
  },
  "auth": {
    "provider": "allow_all",
    "webhook": {
      "url": "http://localhost:3000/auth",
      "timeout_ms": 5000,
      "secret": ""
    },
    "exec": {
      "command": "",
      "args": [],
      "timeout_ms": 5000
    },
    "jwt": {
      "secret": "connected-jwt-secret",
      "algorithm": "HS256",
      "public_key": ""
    }
  }
}
```

---

## `server` Section

Network listeners, port ranges, and embedded STUN/TURN parameters.

| Key | Type | Default | Environment Override | Description |
| :--- | :---: | :---: | :--- | :--- |
| `http_port` | `integer` | `8080` | `CONNECTED_HTTP_PORT` | TCP port for HTTP endpoints and `/ws` WebSocket signaling. |
| `webrtc_port_min` | `integer` | `50000` | `CONNECTED_WEBRTC_PORT_MIN` | Minimum UDP port for WebRTC RTP/RTCP media streams. |
| `webrtc_port_max` | `integer` | `50200` | `CONNECTED_WEBRTC_PORT_MAX` | Maximum UDP port for WebRTC RTP/RTCP media streams. |
| `public_ip` | `string` | `"auto"` | `CONNECTED_PUBLIC_IP` | Public IPv4 address announced in ICE candidates. Set to static IP in cloud environments. |

### `server.turn` Subsection

Embedded STUN/TURN RFC 5766/8656 relay configuration.

| Key | Type | Default | Environment Override | Description |
| :--- | :---: | :---: | :--- | :--- |
| `enabled` | `boolean` | `true` | `CONNECTED_TURN_ENABLED` | Toggles the embedded UDP STUN/TURN listener. |
| `realm` | `string` | `"connected"` | `CONNECTED_TURN_REALM` | Authentication realm reported to TURN clients during nonce challenge. |
| `port` | `integer` | `3478` | `CONNECTED_TURN_PORT` | UDP port on which the TURN relay listens for requests. |
| `users` | `map[string]string` | `{"connected":"connected-secret"}` | — | Key-value dictionary of static username to password credentials. |
| `secret` | `string` | `"turn-shared-secret"` | `CONNECTED_TURN_SECRET` | Shared secret for time-limited ephemeral TURN credential generation. |

---

## `room` Section

Room lifecycle parameters, capacity limits, and default moderation policies.

| Key | Type | Default | Environment Override | Description |
| :--- | :---: | :---: | :--- | :--- |
| `default_max_participants` | `integer` | `50` | `CONNECTED_ROOM_MAX_PARTICIPANTS` | Maximum active participants allowed concurrently per room. |
| `default_session_timeout_sec` | `integer` | `3600` | `CONNECTED_ROOM_SESSION_TIMEOUT` | Maximum lifespan of a room in seconds (e.g. 3600 = 60 minutes) before auto-closing. |
| `empty_room_ttl_sec` | `integer` | `60` | `CONNECTED_ROOM_EMPTY_TTL` | Retention duration in seconds to keep empty rooms in memory after all peers leave. |

### `room.default_policies` Subsection

Baseline permission rules applied upon room creation.

| Key | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `allow_camera` | `boolean` | `true` | Whether participants can publish video tracks by default. |
| `allow_mic` | `boolean` | `true` | Whether participants can publish audio tracks by default. |
| `allow_screen_share` | `boolean` | `true` | Whether participants can publish screen share tracks by default. |
| `allow_chat` | `boolean` | `true` | Whether participants can broadcast chat messages. |
| `allow_reactions` | `boolean` | `true` | Whether participants can send emoji reactions. |
| `require_lobby` | `boolean` | `false` | Whether incoming peers must wait in lobby to be admitted by a host. |

---

## `auth` Section

Authentication provider selection and provider-specific configurations.

| Key | Type | Default | Environment Override | Description |
| :--- | :---: | :---: | :--- | :--- |
| `provider` | `string` | `"allow_all"` | `CONNECTED_AUTH_PROVIDER` | Active authenticator: `"allow_all"`, `"jwt"`, `"webhook"`, or `"exec"`. |

### `auth.webhook` Subsection

Synchronous HTTP POST webhook settings.

| Key | Type | Default | Environment Override | Description |
| :--- | :---: | :---: | :--- | :--- |
| `url` | `string` | `""` | `CONNECTED_AUTH_WEBHOOK_URL` | Destination HTTP(S) URL for session verification requests. |
| `timeout_ms` | `integer` | `5000` | — | Timeout in milliseconds before rejecting the join request. |
| `secret` | `string` | `""` | — | Shared secret sent in `Authorization: Bearer <secret>` header. |

### `auth.exec` Subsection

External CLI subprocess settings (`stdin/stdout`).

| Key | Type | Default | Environment Override | Description |
| :--- | :---: | :---: | :--- | :--- |
| `command` | `string` | `""` | `CONNECTED_AUTH_EXEC_COMMAND` | Path to executable script or binary to invoke. |
| `args` | `[]string` | `[]` | — | Array of command-line arguments passed to the binary. |
| `timeout_ms` | `integer` | `5000` | — | Execution timeout in milliseconds before killing the subprocess. |

### `auth.jwt` Subsection

JSON Web Token signature validation settings.

| Key | Type | Default | Environment Override | Description |
| :--- | :---: | :---: | :--- | :--- |
| `algorithm` | `string` | `"HS256"` | — | Signing algorithm: `"HS256"`, `"HS384"`, `"HS512"`, `"RS256"`, `"RS384"`, `"RS512"`, `"ES256"`, `"ES384"`, `"ES512"`. |
| `secret` | `string` | `"connected-jwt-secret"` | `CONNECTED_AUTH_JWT_SECRET` | HMAC secret key (used for `HS*` algorithms). |
| `public_key` | `string` | `""` | — | PEM-encoded RSA or ECDSA public key (used for `RS*` and `ES*` algorithms). |
