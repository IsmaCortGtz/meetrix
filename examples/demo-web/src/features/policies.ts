/**
 * Meetrix WebRTC Demo - Room Policies
 * Manages host policy checkboxes and policy change broadcasts.
 */

import type { RoomPolicy } from '@meetrix/core';
import { state } from '../state';
import {
  policyMic,
  policyCamera,
  policyScreen,
  policyChat,
  policyReactions,
  policyLobby,
} from '../dom';

/**
 * Synchronize UI checkbox states with the room's current policy object.
 */
export function syncPolicyCheckboxes(policy: RoomPolicy): void {
  policyMic.checked = policy.allow_mic;
  policyCamera.checked = policy.allow_camera;
  policyScreen.checked = policy.allow_screen_share;
  policyChat.checked = policy.allow_chat;
  policyReactions.checked = policy.allow_reactions;
  policyLobby.checked = policy.require_lobby;
}

/**
 * Bind change listeners to room policy toggles.
 */
export function initPolicyListeners(): void {
  const switches = [policyMic, policyCamera, policyScreen, policyChat, policyReactions, policyLobby];

  switches.forEach((cb) => {
    cb.addEventListener('change', () => {
      if (!state.room) return;
      const isHost = state.room.localParticipant.role === 'host' || state.room.localParticipant.role === 'co-host';
      if (!isHost) {
        alert('Only hosts or co-hosts can change room policies');
        syncPolicyCheckboxes(state.room.policy);
        return;
      }

      const newPolicies: RoomPolicy = {
        allow_mic: policyMic.checked,
        allow_camera: policyCamera.checked,
        allow_screen_share: policyScreen.checked,
        allow_chat: policyChat.checked,
        allow_reactions: policyReactions.checked,
        require_lobby: policyLobby.checked,
      };

      try {
        state.room.moderation.setRoomPolicies(newPolicies);
      } catch (err) {
        alert(`Failed to update room policies: ${err instanceof Error ? err.message : String(err)}`);
        syncPolicyCheckboxes(state.room.policy);
      }
    });
  });
}

