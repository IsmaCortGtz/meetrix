package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	"github.com/connected-framework/connected/server/pkg/config"
	"github.com/connected-framework/connected/server/pkg/permissions"
)

// ExecAuthenticator delegates authentication to an external CLI process via stdin/stdout.
type ExecAuthenticator struct {
	command string
	args    []string
	timeout time.Duration
}

// NewExecAuthenticator creates a new ExecAuthenticator.
func NewExecAuthenticator(cfg config.ExecAuthConfig) *ExecAuthenticator {
	timeout := time.Duration(cfg.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &ExecAuthenticator{
		command: cfg.Command,
		args:    cfg.Args,
		timeout: timeout,
	}
}

// Authenticate executes the CLI command, sends AuthRequest on stdin, and parses stdout.
func (e *ExecAuthenticator) Authenticate(ctx context.Context, req AuthRequest) (*AuthResponse, error) {
	if e.command == "" {
		return &AuthResponse{
			Allowed: false,
			Reason:  "exec command is not configured",
		}, nil
	}

	execCtx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()

	cmd := exec.CommandContext(execCtx, e.command, e.args...)

	inputBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to encode auth request: %w", err)
	}

	cmd.Stdin = bytes.NewReader(inputBytes)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		stderrStr := stderr.String()
		if execCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("auth command timed out after %v", e.timeout)
		}
		return &AuthResponse{
			Allowed: false,
			Reason:  fmt.Sprintf("auth command execution failed: %v (%s)", err, stderrStr),
		}, nil
	}

	var authResp AuthResponse
	if err := json.Unmarshal(stdout.Bytes(), &authResp); err != nil {
		return nil, fmt.Errorf("failed to parse auth command output as JSON: %w (output: %s)", err, stdout.String())
	}

	// Apply default permissions if missing
	if authResp.Allowed && authResp.Permissions == nil {
		defaultPerms := permissions.DefaultPermissionsForRole(authResp.Role)
		authResp.Permissions = &defaultPerms
	}

	return &authResp, nil
}
