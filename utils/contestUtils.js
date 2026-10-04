/**
 * Contest helpers: week bounds, submission accumulation and scoring.
 *
 * LeetCode's public `recentAcSubmissionList` endpoint returns at most 20
 * submissions no matter what limit is requested (larger values are silently
 * clamped). To build a full picture of the current week we therefore keep a
 * per-user weekly store and merge each freshly fetched batch into it, so the
 * contest leaderboard accumulates more than the 20 most recent submissions
 * across refreshes.
 */
import { getLocalDateString, getTodayInTimezone } from './timezoneHelper.js';

const POINTS_BY_DIFFICULTY = {
  Easy: 1,
  Medium: 3,
  Hard: 6,
};

/**
 * Points awarded for a problem of the given difficulty.
 * @param {string} difficulty - "Easy" | "Medium" | "Hard"
 * @returns {number} Points, or 0 for an unknown difficulty
 */
export function getPointsForDifficulty(difficulty) {
  return POINTS_BY_DIFFICULTY[difficulty] ?? 0;
}

/**
 * Stable identity for a submission. Using the title slug plus the submission
 * timestamp keeps genuinely separate submissions (including re-solves of the
 * same problem) while filtering out duplicates seen across refreshes.
 * @param {object} submission - A submission object
 * @returns {string} Unique key
 */
export function submissionKey(submission) {
  return `${submission.titleSlug}::${submission.timestamp}`;
}

/**
 * Merges two submission lists, dropping entries that already exist in
 * `existing` (matched by submissionKey). Order of `existing` is preserved and
 * new entries are appended in their incoming order.
 * @param {object[]} existing
 * @param {object[]} incoming
 * @returns {object[]} Merged list
 */
export function mergeSubmissions(existing, incoming) {
  const seen = new Set(existing.map(submissionKey));
  const merged = [...existing];

  for (const submission of incoming) {
    const key = submissionKey(submission);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(submission);
    }
  }

  return merged;
}

/**
 * Gets the start (Monday) and end (Sunday) of the current week in the given
 * timezone, plus the formatted date strings used for cache/store keys.
 * @param {string} timezone - IANA timezone string or 'auto'
 * @returns {{weekStart: Date, weekEnd: Date, weekStartFormatted: string, weekEndFormatted: string}}
 */
export function getCurrentWeekBounds(timezone = 'America/Chicago') {
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  const todayStr = getTodayInTimezone(timezone);
  const todayParts = todayStr.split('-');
  const today = new Date(Date.UTC(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2])));

  // getUTCDay(): 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const dayOfWeek = today.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() - daysSinceMonday);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return {
    weekStart,
    weekEnd,
    weekStartFormatted: weekStart.toISOString().split('T')[0],
    weekEndFormatted: weekEnd.toISOString().split('T')[0],
  };
}

/**
 * Checks whether a timestamp falls within the given week (inclusive).
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {Date} weekStart - Monday of the week
 * @param {Date} weekEnd - Sunday of the week
 * @param {string} timezone - IANA timezone string
 * @returns {boolean}
 */
export function isInCurrentWeek(timestamp, weekStart, weekEnd, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  return submissionDate >= weekStartStr && submissionDate <= weekEndStr;
}

/**
 * Filters a submission list down to entries within the given week.
 * @param {object[]} submissions
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @param {string} timezone
 * @returns {object[]}
 */
export function filterSubmissionsInWeek(submissions, weekStart, weekEnd, timezone) {
  return submissions.filter((submission) =>
    isInCurrentWeek(submission.timestamp, weekStart, weekEnd, timezone)
  );
}

export const WEEKLY_SUBMISSIONS_STORE_KEY = 'weeklySubmissions';

function readStore() {
  return new Promise((resolve) => {
    chrome.storage.local.get([WEEKLY_SUBMISSIONS_STORE_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        resolve({});
        return;
      }
      resolve(result[WEEKLY_SUBMISSIONS_STORE_KEY] || {});
    });
  });
}

function writeStore(store) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [WEEKLY_SUBMISSIONS_STORE_KEY]: store }, resolve);
  });
}

// Serializes read-modify-write cycles so two overlapping refreshes can never
// clobber each other's accumulated submissions.
let storeQueue = Promise.resolve();

/**
 * Merges a freshly fetched batch of submissions into the user's weekly store
 * and returns the full accumulated list.
 *
 * The store holds only the current week: entries for any other week (a user no
 * longer tracked, or data left over after the week rolled over) are pruned, so
 * storage stays bounded and stale weeks never leak into the current
 * leaderboard. An empty batch (e.g. a failed fetch) leaves the accumulated
 * data untouched.
 *
 * @param {string} username
 * @param {string} weekStartFormatted - YYYY-MM-DD of the current week's Monday
 * @param {object[]} submissions - Submissions already filtered to the current week
 * @returns {Promise<object[]>} The accumulated submissions for the week
 */
export function accumulateWeeklySubmissions(username, weekStartFormatted, submissions) {
  const task = storeQueue.then(async () => {
    const store = await readStore();

    for (const [name, entry] of Object.entries(store)) {
      if (!entry || entry.weekStart !== weekStartFormatted) {
        delete store[name];
      }
    }

    const existing = store[username];
    const base = existing && Array.isArray(existing.submissions) ? existing.submissions : [];

    const merged = mergeSubmissions(base, submissions);
    store[username] = { weekStart: weekStartFormatted, submissions: merged };

    await writeStore(store);
    return merged;
  });

  // Keep the chain alive even if a task rejects so later calls still run.
  storeQueue = task.catch(() => {});
  return task;
}

/**
 * Drops a user's accumulated weekly submissions from the store. Used when a
 * friend is removed from the watchlist so no stale data lingers for a user we
 * no longer track.
 * @param {string} username
 * @returns {Promise<void>}
 */
export function removeUserWeeklySubmissions(username) {
  const task = storeQueue.then(async () => {
    const store = await readStore();
    if (!(username in store)) return;

    delete store[username];
    await writeStore(store);
  });

  storeQueue = task.catch(() => {});
  return task;
}
