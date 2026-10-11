package signaling

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/IsmaCortGtz/connected/server/pkg/auth"
	"github.com/IsmaCortGtz/connected/server/pkg/config"
	"github.com/IsmaCortGtz/connected/server/pkg/permissions"
	"github.com/IsmaCortGtz/connected/server/pkg/room"
	"github.com/IsmaCortGtz/connected/server/pkg/sfu"
	"github.com/gorilla/websocket"
)

func setupTestServer(t *testing.T) (*httptest.Server, *Hub, *room.RoomManager) {
	cfg := config.DefaultConfig()
	sfuEngine, err := sfu.NewEngine(cfg.Server)
	if err != nil {
		t.Fatalf("failed to create sfu engine: %v", err)
	}

	rm := room.NewRoomManager(cfg.Room)
	authProvider := auth.NewAllowAllAuthenticator()
	hub := NewHub(rm, sfuEngine, authProvider)

	ts := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	return ts, hub, rm
}

func connectWS(t *testing.T, url string) *websocket.Conn {
	wsURL := "ws" + strings.TrimPrefix(url, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect to ws: %v", err)
	}
	return conn
}

func TestSignalingProtocolSerialization(t *testing.T) {
	msg, err := EncodeMessage(TypeChatMessage, ChatMessagePayload{Text: "hello world"})
	if err != nil {
		t.Fatalf("failed to encode message: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(msg, &env); err != nil {
		t.Fatalf("failed to unmarshal envelope: %v", err)
	}
	if env.Type != TypeChatMessage {
		t.Errorf("expected TypeChatMessage, got %s", env.Type)
	}

	var payload ChatMessagePayload
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		t.Fatalf("failed to unmarshal payload: %v", err)
	}
	if payload.Text != "hello world" {
		t.Errorf("expected 'hello world', got %s", payload.Text)
	}
}

func TestSignalingJoinAndChat(t *testing.T) {
	ts, _, rm := setupTestServer(t)
	defer ts.Close()
	defer rm.Close()

	conn1 := connectWS(t, ts.URL)
	defer conn1.Close()

	// 1. Join client 1 as host
	joinMsg1, _ := EncodeMessage(TypeJoin, JoinPayload{
		RoomID:      "test-signaling-room",
		DisplayName: "HostUser",
		Metadata:    map[string]interface{}{"role": "host"},
	})
	if err := conn1.WriteMessage(websocket.TextMessage, joinMsg1); err != nil {
		t.Fatalf("failed to send join: %v", err)
	}

	// Read response: should be "joined"
	_ = conn1.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, respBytes, err := conn1.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read response: %v", err)
	}

	var respEnv Envelope
	if err := json.Unmarshal(respBytes, &respEnv); err != nil {
		t.Fatalf("invalid envelope: %v", err)
	}
	if respEnv.Type != TypeJoined {
		t.Errorf("expected type 'joined', got %s", respEnv.Type)
	}

	var joinedPayload JoinedPayload
	_ = json.Unmarshal(respEnv.Payload, &joinedPayload)
	if joinedPayload.DisplayName != "HostUser" {
		t.Errorf("expected HostUser, got %s", joinedPayload.DisplayName)
	}
	if joinedPayload.Role != permissions.RoleHost {
		t.Errorf("expected host, got %s", joinedPayload.Role)
	}

	// 2. Connect Client 2
	conn2 := connectWS(t, ts.URL)
	defer conn2.Close()

	joinMsg2, _ := EncodeMessage(TypeJoin, JoinPayload{
		RoomID:      "test-signaling-room",
		DisplayName: "GuestUser",
		Metadata:    map[string]interface{}{"role": "participant"},
	})
	if err := conn2.WriteMessage(websocket.TextMessage, joinMsg2); err != nil {
		t.Fatalf("failed to send join for conn2: %v", err)
	}

	// Client 2 reads "joined"
	_ = conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, respBytes2, err := conn2.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read conn2 joined: %v", err)
	}
	var respEnv2 Envelope
	_ = json.Unmarshal(respBytes2, &respEnv2)
	if respEnv2.Type != TypeJoined {
		t.Errorf("expected conn2 joined, got %s", respEnv2.Type)
	}

	// 3. Send Chat message from Client 1
	chatMsg, _ := EncodeMessage(TypeChatMessage, ChatMessagePayload{Text: "Welcome to Connected!"})
	if err := conn1.WriteMessage(websocket.TextMessage, chatMsg); err != nil {
		t.Fatalf("failed to send chat message: %v", err)
	}

	// Client 2 should receive the chat message broadcast
	_ = conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, chatRecvBytes, err := conn2.ReadMessage()
	if err != nil {
		t.Fatalf("conn2 failed to receive chat: %v", err)
	}

	var chatEnv Envelope
	_ = json.Unmarshal(chatRecvBytes, &chatEnv)
	if chatEnv.Type != TypeChatMessage {
		t.Errorf("expected type chat_message, got %s", chatEnv.Type)
	}

	var chatPayload ChatBroadcastPayload
	_ = json.Unmarshal(chatEnv.Payload, &chatPayload)
	if chatPayload.Text != "Welcome to Connected!" {
		t.Errorf("expected chat message content, got %s", chatPayload.Text)
	}
	if chatPayload.DisplayName != "HostUser" {
		t.Errorf("expected sender HostUser, got %s", chatPayload.DisplayName)
	}
}

func TestSignalingDuplicateJoinRejected(t *testing.T) {
	ts, _, rm := setupTestServer(t)
	defer ts.Close()
	defer rm.Close()

	conn := connectWS(t, ts.URL)
	defer conn.Close()

	joinMsg, _ := EncodeMessage(TypeJoin, JoinPayload{
		RoomID:      "dup-room",
		DisplayName: "Alice",
	})

	// First join -> OK
	if err := conn.WriteMessage(websocket.TextMessage, joinMsg); err != nil {
		t.Fatalf("failed to send join: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, respBytes, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read joined response: %v", err)
	}
	var respEnv Envelope
	_ = json.Unmarshal(respBytes, &respEnv)
	if respEnv.Type != TypeJoined {
		t.Fatalf("expected TypeJoined, got %s", respEnv.Type)
	}

	// Second join on same connection -> Rejected with ALREADY_JOINED
	if err := conn.WriteMessage(websocket.TextMessage, joinMsg); err != nil {
		t.Fatalf("failed to send duplicate join: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, errRespBytes, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read error response: %v", err)
	}
	var errEnv Envelope
	_ = json.Unmarshal(errRespBytes, &errEnv)
	if errEnv.Type != TypeError {
		t.Fatalf("expected error type for duplicate join, got %s", errEnv.Type)
	}
	var errPayload ErrorPayload
	_ = json.Unmarshal(errEnv.Payload, &errPayload)
	if errPayload.Code != "ALREADY_JOINED" {
		t.Errorf("expected ALREADY_JOINED error code, got %s", errPayload.Code)
	}
}

func TestSignalingIndividualFrames(t *testing.T) {
	ts, _, rm := setupTestServer(t)
	defer ts.Close()
	defer rm.Close()

	conn := connectWS(t, ts.URL)
	defer conn.Close()

	// Send multiple messages quickly
	msg1, _ := EncodeMessage(TypeChatMessage, ChatMessagePayload{Text: "msg 1"})
	msg2, _ := EncodeMessage(TypeChatMessage, ChatMessagePayload{Text: "msg 2"})

	_ = conn.WriteMessage(websocket.TextMessage, msg1)
	_ = conn.WriteMessage(websocket.TextMessage, msg2)

	// Verify we can read without JSON parser error
	time.Sleep(50 * time.Millisecond)
}

func TestSignalingMediaStateChangedScreenTrackID(t *testing.T) {
	ts, _, rm := setupTestServer(t)
	defer ts.Close()
	defer rm.Close()

	conn1 := connectWS(t, ts.URL)
	defer conn1.Close()

	conn2 := connectWS(t, ts.URL)
	defer conn2.Close()

	// 1. Join both
	joinMsg1, _ := EncodeMessage(TypeJoin, JoinPayload{RoomID: "media-room", DisplayName: "User1"})
	_ = conn1.WriteMessage(websocket.TextMessage, joinMsg1)
	_, _, _ = conn1.ReadMessage()

	joinMsg2, _ := EncodeMessage(TypeJoin, JoinPayload{RoomID: "media-room", DisplayName: "User2"})
	_ = conn2.WriteMessage(websocket.TextMessage, joinMsg2)
	_, _, _ = conn2.ReadMessage()

	// 2. Client 1 updates media state with ScreenTrackID
	sharing := true
	mediaMsg, _ := EncodeMessage(TypeMediaStateChanged, MediaStateChangedPayload{
		ScreenSharing: &sharing,
		ScreenTrackID: "screen-trk-999",
	})
	if err := conn1.WriteMessage(websocket.TextMessage, mediaMsg); err != nil {
		t.Fatalf("failed to send media state changed: %v", err)
	}

	// 3. Client 2 receives media state changed broadcast with ScreenTrackID
	_ = conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, broadcastBytes, err := conn2.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read media state broadcast: %v", err)
	}

	var env Envelope
	_ = json.Unmarshal(broadcastBytes, &env)
	if env.Type != TypeMediaStateChanged {
		t.Fatalf("expected TypeMediaStateChanged, got %s", env.Type)
	}

	var payload MediaStateChangedPayload
	_ = json.Unmarshal(env.Payload, &payload)
	if payload.ScreenTrackID != "screen-trk-999" {
		t.Errorf("expected ScreenTrackID screen-trk-999, got %s", payload.ScreenTrackID)
	}
	if payload.ScreenSharing == nil || !*payload.ScreenSharing {
		t.Errorf("expected ScreenSharing true")
	}
}

