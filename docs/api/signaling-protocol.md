# Signaling Wire Protocol Specification

Meetrix utilizes a bidirectional WebSocket connection at `/ws` for session initiation, SDP exchange, ICE candidate trickle, real-time messaging, and moderation events.

---

## The Standard Envelope

All messages transmitted between client and server are wrapped in an envelope containing a `type` string and a structured `payload` object.

```json
{
  "type": "string",
  "payload": {}
}
```

---

## Inbound Messages (Client ➔ Server)

### `join`
Requests entry into a room. Must be the first message transmitted after WebSocket connection.

```json
{
  "type": "join",
  "payload": {
    "room_id": "finance-weekly",
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user_id": "usr_102",
    "display_name": "Sarah Connor",
    "metadata": {
      "avatar_url": "https://example.com/sarah.jpg"
    }
  }
}
```

| Field | Type | Required | Description |
| :--- | :---: | :---: | :--- |
| `room_id` | `string` | **Yes** | Unique identifier for the room. |
| `token` | `string` | No | Authentication token (JWT or custom bearer string). |
| `user_id` | `string` | No | Unique identity of the user. |
| `display_name` | `string` | No | Human-readable name rendered in participant lists. |
| `metadata` | `object` | No | Arbitrary custom key-value pairs associated with the peer. |

---

### `offer`
Transmits an SDP Offer from the client to negotiate media publication.

```json
{
  "type": "offer",
  "payload": {
    "type": "offer",
    "sdp": "v=0\r\no=- 4200636884 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n..."
  }
}
```

| Field | Type | Required | Description |
| :--- | :---: | :---: | :--- |
| `type` | `string` | **Yes** | Must be `"offer"`. |
| `sdp` | `string` | **Yes** | Complete RFC 4566 Session Description Protocol string. |

---

### `answer`
Transmits an SDP Answer responding to a server-initiated renegotiation offer.

```json
{
  "type": "answer",
  "payload": {
    "type": "answer",
    "sdp": "v=0\r\no=- 7820194883 2 IN IP4 127.0.0.1\r\ns=-\r\n..."
  }
}
```

| Field | Type | Required | Description |
| :--- | :---: | :---: | :--- |
| `type` | `string` | **Yes** | Must be `"answer"`. |
| `sdp` | `string` | **Yes** | Complete SDP Answer string. |

---

### `candidate`
Trickles a local ICE candidate to the server.

```json
{
  "type": "candidate",
  "payload": {
    "candidate": "candidate:842163049 1 udp 1677729535 192.168.1.100 56788 typ srflx raddr 10.0.0.1 rport 56788",
    "sdpMid": "0",
    "sdpMLineIndex": 0,
    "usernameFragment": "a1b2"
  }
}
```

| Field | Type | Required | Description |
| :--- | :---: | :---: | :--- |
| `candidate` | `string` | **Yes** | Candidate attribute string. |
| `sdpMid` | `string` | No | Media stream identification tag. |
| `sdpMLineIndex` | `integer` | No | Zero-based index of the m-line in the SDP. |
| `usernameFragment` | `string` | No | ICE ufrag. |

---

### `chat_message`
Broadcasts a text chat message to room participants.

```json
{
  "type": "chat_message",
  "payload": {
    "text": "Hello everyone! Can you hear me clearly?"
  }
}
```

---

### `reaction`
Dispatches a transient emoji reaction.

```json
{
  "type": "reaction",
  "payload": {
    "emoji": "👍"
  }
}
```

---

### `raise_hand`
Toggles hand-raise status in the participant roster.

```json
{
  "type": "raise_hand",
  "payload": {
    "raised": true
  }
}
```

---

### `admit_peer`
*(Moderation)* Admits a waiting peer from the lobby into the active room.

```json
{
  "type": "admit_peer",
  "payload": {
    "peer_id": "peer_8a7d6e5c"
  }
}
```

---

### `mute_peer`
*(Moderation)* Remotely mutes another participant's audio or video.

```json
{
  "type": "mute_peer",
  "payload": {
    "peer_id": "peer_8a7d6e5c",
    "media": "audio"
  }
}
```

| Field | Type | Allowed Values | Description |
| :--- | :---: | :---: | :--- |
| `peer_id` | `string` | — | Target participant ID to mute. |
| `media` | `string` | `"audio"`, `"video"` | Media kind to disable. |

---

### `stop_peer_media`
*(Moderation)* Remotely stops a participant's screen sharing.

```json
{
  "type": "stop_peer_media",
  "payload": {
    "peer_id": "peer_8a7d6e5c",
    "media": "screenshare"
  }
}
```

---

### `kick_peer`
*(Moderation)* Ejects a participant from the room.

```json
{
  "type": "kick_peer",
  "payload": {
    "peer_id": "peer_8a7d6e5c",
    "reason": "Inappropriate language"
  }
}
```

---

### `update_policies`
*(Moderation)* Updates room-wide restrictions.

```json
{
  "type": "update_policies",
  "payload": {
    "policies": {
      "allow_camera": true,
      "allow_mic": false,
      "allow_screen_share": false,
      "allow_chat": true,
      "allow_reactions": true,
      "require_lobby": true
    }
  }
}
```

---

### `leave`
Notifies the server of intentional departure before closing the WebSocket.

```json
{
  "type": "leave"
}
```

---

## Outbound Messages (Server ➔ Client)

### `joined`
Sent in response to a successful `join` request. Contains initial room metadata, self identity, and ICE servers.

```json
{
  "type": "joined",
  "payload": {
    "peer_id": "peer_1a2b3c4d",
    "user_id": "usr_102",
    "display_name": "Sarah Connor",
    "role": "host",
    "permissions": {
      "can_publish_audio": true,
      "can_publish_video": true,
      "can_publish_screen": true,
      "can_chat": true,
      "can_react": true
    },
    "policies": {
      "allow_camera": true,
      "allow_mic": true,
      "allow_screen_share": true,
      "allow_chat": true,
      "allow_reactions": true,
      "require_lobby": false
    },
    "participants": [
      {
        "id": "peer_9z8y7x6w",
        "user_id": "usr_99",
        "display_name": "John Doe",
        "role": "participant",
        "is_in_lobby": false,
        "audio_muted": false,
        "video_muted": false,
        "screen_sharing": false,
        "hand_raised": false,
        "joined_at": "2026-10-10T14:00:00Z"
      }
    ],
    "session_remaining_sec": 3600,
    "ice_servers": [
      { "urls": "stun:stun.l.google.com:19302" },
      {
        "urls": "turn:turn.example.com:3478?transport=udp",
        "username": "meetrix",
        "credential": "meetrix-secret"
      }
    ]
  }
}
```

---

### `peer_joined`
Broadcast when a new participant is admitted and enters the active room.

```json
{
  "type": "peer_joined",
  "payload": {
    "peer": {
      "id": "peer_4d3c2b1a",
      "user_id": "usr_201",
      "display_name": "Kyle Reese",
      "role": "participant",
      "is_in_lobby": false,
      "audio_muted": false,
      "video_muted": false,
      "screen_sharing": false,
      "hand_raised": false,
      "joined_at": "2026-10-10T14:02:15Z"
    }
  }
}
```

---

### `peer_left`
Broadcast when a peer disconnects or leaves.

```json
{
  "type": "peer_left",
  "payload": {
    "peer_id": "peer_4d3c2b1a"
  }
}
```

---

### `lobby_waiting`
Sent to a knocking participant when `require_lobby: true`.

```json
{
  "type": "lobby_waiting",
  "payload": {
    "message": "Waiting for host to admit you to the meeting..."
  }
}
```

---

### `lobby_peer_waiting`
Sent to hosts and co-hosts when a new participant is waiting in the lobby.

```json
{
  "type": "lobby_peer_waiting",
  "payload": {
    "peer": {
      "id": "peer_7f8e9d0c",
      "user_id": "usr_305",
      "display_name": "Guest Visitor",
      "role": "participant",
      "is_in_lobby": true
    }
  }
}
```

---

### `session_timer_tick`
Emitted every second to broadcast the remaining room duration.

```json
{
  "type": "session_timer_tick",
  "payload": {
    "remaining_sec": 299
  }
}
```

---

### `error`
Sent when an action is rejected or invalid.

```json
{
  "type": "error",
  "payload": {
    "code": "UNAUTHORIZED_MODERATION",
    "message": "Cannot moderate a participant with an equal or higher role"
  }
}
```
