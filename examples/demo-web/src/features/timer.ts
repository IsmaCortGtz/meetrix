/**
 * Meetrix WebRTC Demo - Timers & Clock
 * Manages Google Meet-style home clock and in-meeting session countdown ticker.
 */

import { homeClock, sessionTimer, timerText } from '../dom';

let sessionTimerInterval: ReturnType<typeof setInterval> | null = null;
let currentRemainingSec = 0;

/**
 * Initialize the home screen date & time clock.
 */
export function initHomeClock(): void {
  function update(): void {
    if (!homeClock) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    homeClock.textContent = `${timeStr} • ${dateStr}`;
  }

  update();
  setInterval(update, 1000);
}

/**
 * Render the session countdown string (MM:SS) and apply warning style if under 60 seconds.
 */
function renderTimerDisplay(sec: number): void {
  if (sec <= 0) {
    timerText.textContent = '00:00';
    sessionTimer.classList.add('warning');
    return;
  }

  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  timerText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  sessionTimer.classList.toggle('warning', sec <= 60);
}

/**
 * Stop the local 1-second countdown ticker.
 */
export function stopSessionTimerTicker(): void {
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
}

/**
 * Update the remaining session time and maintain a smooth local 1-second tick.
 */
export function updateSessionTimer(remainingSec: number): void {
  if (remainingSec < 0) {
    stopSessionTimerTicker();
    timerText.textContent = '--:--';
    return;
  }

  currentRemainingSec = remainingSec;
  renderTimerDisplay(currentRemainingSec);

  // Start smooth local 1-second countdown if not already ticking
  if (!sessionTimerInterval) {
    sessionTimerInterval = setInterval(() => {
      if (currentRemainingSec > 0) {
        currentRemainingSec--;
        renderTimerDisplay(currentRemainingSec);
      } else {
        stopSessionTimerTicker();
        renderTimerDisplay(0);
      }
    }, 1000);
  }
}

