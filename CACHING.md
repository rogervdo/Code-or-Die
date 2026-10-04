# Caching Implementation

## Overview
This extension now implements a comprehensive caching system using `chrome.storage.local` with TTL (Time To Live) support. This significantly improves performance by reducing redundant API calls to LeetCode's GraphQL API.

## Cache Configuration

### TTL (Time To Live) Values
- **Profile Pictures**: 24 hours (86,400,000 ms)
  - Profile pictures rarely change
- **User Problem Stats**: 2 hours (7,200,000 ms)
  - Stats change slowly as users solve problems
- **Recent Submissions**: 10 minutes (600,000 ms)
  - Most dynamic data, needs frequent updates
- **Weekly Leaderboard / Contest**: 30 minutes (1,800,000 ms)
  - Updates as new submissions come in across the week

## How It Works

### Cache Structure
Each cached entry is stored with the following structure:
```javascript
{
  value: <cached_data>,
  expiresAt: <timestamp_when_expires>,
  cachedAt: <timestamp_when_cached>
}
```

### Cache Keys
- Profile pictures: `cache_profile_pic_{username}`
- User stats: `cache_user_stats_{username}`
- Submissions: `cache_submissions_{username}_{limit}`

### Cache Operations

1. **Get**: Retrieves data from cache if not expired
2. **Set**: Stores data with an expiration timestamp
3. **Has**: Checks if a key exists and is valid
4. **Delete**: Removes a specific cache entry
5. **Clear**: Removes all cache entries
6. **CleanExpired**: Removes expired entries (runs on popup open)

## Benefits

### Performance Improvements
- **Faster Loading**: Cached data loads instantly without network requests
- **Reduced API Load**: Fewer requests to LeetCode's servers
- **Better UX**: Immediate display of data when reopening the extension

### API Call Reduction
**Before Caching** (with 5 friends):
- Opening extension: ~36 API calls (6 users × 6 data points)
- Tab switching: 6-12 additional calls

**After Caching** (subsequent opens within TTL):
- Opening extension: 0 API calls (if cache is warm)
- Tab switching: 0 additional calls

## Cache Maintenance

### Automatic Cleanup
- Expired entries are automatically cleaned when:
  - The popup is opened (`DOMContentLoaded` event)
  - A cache entry is accessed but found to be expired

### Manual Cache Management
To manually clear the cache (useful for debugging):
```javascript
import cache from './utils/cache.js';

// Clear all cache
await cache.clear();

// Clear specific user's data
await cache.delete('profile_pic_username');
await cache.delete('user_stats_username');
await cache.delete('submissions_username_20');
```

## Update Timer

Each page (Activity, Leaderboard, Streaks) displays a small timer showing when the cached data will expire and refresh:

- **"Updates in 9m 45s"** - Real-time countdown to cache expiration
- **"Updates on next open"** - When no cache exists yet
- **"Updating..."** - When cache has expired

This gives users transparency about when data will be refreshed.

See [UPDATE_TIMER.md](UPDATE_TIMER.md) for detailed information about the timer feature.

## Testing

### Verify Caching Works
1. Open the extension (first time will fetch from API)
2. Check browser console for "Cache miss" messages
3. Observe the update timer showing countdown (e.g., "Updates in 9m 45s")
4. Close and reopen the extension immediately
5. Check console for "Cache hit" messages
6. Verify data loads instantly and timer shows time remaining

### Console Messages
- `Cache miss for [type]: [username], fetching from API` - Data not in cache, fetching fresh
- `Cache hit for [type]: [username]` - Data loaded from cache
- `Cleaned up X expired cache entries` - Automatic cleanup on popup open

## Implementation Files

- `utils/cache.js` - Core caching utility
- `GQLQueries/getUserProfilePic.js` - Profile picture caching
- `GQLQueries/getUserProblemStats.js` - User stats caching
- `GQLQueries/recentACSubmissions.js` - Submissions caching
- `popup/popup.js` - Cache cleanup integration

## Future Enhancements

Potential improvements:
1. **Background Refresh**: Use `chrome.alarms` to refresh cache periodically
2. **Cache Size Limits**: Implement cache eviction when storage approaches limits
3. **Stale-While-Revalidate**: Show cached data immediately while fetching fresh data in background
4. **Per-User Settings**: Allow users to configure cache TTL values
5. **Cache Statistics**: Display cache hit/miss ratio in settings
