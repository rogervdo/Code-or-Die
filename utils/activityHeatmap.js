/**
 * Helpers for the Activity tab's 30-day heatmap.
 *
 * LeetCode's `submissionCalendar` maps a Unix timestamp (seconds, at UTC
 * midnight) to the number of submissions accepted that day. These helpers turn
 * that map into an ordered list of days for the trailing window and bucket the
 * counts into intensity levels for display.
 */

/**
 * Converts a Date to a UTC `YYYY-MM-DD` key.
 * @param {Date} date
 * @returns {string}
 */
function toDateKey(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/**
 * Converts a calendar timestamp (seconds) to its UTC `YYYY-MM-DD` key.
 * @param {number|string} timestamp - Unix timestamp in seconds
 * @returns {string}
 */
export function calendarTimestampToDateKey(timestamp) {
  return new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);
}

/**
 * Builds the trailing `days`-day activity window ending at `today`.
 * @param {Object.<string, number>} submissionCalendar - Map of timestamp -> count
 * @param {object} [options]
 * @param {number} [options.days=30] - Number of days in the window
 * @param {Date} [options.today=new Date()] - Reference day the window ends on
 * @returns {{ cells: {date: string, count: number}[], activeDays: number, maxCount: number }}
 *          `cells` is ordered oldest to newest and always has exactly `days` entries.
 */
export function buildActivityGrid(submissionCalendar, options = {}) {
  const { days = 30, today = new Date() } = options;

  const counts = {};
  if (submissionCalendar && typeof submissionCalendar === 'object') {
    for (const [timestamp, count] of Object.entries(submissionCalendar)) {
      const key = calendarTimestampToDateKey(timestamp);
      counts[key] = (counts[key] || 0) + Number(count);
    }
  }

  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const cells = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - offset);
    const date = toDateKey(day);
    cells.push({ date, count: counts[date] || 0 });
  }

  const activeDays = cells.filter((cell) => cell.count > 0).length;
  const maxCount = cells.reduce((max, cell) => Math.max(max, cell.count), 0);

  return { cells, activeDays, maxCount };
}

/**
 * Maps a day's submission count to an intensity level (0-3) relative to the
 * busiest day in the window. 0 means no submissions.
 * @param {number} count
 * @param {number} maxCount
 * @returns {number}
 */
export function getActivityLevel(count, maxCount) {
  if (!count || count <= 0) {
    return 0;
  }
  if (!maxCount || maxCount <= 0) {
    return 1;
  }

  const ratio = count / maxCount;
  if (ratio <= 1 / 3) return 1;
  if (ratio <= 2 / 3) return 2;
  return 3;
}

/**
 * Formats the hover tooltip text for a day cell, e.g. "Sat, Sep 26: 10 submissions".
 * @param {{date: string, count: number}} cell
 * @returns {string}
 */
export function formatHeatmapTooltip(cell) {
  const date = new Date(`${cell.date}T00:00:00Z`);
  const label = date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  if (!cell.count) {
    return `${label}: No submissions`;
  }

  return `${label}: ${cell.count} ${cell.count === 1 ? 'submission' : 'submissions'}`;
}

/**
 * Formats a day cell's date for the axis labels, e.g. "Sep 5".
 * @param {string} dateKey - `YYYY-MM-DD`
 * @returns {string}
 */
export function formatAxisDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
}
