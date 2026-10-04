import { describe, it, expect, vi } from 'vitest';
import {
  REFRESH_INTERVAL_MS,
  formatTime,
  getNextRefreshAt,
  resetRefreshSchedule,
  restoreRefreshSchedule,
  startRefreshCycle,
} from '../../utils/updateTimer.js';

const rawGet = (key) => new Promise((resolve) => chrome.storage.local.get([key], resolve));

describe('formatTime', () => {
  it('formats seconds only', () => {
    expect(formatTime(5 * 1000)).toBe('5s');
    expect(formatTime(0)).toBe('0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime((9 * 60 + 45) * 1000)).toBe('9m 45s');
  });

  it('drops the seconds at a whole minute', () => {
    expect(formatTime(60 * 1000)).toBe('1m');
  });

  it('formats hours', () => {
    expect(formatTime(2 * 60 * 60 * 1000)).toBe('2h');
    expect(formatTime((2 * 60 + 5) * 60 * 1000)).toBe('2h 5m');
  });
});

describe('refresh schedule', () => {
  it('opens a window of REFRESH_INTERVAL_MS and persists it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    await resetRefreshSchedule();

    expect(getNextRefreshAt()).toBe(1000 + REFRESH_INTERVAL_MS);
    await expect(rawGet('nextRefreshAt')).resolves.toEqual({ nextRefreshAt: 1000 + REFRESH_INTERVAL_MS });
  });

  it('restores a future deadline from storage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    await chrome.storage.local.set({ nextRefreshAt: 2000 });

    await restoreRefreshSchedule();

    expect(getNextRefreshAt()).toBe(2000);
  });

  it('opens a fresh window when the stored deadline has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    await chrome.storage.local.set({ nextRefreshAt: 2000 });

    await restoreRefreshSchedule();

    expect(getNextRefreshAt()).toBe(5000 + REFRESH_INTERVAL_MS);
  });

  it('opens a fresh window when nothing is stored', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);

    await restoreRefreshSchedule();

    expect(getNextRefreshAt()).toBe(5000 + REFRESH_INTERVAL_MS);
  });
});

describe('startRefreshCycle', () => {
  it('refreshes once the deadline passes, then opens the next window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    await resetRefreshSchedule();
    const deadline = getNextRefreshAt();

    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const cycle = await startRefreshCycle(onRefresh);
    expect(onRefresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 1000);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getNextRefreshAt()).toBeGreaterThan(deadline);

    cycle.destroy();
  });
});
