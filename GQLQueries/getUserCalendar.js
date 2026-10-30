import cache, { TTL } from '../utils/cache.js';
import { gqlRequest } from '../utils/gqlClient.js';

const EMPTY_CALENDAR = { streak: 0, totalActiveDays: 0, activeYears: [], submissionCalendar: {} };

/**
 * Fetches a user's submission calendar, the same data source behind LeetCode's
 * profile activity heatmap. `submissionCalendar` is a JSON string mapping a
 * Unix timestamp (seconds, UTC midnight of each day) to that day's submission
 * count.
 * @param {string} username - LeetCode username
 * @returns {Promise<object>} - { streak, totalActiveDays, activeYears, submissionCalendar }
 */
const getUserCalendar = async (username) => {
  try {
    return await cache.remember(`user_calendar_${username}`, TTL.USER_STATS, async () => {
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

      const result = await gqlRequest(query, { username });

      if (result.errors) {
        throw new Error(result.errors.map((error) => error.message).join(', '));
      }

      const calendar = result.data?.matchedUser?.userCalendar;
      if (!calendar) {
        return { ...EMPTY_CALENDAR };
      }

      let submissionCalendar = {};
      try {
        submissionCalendar = JSON.parse(calendar.submissionCalendar || '{}');
      } catch (error) {
        console.error('Error parsing submission calendar:', error);
      }

      return {
        streak: calendar.streak ?? 0,
        totalActiveDays: calendar.totalActiveDays ?? 0,
        activeYears: calendar.activeYears ?? [],
        submissionCalendar,
      };
    });
  } catch (error) {
    console.error('Error fetching user calendar:', error);
    return { ...EMPTY_CALENDAR };
  }
};

export default getUserCalendar;
