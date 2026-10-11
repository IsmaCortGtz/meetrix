/**
 * Meetrix WebRTC Demo - Control Bar Actions
 * Bottom control buttons: mic, camera, screen share, raise hand, reaction picker, and leave call.
 */

import type { RemotePeer } from '@meetrix/core';
import { state } from '../state';
import {
  btnToggleMic,
  btnToggleCam,
  btnToggleScreen,
  btnRaiseHand,
  btnReactionPicker,
  reactionPickerMenu,
  btnLeaveCall,
  reactionContainer,
} from '../dom';
import { showToast } from '../utils/toast';
import { renderVideoGrid } from './video-grid';

/**
 * Display a floating reaction emoji that animates upwards across the screen.
 */
export function showFloatingReaction(emoji: string): void {
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;

  // Randomize horizontal placement between 20% and 80%
  const randomX = Math.floor(Math.random() * 60) + 20;
  el.style.left = `${randomX}%`;

  reactionContainer.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3000);
}

/**
 * Update the visual active/muted styling of control bar buttons.
 */
export function updateControlsBarState(): void {
  if (!state.room) return;

  const micMuted = state.room.localParticipant.isMicrophoneMuted;
  btnToggleMic.classList.toggle('muted', micMuted);
  btnToggleMic.innerHTML = `<span class="material-symbols-outlined icon">${micMuted ? 'mic_off' : 'mic'}</span>`;

  const camMuted = state.room.localParticipant.isCameraMuted;
  btnToggleCam.classList.toggle('muted', camMuted);
  btnToggleCam.innerHTML = `<span class="material-symbols-outlined icon">${camMuted ? 'videocam_off' : 'videocam'}</span>`;

  const screenActive = state.room.localParticipant.isScreenSharing;
  btnToggleScreen.classList.toggle('active', screenActive);
}

/**
 * Initialize control bar buttons and reaction picker events.
 */
export function initControlBar(onLeaveCall: () => void): void {
  // 1. Microphone Toggle
  btnToggleMic.addEventListener('click', async () => {
    if (!state.room) return;
    try {
      const isMuted = state.room.localParticipant.isMicrophoneMuted;
      if (isMuted) {
        if (state.room.localMedia.microphoneTrack && state.room.localMedia.microphoneTrack.readyState === 'live') {
          state.room.localParticipant.setMicrophoneMuted(false);
        } else {
          await state.room.localParticipant.enableMicrophone();
        }
      } else {
        state.room.localParticipant.setMicrophoneMuted(true);
      }
    } catch (err) {
      showToast(`Failed to toggle microphone: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }

    updateControlsBarState();
    renderVideoGrid();
  });

  // 2. Camera Toggle
  btnToggleCam.addEventListener('click', async () => {
    if (!state.room) return;
    try {
      const isMuted = state.room.localParticipant.isCameraMuted;
      if (isMuted) {
        if (state.room.localMedia.cameraTrack && state.room.localMedia.cameraTrack.readyState === 'live') {
          state.room.localParticipant.setCameraMuted(false);
        } else {
          await state.room.localParticipant.enableCamera();
        }
      } else {
        state.room.localParticipant.setCameraMuted(true);
      }
    } catch (err) {
      showToast(`Failed to toggle camera: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }

    updateControlsBarState();
    renderVideoGrid();
  });

  // 3. Screen Share Toggle
  btnToggleScreen.addEventListener('click', async () => {
    if (!state.room) return;

    if (state.room.localParticipant.isScreenSharing) {
      await state.room.localParticipant.stopScreenShare();
    } else {
      // Check if another peer is sharing
      let activeSharer: RemotePeer | null = null;
      for (const peer of state.room.remoteParticipants.values()) {
        if (peer.screenSharing) {
          activeSharer = peer;
          break;
        }
      }

      if (activeSharer) {
        showToast(`Cannot share screen: ${activeSharer.displayName} is already sharing their screen.`, 'warning');
        return;
      }

      // Check room policy
      if (
        !state.room.policy.allow_screen_share &&
        state.room.localParticipant.role !== 'host' &&
        state.room.localParticipant.role !== 'co-host'
      ) {
        showToast('Screen sharing is disabled by meeting policy.', 'warning');
        return;
      }

      try {
        await state.room.localParticipant.startScreenShare({}, () => {
          updateControlsBarState();
          renderVideoGrid();
        });
      } catch (err) {
        console.warn('Failed to start screen share:', err);
        showToast(err instanceof Error ? err.message : 'Could not start screen sharing', 'error');
      }
    }

    updateControlsBarState();
    renderVideoGrid();
  });

  // 4. Raise Hand
  btnRaiseHand.addEventListener('click', () => {
    if (!state.room) return;
    state.isHandRaised = !state.isHandRaised;
    state.room.reactions.raiseHand(state.isHandRaised);

    btnRaiseHand.classList.toggle('active', state.isHandRaised);
    renderVideoGrid();
  });

  // 5. Reactions Popover
  btnReactionPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    reactionPickerMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    reactionPickerMenu.classList.add('hidden');
  });

  document.querySelectorAll('.emoji-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = (btn as HTMLElement).dataset.emoji;
      if (emoji && state.room) {
        state.room.reactions.sendReaction(emoji);
      }
      reactionPickerMenu.classList.add('hidden');
    });
  });

  // 6. Leave Call
  btnLeaveCall.addEventListener('click', onLeaveCall);
}

