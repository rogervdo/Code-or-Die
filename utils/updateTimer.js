/**
 * Shared update schedule.
 *
 * Every tab renders the same countdown: the time remaining until the next
 * scheduled refresh. A single coordinator (`startRefreshCycle`) refreshes all
 * tab data once that shared deadline passes, then opens the next window.
 * Because every timer reads one shared deadline, they always agree.
 */

const REFRESH_SCHEDULE_KEY = 'nextRefreshAt';

/** How often the popup re-checks all of its data while open. */
export const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

let nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;

/**
 * Formats milliseconds into a human-readable time string
 * @param {number} ms - Milliseconds
 * @returns {string} - Formatted time string
 */
export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * The shared epoch timestamp (ms) at which the next refresh runs.
 * @returns {number}
 */
export function getNextRefreshAt() {
  return nextRefreshAt;
}

/**
 * Opens a new refresh window starting now. Persisted so the deadline is shared
 * and survives a quick popup reopen.
 * @param {number} [from=Date.now()] - Epoch ms the window starts from
 * @returns {Promise<number>} - The new deadline
 */
export function resetRefreshSchedule(from = Date.now()) {
  nextRefreshAt = from + REFRESH_INTERVAL_MS;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [REFRESH_SCHEDULE_KEY]: nextRefreshAt }, () => resolve(nextRefreshAt));
  });
}

/**
 * Loads the persisted deadline, or opens a fresh window when it is missing or
 * has already elapsed.
 * @returns {Promise<number>} - The active deadline
 */
export function restoreRefreshSchedule() {
  return new Promise((resolve) => {
    chrome.storage.local.get([REFRESH_SCHEDULE_KEY], (result) => {
      const stored = result[REFRESH_SCHEDULE_KEY];
      if (typeof stored === 'number' && stored > Date.now()) {
        nextRefreshAt = stored;
        resolve(nextRefreshAt);
      } else {
        resetRefreshSchedule().then(resolve);
      }
    });
  });
}

/**
 * Creates the countdown element for a page. Every instance renders the same
 * shared deadline.
 * @param {string} containerId - ID of the container element
 * @returns {{ update: Function, destroy: Function }}
 */
export function createUpdateTimer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container ${containerId} not found`);
    return { update: () => {}, destroy: () => {} };
  }

  let timerElement = container.querySelector('.update-timer');
  if (!timerElement) {
    timerElement = document.createElement('div');
    timerElement.className = 'update-timer';
    container.appendChild(timerElement);
  }

  function render() {
    const remaining = nextRefreshAt - Date.now();
    timerElement.textContent = remaining <= 0 ? 'Updating…' : `Updates in ${formatTime(remaining)}`;
  }

  render();
  const intervalId = setInterval(render, 1000);

  return {
    update: render,
    destroy: () => {
      clearInterval(intervalId);
      if (timerElement && timerElement.parentNode) {
        timerElement.remove();
      }
    },
  };
}

/**
 * Runs `onRefresh` once the shared deadline passes, then opens the next window.
 * Only one cycle should be active at a time.
 * @param {Function} onRefresh - Async callback that reloads the tab data
 * @returns {Promise<{ destroy: Function }>}
 */
export async function startRefreshCycle(onRefresh) {
  await restoreRefreshSchedule();

  let running = false;
  const tick = async () => {
    if (running || Date.now() < nextRefreshAt) {
      return;
    }

    running = true;
    try {
      await onRefresh();
    } catch (error) {
      console.error('Scheduled refresh failed:', error);
    } finally {
      await resetRefreshSchedule();
      running = false;
    }
  };

  const intervalId = setInterval(tick, 1000);

  return {
    destroy: () => clearInterval(intervalId),
  };
}
