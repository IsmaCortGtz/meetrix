# Web Demo Application

The **Web Demo** is a reference frontend application showcasing the full capabilities of `@meetrix/core` in a production-style user interface inspired by modern video conferencing platforms.

---

## Features Demonstrated

- **Multi-Party Video Grid**: Dynamically resizing video tile grid supporting camera and screen sharing feeds.
- **Media Controls**: Instant mute/unmute of camera and microphone, camera device switching, and browser screen sharing.
- **Voice Activity Detection**: Real-time visual speaker indicators highlighting the currently speaking participant.
- **Chat & Emoji Reactions**: Persistent chat drawer and floating animated emoji reaction bursts.
- **Google Meet Moderation**:
  - Waiting lobby knocking and host admission notifications.
  - Remote muting of participants.
  - Force-stopping unauthorized screen shares.
  - Room capability policy locks (disable all cameras/mics/screens/chat).
- **Session Timer**: Persistent countdown timer displaying remaining call duration.

---

## Running the Web Demo

### 1. Start the Go Media Server

In a terminal window, start the Meetrix Go media server:

```bash
cd server
go run ./cmd/server -config config.json
```

### 2. Launch the Web Demo

In a second terminal window, launch the Vite dev server for `demo-web`:

```bash
cd examples/demo-web
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Source Architecture

The demo application illustrates clean separation of concerns without hard UI framework lock-in:

```text
examples/demo-web/
├── index.html          # Clean semantic UI markup
├── package.json        # Dependencies (@meetrix/core, vite, typescript)
└── src/
    ├── app.ts          # Main UI controller & MeetrixRoom initialization
    ├── grid.ts         # Video element grid layout & aspect ratio management
    ├── chat.ts         # Chat drawer & real-time message history
    ├── reactions.ts    # Floating CSS emoji burst animations
    └── moderation.ts   # Host control dialog & policy toggle handlers
```
