/**
 * Connected WebRTC Demo - Remote Audio Management
 * Synchronizes HTMLAudioElement instances for remote peer microphone & screen share tracks.
 * Handles browser autoplay policies and Chromium power-saving audio buffer throttling.
 */

import type { ConnectedRoom } from '@connected/core';
import { audioUnlockBanner, btnUnlockAudio } from '../dom';

let remoteAudioContainer: HTMLElement | null = null;

/**
 * Get or create the hidden container for remote audio tags.
 */
function getAudioContainer(): HTMLElement {
  if (!remoteAudioContainer) {
    remoteAudioContainer = document.createElement('div');
    remoteAudioContainer.id = 'remote-audio-container';
    // Position within viewport to avoid Chromium background/power-saving audio buffer throttling
    remoteAudioContainer.style.position = 'absolute';
    remoteAudioContainer.style.left = '0';
    remoteAudioContainer.style.bottom = '0';
    remoteAudioContainer.style.width = '1px';
    remoteAudioContainer.style.height = '1px';
    remoteAudioContainer.style.overflow = 'hidden';
    remoteAudioContainer.style.opacity = '0.001';
    remoteAudioContainer.style.pointerEvents = 'none';
    document.body.appendChild(remoteAudioContainer);
  }
  return remoteAudioContainer;
}

/**
 * Synchronize remote audio elements for all peers in the room.
 */
export function syncRemoteAudioElements(room: ConnectedRoom): void {
  const container = getAudioContainer();
  const activeAudioElementIds = new Set<string>();

  for (const peer of room.remoteParticipants.values()) {
    // 1. Microphone Audio
    const audioTrack = peer.getAudioTrack();
    const micElId = `audio-${peer.id}`;
    let audioEl = document.getElementById(micElId) as HTMLAudioElement | null;

    if (audioTrack && audioTrack.readyState === 'live' && !peer.audioMuted) {
      activeAudioElementIds.add(micElId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = micElId;
        audioEl.autoplay = true;
        audioEl.setAttribute('playsinline', 'true');
        audioEl.volume = 1.0;
        try {
          (audioEl as unknown as { preservesPitch?: boolean }).preservesPitch = false;
        } catch {}
        container.appendChild(audioEl);
      }
      if (audioEl.dataset.trackId !== audioTrack.id) {
        audioEl.dataset.trackId = audioTrack.id;
        audioEl.srcObject = peer.stream || new MediaStream([audioTrack]);
      }
      if (audioEl.paused) {
        audioEl.play().catch((err) => {
          console.warn(`Remote audio play prevented for ${peer.id}:`, err);
          audioUnlockBanner?.classList.remove('hidden');
        });
      }
    } else if (audioEl) {
      audioEl.srcObject = null;
      delete audioEl.dataset.trackId;
      audioEl.remove();
    }

    // 2. Screen Share Audio
    const screenAudioTrack = peer.getScreenAudioTrack();
    const screenAudioElId = `audio-${peer.id}-screen`;
    let screenAudioEl = document.getElementById(screenAudioElId) as HTMLAudioElement | null;

    if (screenAudioTrack && screenAudioTrack.readyState === 'live') {
      activeAudioElementIds.add(screenAudioElId);
      if (!screenAudioEl) {
        screenAudioEl = document.createElement('audio');
        screenAudioEl.id = screenAudioElId;
        screenAudioEl.autoplay = true;
        screenAudioEl.setAttribute('playsinline', 'true');
        screenAudioEl.volume = 1.0;
        container.appendChild(screenAudioEl);
      }
      if (screenAudioEl.dataset.trackId !== screenAudioTrack.id) {
        screenAudioEl.dataset.trackId = screenAudioTrack.id;
        screenAudioEl.srcObject = new MediaStream([screenAudioTrack]);
      }
      if (screenAudioEl.paused) {
        screenAudioEl.play().catch((err) => {
          console.warn(`Remote screen audio play prevented for ${peer.id}:`, err);
          audioUnlockBanner?.classList.remove('hidden');
        });
      }
    } else if (screenAudioEl) {
      screenAudioEl.srcObject = null;
      delete screenAudioEl.dataset.trackId;
      screenAudioEl.remove();
    }
  }

  // Remove audio elements that are no longer active
  container.querySelectorAll('audio').forEach((el) => {
    if (!activeAudioElementIds.has(el.id)) {
      (el as HTMLAudioElement).srcObject = null;
      el.remove();
    }
  });
}

/**
 * Remove all remote audio elements upon leaving the call.
 */
export function clearRemoteAudio(): void {
  if (remoteAudioContainer) {
    remoteAudioContainer.innerHTML = '';
  }
}

/**
 * Setup global user-gesture listeners to unlock browser autoplay policy restrictions.
 */
export function initAudioUnlockListeners(): void {
  btnUnlockAudio?.addEventListener('click', () => {
    audioUnlockBanner?.classList.add('hidden');
    remoteAudioContainer?.querySelectorAll('audio').forEach((el) => {
      (el as HTMLAudioElement).play().catch((e) => console.warn('Retry audio playback failed:', e));
    });
  });

  window.addEventListener('click', () => {
    if (remoteAudioContainer) {
      remoteAudioContainer.querySelectorAll('audio').forEach((el) => {
        const audioEl = el as HTMLAudioElement;
        if (audioEl.paused && audioEl.srcObject) {
          audioEl.play().catch((err) => {
            console.warn('Autoplay click-unlock failed:', err);
          });
        }
      });
    }
  });
}

