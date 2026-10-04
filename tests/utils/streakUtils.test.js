import { describe, it, expect, vi, beforeEach } from 'vitest';
import getACSubmissions from '../../GQLQueries/recentACSubmissions.js';
import getUserProfilePic from '../../GQLQueries/getUserProfilePic.js';
import { loadStrikesUsersData } from '../../utils/streakUtils.js';

vi.mock('../../GQLQueries/recentACSubmissions.js', () => ({ default: vi.fn() }));
vi.mock('../../GQLQueries/getUserProfilePic.js', () => ({ default: vi.fn() }));

const rawGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));

// A submission from long ago, so no day in the window counts as activity.
const OLD_TS = 1;

describe('loadStrikesUsersData', () => {
  beforeEach(() => {
    getACSubmissions.mockImplementation(async () => [{ timestamp: OLD_TS, title: 'Two Sum', titleSlug: 'two-sum' }]);
    getUserProfilePic.mockImplementation(async () => ({ userAvatar: 'avatar.png' }));
  });

  it('preserves saved streaks for users not included in a partial run', async () => {
    await chrome.storage.local.set({ previousStreaks: { friend: 5, me: 0 } });

    // Mirrors the background worker, which loads only the current user.
    await loadStrikesUsersData([], 'me', 3, 'UTC');

    const { previousStreaks } = await rawGet(['previousStreaks']);
    expect(previousStreaks.friend).toBe(5);
    expect(previousStreaks.me).toBe(0);
  });

  it('returns strikes, cleared strikes, and streaks arrays', async () => {
    const result = await loadStrikesUsersData([], 'me', 3, 'UTC');

    expect(result).toEqual({
      strikesUsers: expect.any(Array),
      clearedStrikesUsers: expect.any(Array),
      streaksUsers: expect.any(Array),
    });
  });
});
