import cache, { TTL, getTTLUntilMidnight } from './cache.js';
import getACSubmissions from '../GQLQueries/recentACSubmissions.js';
import getUserProfilePic from '../GQLQueries/getUserProfilePic.js';
import { getLocalDateString, getTodayInTimezone } from './timezoneHelper.js';

/**
 *  Helper function to filter submissions from today in specified timezone
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago")
 * @returns {boolean} - True if timestamp is from today in the specified timezone
 */
function isToday(timestamp, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);
  const todayDate = getTodayInTimezone(timezone);
  return submissionDate === todayDate;
}

/**
 * Helper function to check if a timestamp is from yesterday in specified timezone
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago")
 * @returns {boolean} - True if timestamp is from yesterday
 */
function isYesterday(timestamp, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);

  // Get yesterday's date in the specified timezone
  const todayStr = getTodayInTimezone(timezone);
  const todayParts = todayStr.split('-');
  const todayInTZ = new Date(Date.UTC(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2])));
  todayInTZ.setUTCDate(todayInTZ.getUTCDate() - 1);

  const yesterdayStr = todayInTZ.toISOString().split('T')[0];

  return submissionDate === yesterdayStr;
}

/**
 * Helper function to check if a timestamp is from a specific day offset in specified timezone
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {number} daysAgo - Number of days before today (0 = today, 1 = yesterday, etc.)
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago")
 * @returns {boolean} - True if timestamp is from the specified day
 */
function isDaysAgo(timestamp, daysAgo, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);

  // Get the target date (daysAgo from today) in the specified timezone
  const todayStr = getTodayInTimezone(timezone);
  const todayParts = todayStr.split('-');
  const targetDate = new Date(Date.UTC(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2])));
  targetDate.setUTCDate(targetDate.getUTCDate() - daysAgo);

  const targetDateStr = targetDate.toISOString().split('T')[0];

  return submissionDate === targetDateStr;
}

/**
 * Get daily activity log for a user
 * Returns whether they solved yesterday based on immutable daily records
 */
async function getDailyActivityLog(username, timezone) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['dailyActivityLog'], (result) => {
      const log = result.dailyActivityLog || {};
      const yesterdayStr = getYesterdayInTimezone(timezone);

      const userLog = log[username] || {};
      const solvedYesterday = userLog[yesterdayStr] === true;

      resolve({ solvedYesterday });
    });
  });
}

/**
 * Record that a user solved a problem today
 * This creates an immutable record that won't change even if they re-solve
 */
async function recordDailyActivity(username, timezone) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['dailyActivityLog'], (result) => {
      const log = result.dailyActivityLog || {};
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

        chrome.storage.local.set({ dailyActivityLog: log }, () => {
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
 * Get yesterday's date string in the specified timezone
 */
function getYesterdayInTimezone(timezone) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Format as YYYY-MM-DD in the specified timezone
  const dateStr = yesterday.toLocaleDateString('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return dateStr;
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
  const previousStreaksKey = 'previousStreaks';
  let previousStreaks = {};
  try {
    const storedData = await new Promise((resolve) => {
      chrome.storage.local.get([previousStreaksKey], (result) => {
        resolve(result[previousStreaksKey] || {});
      });
    });
    previousStreaks = storedData;
  } catch (error) {
    console.error('Error loading previous streaks:', error);
  }

  let strikesUsers = [];
  let clearedStrikesUsers = [];
  let streaksUsers = [];

  // Check each user
  for (const user of allUsers) {
    const submissions = await getACSubmissions(user, 30);

    // Check if user solved a problem today
    const todaySubmissions = submissions.filter((submission) => isToday(submission.timestamp, timezone));
    const clearsToday = todaySubmissions.length > 0;
    // Get the most recent submission from today (if any)
    const clearingSubmission = clearsToday ? todaySubmissions[0] : null;

    const userData = await getUserProfilePic(user);

    // Calculate streak FIRST - consecutive days with submissions
    let streakCount = 0;
    let lastProblemDate = null;
    let startDay = clearsToday ? 0 : 1; // Start from today if solved today, else yesterday

    for (let daysAgo = startDay; daysAgo < 30; daysAgo++) {
      const daySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, daysAgo, timezone));

      if (daySubmissions.length > 0) {
        streakCount++;
        // Capture the last problem date (most recent in the streak)
        if (lastProblemDate === null && daySubmissions.length > 0) {
          lastProblemDate = getLocalDateString(daySubmissions[0].timestamp, timezone);
        }
      } else {
        // Streak broken
        break;
      }
    }

    // Detect impossible streak drops (caused by re-solved problems changing dates)
    const previousStreak = previousStreaks[user] || 0;

    if (streakCount > 0 && previousStreak > streakCount) {
      // Streak dropped but didn't reset to 0 - this is impossible naturally
      // A real streak can only: stay same, increase by 1, or drop to 0
      // This means LeetCode API moved an old problem to today, creating a gap
      console.log(`[Streak Fix] ${user}: Detected impossible drop from ${previousStreak} to ${streakCount}`);

      if (clearsToday) {
        // They solved today, so streak should have increased
        streakCount = previousStreak + 1;
        console.log(`[Streak Fix] ${user}: Restored to ${streakCount} (previous + 1)`);
      } else {
        // They didn't solve today, maintain previous streak
        streakCount = previousStreak;
        console.log(`[Streak Fix] ${user}: Restored to ${streakCount} (maintained)`);
      }
    }

    // Count consecutive days starting from yesterday (up to maxStrikes days)
    let strikeCount = 0;
    for (let daysAgo = 1; daysAgo <= maxStrikes; daysAgo++) {
      const daySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, daysAgo, timezone));

      // If no submissions for this day, increment strike
      if (daySubmissions.length === 0) {
        strikeCount++;
      } else {
        // Stop counting if user was active (consecutive streak broken)
        break;
      }
    }

    // Check if user solved yesterday
    const yesterdaySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, 1, timezone));
    let solvedYesterday = yesterdaySubmissions.length > 0;

    // ACTIVITY LOG: Check if user actually solved yesterday (before any re-solves)
    // This is an immutable record set when they first solved, can't be changed by re-solves
    const activityLog = await getDailyActivityLog(user, timezone);
    const actuallysolvedYesterday = activityLog.solvedYesterday;

    // STRIKE FIX: Use activity log to determine real vs false strikes
    if (!solvedYesterday && actuallysolvedYesterday && clearsToday) {
      // Activity log says they solved yesterday, but LeetCode API doesn't show it
      // This means they re-solved that problem today (moved the date)
      console.log(`[Strike Fix] ${user}: Activity log confirms solved yesterday, clearing false strike`);
      solvedYesterday = true;
      strikeCount = 0;
    } else if (!solvedYesterday && !actuallysolvedYesterday && previousStreak > 0) {
      // They genuinely missed yesterday - this is a real strike
      console.log(`[Strike Fix] ${user}: Genuine miss yesterday (had ${previousStreak}-day streak)`);
    }

    // Record today's activity for tomorrow's calculation
    if (clearsToday) {
      await recordDailyActivity(user, timezone);
    }

    // Add to appropriate list
    if (strikeCount > 0) {
      // User has current strikes
      strikesUsers.push({
        username: user,
        avatar: userData.userAvatar,
        strikes: strikeCount,
        clearsToday: clearsToday,
        clearingSubmission: clearingSubmission,
      });
    } else if (solvedYesterday) {
      // User solved yesterday and has no current strikes
      // Check if they would have had strikes if they didn't solve yesterday
      // by checking if they have any missing days from day 2 onwards
      let wouldHaveHadStrikes = false;
      for (let daysAgo = 2; daysAgo <= maxStrikes + 1; daysAgo++) {
        const daySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, daysAgo, timezone));
        if (daySubmissions.length === 0) {
          // Found a gap - this means they would have had strikes
          wouldHaveHadStrikes = true;
          break;
        } else {
          // Found a submission - streak was broken, so no previous strikes
          break;
        }
      }

      // Only add to cleared list if they actually cleared strikes
      if (wouldHaveHadStrikes) {
        clearedStrikesUsers.push({
          username: user,
          avatar: userData.userAvatar,
          clearedStrikes: true,
        });
      }
    }

    // Add to streaks list if streak is 2 or more days
    if (streakCount >= 2) {
      streaksUsers.push({
        username: user,
        avatar: userData.userAvatar,
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

  // Save current streaks for future comparison. Merge onto the existing map so a
  // partial run (e.g. only the current user, from the background worker) does not
  // wipe out the saved streaks of other users.
  const newPreviousStreaks = { ...previousStreaks };
  streaksUsers.forEach((user) => {
    newPreviousStreaks[user.username] = user.streak;
  });
  // Also save users with no streaks as 0
  allUsers.forEach((user) => {
    if (!newPreviousStreaks[user]) {
      newPreviousStreaks[user] = 0;
    }
  });

  try {
    await new Promise((resolve) => {
      chrome.storage.local.set({ [previousStreaksKey]: newPreviousStreaks }, () => {
        console.log('[Streak Fix] Saved current streaks for future comparison');
        resolve();
      });
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
