/**
 * Connected WebRTC Framework - Google Meet-style Demo Web Application
 * Modular Application Entry Point.
 */

import { state } from './state';
import { serverUrlInput, insecureContextBanner } from './dom';
import { initAudioUnlockListeners } from './audio/remote-audio';
import { initHomeClock } from './features/timer';
import { initPreviewControls } from './features/preview';
import { initControlBar } from './features/control-bar';
import { initSidebar, closeSidebar } from './features/sidebar';
import { initChat } from './features/chat';
import { initPolicyListeners } from './features/policies';
import { initMeetingDeviceListeners, teardownMeeting } from './features/meeting';
import { initNavigation, checkInitialRoute, switchView } from './features/navigation';

/**
 * Configure default WebSocket server URL based on current host & protocol.
 */
function initServerUrl(): void {
  if (serverUrlInput) {
    const host = window.location.hostname || 'localhost';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    serverUrlInput.value = `${proto}//${host}:8080/ws`;
  }
}

/**
 * Display a warning banner if the page is loaded over insecure HTTP on LAN.
 */
function checkSecurityContext(): void {
  if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    insecureContextBanner?.classList.remove('hidden');
  }
}

/**
 * Application Bootstrap
 */
function bootstrap(): void {
  initServerUrl();
  checkSecurityContext();

  // Initialize feature modules
  initAudioUnlockListeners();
  initHomeClock();
  initPreviewControls();
  initSidebar();
  initChat();
  initPolicyListeners();
  initMeetingDeviceListeners();
  initNavigation();

  initControlBar(async () => {
    if (state.room) {
      await state.room.leave();
    }
    teardownMeeting(switchView, 'left');
  });

  // Check URL parameters and set initial screen
  checkInitialRoute();
  closeSidebar();
}

// Start application
bootstrap();
