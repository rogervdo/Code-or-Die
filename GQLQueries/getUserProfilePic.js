import cache, { TTL } from '../utils/cache.js';
import { gqlRequest } from '../utils/gqlClient.js';

const getUserProfilePic = async (username) => {
    return cache.remember(`profile_pic_${username}`, TTL.PROFILE_PIC, async () => {
        const query = `
    query userPublicProfile($username: String!) {
        matchedUser(username: $username) {
            profile {
                userAvatar
            }
        }
    }`;

        const variables = {
            username
        };

        const data = await gqlRequest(query, variables);

        if (data.data.matchedUser === null) {
            return null;
        }

        return data.data.matchedUser.profile;
    });
};

export default getUserProfilePic;
