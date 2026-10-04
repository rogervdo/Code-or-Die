# Leetcode or Die

Extension to view the activity of your friends on LeetCode.

Leetcode or Die is an extension that allows you to view your friends LeetCode activity and have friendly competitions through leaderboards that track your problems solved.

Just search up your friends' usernames, add them, and follow your feed for new updates on problems your friends have been solving. Get ideas for new problems to solve, compete on the leaderboard, or keep your friends accountable.

See how many strikes (days in a row) your friends have without doing leetcodes

## Features

- **Activity Feed**: View recent submissions from you and your friends
- **Leaderboard**: Track problem counts across different difficulty levels
- **Weekly Leaderboard**: See who's solved the most problems this week
- **Streaks & Strikes**: Track consecutive days solving (streaks) and days missed (strikes) — with a setting to show either or both
- **Smart Caching**: Fast loading with intelligent caching system

## Performance

This extension now includes a comprehensive caching system that:
- Reduces API calls to LeetCode's servers by up to 90%
- Provides instant loading for cached data
- Automatically expires stale data based on update frequency
- Cleans up expired cache entries automatically

See [CACHING.md](CACHING.md) for detailed information about the caching implementation.

## Contest leaderboard and the 20-submission limit

LeetCode's public `recentAcSubmissionList` GraphQL endpoint returns **at most 20**
submissions, silently ignoring any larger `limit` (requesting 50 returns 20). The
authenticated `submissionList` / `/api/submissions/` endpoints that paginate further
only work for your own logged-in account, so there is no way to fetch more than 20
recent submissions for a friend.

To show a full week on the Contest tab, the extension keeps a **per-user weekly store**
(`weeklySubmissions` in `chrome.storage.local`) and merges each freshly fetched batch
into it (de-duplicated by `titleSlug` + `timestamp`). Because the popup refreshes every
10 minutes while open and on every open, the store accumulates well beyond the latest
20 submissions over the course of the week. The store is scoped to the current week
(Monday-Sunday) and reset when the week rolls over. See `utils/contestUtils.js`.

## Development

Unit tests run on [Vitest](https://vitest.dev/) against a small in-memory `chrome.storage`
mock (`tests/setup.js`), so no browser is required.

```bash
npm install        # first time only
npm test           # run the suite once
npm run test:watch # re-run on change
npm run test:coverage
```

Tests live in `tests/` and cover the pure helpers (`popup/helper.js`,
`utils/timezoneHelper.js`), the caching layer (`utils/cache.js`), the contest/week
logic (`utils/contestUtils.js`), and GraphQL fetching/caching
(`GQLQueries/recentACSubmissions.js`). When packaging the extension, exclude
`node_modules/`, `tests/`, and the npm files.

## How it was built

Leetcode or Die was built and improved upon DakshinD's LeetNet extension. Original repo: https://github.com/DakshinD/LeetNet

