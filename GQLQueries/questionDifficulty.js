import cache, { TTL } from '../utils/cache.js';
import { gqlRequest } from '../utils/gqlClient.js';

/**
 * Fetches a problem's metadata (difficulty, title, ...). Difficulty never
 * changes, so the result is cached long-lived and shared across every feature
 * that needs it — this is what stops the Activity feed (and the filter box)
 * from refetching the same problems on every render.
 * @param {string} titleSlug
 * @returns {Promise<object|null>}
 */
const questionDifficulty = async (titleSlug) => {
    return cache.remember(`difficulty_${titleSlug}`, TTL.PROBLEM_DIFFICULTY, async () => {
        const query = `
    query questionTitle($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
                questionId
                questionFrontendId
                title
                titleSlug
                isPaidOnly
                difficulty
                likes
                dislikes
                categoryTitle
            }
        }`;

        const variables = {
            titleSlug
        };

        const data = await gqlRequest(query, variables);
        return data.data.question;
    });
};

export default questionDifficulty;
