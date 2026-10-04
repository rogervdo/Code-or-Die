import cache, { TTL } from '../utils/cache.js';

/**
 * Fetches a user's submission calendar, the same data source behind LeetCode's
 * profile activity heatmap. `submissionCalendar` is a JSON string mapping a
 * Unix timestamp (seconds, UTC midnight of each day) to that day's submission
 * count.
 * @param {string} username - LeetCode username
 * @returns {Promise<object>} - { streak, totalActiveDays, activeYears, submissionCalendar }
 */
const getUserCalendar = async (username) => {
  const cacheKey = `user_calendar_${username}`;
  const cachedData = await cache.get(cacheKey);

  if (cachedData !== null) {
    console.log(`Cache hit for user calendar: ${username}`);
    return cachedData;
  }

  console.log(`Cache miss for user calendar: ${username}, fetching from API`);

  const query = `
    query userProfileCalendar($username: String!) {
        matchedUser(username: $username) {
            userCalendar {
                activeYears
                streak
                totalActiveDays
                submissionCalendar
            }
        }
    }`;

  const variables = {
    username,
  };

  try {
    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(result.errors.map((error) => error.message).join(', '));
    }

    const calendar = result.data?.matchedUser?.userCalendar;
    if (!calendar) {
      return { streak: 0, totalActiveDays: 0, activeYears: [], submissionCalendar: {} };
    }

    let submissionCalendar = {};
    try {
      submissionCalendar = JSON.parse(calendar.submissionCalendar || '{}');
    } catch (error) {
      console.error('Error parsing submission calendar:', error);
    }

    const data = {
      streak: calendar.streak ?? 0,
      totalActiveDays: calendar.totalActiveDays ?? 0,
      activeYears: calendar.activeYears ?? [],
      submissionCalendar,
    };

    // Cache the result with 1-hour TTL, matching user stats
    await cache.set(cacheKey, data, TTL.USER_STATS);

    return data;
  } catch (error) {
    console.error('Error fetching user calendar:', error);
    return { streak: 0, totalActiveDays: 0, activeYears: [], submissionCalendar: {} };
  }
};

export default getUserCalendar;
