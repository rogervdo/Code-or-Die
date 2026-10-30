/**
 * Cache utility for Chrome extension
 * Provides TTL-based caching using chrome.storage.local
 */

/**
 * In-flight loaders, keyed by prefixed cache key. Lets concurrent callers for
 * the same miss share a single loader invocation instead of stampeding.
 */
const inflight = new Map();

class Cache {
    constructor() {
        this.prefix = 'cache_';
    }

    /**
     * Generate a cache key with prefix
     * @param {string} key - Base cache key
     * @returns {string} - Prefixed cache key
     */
    getCacheKey(key) {
        return `${this.prefix}${key}`;
    }

    /**
     * Set a value in cache with TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttlMs - Time to live in milliseconds
     * @returns {Promise<void>}
     */
    async set(key, value, ttlMs) {
        const cacheKey = this.getCacheKey(key);
        const expiresAt = Date.now() + ttlMs;

        const cacheEntry = {
            value,
            expiresAt,
            cachedAt: Date.now()
        };

        return new Promise((resolve) => {
            chrome.storage.local.set({ [cacheKey]: cacheEntry }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('Extension context invalidated:', chrome.runtime.lastError);
                }
                resolve();
            });
        });
    }

    /**
     * Get a value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any|null>} - Cached value or null if expired/not found
     */
    async get(key) {
        const cacheKey = this.getCacheKey(key);

        return new Promise((resolve) => {
            chrome.storage.local.get([cacheKey], (result) => {
                // Check for extension context invalidation
                if (chrome.runtime.lastError) {
                    console.warn('Extension context invalidated:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                const cacheEntry = result[cacheKey];

                if (!cacheEntry) {
                    resolve(null);
                    return;
                }

                // Check if expired
                if (Date.now() > cacheEntry.expiresAt) {
                    // Clean up expired entry
                    chrome.storage.local.remove([cacheKey]);
                    resolve(null);
                    return;
                }

                resolve(cacheEntry.value);
            });
        });
    }

    /**
     * Returns the cached value for a key, or runs `loader` once to produce it.
     * Concurrent callers for the same key share a single loader invocation, so a
     * cold cache never issues duplicate requests. The loader's result is cached
     * when it is not null/undefined.
     * @param {string} key - Cache key
     * @param {number} ttlMs - TTL to store the resolved value with
     * @param {Function} loader - Async factory invoked on a miss
     * @returns {Promise<any>}
     */
    async remember(key, ttlMs, loader) {
        const cached = await this.get(key);
        if (cached !== null && cached !== undefined) {
            return cached;
        }

        const cacheKey = this.getCacheKey(key);
        if (inflight.has(cacheKey)) {
            return inflight.get(cacheKey);
        }

        const promise = (async () => {
            try {
                const value = await loader();
                if (value !== null && value !== undefined) {
                    await this.set(key, value, ttlMs);
                }
                return value;
            } finally {
                inflight.delete(cacheKey);
            }
        })();

        inflight.set(cacheKey, promise);
        return promise;
    }

    /**
     * Check if a key exists and is not expired
     * @param {string} key - Cache key
     * @returns {Promise<boolean>}
     */
    async has(key) {
        const value = await this.get(key);
        return value !== null;
    }

    /**
     * Get cache metadata (expiration time, cached time) without returning the value
     * @param {string} key - Cache key
     * @returns {Promise<{expiresAt: number, cachedAt: number, timeUntilExpiry: number}|null>}
     */
    async getMetadata(key) {
        const cacheKey = this.getCacheKey(key);

        return new Promise((resolve) => {
            chrome.storage.local.get([cacheKey], (result) => {
                // Check for extension context invalidation
                if (chrome.runtime.lastError) {
                    console.warn('Extension context invalidated:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                const cacheEntry = result[cacheKey];

                if (!cacheEntry) {
                    resolve(null);
                    return;
                }

                // Check if expired
                if (Date.now() > cacheEntry.expiresAt) {
                    resolve(null);
                    return;
                }

                resolve({
                    expiresAt: cacheEntry.expiresAt,
                    cachedAt: cacheEntry.cachedAt,
                    timeUntilExpiry: cacheEntry.expiresAt - Date.now()
                });
            });
        });
    }

    /**
     * Delete a specific cache entry
     * @param {string} key - Cache key
     * @returns {Promise<void>}
     */
    async delete(key) {
        const cacheKey = this.getCacheKey(key);
        return new Promise((resolve) => {
            chrome.storage.local.remove([cacheKey], () => {
                if (chrome.runtime.lastError) {
                    console.warn('Extension context invalidated:', chrome.runtime.lastError);
                }
                resolve();
            });
        });
    }

    /**
     * Clear all cache entries
     * @returns {Promise<void>}
     */
    async clear() {
        return new Promise((resolve) => {
            chrome.storage.local.get(null, (items) => {
                // Check for extension context invalidation
                if (chrome.runtime.lastError) {
                    console.warn('Extension context invalidated:', chrome.runtime.lastError);
                    resolve();
                    return;
                }

                const cacheKeys = Object.keys(items).filter(key =>
                    key.startsWith(this.prefix)
                );

                if (cacheKeys.length > 0) {
                    chrome.storage.local.remove(cacheKeys, () => {
                        if (chrome.runtime.lastError) {
                            console.warn('Extension context invalidated:', chrome.runtime.lastError);
                        }
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Clean up expired cache entries
     * @returns {Promise<number>} - Number of entries removed
     */
    async cleanExpired() {
        return new Promise((resolve) => {
            chrome.storage.local.get(null, (items) => {
                // Check for extension context invalidation
                if (chrome.runtime.lastError) {
                    console.warn('Extension context invalidated:', chrome.runtime.lastError);
                    resolve(0);
                    return;
                }

                const now = Date.now();
                const expiredKeys = [];

                for (const [key, value] of Object.entries(items)) {
                    if (key.startsWith(this.prefix) && value.expiresAt && now > value.expiresAt) {
                        expiredKeys.push(key);
                    }
                }

                if (expiredKeys.length > 0) {
                    chrome.storage.local.remove(expiredKeys, () => {
                        if (chrome.runtime.lastError) {
                            console.warn('Extension context invalidated:', chrome.runtime.lastError);
                        }
                        resolve(expiredKeys.length);
                    });
                } else {
                    resolve(0);
                }
            });
        });
    }
}

// TTL constants (in milliseconds)
export const TTL = {
    PROFILE_PIC: 7 * 24 * 60 * 60 * 1000,  // 7 days
    USER_STATS: 60 * 60 * 1000,            // 1 hour
    SUBMISSIONS: 10 * 60 * 1000,            // 10 minutes
    DAILY_LEADERBOARD: 5 * 60 * 1000,       // 5 minutes
    CONTEST: 30 * 60 * 1000,                // 30 minutes
    STRIKES: 30 * 60 * 1000,                // 30 minutes
    GLOBAL_RANKING: 60 * 60 * 1000,         // 1 hour
    PROBLEM_DIFFICULTY: 24 * 60 * 60 * 1000 // 24 hours (difficulty is immutable)
};

/**
 * Calculate TTL until midnight in a specific timezone
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago")
 * @returns {number} - Milliseconds until midnight in the specified timezone
 */
export function getTTLUntilMidnight(timezone) {
    const now = new Date();

    // Get current date/time in the specified timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(now);
    const dateParts = {};
    parts.forEach(part => {
        if (part.type !== 'literal') {
            dateParts[part.type] = part.value;
        }
    });

    // Create a date object for midnight tomorrow in the target timezone
    const year = parseInt(dateParts.year);
    const month = parseInt(dateParts.month);
    const day = parseInt(dateParts.day);

    // Create date string for tomorrow at midnight
    const tomorrowDate = new Date(year, month - 1, day);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);

    // Format as ISO string and get midnight in the target timezone
    const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}T00:00:00`;

    // Parse this string as if it's in the target timezone
    const tomorrowInTargetTZ = new Date(tomorrowStr + 'Z');

    // Get offset for target timezone
    const nowInTargetTZ = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const offset = now.getTime() - nowInTargetTZ.getTime();

    // Calculate midnight tomorrow
    const midnightTomorrow = new Date(
        Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0)
    ).getTime() + offset;

    const ttl = midnightTomorrow - now.getTime();

    // Return at least 30 minutes to avoid immediate expiration
    return Math.max(ttl, TTL.STRIKES);
}

export default new Cache();
