package signaling

import (
	"encoding/json"
	"time"

	"github.com/IsmaCortGtz/meetrix/server/pkg/permissions"
	"github.com/IsmaCortGtz/meetrix/server/pkg/room"
	"github.com/pion/webrtc/v4"
)

// Inbound message type constants.
const (
	TypeJoin           = "join"
	TypeOffer          = "offer"
	TypeAnswer         = "answer"
	TypeCandidate      = "candidate"
	TypeChatMessage    = "chat_message"
	TypeReaction       = "reaction"
	TypeRaiseHand      = "raise_hand"
	TypeAdmitPeer      = "admit_peer"
	TypeMutePeer       = "mute_peer"
	TypeStopPeerMedia  = "stop_peer_media"
	TypeKickPeer       = "kick_peer"
	TypeUpdatePolicies = "update_policies"
	TypeLeave              = "leave"
	TypeMediaStateChanged  = "media_state_changed"
)

// Outbound message type constants.
const (
	TypeJoined             = "joined"
	TypePeerJoined         = "peer_joined"
	TypePeerLeft           = "peer_left"
	TypeHandRaised         = "hand_raised"
	TypePolicyUpdated      = "policy_updated"
	TypePeerMuted          = "peer_muted"
	TypePeerMediaStopped   = "peer_media_stopped"
	TypeKicked             = "kicked"
	TypeLobbyWaiting       = "lobby_waiting"
	TypeLobbyPeerWaiting   = "lobby_peer_waiting"
	TypeSessionTimerTick   = "session_timer_tick"
	TypeSessionEnded       = "session_ended"
	TypeError              = "error"
)

// Envelope standardizes all WebSocket communication.
type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Inbound Payloads

type JoinPayload struct {
	RoomID      string                 `json:"room_id"`
	Token       string                 `json:"token,omitempty"`
	UserID      string                 `json:"user_id,omitempty"`
	DisplayName string                 `json:"display_name,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type SDPPayload struct {
	SDP  string `json:"sdp"`
	Type string `json:"type"` // "offer" or "answer"
}

type CandidatePayload struct {
	Candidate        string  `json:"candidate"`
	SDPMid           *string `json:"sdpMid,omitempty"`
	SDPMLineIndex    *uint16 `json:"sdpMLineIndex,omitempty"`
	UsernameFragment *string `json:"usernameFragment,omitempty"`
}

type ChatMessagePayload struct {
	Text string `json:"text"`
}

type ReactionPayload struct {
	Emoji string `json:"emoji"`
}

type RaiseHandPayload struct {
	Raised bool `json:"raised"`
}

type AdmitPeerPayload struct {
	PeerID string `json:"peer_id"`
}

type MutePeerPayload struct {
	PeerID string `json:"peer_id"`
	Media  string `json:"media"` // "audio" or "video"
}

type StopPeerMediaPayload struct {
	PeerID string `json:"peer_id"`
	Media  string `json:"media"` // "screenshare"
}

type KickPeerPayload struct {
	PeerID string `json:"peer_id"`
	Reason string `json:"reason,omitempty"`
}

type UpdatePoliciesPayload struct {
	Policies permissions.RoomPolicy `json:"policies"`
}

// Outbound Payloads

type JoinedPayload struct {
	PeerID              string                      `json:"peer_id"`
	UserID              string                      `json:"user_id"`
	DisplayName         string                      `json:"display_name"`
	Role                permissions.Role            `json:"role"`
	Permissions         permissions.UserPermissions `json:"permissions"`
	Policies            permissions.RoomPolicy      `json:"policies"`
	Participants        []room.ParticipantInfo      `json:"participants"`
	SessionRemainingSec int                         `json:"session_remaining_sec"`
	ICEServers          []webrtc.ICEServer          `json:"ice_servers"`
}

type PeerJoinedPayload struct {
	Peer room.ParticipantInfo `json:"peer"`
}

type PeerLeftPayload struct {
	PeerID string `json:"peer_id"`
}

type ChatBroadcastPayload struct {
	ID          string    `json:"id"`
	PeerID      string    `json:"peer_id"`
	UserID      string    `json:"user_id"`
	DisplayName string    `json:"display_name"`
	Text        string    `json:"text"`
	Timestamp   time.Time `json:"timestamp"`
}

type ReactionBroadcastPayload struct {
	PeerID    string    `json:"peer_id"`
	UserID    string    `json:"user_id"`
	Emoji     string    `json:"emoji"`
	Timestamp time.Time `json:"timestamp"`
}

type HandRaisedBroadcastPayload struct {
	PeerID string `json:"peer_id"`
	Raised bool   `json:"raised"`
}

type PolicyUpdatedPayload struct {
	Policies permissions.RoomPolicy `json:"policies"`
}

type PeerMutedPayload struct {
	PeerID   string `json:"peer_id"`
	Media    string `json:"media"`
	ByPeerID string `json:"by_peer_id"`
}

type PeerMediaStoppedPayload struct {
	PeerID   string `json:"peer_id"`
	Media    string `json:"media"`
	ByPeerID string `json:"by_peer_id"`
}

type KickedPayload struct {
	Reason   string `json:"reason"`
	ByPeerID string `json:"by_peer_id"`
}

type LobbyWaitingPayload struct {
	Message string `json:"message"`
}

type LobbyPeerWaitingPayload struct {
	Peer room.ParticipantInfo `json:"peer"`
}

type SessionTimerTickPayload struct {
	RemainingSec int `json:"remaining_sec"`
}

type SessionEndedPayload struct {
	Reason string `json:"reason"`
}

type MediaStateChangedPayload struct {
	PeerID        string `json:"peer_id"`
	AudioMuted    *bool  `json:"audio_muted,omitempty"`
	VideoMuted    *bool  `json:"video_muted,omitempty"`
	ScreenSharing *bool  `json:"screen_sharing,omitempty"`
	ScreenTrackID string `json:"screen_track_id,omitempty"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// EncodeMessage serializes an event type and payload into a JSON byte array.
func EncodeMessage(msgType string, payload interface{}) ([]byte, error) {
	var payloadBytes json.RawMessage
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		payloadBytes = b
	}

	env := Envelope{
		Type:    msgType,
		Payload: payloadBytes,
	}
	return json.Marshal(env)
}
