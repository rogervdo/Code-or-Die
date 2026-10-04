import { describe, it, expect, vi } from 'vitest';
import {
  getPointsForDifficulty,
  submissionKey,
  mergeSubmissions,
  getCurrentWeekBounds,
  isInCurrentWeek,
  filterSubmissionsInWeek,
  accumulateWeeklySubmissions,
  WEEKLY_SUBMISSIONS_STORE_KEY,
} from '../../utils/contestUtils.js';

const sub = (titleSlug, timestamp) => ({ titleSlug, timestamp });
const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);

const readStoredSubmissions = async (username) => {
  const result = await new Promise((resolve) =>
    chrome.storage.local.get([WEEKLY_SUBMISSIONS_STORE_KEY], resolve)
  );
  return result[WEEKLY_SUBMISSIONS_STORE_KEY]?.[username]?.submissions ?? null;
};

describe('getPointsForDifficulty', () => {
  it('maps each difficulty to its point value', () => {
    expect(getPointsForDifficulty('Easy')).toBe(1);
    expect(getPointsForDifficulty('Medium')).toBe(3);
    expect(getPointsForDifficulty('Hard')).toBe(6);
  });

  it('returns 0 for an unknown difficulty', () => {
    expect(getPointsForDifficulty('Impossible')).toBe(0);
  });
});

describe('submissionKey', () => {
  it('combines titleSlug and timestamp', () => {
    expect(submissionKey(sub('two-sum', 100))).toBe('two-sum::100');
  });
});

describe('mergeSubmissions', () => {
  it('appends new submissions and skips duplicates', () => {
    const existing = [sub('a', 1), sub('b', 2)];
    const incoming = [sub('b', 2), sub('c', 3)];
    expect(mergeSubmissions(existing, incoming)).toEqual([sub('a', 1), sub('b', 2), sub('c', 3)]);
  });

  it('treats re-solves at different times as distinct', () => {
    expect(mergeSubmissions([sub('a', 1)], [sub('a', 2)])).toHaveLength(2);
  });

  it('returns the existing list when nothing is incoming', () => {
    const existing = [sub('a', 1)];
    expect(mergeSubmissions(existing, [])).toEqual(existing);
  });
});

describe('getCurrentWeekBounds', () => {
  it('returns Monday-Sunday for a midweek day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-19T12:00:00Z')); // Wednesday
    expect(getCurrentWeekBounds('UTC')).toMatchObject({
      weekStartFormatted: '2024-06-17',
      weekEndFormatted: '2024-06-23',
    });
  });

  it('keeps Sunday in the same week', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-23T12:00:00Z')); // Sunday
    expect(getCurrentWeekBounds('UTC')).toMatchObject({
      weekStartFormatted: '2024-06-17',
      weekEndFormatted: '2024-06-23',
    });
  });

  it('rolls over on Monday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-24T12:00:00Z')); // Monday
    expect(getCurrentWeekBounds('UTC')).toMatchObject({
      weekStartFormatted: '2024-06-24',
      weekEndFormatted: '2024-06-30',
    });
  });

  it('honours the timezone when it shifts the date across a boundary', () => {
    vi.useFakeTimers();
    // Monday 00:30 UTC is still Sunday evening in Los Angeles
    vi.setSystemTime(new Date('2024-06-24T00:30:00Z'));
    expect(getCurrentWeekBounds('America/Los_Angeles')).toMatchObject({
      weekStartFormatted: '2024-06-17',
      weekEndFormatted: '2024-06-23',
    });
  });
});

describe('isInCurrentWeek / filterSubmissionsInWeek', () => {
  const weekStart = new Date('2024-06-17');
  const weekEnd = new Date('2024-06-23');

  it('includes the Monday and Sunday boundaries', () => {
    expect(isInCurrentWeek(ts('2024-06-17T00:30:00Z'), weekStart, weekEnd, 'UTC')).toBe(true);
    expect(isInCurrentWeek(ts('2024-06-23T23:30:00Z'), weekStart, weekEnd, 'UTC')).toBe(true);
  });

  it('excludes the days before and after the week', () => {
    expect(isInCurrentWeek(ts('2024-06-16T23:00:00Z'), weekStart, weekEnd, 'UTC')).toBe(false);
    expect(isInCurrentWeek(ts('2024-06-24T00:30:00Z'), weekStart, weekEnd, 'UTC')).toBe(false);
  });

  it('filters a mixed list down to the current week', () => {
    const inWeek = sub('a', ts('2024-06-18T12:00:00Z'));
    const outOfWeek = sub('b', ts('2024-06-01T12:00:00Z'));
    expect(filterSubmissionsInWeek([inWeek, outOfWeek], weekStart, weekEnd, 'UTC')).toEqual([inWeek]);
  });
});

describe('accumulateWeeklySubmissions', () => {
  it('stores and returns the first batch', async () => {
    const batch = [sub('a', 10), sub('b', 20)];
    await expect(accumulateWeeklySubmissions('alice', '2024-06-17', batch)).resolves.toEqual(batch);
  });

  it('merges subsequent batches and de-dupes', async () => {
    await accumulateWeeklySubmissions('alice', '2024-06-17', [sub('a', 10), sub('b', 20)]);
    const result = await accumulateWeeklySubmissions('alice', '2024-06-17', [sub('b', 20), sub('c', 30)]);
    expect(result).toEqual([sub('a', 10), sub('b', 20), sub('c', 30)]);
  });

  it('accumulates more than 20 submissions across refreshes', async () => {
    for (let i = 0; i < 30; i++) {
      await accumulateWeeklySubmissions('alice', '2024-06-17', [sub(`p${i}`, i)]);
    }

    expect(await readStoredSubmissions('alice')).toHaveLength(30);
  });

  it('does not lose data when a fetch returns an empty batch', async () => {
    await accumulateWeeklySubmissions('alice', '2024-06-17', [sub('a', 10), sub('b', 20)]);
    const result = await accumulateWeeklySubmissions('alice', '2024-06-17', []);
    expect(result).toEqual([sub('a', 10), sub('b', 20)]);
  });

  it('resets when the week changes', async () => {
    await accumulateWeeklySubmissions('alice', '2024-06-17', [sub('a', 10)]);
    const result = await accumulateWeeklySubmissions('alice', '2024-06-24', [sub('b', 20)]);
    expect(result).toEqual([sub('b', 20)]);
  });

  it('keeps a separate store per user', async () => {
    await accumulateWeeklySubmissions('alice', '2024-06-17', [sub('a', 10)]);
    await accumulateWeeklySubmissions('bob', '2024-06-17', [sub('b', 20)]);

    expect(await readStoredSubmissions('alice')).toEqual([sub('a', 10)]);
    expect(await readStoredSubmissions('bob')).toEqual([sub('b', 20)]);
  });

  it('prunes users whose stored data is from a previous week', async () => {
    await accumulateWeeklySubmissions('alice', '2024-06-17', [sub('a', 10)]);
    await accumulateWeeklySubmissions('bob', '2024-06-17', [sub('b', 20)]);

    // New week: alice refreshes, bob is no longer tracked
    await accumulateWeeklySubmissions('alice', '2024-06-24', [sub('c', 30)]);

    const store = await new Promise((resolve) =>
      chrome.storage.local.get([WEEKLY_SUBMISSIONS_STORE_KEY], resolve)
    );
    expect(Object.keys(store[WEEKLY_SUBMISSIONS_STORE_KEY])).toEqual(['alice']);
  });

  it('recovers from a malformed stored entry instead of throwing', async () => {
    await chrome.storage.local.set({
      [WEEKLY_SUBMISSIONS_STORE_KEY]: { alice: { weekStart: '2024-06-17', submissions: 'not-an-array' } },
    });

    await expect(accumulateWeeklySubmissions('alice', '2024-06-17', [sub('a', 10)])).resolves.toEqual([
      sub('a', 10),
    ]);
  });

  it('serializes concurrent refreshes without dropping submissions', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        accumulateWeeklySubmissions('alice', '2024-06-17', [sub(`p${i}`, i)])
      )
    );

    expect(await readStoredSubmissions('alice')).toHaveLength(30);
  });
});
