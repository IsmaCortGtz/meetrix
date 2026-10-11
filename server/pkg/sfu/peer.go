package sfu

import (
	"fmt"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// PublishedTrack pairs an incoming TrackRemote with an outgoing TrackLocalStaticRTP.
type PublishedTrack struct {
	ID          string
	StreamID    string
	Kind        webrtc.RTPCodecType
	SSRC        webrtc.SSRC
	TrackRemote *webrtc.TrackRemote
	TrackLocal  *webrtc.TrackLocalStaticRTP
	stopChan    chan struct{}
	closeOnce   sync.Once
}

// Close gracefully stops the forwarding goroutine for this track.
func (pt *PublishedTrack) Close() {
	pt.closeOnce.Do(func() {
		if pt.stopChan != nil {
			close(pt.stopChan)
		}
	})
}

// Peer represents an SFU WebRTC participant connection.
type Peer struct {
	mu                    sync.RWMutex
	id                    string
	roomID                string
	screenTrackID         string
	pc                    *webrtc.PeerConnection
	publishedTracks       map[string]*PublishedTrack
	subscribedSenders     map[string]*webrtc.RTPSender
	onTrackPublished      func(pubTrack *PublishedTrack)
	onTrackUnpublished    func(trackID string)
	onRenegotiationNeeded func()
	renegTimer            *time.Timer
	renegMu               sync.Mutex
	renegPending          bool
	closed                bool
	closeChan             chan struct{}
	closeOnce             sync.Once
}

// NewPeer creates a new SFU Peer with the underlying Pion RTCPeerConnection.
func NewPeer(id, roomID string, engine *Engine) (*Peer, error) {
	pc, err := engine.NewPeerConnection()
	if err != nil {
		return nil, fmt.Errorf("failed to create PeerConnection: %w", err)
	}

	p := &Peer{
		id:                id,
		roomID:            roomID,
		pc:                pc,
		publishedTracks:   make(map[string]*PublishedTrack),
		subscribedSenders: make(map[string]*webrtc.RTPSender),
		closeChan:         make(chan struct{}),
	}

	// Register OnTrack handler
	pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		p.mu.Lock()
		if p.closed {
			p.mu.Unlock()
			return
		}

		// Differentiate stream ID for screen sharing vs camera/microphone.
		// Camera and microphone share p.id as their MediaStream ID so browsers enable native WebRTC A/V Lip Sync.
		streamID := p.id
		if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
			isScreen := false
			if p.screenTrackID != "" && remoteTrack.ID() == p.screenTrackID {
				isScreen = true
			} else {
				// If peer already has another video track published, this second one is screen share
				for _, existing := range p.publishedTracks {
					if existing.Kind == webrtc.RTPCodecTypeVideo {
						isScreen = true
						break
					}
				}
			}

			if isScreen {
				streamID = p.id + ":screen"
			} else {
				streamID = p.id
			}
		} else if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio {
			isScreenAudio := false
			hasExistingAudio := false
			hasScreenVideo := false
			for _, existing := range p.publishedTracks {
				if existing.Kind == webrtc.RTPCodecTypeAudio {
					hasExistingAudio = true
				}
				if existing.Kind == webrtc.RTPCodecTypeVideo && existing.StreamID == p.id+":screen" {
					hasScreenVideo = true
				}
			}

			if hasExistingAudio || (hasScreenVideo && p.screenTrackID != "") {
				isScreenAudio = true
			}

			if isScreenAudio {
				streamID = p.id + ":screen"
			} else {
				streamID = p.id
			}
		}

		localTrack, err := webrtc.NewTrackLocalStaticRTP(
			remoteTrack.Codec().RTPCodecCapability,
			remoteTrack.ID(),
			streamID,
		)
		if err != nil {
			p.mu.Unlock()
			return
		}

		pubTrack := &PublishedTrack{
			ID:          remoteTrack.ID(),
			StreamID:    streamID,
			Kind:        remoteTrack.Kind(),
			SSRC:        remoteTrack.SSRC(),
			TrackRemote: remoteTrack,
			TrackLocal:  localTrack,
			stopChan:    make(chan struct{}),
		}

		p.publishedTracks[pubTrack.ID] = pubTrack
		cb := p.onTrackPublished
		p.mu.Unlock()

		// Start RTP packet forwarding goroutine
		go func() {
			for {
				select {
				case <-pubTrack.stopChan:
					return
				case <-p.closeChan:
					return
				default:
				}

				pkt, _, err := remoteTrack.ReadRTP()
				if err != nil {
					p.mu.Lock()
					delete(p.publishedTracks, pubTrack.ID)
					unpubCb := p.onTrackUnpublished
					p.mu.Unlock()
					pubTrack.Close()
					if unpubCb != nil {
						unpubCb(pubTrack.ID)
					}
					return
				}

				// Do NOT exit loop on WriteRTP error (e.g. no subscriber bound yet or transceiver renegotiation in progress)
				_ = localTrack.WriteRTP(pkt)
			}
		}()

		if cb != nil {
			cb(pubTrack)
		}
	})

	// Register negotiation handler with debouncing and serialization
	pc.OnNegotiationNeeded(func() {
		p.scheduleRenegotiation()
	})

	return p, nil
}

// scheduleRenegotiation batches rapid negotiation needed events and ensures stable state.
func (p *Peer) scheduleRenegotiation() {
	p.renegMu.Lock()
	defer p.renegMu.Unlock()

	p.mu.RLock()
	closed := p.closed
	p.mu.RUnlock()
	if closed {
		return
	}

	if p.renegTimer != nil {
		p.renegTimer.Stop()
	}

	p.renegTimer = time.AfterFunc(25*time.Millisecond, func() {
		p.renegMu.Lock()
		defer p.renegMu.Unlock()

		p.mu.RLock()
		closed := p.closed
		p.mu.RUnlock()
		if closed {
			return
		}

		// Verify signaling state is stable before creating offer to prevent SDP glare
		if p.pc.SignalingState() != webrtc.SignalingStateStable {
			p.renegPending = true
			return
		}

		p.renegPending = false
		p.mu.RLock()
		cb := p.onRenegotiationNeeded
		p.mu.RUnlock()

		if cb != nil {
			cb()
		}
	})
}

// TriggerRenegotiation explicitly schedules a renegotiation offer.
func (p *Peer) TriggerRenegotiation() {
	p.scheduleRenegotiation()
}

// SetScreenTrackID sets or updates the screen share track ID for stream differentiation.
func (p *Peer) SetScreenTrackID(trackID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.screenTrackID = trackID
}

// ScreenTrackID returns the registered screen share track ID.
func (p *Peer) ScreenTrackID() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.screenTrackID
}

// SignalingState returns the underlying PeerConnection signaling state.
func (p *Peer) SignalingState() webrtc.SignalingState {
	return p.pc.SignalingState()
}

// ID returns the peer identifier.
func (p *Peer) ID() string {
	return p.id
}

// RoomID returns the peer's associated room.
func (p *Peer) RoomID() string {
	return p.roomID
}

// SetOnTrackPublished registers a listener for incoming published media tracks.
func (p *Peer) SetOnTrackPublished(f func(pubTrack *PublishedTrack)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onTrackPublished = f
}

// SetOnTrackUnpublished registers a listener for track teardown.
func (p *Peer) SetOnTrackUnpublished(f func(trackID string)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onTrackUnpublished = f
}

// SetOnRenegotiationNeeded registers a listener for WebRTC renegotiation requests.
func (p *Peer) SetOnRenegotiationNeeded(f func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onRenegotiationNeeded = f
}

// OnICECandidate registers a callback for ICE candidate generation.
func (p *Peer) OnICECandidate(f func(candidate *webrtc.ICECandidate)) {
	p.pc.OnICECandidate(f)
}

// OnICEConnectionStateChange registers a callback for ICE state transitions.
func (p *Peer) OnICEConnectionStateChange(f func(state webrtc.ICEConnectionState)) {
	p.pc.OnICEConnectionStateChange(f)
}

// Subscribe attaches a published track to this peer's RTCPeerConnection and requests a keyframe.
func (p *Peer) Subscribe(pubTrack *PublishedTrack, publisher *Peer) (*webrtc.RTPSender, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil, fmt.Errorf("peer is closed")
	}

	if sender, exists := p.subscribedSenders[pubTrack.ID]; exists {
		return sender, nil
	}

	sender, err := p.pc.AddTrack(pubTrack.TrackLocal)
	if err != nil {
		return nil, fmt.Errorf("failed to add track to subscriber peer: %w", err)
	}

	p.subscribedSenders[pubTrack.ID] = sender

	// Read RTCP from sender in background to handle PLI requests from subscriber
	go func() {
		for {
			select {
			case <-p.closeChan:
				return
			case <-pubTrack.stopChan:
				return
			default:
			}

			pkts, _, err := sender.ReadRTCP()
			if err != nil {
				return
			}

			for _, pkt := range pkts {
				switch pkt.(type) {
				case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
					if publisher != nil {
						_ = publisher.SendPLI(pubTrack.SSRC)
					}
				}
			}
		}
	}()

	// Request an immediate keyframe burst for newly subscribed video tracks
	if pubTrack.Kind == webrtc.RTPCodecTypeVideo && publisher != nil {
		_ = publisher.SendPLI(pubTrack.SSRC)
		time.AfterFunc(150*time.Millisecond, func() {
			_ = publisher.SendPLI(pubTrack.SSRC)
		})
		time.AfterFunc(400*time.Millisecond, func() {
			_ = publisher.SendPLI(pubTrack.SSRC)
		})
	}

	return sender, nil
}

// Unsubscribe detaches a track from this peer's RTCPeerConnection.
func (p *Peer) Unsubscribe(trackID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil
	}

	sender, ok := p.subscribedSenders[trackID]
	if !ok {
		return nil
	}

	delete(p.subscribedSenders, trackID)
	return p.pc.RemoveTrack(sender)
}

// SendPLI sends a Picture Loss Indication packet to request an instantaneous keyframe.
func (p *Peer) SendPLI(ssrc webrtc.SSRC) error {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if p.closed || p.pc == nil {
		return fmt.Errorf("peer is closed")
	}

	return p.pc.WriteRTCP([]rtcp.Packet{
		&rtcp.PictureLossIndication{
			MediaSSRC: uint32(ssrc),
		},
	})
}

// PublishedTracks returns a copy of currently published tracks.
func (p *Peer) PublishedTracks() []*PublishedTrack {
	p.mu.RLock()
	defer p.mu.RUnlock()

	tracks := make([]*PublishedTrack, 0, len(p.publishedTracks))
	for _, t := range p.publishedTracks {
		tracks = append(tracks, t)
	}
	return tracks
}

// SetRemoteDescription updates the remote SDP description and flushes pending renegotiation.
func (p *Peer) SetRemoteDescription(desc webrtc.SessionDescription) error {
	err := p.pc.SetRemoteDescription(desc)
	if err != nil {
		return err
	}

	// If answer settled negotiation to stable, trigger pending renegotiation if needed
	if desc.Type == webrtc.SDPTypeAnswer {
		p.renegMu.Lock()
		if p.renegPending {
			p.renegMu.Unlock()
			p.scheduleRenegotiation()
		} else {
			p.renegMu.Unlock()
		}
	}

	return nil
}

// CreateAnswer creates an SDP answer for an offer.
func (p *Peer) CreateAnswer() (*webrtc.SessionDescription, error) {
	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return nil, err
	}
	if err := p.pc.SetLocalDescription(answer); err != nil {
		return nil, err
	}
	return &answer, nil
}

// CreateOffer creates an SDP offer for renegotiation.
func (p *Peer) CreateOffer() (*webrtc.SessionDescription, error) {
	p.mu.RLock()
	closed := p.closed
	p.mu.RUnlock()
	if closed {
		return nil, fmt.Errorf("peer is closed")
	}

	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		return nil, err
	}
	if err := p.pc.SetLocalDescription(offer); err != nil {
		return nil, err
	}
	return &offer, nil
}

// AddICECandidate adds an ICE candidate received via signaling.
func (p *Peer) AddICECandidate(candidate webrtc.ICECandidateInit) error {
	return p.pc.AddICECandidate(candidate)
}

// Close gracefully closes the PeerConnection and cleans up all active tracks.
func (p *Peer) Close() error {
	var err error
	p.closeOnce.Do(func() {
		p.mu.Lock()
		p.closed = true
		close(p.closeChan)

		p.renegMu.Lock()
		if p.renegTimer != nil {
			p.renegTimer.Stop()
			p.renegTimer = nil
		}
		p.renegMu.Unlock()

		for _, t := range p.publishedTracks {
			t.Close()
		}
		p.publishedTracks = make(map[string]*PublishedTrack)
		p.subscribedSenders = make(map[string]*webrtc.RTPSender)
		p.mu.Unlock()

		if p.pc != nil {
			err = p.pc.Close()
		}
	})
	return err
}
