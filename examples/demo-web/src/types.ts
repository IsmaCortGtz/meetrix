/**
 * Connected WebRTC Demo - Application Types
 * Type definitions for view routing, sidebar tabs, and media tiles.
 */

import type { Role } from '@connected/core';

/**
 * Screen views in the Google Meet workflow.
 */
export type ScreenView = 'home' | 'preview' | 'lobby' | 'meeting' | 'left';

/**
 * Active tab in the meeting sidebar drawer.
 */
export type SidebarTab = 'chat' | 'people' | 'controls';

/**
 * Properties for rendering a participant video tile.
 */
export interface TileProps {
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

