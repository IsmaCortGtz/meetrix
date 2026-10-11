/**
 * Connected WebRTC Demo - Video Grid & Tile Layout
 * Handles rendering and synchronization of local, remote, and screen-sharing media tiles.
 */

import { state } from '../state';
import { videoGrid } from '../dom';
import type { TileProps } from '../types';
import { syncRemoteAudioElements } from '../audio/remote-audio';

/**
 * Render and update all video tiles in the grid.
 */
export function renderVideoGrid(): void {
  if (!state.room) return;

  const validTileIds = new Set<string>();

  // 1. Local Participant Tile
  const localId = state.room.localParticipant.id || 'local';
  validTileIds.add(`tile-${localId}`);
  syncParticipantTile({
    id: localId,
    name: `${state.room.localParticipant.displayName || 'You'} (You)`,
    role: state.room.localParticipant.role,
    isLocal: true,
    audioMuted: state.room.localParticipant.isMicrophoneMuted,
    videoMuted: state.room.localParticipant.isCameraMuted,
    screenSharing: state.room.localParticipant.isScreenSharing,
    handRaised: state.room.localParticipant.handRaised,
    isSpeaking: state.room.localParticipant.isSpeaking,
    track: state.room.localMedia.cameraTrack,
  });

  // If local participant is screen sharing, sync screen share tile
  if (
    state.room.localParticipant.isScreenSharing &&
    state.room.localMedia.screenTrack &&
    state.room.localMedia.screenTrack.readyState === 'live'
  ) {
    const screenTileId = 'local-screen';
    validTileIds.add(`tile-${screenTileId}`);
    syncScreenShareTile(
      screenTileId,
      `${state.room.localParticipant.displayName}'s Screen`,
      state.room.localMedia.screenTrack
    );
  }

  // 2. Remote Participant Tiles
  for (const peer of state.room.remoteParticipants.values()) {
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

    // If peer is sharing screen, sync extra screen tile
    const screenTrack = peer.getScreenTrack();
    if (peer.screenSharing && screenTrack && screenTrack.readyState === 'live') {
      const screenTileId = `${peer.id}-screen`;
      validTileIds.add(`tile-${screenTileId}`);
      syncScreenShareTile(screenTileId, `${peer.displayName}'s Screen`, screenTrack);
    }
  }

  // Remove tiles that are no longer active
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
  syncRemoteAudioElements(state.room);
}

/**
 * Sync or create a participant's camera/avatar tile.
 */
export function syncParticipantTile(props: TileProps): void {
  const tileId = `tile-${props.id}`;
  let tile = document.getElementById(tileId);

  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = tileId;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Always muted to satisfy browser autoplay policy

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

  // Video and Avatar sync
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
      const peer = !props.isLocal && state.room ? state.room.remoteParticipants.get(props.id) : null;
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

  // Hand raised badge
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

  // Name & Role Tag
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

  // Mic Icon
  const micIcon = tile.querySelector('.tile-status-icon') as HTMLElement | null;
  if (micIcon) {
    micIcon.className = `tile-status-icon ${props.audioMuted ? 'muted' : ''}`;
    micIcon.innerHTML = `<span class="material-symbols-outlined">${props.audioMuted ? 'mic_off' : 'mic'}</span>`;
  }

  // Audio Meter Visibility
  const audioMeter = tile.querySelector('.tile-audio-meter') as HTMLElement | null;
  if (audioMeter) {
    audioMeter.style.display = props.audioMuted ? 'none' : 'inline-flex';
  }

  tile.classList.toggle('speaking', props.isSpeaking);
}

/**
 * Sync or create a dedicated screen-share tile.
 */
export function syncScreenShareTile(id: string, label: string, track: MediaStreamTrack): void {
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

/**
 * Update speaking borders across local and remote tiles.
 */
export function updateSpeakingIndicators(): void {
  if (!state.room) return;

  const localTile = document.getElementById(`tile-${state.room.localParticipant.id || 'local'}`);
  if (localTile) {
    localTile.classList.toggle('speaking', state.room.localParticipant.isSpeaking);
  }

  for (const peer of state.room.remoteParticipants.values()) {
    const tile = document.getElementById(`tile-${peer.id}`);
    if (tile) {
      tile.classList.toggle('speaking', peer.isSpeaking);
    }
  }
}

/**
 * Empty the video grid container.
 */
export function clearVideoGrid(): void {
  videoGrid.innerHTML = '';
}

