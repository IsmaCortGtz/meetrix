/**
 * Meetrix WebRTC Demo - Meeting Session & Event Lifecycle
 * Manages MeetrixRoom lifecycle, WebRTC media events, and in-call device switching.
 */

import { MeetrixRoom, RemotePeer, Role } from '@meetrix/core';
import { state } from '../state';
import {
  headerRoomId,
  headerUserName,
  headerUserRole,
  connectionStatus,
  serverUrlInput,
  displayNameInput,
  roleSelect,
  authTokenInput,
  previewMicSelect,
  previewCamSelect,
  meetingMicSelect,
  meetingCamSelect,
  meetingSpeakerSelect,
  disableAecCheckbox,
} from '../dom';
import { showToast } from '../utils/toast';
import { stopPreview } from './preview';
import { renderVideoGrid, clearVideoGrid, updateSpeakingIndicators } from './video-grid';
import { updateControlsBarState, showFloatingReaction } from './control-bar';
import { updateParticipantsPanel } from './participants';
import { appendChatMessage, resetChat } from './chat';
import { syncPolicyCheckboxes } from './policies';
import { updateSessionTimer, stopSessionTimerTicker } from './timer';
import { clearRemoteAudio } from '../audio/remote-audio';

export type NavigationCallback = (view: 'home' | 'preview' | 'lobby' | 'meeting' | 'left') => void;

/**
 * Connect to the SFU room with configured credentials and media constraints.
 */
export async function handleJoinMeeting(switchView: NavigationCallback): Promise<void> {
  const url = serverUrlInput?.value.trim() || 'ws://localhost:8080/ws';
  const roomId = state.currentRoomId.trim();
  const displayName = displayNameInput?.value.trim() || 'Guest';
  const role = (roleSelect?.value as Role) || 'participant';
  const token = authTokenInput?.value.trim() || undefined;

  if (!roomId) {
    showToast('Missing room ID', 'error');
    return;
  }

  stopPreview();
  // Small pause to allow hardware camera driver to release cleanly before room media starts
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Create MeetrixRoom instance
  state.room = new MeetrixRoom({ autoReconnect: true });
  setupRoomEventHandlers(state.room, switchView);

  try {
    if (headerRoomId) headerRoomId.textContent = roomId;
    if (headerUserName) headerUserName.textContent = displayName;
    if (headerUserRole) {
      headerUserRole.textContent = role.toUpperCase();
      headerUserRole.className = `role-badge role-${role.replace('-', '')}`;
    }

    await state.room.join({
      url,
      roomId,
      displayName,
      token,
      metadata: { role },
      mediaOptions: {
        camera: !state.isPreviewCamMuted ? { deviceId: previewCamSelect?.value || undefined } : false,
        microphone: !state.isPreviewMicMuted
          ? {
              deviceId: previewMicSelect?.value || undefined,
              echoCancellation: !disableAecCheckbox?.checked,
            }
          : false,
      },
    });

    if (meetingMicSelect && previewMicSelect?.value) {
      meetingMicSelect.value = previewMicSelect.value;
    }
    if (meetingCamSelect && previewCamSelect?.value) {
      meetingCamSelect.value = previewCamSelect.value;
    }

    switchView('meeting');
    renderVideoGrid();
    updateControlsBarState();
    updateParticipantsPanel();
  } catch (err) {
    console.error('Join room failed:', err);
    alert(`Failed to join room: ${err instanceof Error ? err.message : String(err)}`);
    switchView('preview');
  }
}

/**
 * Register all event handlers on the MeetrixRoom instance.
 */
export function setupRoomEventHandlers(r: MeetrixRoom, switchView: NavigationCallback): void {
  r.on('connected', (info) => {
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'badge badge-connected';
    updateSessionTimer(info.session_remaining_sec);
    syncPolicyCheckboxes(r.policy);
    for (const peer of r.remoteParticipants.values()) {
      attachPeerListeners(peer);
    }
    renderVideoGrid();
    updateParticipantsPanel();
  });

  r.on('peerMediaChanged', () => {
    renderVideoGrid();
  });

  r.on('lobbyWaiting', (message) => {
    const lobbyMsgEl = document.getElementById('lobby-message');
    if (lobbyMsgEl) lobbyMsgEl.textContent = message;
    switchView('lobby');
  });

  r.on('lobbyPeerWaiting', (peer) => {
    state.lobbyQueue.push(peer);
    updateParticipantsPanel();
  });

  r.on('reconnecting', (attempt) => {
    connectionStatus.textContent = `Reconnecting (${attempt})...`;
    connectionStatus.className = 'badge badge-reconnecting';
  });

  r.on('reconnected', () => {
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'badge badge-connected';
  });

  r.on('disconnected', (reason) => {
    console.log('Room disconnected:', reason);
    teardownMeeting(switchView);
  });

  r.on('participantJoined', (peer) => {
    renderVideoGrid();
    updateParticipantsPanel();
    attachPeerListeners(peer);
  });

  r.on('participantLeft', () => {
    renderVideoGrid();
    updateParticipantsPanel();
  });

  r.on('trackSubscribed', () => {
    renderVideoGrid();
  });

  r.on('trackUnsubscribed', () => {
    renderVideoGrid();
  });

  r.on('chatMessage', (msg) => {
    appendChatMessage(msg);
  });

  r.on('reaction', (react) => {
    showFloatingReaction(react.emoji);
  });

  r.on('handRaised', () => {
    renderVideoGrid();
    updateParticipantsPanel();
  });

  r.on('policyUpdated', (policies) => {
    syncPolicyCheckboxes(policies);
  });

  r.on('moderationAction', (action) => {
    console.log('Moderation action received:', action);
    updateControlsBarState();
    renderVideoGrid();
  });

  r.on('sessionTimerTick', (rem) => {
    updateSessionTimer(rem);
  });

  r.on('sessionEnded', (reason) => {
    alert(`The meeting session ended: ${reason}`);
    teardownMeeting(switchView);
  });

  r.on('error', (err) => {
    console.error('Room error event:', err);
  });

  // Local audio detector volume meter hook
  r.localMedia.audioDetector?.onAudioLevel((lvl) => {
    const meterFill = document.querySelector(
      `#tile-${r.localParticipant.id || 'local'} .audio-meter-fill`
    ) as HTMLElement | null;
    if (meterFill) {
      meterFill.style.width = `${Math.min(100, Math.round(lvl * 150))}%`;
    }
  });
}

/**
 * Attach listeners to a remote peer for real-time track and speaking indicators.
 */
export function attachPeerListeners(peer: RemotePeer): void {
  peer.on('speakingChange', () => {
    updateSpeakingIndicators();
  });
  peer.on('audioLevelChange', (lvl) => {
    const meterFill = document.querySelector(`#tile-${peer.id} .audio-meter-fill`) as HTMLElement | null;
    if (meterFill) {
      meterFill.style.width = `${Math.min(100, Math.round(lvl * 150))}%`;
    }
  });
  peer.on('audioMutedChange', () => {
    renderVideoGrid();
  });
  peer.on('videoMutedChange', () => {
    renderVideoGrid();
  });
  peer.on('screenSharingChange', () => {
    renderVideoGrid();
  });
  peer.on('handRaisedChange', () => {
    renderVideoGrid();
  });
}

/**
 * Clean up meeting state and navigate to destination screen.
 */
export function teardownMeeting(
  switchView: NavigationCallback,
  destination: 'left' | 'home' = 'left'
): void {
  stopSessionTimerTicker();
  state.room = null;
  clearVideoGrid();
  resetChat();
  state.lobbyQueue = [];
  clearRemoteAudio();

  if (destination === 'left') {
    switchView('left');
  } else {
    stopPreview();
    window.history.pushState(null, '', window.location.pathname);
    switchView('home');
  }
}

/**
 * Initialize device switching listeners while inside a meeting.
 */
export function initMeetingDeviceListeners(): void {
  meetingMicSelect?.addEventListener('change', async () => {
    const micId = meetingMicSelect?.value;
    if (!state.room || !micId) return;
    try {
      await state.room.localParticipant.switchMicrophone(micId);
      showToast('Microphone input updated', 'info');
    } catch (err) {
      showToast(`Failed to switch microphone: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  });

  meetingCamSelect?.addEventListener('change', async () => {
    const camId = meetingCamSelect?.value;
    if (!state.room || !camId) return;
    try {
      await state.room.localParticipant.switchCamera(camId);
      showToast('Camera input updated', 'info');
      renderVideoGrid();
    } catch (err) {
      showToast(`Failed to switch camera: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  });

  meetingSpeakerSelect?.addEventListener('change', async () => {
    const speakerId = meetingSpeakerSelect?.value;
    const container = document.getElementById('remote-audio-container');
    if (!speakerId || !container) return;
    try {
      for (const audioEl of Array.from(container.querySelectorAll('audio'))) {
        if ('setSinkId' in audioEl) {
          await (audioEl as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(speakerId);
        }
      }
      showToast('Audio output device updated', 'info');
    } catch (err) {
      showToast(`Failed to switch audio output: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  });
}
