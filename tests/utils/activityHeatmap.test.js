import { describe, it, expect } from 'vitest';
import {
  buildActivityGrid,
  calendarTimestampToDateKey,
  formatAxisDate,
  formatHeatmapTooltip,
  getActivityLevel,
} from '../../utils/activityHeatmap.js';

function ts(dateStr) {
  return Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);
}

describe('calendarTimestampToDateKey', () => {
  it('converts a UTC-midnight timestamp to its date key', () => {
    expect(calendarTimestampToDateKey(ts('2026-09-26'))).toBe('2026-09-26');
  });

  it('accepts string timestamps', () => {
    expect(calendarTimestampToDateKey(String(ts('2026-09-26')))).toBe('2026-09-26');
  });
});

describe('buildActivityGrid', () => {
  const today = new Date('2026-10-04T15:00:00Z');

  it('returns a trailing window ending on today, oldest first', () => {
    const calendar = {
      [ts('2026-10-04')]: 10,
      [ts('2026-10-03')]: 2,
      [ts('2026-09-05')]: 1,
      [ts('2026-08-01')]: 7, // outside the window
    };

    const { cells, activeDays, maxCount } = buildActivityGrid(calendar, { days: 30, today });

    expect(cells).toHaveLength(30);
    expect(cells[0].date).toBe('2026-09-05');
    expect(cells[29].date).toBe('2026-10-04');
    expect(cells[29].count).toBe(10);
    expect(cells[28].count).toBe(2);
    expect(cells[0].count).toBe(1);
    expect(activeDays).toBe(3);
    expect(maxCount).toBe(10);
  });

  it('handles a missing or empty calendar', () => {
    const { cells, activeDays, maxCount } = buildActivityGrid(null, { days: 30, today });

    expect(cells).toHaveLength(30);
    expect(activeDays).toBe(0);
    expect(maxCount).toBe(0);
    expect(cells.every((cell) => cell.count === 0)).toBe(true);
  });

  it('ignores days outside the requested window', () => {
    const calendar = { [ts('2026-12-25')]: 99 };
    const { cells, maxCount } = buildActivityGrid(calendar, { days: 30, today });

    expect(maxCount).toBe(0);
    expect(cells.every((cell) => cell.count === 0)).toBe(true);
  });
});

describe('getActivityLevel', () => {
  it('returns 0 for days without submissions', () => {
    expect(getActivityLevel(0, 10)).toBe(0);
    expect(getActivityLevel(null, 10)).toBe(0);
  });

  it('buckets counts into 1-3 relative to the max', () => {
    expect(getActivityLevel(2, 10)).toBe(1);
    expect(getActivityLevel(3, 10)).toBe(1);
    expect(getActivityLevel(4, 10)).toBe(2);
    expect(getActivityLevel(6, 10)).toBe(2);
    expect(getActivityLevel(7, 10)).toBe(3);
    expect(getActivityLevel(10, 10)).toBe(3);
  });

  it('falls back to level 1 when there is no max', () => {
    expect(getActivityLevel(5, 0)).toBe(1);
  });
});

describe('formatHeatmapTooltip', () => {
  it('formats a day with multiple submissions', () => {
    expect(formatHeatmapTooltip({ date: '2026-09-26', count: 10 })).toBe('Sat, Sep 26: 10 submissions');
  });

  it('uses the singular for one submission', () => {
    expect(formatHeatmapTooltip({ date: '2026-09-26', count: 1 })).toBe('Sat, Sep 26: 1 submission');
  });

  it('reports no submissions for an empty day', () => {
    expect(formatHeatmapTooltip({ date: '2026-09-26', count: 0 })).toBe('Sat, Sep 26: No submissions');
  });
});

describe('formatAxisDate', () => {
  it('formats a date key as a short month and day', () => {
    expect(formatAxisDate('2026-09-05')).toBe('Sep 5');
  });
});
