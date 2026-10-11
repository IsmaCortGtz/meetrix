/**
 * Connected WebRTC Demo - Formatting Utilities
 */

/**
 * Escape HTML special characters to prevent XSS injection.
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Format a timestamp into HH:MM.
 */
export function formatTime(timestamp?: string | number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
