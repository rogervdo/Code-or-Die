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

  it('returns an empty list on an HTTP error', async () => {
    const fetchMock = mockFetch({}, { ok: false, status: 500 });

    await expect(getACSubmissions('test_user_b', 20)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when the API responds with errors', async () => {
    mockFetch({ errors: [{ message: 'boom' }] });

    await expect(getACSubmissions('test_user_c', 20)).resolves.toEqual([]);
  });
});
