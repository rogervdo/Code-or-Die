import { describe, it, expect, vi, afterEach } from 'vitest';
import { gqlRequest } from '../../utils/gqlClient.js';

const okResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });

function mockFetch(...responses) {
  const fn = vi.fn();
  responses.forEach((response) => fn.mockResolvedValueOnce(response));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('gqlRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed body on success', async () => {
    mockFetch(okResponse({ data: { x: 1 } }));

    await expect(gqlRequest('query', {})).resolves.toEqual({ data: { x: 1 } });
  });

  it('retries a transient failure and then succeeds', async () => {
    const fetchMock = mockFetch({ ok: false, status: 429 }, okResponse({ data: { ok: true } }));

    await expect(gqlRequest('query', {}, { retries: 1 })).resolves.toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async () => {
    const fetchMock = mockFetch({ ok: false, status: 400 });

    await expect(gqlRequest('query', {})).rejects.toThrow('400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws after the retries are exhausted', async () => {
    const fetchMock = mockFetch({ ok: false, status: 503 });

    await expect(gqlRequest('query', {}, { retries: 0 })).rejects.toThrow('503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps the number of concurrent requests', async () => {
    let current = 0;
    let peak = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise((resolve) => setTimeout(resolve, 5));
        current -= 1;
        return okResponse({ data: {} });
      })
    );

    await Promise.all(Array.from({ length: 15 }, () => gqlRequest('query', {})));

    expect(peak).toBeLessThanOrEqual(6);
  });
});
