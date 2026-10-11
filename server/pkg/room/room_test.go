package room

import (
	"sync"
	"testing"
	"time"

	"github.com/connected-framework/connected/server/pkg/config"
	"github.com/connected-framework/connected/server/pkg/permissions"
	"github.com/connected-framework/connected/server/pkg/sfu"
	"github.com/pion/webrtc/v4"
)

type mockSender struct {
	mu       sync.Mutex
	messages [][]byte
	closed   bool
}

func (m *mockSender) Send(msg []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, msg)
	return nil
}

func (m *mockSender) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	return nil
}

func TestParticipantLifecycle(t *testing.T) {
	sender := &mockSender{}
	p := NewParticipant(
		"p-1",
		"u-1",
		"Alice",
		permissions.RoleParticipant,
		permissions.DefaultPermissionsForRole(permissions.RoleParticipant),
		false,
		nil,
		sender,
	)

	info := p.Info()
	if info.ID != "p-1" || info.DisplayName != "Alice" {
		t.Errorf("unexpected participant info: %+v", info)
	}

	p.SetAudioMuted(true)
	p.SetVideoMuted(true)
	p.SetScreenSharing(true)
	p.SetHandRaised(true)

	infoUpdated := p.Info()
	if !infoUpdated.AudioMuted || !infoUpdated.VideoMuted || !infoUpdated.ScreenSharing || !infoUpdated.HandRaised {
		t.Errorf("failed to update participant state flags")
	}

	if err := p.Send([]byte("hello")); err != nil {
		t.Fatalf("send failed: %v", err)
	}

	sender.mu.Lock()
	if len(sender.messages) != 1 || string(sender.messages[0]) != "hello" {
		t.Errorf("expected message 'hello' received by sender")
	}
	sender.mu.Unlock()

	p.Close()
	sender.mu.Lock()
	if !sender.closed {
		t.Errorf("expected sender to be closed")
	}
	sender.mu.Unlock()
}

func TestRoomAddRemove(t *testing.T) {
	emptyCalled := make(chan string, 1)
	room := NewRoom(
		"test-room",
		10,
		0,
		permissions.RoomPolicy{AllowCamera: true, AllowMic: true},
		func(roomID string) { emptyCalled <- roomID },
		nil,
	)

	p1 := NewParticipant("p-1", "u-1", "Alice", permissions.RoleHost, permissions.DefaultPermissionsForRole(permissions.RoleHost), false, nil, &mockSender{})
	p2 := NewParticipant("p-2", "u-2", "Bob", permissions.RoleParticipant, permissions.DefaultPermissionsForRole(permissions.RoleParticipant), false, nil, &mockSender{})

	if err := room.AddParticipant(p1); err != nil {
		t.Fatalf("failed to add p1: %v", err)
	}
	if err := room.AddParticipant(p2); err != nil {
		t.Fatalf("failed to add p2: %v", err)
	}

	active, lobby := room.ParticipantCount()
	if active != 2 || lobby != 0 {
		t.Errorf("expected 2 active, got %d, lobby %d", active, lobby)
	}

	room.Broadcast([]byte("ping"))
	sender1 := p1.Sender.(*mockSender)
	sender2 := p2.Sender.(*mockSender)

	sender1.mu.Lock()
	if len(sender1.messages) != 1 {
		t.Errorf("expected 1 message for p1")
	}
	sender1.mu.Unlock()

	sender2.mu.Lock()
	if len(sender2.messages) != 1 {
		t.Errorf("expected 1 message for p2")
	}
	sender2.mu.Unlock()

	// Remove p1
	removedP, remaining := room.RemoveParticipant(p1.ID)
	if removedP == nil || remaining != 1 {
		t.Errorf("expected 1 remaining participant, got %d", remaining)
	}

	// Remove p2 (triggers empty callback)
	_, remaining2 := room.RemoveParticipant(p2.ID)
	if remaining2 != 0 {
		t.Errorf("expected 0 remaining, got %d", remaining2)
	}

	select {
	case roomID := <-emptyCalled:
		if roomID != "test-room" {
			t.Errorf("expected empty callback for 'test-room', got %s", roomID)
		}
	case <-time.After(1 * time.Second):
		t.Errorf("timeout waiting for empty room callback")
	}
}

func TestRoomMaxCapacity(t *testing.T) {
	room := NewRoom(
		"capacity-room",
		1, // Max capacity 1
		0,
		permissions.RoomPolicy{},
		nil,
		nil,
	)

	p1 := NewParticipant("p-1", "u-1", "Alice", permissions.RoleHost, permissions.DefaultPermissionsForRole(permissions.RoleHost), false, nil, &mockSender{})
	p2 := NewParticipant("p-2", "u-2", "Bob", permissions.RoleParticipant, permissions.DefaultPermissionsForRole(permissions.RoleParticipant), false, nil, &mockSender{})

	if err := room.AddParticipant(p1); err != nil {
		t.Fatalf("unexpected error adding p1: %v", err)
	}

	if err := room.AddParticipant(p2); err != ErrRoomFull {
		t.Errorf("expected ErrRoomFull, got %v", err)
	}
}

func TestRoomLobby(t *testing.T) {
	room := NewRoom(
		"lobby-room",
		10,
		0,
		permissions.RoomPolicy{RequireLobby: true},
		nil,
		nil,
	)

	host := NewParticipant("p-host", "u-host", "Host", permissions.RoleHost, permissions.DefaultPermissionsForRole(permissions.RoleHost), false, nil, &mockSender{})
	guest := NewParticipant("p-guest", "u-guest", "Guest", permissions.RoleParticipant, permissions.DefaultPermissionsForRole(permissions.RoleParticipant), false, nil, &mockSender{})

	// Host should bypass lobby
	if err := room.AddParticipant(host); err != nil {
		t.Fatalf("failed to add host: %v", err)
	}
	if host.IsInLobby {
		t.Errorf("host should not be placed in lobby")
	}

	// Guest should be routed to lobby
	if err := room.AddParticipant(guest); err != nil {
		t.Fatalf("failed to add guest: %v", err)
	}
	if !guest.IsInLobby {
		t.Errorf("guest should be placed in lobby")
	}

	active, lobby := room.ParticipantCount()
	if active != 1 || lobby != 1 {
		t.Errorf("expected 1 active, 1 lobby; got active %d, lobby %d", active, lobby)
	}

	// Admit guest from lobby
	admitted, err := room.AdmitFromLobby(guest.ID)
	if err != nil {
		t.Fatalf("failed to admit guest: %v", err)
	}
	if admitted.IsInLobby {
		t.Errorf("admitted guest should no longer be in lobby")
	}

	activeAfter, lobbyAfter := room.ParticipantCount()
	if activeAfter != 2 || lobbyAfter != 0 {
		t.Errorf("expected 2 active, 0 lobby; got active %d, lobby %d", activeAfter, lobbyAfter)
	}
}

func TestSessionTimer(t *testing.T) {
	tickCount := 0
	expired := make(chan bool, 1)

	timer := NewSessionTimer(
		2, // 2 seconds
		func(rem int) {
			tickCount++
		},
		func() {
			expired <- true
		},
	)

	timer.Start()

	select {
	case <-expired:
		// success
	case <-time.After(3 * time.Second):
		t.Errorf("session timer did not expire within expected time")
	}

	if timer.Remaining() > 0 {
		t.Errorf("expected remaining <= 0, got %d", timer.Remaining())
	}
}

func TestRoomManager(t *testing.T) {
	cfg := config.RoomConfig{
		DefaultMaxParticipants:   50,
		DefaultSessionTimeoutSec: 3600,
		EmptyRoomTTLSec:          1, // 1 second TTL for test
		DefaultPolicies: config.RoomPoliciesConfig{
			AllowCamera: true,
			AllowMic:    true,
		},
	}

	rm := NewRoomManager(cfg)
	defer rm.Close()

	room, err := rm.GetOrCreateRoom("rm-test-room")
	if err != nil {
		t.Fatalf("failed to create room: %v", err)
	}

	if rm.ActiveRoomsCount() != 1 {
		t.Errorf("expected 1 active room, got %d", rm.ActiveRoomsCount())
	}

	// Trigger room empty
	p := NewParticipant("p-1", "u-1", "Alice", permissions.RoleHost, permissions.DefaultPermissionsForRole(permissions.RoleHost), false, nil, &mockSender{})
	_ = room.AddParticipant(p)
	room.RemoveParticipant(p.ID)

	// Wait for TTL sweep to delete empty room
	time.Sleep(2 * time.Second)

	_, exists := rm.GetRoom("rm-test-room")
	if exists {
		t.Errorf("expected empty room to be swept after TTL")
	}
}

func TestTrackPublishingPermissions(t *testing.T) {
	room := NewRoom(
		"track-perm-room",
		10,
		0,
		permissions.RoomPolicy{AllowCamera: false, AllowMic: true}, // camera blocked
		nil,
		nil,
	)

	// Lobby participant should not bridge tracks
	lobbyUser := NewParticipant("p-lobby", "u-lobby", "LobbyUser", permissions.RoleParticipant, permissions.DefaultPermissionsForRole(permissions.RoleParticipant), true, nil, &mockSender{})
	pubTrack := &sfu.PublishedTrack{
		ID:   "track-1",
		Kind: webrtc.RTPCodecTypeVideo,
	}

	// Should safely return without panic or action
	room.HandleTrackPublished(lobbyUser, pubTrack)

	// Participant with blocked camera policy
	activeUser := NewParticipant("p-user", "u-user", "User", permissions.RoleParticipant, permissions.DefaultPermissionsForRole(permissions.RoleParticipant), false, nil, &mockSender{})
	_ = room.AddParticipant(activeUser)
	room.HandleTrackPublished(activeUser, pubTrack)
}

func TestSessionTimerConcurrentSafe(t *testing.T) {
	timer := NewSessionTimer(10, nil, nil)
	timer.Start()
	defer timer.Stop()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			timer.SetOnTick(func(rem int) {})
			_ = timer.GetOnTick()
			_ = timer.Remaining()
		}(i)
	}
	wg.Wait()
}

func TestParticipantScreenTrackID(t *testing.T) {
	p := NewParticipant("p-1", "u-1", "Alice", permissions.RoleHost, permissions.DefaultPermissionsForRole(permissions.RoleHost), false, nil, &mockSender{})

	if p.GetScreenTrackID() != "" {
		t.Errorf("expected empty initial ScreenTrackID")
	}

	p.SetScreenTrackID("trk-screen-123")
	if p.GetScreenTrackID() != "trk-screen-123" {
		t.Errorf("expected ScreenTrackID trk-screen-123, got %s", p.GetScreenTrackID())
	}

	info := p.Info()
	if info.ScreenTrackID != "trk-screen-123" {
		t.Errorf("expected ScreenTrackID in ParticipantInfo to be trk-screen-123, got %s", info.ScreenTrackID)
	}
}
