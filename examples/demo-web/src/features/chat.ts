/**
 * Meetrix WebRTC Demo - In-Meeting Chat
 * Handles chat message submission, message bubble rendering, and unread counters.
 */

import type { ChatBroadcastPayload } from '@meetrix/core';
import { state } from '../state';
import { chatForm, chatInput, chatMessages, chatUnreadBadge } from '../dom';
import { escapeHtml, formatTime } from '../utils/format';

/**
 * Append a chat message bubble to the messages list.
 */
export function appendChatMessage(msg: ChatBroadcastPayload): void {
  const isMine = state.room && state.room.localParticipant.id === msg.peer_id;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isMine ? 'mine' : ''}`;

  const timeStr = formatTime(msg.timestamp);

  bubble.innerHTML = `
    <div class="chat-meta">
      <span class="chat-sender">${escapeHtml(msg.display_name)}</span>
      <span class="chat-time">${timeStr}</span>
    </div>
    <div class="chat-text">${escapeHtml(msg.text)}</div>
  `;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // If chat tab is not active, increment unread badge counter
  if (!state.isSidebarOpen || state.activeSidebarTab !== 'chat') {
    state.unreadChatCount++;
    chatUnreadBadge.classList.remove('hidden');
    chatUnreadBadge.textContent = String(state.unreadChatCount);
  }
}

/**
 * Clear chat messages and reset unread counters.
 */
export function resetChat(): void {
  chatMessages.innerHTML = '<div class="chat-welcome">Messages are sent to everyone in the room.</div>';
  state.unreadChatCount = 0;
  chatUnreadBadge.classList.add('hidden');
  chatUnreadBadge.textContent = '0';
}

/**
 * Initialize chat submission form listeners.
 */
export function initChat(): void {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.room) return;

    const text = chatInput.value.trim();
    if (!text) return;

    try {
      await state.room.chat.sendMessage(text);
      chatInput.value = '';
    } catch (err) {
      alert(`Could not send chat message: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

