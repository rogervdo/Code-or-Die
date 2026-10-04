import { describe, it, expect } from 'vitest';
import { timeDifference } from '../../popup/helper.js';

describe('timeDifference', () => {
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);
  const at = (ms) => base + ms;
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('formats sub-minute differences as seconds', () => {
    expect(timeDifference(at(5 * SEC), base)).toBe('5 seconds ago');
    expect(timeDifference(at(0), base)).toBe('0 seconds ago');
  });

  it('formats minute-scale differences', () => {
    expect(timeDifference(at(5 * MIN), base)).toBe('5 mins ago');
    expect(timeDifference(at(59 * MIN), base)).toBe('59 mins ago');
  });

  it('formats hour-scale differences', () => {
    expect(timeDifference(at(5 * HOUR), base)).toBe('5 hours ago');
  });

  it('formats day-scale differences', () => {
    expect(timeDifference(at(5 * DAY), base)).toBe('5 days ago');
  });

  it('formats month-scale differences', () => {
    expect(timeDifference(at(60 * DAY), base)).toBe('2 months ago');
  });

  it('formats year-scale differences', () => {
    expect(timeDifference(at(2 * 365 * DAY), base)).toBe('2 years ago');
  });
});
