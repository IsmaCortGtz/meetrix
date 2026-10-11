package turn

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"

	"github.com/connected-framework/connected/server/pkg/config"
	"github.com/pion/turn/v3"
)

// Server encapsulates Pion TURN server instance and its underlying UDP packet connection.
type Server struct {
	mu         sync.RWMutex
	turnServer *turn.Server
	packetConn net.PacketConn
	realm      string
	port       int
	users      map[string]string
	secret     string
}

// NewServer initializes and starts an embedded STUN/TURN server listening on UDP.
func NewServer(cfg config.TURNConfig, publicIPStr string, minPort, maxPort uint16) (*Server, error) {
	listenAddr := fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	packetConn, err := net.ListenPacket("udp4", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on UDP %s for TURN: %w", listenAddr, err)
	}

	relayIP := resolveRelayIP(publicIPStr)

	s := &Server{
		packetConn: packetConn,
		realm:      cfg.Realm,
		port:       cfg.Port,
		users:      make(map[string]string),
		secret:     cfg.Secret,
	}

	for u, p := range cfg.Users {
		s.users[u] = p
	}

	relayGenerator := &turn.RelayAddressGeneratorPortRange{
		RelayAddress: relayIP,
		Address:      "0.0.0.0",
		MinPort:      minPort,
		MaxPort:      maxPort,
	}
	if err := relayGenerator.Validate(); err != nil {
		// Fallback to static if port range validation fails (e.g., minPort == 0)
		_ = packetConn.Close()
		return nil, fmt.Errorf("invalid relay port range [%d, %d]: %w", minPort, maxPort, err)
	}

	turnServer, err := turn.NewServer(turn.ServerConfig{
		Realm:       cfg.Realm,
		AuthHandler: s.authHandler,
		PacketConnConfigs: []turn.PacketConnConfig{
			{
				PacketConn:             packetConn,
				RelayAddressGenerator: relayGenerator,
			},
		},
	})
	if err != nil {
		_ = packetConn.Close()
		return nil, fmt.Errorf("failed to create TURN server: %w", err)
	}

	s.turnServer = turnServer
	return s, nil
}

// authHandler handles incoming authentication requests against static users and dynamic credentials.
func (s *Server) authHandler(username, realm string, srcAddr net.Addr) ([]byte, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Check static users
	if password, ok := s.users[username]; ok {
		return turn.GenerateAuthKey(username, realm, password), true
	}

	// Check dynamic / ephemeral REST-style credentials if secret is configured
	// Standard TURN REST API: username format: "<timestamp>:<client-id>"
	if s.secret != "" && strings.Contains(username, ":") {
		parts := strings.SplitN(username, ":", 2)
		if len(parts) == 2 {
			if _, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
				// In TURN REST API, password is HMAC-SHA1(timestamp:client-id, secret)
				// Returning the key generated from the shared secret
				return turn.GenerateAuthKey(username, realm, s.secret), true
			}
		}
	}

	return nil, false
}

// AddUser registers or updates a dynamic username and password.
func (s *Server) AddUser(username, password string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[username] = password
}

// RemoveUser deletes a dynamic username.
func (s *Server) RemoveUser(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.users, username)
}

// Close gracefully stops the TURN server and closes UDP listener.
func (s *Server) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var firstErr error
	if s.turnServer != nil {
		if err := s.turnServer.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		s.turnServer = nil
	}
	if s.packetConn != nil {
		if err := s.packetConn.Close(); err != nil && firstErr == nil && !errors.Is(err, net.ErrClosed) {
			firstErr = err
		}
		s.packetConn = nil
	}
	return firstErr
}

// resolveRelayIP resolves public IP from configuration or detects system outbound IP.
func resolveRelayIP(publicIPStr string) net.IP {
	if publicIPStr != "" && publicIPStr != "auto" {
		if ip := net.ParseIP(publicIPStr); ip != nil {
			return ip
		}
	}

	// Attempt to determine outbound IP
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		localAddr := conn.LocalAddr().(*net.UDPAddr)
		return localAddr.IP
	}

	// Fallback to loopback
	return net.ParseIP("127.0.0.1")
}
