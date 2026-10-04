import { describe, it, expect, vi } from 'vitest';
import {
  getLocalDateString,
  getTodayInTimezone,
  daysDifference,
  getUserTimezone,
  setUserTimezone,
} from '../../utils/timezoneHelper.js';

describe('getLocalDateString', () => {
  // 2024-06-15T04:30:00Z
  const ts = Date.UTC(2024, 5, 15, 4, 30, 0) / 1000;

  it('formats a timestamp in UTC', () => {
    expect(getLocalDateString(ts, 'UTC')).toBe('2024-06-15');
  });

  it('respects a timezone that shifts the date back a day', () => {
    expect(getLocalDateString(ts, 'America/Los_Angeles')).toBe('2024-06-14');
  });
});

describe('getTodayInTimezone', () => {
  it('returns today in the requested timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T04:30:00Z'));

    expect(getTodayInTimezone('UTC')).toBe('2024-06-15');
    expect(getTodayInTimezone('America/Los_Angeles')).toBe('2024-06-14');
  });
});

describe('daysDifference', () => {
  it('computes whole-day differences regardless of order', () => {
    expect(daysDifference('2024-01-01', '2024-01-05')).toBe(4);
    expect(daysDifference('2024-01-05', '2024-01-01')).toBe(4);
  });
});

describe('timezone preference storage', () => {
  it('stores and reads back a timezone', async () => {
    await setUserTimezone('Europe/Paris');
    await expect(getUserTimezone()).resolves.toBe('Europe/Paris');
  });

  it('falls back to the runtime timezone when unset', async () => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await expect(getUserTimezone()).resolves.toBe(detected);
  });
});
