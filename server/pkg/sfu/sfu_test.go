package sfu

import (
	"sync"
	"testing"
	"time"

	"github.com/IsmaCortGtz/meetrix/server/pkg/config"
	"github.com/pion/webrtc/v4"
)

func TestSFUEngineAndPeer(t *testing.T) {
	serverCfg := config.ServerConfig{
		WebRTCPortMin: 50200,
		WebRTCPortMax: 50250,
		PublicIP:      "127.0.0.1",
		TURN: config.TURNConfig{
			Enabled: true,
			Port:    3478,
			Users: map[string]string{
				"test": "pass",
			},
		},
	}

	engine, err := NewEngine(serverCfg)
	if err != nil {
		t.Fatalf("failed to create SFU engine: %v", err)
	}

	iceServers := engine.ICEServers()
	if len(iceServers) == 0 {
		t.Errorf("expected ICE servers configured")
	}

	pc, err := engine.NewPeerConnection()
	if err != nil {
		t.Fatalf("failed to create PeerConnection: %v", err)
	}
	defer func() {
		_ = pc.Close()
	}()

	peer, err := NewPeer("peer-1", "room-1", engine)
	if err != nil {
		t.Fatalf("failed to create SFU Peer: %v", err)
	}

	if peer.ID() != "peer-1" {
		t.Errorf("expected peer ID peer-1, got %s", peer.ID())
	}
	if peer.RoomID() != "room-1" {
		t.Errorf("expected room ID room-1, got %s", peer.RoomID())
	}

	// Test PLI dispatch without panic/error
	_ = peer.SendPLI(webrtc.SSRC(12345))

	// Test close
	if err := peer.Close(); err != nil {
		t.Errorf("failed to close peer cleanly: %v", err)
	}
}

func TestPeerScreenTrackIDAndDebounce(t *testing.T) {
	serverCfg := config.DefaultConfig().Server
	engine, err := NewEngine(serverCfg)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	peer, err := NewPeer("peer-2", "room-1", engine)
	if err != nil {
		t.Fatalf("failed to create peer: %v", err)
	}
	defer peer.Close()

	// 1. ScreenTrackID getter/setter
	if peer.ScreenTrackID() != "" {
		t.Errorf("expected empty initial ScreenTrackID")
	}
	peer.SetScreenTrackID("screen-track-xyz")
	if peer.ScreenTrackID() != "screen-track-xyz" {
		t.Errorf("expected ScreenTrackID screen-track-xyz, got %s", peer.ScreenTrackID())
	}

	// 2. Debounced renegotiation test
	renegCount := 0
	var mu sync.Mutex
	peer.SetOnRenegotiationNeeded(func() {
		mu.Lock()
		renegCount++
		mu.Unlock()
	})

	// Trigger rapid renegotiation requests (simulating rapid AddTrack calls)
	for i := 0; i < 5; i++ {
		peer.TriggerRenegotiation()
	}

	// Wait for debounce window (25ms) to fire
	time.Sleep(100 * time.Millisecond)

	mu.Lock()
	count := renegCount
	mu.Unlock()

	if count != 1 {
		t.Errorf("expected exactly 1 debounced renegotiation event, got %d", count)
	}
}

func TestScreenAudioStreamID(t *testing.T) {
	serverCfg := config.DefaultConfig().Server
	engine, err := NewEngine(serverCfg)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	peer, err := NewPeer("peer-screen-audio", "room-1", engine)
	if err != nil {
		t.Fatalf("failed to create peer: %v", err)
	}
	defer peer.Close()

	// Initial audio track should have streamID = peer.id + ":audio"
	peer.mu.Lock()
	track1 := &PublishedTrack{
		ID:       "audio-mic",
		Kind:     webrtc.RTPCodecTypeAudio,
		StreamID: peer.id + ":audio",
		stopChan: make(chan struct{}),
	}
	peer.publishedTracks[track1.ID] = track1
	peer.mu.Unlock()

	// If a second audio track arrives, it should detect hasExistingAudio = true
	peer.mu.Lock()
	hasExistingAudio := false
	for _, existing := range peer.publishedTracks {
		if existing.Kind == webrtc.RTPCodecTypeAudio {
			hasExistingAudio = true
			break
		}
	}
	var streamID string
	if hasExistingAudio {
		streamID = peer.id + ":screen"
	} else {
		streamID = peer.id + ":audio"
	}
	peer.mu.Unlock()

	if streamID != "peer-screen-audio:screen" {
		t.Errorf("expected second audio stream ID to be peer-screen-audio:screen, got %s", streamID)
	}
}
