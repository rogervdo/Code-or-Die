import { describe, it, expect, vi } from 'vitest';
import {
  extractSolvedCounts,
  getMostRecentPriorSnapshot,
  getYesterdayStr,
  computeSolvedDelta,
  buildSolvedDeltas,
  updateSolvedSnapshots,
  loadSolvedDeltas,
  removeUserSolvedSnapshots,
  SOLVED_SNAPSHOTS_KEY,
} from '../../utils/solvedSnapshots.js';

const counts = (all, easy, medium, hard) => ({ All: all, Easy: easy, Medium: medium, Hard: hard });

const stats = (username, all, easy, medium, hard) => ({
  username,
  acSubmissionNum: [
    { difficulty: 'All', count: all, submissions: 0 },
    { difficulty: 'Easy', count: easy, submissions: 0 },
    { difficulty: 'Medium', count: medium, submissions: 0 },
    { difficulty: 'Hard', count: hard, submissions: 0 },
  ],
});

const addDays = (dateStr, days) => {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const readStore = async () => {
  const result = await new Promise((resolve) =>
    chrome.storage.local.get([SOLVED_SNAPSHOTS_KEY], resolve)
  );
  return result[SOLVED_SNAPSHOTS_KEY] ?? null;
};

describe('extractSolvedCounts', () => {
  it('normalizes acSubmissionNum entries by difficulty', () => {
    expect(extractSolvedCounts(stats('alice', 5, 3, 1, 1))).toEqual(counts(5, 3, 1, 1));
  });

  it('ignores unknown difficulties and defaults missing ones to 0', () => {
    const result = extractSolvedCounts({
      acSubmissionNum: [
        { difficulty: 'Easy', count: 2 },
        { difficulty: 'Impossible', count: 9 },
      ],
    });

    expect(result).toEqual(counts(0, 2, 0, 0));
  });

  it('returns null for malformed input', () => {
    expect(extractSolvedCounts(null)).toBeNull();
    expect(extractSolvedCounts({ acSubmissionNum: 'nope' })).toBeNull();
    expect(extractSolvedCounts({ acSubmissionNum: [] })).toBeNull();
  });
});

describe('getMostRecentPriorSnapshot', () => {
  it('picks the latest snapshot before today', () => {
    const userDates = {
      '2026-10-03': counts(8, 5, 2, 1),
      '2026-10-04': counts(10, 6, 3, 1),
      '2026-10-05': counts(12, 7, 4, 1),
    };

    expect(getMostRecentPriorSnapshot(userDates, '2026-10-05')).toEqual({
      date: '2026-10-04',
      counts: counts(10, 6, 3, 1),
    });
  });

  it('returns null when only today (or nothing) is stored', () => {
    expect(getMostRecentPriorSnapshot({ '2026-10-05': counts(1, 1, 0, 0) }, '2026-10-05')).toBeNull();
    expect(getMostRecentPriorSnapshot({}, '2026-10-05')).toBeNull();
    expect(getMostRecentPriorSnapshot(null, '2026-10-05')).toBeNull();
  });
});

describe('getYesterdayStr', () => {
  it('subtracts one day within a month', () => {
    expect(getYesterdayStr('2026-10-05')).toBe('2026-10-04');
  });

  it('crosses month and year boundaries', () => {
    expect(getYesterdayStr('2026-03-01')).toBe('2026-02-28');
    expect(getYesterdayStr('2026-01-01')).toBe('2025-12-31');
  });
});

describe('computeSolvedDelta', () => {
  it('subtracts per difficulty', () => {
    expect(computeSolvedDelta(counts(12, 7, 4, 1), counts(10, 6, 3, 1))).toEqual(counts(2, 1, 1, 0));
  });

  it('clamps negative changes to 0', () => {
    expect(computeSolvedDelta(counts(9, 5, 3, 1), counts(10, 6, 3, 1))).toEqual(counts(0, 0, 0, 0));
  });

  it('treats missing counts as 0', () => {
    expect(computeSolvedDelta(undefined, undefined)).toEqual(counts(0, 0, 0, 0));
  });
});

describe('buildSolvedDeltas', () => {
  it('computes deltas against the most recent prior day and ignores today', () => {
    const byDate = {
      alice: { '2026-10-04': counts(10, 6, 3, 1), '2026-10-05': counts(12, 7, 4, 1) },
    };

    expect(buildSolvedDeltas([stats('alice', 14, 8, 4, 2)], byDate, '2026-10-05')).toEqual({
      alice: {
        All: 4,
        Easy: 2,
        Medium: 1,
        Hard: 1,
        referenceDate: '2026-10-04',
        isPriorDay: true,
      },
    });
  });

  it('marks older reference dates as not prior day', () => {
    const byDate = { alice: { '2026-09-28': counts(10, 6, 3, 1) } };
    const deltas = buildSolvedDeltas([stats('alice', 11, 6, 3, 2)], byDate, '2026-10-05');

    expect(deltas.alice.isPriorDay).toBe(false);
    expect(deltas.alice.referenceDate).toBe('2026-09-28');
    expect(deltas.alice.Hard).toBe(1);
  });

  it('skips users without a prior snapshot or valid stats', () => {
    const deltas = buildSolvedDeltas(
      [
        stats('bob', 10, 5, 3, 2),
        { acSubmissionNum: [] },
        stats('carol', 4, 2, 1, 1),
      ],
      { alice: { '2026-10-04': counts(1, 1, 0, 0) }, carol: {} },
      '2026-10-05'
    );

    expect(deltas).toEqual({});
  });
});

describe('updateSolvedSnapshots', () => {
  it("writes today's counts and preserves earlier dates", () => {
    const updated = updateSolvedSnapshots(
      { alice: { '2026-10-04': counts(10, 6, 3, 1) } },
      [stats('alice', 12, 7, 4, 1)],
      '2026-10-05'
    );

    expect(updated.alice['2026-10-04']).toEqual(counts(10, 6, 3, 1));
    expect(updated.alice['2026-10-05']).toEqual(counts(12, 7, 4, 1));
  });

  it('prunes snapshots beyond 60 days', () => {
    const byDate = { alice: {} };
    for (let i = 0; i < 61; i++) {
      byDate.alice[addDays('2024-01-01', i)] = counts(1, 1, 0, 0);
    }

    const updated = updateSolvedSnapshots(byDate, [stats('alice', 5, 3, 1, 1)], '2024-03-15');
    const dates = Object.keys(updated.alice).sort();

    expect(dates).toHaveLength(60);
    expect(dates[0]).toBe(addDays('2024-01-01', 2));
    expect(dates[dates.length - 1]).toBe('2024-03-15');
  });

  it('ignores entries without a username or valid counts', () => {
    const updated = updateSolvedSnapshots({}, [{ acSubmissionNum: [] }], '2026-10-05');
    expect(updated).toEqual({});
  });
});

describe('loadSolvedDeltas', () => {
  it('computes deltas against yesterday and stores today totals', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T18:00:00Z'));

    await chrome.storage.local.set({
      [SOLVED_SNAPSHOTS_KEY]: { alice: { '2026-10-04': counts(100, 50, 40, 10) } },
    });

    const deltas = await loadSolvedDeltas([stats('alice', 103, 51, 41, 11)], 'UTC');

    expect(deltas.alice).toEqual({
      All: 3,
      Easy: 1,
      Medium: 1,
      Hard: 1,
      referenceDate: '2026-10-04',
      isPriorDay: true,
    });

    const store = await readStore();
    expect(store.alice['2026-10-05']).toEqual(counts(103, 51, 41, 11));
    expect(store.alice['2026-10-04']).toEqual(counts(100, 50, 40, 10));
  });

  it('still snapshots users with no prior history but reports no delta', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T18:00:00Z'));

    const deltas = await loadSolvedDeltas([stats('bob', 10, 5, 3, 2)], 'UTC');

    expect(deltas.bob).toBeUndefined();
    expect((await readStore()).bob['2026-10-05']).toEqual(counts(10, 5, 3, 2));
  });

  it('does not write snapshots when updateSnapshots is false', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T18:00:00Z'));

    const seeded = { alice: { '2026-10-04': counts(100, 50, 40, 10) } };
    await chrome.storage.local.set({ [SOLVED_SNAPSHOTS_KEY]: seeded });

    const deltas = await loadSolvedDeltas([stats('alice', 101, 50, 40, 11)], 'UTC', {
      updateSnapshots: false,
    });

    expect(deltas.alice.All).toBe(1);
    expect(await readStore()).toEqual(seeded);
  });

  it('handles an auto timezone without throwing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T18:00:00Z'));

    await expect(loadSolvedDeltas([stats('alice', 1, 1, 0, 0)], 'auto')).resolves.toEqual({});
  });
});

describe('removeUserSolvedSnapshots', () => {
  it('drops the user while keeping others', async () => {
    await chrome.storage.local.set({
      [SOLVED_SNAPSHOTS_KEY]: {
        alice: { '2026-10-04': counts(1, 1, 0, 0) },
        bob: { '2026-10-04': counts(2, 1, 1, 0) },
      },
    });

    await removeUserSolvedSnapshots('alice');

    expect(await readStore()).toEqual({ bob: { '2026-10-04': counts(2, 1, 1, 0) } });
  });

  it('is a no-op for unknown users', async () => {
    const seeded = { bob: { '2026-10-04': counts(2, 1, 1, 0) } };
    await chrome.storage.local.set({ [SOLVED_SNAPSHOTS_KEY]: seeded });

    await removeUserSolvedSnapshots('nobody');

    expect(await readStore()).toEqual(seeded);
  });
});
