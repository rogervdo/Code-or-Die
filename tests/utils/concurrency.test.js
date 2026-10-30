import { describe, it, expect } from 'vitest';
import { mapLimit } from '../../utils/concurrency.js';

describe('mapLimit', () => {
  it('preserves input order', async () => {
    const result = await mapLimit([3, 1, 2], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n * 2));
      return n * 10;
    });

    expect(result).toEqual([30, 10, 20]);
  });

  it('never exceeds the concurrency limit', async () => {
    let current = 0;
    let peak = 0;

    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => setTimeout(resolve, 2));
      current -= 1;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    await expect(mapLimit([], 4, async () => 1)).resolves.toEqual([]);
  });
});
