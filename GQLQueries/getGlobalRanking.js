import cache, { TTL } from '../utils/cache.js';
import { gqlRequest } from '../utils/gqlClient.js';

const getGlobalRanking = async (username) => {
  return cache.remember(`problem_ranking_${username}`, TTL.GLOBAL_RANKING, async () => {
    const query = `
    query getUserProblemRanking($username: String!) {
      matchedUser(username: $username) {
        username
        profile {
          ranking
        }
      }
    }`;

    const data = await gqlRequest(query, { username });
    const profile = data.data?.matchedUser?.profile ?? null;

    return {
      username,
      problemRank: profile?.ranking ?? null,
    };
  });
};

export default getGlobalRanking;
