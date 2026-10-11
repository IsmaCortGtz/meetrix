/**
 * Connected WebRTC Demo - Toast Notifications & Clipboard Helpers
 */

/**
 * Display a temporary floating toast notification.
 */
export function showToast(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
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

/**
 * Copy text to clipboard with fallback and toast feedback.
 */
export async function copyToClipboard(
  text: string,
  successMsg = 'Meeting link copied to clipboard!'
): Promise<void> {
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

