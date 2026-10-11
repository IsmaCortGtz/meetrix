package room

import (
	"errors"
	"sync"
	"time"

	"github.com/IsmaCortGtz/connected/server/pkg/permissions"
	"github.com/IsmaCortGtz/connected/server/pkg/sfu"
	"github.com/pion/webrtc/v4"
)

var (
	ErrRoomFull   = errors.New("room is full")
	ErrNotFound   = errors.New("participant not found")
	ErrNotInLobby = errors.New("participant is not in lobby")
	ErrRoomClosed = errors.New("room is closed")
)

// SessionTimer manages countdown time tracking, periodic warnings, and room auto-expiration.
type SessionTimer struct {
	mu           sync.Mutex
	remainingSec int
	stopChan     chan struct{}
	onTick       func(remainingSec int)
	onExpire     func()
	running      bool
}

// NewSessionTimer creates a new session countdown timer.
func NewSessionTimer(durationSec int, onTick func(remainingSec int), onExpire func()) *SessionTimer {
	return &SessionTimer{
		remainingSec: durationSec,
		stopChan:     make(chan struct{}),
		onTick:       onTick,
		onExpire:     onExpire,
	}
}

// SetOnTick thread-safely updates the tick listener callback.
func (st *SessionTimer) SetOnTick(cb func(remainingSec int)) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.onTick = cb
}

// GetOnTick thread-safely reads the current tick listener callback.
func (st *SessionTimer) GetOnTick() func(remainingSec int) {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.onTick
}

// Start begins the countdown loop.
func (st *SessionTimer) Start() {
	st.mu.Lock()
	if st.running || st.remainingSec <= 0 {
		st.mu.Unlock()
		return
	}
	st.running = true
	st.mu.Unlock()

	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-st.stopChan:
				return
			case <-ticker.C:
				st.mu.Lock()
				st.remainingSec--
				rem := st.remainingSec
				tickCb := st.onTick
				st.mu.Unlock()

				if tickCb != nil {
					tickCb(rem)
				}

				if rem <= 0 {
					st.Stop()
					if st.onExpire != nil {
						st.onExpire()
					}
					return
				}
			}
		}
	}()
}

// Remaining returns the remaining countdown duration in seconds.
func (st *SessionTimer) Remaining() int {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.remainingSec
}

// Stop stops the timer and frees resources.
func (st *SessionTimer) Stop() {
	st.mu.Lock()
	defer st.mu.Unlock()
	if !st.running {
		return
	}
	st.running = false
	close(st.stopChan)
}

// Room represents an active meeting instance with participants, policies, and timers.
type Room struct {
	mu                sync.RWMutex
	ID                string
	participants      map[string]*Participant
	lobbyParticipants map[string]*Participant
	policy            permissions.RoomPolicy
	maxParticipants   int
	createdAt         time.Time
	sessionTimer      *SessionTimer
	onRoomEmpty       func(roomID string)
	onRoomEnd         func(roomID string)
	isClosed          bool
}

// NewRoom creates a new Room with the specified capacity and policies.
func NewRoom(id string, maxParticipants int, timeoutSec int, policy permissions.RoomPolicy, onEmpty func(roomID string), onEnd func(roomID string)) *Room {
	r := &Room{
		ID:                id,
		participants:      make(map[string]*Participant),
		lobbyParticipants: make(map[string]*Participant),
		policy:            policy,
		maxParticipants:   maxParticipants,
		createdAt:         time.Now(),
		onRoomEmpty:       onEmpty,
		onRoomEnd:         onEnd,
	}

	if timeoutSec > 0 {
		r.sessionTimer = NewSessionTimer(
			timeoutSec,
			nil, // tick handler can be set by signaling hub
			func() {
				r.Close()
				if onEnd != nil {
					onEnd(id)
				}
			},
		)
		r.sessionTimer.Start()
	}

	return r
}

// SetTickCallback sets the session countdown tick listener.
func (r *Room) SetTickCallback(cb func(remainingSec int)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sessionTimer != nil {
		r.sessionTimer.SetOnTick(cb)
	}
}

// SetTickCallbackOnce sets the session countdown tick listener only if not already set.
func (r *Room) SetTickCallbackOnce(cb func(remainingSec int)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sessionTimer != nil && r.sessionTimer.GetOnTick() == nil {
		r.sessionTimer.SetOnTick(cb)
	}
}

// Policy returns a copy of current room policies.
func (r *Room) Policy() permissions.RoomPolicy {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.policy
}

// UpdatePolicy updates the room's policy.
func (r *Room) UpdatePolicy(newPolicy permissions.RoomPolicy) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.policy = newPolicy
}

// AddParticipant attempts to add a participant to the room (or lobby).
func (r *Room) AddParticipant(p *Participant) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.isClosed {
		return ErrRoomClosed
	}

	if r.maxParticipants > 0 && len(r.participants) >= r.maxParticipants {
		return ErrRoomFull
	}

	// Route to lobby if policy requires it and participant is not a host/co-host
	if r.policy.RequireLobby && p.Role != permissions.RoleHost && p.Role != permissions.RoleCoHost {
		p.SetInLobby(true)
		r.lobbyParticipants[p.ID] = p
		return nil
	}

	p.SetInLobby(false)
	r.participants[p.ID] = p
	return nil
}

// AdmitFromLobby moves a participant from the lobby to the active room.
func (r *Room) AdmitFromLobby(participantID string) (*Participant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.isClosed {
		return nil, ErrRoomClosed
	}

	p, ok := r.lobbyParticipants[participantID]
	if !ok {
		return nil, ErrNotInLobby
	}

	if r.maxParticipants > 0 && len(r.participants) >= r.maxParticipants {
		return nil, ErrRoomFull
	}

	delete(r.lobbyParticipants, participantID)
	p.SetInLobby(false)
	r.participants[p.ID] = p
	return p, nil
}

// RemoveParticipant removes a participant from either active participants or the lobby.
func (r *Room) RemoveParticipant(participantID string) (*Participant, int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	var p *Participant
	if activeP, ok := r.participants[participantID]; ok {
		p = activeP
		delete(r.participants, participantID)
	} else if lobbyP, ok := r.lobbyParticipants[participantID]; ok {
		p = lobbyP
		delete(r.lobbyParticipants, participantID)
	}

	// Unsubscribe remaining participants from tracks published by departing participant
	if p != nil && p.Peer != nil {
		publishedTracks := p.Peer.PublishedTracks()
		for _, track := range publishedTracks {
			for _, sub := range r.participants {
				if sub.Peer != nil {
					_ = sub.Peer.Unsubscribe(track.ID)
				}
			}
		}
	}

	activeCount := len(r.participants)
	if activeCount == 0 && r.onRoomEmpty != nil {
		go r.onRoomEmpty(r.ID)
	}

	return p, activeCount
}

// GetParticipant retrieves an active participant by ID.
func (r *Room) GetParticipant(participantID string) (*Participant, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	p, ok := r.participants[participantID]
	return p, ok
}

// GetLobbyParticipant retrieves a lobby participant by ID.
func (r *Room) GetLobbyParticipant(participantID string) (*Participant, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	p, ok := r.lobbyParticipants[participantID]
	return p, ok
}

// GetAnyParticipant finds a participant in either active or lobby sets.
func (r *Room) GetAnyParticipant(participantID string) (*Participant, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if p, ok := r.participants[participantID]; ok {
		return p, true
	}
	p, ok := r.lobbyParticipants[participantID]
	return p, ok
}

// GetParticipants returns all active participants.
func (r *Room) GetParticipants() []*Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()

	res := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		res = append(res, p)
	}
	return res
}

// GetLobbyParticipants returns all participants waiting in the lobby.
func (r *Room) GetLobbyParticipants() []*Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()

	res := make([]*Participant, 0, len(r.lobbyParticipants))
	for _, p := range r.lobbyParticipants {
		res = append(res, p)
	}
	return res
}

// ParticipantCount returns current active and lobby counts.
func (r *Room) ParticipantCount() (active int, lobby int) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.participants), len(r.lobbyParticipants)
}

// RemainingSessionSec returns remaining session time in seconds (-1 if no limit).
func (r *Room) RemainingSessionSec() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.sessionTimer != nil {
		return r.sessionTimer.Remaining()
	}
	return -1
}

// Broadcast dispatches a message to all active participants, optionally excluding one.
func (r *Room) Broadcast(msg []byte, excludeIDs ...string) {
	r.mu.RLock()
	exclude := make(map[string]bool, len(excludeIDs))
	for _, id := range excludeIDs {
		exclude[id] = true
	}

	targets := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		if !exclude[p.ID] {
			targets = append(targets, p)
		}
	}
	r.mu.RUnlock()

	for _, p := range targets {
		_ = p.Send(msg)
	}
}

// BroadcastToLobby sends a message to all participants waiting in the lobby.
func (r *Room) BroadcastToLobby(msg []byte) {
	r.mu.RLock()
	targets := make([]*Participant, 0, len(r.lobbyParticipants))
	for _, p := range r.lobbyParticipants {
		targets = append(targets, p)
	}
	r.mu.RUnlock()

	for _, p := range targets {
		_ = p.Send(msg)
	}
}

// BroadcastAll sends a message to all active and lobby participants.
func (r *Room) BroadcastAll(msg []byte) {
	r.Broadcast(msg)
	r.BroadcastToLobby(msg)
}

// BroadcastToHosts sends a message to hosts and co-hosts only.
func (r *Room) BroadcastToHosts(msg []byte) {
	r.mu.RLock()
	targets := make([]*Participant, 0)
	for _, p := range r.participants {
		if p.Role == permissions.RoleHost || p.Role == permissions.RoleCoHost {
			targets = append(targets, p)
		}
	}
	r.mu.RUnlock()

	for _, p := range targets {
		_ = p.Send(msg)
	}
}

// HandleTrackPublished attaches the newly published track to all other active peers in the room.
func (r *Room) HandleTrackPublished(publisher *Participant, pubTrack *sfu.PublishedTrack) {
	if publisher.IsInLobby {
		return
	}

	// Map Pion codec type to permissions media kind
	var mediaKind permissions.MediaKind
	if pubTrack.Kind == webrtc.RTPCodecTypeAudio {
		mediaKind = permissions.MediaKindAudio
	} else if pubTrack.Kind == webrtc.RTPCodecTypeVideo {
		mediaKind = permissions.MediaKindVideo
	}

	pInfo := publisher.Info()
	if !permissions.CanPublishMedia(pInfo.Role, mediaKind, r.Policy(), &pInfo.Permissions) {
		return
	}

	r.mu.RLock()
	subscribers := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		if p.ID != publisher.ID && p.Peer != nil {
			subscribers = append(subscribers, p)
		}
	}
	r.mu.RUnlock()

	for _, sub := range subscribers {
		_, _ = sub.Peer.Subscribe(pubTrack, publisher.Peer)
	}
}

// HandleTrackUnpublished unsubscribes all room subscribers when a publisher unpublishes a track.
func (r *Room) HandleTrackUnpublished(publisher *Participant, trackID string) {
	r.mu.RLock()
	subscribers := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		if p.ID != publisher.ID && p.Peer != nil {
			subscribers = append(subscribers, p)
		}
	}
	r.mu.RUnlock()

	for _, sub := range subscribers {
		_ = sub.Peer.Unsubscribe(trackID)
	}
}

// SubscribeParticipantToExistingTracks subscribes a newly admitted participant to all existing tracks.
func (r *Room) SubscribeParticipantToExistingTracks(newParticipant *Participant) {
	if newParticipant.Peer == nil {
		return
	}

	r.mu.RLock()
	publishers := make([]*Participant, 0, len(r.participants))
	for _, p := range r.participants {
		if p.ID != newParticipant.ID && p.Peer != nil {
			publishers = append(publishers, p)
		}
	}
	policy := r.policy
	r.mu.RUnlock()

	for _, pub := range publishers {
		if pub.IsInLobby {
			continue
		}
		pubInfo := pub.Info()
		for _, track := range pub.Peer.PublishedTracks() {
			var mediaKind permissions.MediaKind
			if track.Kind == webrtc.RTPCodecTypeAudio {
				mediaKind = permissions.MediaKindAudio
			} else if track.Kind == webrtc.RTPCodecTypeVideo {
				mediaKind = permissions.MediaKindVideo
			}
			if !permissions.CanPublishMedia(pubInfo.Role, mediaKind, policy, &pubInfo.Permissions) {
				continue
			}
			_, _ = newParticipant.Peer.Subscribe(track, pub.Peer)
		}
	}
}

// Close gracefully closes the room, its timer, and all participant connections.
func (r *Room) Close() {
	r.mu.Lock()
	if r.isClosed {
		r.mu.Unlock()
		return
	}
	r.isClosed = true

	if r.sessionTimer != nil {
		r.sessionTimer.Stop()
	}

	toClose := make([]*Participant, 0, len(r.participants)+len(r.lobbyParticipants))
	for _, p := range r.participants {
		toClose = append(toClose, p)
	}
	for _, p := range r.lobbyParticipants {
		toClose = append(toClose, p)
	}
	r.participants = make(map[string]*Participant)
	r.lobbyParticipants = make(map[string]*Participant)
	r.mu.Unlock()

	for _, p := range toClose {
		p.Close()
	}
}
