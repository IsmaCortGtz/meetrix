# Quickstart Guide

This guide will walk you through setting up a local Meetrix environment, starting the Go SFU media server, and connecting two browser peers using the `@meetrix/core` client SDK.

---

## Prerequisites

Before starting, ensure you have the following installed on your machine:
- **Go 1.24+** (for running the media server)
- **Node.js 20+** and **npm** (for the client SDK and web apps)
- A modern browser with WebRTC support (Chrome, Firefox, Safari, Edge)

---

## Step 1: Clone the Repository

Clone the repository and install repository dependencies:

```bash
git clone https://github.com/IsmaCortGtz/meetrix.git
cd meetrix
npm install
```

---

## Step 2: Start the Go Media Server

The Go server contains an embedded STUN/TURN UDP listener and the Pion SFU router. By default, it runs with the `allow_all` authentication provider, allowing immediate local testing without external authentication services.

Navigate to the `server/` directory and run the server using `go run`:

::: code-group

```bash [Using go run]
cd server
go run ./cmd/server -config config.json
```

```bash [Building binary]
cd server
go build -o meetrix-server ./cmd/server
./meetrix-server -config config.json
```

:::

You should see log output confirming that both the HTTP/WebSocket signaling service and the STUN/TURN listener are active:

```text
2026/10/10 14:00:00 [CONFIG] Loaded config from "config.json"
2026/10/10 14:00:00 [TURN] Embedded STUN/TURN server listening on 0.0.0.0:3478 (realm: meetrix)
2026/10/10 14:00:00 [SFU] Initialized Pion SFU (Port range: 50000-50200, Public IP: auto)
2026/10/10 14:00:00 [AUTH] Initialized Authenticator: allow_all
2026/10/10 14:00:00 [SERVER] Meetrix SFU signaling server running on http://0.0.0.0:8080
```

---

## Step 3: Install the Client SDK

Install `@meetrix/core` into your frontend project:

```bash
npm install @meetrix/core
```

If you are developing inside the monorepo, build the package first:

```bash
npm run build:core
```

---

## Step 4: Create Your First Call

Here is a minimal, complete browser implementation using vanilla TypeScript or modern JavaScript.

### HTML Structure (`index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Meetrix WebRTC Call</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; background: #0f172a; color: #f8fafc; }
    .grid { display: flex; gap: 1rem; margin-top: 1rem; }
    video { width: 400px; height: 300px; background: #1e293b; border-radius: 8px; object-fit: cover; }
    button { padding: 0.5rem 1rem; font-weight: bold; cursor: pointer; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Meetrix WebRTC Quickstart</h1>
  <button id="joinBtn">Join Room</button>
  <button id="leaveBtn" disabled>Leave Room</button>

  <div class="grid">
    <div>
      <h3>Local Video</h3>
      <video id="localVideo" autoplay playsinline muted></video>
    </div>
    <div>
      <h3>Remote Video</h3>
      <div id="remoteContainer"></div>
    </div>
  </div>

  <script type="module" src="./app.ts"></script>
</body>
</html>
```

### Application Logic (`app.ts`)

```typescript
import { MeetrixRoom } from '@meetrix/core';

// 1. Instantiate the room client
const room = new MeetrixRoom();

const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement;
const leaveBtn = document.getElementById('leaveBtn') as HTMLButtonElement;
const localVideo = document.getElementById('localVideo') as HTMLVideoElement;
const remoteContainer = document.getElementById('remoteContainer') as HTMLDivElement;

// 2. Listen for remote media tracks
room.on('trackSubscribed', (track, publication, peer) => {
  console.log(`Subscribed to ${publication.kind} track from peer: ${peer.displayName} (${peer.id})`);

  if (publication.kind === 'video') {
    const videoElem = document.createElement('video');
    videoElem.id = `video-${peer.id}`;
    videoElem.autoplay = true;
    videoElem.playsInline = true;
    videoElem.srcObject = new MediaStream([track]);
    remoteContainer.appendChild(videoElem);
  } else if (publication.kind === 'audio') {
    const audioElem = document.createElement('audio');
    audioElem.id = `audio-${peer.id}`;
    audioElem.autoplay = true;
    audioElem.srcObject = new MediaStream([track]);
    remoteContainer.appendChild(audioElem);
  }
});

// 3. Handle remote track cleanup when peers leave or unpublish
room.on('trackUnsubscribed', (track, publication, peer) => {
  if (publication.kind === 'video') {
    document.getElementById(`video-${peer.id}`)?.remove();
  } else if (publication.kind === 'audio') {
    document.getElementById(`audio-${peer.id}`)?.remove();
  }
});

room.on('participantLeft', (peerId) => {
  console.log(`Peer left: ${peerId}`);
  document.getElementById(`video-${peerId}`)?.remove();
  document.getElementById(`audio-${peerId}`)?.remove();
});

// 4. Join the room on button click
joinBtn.onclick = async () => {
  joinBtn.disabled = true;

  try {
    const joinPayload = await room.join({
      url: 'ws://localhost:8080/ws',
      roomId: 'test-room-1',
      displayName: `User-${Math.floor(Math.random() * 1000)}`,
      mediaOptions: {
        camera: true,
        microphone: true,
      },
    });

    console.log('Successfully joined room:', joinPayload);

    // Attach local camera stream to the local preview video element
    if (room.localMedia.cameraStream) {
      localVideo.srcObject = room.localMedia.cameraStream;
    }

    leaveBtn.disabled = false;
  } catch (err) {
    console.error('Failed to join call:', err);
    joinBtn.disabled = false;
  }
};

// 5. Leave the room cleanly
leaveBtn.onclick = async () => {
  await room.leave();
  localVideo.srcObject = null;
  remoteContainer.innerHTML = '';
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  console.log('Left the call.');
};
```

---

## Step 5: Test Multi-Peer Conferencing

1. Open `http://localhost:5173` (or your local web dev server) in your primary browser window.
2. Click **Join Room**. Allow camera and microphone permissions when prompted.
3. Open a second browser window (or Incognito mode) and navigate to the same URL.
4. Click **Join Room** in the second window.
5. Within seconds, WebRTC ICE candidates are negotiated via WebSocket, the Go SFU routes the VP8/Opus media packets, and both windows will display remote video and audio streams!

---

## Troubleshooting Common Issues

### 1. Mobile Phone & LAN Connection (`--host`)
When accessing the web client from another device on your local network (e.g., your smartphone at `http://192.168.1.X:3000`):
- **Signaling Server URL**: Ensure the signaling server input is set to your computer's LAN IP address (`ws://192.168.1.X:8080/ws`), **NOT** `localhost`. (The demo web application now auto-populates this based on the current hostname).
- **Secure Context & Mobile Camera Permissions**: Modern mobile browsers (Chrome Android, Safari iOS) **block** camera and microphone access on insecure HTTP IP origins. To test on mobile over LAN:
  1. Use an HTTPS reverse proxy (such as Caddy, Nginx, or ngrok), OR
  2. In Chrome on Android, navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://192.168.1.X:3000`, and restart the browser.

### 2. Camera Error: "The object can not be found here"
- **Cause**: This is the standard browser `NotFoundError` (common in Firefox on Linux) thrown by `navigator.mediaDevices.getUserMedia` when no physical camera hardware (`/dev/video*`) is detected on the machine or the webcam is in exclusive use by another application.
- **Solution**: Plug in a webcam, check OS permissions, or test on a laptop with an integrated camera.

### 3. Testing Audio on Two Tabs of the Same PC
- **Acoustic Echo Cancellation (AEC)**: When running two tabs on the same computer, the browser's echo cancellation recognizes that the speaker output matches the local mic input and suppresses the sound to prevent feedback loops.
- **Device Selector**: Use the device dropdown in the demo application to select different microphones or audio outputs, or test between two separate devices.
- **Autoplay Policy**: If the browser pauses incoming audio before user interaction, click the "Enable Audio" prompt.

---

## Next Steps

- Check out the [Architecture Guide](/guide/architecture) for details on media forwarding and PLI synchronization.
- Learn how to configure roles and Google Meet-style lobby knocking in [Permissions & Moderation](/guide/permissions-moderation).
- Configure production credentials and JWT authentication in [Authentication Modes](/guide/authentication).
