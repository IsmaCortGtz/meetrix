package turn

import (
	"net"
	"testing"

	"github.com/IsmaCortGtz/connected/server/pkg/config"
	pionturn "github.com/pion/turn/v3"
)

func TestTurnServerLifecycle(t *testing.T) {
	cfg := config.TURNConfig{
		Enabled: true,
		Realm:   "test-realm",
		Port:    13478, // High non-privileged port
		Users: map[string]string{
			"alice": "secret123",
		},
		Secret: "shared-turn-secret",
	}

	server, err := NewServer(cfg, "127.0.0.1", 50100, 50150)
	if err != nil {
		t.Fatalf("failed to start TURN server: %v", err)
	}
	defer func() {
		_ = server.Close()
	}()

	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 12345}

	// 1. Valid user auth
	key, ok := server.authHandler("alice", "test-realm", addr)
	if !ok || len(key) == 0 {
		t.Errorf("expected successful auth for alice")
	}

	expectedKey := pionturn.GenerateAuthKey("alice", "test-realm", "secret123")
	if string(key) != string(expectedKey) {
		t.Errorf("generated auth key mismatch")
	}

	// 2. Invalid user auth
	_, ok = server.authHandler("bob", "test-realm", addr)
	if ok {
		t.Errorf("expected failed auth for unknown user bob")
	}

	// 3. Dynamic user addition
	server.AddUser("charlie", "password456")
	keyC, okC := server.authHandler("charlie", "test-realm", addr)
	if !okC || len(keyC) == 0 {
		t.Errorf("expected successful auth for dynamically added user charlie")
	}

	// 4. Dynamic user removal
	server.RemoveUser("charlie")
	_, okC2 := server.authHandler("charlie", "test-realm", addr)
	if okC2 {
		t.Errorf("expected failed auth for removed user charlie")
	}

	// 5. Ephemeral REST-style credential check
	_, okRest := server.authHandler("1700000000:client-1", "test-realm", addr)
	if !okRest {
		t.Errorf("expected successful auth for REST credential")
	}

	// 6. Close server
	if err := server.Close(); err != nil {
		t.Errorf("error during server close: %v", err)
	}
}
