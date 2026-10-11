/**
 * Meetrix WebRTC Demo - Participants & Moderation Panel
 * Renders in-call participants, waiting lobby queue, and moderator actions.
 */

import { state } from '../state';
import {
  peopleCountBadge,
  lobbyCount,
  lobbyQueueSection,
  lobbyList,
  peopleList,
} from '../dom';
import { escapeHtml } from '../utils/format';

/**
 * Re-render the participants list and waiting lobby queue in the sidebar.
 */
export function updateParticipantsPanel(): void {
  if (!state.room) return;

  const totalCount = 1 + state.room.remoteParticipants.size;
  peopleCountBadge.textContent = String(totalCount);

  // 1. Render Waiting Lobby Queue
  lobbyCount.textContent = String(state.lobbyQueue.length);
  lobbyQueueSection.classList.toggle('hidden', state.lobbyQueue.length === 0);
  lobbyList.innerHTML = '';

  for (const guest of state.lobbyQueue) {
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar-tiny">${guest.display_name.charAt(0)}</div>
        <div class="participant-name-col">
          <span class="participant-name">${escapeHtml(guest.display_name)}</span>
          <span class="role-badge">LOBBY</span>
        </div>
      </div>
      <div class="participant-actions">
        <button class="btn-action-tiny btn-admit" title="Admit" data-id="${guest.id}">
          <span class="material-symbols-outlined">check</span>
        </button>
        <button class="btn-action-tiny btn-kick" title="Deny" data-id="${guest.id}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;

    item.querySelector('.btn-admit')?.addEventListener('click', () => {
      state.room?.moderation.admit(guest.id);
      state.lobbyQueue = state.lobbyQueue.filter((p) => p.id !== guest.id);
      updateParticipantsPanel();
    });

    item.querySelector('.btn-kick')?.addEventListener('click', () => {
      state.room?.moderation.kick(guest.id, 'Denied entry');
      state.lobbyQueue = state.lobbyQueue.filter((p) => p.id !== guest.id);
      updateParticipantsPanel();
    });

    lobbyList.appendChild(item);
  }

  // 2. Render In-Call Participants
  peopleList.innerHTML = '';

  // Local participant
  const localItem = document.createElement('div');
  localItem.className = 'participant-item';
  localItem.innerHTML = `
    <div class="participant-info">
      <div class="participant-avatar-tiny">${state.room.localParticipant.displayName.charAt(0) || 'Y'}</div>
      <div class="participant-name-col">
        <span class="participant-name">${escapeHtml(state.room.localParticipant.displayName)} (You)</span>
        <span class="role-badge role-${state.room.localParticipant.role.replace('-', '')}">${
    state.room.localParticipant.role
  }</span>
      </div>
    </div>
  `;
  peopleList.appendChild(localItem);

  // Remote participants
  const isHostOrCoHost =
    state.room.localParticipant.role === 'host' || state.room.localParticipant.role === 'co-host';

  for (const peer of state.room.remoteParticipants.values()) {
    const item = document.createElement('div');
    item.className = 'participant-item';

    let actionsHtml = '';
    if (isHostOrCoHost) {
      actionsHtml = `
        <div class="participant-actions">
          <button class="btn-action-tiny btn-mute" title="Mute Audio" data-id="${peer.id}">
            <span class="material-symbols-outlined">mic_off</span>
          </button>
          <button class="btn-action-tiny btn-stop-video" title="Stop Video" data-id="${peer.id}">
            <span class="material-symbols-outlined">videocam_off</span>
          </button>
          <button class="btn-action-tiny btn-kick" title="Kick Peer" data-id="${peer.id}">
            <span class="material-symbols-outlined">person_remove</span>
          </button>
        </div>
      `;
    }

    item.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar-tiny">${peer.displayName.charAt(0)}</div>
        <div class="participant-name-col">
          <span class="participant-name">${escapeHtml(peer.displayName)}</span>
          <span class="role-badge role-${peer.role.replace('-', '')}">${peer.role}</span>
        </div>
      </div>
      ${actionsHtml}
    `;

    if (isHostOrCoHost) {
      item.querySelector('.btn-mute')?.addEventListener('click', () => {
        state.room?.moderation.mute(peer.id, 'audio');
      });
      item.querySelector('.btn-stop-video')?.addEventListener('click', () => {
        state.room?.moderation.mute(peer.id, 'video');
      });
      item.querySelector('.btn-kick')?.addEventListener('click', () => {
        if (confirm(`Kick ${peer.displayName} from the meeting?`)) {
          state.room?.moderation.kick(peer.id, 'Kicked by moderator');
        }
      });
    }

    peopleList.appendChild(item);
  }
}

