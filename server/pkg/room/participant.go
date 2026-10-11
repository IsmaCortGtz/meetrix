package room

import (
	"sync"
	"time"

	"github.com/IsmaCortGtz/connected/server/pkg/permissions"
	"github.com/IsmaCortGtz/connected/server/pkg/sfu"
)

// Sender abstracts the signaling channel (WebSocket) to deliver messages to a client.
type Sender interface {
	Send(msg []byte) error
	Close() error
}

// Participant represents a connected client's state and capabilities.
type Participant struct {
	mu            sync.RWMutex
	ID            string
	UserID        string
	DisplayName   string
	Role          permissions.Role
	Permissions   permissions.UserPermissions
	IsInLobby     bool
	AudioMuted    bool
	VideoMuted    bool
	ScreenSharing bool
	ScreenTrackID string
	HandRaised    bool
	JoinedAt      time.Time
	Peer          *sfu.Peer
	Sender        Sender
}

// ParticipantInfo is a serializable snapshot of a participant's state.
type ParticipantInfo struct {
	ID            string                      `json:"id"`
	UserID        string                      `json:"user_id"`
	DisplayName   string                      `json:"display_name"`
	Role          permissions.Role            `json:"role"`
	Permissions   permissions.UserPermissions `json:"permissions"`
	IsInLobby     bool                        `json:"is_in_lobby"`
	AudioMuted    bool                        `json:"audio_muted"`
	VideoMuted    bool                        `json:"video_muted"`
	ScreenSharing bool                        `json:"screen_sharing"`
	ScreenTrackID string                      `json:"screen_track_id,omitempty"`
	HandRaised    bool                        `json:"hand_raised"`
	JoinedAt      time.Time                   `json:"joined_at"`
}

// NewParticipant creates a new Participant instance.
func NewParticipant(id, userID, displayName string, role permissions.Role, perms permissions.UserPermissions, inLobby bool, peer *sfu.Peer, sender Sender) *Participant {
	return &Participant{
		ID:          id,
		UserID:      userID,
		DisplayName: displayName,
		Role:        role,
		Permissions: perms,
		IsInLobby:   inLobby,
		JoinedAt:    time.Now(),
		Peer:        peer,
		Sender:      sender,
	}
}

// Info returns an immutable snapshot of the participant state.
func (p *Participant) Info() ParticipantInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return ParticipantInfo{
		ID:            p.ID,
		UserID:        p.UserID,
		DisplayName:   p.DisplayName,
		Role:          p.Role,
		Permissions:   p.Permissions,
		IsInLobby:     p.IsInLobby,
		AudioMuted:    p.AudioMuted,
		VideoMuted:    p.VideoMuted,
		ScreenSharing: p.ScreenSharing,
		ScreenTrackID: p.ScreenTrackID,
		HandRaised:    p.HandRaised,
		JoinedAt:      p.JoinedAt,
	}
}

// SetAudioMuted updates the audio mute status.
func (p *Participant) SetAudioMuted(muted bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.AudioMuted = muted
}

// SetVideoMuted updates the video mute status.
func (p *Participant) SetVideoMuted(muted bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.VideoMuted = muted
}

// SetScreenSharing updates the screen sharing status.
func (p *Participant) SetScreenSharing(sharing bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ScreenSharing = sharing
}

// SetScreenTrackID updates the screen share track ID.
func (p *Participant) SetScreenTrackID(trackID string) {
	p.mu.Lock()
	p.ScreenTrackID = trackID
	peer := p.Peer
	p.mu.Unlock()

	if peer != nil {
		peer.SetScreenTrackID(trackID)
	}
}

// GetScreenTrackID returns the current screen share track ID.
func (p *Participant) GetScreenTrackID() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.ScreenTrackID
}

// SetHandRaised updates the hand raise status.
func (p *Participant) SetHandRaised(raised bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.HandRaised = raised
}

// SetRole updates the role.
func (p *Participant) SetRole(role permissions.Role) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Role = role
}

// SetPermissions updates the permissions.
func (p *Participant) SetPermissions(perms permissions.UserPermissions) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Permissions = perms
}

// SetInLobby updates the lobby status.
func (p *Participant) SetInLobby(inLobby bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.IsInLobby = inLobby
}

// Send dispatches a raw byte message through the participant's sender channel.
func (p *Participant) Send(msg []byte) error {
	p.mu.RLock()
	sender := p.Sender
	p.mu.RUnlock()

	if sender != nil {
		return sender.Send(msg)
	}
	return nil
}

// Close closes the participant's media peer and signaling sender.
func (p *Participant) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.Peer != nil {
		_ = p.Peer.Close()
		p.Peer = nil
	}
	if p.Sender != nil {
		_ = p.Sender.Close()
		p.Sender = nil
	}
}
