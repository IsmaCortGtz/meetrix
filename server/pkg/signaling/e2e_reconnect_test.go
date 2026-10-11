package signaling

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/IsmaCortGtz/meetrix/server/pkg/auth"
	"github.com/IsmaCortGtz/meetrix/server/pkg/config"
	"github.com/IsmaCortGtz/meetrix/server/pkg/room"
	"github.com/IsmaCortGtz/meetrix/server/pkg/sfu"

	"github.com/gorilla/websocket"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// e2eClient is a minimal Pion-based stand-in for a browser using @meetrix/core.
type e2eClient struct {
	t       *testing.T
	ws      *websocket.Conn
	wsMu    sync.Mutex
	pc      *webrtc.PeerConnection
	pcReady chan struct{}
	name    string
	pubs    []*webrtc.TrackLocalStaticRTP

	mu       sync.Mutex
	received map[string]*int64 // "streamID/trackID" -> RTP packets received
	candMu            sync.Mutex
	pendingCandidates []webrtc.ICECandidateInit
	stop              chan struct{}
}

func (c *e2eClient) flushPendingCandidates() {
	c.candMu.Lock()
	defer c.candMu.Unlock()
	for _, cand := range c.pendingCandidates {
		_ = c.pc.AddICECandidate(cand)
	}
	c.pendingCandidates = nil
}

func newE2EClient(t *testing.T, serverURL, name string, publish bool) *e2eClient {
	c := &e2eClient{
		t:        t,
		ws:       connectWS(t, serverURL),
		pcReady:  make(chan struct{}),
		name:     name,
		received: map[string]*int64{},
		stop:     make(chan struct{}),
	}
	if publish {
		a, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, name+"-a", name+"-sa")
		v, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, name+"-v", name+"-sv")
		c.pubs = []*webrtc.TrackLocalStaticRTP{a, v}
	}
	go c.readLoop()
	c.send(TypeJoin, JoinPayload{RoomID: "room-e2e", DisplayName: name})
	return c
}

func (c *e2eClient) send(typ string, payload interface{}) {
	msg, _ := EncodeMessage(typ, payload)
	c.wsMu.Lock()
	defer c.wsMu.Unlock()
	_ = c.ws.WriteMessage(websocket.TextMessage, msg)
}

// packetsFrom returns RTP packets received on tracks whose ID starts with the given publisher name.
func (c *e2eClient) packetsFrom(publisher string) int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	var total int64
	for k, v := range c.received {
		if strings.Contains(k, "/"+publisher+"-") {
			total += atomic.LoadInt64(v)
		}
	}
	return total
}

func (c *e2eClient) streams() map[string]int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := map[string]int64{}
	for k, v := range c.received {
		out[k] = atomic.LoadInt64(v)
	}
	return out
}

func (c *e2eClient) setupPC() {
	se := webrtc.SettingEngine{}
	se.SetIncludeLoopbackCandidate(true)
	pc, err := webrtc.NewAPI(webrtc.WithSettingEngine(se)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		c.t.Errorf("pc: %v", err)
		return
	}
	c.pc = pc
	pc.OnICEConnectionStateChange(func(s webrtc.ICEConnectionState) { c.t.Logf("%s ICE %s", c.name, s) })
	pc.OnICECandidate(func(ic *webrtc.ICECandidate) {
		if ic == nil {
			return
		}
		j := ic.ToJSON()
		c.send(TypeCandidate, CandidatePayload{Candidate: j.Candidate, SDPMid: j.SDPMid, SDPMLineIndex: j.SDPMLineIndex})
	})
	pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		counter := new(int64)
		key := tr.StreamID() + "/" + tr.ID()
		c.mu.Lock()
		c.received[key] = counter
		c.mu.Unlock()
		for {
			if _, _, err := tr.ReadRTP(); err != nil {
				return
			}
			atomic.AddInt64(counter, 1)
		}
	})
	for _, tl := range c.pubs {
		if _, err := pc.AddTrack(tl); err != nil {
			c.t.Errorf("addtrack: %v", err)
		}
	}
	close(c.pcReady)

	if len(c.pubs) > 0 {
		offer, _ := pc.CreateOffer(nil)
		_ = pc.SetLocalDescription(offer)
		c.send(TypeOffer, SDPPayload{SDP: offer.SDP, Type: "offer"})
		go c.pump()
	}
}

func (c *e2eClient) pump() {
	var seq uint16
	var ts uint32
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-tick.C:
			seq++
			ts += 960
			for i, tl := range c.pubs {
				pt := uint8(111)
				payload := []byte{0x01, 0x02, 0x03}
				if i == 1 {
					pt = 96
					payload = []byte{0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a}
				}
				_ = tl.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, PayloadType: pt, SequenceNumber: seq, Timestamp: ts, SSRC: uint32(1000 + i)}, Payload: payload})
			}
		}
	}
}

func (c *e2eClient) readLoop() {
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		var env Envelope
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		switch env.Type {
		case TypeJoined:
			c.setupPC()
		case TypeOffer:
			<-c.pcReady
			var p SDPPayload
			_ = json.Unmarshal(env.Payload, &p)
			if c.pc.SignalingState() != webrtc.SignalingStateStable {
				_ = c.pc.SetLocalDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeRollback})
			}
			if err := c.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: p.SDP}); err != nil {
				c.t.Errorf("%s setRemote(offer): %v", c.name, err)
				continue
			}
			c.flushPendingCandidates()
			ans, _ := c.pc.CreateAnswer(nil)
			_ = c.pc.SetLocalDescription(ans)
			c.send(TypeAnswer, SDPPayload{SDP: ans.SDP, Type: "answer"})
		case TypeAnswer:
			var p SDPPayload
			_ = json.Unmarshal(env.Payload, &p)
			if err := c.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: p.SDP}); err != nil {
				c.t.Errorf("%s setRemote(answer): %v", c.name, err)
			}
			c.flushPendingCandidates()
		case TypeCandidate:
			<-c.pcReady
			var p CandidatePayload
			_ = json.Unmarshal(env.Payload, &p)
			cand := webrtc.ICECandidateInit{Candidate: p.Candidate, SDPMid: p.SDPMid, SDPMLineIndex: p.SDPMLineIndex}
			if c.pc.RemoteDescription() == nil {
				c.candMu.Lock()
				c.pendingCandidates = append(c.pendingCandidates, cand)
				c.candMu.Unlock()
			} else {
				_ = c.pc.AddICECandidate(cand)
			}
		}
	}
}

func (c *e2eClient) leave() {
	select {
	case <-c.stop:
		return
	default:
	}
	close(c.stop)
	_ = c.ws.Close()
	if c.pc != nil {
		_ = c.pc.Close()
	}
}

func waitFor(d time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return cond()
}

// TestE2EPublisherReconnectReachesExistingSubscriber reproduces: A publishes, B subscribes,
// A leaves, C joins and publishes -> B must receive C's audio and video.
func TestE2EPublisherReconnectReachesExistingSubscriber(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.PublicIP = "127.0.0.1"
	cfg.Server.TURN.Enabled = false
	sfuEngine, err := sfu.NewEngine(cfg.Server)
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub(room.NewRoomManager(cfg.Room), sfuEngine, auth.NewAllowAllAuthenticator())
	ts := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer ts.Close()

	a := newE2EClient(t, ts.URL, "A", true)
	b := newE2EClient(t, ts.URL, "B", false)
	defer b.leave()

	if !waitFor(15*time.Second, func() bool { return b.packetsFrom("A") > 20 }) {
		t.Fatalf("B never received media from A: %v", b.streams())
	}

	a.leave()
	time.Sleep(time.Second)

	c := newE2EClient(t, ts.URL, "C", true)
	defer c.leave()

	if !waitFor(15*time.Second, func() bool { return b.packetsFrom("C") > 20 }) {
		t.Fatalf("B received no RTP from reconnected publisher C: %v", b.streams())
	}
}
