# TypeScript Core SDK Reference (`@connected/core`)

`@connected/core` is a lightweight, zero-dependency WebRTC client SDK for building audio/video conferencing applications in the browser. It exposes strictly typed APIs for device management, track handling, room lifecycle, chat, reactions, and Google Meet-style moderation.

---

## Installation

```bash
npm install @connected/core
```

---

## `ConnectedRoom`

`ConnectedRoom` is the primary orchestrator that connects local devices, WebSocket signaling, and Pion SFU peer connections into a cohesive session.

```typescript
import { ConnectedRoom } from '@connected/core';

const room = new ConnectedRoom({
  reconnectAttempts: 5,
  reconnectDelayMs: 1000,
});
```

### Constructor Options (`SignalingClientOptions`)

| Option | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `reconnectAttempts` | `number` | `5` | Maximum automatic WebSocket reconnection attempts. |
| `reconnectDelayMs` | `number` | `1000` | Initial exponential backoff delay between reconnection tries. |

### Properties & Getters

| Property | Type | Description |
| :--- | :--- | :--- |
| `state` | `RoomConnectionState` | Current connection state: `'disconnected' \| 'connecting' \| 'lobby' \| 'connected' \| 'reconnecting' \| 'failed'`. |
| `roomId` | `string` | ID of the active room. |
| `sessionRemainingSec` | `number` | Remaining call time in seconds. |
| `policy` | `RoomPolicy` | Active room-wide capability policies. |
| `localParticipant` | `LocalParticipant` | Representation of the local user and media state. |
| `localMedia` | `LocalMediaManager` | Device capture and track management service. |
| `remoteParticipants` | `Map<string, RemotePeer>` | Readonly snapshot of active remote participants. |
| `moderation` | `ModerationController` | Administrative actions controller. |

### Methods

#### `join(options: JoinOptions): Promise<JoinedPayload>`
Establishes the WebSocket connection, authenticates, and initializes WebRTC peer connections.

```typescript
const session = await room.join({
  url: 'wss://meet.example.com/ws',
  roomId: 'engineering-daily',
  token: 'jwt-or-bearer-token',
  displayName: 'Alex',
  mediaOptions: {
    camera: true,
    microphone: true,
  },
});
```

#### `leave(): Promise<void>`
Terminates local media tracks, sends the `leave` signaling packet, and cleans up WebRTC peer connections.

```typescript
await room.leave();
```

---

## Chat & Reactions API

`ConnectedRoom` provides dedicated sub-APIs for real-time messaging:

### `room.chat`

```typescript
// Send a public chat message to all room participants
await room.chat.sendMessage('Hello everyone!');
```

### `room.reactions`

```typescript
// Broadcast an emoji reaction
room.reactions.sendReaction('🎉');

// Raise or lower hand in the participant roster
room.reactions.raiseHand(true);
```

---

## `LocalParticipant` & `LocalMediaManager`

Access via `room.localParticipant` and `room.localMedia`.

### Device Capture & Media Controls

```typescript
// Start camera with 720p preset
await room.localParticipant.startCamera({ resolution: '720p' });

// Start microphone with noise cancellation
await room.localParticipant.startMicrophone({
  echoCancellation: true,
  noiseSuppression: true,
});

// Toggle mute state
room.localParticipant.muteCamera();
room.localParticipant.unmuteCamera();

room.localParticipant.muteMicrophone();
room.localParticipant.unmuteMicrophone();

// Share screen
const screenTrack = await room.localParticipant.startScreenShare({
  audio: true,
});

// Stop screen sharing
await room.localParticipant.stopScreenShare();

// Hot-swap camera hardware without renegotiating connection
await room.localParticipant.switchCamera('device-id-usb-cam');
```

### Device Enumeration

```typescript
const cameras = await room.localMedia.getCameras();
const mics = await room.localMedia.getMicrophones();
const speakers = await room.localMedia.getAudioOutputs();
```

---

## `RemotePeer`

Represents an individual remote participant in the room.

### Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Server-assigned unique peer identifier. |
| `userId` | `string` | Application user ID. |
| `displayName` | `string` | Participant display name. |
| `role` | `Role` | Participant role: `'host'`, `'co-host'`, `'participant'`, or `'viewer'`. |
| `permissions` | `UserPermissions` | Participant media and interaction permissions. |
| `audioMuted` | `boolean` | Whether participant's microphone is muted. |
| `videoMuted` | `boolean` | Whether participant's camera is muted. |
| `screenSharing` | `boolean` | Whether participant is actively sharing screen. |
| `handRaised` | `boolean` | Whether participant has raised hand. |
| `tracks` | `Map<string, TrackPublication>` | Active audio/video track publications. |
| `audioLevel` | `number` | Real-time audio volume level (0.0 to 1.0). |

---

## `ModerationController`

Access via `room.moderation`. Available actions are validated locally against the user's role before transmission to the server.

```typescript
// Admit a waiting participant from the lobby
room.moderation.admit(peerId);

// Remotely mute a participant
room.moderation.mute(peerId, 'audio');
room.moderation.mute(peerId, 'video');

// Force-stop a participant's screen share
room.moderation.stopMedia(peerId, 'screenshare');

// Eject a participant from the room
room.moderation.kick(peerId, 'Violation of code of conduct');

// Update global room policy locks
room.moderation.setRoomPolicies({
  allow_camera: false,
  allow_mic: false,
  allow_screen_share: false,
  allow_chat: true,
  allow_reactions: true,
  require_lobby: true,
});

// Check if current user can perform an action on a target peer
const canMute = room.moderation.canModeratePeer(peerId, 'mute');
```

---

## Room Events (`RoomEventMap`)

Subscribe to events via `room.on(eventName, callback)`:

```typescript
room.on('participantJoined', (peer: RemotePeer) => {
  console.log(`Participant joined: ${peer.displayName}`);
});

room.on('trackSubscribed', (track: MediaStreamTrack, pub: TrackPublication, peer: RemotePeer) => {
  if (pub.kind === 'video') {
    videoElement.srcObject = new MediaStream([track]);
  }
});

room.on('trackUnsubscribed', (track: MediaStreamTrack, pub: TrackPublication, peer: RemotePeer) => {
  console.log(`Track unsubscribed: ${track.id}`);
});

room.on('chatMessage', (msg: ChatBroadcastPayload) => {
  console.log(`[${msg.displayName}]: ${msg.text}`);
});

room.on('reaction', (reaction: ReactionBroadcastPayload) => {
  showEmojiParticle(reaction.emoji);
});

room.on('handRaised', ({ peer_id, raised }) => {
  updateHandRoster(peer_id, raised);
});

room.on('policyUpdated', (newPolicy: RoomPolicy) => {
  updateUIForPolicies(newPolicy);
});

room.on('sessionTimerTick', (remainingSec: number) => {
  updateClock(remainingSec);
});

room.on('lobbyWaiting', (message: string) => {
  showWaitingRoomScreen(message);
});

room.on('lobbyPeerWaiting', (peer: ParticipantInfo) => {
  showAdmitNotification(peer);
});
```
