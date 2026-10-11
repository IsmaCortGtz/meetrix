import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectedRoom } from '../src/room';
import { setupMockBrowserEnvironment, MockWebSocket } from './mocks';

describe('ConnectedRoom Lifecycle & Events', () => {
  beforeEach(() => {
    setupMockBrowserEnvironment();
    MockWebSocket.instances = [];
  });

  it('initializes in disconnected state', () => {
    const room = new ConnectedRoom({ autoReconnect: false });
    expect(room.state).toBe('disconnected');
    expect(room.remoteParticipants.size).toBe(0);
  });

  it('handles complete room join lifecycle', async () => {
    const room = new ConnectedRoom({ autoReconnect: false });

    let connectedEventPayload: any = null;
    room.on('connected', (payload) => {
      connectedEventPayload = payload;
    });

    const joinPromise = room.join({
      url: 'ws://localhost:8080/ws',
      roomId: 'engineering-daily',
      displayName: 'Alice',
      userId: 'user-alice-1',
    });

    // Verify WebSocket connection was established
    expect(MockWebSocket.instances.length).toBe(1);
    const mockWs = MockWebSocket.instances[0];

    // Wait for mock WebSocket open event
    await new Promise((r) => setTimeout(r, 10));

    // Simulate server 'joined' reply
    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-alice',
        user_id: 'user-alice-1',
        display_name: 'Alice',
        role: 'host',
        permissions: {
          can_publish_audio: true,
          can_publish_video: true,
          can_publish_screen: true,
          can_chat: true,
          can_react: true,
        },
        policies: {
          allow_camera: true,
          allow_mic: true,
          allow_screen_share: true,
          allow_chat: true,
          allow_reactions: true,
          require_lobby: false,
        },
        participants: [
          {
            id: 'peer-alice',
            user_id: 'user-alice-1',
            display_name: 'Alice',
            role: 'host',
            permissions: { can_publish_audio: true, can_publish_video: true },
            audio_muted: false,
            video_muted: false,
            screen_sharing: false,
            hand_raised: false,
          },
          {
            id: 'peer-bob',
            user_id: 'user-bob-2',
            display_name: 'Bob',
            role: 'participant',
            permissions: { can_publish_audio: true, can_publish_video: true },
            audio_muted: true,
            video_muted: false,
            screen_sharing: false,
            hand_raised: false,
          },
        ],
        session_remaining_sec: 1800,
        ice_servers: [{ urls: 'stun:stun.l.google.com:19302' }],
      },
    });

    const joinedPayload = await joinPromise;
    expect(room.state).toBe('connected');
    expect(connectedEventPayload).not.toBeNull();
    expect(room.localParticipant.id).toBe('peer-alice');
    expect(room.localParticipant.role).toBe('host');
    expect(room.sessionRemainingSec).toBe(1800);

    // Verify remote peer Bob was added
    expect(room.remoteParticipants.size).toBe(1);
    const bob = room.remoteParticipants.get('peer-bob');
    expect(bob).toBeDefined();
    expect(bob?.displayName).toBe('Bob');
    expect(bob?.audioMuted).toBe(true);
  });

  it('handles remote participant joined and left', async () => {
    const room = new ConnectedRoom({ autoReconnect: false });
    const joinPromise = room.join({ url: 'ws://localhost:8080/ws', roomId: 'standup' });
    await new Promise((r) => setTimeout(r, 10));

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-alice',
        user_id: 'user-1',
        display_name: 'Alice',
        role: 'host',
        permissions: {},
        participants: [],
        session_remaining_sec: 3600,
        ice_servers: [],
      },
    });
    await joinPromise;

    let joinedPeer: any = null;
    let leftPeerId: string | null = null;
    room.on('participantJoined', (p) => (joinedPeer = p));
    room.on('participantLeft', (id) => (leftPeerId = id));

    // Simulate Charlie joining
    mockWs.simulateServerMessage({
      type: 'peer_joined',
      payload: {
        peer: {
          id: 'peer-charlie',
          user_id: 'user-3',
          display_name: 'Charlie',
          role: 'participant',
          permissions: {},
          audio_muted: false,
          video_muted: false,
          screen_sharing: false,
          hand_raised: false,
        },
      },
    });

    expect(joinedPeer).not.toBeNull();
    expect(joinedPeer?.id).toBe('peer-charlie');
    expect(room.remoteParticipants.has('peer-charlie')).toBe(true);

    // Simulate Charlie leaving
    mockWs.simulateServerMessage({
      type: 'peer_left',
      payload: { peer_id: 'peer-charlie' },
    });

    expect(leftPeerId).toBe('peer-charlie');
    expect(room.remoteParticipants.has('peer-charlie')).toBe(false);
  });

  it('handles chat messages and reactions', async () => {
    const room = new ConnectedRoom({ autoReconnect: false });
    const joinPromise = room.join({ url: 'ws://localhost:8080/ws', roomId: 'standup' });
    await new Promise((r) => setTimeout(r, 10));

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-me',
        user_id: 'user-1',
        display_name: 'Me',
        role: 'participant',
        permissions: {},
        participants: [],
        session_remaining_sec: 3600,
        ice_servers: [],
      },
    });
    await joinPromise;

    let receivedChat: any = null;
    let receivedReaction: any = null;
    room.on('chatMessage', (c) => (receivedChat = c));
    room.on('reaction', (r) => (receivedReaction = r));

    // Send a chat message
    await room.chat.sendMessage('Hello Connected SFU!');
    const lastMsg = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]);
    expect(lastMsg.type).toBe('chat_message');
    expect(lastMsg.payload.text).toBe('Hello Connected SFU!');

    // Simulate inbound chat broadcast
    mockWs.simulateServerMessage({
      type: 'chat_message',
      payload: {
        id: 'msg-99',
        peer_id: 'peer-other',
        user_id: 'user-2',
        display_name: 'Other',
        text: 'Hello back!',
        timestamp: new Date().toISOString(),
      },
    });

    expect(receivedChat?.text).toBe('Hello back!');

    // Send and receive reaction
    room.reactions.sendReaction('🎉');
    const reactionSent = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]);
    expect(reactionSent.type).toBe('reaction');
    expect(reactionSent.payload.emoji).toBe('🎉');

    mockWs.simulateServerMessage({
      type: 'reaction',
      payload: {
        peer_id: 'peer-other',
        user_id: 'user-2',
        emoji: '🔥',
        timestamp: new Date().toISOString(),
      },
    });
    expect(receivedReaction?.emoji).toBe('🔥');
  });

  it('handles moderation mute and kick events', async () => {
    const room = new ConnectedRoom({ autoReconnect: false });
    const joinPromise = room.join({ url: 'ws://localhost:8080/ws', roomId: 'standup' });
    await new Promise((r) => setTimeout(r, 10));

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-target',
        user_id: 'user-target',
        display_name: 'Target',
        role: 'participant',
        permissions: {},
        participants: [],
        session_remaining_sec: 3600,
        ice_servers: [],
      },
    });
    await joinPromise;

    let moderationEvt: any = null;
    let disconnectReason: string | undefined = undefined;

    room.on('moderationAction', (m) => (moderationEvt = m));
    room.on('disconnected', (reason) => (disconnectReason = reason));

    // Simulate peer_muted for local participant
    mockWs.simulateServerMessage({
      type: 'peer_muted',
      payload: {
        peer_id: 'peer-target',
        media: 'audio',
        by_peer_id: 'peer-host',
      },
    });

    expect(moderationEvt?.action).toBe('mute');
    expect(moderationEvt?.media).toBe('audio');
    expect(room.localParticipant.isMicrophoneMuted).toBe(true);

    // Simulate kicked
    mockWs.simulateServerMessage({
      type: 'kicked',
      payload: {
        by_peer_id: 'peer-host',
        reason: 'Session ended by administrator',
      },
    });

    expect(room.state).toBe('disconnected');
    expect(disconnectReason).toBe('Session ended by administrator');
  });

  it('updates session timer on ticks', async () => {
    const room = new ConnectedRoom({ autoReconnect: false });
    const joinPromise = room.join({ url: 'ws://localhost:8080/ws', roomId: 'timed-session' });
    await new Promise((r) => setTimeout(r, 10));

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-me',
        user_id: 'user-1',
        display_name: 'Me',
        role: 'participant',
        permissions: {},
        participants: [],
        session_remaining_sec: 120,
        ice_servers: [],
      },
    });
    await joinPromise;

    let tickReceived = 0;
    room.on('sessionTimerTick', (rem) => (tickReceived = rem));

    mockWs.simulateServerMessage({
      type: 'session_timer_tick',
      payload: { remaining_sec: 60 },
    });

    expect(tickReceived).toBe(60);
    expect(room.sessionRemainingSec).toBe(60);
  });

  it('leaves room cleanly', async () => {
    const room = new ConnectedRoom({ autoReconnect: false });
    const joinPromise = room.join({ url: 'ws://localhost:8080/ws', roomId: 'standup' });
    await new Promise((r) => setTimeout(r, 10));

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-me',
        user_id: 'user-1',
        display_name: 'Me',
        role: 'participant',
        permissions: {},
        participants: [],
        session_remaining_sec: 3600,
        ice_servers: [],
      },
    });
    await joinPromise;

    let disconnected = false;
    room.on('disconnected', () => (disconnected = true));

    await room.leave();
    expect(room.state).toBe('disconnected');
    expect(disconnected).toBe(true);

    const lastMsg = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]);
    expect(lastMsg.type).toBe('leave');
  });

  it('emits peerMediaChanged when media_state_changed is received', async () => {
    const room = new ConnectedRoom({ autoReconnect: false });
    const joinPromise = room.join({ url: 'ws://localhost:8080/ws', roomId: 'standup' });
    await new Promise((r) => setTimeout(r, 10));

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      type: 'joined',
      payload: {
        peer_id: 'peer-me',
        user_id: 'user-1',
        display_name: 'Me',
        role: 'participant',
        permissions: {},
        participants: [
          {
            id: 'peer-bob',
            user_id: 'user-bob',
            display_name: 'Bob',
            role: 'participant',
            permissions: {},
            audio_muted: false,
            video_muted: false,
            screen_sharing: false,
            hand_raised: false,
          },
        ],
        session_remaining_sec: 3600,
        ice_servers: [],
      },
    });
    await joinPromise;

    let mediaChangedPeer: any = null;
    let mediaChangedState: any = null;
    room.on('peerMediaChanged', (peer, state) => {
      mediaChangedPeer = peer;
      mediaChangedState = state;
    });

    mockWs.simulateServerMessage({
      type: 'media_state_changed',
      payload: {
        peer_id: 'peer-bob',
        screen_sharing: true,
        video_muted: false,
      },
    });

    expect(mediaChangedPeer).not.toBeNull();
    expect(mediaChangedPeer?.id).toBe('peer-bob');
    expect(mediaChangedState?.screen_sharing).toBe(true);
    expect(mediaChangedPeer?.screenSharing).toBe(true);
  });
});

