package sfu

import (
	"fmt"
	"net"
	"sync"

	"github.com/IsmaCortGtz/meetrix/server/pkg/config"
	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"
)

// Engine encapsulates the Pion WebRTC API and media configuration.
type Engine struct {
	mu         sync.RWMutex
	api        *webrtc.API
	iceServers []webrtc.ICEServer
}

// NewEngine initializes the Pion WebRTC media engine, interceptors, and port settings.
func NewEngine(cfg config.ServerConfig) (*Engine, error) {
	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("failed to register default codecs: %w", err)
	}

	settingEngine := webrtc.SettingEngine{}
	if cfg.WebRTCPortMin > 0 && cfg.WebRTCPortMax >= cfg.WebRTCPortMin {
		if err := settingEngine.SetEphemeralUDPPortRange(cfg.WebRTCPortMin, cfg.WebRTCPortMax); err != nil {
			return nil, fmt.Errorf("failed to set UDP port range [%d, %d]: %w", cfg.WebRTCPortMin, cfg.WebRTCPortMax, err)
		}
	}

	if cfg.PublicIP != "" && cfg.PublicIP != "auto" {
		_ = settingEngine.SetICEAddressRewriteRules(webrtc.ICEAddressRewriteRule{
			External:        []string{cfg.PublicIP},
			AsCandidateType: webrtc.ICECandidateTypeHost,
			Mode:            webrtc.ICEAddressRewriteReplace,
		})
		if ip := net.ParseIP(cfg.PublicIP); ip != nil && ip.IsLoopback() {
			settingEngine.SetIncludeLoopbackCandidate(true)
		}
	}

	interceptorRegistry := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(mediaEngine, interceptorRegistry); err != nil {
		return nil, fmt.Errorf("failed to register default interceptors: %w", err)
	}

	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithSettingEngine(settingEngine),
		webrtc.WithInterceptorRegistry(interceptorRegistry),
	)

	iceServers := []webrtc.ICEServer{
		{
			URLs: []string{"stun:stun.l.google.com:19302"},
		},
	}

	if cfg.TURN.Enabled {
		turnHost := cfg.PublicIP
		if turnHost == "" || turnHost == "auto" {
			turnHost = "127.0.0.1"
		}
		turnURL := fmt.Sprintf("turn:%s:%d?transport=udp", turnHost, cfg.TURN.Port)

		// Static users configured
		for username, credential := range cfg.TURN.Users {
			iceServers = append(iceServers, webrtc.ICEServer{
				URLs:           []string{turnURL},
				Username:       username,
				Credential:     credential,
				CredentialType: webrtc.ICECredentialTypePassword,
			})
		}
	}

	return &Engine{
		api:        api,
		iceServers: iceServers,
	}, nil
}

// ICEServers returns the configured ICE / STUN / TURN servers for client handshakes.
func (e *Engine) ICEServers() []webrtc.ICEServer {
	e.mu.RLock()
	defer e.mu.RUnlock()
	servers := make([]webrtc.ICEServer, len(e.iceServers))
	copy(servers, e.iceServers)
	return servers
}

// NewPeerConnection creates an instance of webrtc.PeerConnection configured with the engine's settings.
func (e *Engine) NewPeerConnection() (*webrtc.PeerConnection, error) {
	e.mu.RLock()
	servers := e.iceServers
	e.mu.RUnlock()

	return e.api.NewPeerConnection(webrtc.Configuration{
		ICEServers: servers,
	})
}
