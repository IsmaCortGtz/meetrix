import { describe, it, expect, beforeEach } from 'vitest';
import { SignalingClient } from '../src/signaling';
import { setupMockBrowserEnvironment, MockWebSocket } from './mocks';

describe('SignalingClient', () => {
  beforeEach(() => {
    setupMockBrowserEnvironment();
    MockWebSocket.instances = [];
  });

  it('connects to WebSocket endpoint and emits open event', async () => {
    const client = new SignalingClient({ autoReconnect: false });
    let opened = false;
    client.on('open', () => {
      opened = true;
    });

    await client.connect('ws://localhost:8080/ws');
    expect(opened).toBe(true);
    expect(client.isConnected).toBe(true);
  });

  it('serializes and sends outbound join message', async () => {
    const client = new SignalingClient({ autoReconnect: false });
    await client.connect('ws://localhost:8080/ws');

    client.sendJoin({
      room_id: 'test-room',
      user_id: 'user-123',
      display_name: 'Alice',
    });

    const mockWs = MockWebSocket.instances[0];
    expect(mockWs.sentMessages.length).toBe(1);

    const parsed = JSON.parse(mockWs.sentMessages[0]);
    expect(parsed.type).toBe('join');
    expect(parsed.payload.room_id).toBe('test-room');
    expect(parsed.payload.user_id).toBe('user-123');
    expect(parsed.payload.display_name).toBe('Alice');
  });

  it('serializes all protocol sender payloads accurately', async () => {
    const client = new SignalingClient({ autoReconnect: false });
    await client.connect('ws://localhost:8080/ws');
    const mockWs = MockWebSocket.instances[0];

    client.sendOffer({ sdp: 'offer-sdp', type: 'offer' });
    client.sendAnswer({ sdp: 'answer-sdp', type: 'answer' });
    client.sendCandidate({ candidate: 'cand-line', sdpMid: '0', sdpMLineIndex: 0 });
    client.sendChatMessage({ text: 'Hello world' });
    client.sendReaction({ emoji: '👍' });
    client.sendRaiseHand({ raised: true });
    client.sendAdmitPeer({ peer_id: 'peer-2' });
    client.sendMutePeer({ peer_id: 'peer-2', media: 'audio' });
    client.sendStopPeerMedia({ peer_id: 'peer-2', media: 'screenshare' });
    client.sendKickPeer({ peer_id: 'peer-2', reason: 'Disruptive' });
    client.sendUpdatePolicies({
      policies: {
        allow_camera: false,
        allow_mic: true,
        allow_screen_share: false,
        allow_chat: true,
        allow_reactions: true,
        require_lobby: true,
      },
    });
    client.sendLeave();

    const types = mockWs.sentMessages.map((m) => JSON.parse(m).type);
    expect(types).toEqual([
      'offer',
      'answer',
      'candidate',
      'chat_message',
      'reaction',
      'raise_hand',
      'admit_peer',
      'mute_peer',
      'stop_peer_media',
      'kick_peer',
      'update_policies',
      'leave',
    ]);
  });

  it('queues messages sent before connection is established', async () => {
    const client = new SignalingClient({ autoReconnect: false });

    // Send while disconnected
    client.sendChatMessage({ text: 'Queued text' });

    await client.connect('ws://localhost:8080/ws');
    const mockWs = MockWebSocket.instances[0];

    expect(mockWs.sentMessages.length).toBe(1);
    const parsed = JSON.parse(mockWs.sentMessages[0]);
    expect(parsed.type).toBe('chat_message');
    expect(parsed.payload.text).toBe('Queued text');
  });

  it('dispatches incoming joined event', async () => {
    const client = new SignalingClient({ autoReconnect: false });
    await client.connect('ws://localhost:8080/ws');
    const mockWs = MockWebSocket.instances[0];

    let receivedPayload: any = null;
    client.on('joined', (p) => {
      receivedPayload = p;
    });

    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-alice',
        user_id: 'user-alice',
        display_name: 'Alice',
        role: 'host',
        permissions: { can_publish_audio: true, can_publish_video: true },
        participants: [],
        session_remaining_sec: 3600,
        ice_servers: [{ urls: 'stun:stun.l.google.com:19302' }],
      },
    });

    expect(receivedPayload).not.toBeNull();
    expect(receivedPayload.peer_id).toBe('peer-alice');
    expect(receivedPayload.role).toBe('host');
  });

  it('dispatches incoming chat and reaction events', async () => {
    const client = new SignalingClient({ autoReconnect: false });
    await client.connect('ws://localhost:8080/ws');
    const mockWs = MockWebSocket.instances[0];

    let chatReceived: any = null;
    let reactionReceived: any = null;

    client.on('chat_message', (p) => {
      chatReceived = p;
    });
    client.on('reaction', (p) => {
      reactionReceived = p;
    });

    mockWs.simulateServerMessage({
      type: 'chat_message',
      payload: {
        id: 'msg-1',
        peer_id: 'peer-bob',
        user_id: 'user-bob',
        display_name: 'Bob',
        text: 'Hey everyone!',
        timestamp: new Date().toISOString(),
      },
    });

    mockWs.simulateServerMessage({
      type: 'reaction',
      payload: {
        peer_id: 'peer-bob',
        user_id: 'user-bob',
        emoji: '❤️',
        timestamp: new Date().toISOString(),
      },
    });

    expect(chatReceived?.text).toBe('Hey everyone!');
    expect(reactionReceived?.emoji).toBe('❤️');
  });

  it('disconnects cleanly without attempting reconnect', async () => {
    const client = new SignalingClient({ autoReconnect: true });
    await client.connect('ws://localhost:8080/ws');

    let closed = false;
    client.on('close', () => {
      closed = true;
    });

    client.disconnect();
    expect(client.isConnected).toBe(false);
    expect(closed).toBe(true);
  });
});

