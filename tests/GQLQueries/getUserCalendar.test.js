import { describe, it, expect, vi, afterEach } from 'vitest';
import getUserCalendar from '../../GQLQueries/getUserCalendar.js';

function mockFetch(payload, { ok = true, status = 200 } = {}) {
  const fn = vi.fn().mockResolvedValue({ ok, status, json: async () => payload });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const EMPTY_CALENDAR = {
  streak: 0,
  totalActiveDays: 0,
  activeYears: [],
  submissionCalendar: {},
};

describe('getUserCalendar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the submission calendar and caches the result', async () => {
    const fetchMock = mockFetch({
      data: {
        matchedUser: {
          userCalendar: {
            activeYears: [2026],
            streak: 4,
            totalActiveDays: 12,
            submissionCalendar: '{"1758844800":3}',
          },
        },
      },
    });

    const first = await getUserCalendar('test_user_a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({
      streak: 4,
      totalActiveDays: 12,
      activeYears: [2026],
      submissionCalendar: { 1758844800: 3 },
    });

    const second = await getUserCalendar('test_user_a');
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache
    expect(second).toEqual(first);
  });

  it('returns an empty calendar on an HTTP error', async () => {
    const fetchMock = mockFetch({}, { ok: false, status: 500 });

    await expect(getUserCalendar('test_user_b')).resolves.toEqual(EMPTY_CALENDAR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty calendar when the API responds with errors', async () => {
    mockFetch({ errors: [{ message: 'boom' }] });

    await expect(getUserCalendar('test_user_c')).resolves.toEqual(EMPTY_CALENDAR);
  });

  it('handles a malformed submission calendar string', async () => {
    mockFetch({
      data: {
        matchedUser: {
          userCalendar: {
            activeYears: [],
            streak: 0,
            totalActiveDays: 0,
            submissionCalendar: 'not-json',
          },
        },
      },
    });

    await expect(getUserCalendar('test_user_d')).resolves.toEqual(EMPTY_CALENDAR);
  });
});
