# Caching Implementation

## Overview
The extension caches LeetCode GraphQL results in `chrome.storage.local` with TTL
(Time To Live) support, so reopening the popup is instant and repeat requests
are avoided. Every query goes through `utils/gqlClient.js` and
`cache.remember(...)`, which also collapses duplicate concurrent requests.

## TTL (Time To Live) Values
- **Profile pictures**: 7 days — rarely change; Refresh All clears them
- **Problem difficulty**: 24 hours — immutable, so cached long-lived
- **User problem stats**: 1 hour — change slowly as users solve problems
- **Global ranking**: 1 hour
- **Recent submissions**: 10 minutes — the most dynamic data
- **Contest / weekly leaderboard**: 30 minutes
- **Strikes / streaks**: 10 minutes, capped so it never crosses local midnight

## How It Works

### Cache Structure
Each entry is stored as:
```javascript
{
  value: <cached_data>,
  expiresAt: <timestamp_when_expires>,
  cachedAt: <timestamp_when_cached>
}
```

### Cache Keys
- Profile picture: `cache_profile_pic_{username}`
- User stats: `cache_user_stats_{username}`
- Recent submissions: `cache_submissions_{username}` (limit-independent)
- Problem ranking: `cache_problem_ranking_{username}`
- Submission calendar: `cache_user_calendar_{username}`
- Problem difficulty: `cache_difficulty_{titleSlug}`
- Strikes batch: `cache_strikes_{users}_{maxStrikes}_{date}`
- Contest batch: `cache_contest_{users}_{weekStart}`

`recentAcSubmissionList` is clamped to 20 rows by LeetCode, so submissions are
fetched once per user at limit 20 and sliced for the Activity (5), Contest (20)
and Streaks (30) views — one cache entry serves all three instead of three keys.

### Cache Operations
1. **Get**: retrieve data if present and not expired
2. **Set**: store data with an expiration timestamp
3. **Has**: check whether a valid entry exists
4. **Delete**: remove a specific entry
5. **Clear**: remove every `cache_*` entry
6. **CleanExpired**: remove expired entries (runs on popup open)
7. **Remember**: return the cached value, or run a loader once and cache it.
   Concurrent callers for the same key share a single loader call, so a cold
   cache never issues duplicate requests.

## Request Pipeline
- **`utils/gqlClient.js`** is the only place that POSTs to LeetCode. It caps
  total in-flight requests at 6 (FIFO — work enqueued first is served first, so
  the activity feed and self summary beat the deferred tabs) and retries
  transient `429`/`5xx` responses with exponential backoff.
- **`utils/concurrency.js`** provides `mapLimit` for bounded per-fan-out work.
  Per-user fetches run in parallel; anything with a shared storage write
  (strikes batch, weekly contest store) fetches in parallel then persists
  sequentially, so the merges stay race-free.
- **Priority order**: on open, the profile header, self summary and Activity
  feed are started first; Contest / Leaderboard / Streaks / Global Rankings then
  load concurrently.

## Benefits

### Performance Improvements
- **Faster loading**: cached data renders instantly; difficulty colors no longer
  refetch on every Activity render or filter keystroke
- **Reduced API load**: fewer requests to LeetCode's servers, with a hard
  concurrency ceiling to stay clear of rate limiting

### API Call Reduction
**Before** (cold open, 5 friends): ~36 calls, including the same recent
submissions fetched three times per user and every problem's difficulty
refetched on each render.

**After** (cold open, 5 friends): ~1 submissions call per user, difficulty
fetched once per problem per day, and duplicate self-stats / profile-pic
requests collapsed into one.

**Warm cache** (within TTL): 0 API calls.

## Cache Maintenance

### Automatic Cleanup
Expired entries are removed when the popup opens (`DOMContentLoaded`) and when
an expired entry is read.

### Manual Cache Management
```javascript
import cache from './utils/cache.js';

await cache.clear();                       // every cache entry

await cache.delete('profile_pic_username');
await cache.delete('user_stats_username');
await cache.delete('submissions_username'); // and legacy submissions_username_{limit}
```

## Update Timer
Each page shows a shared countdown to the next scheduled refresh. See
[UPDATE_TIMER.md](UPDATE_TIMER.md).

## Implementation Files
- `utils/cache.js` — core caching + `remember` coalescing
- `utils/gqlClient.js` — GraphQL transport, concurrency cap, retry/backoff
- `utils/concurrency.js` — bounded `mapLimit`
- `GQLQueries/*.js` — per-query caching
- `popup/popup.js` — cache cleanup and load orchestration

## Future Enhancements
1. **Cache size limits**: evict when storage approaches its quota
2. **Stale-while-revalidate**: show cached data while refreshing in the background
3. **Cache statistics**: expose hit/miss counts in settings
