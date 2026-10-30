/**
 * Daily snapshots of each tracked user's solved-problem totals.
 *
 * LeetCode only exposes lifetime solved counts, so a daily gain needs a stored
 * baseline. We snapshot each user's per-difficulty totals once per day and
 * compare the current totals against the most recent snapshot from a prior day
 * (the same approach problemRankSnapshots uses for global rankings).
 */
import { getTodayInTimezone } from './timezoneHelper.js';

export const SOLVED_SNAPSHOTS_KEY = 'solvedSnapshots';
export const SOLVED_DIFFICULTIES = ['All', 'Easy', 'Medium', 'Hard'];

const MAX_SNAPSHOT_DAYS = 60;

/**
 * Normalizes a getUserProblemStats result into per-difficulty totals.
 * @param {{acSubmissionNum: {difficulty: string, count: number}[]}} stats
 * @returns {{All: number, Easy: number, Medium: number, Hard: number}|null}
 */
export function extractSolvedCounts(stats) {
  if (!Array.isArray(stats?.acSubmissionNum)) {
    return null;
  }

  const counts = { All: 0, Easy: 0, Medium: 0, Hard: 0 };
  let found = false;

  for (const entry of stats.acSubmissionNum) {
    if (SOLVED_DIFFICULTIES.includes(entry?.difficulty)) {
      counts[entry.difficulty] = typeof entry.count === 'number' ? entry.count : 0;
      found = true;
    }
  }

  return found ? counts : null;
}

/**
 * Finds the most recent snapshot taken before today.
 * @param {Object.<string, Object>} userDates - Map of YYYY-MM-DD to counts
 * @param {string} todayStr - Today's date string
 * @returns {{date: string, counts: Object}|null}
 */
export function getMostRecentPriorSnapshot(userDates, todayStr) {
  if (!userDates) {
    return null;
  }

  const priorDates = Object.keys(userDates)
    .filter((date) => date < todayStr)
    .sort();

  if (priorDates.length === 0) {
    return null;
  }

  const date = priorDates[priorDates.length - 1];
  return { date, counts: userDates[date] };
}

/**
 * Yesterday's date string for a given YYYY-MM-DD date, computed in UTC so DST
 * never shifts the result.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} YYYY-MM-DD
 */
export function getYesterdayStr(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Per-difficulty gain between current counts and a prior snapshot. Solved
 * totals only ever grow, but a shrinking value (data correction, reset) shows
 * up as 0 rather than a negative badge.
 * @param {Object} currentCounts
 * @param {Object} priorCounts
 * @returns {{All: number, Easy: number, Medium: number, Hard: number}}
 */
export function computeSolvedDelta(currentCounts, priorCounts) {
  const delta = {};

  for (const difficulty of SOLVED_DIFFICULTIES) {
    const current = currentCounts?.[difficulty] ?? 0;
    const prior = priorCounts?.[difficulty] ?? 0;
    delta[difficulty] = Math.max(0, current - prior);
  }

  return delta;
}

/**
 * Builds the username → delta map consumed by displayLeaderboard.
 * @param {object[]} statsList - getUserProblemStats results
 * @param {Object.<string, Object>} byDate - Stored snapshots by username
 * @param {string} todayStr - Today's date string
 * @returns {Object.<string, {All: number, Easy: number, Medium: number, Hard: number, referenceDate: string, isPriorDay: boolean}>}
 */
export function buildSolvedDeltas(statsList, byDate, todayStr) {
  const deltas = {};
  const yesterdayStr = getYesterdayStr(todayStr);

  for (const stats of statsList || []) {
    const username = stats?.username;
    const currentCounts = extractSolvedCounts(stats);
    if (!username || !currentCounts) {
      continue;
    }

    const priorSnapshot = getMostRecentPriorSnapshot(byDate?.[username], todayStr);
    if (!priorSnapshot) {
      continue;
    }

    deltas[username] = {
      ...computeSolvedDelta(currentCounts, priorSnapshot.counts),
      referenceDate: priorSnapshot.date,
      isPriorDay: priorSnapshot.date === yesterdayStr,
    };
  }

  return deltas;
}

/**
 * Writes today's counts for every user in the batch and prunes snapshots older
 * than 60 days.
 * @param {Object.<string, Object>} byDate - Stored snapshots by username
 * @param {object[]} statsList - getUserProblemStats results
 * @param {string} todayStr - Today's date string
 * @returns {Object.<string, Object>} Updated snapshots
 */
export function updateSolvedSnapshots(byDate, statsList, todayStr) {
  const updated = { ...(byDate || {}) };

  for (const stats of statsList || []) {
    const username = stats?.username;
    const counts = extractSolvedCounts(stats);
    if (!username || !counts) {
      continue;
    }

    const userDates = { ...(updated[username] || {}) };
    userDates[todayStr] = counts;

    const dates = Object.keys(userDates).sort();
    if (dates.length > MAX_SNAPSHOT_DAYS) {
      dates.slice(0, dates.length - MAX_SNAPSHOT_DAYS).forEach((date) => {
        delete userDates[date];
      });
    }

    updated[username] = userDates;
  }

  return updated;
}

function readStore() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SOLVED_SNAPSHOTS_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        resolve({});
        return;
      }
      resolve(result[SOLVED_SNAPSHOTS_KEY] || {});
    });
  });
}

function writeStore(store) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SOLVED_SNAPSHOTS_KEY]: store }, resolve);
  });
}

/**
 * Computes each user's solved gain since the most recent prior-day snapshot,
 * and stores today's totals for tomorrow's comparison.
 * @param {object[]} statsList - getUserProblemStats results
 * @param {string} timezone - IANA timezone string or 'auto'
 * @param {object} [options]
 * @param {boolean} [options.updateSnapshots=true] - Persist today's totals
 * @returns {Promise<Object>} Username → delta map for displayLeaderboard
 */
export async function loadSolvedDeltas(statsList, timezone = 'America/Chicago', options = {}) {
  const { updateSnapshots = true } = options;

  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  const todayStr = getTodayInTimezone(timezone);
  const byDate = await readStore();
  const deltas = buildSolvedDeltas(statsList, byDate, todayStr);

  if (updateSnapshots) {
    await writeStore(updateSolvedSnapshots(byDate, statsList, todayStr));
  }

  return deltas;
}

/**
 * Drops a user's snapshot history. Used when a friend is removed so no stale
 * data lingers for a user we no longer track.
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function removeUserSolvedSnapshots(username) {
  const byDate = await readStore();
  if (!(username in byDate)) {
    return;
  }

  delete byDate[username];
  await writeStore(byDate);
}
