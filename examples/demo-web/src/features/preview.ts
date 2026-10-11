/**
 * Connected WebRTC Demo - Greenroom / Preview Controls
 * Manages pre-call camera/mic preview, device selection, and media constraints.
 */

import { state } from '../state';
import {
  previewMicSelect,
  previewCamSelect,
  previewVideo,
  previewAvatar,
  previewMicBtn,
  previewCamBtn,
  meetingMicSelect,
  meetingCamSelect,
  meetingSpeakerSelect,
} from '../dom';

/**
 * Enumerate connected media devices and populate all dropdown selectors.
 */
export async function refreshDeviceSelectors(): Promise<void> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === 'audioinput');
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const speakers = devices.filter((d) => d.kind === 'audiooutput');

    const populate = (sel: HTMLSelectElement | null, items: MediaDeviceInfo[], defaultLabel: string) => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = `<option value="">${defaultLabel}</option>`;
      items.forEach((item, idx) => {
        const opt = document.createElement('option');
        opt.value = item.deviceId;
        opt.textContent = item.label || `${defaultLabel} ${idx + 1}`;
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
    };

    populate(previewMicSelect, mics, 'Default Microphone');
    populate(previewCamSelect, cams, 'Default Camera');
    populate(meetingMicSelect, mics, 'Default Microphone');
    populate(meetingCamSelect, cams, 'Default Camera');
    populate(meetingSpeakerSelect, speakers, 'Default Speaker');

    const speakerGroup = document.getElementById('speaker-group');
    if (speakerGroup) {
      speakerGroup.style.display = 'setSinkId' in HTMLMediaElement.prototype ? 'block' : 'none';
    }
  } catch (e) {
    console.warn('Could not enumerate devices:', e);
  }
}

/**
 * Initialize or reinitialize the pre-join camera and mic stream.
 */
export async function initPreview(): Promise<void> {
  await refreshDeviceSelectors();
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 640 },
        height: { ideal: 360 },
      };
      if (previewCamSelect?.value) {
        videoConstraints.deviceId = { exact: previewCamSelect.value };
      }
      const audioConstraints: MediaTrackConstraints = {};
      if (previewMicSelect?.value) {
        audioConstraints.deviceId = { exact: previewMicSelect.value };
      }

      state.previewStream = await navigator.mediaDevices.getUserMedia({
        video: !state.isPreviewCamMuted ? videoConstraints : false,
        audio: !state.isPreviewMicMuted ? audioConstraints : false,
      });

      previewVideo.srcObject = state.previewStream;
      previewAvatar.classList.toggle('hidden', !state.isPreviewCamMuted);
    }
  } catch (err) {
    console.warn('Could not start preview camera:', err);
    previewAvatar.classList.remove('hidden');
  }
}

/**
 * Stop active preview stream tracks to release hardware devices before joining the room.
 */
export function stopPreview(): void {
  if (state.previewStream) {
    state.previewStream.getTracks().forEach((t) => t.stop());
    state.previewStream = null;
  }
}

/**
 * Bind listeners for greenroom buttons and device change dropdowns.
 */
export function initPreviewControls(): void {
  previewMicSelect?.addEventListener('change', () => void initPreview());
  previewCamSelect?.addEventListener('change', () => void initPreview());

  previewMicBtn.addEventListener('click', () => {
    state.isPreviewMicMuted = !state.isPreviewMicMuted;
    if (state.previewStream) {
      state.previewStream.getAudioTracks().forEach((t) => (t.enabled = !state.isPreviewMicMuted));
    }
    previewMicBtn.classList.toggle('muted', state.isPreviewMicMuted);
    previewMicBtn.innerHTML = `<span class="material-symbols-outlined icon">${
      state.isPreviewMicMuted ? 'mic_off' : 'mic'
    }</span>`;
  });

  previewCamBtn.addEventListener('click', () => {
    state.isPreviewCamMuted = !state.isPreviewCamMuted;
    if (state.previewStream) {
      previewVideo.style.display = state.isPreviewCamMuted ? 'none' : 'block';
      previewAvatar.classList.toggle('hidden', !state.isPreviewCamMuted);
      state.previewStream.getVideoTracks().forEach((t) => (t.enabled = !state.isPreviewCamMuted));
    }
    previewCamBtn.classList.toggle('muted', state.isPreviewCamMuted);
    previewCamBtn.innerHTML = `<span class="material-symbols-outlined icon">${
      state.isPreviewCamMuted ? 'videocam_off' : 'videocam'
    }</span>`;
  });
}

