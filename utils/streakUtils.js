import cache, { TTL, getTTLUntilMidnight } from './cache.js';
import getACSubmissions from '../GQLQueries/recentACSubmissions.js';
import getUserProfilePic from '../GQLQueries/getUserProfilePic.js';
import { getLocalDateString, getTodayInTimezone } from './timezoneHelper.js';
import { mapLimit } from './concurrency.js';

const PREVIOUS_STREAKS_KEY = 'previousStreaks';
const PREVIOUS_STREAK_DATES_KEY = 'previousStreakDates';
const DAILY_ACTIVITY_LOG_KEY = 'dailyActivityLog';

/**
 * Longest streak the day scan can count. Matches the activity log's 60-day
 * retention; longer streaks are carried forward by the saved-streak chaining.
 */
const STREAK_WINDOW_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Date string (YYYY-MM-DD) for `daysAgo` days before today in `timezone`.
 * Days are walked in UTC so a DST transition can never skip or repeat one.
 * @param {number} daysAgo
 * @param {string} timezone - IANA timezone string
 * @returns {string} YYYY-MM-DD
 */
function dateStringDaysAgo(daysAgo, timezone) {
  const [year, month, day] = getTodayInTimezone(timezone).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

/**
 * Whole days from `fromDate` to `toDate` (both YYYY-MM-DD), or null when either
 * is missing or unparseable.
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {number|null}
 */
function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);

  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }

  return Math.round((to - from) / DAY_MS);
}

/**
 * Builds a predicate answering whether a user was active `daysAgo` days back.
 *
 * A day counts as active when the submission window still lists a solve from it
 * or the immutable activity log recorded one. The log reaches further back than
 * the API's 30-entry window and keeps days LeetCode has since re-dated to
 * today, so it repairs holes the submission list alone reports as a break.
 * @param {object[]} submissions
 * @param {Object.<string, boolean>} activityLog - Per-user log keyed by YYYY-MM-DD
 * @param {string} timezone - IANA timezone string
 * @returns {(daysAgo: number) => boolean}
 */
function createDayActivityChecker(submissions, activityLog, timezone) {
  const submissionDates = new Set(
    submissions.map((submission) => getLocalDateString(submission.timestamp, timezone))
  );

  return (daysAgo) => {
    const dateStr = dateStringDaysAgo(daysAgo, timezone);
    return submissionDates.has(dateStr) || activityLog[dateStr] === true;
  };
}

/**
 * Get the per-day activity log for one user (dates on which the extension saw
 * them solve).
 * @param {string} username
 * @returns {Promise<Object.<string, boolean>>}
 */
function getUserActivityLog(username) {
  return new Promise((resolve) => {
    chrome.storage.local.get([DAILY_ACTIVITY_LOG_KEY], (result) => {
      const log = result[DAILY_ACTIVITY_LOG_KEY] || {};
      resolve(log[username] || {});
    });
  });
}

/**
 * Record that a user solved a problem today
 * This creates an immutable record that won't change even if they re-solve
 */
async function recordDailyActivity(username, timezone) {
  return new Promise((resolve) => {
    chrome.storage.local.get([DAILY_ACTIVITY_LOG_KEY], (result) => {
      const log = result[DAILY_ACTIVITY_LOG_KEY] || {};
      const todayStr = getTodayInTimezone(timezone);

      // Initialize user's log if needed
      if (!log[username]) {
        log[username] = {};
      }

      // Only set to true if not already set (immutable once set)
      if (!log[username][todayStr]) {
        log[username][todayStr] = true;

        // Clean up old entries (keep last 60 days only)
        const dates = Object.keys(log[username]).sort();
        if (dates.length > 60) {
          dates.slice(0, dates.length - 60).forEach((date) => {
            delete log[username][date];
          });
        }

        chrome.storage.local.set({ [DAILY_ACTIVITY_LOG_KEY]: log }, () => {
          console.log(`[Activity Log] Recorded activity for ${username} on ${todayStr}`);
          resolve();
        });
      } else {
        // Already recorded today
        resolve();
      }
    });
  });
}

/**
 * Computes one user's streak/strike state for the current day.
 *
 * Streak: consecutive days with at least one submission, starting today when
 * they solved today, otherwise yesterday.
 * Strikes: consecutive missed days counting back from yesterday, capped at
 * `maxStrikes`.
 *
 * `previousStreak`/`previousStreakDate` carry the streak saved by an earlier
 * run and the last day that streak counted through. They only extend the day
 * scan, which can miss days that fell out of the API window:
 *  - saved today: the value already includes today, so it is adopted as a
 *    floor and today is never added twice;
 *  - saved yesterday: the streak grew by one only if they solved today;
 *  - older or undated: ignored, the day scan stands on its own.
 * Because the repair is anchored to a date it is stable no matter how often the
 * state is recomputed; without the date it re-applied on every recomputation
 * and inflated the streak several times a day.
 *
 * @param {object} params
 * @param {object[]} params.submissions - Recent AC submissions
 * @param {string} params.timezone - IANA timezone string
 * @param {number} [params.maxStrikes=3]
 * @param {number} [params.previousStreak=0] - Streak saved by a previous run
 * @param {string|null} [params.previousStreakDate=null] - Last day that streak counted through
 * @param {Object.<string, boolean>} [params.activityLog={}] - Immutable per-day activity records
 * @returns {{streakCount:number, strikeCount:number, clearsToday:boolean, solvedYesterday:boolean, clearingSubmission:object|null, lastProblemDate:string|null, streakThroughDate:string|null}}
 */
export function computeStreakState({
  submissions,
  timezone,
  maxStrikes = 3,
  previousStreak = 0,
  previousStreakDate = null,
  activityLog = {},
}) {
  const isActiveDaysAgo = createDayActivityChecker(submissions, activityLog, timezone);
  const today = getTodayInTimezone(timezone);

  const todaySubmissions = submissions.filter(
    (submission) => getLocalDateString(submission.timestamp, timezone) === today
  );
  const clearsToday = todaySubmissions.length > 0;
  const clearingSubmission = clearsToday ? todaySubmissions[0] : null;

  // Count back from today when there is evidence of a solve today, otherwise
  // from yesterday. The log counts as evidence, so a failed fetch cannot break
  // a streak that was already observed.
  const todayActive = isActiveDaysAgo(0);
  const startDay = todayActive ? 0 : 1;

  let streakCount = 0;
  let lastProblemDate = null;
  for (let daysAgo = startDay; daysAgo < STREAK_WINDOW_DAYS; daysAgo++) {
    if (!isActiveDaysAgo(daysAgo)) {
      break;
    }

    if (lastProblemDate === null) {
      lastProblemDate = dateStringDaysAgo(daysAgo, timezone);
    }
    streakCount++;
  }

  if (streakCount > 0 && previousStreak > 0) {
    const gap = previousStreakDate ? daysBetween(previousStreakDate, today) : null;

    if (gap === 0) {
      streakCount = Math.max(streakCount, previousStreak);
    } else if (gap === 1) {
      streakCount = Math.max(streakCount, todayActive ? previousStreak + 1 : previousStreak);
    }
  }

  let strikeCount = 0;
  for (let daysAgo = 1; daysAgo <= maxStrikes; daysAgo++) {
    if (isActiveDaysAgo(daysAgo)) {
      break;
    }
    strikeCount++;
  }

  return {
    streakCount,
    strikeCount,
    clearsToday,
    solvedYesterday: isActiveDaysAgo(1),
    clearingSubmission,
    lastProblemDate,
    // Last day the returned streak counts through. Saved alongside the streak
    // so the next run can tell "already counted today" from "counts through
    // yesterday" instead of blindly adding a day.
    streakThroughDate: streakCount > 0 ? (todayActive ? today : dateStringDaysAgo(1, timezone)) : null,
  };
}

/**
 * Loads strikes users data - calculates consecutive days users haven't solved problems
 * starting from yesterday and checking up to maxStrikes days back.
 * Also calculates streaks - consecutive days users have solved problems.
 * @param {string[]} friends - An array of usernames representing the friends of the current user
 * @param {string} username - The username of the current user
 * @param {number} maxStrikes - Maximum number of strikes to check (days back from yesterday)
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @returns {object} - Object containing strikesUsers, clearedStrikesUsers, and streaksUsers arrays
 */
export async function loadStrikesUsersData(friends, username, maxStrikes = 3, timezone = 'America/Chicago') {
  // Handle auto-detect timezone
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  // Get today's date in the timezone for cache key
  const todayStr = getTodayInTimezone(timezone);

  // Create cache key based on all users, maxStrikes, and today's date
  const allUsers = [username, ...friends].sort();
  const cacheKey = `strikes_${allUsers.join('_')}_${maxStrikes}_${todayStr}`;

  // Check cache first
  const cachedData = await cache.get(cacheKey);
  if (cachedData !== null) {
    console.log(`Cache hit for strikes data: ${cacheKey}`);
    return cachedData;
  }

  console.log(`Cache miss for strikes data: ${cacheKey}, fetching from API`);

  // Load previous streak data for comparison
  const previousStore = await new Promise((resolve) => {
    chrome.storage.local.get([PREVIOUS_STREAKS_KEY, PREVIOUS_STREAK_DATES_KEY], resolve);
  });
  const previousStreaks = previousStore[PREVIOUS_STREAKS_KEY] || {};
  const previousStreakDates = previousStore[PREVIOUS_STREAK_DATES_KEY] || {};

  let strikesUsers = [];
  let clearedStrikesUsers = [];
  let streaksUsers = [];

  // Every user's final streak, so the saved values can be updated from the
  // computed state rather than from the display lists.
  const streakByUser = new Map();

  // Fetch every user's submissions + avatar in bounded parallel, then process
  // them sequentially below so the storage merges stay race-free.
  const userDataList = await mapLimit(allUsers, 4, async (user) => {
    const submissions = await getACSubmissions(user, 30);
    const userData = await getUserProfilePic(user);
    return { user, submissions, avatar: userData.userAvatar };
  });

  // Check each user
  for (const { user, submissions, avatar } of userDataList) {
    // The immutable activity log decides which days count as active
    const activityLog = await getUserActivityLog(user);
    const isActiveDaysAgo = createDayActivityChecker(submissions, activityLog, timezone);

    const {
      streakCount,
      strikeCount,
      clearsToday,
      solvedYesterday,
      clearingSubmission,
      lastProblemDate,
      streakThroughDate,
    } = computeStreakState({
      submissions,
      timezone,
      maxStrikes,
      previousStreak: previousStreaks[user] || 0,
      previousStreakDate: previousStreakDates[user] || null,
      activityLog,
    });

    streakByUser.set(user, { streakCount, streakThroughDate });

    // Record today's activity for tomorrow's calculation
    if (clearsToday) {
      await recordDailyActivity(user, timezone);
    }

    // Add to appropriate list
    if (strikeCount > 0) {
      // User has current strikes
      strikesUsers.push({
        username: user,
        avatar,
        strikes: strikeCount,
        clearsToday: clearsToday,
        clearingSubmission: clearingSubmission,
      });
    } else if (solvedYesterday) {
      // User solved yesterday and has no current strikes. They cleared their
      // strikes only if the day before yesterday was a miss.
      if (!isActiveDaysAgo(2)) {
        clearedStrikesUsers.push({
          username: user,
          avatar,
          clearedStrikes: true,
        });
      }
    }

    // Add to streaks list if streak is 2 or more days
    if (streakCount >= 2) {
      streaksUsers.push({
        username: user,
        avatar,
        streak: streakCount,
        lastProblemDate: lastProblemDate,
      });
    }
  }

  // Sort by strikes descending (most strikes first)
  strikesUsers.sort((a, b) => b.strikes - a.strikes);

  // Sort streaks by streak count descending (longest streak first)
  streaksUsers.sort((a, b) => b.streak - a.streak);

  const result = { strikesUsers, clearedStrikesUsers, streaksUsers };

  // Save the computed streak and the day it counts through, so a later run can
  // extend it by at most one day instead of re-applying its repair (which
  // inflated the streak on every recomputation). Merge onto the existing maps
  // so a partial run (e.g. only the current user, from the background worker)
  // does not wipe out the saved streaks of other users.
  const newPreviousStreaks = { ...previousStreaks };
  const newPreviousStreakDates = { ...previousStreakDates };

  allUsers.forEach((user) => {
    const { streakCount, streakThroughDate } = streakByUser.get(user);
    newPreviousStreaks[user] = streakCount;

    if (streakCount > 0) {
      newPreviousStreakDates[user] = streakThroughDate;
    } else {
      delete newPreviousStreakDates[user];
    }
  });

  try {
    await new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [PREVIOUS_STREAKS_KEY]: newPreviousStreaks,
          [PREVIOUS_STREAK_DATES_KEY]: newPreviousStreakDates,
        },
        () => {
          console.log('[Streak Fix] Saved current streaks for future comparison');
          resolve();
        }
      );
    });
  } catch (error) {
    console.error('Error saving previous streaks:', error);
  }

  // Calculate TTL: 10 minutes, but not past midnight in the user's timezone
  const ttlUntilMidnight = getTTLUntilMidnight(timezone);
  const ttl = Math.min(TTL.SUBMISSIONS, ttlUntilMidnight);

  // Cache the result
  await cache.set(cacheKey, result, ttl);

  return result;
}
