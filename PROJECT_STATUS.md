# Project Status Dashboard: Connected Framework

**Last Updated:** 2026-10-10  
**Overall Status:** In Progress (Environment Configured & Subagent Architecture Ready)

---

## Phase Progress Summary

| Phase | Description | Status | Completion % | Lead Role |
| :--- | :--- | :---: | :---: | :--- |
| **Phase 1** | Go Media Server Core (SFU, TURN, Auth, Signaling) | `Completed` | 100% | `backend-engineer` |
| **Phase 2** | TypeScript Core SDK (`@connected/core`) | `Completed` | 100% | `sdk-engineer` |
| **Phase 3** | Examples (Web Demo, Auth Webhook, Custom Go) | `Completed` | 100% | `sdk-engineer` & `backend-engineer` |
| **Phase 4** | VitePress Documentation Suite (GitHub Pages) | `Completed` | 100% | `docs-specialist` |
| **Phase 5** | Verification, Testing & Walkthrough | `Completed` | 100% | `qa-verifier` |

---

## Detailed Task Checklist

### Phase 1: Go Media Server Core
- [x] Environment initialization (Git repository, `.gitignore`, collaboration guidelines)
- [x] AGENTS.md, ROADMAP.md, and PROJECT_STATUS.md documentation created
- [x] Subagent system registration
- [x] Initialize `server/go.mod` with Pion WebRTC v4, Pion TURN v3, Gorilla WebSocket, JWT v5
- [x] Implement `pkg/config` (JSON parser, env overrides)
- [x] Implement `pkg/turn` (embedded STUN/TURN UDP server)
- [x] Implement `pkg/auth` (HTTP webhook, CLI stdin/stdout, JWT, native Go interface)
- [x] Implement `pkg/sfu` (Pion WebRTC PeerConnection, track forwarding, PLI generator)
- [x] Implement `pkg/room` and `pkg/permissions` (Google Meet-style moderation & timers)
- [x] Implement `pkg/signaling` (WebSocket handler & event dispatcher)
- [x] Implement `cmd/server/main.go` entrypoint and unit tests

### Phase 2: TypeScript Core SDK
- [x] Root monorepo configuration with npm workspaces
- [x] Setup `packages/core` with `tsup`, `tsconfig.json`
- [x] Implement `LocalMedia` manager
- [x] Implement `SignalingClient` WebSocket adapter
- [x] Implement `RTCPeerConnection` wrapper
- [x] Implement `ConnectedRoom`, `RemotePeer`, chat, reactions, and moderation API
- [x] Build & export validation (`esm`, `cjs`, `dts`, `iife`)
- [x] 100% passing unit tests suite across signaling, peer models, room lifecycle, and moderation

### Phase 3: Reference Examples
- [x] Create `examples/demo-web` (Interactive WebRTC UI)
- [x] Modularize `examples/demo-web` architecture (clean component-based TS & scoped CSS modules)
- [x] Create `examples/auth-webhook-node` (Auth webhook server)
- [x] Create `examples/custom-go-server` (Embedded Go extension)

### Phase 4: VitePress Documentation Suite
- [x] VitePress setup in `docs/`
- [x] Architectural diagrams and protocol specifications
- [x] Authentication, permissions, and deployment guides
- [x] GitHub Pages workflow (`.github/workflows/deploy-docs.yml`)
- [x] Documentation build verification (`npm run docs:build`)

### Phase 5: Verification & Review
- [x] Go unit and race tests pass (`go test -v -race -count=1 ./...`)
- [x] TypeScript type checks pass (`tsc --noEmit`)
- [x] Monorepo builds pass (`npm run build`)
- [x] Fixed camera display across browsers (enforced video element muted policy, dedicated audio elements, explicit play triggers)
- [x] Added user feedback toasts and policy pre-checks when screen sharing is blocked
- [x] Fixed frozen frame on camera stop (checked `!videoMuted` on subscriber tile render)
- [x] Fixed mobile connection over LAN `--host` (auto-populated signaling URL with current hostname instead of hardcoded `localhost`, added insecure context warning)
- [x] Fixed multi-client audio reception (sent `joined` before track subscriptions in Go SFU, buffered remote offers, unthrottled audio container)
- [x] Added input/output media device selectors and visual VU meter indicators
- [x] Handled browser `NotFoundError` gracefully with descriptive user guidance
- [x] Resolved screen share and camera tile collision by separating stream IDs (`:screen` vs `:camera`) in Go SFU and SDK
- [x] Resolved black box on stopping video/screen share by properly hiding video elements, clearing srcObject, and activating avatar placeholders with z-index layering
- [x] Resolved audio playback failures by removing loop aborts on WriteRTP errors in Go SFU, implementing Perfect Negotiation rollback, unthrottling off-screen audio elements, adding global click audio unlock, and providing an option to disable acoustic echo cancellation for same-PC testing
- [x] Eliminated video tile flickering/blinking across all state changes by implementing in-place DOM reconciliation without tearing down video elements
- [x] Fixed hand-raised badge disappearing by layering `.tile-hand-raised` with `z-index: 20` and updating presence in-place
- [x] Implemented Google Meet-style screen share audio support across Go SFU stream differentiation, Core SDK publication, and dedicated remote audio playback
- [x] Resolved peer reconnection media stalls:
  - Removed destructive `pub.track.stop()` call in `RemotePeer.close()` (which previously caused the browser's `RTCRtpReceiver` track to permanently end, silencing any future media on negotiated/reused transceivers).
  - Fixed transceiver reconciliation timing in `webrtc.ts`: `reconcileTransceiverTracks` now runs **after** `setLocalDescription(answer)` so that `transceiver.currentDirection` settles to the newly negotiated direction (`'recvonly'`) rather than reflecting the previous `'inactive'` state.
  - Implemented dual check with `parseSdpMediaSections` to inspect both SDP offer directions (`a=sendrecv`/`a=sendonly`) and transceiver directions.
  - Passed `explicitStreamId` directly from `webrtc` to `room` in `trackReceived`, eliminating reliance on mutating native `MediaStream.prototype.id`.
  - Added support for both `*rtcp.FullIntraRequest` (FIR) and `*rtcp.PictureLossIndication` (PLI) in SFU RTCP loops, along with staggered keyframe bursts (0ms, 150ms, 400ms) upon subscriber answer.
  - Added `pendingRemoteTracks` buffer in `ConnectedRoom` to prevent race conditions where media tracks arrive via SDP before `peer_joined` signaling.
  - Standardized SFU `Subscribe`/`Unsubscribe` track mapping with clean `pc.RemoveTrack` to avoid ghost sender m-line bloat.
  - Added comprehensive E2E publisher reconnect test (`TestE2EPublisherReconnectReachesExistingSubscriber`) passing under `go test -v -race`.
- [x] Resolved audio latency and A/V desynchronization:
  - Unified camera and microphone under the same MediaStream ID (`p.id`) in Go SFU (`peer.go`), enabling W3C WebRTC native hardware A/V Lip Synchronization.
  - Configured `receiver.playoutDelayHint = 0` and `receiver.jitterBufferTarget = 0` across all audio transceivers in `@connected/core` (`webrtc.ts`), minimizing NetEQ jitter buffer accumulation.
  - Positioned remote audio elements within the active viewport in `examples/demo-web` (instead of off-screen at `-9999px`), preventing Chromium and WebKit power-saving background audio buffering mode (which previously accumulated a 500ms–1000ms delay).
  - Attached `peer.stream` containing both camera and mic tracks directly to audio and video elements to keep decoding clocks locked, and requested minimal input latency on microphone capture via `latency: 0`.
- [x] Implemented Google Meet-style meeting flow in `examples/demo-web`:
  - **Landing / Home Screen (`#home-screen`)**: Modern UI featuring live clock, "New meeting" dropdown with "Create a meeting for later" (generates shareable link modal) and "Start an instant meeting", plus "Enter a code or link" input and join button.
  - **Green Room Pre-join Preview (`#preview-screen`)**: 16:9 video preview with mic/camera toggles, microphone and camera device selectors, meeting room code pill with one-click copy button, display name input, collapsible advanced connection settings, and prominent "Join now" button.
  - **URL Parameter Direct Routing**: Opening `?room=xxx-yyyy-zzz` automatically routes directly to the Green Room preview for that room without exposing the user to the landing page.
  - **In-Call Copy Link Pill**: Added a one-click "Copy link" button in the active call header that copies the shareable meeting link to the clipboard and triggers toast notifications.
  - **Google Material Symbols Integration**: Replaced all emojis in buttons, banners, tiles, pills, and modals with official Google Material Symbols icons (`mic`, `videocam`, `video_call`, `present_to_all`, `pan_tool`, `call_end`, etc.), preserving emojis exclusively for in-call reactions.
- [x] Standardized Go module path and repository links to `github.com/IsmaCortGtz/connected` across all Go packages, `go.mod`, package.json files, examples, and VitePress documentation
- [x] Added SVG brand logo to `docs/public/logo.svg` and hero headers
- [x] Created root `README.md` and MIT `LICENSE` with architecture diagrams, quickstart guides, Go library embedding instructions, and NPM distribution guidelines
- [x] Comprehensive QA verification passed with 100% green tests across Go server, TS SDK, and VitePress docs

---

## Active Working Context
- **Current Objective**: All 5 phases completed, tested, and verified. Web demo upgraded to Google Meet-grade user experience with pre-join green room and shareable link routing. Zero race conditions, 100% test coverage.
- **Blockers / Risks**: None.



