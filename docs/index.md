---
layout: home

hero:
  name: "Meetrix"
  text: "Extensible WebRTC Video Conferencing & SFU"
  tagline: High-performance Go SFU, embedded STUN/TURN UDP relay, Google Meet-style moderation, and universal TypeScript client SDK.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quickstart
    - theme: alt
      text: Architecture
      link: /guide/architecture
    - theme: alt
      text: API Reference
      link: /api/client-core-sdk
  image:
    src: /logo.svg
    alt: Meetrix Logo

features:
  - icon: ⚡
    title: High-Performance Go SFU
    details: Powered by Pion WebRTC v4 with selective forwarding unit (SFU) architecture, dynamic RTP port allocation, and automatic PLI keyframe synchronization.
  - icon: 🔄
    title: Embedded STUN & TURN
    details: Built-in RFC 5766/8656 TURN UDP server on port 3478. Traverses symmetric NATs and firewalls without requiring coturn or external relay infrastructure.
  - icon: 🛡️
    title: 4 Pluggable Auth Modes
    details: Zero-friction authentication via HTTP Webhook, CLI executable (stdin/stdout), native JWT (HS256/RS256/ES256), or direct Go interface implementations.
  - icon: 👥
    title: Google Meet Moderation
    details: Built-in waiting room / lobby knocking & admitting, hierarchical roles (Host, Co-Host, Participant, Viewer), remote muting, media locks, and session countdown timers.
  - icon: 📦
    title: Universal TypeScript SDK
    details: Zero external UI dependencies, strict TypeScript typings, tree-shakeable dual ESM/CJS bundles, and typed event emitter for browser clients.
  - icon: 🐳
    title: Production Ready
    details: Pre-configured Docker, Docker Compose, NAT 1:1 public IP mapping, Nginx and Caddy reverse proxy guides, and automated GitHub Pages documentation.
---

<div class="vp-doc" style="margin-top: 3rem;">

## High-Level Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Applications"]
        Host["Host (WebRTC + WS)<br/>@meetrix/core"]
        User1["Participant 1<br/>@meetrix/core"]
        User2["Participant 2<br/>@meetrix/core"]
        Lobby["Knocking User<br/>(Lobby State)"]
    end

    subgraph Server["Meetrix Go Media Server"]
        subgraph Signaling["Signaling Plane (:8080 TCP)"]
            WSHub["WebSocket Hub"]
            Auth["Auth Provider<br/>(Webhook / Exec / JWT / Go)"]
            Perms["Permissions & Moderation<br/>(Role Hierarchy)"]
            RoomMgr["Room Manager<br/>(Lobby & Session Timers)"]
        end

        subgraph Media["Media Plane (:50000-50200 UDP)"]
            SFU["Pion WebRTC SFU"]
            TrackRouter["Track Router & RTP Forwarder"]
            PLICache["PLI Keyframe Dispatcher"]
        end

        subgraph Relay["Relay Plane (:3478 UDP)"]
            TURN["Embedded STUN/TURN Listener"]
        end
    end

    Host <-->|WebSocket: Signaling & Moderation| WSHub
    User1 <-->|WebSocket: Signaling & Chat| WSHub
    User2 <-->|WebSocket: Signaling & Chat| WSHub
    Lobby <-->|WebSocket: Knock / Admit| WSHub

    WSHub --> Auth
    WSHub --> Perms
    Perms --> RoomMgr

    Host <===>|WebRTC SRTP Tracks| SFU
    User1 <===>|WebRTC SRTP Tracks| SFU
    User2 <===>|WebRTC SRTP Tracks| SFU

    SFU --- TrackRouter
    TrackRouter --- PLICache
    User2 -.->|Symmetric NAT Relay| TURN
```

## Quick Installation

::: code-group

```bash [TypeScript SDK]
npm install @meetrix/core
```

```bash [Go Server Core]
git clone https://github.com/IsmaCortGtz/meetrix.git
cd meetrix/server
go build -o meetrix-server ./cmd/server
./meetrix-server -config config.json
```

```bash [Docker Compose]
docker compose up -d
```

:::

## Key Metrics & Capabilities

| Capability | Specification |
| :--- | :--- |
| **Media Plane Architecture** | Pion WebRTC v4 SFU (Selective Forwarding Unit) |
| **Relay Server** | Embedded RFC 5766/8656 STUN/TURN UDP listener on port `3478` |
| **Signaling Protocol** | Real-time WebSocket envelope protocol (`join`, `offer`, `answer`, `candidate`, `chat`, `moderation`) |
| **Authentication Providers** | HTTP Webhook, CLI executable `stdin/stdout`, Native JWT (`HS256`/`RS256`), Native Go interface |
| **Moderation Engine** | Google Meet-style Roles (`host`, `co-host`, `participant`, `viewer`), Waiting Lobby, Remote Mute, Policy Locks |
| **Client Core SDK** | `@meetrix/core` (Dual ESM/CJS, IIFE global, strict DTS typings, zero UI opinions) |
| **Port Allocation** | TCP `8080` (HTTP/Signaling), UDP `3478` (STUN/TURN), UDP `50000-50200` (WebRTC RTP/RTCP) |

</div>
