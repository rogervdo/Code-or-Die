import { describe, it, expect, vi } from 'vitest';
import cache, { TTL, getTTLUntilMidnight } from '../../utils/cache.js';

const rawGet = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, resolve));

describe('Cache', () => {
  it('stores and retrieves a value', async () => {
    await cache.set('k1', { a: 1 }, 1000);
    await expect(cache.get('k1')).resolves.toEqual({ a: 1 });
  });

  it('returns null for a missing key', async () => {
    await expect(cache.get('missing')).resolves.toBeNull();
  });

  it('returns null once the TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    await cache.set('k2', 'v', 1000);

    vi.setSystemTime(1001);
    await expect(cache.get('k2')).resolves.toBeNull();
  });

  it('has() reflects presence', async () => {
    await cache.set('k3', 0, 1000);
    await expect(cache.has('k3')).resolves.toBe(true);
  });

  it('delete removes an entry', async () => {
    await cache.set('k4', 'v', 1000);
    await cache.delete('k4');
    await expect(cache.get('k4')).resolves.toBeNull();
  });

  it('clear removes only prefixed cache entries', async () => {
    await cache.set('k5', 'v', 1000);
    await chrome.storage.local.set({ username: 'alice' });

    await cache.clear();

    await expect(cache.get('k5')).resolves.toBeNull();
    await expect(rawGet(['username'])).resolves.toEqual({ username: 'alice' });
  });

  it('cleanExpired removes expired entries and reports the count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    await cache.set('expired', 'v', 1000);
    await cache.set('fresh', 'v', 100000);

    vi.setSystemTime(2000);

    await expect(cache.cleanExpired()).resolves.toBe(1);
    await expect(cache.get('fresh')).resolves.toBe('v');
  });

  it('getMetadata reports time until expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    await cache.set('meta', 'v', 5000);

    const meta = await cache.getMetadata('meta');
    expect(meta.expiresAt).toBe(6000);
    expect(meta.timeUntilExpiry).toBe(5000);
  });

  it('getMetadata returns null when expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    await cache.set('meta2', 'v', 1000);

    vi.setSystemTime(2000);
    await expect(cache.getMetadata('meta2')).resolves.toBeNull();
  });
});

describe('getTTLUntilMidnight', () => {
  it('never returns less than the strikes TTL floor', () => {
    expect(getTTLUntilMidnight('UTC')).toBeGreaterThanOrEqual(TTL.STRIKES);
  });
});

describe('remember', () => {
  it('returns a cached value without invoking the loader', async () => {
    await cache.set('remember_hit', 42, 1000);
    const loader = vi.fn();

    await expect(cache.remember('remember_hit', 1000, loader)).resolves.toBe(42);
    expect(loader).not.toHaveBeenCalled();
  });

  it('runs the loader once on a miss and caches the result', async () => {
    const loader = vi.fn().mockResolvedValue('value');

    await expect(cache.remember('remember_miss', 1000, loader)).resolves.toBe('value');
    await expect(cache.remember('remember_miss', 1000, loader)).resolves.toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into a single loader call', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await Promise.resolve();
      return 'shared';
    };

    const [a, b] = await Promise.all([
      cache.remember('remember_concurrent', 1000, loader),
      cache.remember('remember_concurrent', 1000, loader),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe('shared');
    expect(b).toBe('shared');
  });

  it('does not cache a null result', async () => {
    const loader = vi.fn().mockResolvedValue(null);

    await expect(cache.remember('remember_null', 1000, loader)).resolves.toBeNull();
    await expect(cache.remember('remember_null', 1000, loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('propagates a loader error and leaves nothing cached', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(cache.remember('remember_error', 1000, loader)).rejects.toThrow('boom');
    await expect(cache.remember('remember_error', 1000, loader)).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
