/**
 * Connected WebRTC Core SDK - Moderation Controller
 * Implements Google Meet-style administrative actions: admit, mute, kick, stop media,
 * and update room policies with client-side capability checking.
 */

import {
  Role,
  RoomPolicy,
  UserPermissions,
  ModerationAction,
  MediaKind,
} from './types';
import { SignalingClient } from './signaling';
import { ModerationError, PermissionError } from './errors';

export function roleLevel(role: Role): number {
  switch (role) {
    case 'host':
      return 3;
    case 'co-host':
      return 2;
    case 'participant':
      return 1;
    case 'viewer':
      return 0;
    default:
      return -1;
  }
}

export function canModerate(
  actorRole: Role,
  targetRole: Role | '',
  action: ModerationAction
): boolean {
  const actorLvl = roleLevel(actorRole);
  if (actorLvl < roleLevel('co-host')) {
    return false;
  }

  switch (action) {
    case 'end_room':
      return actorRole === 'host';
    case 'update_policy':
    case 'admit':
      return actorLvl >= roleLevel('co-host');
    case 'mute':
    case 'stop_media':
    case 'kick':
      if (!targetRole) return false;
      return actorLvl > roleLevel(targetRole as Role);
    default:
      return false;
  }
}

export function canPublishMedia(
  role: Role,
  mediaKind: MediaKind,
  policy: RoomPolicy,
  perms?: UserPermissions
): boolean {
  if (role === 'viewer') {
    return false;
  }

  if (role === 'host' || role === 'co-host') {
    return true;
  }

  if (perms) {
    switch (mediaKind) {
      case 'audio':
        if (!perms.can_publish_audio) return false;
        break;
      case 'video':
        if (!perms.can_publish_video) return false;
        break;
      case 'screen':
        if (!perms.can_publish_screen) return false;
        break;
    }
  }

  switch (mediaKind) {
    case 'audio':
      return policy.allow_mic;
    case 'video':
      return policy.allow_camera;
    case 'screen':
      return policy.allow_screen_share;
    default:
      return false;
  }
}

export class ModerationController {
  constructor(
    private readonly signaling: SignalingClient,
    private readonly getMyRole: () => Role,
    private readonly getTargetRole: (peerId: string) => Role | undefined
  ) {}

  /**
   * Admit a peer from the waiting lobby into the active room.
   */
  public admit(peerId: string): void {
    const actorRole = this.getMyRole();
    if (!canModerate(actorRole, '', 'admit')) {
      throw new PermissionError('Unauthorized to admit peers from lobby');
    }

    this.signaling.sendAdmitPeer({ peer_id: peerId });
  }

  /**
   * Remotely mute a participant's audio or video.
   */
  public mute(peerId: string, media: 'audio' | 'video' = 'audio'): void {
    const actorRole = this.getMyRole();
    const targetRole = this.getTargetRole(peerId);

    if (targetRole && !canModerate(actorRole, targetRole, 'mute')) {
      throw new PermissionError(`Unauthorized to mute peer with role "${targetRole}"`);
    }

    this.signaling.sendMutePeer({
      peer_id: peerId,
      media,
    });
  }

  /**
   * Remotely stop a participant's screen share or other media.
   */
  public stopMedia(
    peerId: string,
    media: 'screenshare' | 'audio' | 'video' = 'screenshare'
  ): void {
    const actorRole = this.getMyRole();
    const targetRole = this.getTargetRole(peerId);

    if (targetRole && !canModerate(actorRole, targetRole, 'stop_media')) {
      throw new PermissionError(`Unauthorized to stop media for peer with role "${targetRole}"`);
    }

    this.signaling.sendStopPeerMedia({
      peer_id: peerId,
      media,
    });
  }

  /**
   * Kick a participant from the room.
   */
  public kick(peerId: string, reason?: string): void {
    const actorRole = this.getMyRole();
    const targetRole = this.getTargetRole(peerId);

    if (targetRole && !canModerate(actorRole, targetRole, 'kick')) {
      throw new PermissionError(`Unauthorized to kick peer with role "${targetRole}"`);
    }

    this.signaling.sendKickPeer({
      peer_id: peerId,
      reason,
    });
  }

  /**
   * Update room-wide policy settings (camera/mic/screen/chat/reactions/lobby locks).
   */
  public setRoomPolicies(policies: RoomPolicy): void {
    const actorRole = this.getMyRole();
    if (!canModerate(actorRole, '', 'update_policy')) {
      throw new PermissionError('Unauthorized to update room policies');
    }

    this.signaling.sendUpdatePolicies({
      policies,
    });
  }

  /**
   * Check if current user has authority to moderate target peer for an action.
   */
  public canModeratePeer(targetPeerId: string, action: ModerationAction): boolean {
    const actorRole = this.getMyRole();
    const targetRole = this.getTargetRole(targetPeerId) ?? 'participant';
    return canModerate(actorRole, targetRole, action);
  }
}

