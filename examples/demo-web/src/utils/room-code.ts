/**
 * Meetrix WebRTC Demo - Room Code Utilities
 * Generates and sanitizes Google Meet-style meeting codes (e.g. abc-defg-hij).
 */

/**
 * Generate a randomized 3-4-3 character meeting code.
 */
export function generateMeetingCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const seg = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg(3)}-${seg(4)}-${seg(3)}`;
}

/**
 * Clean up user input (full URL, query parameters, or raw string) into a room ID.
 */
export function sanitizeMeetingCode(input: string): string {
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

/**
 * Build a full shareable meeting URL.
 */
export function getMeetingUrl(roomId: string): string {
  const loc = window.location;
  return `${loc.protocol}//${loc.host}${loc.pathname}?room=${encodeURIComponent(roomId)}`;
}

