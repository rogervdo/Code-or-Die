import { describe, it, expect, vi, afterEach } from 'vitest';
import getACSubmissions from '../../GQLQueries/recentACSubmissions.js';

function mockFetch(payload, { ok = true, status = 200 } = {}) {
  const fn = vi.fn().mockResolvedValue({ ok, status, json: async () => payload });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('getACSubmissions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches, tags each submission with the username, and caches the result', async () => {
    const fetchMock = mockFetch({
      data: {
        recentAcSubmissionList: [
          { title: 'Two Sum', titleSlug: 'two-sum', timestamp: 1, statusDisplay: 'Accepted', lang: 'js' },
        ],
      },
    });

    const first = await getACSubmissions('test_user_a', 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual([
      {
        title: 'Two Sum',
        titleSlug: 'two-sum',
        timestamp: 1,
        statusDisplay: 'Accepted',
        lang: 'js',
        username: 'test_user_a',
      },
    ]);

    const second = await getACSubmissions('test_user_a', 20);
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache
    expect(second).toEqual(first);
  });

  it('serves different limits from a single cached fetch', async () => {
    const fetchMock = mockFetch({
      data: {
        recentAcSubmissionList: Array.from({ length: 10 }, (_, i) => ({
          title: `Problem ${i}`,
          titleSlug: `problem-${i}`,
          timestamp: i,
          statusDisplay: 'Accepted',
          lang: 'js',
        })),
      },
    });

    const five = await getACSubmissions('test_user_slice', 5);
    expect(five).toHaveLength(5);

    const all = await getACSubmissions('test_user_slice', 20);
    expect(all).toHaveLength(10);

    expect(fetchMock).toHaveBeenCalledTimes(1); // one fetch shared by both limits
  });

  it('requests the full window even when a caller asks for fewer', async () => {
    const fetchMock = mockFetch({
      data: {
        recentAcSubmissionList: Array.from({ length: 30 }, (_, i) => ({
          title: `Problem ${i}`,
          titleSlug: `problem-${i}`,
          timestamp: i,
          statusDisplay: 'Accepted',
          lang: 'js',
        })),
      },
    });

    const all = await getACSubmissions('test_user_window', 30);
    expect(all).toHaveLength(30);

    // Streaks scan a 30-day window, so the shared fetch must not be trimmed.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables.limit).toBe(30);
  });

  it('does not let a caller mutate the cached list', async () => {
    mockFetch({
      data: {
        recentAcSubmissionList: [
          { title: 'A', titleSlug: 'a', timestamp: 2, statusDisplay: 'Accepted', lang: 'js' },
          { title: 'B', titleSlug: 'b', timestamp: 1, statusDisplay: 'Accepted', lang: 'js' },
        ],
      },
    });

    const first = await getACSubmissions('test_user_mutate', 20);
    first.sort((x, y) => x.timestamp - y.timestamp);

    const second = await getACSubmissions('test_user_mutate', 20);
    expect(second.map((submission) => submission.titleSlug)).toEqual(['a', 'b']);
  });

  it('returns an empty list on an HTTP error', async () => {
    const fetchMock = mockFetch({}, { ok: false, status: 400 });

    await expect(getACSubmissions('test_user_b', 20)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when the API responds with errors', async () => {
    mockFetch({ errors: [{ message: 'boom' }] });

    await expect(getACSubmissions('test_user_c', 20)).resolves.toEqual([]);
  });
});
