import { describe, it, expect } from 'vitest';
import { removeFriendData, getUserCacheKeys } from '../../utils/friendData.js';
import { WEEKLY_SUBMISSIONS_STORE_KEY } from '../../utils/contestUtils.js';

const setStorage = (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve));
const getStorage = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));

async function seed() {
  await setStorage({
    username: 'me',
    friends: ['alice', 'bob', 'bobby'],

    // TTL cache entries (note: "bobby" shares a prefix with "bob")
    cache_profile_pic_bob: { value: 'x' },
    cache_user_stats_bob: { value: 'x' },
    cache_submissions_bob_5: { value: 'x' },
    cache_submissions_bob_20: { value: 'x' },
    cache_submissions_bob_30: { value: 'x' },
    cache_submissions_bob_50: { value: 'x' },
    cache_problem_ranking_bob: { value: 'x' },
    cache_profile_pic_alice: { value: 'x' },
    cache_submissions_alice_20: { value: 'x' },
    cache_profile_pic_bobby: { value: 'x' },
    cache_submissions_bobby_20: { value: 'x' },

    // Derived / persisted stores
    [WEEKLY_SUBMISSIONS_STORE_KEY]: {
      alice: { weekStart: '2024-06-17', submissions: [{ titleSlug: 'a', timestamp: 1 }] },
      bob: { weekStart: '2024-06-17', submissions: [{ titleSlug: 'b', timestamp: 2 }] },
      bobby: { weekStart: '2024-06-17', submissions: [{ titleSlug: 'c', timestamp: 3 }] },
    },
    previousStreaks: { alice: 2, bob: 5, bobby: 1 },
    dailyActivityLog: {
      alice: { '2024-06-18': true },
      bob: { '2024-06-18': true },
    },
    problemRankSnapshots: {
      lastViewed: { alice: 100, bob: 200, bobby: 300 },
      byDate: {
        alice: { '2024-06-18': 100 },
        bob: { '2024-06-18': 200 },
        bobby: { '2024-06-18': 300 },
      },
    },
  });
}

describe('getUserCacheKeys', () => {
  it('matches a user exactly and never a longer name sharing a prefix', () => {
    const keys = [
      'cache_profile_pic_bob',
      'cache_user_stats_bob',
      'cache_submissions_bob_20',
      'cache_problem_ranking_bob',
      'cache_profile_pic_bobby',
      'cache_submissions_bobby_20',
      'username',
    ];

    expect(getUserCacheKeys(keys, 'bob').sort()).toEqual(
      [
        'cache_profile_pic_bob',
        'cache_user_stats_bob',
        'cache_submissions_bob_20',
        'cache_problem_ranking_bob',
      ].sort()
    );
  });
});

describe('removeFriendData', () => {
  it('removes every cache entry for the friend', async () => {
    await seed();
    await removeFriendData('bob');

    const all = await getStorage(null);
    for (const key of [
      'cache_profile_pic_bob',
      'cache_user_stats_bob',
      'cache_submissions_bob_5',
      'cache_submissions_bob_20',
      'cache_submissions_bob_30',
      'cache_submissions_bob_50',
      'cache_problem_ranking_bob',
    ]) {
      expect(all[key], key).toBeUndefined();
    }
  });

  it('removes the friend from weekly submissions, streaks, activity log, and rank snapshots', async () => {
    await seed();
    await removeFriendData('bob');

    const all = await getStorage(null);

    expect(all[WEEKLY_SUBMISSIONS_STORE_KEY].bob).toBeUndefined();
    expect(all.previousStreaks.bob).toBeUndefined();
    expect(all.dailyActivityLog.bob).toBeUndefined();
    expect(all.problemRankSnapshots.lastViewed.bob).toBeUndefined();
    expect(all.problemRankSnapshots.byDate.bob).toBeUndefined();
  });

  it('leaves other friends (including prefix-collision names) untouched', async () => {
    await seed();
    await removeFriendData('bob');

    const all = await getStorage(null);

    expect(all.cache_profile_pic_alice).toBeDefined();
    expect(all.cache_submissions_alice_20).toBeDefined();
    expect(all.cache_profile_pic_bobby).toBeDefined();
    expect(all.cache_submissions_bobby_20).toBeDefined();

    expect(all[WEEKLY_SUBMISSIONS_STORE_KEY].alice).toBeDefined();
    expect(all[WEEKLY_SUBMISSIONS_STORE_KEY].bobby).toBeDefined();
    expect(all.previousStreaks.alice).toBe(2);
    expect(all.previousStreaks.bobby).toBe(1);
    expect(all.dailyActivityLog.alice).toBeDefined();
    expect(all.problemRankSnapshots.lastViewed.alice).toBe(100);
    expect(all.problemRankSnapshots.byDate.bobby).toBeDefined();
  });

  it('leaves global keys untouched', async () => {
    await seed();
    await removeFriendData('bob');

    const all = await getStorage(null);
    expect(all.username).toBe('me');
    expect(all.friends).toEqual(['alice', 'bob', 'bobby']);
  });

  it('is a no-op for a user with no records', async () => {
    await seed();

    await expect(removeFriendData('ghost')).resolves.toBeUndefined();

    const all = await getStorage(null);
    expect(all.cache_profile_pic_bob).toBeDefined();
    expect(all.previousStreaks.bob).toBe(5);
    expect(all[WEEKLY_SUBMISSIONS_STORE_KEY].bob).toBeDefined();
  });

  it('ignores an empty username', async () => {
    await expect(removeFriendData('')).resolves.toBeUndefined();
  });
});
