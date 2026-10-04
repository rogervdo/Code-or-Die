/**
 * Purges every stored record tied to a single friend. Called when a user is
 * removed from the watchlist so their cache entries and derived history don't
 * linger (and don't get mixed up with a future friend reusing the name).
 *
 * Records are keyed by username in several places:
 *  - TTL cache entries (`cache_*`) from the GQLQueries modules
 *  - `weeklySubmissions[username]`  (contest accumulation)
 *  - `previousStreaks[username]`    (streak comparison)
 *  - `dailyActivityLog[username]`   (immutable per-day activity)
 *  - `problemRankSnapshots.{lastViewed,byDate}[username]`
 */
import { removeUserWeeklySubmissions } from './contestUtils.js';

const PREVIOUS_STREAKS_KEY = 'previousStreaks';
const DAILY_ACTIVITY_LOG_KEY = 'dailyActivityLog';
const PROBLEM_RANK_SNAPSHOTS_KEY = 'problemRankSnapshots';

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

/**
 * Cache keys belonging to a single user.
 *
 * Exact keys are matched exactly; submission keys embed the limit
 * (`submissions_<user>_<limit>`) so they're matched with a trailing underscore
 * to avoid a shorter name (e.g. "bob") deleting a longer one's ("bobby") data.
 * @param {string[]} allKeys - Every key currently in chrome.storage.local
 * @param {string} username
 * @returns {string[]}
 */
export function getUserCacheKeys(allKeys, username) {
  const exactKeys = new Set([
    `cache_profile_pic_${username}`,
    `cache_user_stats_${username}`,
    `cache_problem_ranking_${username}`,
  ]);
  const submissionsPrefix = `cache_submissions_${username}_`;

  return allKeys.filter((key) => exactKeys.has(key) || key.startsWith(submissionsPrefix));
}

async function removeFromObjectStore(storageKey, username) {
  const result = await storageGet([storageKey]);
  const store = result[storageKey];

  if (!store || typeof store !== 'object' || !(username in store)) {
    return;
  }

  delete store[username];
  await storageSet({ [storageKey]: store });
}

async function removeFromRankSnapshots(username) {
  const result = await storageGet([PROBLEM_RANK_SNAPSHOTS_KEY]);
  const snapshots = result[PROBLEM_RANK_SNAPSHOTS_KEY];
  if (!snapshots) {
    return;
  }

  let changed = false;
  for (const bucket of ['lastViewed', 'byDate']) {
    if (snapshots[bucket] && username in snapshots[bucket]) {
      delete snapshots[bucket][username];
      changed = true;
    }
  }

  if (changed) {
    await storageSet({ [PROBLEM_RANK_SNAPSHOTS_KEY]: snapshots });
  }
}

/**
 * Removes all stored records for a friend.
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function removeFriendData(username) {
  if (!username) {
    return;
  }

  const allItems = await storageGet(null);
  const cacheKeys = getUserCacheKeys(Object.keys(allItems), username);
  if (cacheKeys.length > 0) {
    await storageRemove(cacheKeys);
  }

  await Promise.all([
    removeUserWeeklySubmissions(username),
    removeFromObjectStore(PREVIOUS_STREAKS_KEY, username),
    removeFromObjectStore(DAILY_ACTIVITY_LOG_KEY, username),
    removeFromRankSnapshots(username),
  ]);
}
