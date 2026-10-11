import { describe, it, expect, beforeEach } from 'vitest';
import {
  roleLevel,
  canModerate,
  canPublishMedia,
  ModerationController,
} from '../src/moderation';
import { SignalingClient } from '../src/signaling';
import { RoomPolicy, UserPermissions } from '../src/types';
import { PermissionError } from '../src/errors';
import { setupMockBrowserEnvironment, MockWebSocket } from './mocks';

describe('Moderation Logic & Permissions', () => {
  const defaultPolicy: RoomPolicy = {
    allow_camera: true,
    allow_mic: true,
    allow_screen_share: true,
    allow_chat: true,
    allow_reactions: true,
    require_lobby: false,
  };

  const defaultPerms: UserPermissions = {
    can_publish_audio: true,
    can_publish_video: true,
    can_publish_screen: true,
    can_chat: true,
    can_react: true,
  };

  describe('roleLevel', () => {
    it('ranks roles correctly: host > co-host > participant > viewer', () => {
      expect(roleLevel('host')).toBe(3);
      expect(roleLevel('co-host')).toBe(2);
      expect(roleLevel('participant')).toBe(1);
      expect(roleLevel('viewer')).toBe(0);
    });
  });

  describe('canModerate', () => {
    it('allows host to perform any moderation action', () => {
      expect(canModerate('host', 'co-host', 'kick')).toBe(true);
      expect(canModerate('host', 'participant', 'mute')).toBe(true);
      expect(canModerate('host', 'participant', 'stop_media')).toBe(true);
      expect(canModerate('host', '', 'end_room')).toBe(true);
      expect(canModerate('host', '', 'admit')).toBe(true);
      expect(canModerate('host', '', 'update_policy')).toBe(true);
    });

    it('allows co-host to moderate participants and viewers, but not host or co-host', () => {
      expect(canModerate('co-host', 'participant', 'mute')).toBe(true);
      expect(canModerate('co-host', 'viewer', 'kick')).toBe(true);
      expect(canModerate('co-host', 'participant', 'stop_media')).toBe(true);
      expect(canModerate('co-host', '', 'admit')).toBe(true);
      expect(canModerate('co-host', '', 'update_policy')).toBe(true);

      // Cannot moderate host or another co-host
      expect(canModerate('co-host', 'host', 'mute')).toBe(false);
      expect(canModerate('co-host', 'co-host', 'kick')).toBe(false);
      // Co-host cannot end room
      expect(canModerate('co-host', '', 'end_room')).toBe(false);
    });

    it('denies participants and viewers from moderating', () => {
      expect(canModerate('participant', 'viewer', 'mute')).toBe(false);
      expect(canModerate('participant', '', 'admit')).toBe(false);
      expect(canModerate('participant', '', 'update_policy')).toBe(false);
      expect(canModerate('viewer', 'viewer', 'kick')).toBe(false);
    });
  });

  describe('canPublishMedia', () => {
    it('always allows hosts and co-hosts to publish even when policy disallows', () => {
      const lockedPolicy: RoomPolicy = {
        ...defaultPolicy,
        allow_camera: false,
        allow_mic: false,
        allow_screen_share: false,
      };

      expect(canPublishMedia('host', 'audio', lockedPolicy)).toBe(true);
      expect(canPublishMedia('host', 'video', lockedPolicy)).toBe(true);
      expect(canPublishMedia('co-host', 'screen', lockedPolicy)).toBe(true);
    });

    it('denies viewers from ever publishing media', () => {
      expect(canPublishMedia('viewer', 'audio', defaultPolicy)).toBe(false);
      expect(canPublishMedia('viewer', 'video', defaultPolicy)).toBe(false);
      expect(canPublishMedia('viewer', 'screen', defaultPolicy)).toBe(false);
    });

    it('checks room policies and permissions for regular participants', () => {
      expect(canPublishMedia('participant', 'audio', defaultPolicy, defaultPerms)).toBe(true);

      const micLockedPolicy: RoomPolicy = { ...defaultPolicy, allow_mic: false };
      expect(canPublishMedia('participant', 'audio', micLockedPolicy, defaultPerms)).toBe(false);

      const permsDisabled: UserPermissions = { ...defaultPerms, can_publish_video: false };
      expect(canPublishMedia('participant', 'video', defaultPolicy, permsDisabled)).toBe(false);
    });
  });

  describe('ModerationController', () => {
    beforeEach(() => {
      setupMockBrowserEnvironment();
      MockWebSocket.instances = [];
    });

    it('sends admit message when authorized', async () => {
      const signaling = new SignalingClient({ autoReconnect: false });
      await signaling.connect('ws://localhost:8080/ws');
      const mockWs = MockWebSocket.instances[0];

      const controller = new ModerationController(
        signaling,
        () => 'host',
        () => 'participant'
      );

      controller.admit('lobby-user-1');
      expect(mockWs.sentMessages.length).toBe(1);
      const parsed = JSON.parse(mockWs.sentMessages[0]);
      expect(parsed.type).toBe('admit_peer');
      expect(parsed.payload.peer_id).toBe('lobby-user-1');
    });

    it('throws PermissionError when unauthorized user attempts moderation action', async () => {
      const signaling = new SignalingClient({ autoReconnect: false });
      await signaling.connect('ws://localhost:8080/ws');

      const controller = new ModerationController(
        signaling,
        () => 'participant', // actor is participant
        () => 'participant'
      );

      expect(() => controller.mute('peer-2')).toThrow(PermissionError);
      expect(() => controller.kick('peer-2')).toThrow(PermissionError);
      expect(() => controller.admit('peer-2')).toThrow(PermissionError);
      expect(() => controller.setRoomPolicies(defaultPolicy)).toThrow(PermissionError);
    });

    it('sends mute, stopMedia, kick, and updatePolicies when authorized', async () => {
      const signaling = new SignalingClient({ autoReconnect: false });
      await signaling.connect('ws://localhost:8080/ws');
      const mockWs = MockWebSocket.instances[0];

      const controller = new ModerationController(
        signaling,
        () => 'host',
        () => 'participant'
      );

      controller.mute('peer-target', 'video');
      controller.stopMedia('peer-target', 'screenshare');
      controller.kick('peer-target', 'Violation of conduct');
      controller.setRoomPolicies({ ...defaultPolicy, allow_chat: false });

      const types = mockWs.sentMessages.map((m) => JSON.parse(m).type);
      expect(types).toEqual(['mute_peer', 'stop_peer_media', 'kick_peer', 'update_policies']);
    });
  });
});

