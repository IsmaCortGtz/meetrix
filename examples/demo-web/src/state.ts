/**
 * Connected WebRTC Demo - Central Application State
 * Manages mutable state for the active room, preview streams, and UI panels.
 */

import type { ConnectedRoom, ParticipantInfo } from '@connected/core';
import type { SidebarTab } from './types';

export interface AppState {
  room: ConnectedRoom | null;
  previewStream: MediaStream | null;
  isPreviewMicMuted: boolean;
  isPreviewCamMuted: boolean;
  isHandRaised: boolean;
  activeSidebarTab: SidebarTab;
  isSidebarOpen: boolean;
  unreadChatCount: number;
  lobbyQueue: ParticipantInfo[];
  currentRoomId: string;
}

export const state: AppState = {
  room: null,
  previewStream: null,
  isPreviewMicMuted: false,
  isPreviewCamMuted: false,
  isHandRaised: false,
  activeSidebarTab: 'chat',
  isSidebarOpen: false,
  unreadChatCount: 0,
  lobbyQueue: [],
  currentRoomId: 'engineering-daily',
};

