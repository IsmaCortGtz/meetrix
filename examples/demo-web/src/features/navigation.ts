/**
 * Meetrix WebRTC Demo - Screen Navigation & Routing
 * Controls screen transitions, URL pushState routing, and Google Meet landing page actions.
 */

import { state } from '../state';
import type { ScreenView } from '../types';
import {
  homeScreen,
  previewScreen,
  lobbyScreen,
  meetingScreen,
  leftMeetingScreen,
  previewRoomIdText,
  btnNewMeeting,
  newMeetingMenu,
  btnCreateForLater,
  btnStartInstant,
  homeCodeInput,
  btnHomeJoin,
  meetingCreatedModal,
  modalLinkInput,
  btnModalCopyLink,
  modalCloseBtn,
  btnPreviewCopyLink,
  btnHeaderCopyLink,
  btnPreviewBackHome,
  btnJoinNow,
  cancelLobbyBtn,
  btnRejoin,
  btnReturnHome,
} from '../dom';
import { showToast, copyToClipboard } from '../utils/toast';
import { generateMeetingCode, sanitizeMeetingCode, getMeetingUrl } from '../utils/room-code';
import { initPreview, stopPreview } from './preview';
import { handleJoinMeeting, teardownMeeting } from './meeting';

/**
 * Switch the currently visible screen.
 */
export function switchView(viewName: ScreenView): void {
  homeScreen?.classList.toggle('active', viewName === 'home');
  previewScreen?.classList.toggle('active', viewName === 'preview');
  lobbyScreen?.classList.toggle('active', viewName === 'lobby');
  meetingScreen?.classList.toggle('active', viewName === 'meeting');
  leftMeetingScreen?.classList.toggle('active', viewName === 'left');
}

/**
 * Navigate to the greenroom preview screen for a room ID.
 */
export function goToPreview(roomId: string, updateUrl = true): void {
  state.currentRoomId = roomId;
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

/**
 * Check URL query parameters on initial page load and navigate accordingly.
 */
export function checkInitialRoute(): void {
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

/**
 * Initialize landing page, modal, and navigation button listeners.
 */
export function initNavigation(): void {
  // 1. New meeting dropdown
  btnNewMeeting?.addEventListener('click', (e) => {
    e.stopPropagation();
    newMeetingMenu?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (newMeetingMenu && !newMeetingMenu.contains(e.target as Node) && e.target !== btnNewMeeting) {
      newMeetingMenu.classList.add('hidden');
    }
  });

  // 2. Create meeting for later modal
  btnCreateForLater?.addEventListener('click', () => {
    newMeetingMenu?.classList.add('hidden');
    const code = generateMeetingCode();
    const link = getMeetingUrl(code);
    if (modalLinkInput) modalLinkInput.value = link;
    meetingCreatedModal?.classList.remove('hidden');
  });

  modalCloseBtn?.addEventListener('click', () => {
    meetingCreatedModal?.classList.add('hidden');
  });

  meetingCreatedModal?.addEventListener('click', (e) => {
    if (e.target === meetingCreatedModal) {
      meetingCreatedModal?.classList.add('hidden');
    }
  });

  btnModalCopyLink?.addEventListener('click', () => {
    if (modalLinkInput) {
      void copyToClipboard(modalLinkInput.value, 'Meeting link copied to clipboard!');
    }
  });

  // 3. Start instant meeting
  btnStartInstant?.addEventListener('click', () => {
    newMeetingMenu?.classList.add('hidden');
    const code = generateMeetingCode();
    goToPreview(code, true);
  });

  // 4. Join via code input
  homeCodeInput?.addEventListener('input', () => {
    const val = homeCodeInput?.value.trim() ?? '';
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

  // 5. Preview screen actions
  btnJoinNow?.addEventListener('click', () => {
    void handleJoinMeeting(switchView);
  });

  btnPreviewBackHome?.addEventListener('click', () => {
    stopPreview();
    window.history.pushState(null, '', window.location.pathname);
    switchView('home');
  });

  btnPreviewCopyLink?.addEventListener('click', () => {
    void copyToClipboard(getMeetingUrl(state.currentRoomId), 'Meeting link copied to clipboard!');
  });

  btnHeaderCopyLink?.addEventListener('click', () => {
    void copyToClipboard(getMeetingUrl(state.currentRoomId), 'Meeting link copied to clipboard!');
  });

  // 6. Lobby cancel
  cancelLobbyBtn.addEventListener('click', async () => {
    if (state.room) {
      await state.room.leave();
    }
    teardownMeeting(switchView, 'home');
  });

  // 7. Post-call buttons
  btnRejoin?.addEventListener('click', () => {
    goToPreview(state.currentRoomId, false);
  });

  btnReturnHome?.addEventListener('click', () => {
    stopPreview();
    window.history.pushState(null, '', window.location.pathname);
    switchView('home');
  });

  // 8. Popstate browser back/forward buttons
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
}
