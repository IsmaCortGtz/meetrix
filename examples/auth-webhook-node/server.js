/**
 * Connected Framework - Authentication Webhook Server (Node.js Reference)
 *
 * Demonstrates how an external backend validates meeting join requests from the Go SFU.
 * The Go server invokes this webhook endpoint via HTTP POST whenever a client attempts to join.
 */

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3001;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'demo-webhook-secret';

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'connected-auth-webhook' });
});

/**
 * Authentication Webhook Handler
 *
 * Expected Request Body (from Go SFU):
 * {
 *   "room_id": "engineering-daily",
 *   "token": "admin-token-xyz",
 *   "user_id": "usr-123",
 *   "display_name": "Alice Developer",
 *   "metadata": { "department": "Core Platform" },
 *   "remote_addr": "192.168.1.1:54321"
 * }
 */
app.post('/auth/webhook', (req, res) => {
  const authHeader = req.headers['authorization'];
  const signatureHeader = req.headers['x-connected-signature'];

  // 1. Verify shared secret between Go SFU and Webhook server
  if (WEBHOOK_SECRET) {
    const bearerSecret = authHeader ? authHeader.replace(/^Bearer\s+/, '') : null;
    const providedSecret = signatureHeader || bearerSecret;

    if (!providedSecret || providedSecret !== WEBHOOK_SECRET) {
      console.warn(`[Auth Webhook] Unauthorized request signature: ${providedSecret}`);
      return res.status(401).json({
        allowed: false,
        reason: 'Invalid webhook authentication secret signature',
      });
    }
  }

  const { room_id, token, user_id, display_name, metadata } = req.body;
  console.log(`[Auth Webhook] Incoming join request for room="${room_id}", user="${display_name || user_id}"`);

  // 2. Validate Room ID
  if (!room_id) {
    return res.status(400).json({
      allowed: false,
      reason: 'Room ID is required',
    });
  }

  // 3. Reject explicitly blocked or expired tokens
  if (token === 'banned' || token === 'expired') {
    return res.json({
      allowed: false,
      reason: 'User or token is revoked from accessing this meeting',
    });
  }

  // 4. Determine role & permissions based on token or metadata
  let role = 'participant';
  let userId = user_id || `user-${Math.random().toString(36).substring(2, 8)}`;
  let displayName = display_name || 'Anonymous User';

  // Demo Token Rules:
  if (token === 'host-secret' || token === 'admin-123' || (metadata && metadata.role === 'host')) {
    role = 'host';
  } else if (token === 'cohost-secret' || (metadata && metadata.role === 'co-host')) {
    role = 'co-host';
  } else if (token === 'viewer-secret' || (metadata && metadata.role === 'viewer')) {
    role = 'viewer';
  }

  // Generate granular permissions matching the role
  const permissions = {
    can_publish_audio: role !== 'viewer',
    can_publish_video: role !== 'viewer',
    can_publish_screen: role !== 'viewer',
    can_chat: true,
    can_react: true,
  };

  // Optional room policy configuration (custom per room)
  const room_policy = {
    allow_camera: true,
    allow_mic: true,
    allow_screen_share: true,
    allow_chat: true,
    allow_reactions: true,
    require_lobby: false,
  };

  const responsePayload = {
    allowed: true,
    user_id: userId,
    display_name: displayName,
    role: role,
    permissions: permissions,
    room_policy: room_policy,
  };

  console.log(`[Auth Webhook] Approved room="${room_id}" user="${displayName}" role="${role}"`);
  return res.json(responsePayload);
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`Connected Authentication Webhook Server running at http://localhost:${PORT}`);
  console.log(`Webhook endpoint: POST http://localhost:${PORT}/auth/webhook`);
  console.log(`Shared Secret: "${WEBHOOK_SECRET}"`);
});

