import { describe, it, expect, vi, beforeEach } from 'vitest';
import getACSubmissions from '../../GQLQueries/recentACSubmissions.js';
import getUserProfilePic from '../../GQLQueries/getUserProfilePic.js';
import { computeStreakState, loadStrikesUsersData } from '../../utils/streakUtils.js';
import cache from '../../utils/cache.js';

vi.mock('../../GQLQueries/recentACSubmissions.js', () => ({ default: vi.fn() }));
vi.mock('../../GQLQueries/getUserProfilePic.js', () => ({ default: vi.fn() }));

// The clock is frozen for every test so "today" never depends on when the
// suite runs, and so the year/DST boundary tests can move it deliberately.
const NOW_MS = Date.parse('2026-06-15T12:00:00Z');
const TZ = 'UTC';
const TODAY = '2026-06-15';

const rawGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const rawSet = (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve));

/** YYYY-MM-DD for `daysAgo` days before `base`, walked in UTC like the app does. */
function dateStr(daysAgo, base = TODAY) {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

const dateOf = (daysAgo) => dateStr(daysAgo);

const atNoonUtc = (dateString) => Math.floor(Date.parse(`${dateString}T12:00:00Z`) / 1000);

/** A submission on the day `daysAgo` before today, at noon UTC. */
const submission = (daysAgo, titleSlug = `problem-${daysAgo}`) => ({
  titleSlug,
  timestamp: atNoonUtc(dateStr(daysAgo)),
});

/** A submission on an explicit date, at noon UTC. */
const submissionOn = (dateString, titleSlug = `problem-${dateString}`) => ({
  titleSlug,
  timestamp: atNoonUtc(dateString),
});

const solvedOn = (...days) => days.map((day) => submission(day));

const state = (submissions, overrides = {}) =>
  computeStreakState({ submissions, timezone: TZ, maxStrikes: 3, ...overrides });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);

  getACSubmissions.mockReset();
  getUserProfilePic.mockReset();
  getACSubmissions.mockImplementation(async () => []);
  getUserProfilePic.mockImplementation(async (username) => ({ userAvatar: `${username}.png` }));
});

describe('computeStreakState', () => {
  it('counts consecutive days ending today', () => {
    const result = state(solvedOn(0, 1, 2));

    expect(result.streakCount).toBe(3);
    expect(result.clearsToday).toBe(true);
    expect(result.solvedYesterday).toBe(true);
    expect(result.strikeCount).toBe(0);
    expect(result.lastProblemDate).toBe(dateOf(0));
    expect(result.streakThroughDate).toBe(TODAY);
  });

  it('starts the streak at yesterday when today has no submissions', () => {
    const result = state(solvedOn(1, 2));

    expect(result.streakCount).toBe(2);
    expect(result.clearsToday).toBe(false);
    expect(result.solvedYesterday).toBe(true);
    expect(result.strikeCount).toBe(0);
    expect(result.lastProblemDate).toBe(dateOf(1));
    expect(result.streakThroughDate).toBe(dateOf(1));
  });

  it('stops the streak at the first missing day', () => {
    expect(state(solvedOn(0, 1, 3)).streakCount).toBe(2);
  });

  it('ignores days older than a break', () => {
    expect(state(solvedOn(0, 5, 6)).streakCount).toBe(1);
  });

  it('counts strikes back from yesterday', () => {
    const result = state(solvedOn(5));

    expect(result.strikeCount).toBe(3);
    expect(result.clearsToday).toBe(false);
    expect(result.solvedYesterday).toBe(false);
  });

  it('stops counting strikes at the first active day', () => {
    expect(state(solvedOn(2)).strikeCount).toBe(1);
  });

  it('caps strikes at maxStrikes', () => {
    expect(state([]).strikeCount).toBe(3);
    expect(state([], { maxStrikes: 5 }).strikeCount).toBe(5);
  });

  it('counts a full 30-day window', () => {
    const everyDay = Array.from({ length: 30 }, (_, index) => index);
    expect(state(solvedOn(...everyDay)).streakCount).toBe(30);
  });

  it('caps the day scan at the 60-day window', () => {
    const everyDay = Array.from({ length: 80 }, (_, index) => index);
    expect(state(solvedOn(...everyDay)).streakCount).toBe(60);
  });

  it('reports the most recent submission from today as the clearing submission', () => {
    const first = submission(0, 'first');
    const second = submission(0, 'second');

    expect(state([first, second]).clearingSubmission).toBe(first);
  });

  it('reports no clearing submission and no through-date when the streak is zero', () => {
    const result = state(solvedOn(10));

    expect(result.streakCount).toBe(0);
    expect(result.clearsToday).toBe(false);
    expect(result.clearingSubmission).toBeNull();
    expect(result.streakThroughDate).toBeNull();
  });
});

describe('computeStreakState saved-streak repair', () => {
  /** A day heavy enough to push every earlier submission out of LeetCode's 20-entry window. */
  const heavyDay = Array.from({ length: 20 }, (_, index) => submission(0, `heavy-${index}`));

  it('grows a saved streak that ended yesterday by exactly one', () => {
    expect(state(solvedOn(0), { previousStreak: 7, previousStreakDate: dateOf(1) }).streakCount).toBe(8);
  });

  it('maintains a saved streak that ended yesterday when they have not solved today', () => {
    expect(state(solvedOn(1, 2), { previousStreak: 7, previousStreakDate: dateOf(1) }).streakCount).toBe(7);
  });

  it('does not grow a saved streak that already counts through today', () => {
    const result = state(heavyDay, { previousStreak: 8, previousStreakDate: TODAY });
    expect(result.streakCount).toBe(8);
    expect(result.streakThroughDate).toBe(TODAY);
  });

  it('restores a streak the API window no longer reaches', () => {
    expect(state(heavyDay, { previousStreak: 9, previousStreakDate: dateOf(1) }).streakCount).toBe(10);
  });

  it('keeps the streak stable when the same day is recomputed over and over', () => {
    // The reported bug: every recomputation saw a deficit and added a day, so
    // opening the popup repeatedly pushed the streak up several times a day.
    let previousStreak = 9;
    let previousStreakDate = dateOf(1);

    for (let run = 0; run < 5; run++) {
      const result = state(heavyDay, { previousStreak, previousStreakDate });
      expect(result.streakCount, `run ${run + 1}`).toBe(10);

      previousStreak = result.streakCount;
      previousStreakDate = result.streakThroughDate;
    }
  });

  it('ignores a saved streak whose last day is older than yesterday', () => {
    expect(state(solvedOn(0), { previousStreak: 12, previousStreakDate: dateOf(5) }).streakCount).toBe(1);
  });

  it('ignores a saved streak with no recorded date', () => {
    expect(state(solvedOn(0), { previousStreak: 12 }).streakCount).toBe(1);
  });

  it('ignores a saved streak dated in the future', () => {
    expect(state(solvedOn(0), { previousStreak: 12, previousStreakDate: dateOf(-1) }).streakCount).toBe(1);
  });

  it('still allows a streak to reset to zero', () => {
    const result = state(solvedOn(10), { previousStreak: 7, previousStreakDate: dateOf(1) });

    expect(result.streakCount).toBe(0);
    expect(result.streakThroughDate).toBeNull();
  });

  it('extends a saved streak past the day-scan window', () => {
    const result = state(solvedOn(0, 1), { previousStreak: 100, previousStreakDate: dateOf(1) });

    expect(result.streakCount).toBe(101);
    expect(result.streakThroughDate).toBe(TODAY);
  });

  it('is unchanged when the extended result is fed back in', () => {
    const first = state(solvedOn(0, 1), { previousStreak: 100, previousStreakDate: dateOf(1) });
    const second = state(solvedOn(0, 1), {
      previousStreak: first.streakCount,
      previousStreakDate: first.streakThroughDate,
    });

    expect(second.streakCount).toBe(first.streakCount);
    expect(second.streakThroughDate).toBe(first.streakThroughDate);
  });
});

describe('computeStreakState activity log', () => {
  it('bridges a day the API dropped from the middle of a streak', () => {
    const result = state(solvedOn(0, 3), {
      activityLog: { [dateOf(1)]: true, [dateOf(2)]: true },
    });

    expect(result.streakCount).toBe(4);
    expect(result.strikeCount).toBe(0);
  });

  it('counts a day the log recorded even when the API has no submission for it', () => {
    const result = state(solvedOn(1, 2), { activityLog: { [TODAY]: true } });

    expect(result.streakCount).toBe(3);
    expect(result.clearsToday).toBe(false);
    expect(result.solvedYesterday).toBe(true);
    expect(result.strikeCount).toBe(0);
    expect(result.streakThroughDate).toBe(TODAY);
  });

  it('clears a false strike when the activity log confirms yesterday', () => {
    const result = state(solvedOn(0), { activityLog: { [dateOf(1)]: true } });

    expect(result.strikeCount).toBe(0);
    expect(result.solvedYesterday).toBe(true);
    expect(result.streakCount).toBe(2);
  });

  it('clears the strike even when today has no submissions', () => {
    const result = state([], { activityLog: { [dateOf(1)]: true, [TODAY]: true } });

    expect(result.solvedYesterday).toBe(true);
    expect(result.strikeCount).toBe(0);
    expect(result.streakCount).toBe(2);
  });

  it('keeps the strike when the log has no record of yesterday', () => {
    const result = state(solvedOn(0));

    expect(result.strikeCount).toBe(3);
    expect(result.solvedYesterday).toBe(false);
  });

  it('does not treat a falsy log entry as activity', () => {
    const result = state(solvedOn(0), { activityLog: { [dateOf(1)]: false } });

    expect(result.solvedYesterday).toBe(false);
    expect(result.strikeCount).toBe(3);
  });

  it('does not count a log entry that is not an exact date match', () => {
    const result = state(solvedOn(0), { activityLog: { [TODAY]: true } });

    expect(result.streakCount).toBe(1);
    expect(result.strikeCount).toBe(3);
  });
});

describe('computeStreakState timezone boundaries', () => {
  it('counts across a year boundary', () => {
    vi.setSystemTime(Date.parse('2026-01-01T12:00:00Z'));

    const submissions = ['2025-12-30', '2025-12-31', '2026-01-01'].map((date) => submissionOn(date));
    const result = state(submissions, { previousStreak: 2, previousStreakDate: '2025-12-31' });

    expect(result.streakCount).toBe(3);
    expect(result.lastProblemDate).toBe('2026-01-01');
    expect(result.streakThroughDate).toBe('2026-01-01');
  });

  it('counts a streak across a DST transition', () => {
    // US DST began on 2026-03-08; the day walk must not skip or repeat a day.
    vi.setSystemTime(Date.parse('2026-03-09T12:00:00Z'));

    const submissions = ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'].map((date) =>
      submissionOn(date)
    );
    const result = computeStreakState({ submissions, timezone: 'America/Chicago', maxStrikes: 3 });

    expect(result.streakCount).toBe(4);
    expect(result.clearsToday).toBe(true);
    expect(result.lastProblemDate).toBe('2026-03-09');
  });

  it('assigns a submission to the local day, not the UTC day', () => {
    // 2026-06-16T04:30Z is 23:30 on 2026-06-15 in Chicago.
    const lateNight = {
      titleSlug: 'late',
      timestamp: Math.floor(Date.parse('2026-06-16T04:30:00Z') / 1000),
    };
    const result = computeStreakState({ submissions: [lateNight], timezone: 'America/Chicago', maxStrikes: 3 });

    expect(result.clearsToday).toBe(true);
    expect(result.streakCount).toBe(1);
    expect(result.streakThroughDate).toBe('2026-06-15');
  });

  it('treats a UTC-morning submission as yesterday when it is still the previous local day', () => {
    // 2026-06-15T03:00Z is 22:00 on 2026-06-14 in Chicago.
    const lateNight = {
      titleSlug: 'late',
      timestamp: Math.floor(Date.parse('2026-06-15T03:00:00Z') / 1000),
    };
    const result = computeStreakState({ submissions: [lateNight], timezone: 'America/Chicago', maxStrikes: 3 });

    expect(result.clearsToday).toBe(false);
    expect(result.solvedYesterday).toBe(true);
    expect(result.streakCount).toBe(1);
    expect(result.streakThroughDate).toBe('2026-06-14');
  });
});

describe('loadStrikesUsersData', () => {
  it('preserves saved streaks and dates for users not included in a partial run', async () => {
    await rawSet({
      previousStreaks: { friend: 5, me: 0 },
      previousStreakDates: { friend: dateOf(1) },
    });

    // Mirrors the background worker, which loads only the current user.
    await loadStrikesUsersData([], 'me', 3, TZ);

    const stored = await rawGet(['previousStreaks', 'previousStreakDates']);
    expect(stored.previousStreaks.friend).toBe(5);
    expect(stored.previousStreakDates.friend).toBe(dateOf(1));
    expect(stored.previousStreaks.me).toBe(0);
    expect(stored.previousStreakDates.me).toBeUndefined();
  });

  it('returns strikes, cleared strikes, and streaks arrays', async () => {
    const result = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(result).toEqual({
      strikesUsers: expect.any(Array),
      clearedStrikesUsers: expect.any(Array),
      streaksUsers: expect.any(Array),
    });
  });

  it('treats a user with no recent activity as having strikes', async () => {
    const { strikesUsers, streaksUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(strikesUsers).toEqual([
      {
        username: 'me',
        avatar: 'me.png',
        strikes: 3,
        clearsToday: false,
        clearingSubmission: null,
      },
    ]);
    expect(streaksUsers).toEqual([]);
  });

  it('reports a streak with its avatar and last problem date', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0, 1, 2));

    const { strikesUsers, streaksUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(strikesUsers).toEqual([]);
    expect(streaksUsers).toEqual([
      {
        username: 'me',
        avatar: 'me.png',
        streak: 3,
        lastProblemDate: dateOf(0),
      },
    ]);
  });

  it('saves the current streak and the day it counts through', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0, 1, 2));

    await loadStrikesUsersData([], 'me', 3, TZ);

    const stored = await rawGet(['previousStreaks', 'previousStreakDates']);
    expect(stored.previousStreaks.me).toBe(3);
    expect(stored.previousStreakDates.me).toBe(TODAY);
  });

  it('saves a one-day streak so the next day can extend it', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0));

    await loadStrikesUsersData([], 'me', 3, TZ);

    const stored = await rawGet(['previousStreaks', 'previousStreakDates']);
    expect(stored.previousStreaks.me).toBe(1);
    expect(stored.previousStreakDates.me).toBe(TODAY);
  });

  it('records today in the activity log when the user solved', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0));

    await loadStrikesUsersData([], 'me', 3, TZ);

    const { dailyActivityLog } = await rawGet(['dailyActivityLog']);
    expect(dailyActivityLog.me[TODAY]).toBe(true);
  });

  it('records nothing in the activity log on a day with no solve', async () => {
    await loadStrikesUsersData([], 'me', 3, TZ);

    const { dailyActivityLog } = await rawGet(['dailyActivityLog']);
    expect(dailyActivityLog).toBeUndefined();
  });

  it('does not inflate a streak when the same day is recomputed several times', async () => {
    // 20 solves today: LeetCode's 20-entry window no longer lists yesterday,
    // which is what used to make every recomputation add another day.
    const heavyDay = Array.from({ length: 20 }, (_, index) => submission(0, `heavy-${index}`));
    getACSubmissions.mockImplementation(async (username) => (username === 'me' ? heavyDay : []));

    await rawSet({ previousStreaks: { me: 9 }, previousStreakDates: { me: dateOf(1) } });

    // The background badge worker, then a popup run, then a forced refresh
    // (which drops the cached result) — three recomputations of the same day.
    const background = await loadStrikesUsersData([], 'me', 3, TZ);
    const popup = await loadStrikesUsersData(['friend'], 'me', 3, TZ);
    await cache.clear();
    const refreshed = await loadStrikesUsersData(['friend'], 'me', 3, TZ);

    for (const run of [background, popup, refreshed]) {
      expect(run.streaksUsers.find((user) => user.username === 'me').streak).toBe(10);
    }

    const stored = await rawGet(['previousStreaks', 'previousStreakDates']);
    expect(stored.previousStreaks.me).toBe(10);
    expect(stored.previousStreakDates.me).toBe(TODAY);
  });

  it('adds exactly one day when the saved streak ended yesterday and they solved today', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0));
    await rawSet({ previousStreaks: { me: 9 }, previousStreakDates: { me: dateOf(1) } });

    const { streaksUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(streaksUsers[0].streak).toBe(10);
    expect((await rawGet(['previousStreaks'])).previousStreaks.me).toBe(10);
  });

  it('never inflates from a stale saved streak', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0));
    await rawSet({ previousStreaks: { me: 12 }, previousStreakDates: { me: dateOf(5) } });

    const { streaksUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(streaksUsers).toEqual([]);
    expect((await rawGet(['previousStreaks'])).previousStreaks.me).toBe(1);
  });

  it('ignores a saved streak left over without a date by the old version', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0));
    await rawSet({ previousStreaks: { me: 40 } });

    await loadStrikesUsersData([], 'me', 3, TZ);

    const stored = await rawGet(['previousStreaks', 'previousStreakDates']);
    expect(stored.previousStreaks.me).toBe(1);
    expect(stored.previousStreakDates.me).toBe(TODAY);
  });

  it('bridges days the API dropped using the activity log', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0, 3));
    await rawSet({ dailyActivityLog: { me: { [dateOf(1)]: true, [dateOf(2)]: true } } });

    const { strikesUsers, streaksUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(strikesUsers).toEqual([]);
    expect(streaksUsers).toEqual([
      {
        username: 'me',
        avatar: 'me.png',
        streak: 4,
        lastProblemDate: dateOf(0),
      },
    ]);
  });

  it('resets a broken streak to zero and drops its date', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(4));
    await rawSet({ previousStreaks: { me: 9 }, previousStreakDates: { me: dateOf(1) } });

    const { strikesUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(strikesUsers).toEqual([
      {
        username: 'me',
        avatar: 'me.png',
        strikes: 3,
        clearsToday: false,
        clearingSubmission: null,
      },
    ]);

    const stored = await rawGet(['previousStreaks', 'previousStreakDates']);
    expect(stored.previousStreaks.me).toBe(0);
    expect(stored.previousStreakDates.me).toBeUndefined();
  });

  it('reports a cleared strike when yesterday was active and the day before was not', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(1));

    const { strikesUsers, clearedStrikesUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(strikesUsers).toEqual([]);
    expect(clearedStrikesUsers).toEqual([{ username: 'me', avatar: 'me.png', clearedStrikes: true }]);
  });

  it('does not report a cleared strike when the streak never broke', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(1, 2));

    const { clearedStrikesUsers } = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(clearedStrikesUsers).toEqual([]);
  });

  it('serves repeat calls from the cache without refetching', async () => {
    getACSubmissions.mockImplementation(async () => solvedOn(0, 1));

    const first = await loadStrikesUsersData([], 'me', 3, TZ);
    const second = await loadStrikesUsersData([], 'me', 3, TZ);

    expect(getACSubmissions).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});
