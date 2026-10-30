import cache, { TTL } from '../utils/cache.js';
import { gqlRequest } from '../utils/gqlClient.js';

const getUserProblemStats = async (username) => {
    return cache.remember(`user_stats_${username}`, TTL.USER_STATS, async () => {
        const query = `
    query getUserProfile($username: String!) {
        matchedUser(username: $username) {
            submitStats {
                acSubmissionNum {
                    difficulty
                    count
                    submissions
                }
            }
        }
    }`;

        const variables = {
            username
        };

        const data = await gqlRequest(query, variables);

        data.data.matchedUser.submitStats.username = username;

        return data.data.matchedUser.submitStats;
    });
};

export default getUserProblemStats;
