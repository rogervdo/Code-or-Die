# Update Timer Feature

## Overview
Every tab shows the same countdown to the next scheduled data refresh. A single
shared deadline drives both the countdown and the refresh itself, so the timers
on all tabs always agree.

## Display Format

Each tab renders the same text below its content:

- **"Updates in 9m 45s"** - Time left until the next refresh (minutes and seconds)
- **"Updates in 1h 30m"** - Hours and minutes when more than an hour remains
- **"Updates in 2d 5h"** - Days and hours when more than a day remains
- **"Updating…"** - The deadline has passed and a refresh is in flight

## How It Works

1. **Shared deadline** - `nextRefreshAt` (epoch ms) is persisted in
   `chrome.storage.local` and mirrored in memory. Every tab's timer renders that
   one value.
2. **One cycle** - `startRefreshCycle(onRefresh)` checks the deadline once a
   second. When it passes it calls `onRefresh`, which reloads every tab's data,
   then opens the next window with `resetRefreshSchedule()`.
3. **Cache-aware refresh** - The scheduled refresh re-runs the normal load
   functions, which reuse cached entries until their own TTLs expire. The
   "Refresh All Data" button instead clears the caches first
   (`reloadAllData({ force: true })`) and restarts the window.

## Timers

A countdown is rendered on every tab: Activity, Leaderboard, Contest, Global,
and Streaks. All of them show the same shared deadline.

## Technical Implementation

### Files
1. **utils/updateTimer.js** - Shared schedule, countdown element, and refresh cycle
2. **popup/popup.js** - `startSharedRefresh()`, `reloadAllData()`, and button wiring
3. **popup/popup.css** - `.update-timer` styling

### Key Functions

#### `resetRefreshSchedule(from = Date.now())`
Opens a new window and persists `nextRefreshAt = from + REFRESH_INTERVAL_MS`.

#### `restoreRefreshSchedule()`
Loads the persisted deadline, or opens a fresh window when it is missing or has
already elapsed.

#### `createUpdateTimer(containerId)`
Creates the countdown element for one page and updates it every second from the
shared deadline.

#### `startRefreshCycle(onRefresh)`
Runs `onRefresh` when the shared deadline passes, then opens the next window.
Returns a `{ destroy }` handle.

#### `formatTime(ms)`
Converts milliseconds to a human-readable string (e.g. "9m 45s").

## User Benefits

1. **Consistency** - Every tab shows the same countdown.
2. **Transparency** - Users know exactly when the next refresh happens.
3. **Live data** - Data refreshes on the countdown instead of only on reopen.

## Testing

1. Open the extension and confirm every tab shows the same countdown.
2. Switch tabs - the countdown should match.
3. Use "Refresh All Data" - the countdown restarts at 10 minutes.

## Future Enhancements

- Show "Loading…" state while the scheduled refresh runs
- Add a visual indicator when the refresh is under a minute away
- Allow users to configure the refresh interval in settings
