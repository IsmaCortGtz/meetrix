/**
 * Meetrix WebRTC Demo - Sidebar Drawer
 * Handles tab transitions between Chat, People, and Host Controls.
 */

import { state } from '../state';
import type { SidebarTab } from '../types';
import {
  sidebar,
  sidebarCloseBtn,
  tabChatBtn,
  tabPeopleBtn,
  tabControlsBtn,
  tabChat,
  tabPeople,
  tabControls,
  chatUnreadBadge,
  btnToggleChat,
  btnTogglePeople,
} from '../dom';

/**
 * Open the sidebar and activate the specified tab.
 */
export function openSidebarTab(tab: SidebarTab): void {
  state.activeSidebarTab = tab;
  state.isSidebarOpen = true;
  sidebar.classList.remove('closed');

  tabChatBtn.classList.toggle('active', tab === 'chat');
  tabPeopleBtn.classList.toggle('active', tab === 'people');
  tabControlsBtn.classList.toggle('active', tab === 'controls');

  tabChat.classList.toggle('active', tab === 'chat');
  tabPeople.classList.toggle('active', tab === 'people');
  tabControls.classList.toggle('active', tab === 'controls');

  if (tab === 'chat') {
    state.unreadChatCount = 0;
    chatUnreadBadge.classList.add('hidden');
    chatUnreadBadge.textContent = '0';
  }
}

/**
 * Slide the sidebar closed.
 */
export function closeSidebar(): void {
  state.isSidebarOpen = false;
  sidebar.classList.add('closed');
}

/**
 * Bind sidebar toggle buttons and tab click events.
 */
export function initSidebar(): void {
  btnToggleChat.addEventListener('click', () => openSidebarTab('chat'));
  btnTogglePeople.addEventListener('click', () => openSidebarTab('people'));
  sidebarCloseBtn.addEventListener('click', () => closeSidebar());

  tabChatBtn.addEventListener('click', () => openSidebarTab('chat'));
  tabPeopleBtn.addEventListener('click', () => openSidebarTab('people'));
  tabControlsBtn.addEventListener('click', () => openSidebarTab('controls'));
}

