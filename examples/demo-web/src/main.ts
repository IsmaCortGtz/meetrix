/**
 * Connected WebRTC Framework - Google Meet-style Demo Web Application
 * Demonstrates full integration of @connected/core in a browser client.
 */

import {
  ConnectedRoom,
  RemotePeer,
  Role,
  RoomPolicy,
  ChatBroadcastPayload,
  ReactionBroadcastPayload,
  ParticipantInfo,
} from '@connected/core';

// ==========================================
// App State
// ==========================================

let room: ConnectedRoom | null = null;
let previewStream: MediaStream | null = null;
let isPreviewMicMuted = false;
let isPreviewCamMuted = false;
let isHandRaised = false;
let activeSidebarTab: 'chat' | 'people' | 'controls' = 'chat';
let isSidebarOpen = false;
let unreadChatCount = 0;
let lobbyQueue: ParticipantInfo[] = [];
let remoteAudioContainer: HTMLElement | null = null;

// ==========================================
// Toast Notifications
// ==========================================

function showToast(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// Remote Audio Synchronization
// ==========================================

function syncRemoteAudioElements(r: ConnectedRoom): void {
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

  const activeAudioElementIds = new Set<string>();
  for (const peer of r.remoteParticipants.values()) {
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
        remoteAudioContainer.appendChild(audioEl);
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
        remoteAudioContainer.appendChild(screenAudioEl);
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
  remoteAudioContainer.querySelectorAll('audio').forEach((el) => {
    if (!activeAudioElementIds.has(el.id)) {
      (el as HTMLAudioElement).srcObject = null;
      el.remove();
    }
  });
}

// Global click handler to automatically unlock/play any paused audio elements
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

// ==========================================
// Google Meet Helpers & Routing
// ==========================================

let currentRoomId = 'engineering-daily';

function generateMeetingCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const seg = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg(3)}-${seg(4)}-${seg(3)}`;
}

function sanitizeMeetingCode(input: string): string {
  input = input.trim();
  if (!input) return '';
  try {
    if (input.includes('://')) {
      const parsed = new URL(input);
      const roomQuery = parsed.searchParams.get('room') || parsed.searchParams.get('code');
      if (roomQuery) return roomQuery.trim();
      const pathSeg = parsed.pathname.split('/').filter(Boolean).pop();
      if (pathSeg) return pathSeg.trim();
    }
  } catch {}
  if (input.includes('?room=')) {
    const m = input.match(/\?room=([^&]+)/);
    if (m) return m[1].trim();
  }
  return input;
}

function getMeetingUrl(roomId: string): string {
  const loc = window.location;
  return `${loc.protocol}//${loc.host}${loc.pathname}?room=${encodeURIComponent(roomId)}`;
}

async function copyToClipboard(text: string, successMsg = 'Meeting link copied to clipboard!'): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast(successMsg, 'info');
  } catch (err) {
    console.warn('Failed to copy to clipboard:', err);
    showToast('Could not copy link to clipboard', 'warning');
  }
}

// ==========================================
// DOM Elements
// ==========================================

// Screens
const homeScreen = document.getElementById('home-screen') as HTMLElement | null;
const previewScreen = document.getElementById('preview-screen') as HTMLElement | null;
const lobbyScreen = document.getElementById('lobby-screen') as HTMLElement;
const meetingScreen = document.getElementById('meeting-screen') as HTMLElement;
const leftMeetingScreen = document.getElementById('left-meeting-screen') as HTMLElement | null;

// Banners
const insecureContextBanner = document.getElementById('insecure-context-banner') as HTMLElement | null;
const audioUnlockBanner = document.getElementById('audio-unlock-banner') as HTMLElement | null;
const btnUnlockAudio = document.getElementById('btn-unlock-audio') as HTMLButtonElement | null;

// Home Screen Elements
const homeClock = document.getElementById('home-clock') as HTMLElement | null;
const btnNewMeeting = document.getElementById('btn-new-meeting') as HTMLButtonElement | null;
const newMeetingMenu = document.getElementById('new-meeting-menu') as HTMLElement | null;
const btnCreateForLater = document.getElementById('btn-create-for-later') as HTMLButtonElement | null;
const btnStartInstant = document.getElementById('btn-start-instant') as HTMLButtonElement | null;
const homeCodeInput = document.getElementById('home-code-input') as HTMLInputElement | null;
const btnHomeJoin = document.getElementById('btn-home-join') as HTMLButtonElement | null;

// Modal Elements
const meetingCreatedModal = document.getElementById('meeting-created-modal') as HTMLElement | null;
const modalLinkInput = document.getElementById('modal-link-input') as HTMLInputElement | null;
const btnModalCopyLink = document.getElementById('btn-modal-copy-link') as HTMLButtonElement | null;
const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLButtonElement | null;

// Preview Screen Elements
const previewRoomIdText = document.getElementById('preview-room-id-text') as HTMLElement | null;
const btnPreviewCopyLink = document.getElementById('btn-preview-copy-link') as HTMLButtonElement | null;
const btnJoinNow = document.getElementById('btn-join-now') as HTMLButtonElement | null;
const btnPreviewBackHome = document.getElementById('btn-preview-back-home') as HTMLButtonElement | null;
const disableAecCheckbox = document.getElementById('disable-aec-checkbox') as HTMLInputElement | null;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const displayNameInput = document.getElementById('display-name') as HTMLInputElement;
const roleSelect = document.getElementById('role-select') as HTMLSelectElement;
const authTokenInput = document.getElementById('auth-token') as HTMLInputElement;
const previewMicSelect = document.getElementById('preview-mic-select') as HTMLSelectElement | null;
const previewCamSelect = document.getElementById('preview-cam-select') as HTMLSelectElement | null;
const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;
const previewAvatar = document.getElementById('preview-avatar') as HTMLElement;
const previewMicBtn = document.getElementById('preview-mic-btn') as HTMLButtonElement;
const previewCamBtn = document.getElementById('preview-cam-btn') as HTMLButtonElement;

// Meeting Header
const headerRoomId = document.getElementById('header-room-id') as HTMLElement;
const btnHeaderCopyLink = document.getElementById('btn-header-copy-link') as HTMLButtonElement | null;
const headerUserName = document.getElementById('header-user-name') as HTMLElement;
const headerUserRole = document.getElementById('header-user-role') as HTMLElement;
const connectionStatus = document.getElementById('connection-status') as HTMLElement;
const sessionTimer = document.getElementById('session-timer') as HTMLElement;
const timerText = document.getElementById('timer-text') as HTMLElement;

// Post-Call Elements
const btnRejoin = document.getElementById('btn-rejoin') as HTMLButtonElement | null;
const btnReturnHome = document.getElementById('btn-return-home') as HTMLButtonElement | null;

// Device selects in meeting controls
const meetingMicSelect = document.getElementById('meeting-mic-select') as HTMLSelectElement | null;
const meetingCamSelect = document.getElementById('meeting-cam-select') as HTMLSelectElement | null;
const meetingSpeakerSelect = document.getElementById('meeting-speaker-select') as HTMLSelectElement | null;

// Main Workspace
const videoGrid = document.getElementById('video-grid') as HTMLElement;
const reactionContainer = document.getElementById('reaction-container') as HTMLElement;
const cancelLobbyBtn = document.getElementById('cancel-lobby-btn') as HTMLButtonElement;

// Sidebar
const sidebar = document.getElementById('sidebar') as HTMLElement;
const sidebarCloseBtn = document.getElementById('sidebar-close-btn') as HTMLButtonElement;
const tabChatBtn = document.getElementById('tab-chat-btn') as HTMLButtonElement;
const tabPeopleBtn = document.getElementById('tab-people-btn') as HTMLButtonElement;
const tabControlsBtn = document.getElementById('tab-controls-btn') as HTMLButtonElement;
const tabChat = document.getElementById('tab-chat') as HTMLElement;
const tabPeople = document.getElementById('tab-people') as HTMLElement;
const tabControls = document.getElementById('tab-controls') as HTMLElement;
const chatUnreadBadge = document.getElementById('chat-unread-badge') as HTMLElement;
const peopleCountBadge = document.getElementById('people-count') as HTMLElement;
const chatMessages = document.getElementById('chat-messages') as HTMLElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const peopleList = document.getElementById('people-list') as HTMLElement;
const lobbyQueueSection = document.getElementById('lobby-queue-section') as HTMLElement;
const lobbyList = document.getElementById('lobby-list') as HTMLElement;
const lobbyCount = document.getElementById('lobby-count') as HTMLElement;

// Room Policies Switches
const policyMic = document.getElementById('policy-mic') as HTMLInputElement;
const policyCamera = document.getElementById('policy-camera') as HTMLInputElement;
const policyScreen = document.getElementById('policy-screen') as HTMLInputElement;
const policyChat = document.getElementById('policy-chat') as HTMLInputElement;
const policyReactions = document.getElementById('policy-reactions') as HTMLInputElement;
const policyLobby = document.getElementById('policy-lobby') as HTMLInputElement;

// Controls Bar
const btnToggleMic = document.getElementById('btn-toggle-mic') as HTMLButtonElement;
const btnToggleCam = document.getElementById('btn-toggle-cam') as HTMLButtonElement;
const btnToggleScreen = document.getElementById('btn-toggle-screen') as HTMLButtonElement;
const btnRaiseHand = document.getElementById('btn-raise-hand') as HTMLButtonElement;
const btnReactionPicker = document.getElementById('btn-reaction-picker') as HTMLButtonElement;
const reactionPickerMenu = document.getElementById('reaction-picker-menu') as HTMLElement;
const btnToggleChat = document.getElementById('btn-toggle-chat') as HTMLButtonElement;
const btnTogglePeople = document.getElementById('btn-toggle-people') as HTMLButtonElement;
const btnLeaveCall = document.getElementById('btn-leave-call') as HTMLButtonElement;

// ==========================================
// Initialization & Device Enumeration
// ==========================================

async function refreshDeviceSelectors(): Promise<void> {
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

async function initPreview(): Promise<void> {
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

      previewStream = await navigator.mediaDevices.getUserMedia({
        video: !isPreviewCamMuted ? videoConstraints : false,
        audio: !isPreviewMicMuted ? audioConstraints : false,
      });

      previewVideo.srcObject = previewStream;
      previewAvatar.classList.toggle('hidden', !isPreviewCamMuted);
    }
  } catch (err) {
    console.warn('Could not start preview camera:', err);
    previewAvatar.classList.remove('hidden');
  }
}

previewMicSelect?.addEventListener('change', () => void initPreview());
previewCamSelect?.addEventListener('change', () => void initPreview());

function stopPreview(): void {
  if (previewStream) {
    previewStream.getTracks().forEach((t) => t.stop());
    previewStream = null;
  }
}

previewMicBtn.addEventListener('click', () => {
  isPreviewMicMuted = !isPreviewMicMuted;
  if (previewStream) {
    previewStream.getAudioTracks().forEach((t) => (t.enabled = !isPreviewMicMuted));
  }
  previewMicBtn.classList.toggle('muted', isPreviewMicMuted);
  previewMicBtn.innerHTML = `<span class="material-symbols-outlined icon">${isPreviewMicMuted ? 'mic_off' : 'mic'}</span>`;
});

previewCamBtn.addEventListener('click', () => {
  isPreviewCamMuted = !isPreviewCamMuted;
  if (previewStream) {
    previewVideo.style.display = isPreviewCamMuted ? 'none' : 'block';
    previewAvatar.classList.toggle('hidden', !isPreviewCamMuted);
    previewStream.getVideoTracks().forEach((t) => (t.enabled = !isPreviewCamMuted));
  }
  previewCamBtn.classList.toggle('muted', isPreviewCamMuted);
  previewCamBtn.innerHTML = `<span class="material-symbols-outlined icon">${isPreviewCamMuted ? 'videocam_off' : 'videocam'}</span>`;
});

// ==========================================
// Google Meet Screen Routing & Flow
// ==========================================

function switchView(viewName: 'home' | 'preview' | 'lobby' | 'meeting' | 'left'): void {
  homeScreen?.classList.toggle('active', viewName === 'home');
  previewScreen?.classList.toggle('active', viewName === 'preview');
  lobbyScreen?.classList.toggle('active', viewName === 'lobby');
  meetingScreen?.classList.toggle('active', viewName === 'meeting');
  leftMeetingScreen?.classList.toggle('active', viewName === 'left');
}

function goToPreview(roomId: string, updateUrl = true): void {
  currentRoomId = roomId;
  if (previewRoomIdText) {
    previewRoomIdText.textContent = roomId;
  }
  if (updateUrl) {
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    window.history.pushState({ room: roomId }, '', newUrl);
  }
  switchView('preview');
  void initPreview();
}

async function handleJoinMeeting(): Promise<void> {
  const url = serverUrlInput?.value.trim() || 'ws://localhost:8080/ws';
  const roomId = currentRoomId.trim();
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

  // Create ConnectedRoom instance
  room = new ConnectedRoom({ autoReconnect: true });
  setupRoomEventHandlers(room);

  try {
    if (headerRoomId) headerRoomId.textContent = roomId;
    if (headerUserName) headerUserName.textContent = displayName;
    if (headerUserRole) {
      headerUserRole.textContent = role.toUpperCase();
      headerUserRole.className = `role-badge role-${role.replace('-', '')}`;
    }

    await room.join({
      url,
      roomId,
      displayName,
      token,
      metadata: { role },
      mediaOptions: {
        camera: !isPreviewCamMuted
          ? { deviceId: previewCamSelect?.value || undefined }
          : false,
        microphone: !isPreviewMicMuted
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
    goToPreview(roomId, false);
  }
}

btnJoinNow?.addEventListener('click', () => {
  void handleJoinMeeting();
});

btnPreviewBackHome?.addEventListener('click', () => {
  stopPreview();
  window.history.pushState(null, '', window.location.pathname);
  switchView('home');
});

btnPreviewCopyLink?.addEventListener('click', () => {
  void copyToClipboard(getMeetingUrl(currentRoomId), 'Meeting link copied to clipboard!');
});

btnHeaderCopyLink?.addEventListener('click', () => {
  void copyToClipboard(getMeetingUrl(currentRoomId), 'Meeting link copied to clipboard!');
});

btnLeaveCall.addEventListener('click', async () => {
  if (room) {
    await room.leave();
  }
  teardownMeeting('left');
});

cancelLobbyBtn.addEventListener('click', async () => {
  if (room) {
    await room.leave();
  }
  teardownMeeting('home');
});

btnRejoin?.addEventListener('click', () => {
  goToPreview(currentRoomId, false);
});

btnReturnHome?.addEventListener('click', () => {
  stopPreview();
  window.history.pushState(null, '', window.location.pathname);
  switchView('home');
});

function teardownMeeting(destination: 'left' | 'home' = 'left'): void {
  stopSessionTimerTicker();
  room = null;
  videoGrid.innerHTML = '';
  chatMessages.innerHTML = '<div class="chat-welcome">Messages are sent to everyone in the room.</div>';
  lobbyQueue = [];
  if (remoteAudioContainer) {
    remoteAudioContainer.innerHTML = '';
  }
  if (destination === 'left') {
    switchView('left');
  } else {
    stopPreview();
    window.history.pushState(null, '', window.location.pathname);
    switchView('home');
  }
}

// ==========================================
// ConnectedRoom Event Bindings
// ==========================================

function setupRoomEventHandlers(r: ConnectedRoom): void {
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
    lobbyQueue.push(peer);
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
    teardownMeeting();
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

  r.on('handRaised', (payload) => {
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
    teardownMeeting();
  });

  r.on('error', (err) => {
    console.error('Room error event:', err);
  });

  // Local audio detector volume meter hook
  r.localMedia.audioDetector?.onAudioLevel((lvl) => {
    const meterFill = document.querySelector(`#tile-${r.localParticipant.id || 'local'} .audio-meter-fill`) as HTMLElement | null;
    if (meterFill) {
      meterFill.style.width = `${Math.min(100, Math.round(lvl * 150))}%`;
    }
  });
}

function attachPeerListeners(peer: RemotePeer): void {
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

// ==========================================
// Video Grid Rendering
// ==========================================

function renderVideoGrid(): void {
  if (!room) return;

  const validTileIds = new Set<string>();

  // 1. Local Participant Tile
  const localId = room.localParticipant.id || 'local';
  validTileIds.add(`tile-${localId}`);
  syncParticipantTile({
    id: localId,
    name: `${room.localParticipant.displayName || 'You'} (You)`,
    role: room.localParticipant.role,
    isLocal: true,
    audioMuted: room.localParticipant.isMicrophoneMuted,
    videoMuted: room.localParticipant.isCameraMuted,
    screenSharing: room.localParticipant.isScreenSharing,
    handRaised: room.localParticipant.handRaised,
    isSpeaking: room.localParticipant.isSpeaking,
    track: room.localMedia.cameraTrack,
  });

  // If local participant is screen sharing, sync extra screen tile
  if (room.localParticipant.isScreenSharing && room.localMedia.screenTrack && room.localMedia.screenTrack.readyState === 'live') {
    const screenTileId = 'local-screen';
    validTileIds.add(`tile-${screenTileId}`);
    syncScreenShareTile(
      screenTileId,
      `${room.localParticipant.displayName}'s Screen`,
      room.localMedia.screenTrack
    );
  }

  // 2. Remote Participant Tiles
  for (const peer of room.remoteParticipants.values()) {
    validTileIds.add(`tile-${peer.id}`);
    syncParticipantTile({
      id: peer.id,
      name: peer.displayName,
      role: peer.role,
      isLocal: false,
      audioMuted: peer.audioMuted,
      videoMuted: peer.videoMuted,
      screenSharing: peer.screenSharing,
      handRaised: peer.handRaised,
      isSpeaking: peer.isSpeaking,
      track: peer.getVideoTrack(),
    });

    // If peer is sharing screen, sync screen tile
    const screenTrack = peer.getScreenTrack();
    if (peer.screenSharing && screenTrack && screenTrack.readyState === 'live') {
      const screenTileId = `${peer.id}-screen`;
      validTileIds.add(`tile-${screenTileId}`);
      syncScreenShareTile(
        screenTileId,
        `${peer.displayName}'s Screen`,
        screenTrack
      );
    }
  }

  // Remove any tiles that are no longer active (e.g., participants who left or stopped screen sharing)
  videoGrid.querySelectorAll('.video-tile').forEach((tile) => {
    if (!validTileIds.has(tile.id)) {
      const video = tile.querySelector('video') as HTMLVideoElement | null;
      if (video) {
        video.srcObject = null;
      }
      tile.remove();
    }
  });

  updateSpeakingIndicators();
  syncRemoteAudioElements(room);
}

interface TileProps {
  id: string;
  name: string;
  role: Role;
  isLocal: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  isSpeaking: boolean;
  track: MediaStreamTrack | null;
}

function syncParticipantTile(props: TileProps): void {
  const tileId = `tile-${props.id}`;
  let tile = document.getElementById(tileId);

  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = tileId;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Always muted to satisfy browser Autoplay policies

    const avatar = document.createElement('div');
    avatar.className = 'tile-avatar';
    avatar.innerHTML = `<div class="avatar-circle"></div>`;

    const overlay = document.createElement('div');
    overlay.className = 'tile-overlay-bottom';

    const nameTag = document.createElement('div');
    nameTag.className = 'tile-name-tag';
    nameTag.innerHTML = `<span></span> <span class="role-badge"></span>`;

    const micIcon = document.createElement('div');
    micIcon.className = 'tile-status-icon';

    const audioMeter = document.createElement('div');
    audioMeter.className = 'tile-audio-meter audio-meter';
    audioMeter.innerHTML = `<div class="tile-audio-meter-bar audio-meter-fill"></div>`;

    overlay.appendChild(nameTag);
    overlay.appendChild(micIcon);
    overlay.appendChild(audioMeter);

    tile.appendChild(video);
    tile.appendChild(avatar);
    tile.appendChild(overlay);

    videoGrid.appendChild(tile);
  }

  // Video and Avatar synchronization
  const video = tile.querySelector('video') as HTMLVideoElement;
  const avatar = tile.querySelector('.tile-avatar') as HTMLElement;
  const avatarCircle = tile.querySelector('.avatar-circle') as HTMLElement;

  const initial = props.name.trim().charAt(0).toUpperCase() || '?';
  if (avatarCircle && avatarCircle.textContent !== initial) {
    avatarCircle.textContent = initial;
  }

  const isVideoActive = !props.videoMuted && props.track && props.track.enabled && props.track.readyState === 'live';

  if (isVideoActive && props.track) {
    const currentStream = video.srcObject as MediaStream | null;
    const currentTrack = currentStream ? currentStream.getVideoTracks()[0] : null;
    if (!currentStream || currentTrack !== props.track) {
      const peer = !props.isLocal && room ? room.remoteParticipants.get(props.id) : null;
      video.srcObject = peer?.stream || new MediaStream([props.track]);
    }
    video.style.display = 'block';
    avatar.style.display = 'none';
    if (video.paused) {
      video.play().catch((err) => {
        console.warn(`Video play was prevented for tile ${props.id}:`, err);
      });
    }
  } else {
    if (video.srcObject) {
      video.srcObject = null;
    }
    video.style.display = 'none';
    avatar.style.display = 'flex';
  }

  // Hand raised badge: add if raised, remove if not raised
  let handBadge = tile.querySelector('.tile-hand-raised') as HTMLElement | null;
  if (props.handRaised) {
    if (!handBadge) {
      handBadge = document.createElement('div');
      handBadge.className = 'tile-hand-raised';
      handBadge.innerHTML = '<span class="material-symbols-outlined badge-icon">pan_tool</span> <span>Hand Raised</span>';
      tile.appendChild(handBadge);
    }
  } else if (handBadge) {
    handBadge.remove();
  }

  // Bottom overlay labels and badges
  const nameSpan = tile.querySelector('.tile-name-tag span:first-child');
  if (nameSpan && nameSpan.textContent !== props.name) {
    nameSpan.textContent = props.name;
  }

  const roleSpan = tile.querySelector('.tile-name-tag .role-badge') as HTMLElement | null;
  if (roleSpan) {
    const roleClass = `role-badge role-${props.role.replace('-', '')}`;
    if (roleSpan.className !== roleClass) roleSpan.className = roleClass;
    if (roleSpan.textContent !== props.role) roleSpan.textContent = props.role;
  }

  const micIcon = tile.querySelector('.tile-status-icon') as HTMLElement | null;
  if (micIcon) {
    micIcon.className = `tile-status-icon ${props.audioMuted ? 'muted' : ''}`;
    micIcon.innerHTML = `<span class="material-symbols-outlined">${props.audioMuted ? 'mic_off' : 'mic'}</span>`;
  }

  const audioMeter = tile.querySelector('.tile-audio-meter') as HTMLElement | null;
  if (audioMeter) {
    audioMeter.style.display = props.audioMuted ? 'none' : 'inline-flex';
  }

  tile.classList.toggle('speaking', props.isSpeaking);
}

function syncScreenShareTile(id: string, label: string, track: MediaStreamTrack): void {
  const tileId = `tile-${id}`;
  let tile = document.getElementById(tileId);

  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile screen-share-tile';
    tile.id = tileId;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    tile.appendChild(video);

    const overlay = document.createElement('div');
    overlay.className = 'tile-overlay-bottom';
    const nameTag = document.createElement('div');
    nameTag.className = 'tile-name-tag';
    overlay.appendChild(nameTag);
    tile.appendChild(overlay);

    videoGrid.appendChild(tile);
  }

  const video = tile.querySelector('video') as HTMLVideoElement;
  const currentStream = video.srcObject as MediaStream | null;
  const currentTrack = currentStream ? currentStream.getVideoTracks()[0] : null;
  if (!currentStream || currentTrack !== track) {
    video.srcObject = new MediaStream([track]);
  }
  video.style.display = 'block';
  if (video.paused) {
    video.play().catch((err) => {
      console.warn(`Screen share video play prevented for ${id}:`, err);
    });
  }

  const nameTag = tile.querySelector('.tile-name-tag');
  if (nameTag && nameTag.textContent !== label) {
    nameTag.textContent = label;
  }
}

function updateSpeakingIndicators(): void {
  if (!room) return;

  // Local tile speaking indicator
  const localTile = document.getElementById(`tile-${room.localParticipant.id || 'local'}`);
  if (localTile) {
    localTile.classList.toggle('speaking', room.localParticipant.isSpeaking);
  }

  // Remote tiles speaking indicators
  for (const peer of room.remoteParticipants.values()) {
    const tile = document.getElementById(`tile-${peer.id}`);
    if (tile) {
      tile.classList.toggle('speaking', peer.isSpeaking);
    }
  }
}

// ==========================================
// Control Bar Actions
// ==========================================

btnToggleMic.addEventListener('click', async () => {
  if (!room) return;
  try {
    const isMuted = room.localParticipant.isMicrophoneMuted;
    if (isMuted) {
      if (room.localMedia.microphoneTrack && room.localMedia.microphoneTrack.readyState === 'live') {
        room.localParticipant.setMicrophoneMuted(false);
      } else {
        await room.localParticipant.enableMicrophone();
      }
    } else {
      room.localParticipant.setMicrophoneMuted(true);
    }
  } catch (err) {
    showToast(`Failed to toggle microphone: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }

  updateControlsBarState();
  renderVideoGrid();
});

btnToggleCam.addEventListener('click', async () => {
  if (!room) return;
  try {
    const isMuted = room.localParticipant.isCameraMuted;
    if (isMuted) {
      if (room.localMedia.cameraTrack && room.localMedia.cameraTrack.readyState === 'live') {
        room.localParticipant.setCameraMuted(false);
      } else {
        await room.localParticipant.enableCamera();
      }
    } else {
      room.localParticipant.setCameraMuted(true);
    }
  } catch (err) {
    showToast(`Failed to toggle camera: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }

  updateControlsBarState();
  renderVideoGrid();
});

btnToggleScreen.addEventListener('click', async () => {
  if (!room) return;

  if (room.localParticipant.isScreenSharing) {
    await room.localParticipant.stopScreenShare();
  } else {
    // 1. Check if another participant is already sharing screen
    let activeSharer: RemotePeer | null = null;
    for (const peer of room.remoteParticipants.values()) {
      if (peer.screenSharing) {
        activeSharer = peer;
        break;
      }
    }

    if (activeSharer) {
      showToast(
        `Cannot share screen: ${activeSharer.displayName} is already sharing their screen.`,
        'warning'
      );
      return;
    }

    // 2. Check room policy
    if (!room.policy.allow_screen_share && room.localParticipant.role !== 'host' && room.localParticipant.role !== 'co-host') {
      showToast('Screen sharing is disabled by meeting policy.', 'warning');
      return;
    }

    try {
      await room.localParticipant.startScreenShare({}, () => {
        updateControlsBarState();
        renderVideoGrid();
      });
    } catch (err) {
      console.warn('Failed to start screen share:', err);
      showToast(
        err instanceof Error ? err.message : 'Could not start screen sharing',
        'error'
      );
    }
  }

  updateControlsBarState();
  renderVideoGrid();
});

btnRaiseHand.addEventListener('click', () => {
  if (!room) return;
  isHandRaised = !isHandRaised;
  room.reactions.raiseHand(isHandRaised);

  btnRaiseHand.classList.toggle('active', isHandRaised);
  renderVideoGrid();
});

// Reactions Menu
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
    if (emoji && room) {
      // Send reaction to server; the server broadcasts it to all room participants including sender
      room.reactions.sendReaction(emoji);
    }
    reactionPickerMenu.classList.add('hidden');
  });
});

function showFloatingReaction(emoji: string): void {
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;

  // Randomize horizontal placement
  const randomX = Math.floor(Math.random() * 60) + 20; // 20% to 80%
  el.style.left = `${randomX}%`;

  reactionContainer.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3000);
}

function updateControlsBarState(): void {
  if (!room) return;

  const micMuted = room.localParticipant.isMicrophoneMuted;
  btnToggleMic.classList.toggle('muted', micMuted);
  btnToggleMic.innerHTML = `<span class="material-symbols-outlined icon">${micMuted ? 'mic_off' : 'mic'}</span>`;

  const camMuted = room.localParticipant.isCameraMuted;
  btnToggleCam.classList.toggle('muted', camMuted);
  btnToggleCam.innerHTML = `<span class="material-symbols-outlined icon">${camMuted ? 'videocam_off' : 'videocam'}</span>`;

  const screenActive = room.localParticipant.isScreenSharing;
  btnToggleScreen.classList.toggle('active', screenActive);
}

// ==========================================
// Sidebar & Panels (Chat, People, Controls)
// ==========================================

btnToggleChat.addEventListener('click', () => {
  openSidebarTab('chat');
});

btnTogglePeople.addEventListener('click', () => {
  openSidebarTab('people');
});

sidebarCloseBtn.addEventListener('click', () => {
  closeSidebar();
});

tabChatBtn.addEventListener('click', () => openSidebarTab('chat'));
tabPeopleBtn.addEventListener('click', () => openSidebarTab('people'));
tabControlsBtn.addEventListener('click', () => openSidebarTab('controls'));

function openSidebarTab(tab: 'chat' | 'people' | 'controls'): void {
  activeSidebarTab = tab;
  isSidebarOpen = true;
  sidebar.classList.remove('closed');

  tabChatBtn.classList.toggle('active', tab === 'chat');
  tabPeopleBtn.classList.toggle('active', tab === 'people');
  tabControlsBtn.classList.toggle('active', tab === 'controls');

  tabChat.classList.toggle('active', tab === 'chat');
  tabPeople.classList.toggle('active', tab === 'people');
  tabControls.classList.toggle('active', tab === 'controls');

  if (tab === 'chat') {
    unreadChatCount = 0;
    chatUnreadBadge.classList.add('hidden');
    chatUnreadBadge.textContent = '0';
  }
}

function closeSidebar(): void {
  isSidebarOpen = false;
  sidebar.classList.add('closed');
}

// ==========================================
// Chat Messaging
// ==========================================

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!room) return;

  const text = chatInput.value.trim();
  if (!text) return;

  try {
    await room.chat.sendMessage(text);
    chatInput.value = '';
  } catch (err) {
    alert(`Could not send chat message: ${err instanceof Error ? err.message : String(err)}`);
  }
});

function appendChatMessage(msg: ChatBroadcastPayload): void {
  const isMine = room && room.localParticipant.id === msg.peer_id;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isMine ? 'mine' : ''}`;

  const timeStr = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  bubble.innerHTML = `
    <div class="chat-meta">
      <span class="chat-sender">${escapeHtml(msg.display_name)}</span>
      <span class="chat-time">${timeStr}</span>
    </div>
    <div class="chat-text">${escapeHtml(msg.text)}</div>
  `;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!isSidebarOpen || activeSidebarTab !== 'chat') {
    unreadChatCount++;
    chatUnreadBadge.classList.remove('hidden');
    chatUnreadBadge.textContent = String(unreadChatCount);
  }
}

// ==========================================
// Participants & Moderation
// ==========================================

function updateParticipantsPanel(): void {
  if (!room) return;

  const totalCount = 1 + room.remoteParticipants.size;
  peopleCountBadge.textContent = String(totalCount);

  // Render Waiting Lobby Queue
  lobbyCount.textContent = String(lobbyQueue.length);
  lobbyQueueSection.classList.toggle('hidden', lobbyQueue.length === 0);
  lobbyList.innerHTML = '';

  for (const guest of lobbyQueue) {
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
      room?.moderation.admit(guest.id);
      lobbyQueue = lobbyQueue.filter((p) => p.id !== guest.id);
      updateParticipantsPanel();
    });

    item.querySelector('.btn-kick')?.addEventListener('click', () => {
      room?.moderation.kick(guest.id, 'Denied entry');
      lobbyQueue = lobbyQueue.filter((p) => p.id !== guest.id);
      updateParticipantsPanel();
    });

    lobbyList.appendChild(item);
  }

  // Render In-Call Participants
  peopleList.innerHTML = '';

  // 1. Local
  const localItem = document.createElement('div');
  localItem.className = 'participant-item';
  localItem.innerHTML = `
    <div class="participant-info">
      <div class="participant-avatar-tiny">${room.localParticipant.displayName.charAt(0) || 'Y'}</div>
      <div class="participant-name-col">
        <span class="participant-name">${escapeHtml(room.localParticipant.displayName)} (You)</span>
        <span class="role-badge role-${room.localParticipant.role.replace('-', '')}">${room.localParticipant.role}</span>
      </div>
    </div>
  `;
  peopleList.appendChild(localItem);

  // 2. Remotes
  const isHostOrCoHost = room.localParticipant.role === 'host' || room.localParticipant.role === 'co-host';

  for (const peer of room.remoteParticipants.values()) {
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
        room?.moderation.mute(peer.id, 'audio');
      });
      item.querySelector('.btn-stop-video')?.addEventListener('click', () => {
        room?.moderation.mute(peer.id, 'video');
      });
      item.querySelector('.btn-kick')?.addEventListener('click', () => {
        if (confirm(`Kick ${peer.displayName} from the meeting?`)) {
          room?.moderation.kick(peer.id, 'Kicked by moderator');
        }
      });
    }

    peopleList.appendChild(item);
  }
}

// ==========================================
// Room Policies Sync
// ==========================================

function syncPolicyCheckboxes(policy: RoomPolicy): void {
  policyMic.checked = policy.allow_mic;
  policyCamera.checked = policy.allow_camera;
  policyScreen.checked = policy.allow_screen_share;
  policyChat.checked = policy.allow_chat;
  policyReactions.checked = policy.allow_reactions;
  policyLobby.checked = policy.require_lobby;
}

[policyMic, policyCamera, policyScreen, policyChat, policyReactions, policyLobby].forEach((cb) => {
  cb.addEventListener('change', () => {
    if (!room) return;
    const isHost = room.localParticipant.role === 'host' || room.localParticipant.role === 'co-host';
    if (!isHost) {
      alert('Only hosts or co-hosts can change room policies');
      syncPolicyCheckboxes(room.policy);
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
      room.moderation.setRoomPolicies(newPolicies);
    } catch (err) {
      alert(`Failed to update room policies: ${err instanceof Error ? err.message : String(err)}`);
      syncPolicyCheckboxes(room.policy);
    }
  });
});

// ==========================================
// Session Countdown Timer
// ==========================================

let sessionTimerInterval: ReturnType<typeof setInterval> | null = null;
let currentRemainingSec = 0;

function stopSessionTimerTicker(): void {
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
}

function renderTimerDisplay(sec: number): void {
  if (sec <= 0) {
    timerText.textContent = '00:00';
    sessionTimer.classList.add('warning');
    return;
  }

  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  timerText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  sessionTimer.classList.toggle('warning', sec <= 60);
}

function updateSessionTimer(remainingSec: number): void {
  if (remainingSec < 0) {
    stopSessionTimerTicker();
    timerText.textContent = '--:--';
    return;
  }

  currentRemainingSec = remainingSec;
  renderTimerDisplay(currentRemainingSec);

  // Start smooth local 1-second countdown if not already ticking
  if (!sessionTimerInterval) {
    sessionTimerInterval = setInterval(() => {
      if (currentRemainingSec > 0) {
        currentRemainingSec--;
        renderTimerDisplay(currentRemainingSec);
      } else {
        stopSessionTimerTicker();
        renderTimerDisplay(0);
      }
    }, 1000);
  }
}

// Helper: Escape HTML string
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// Device Settings & Startup Listeners
// ==========================================

meetingMicSelect?.addEventListener('change', async () => {
  if (!room || !meetingMicSelect.value) return;
  try {
    await room.localParticipant.switchMicrophone(meetingMicSelect.value);
    showToast('Microphone input updated', 'info');
  } catch (err) {
    showToast(`Failed to switch microphone: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
});

meetingCamSelect?.addEventListener('change', async () => {
  if (!room || !meetingCamSelect.value) return;
  try {
    await room.localParticipant.switchCamera(meetingCamSelect.value);
    showToast('Camera input updated', 'info');
    renderVideoGrid();
  } catch (err) {
    showToast(`Failed to switch camera: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
});

meetingSpeakerSelect?.addEventListener('change', async () => {
  const speakerId = meetingSpeakerSelect.value;
  if (!speakerId || !remoteAudioContainer) return;
  try {
    for (const audioEl of Array.from(remoteAudioContainer.querySelectorAll('audio'))) {
      if ('setSinkId' in audioEl) {
        await (audioEl as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(speakerId);
      }
    }
    showToast('Audio output device updated', 'info');
  } catch (err) {
    showToast(`Failed to switch audio output: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
});

btnUnlockAudio?.addEventListener('click', () => {
  audioUnlockBanner?.classList.add('hidden');
  remoteAudioContainer?.querySelectorAll('audio').forEach((el) => {
    (el as HTMLAudioElement).play().catch((e) => console.warn('Retry audio playback failed:', e));
  });
});

// Auto-populate signaling server URL from current host (fixes mobile phone connection)
if (serverUrlInput) {
  const host = window.location.hostname || 'localhost';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  serverUrlInput.value = `${proto}//${host}:8080/ws`;
}

// Check for insecure context (e.g. mobile over HTTP)
if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  insecureContextBanner?.classList.remove('hidden');
}

// ==========================================
// Google Meet Home Actions & Initial Routing
// ==========================================

function updateHomeClock(): void {
  if (!homeClock) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  homeClock.textContent = `${timeStr} • ${dateStr}`;
}
setInterval(updateHomeClock, 1000);
updateHomeClock();

btnNewMeeting?.addEventListener('click', (e) => {
  e.stopPropagation();
  newMeetingMenu?.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (newMeetingMenu && !newMeetingMenu.contains(e.target as Node) && e.target !== btnNewMeeting) {
    newMeetingMenu.classList.add('hidden');
  }
});

btnCreateForLater?.addEventListener('click', () => {
  newMeetingMenu?.classList.add('hidden');
  const code = generateMeetingCode();
  const link = getMeetingUrl(code);
  if (modalLinkInput) modalLinkInput.value = link;
  meetingCreatedModal?.classList.remove('hidden');
});

btnStartInstant?.addEventListener('click', () => {
  newMeetingMenu?.classList.add('hidden');
  const code = generateMeetingCode();
  goToPreview(code, true);
});

modalCloseBtn?.addEventListener('click', () => {
  meetingCreatedModal?.classList.add('hidden');
});

meetingCreatedModal?.addEventListener('click', (e) => {
  if (e.target === meetingCreatedModal) {
    meetingCreatedModal.classList.add('hidden');
  }
});

btnModalCopyLink?.addEventListener('click', () => {
  if (modalLinkInput) {
    void copyToClipboard(modalLinkInput.value, 'Meeting link copied to clipboard!');
  }
});

homeCodeInput?.addEventListener('input', () => {
  const val = homeCodeInput.value.trim();
  if (btnHomeJoin) {
    btnHomeJoin.disabled = val.length === 0;
  }
});

homeCodeInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnHomeJoin?.click();
  }
});

btnHomeJoin?.addEventListener('click', () => {
  const raw = homeCodeInput?.value || '';
  const code = sanitizeMeetingCode(raw);
  if (!code) {
    showToast('Please enter a valid meeting code or link', 'warning');
    return;
  }
  goToPreview(code, true);
});

function checkInitialRoute(): void {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room') || params.get('code');
  if (roomParam) {
    const code = sanitizeMeetingCode(roomParam);
    if (code) {
      goToPreview(code, false);
      return;
    }
  }
  switchView('home');
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room') || params.get('code');
  if (roomParam) {
    const code = sanitizeMeetingCode(roomParam);
    if (code) {
      goToPreview(code, false);
      return;
    }
  }
  stopPreview();
  switchView('home');
});

// Check route and initialize
checkInitialRoute();
closeSidebar();
