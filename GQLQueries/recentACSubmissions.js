import cache, { TTL } from '../utils/cache.js';
import { gqlRequest } from '../utils/gqlClient.js';

// One shared cache entry serves the Activity (5), Contest (20) and Streaks (30)
// views instead of three separate requests per user, so we always fetch the
// largest window any caller needs and slice per caller. LeetCode caps
// recentAcSubmissionList at 20 in practice, which makes this a no-op there.
const MAX_LIMIT = 30;

const getACSubmissions = async (username, limit = MAX_LIMIT) => {
  const cacheKey = `submissions_${username}`;

  let submissions;
  try {
    submissions = await cache.remember(cacheKey, TTL.SUBMISSIONS, async () => {
      const query = `query getACSubmissions ($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) {
            title
            titleSlug
            timestamp
            statusDisplay
            lang
        }
    }`;

      const result = await gqlRequest(query, { username, limit: MAX_LIMIT });

      if (result.errors) {
        throw new Error(result.errors.map((error) => error.message).join(', '));
      }

      return result.data.recentAcSubmissionList.map((submission) => ({
        ...submission,
        username,
      }));
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    return [];
  }

  if (typeof limit === 'number' && limit < submissions.length) {
    return submissions.slice(0, limit);
  }

  // Copy, so callers that sort in place can't mutate the cached list.
  return [...submissions];
};

export default getACSubmissions;
