import getUserProblemStats from '../GQLQueries/getUserProblemStats.js';
import getUserProfilePic from '../GQLQueries/getUserProfilePic.js';
import getUserCalendar from '../GQLQueries/getUserCalendar.js';
import getGlobalRanking from '../GQLQueries/getGlobalRanking.js';
import questionDifficulty from '../GQLQueries/questionDifficulty.js';
import getACSubmissions from '../GQLQueries/recentACSubmissions.js';
import cache, { TTL } from '../utils/cache.js';
import { getTodayInTimezone } from '../utils/timezoneHelper.js';
import { createUpdateTimer, resetRefreshSchedule, startRefreshCycle } from '../utils/updateTimer.js';
import {
  accumulateWeeklySubmissions,
  filterSubmissionsInWeek,
  getCurrentWeekBounds,
  getPointsForDifficulty,
} from '../utils/contestUtils.js';
import {
  displayACSubmissions,
  displayActivityHeatmap,
  displayContestLeaderboard,
  displayFriendsList,
  displayGlobalRankings,
  displayLeaderboard,
  displaySolvedStats,
  displayStrikesUsers,
} from './display.js';
import { loadStrikesUsersData } from '../utils/streakUtils.js';
import { showAllSkeletons } from './skeleton.js';

// Countdown elements shown on each tab, plus the single cycle that drives them.
const TIMER_CONTAINERS = ['activity', 'leaderboard', 'contest', 'global-rankings', 'strikes'];
let updateTimers = [];
let refreshCycle = null;

const TAB_CONFIG = [
  { pageId: 'activity', key: 'activity', tabId: 'activity-tab' },
  { pageId: 'leaderboard', key: 'leaderboard', tabId: 'leaderboard-tab' },
  { pageId: 'contest', key: 'contest', tabId: 'contest-tab' },
  { pageId: 'global-rankings', key: 'globalRankings', tabId: 'global-rankings-tab' },
  { pageId: 'strikes', key: 'strikes', tabId: 'strikes-tab' },
];

const DEFAULT_ENABLED_TABS = {
  activity: true,
  leaderboard: true,
  contest: true,
  globalRankings: true,
  strikes: true,
};

let cachedEnabledTabs = { ...DEFAULT_ENABLED_TABS };

function mergeEnabledTabs(stored) {
  return { ...DEFAULT_ENABLED_TABS, ...stored };
}

function getEnabledTabs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['enabledTabs'], (result) => {
      cachedEnabledTabs = mergeEnabledTabs(result.enabledTabs);
      resolve(cachedEnabledTabs);
    });
  });
}

function saveEnabledTabs(enabledTabs) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ enabledTabs }, () => {
      cachedEnabledTabs = enabledTabs;
      resolve();
    });
  });
}

function getFirstEnabledPageId(enabledTabs = cachedEnabledTabs) {
  const firstEnabled = TAB_CONFIG.find((tab) => enabledTabs[tab.key]);
  return firstEnabled ? firstEnabled.pageId : 'activity';
}

function isPageEnabled(pageId, enabledTabs = cachedEnabledTabs) {
  const tab = TAB_CONFIG.find((t) => t.pageId === pageId);
  return tab ? enabledTabs[tab.key] : true;
}

function updateTabToggleDisabledState(enabledTabs) {
  const enabledCount = Object.values(enabledTabs).filter(Boolean).length;
  document.querySelectorAll('[data-tab-key]').forEach((checkbox) => {
    const key = checkbox.dataset.tabKey;
    checkbox.disabled = enabledTabs[key] && enabledCount <= 1;
  });
}

function applyTabVisibility(enabledTabs) {
  TAB_CONFIG.forEach(({ key, tabId }) => {
    const tabEl = document.getElementById(tabId);
    if (tabEl) {
      tabEl.style.display = enabledTabs[key] ? '' : 'none';
    }
  });

  updateTabToggleDisabledState(enabledTabs);

  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const pageId = activePage.id;
    if (pageId !== 'settings' && pageId !== 'username-input' && !isPageEnabled(pageId, enabledTabs)) {
      showPage(getFirstEnabledPageId(enabledTabs));
    }
  }
}

async function initTabVisibilitySettings() {
  const enabledTabs = await getEnabledTabs();

  document.querySelectorAll('[data-tab-key]').forEach((checkbox) => {
    checkbox.checked = enabledTabs[checkbox.dataset.tabKey];
  });

  applyTabVisibility(enabledTabs);
}

// Copy button setting: the copy button in the Streaks tab is hidden unless
// explicitly enabled by the user.
const DEFAULT_COPY_BUTTON_ENABLED = false;

function getCopyButtonEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ copyButtonEnabled: DEFAULT_COPY_BUTTON_ENABLED }, (result) => {
      resolve(result.copyButtonEnabled);
    });
  });
}

function saveCopyButtonEnabled(enabled) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ copyButtonEnabled: enabled }, resolve);
  });
}

function applyCopyButtonEnabled(enabled) {
  const strikesPage = document.getElementById('strikes');
  if (strikesPage) {
    strikesPage.classList.toggle('copy-btn-hidden', !enabled);
  }
}

async function initCopyButtonSetting() {
  const enabled = await getCopyButtonEnabled();
  const toggle = document.getElementById('copy-button-toggle');
  if (toggle) {
    toggle.checked = enabled;
  }
  applyCopyButtonEnabled(enabled);
}

// Podium rank theme: swaps the top-3 row palette between metallic medals and a
// League-style purple/blue/green. Applied via [data-rank-theme] on <html>.
const DEFAULT_RANK_THEME = 'medal';
const RANK_THEMES = ['medal', 'lol'];

function getRankTheme() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ rankTheme: DEFAULT_RANK_THEME }, (result) => {
      resolve(result.rankTheme);
    });
  });
}

function saveRankTheme(theme) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ rankTheme: theme }, resolve);
  });
}

function applyRankTheme(theme) {
  const value = RANK_THEMES.includes(theme) ? theme : DEFAULT_RANK_THEME;
  document.documentElement.setAttribute('data-rank-theme', value);
}

async function initRankThemeSetting() {
  const theme = await getRankTheme();
  const select = document.getElementById('rank-theme-select');
  if (select) {
    select.value = theme;
  }
  applyRankTheme(theme);
}

// Legacy streak corrections for users affected before the fix was implemented
// Format: 'username': { streak: number, asOfDate: 'YYYY-MM-DD' }
// The streak will be recalculated from asOfDate to today when applied
const LEGACY_STREAK_CORRECTIONS = {
  Pablo_Z: { streak: 12, asOfDate: '2025-11-15' },
  Jordx: { streak: 11, asOfDate: '2025-11-15' },
};

/**
 * Initialize previousStreaks with legacy corrections if needed
 * This runs once when the extension loads after the update
 * Calculates forward from the reference date to account for late updates
 */
async function initializeLegacyStreaks() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['previousStreaks', 'legacyStreaksApplied', 'timezone'], async (result) => {
      // Only apply legacy corrections if they haven't been applied yet
      if (result.legacyStreaksApplied) {
        console.log('[Legacy Streaks] Already applied, skipping');
        resolve();
        return;
      }

      const currentStreaks = result.previousStreaks || {};
      const dailyActivityLog = result.dailyActivityLog || {};
      const timezone = result.timezone || 'America/Chicago';
      let updated = false;
      let activityLogUpdated = false;

      // Apply legacy corrections with date calculation
      for (const [username, correction] of Object.entries(LEGACY_STREAK_CORRECTIONS)) {
        try {
          const { streak: baseStreak, asOfDate } = correction;

          // Calculate how many days have passed since the reference date
          const referenceDate = new Date(asOfDate + 'T00:00:00');
          const today = new Date();
          const daysPassed = Math.floor((today - referenceDate) / (1000 * 60 * 60 * 24));

          console.log(
            `[Legacy Streaks] ${username}: Base streak ${baseStreak} as of ${asOfDate}, ${daysPassed} days ago`
          );

          // Backfill activity log for the streak days
          // This creates the immutable record needed for strike detection
          if (!dailyActivityLog[username]) {
            dailyActivityLog[username] = {};
          }

          if (daysPassed === 0) {
            // Same day as reference, use base streak
            currentStreaks[username] = baseStreak;
            console.log(`[Legacy Streaks] ${username}: Set to ${baseStreak} (reference day)`);

            // Backfill activity log for reference date
            dailyActivityLog[username][asOfDate] = true;
            activityLogUpdated = true;
            updated = true;
          } else if (daysPassed > 0) {
            // Days have passed, need to check if they solved problems in between
            // Fetch their submissions to see activity since reference date
            const submissions = await getACSubmissions(username, 30);

            // Count consecutive days WITH submissions from reference date forward
            let additionalDays = 0;
            const activeDates = [asOfDate]; // Start with reference date

            for (let daysAgo = daysPassed - 1; daysAgo >= 0; daysAgo--) {
              const targetDate = new Date(today);
              targetDate.setDate(targetDate.getDate() - daysAgo);
              const targetDateStr = targetDate.toLocaleDateString('en-CA', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              });

              const daySubmissions = submissions.filter((submission) => {
                const submissionDate = new Date(submission.timestamp * 1000);
                return submissionDate.toDateString() === targetDate.toDateString();
              });

              if (daySubmissions.length > 0) {
                additionalDays++;
                activeDates.push(targetDateStr);
              } else {
                // Gap found, streak broken
                console.log(`[Legacy Streaks] ${username}: Streak broken ${daysAgo} days ago`);
                break;
              }
            }

            const finalStreak = baseStreak + additionalDays;
            currentStreaks[username] = finalStreak;
            console.log(
              `[Legacy Streaks] ${username}: Calculated ${finalStreak} (base ${baseStreak} + ${additionalDays} additional days)`
            );

            // Backfill activity log for all active dates
            activeDates.forEach((date) => {
              dailyActivityLog[username][date] = true;
            });
            console.log(`[Legacy Streaks] ${username}: Backfilled ${activeDates.length} days to activity log`);
            activityLogUpdated = true;
            updated = true;
          }
        } catch (error) {
          console.error(`[Legacy Streaks] Error processing ${username}:`, error);
        }
      }

      if (updated || Object.keys(LEGACY_STREAK_CORRECTIONS).length > 0) {
        // Save updated streaks, activity log, and mark legacy corrections as applied
        const dataToSave = {
          previousStreaks: currentStreaks,
          legacyStreaksApplied: true,
        };

        if (activityLogUpdated) {
          dataToSave.dailyActivityLog = dailyActivityLog;
        }

        chrome.storage.local.set(dataToSave, () => {
          console.log('[Legacy Streaks] Corrections applied and marked complete');
          console.log('[Legacy Streaks] Final streaks:', currentStreaks);
          if (activityLogUpdated) {
            console.log('[Legacy Streaks] Activity log backfilled');
          }
          resolve();
        });
      } else {
        // No corrections to apply, just mark as done
        chrome.storage.local.set({ legacyStreaksApplied: true }, () => {
          console.log('[Legacy Streaks] No corrections needed');
          resolve();
        });
      }
    });
  });
}

/**
 * Listener for username submission
 *
 * Triggered when user clicks "Submit" button to enter their username at
 * beginning of extension.
 *
 * Checks if valid and fetch AC and leaderboard data.
 */
document.getElementById('submit-username').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  // check if the username is valid by calling getUserProfilePic
  const userData = await getUserProfilePic(username);

  if (username) {
    if (userData === null) {
      alert('The username you entered is invalid. Please try again.');
    } else {
      chrome.storage.local.set({ username: username }, async function () {
        console.log('Username is set to ' + username);
        currentUsername = username;
        setProfileHeader(username);
        loadSelfSummary(username);
        showAllSkeletons();
        showPage(getFirstEnabledPageId());
        const data = await getACSubmissions(username, 5);
        cachedActivitySubmissions = data;
        displayACSubmissions(data, username);
        startSharedRefresh();
        showPage(getFirstEnabledPageId());

        // display leaderboard for first time, repeat code since DOM update already happened
        chrome.storage.local.get({ maxStrikes: 3, timezone: 'America/Chicago', strikesStreaksView: 'both' }, async (result) => {
          const timezone = result.timezone;
          const maxStrikes = result.maxStrikes;

          // Load strikes users data
          cachedStrikesStreaksView = result.strikesStreaksView;
          document.getElementById('max-strikes-input').value = maxStrikes;
          document.getElementById('timezone-select').value = result.timezone;
          document.getElementById('strikes-streaks-select').value = result.strikesStreaksView;
          const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
            [],
            username,
            maxStrikes,
            timezone
          );
          cachedStrikesData = strikesUsers;
          cachedClearedStrikesData = clearedStrikesUsers;
          cachedStreaksData = streaksUsers;
          displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, username, cachedStrikesStreaksView);

          // Load contest data
          const contestResult = await loadContestData([], username, timezone);
          cachedContestData = contestResult.contestData;
          displayContestLeaderboard(
            contestResult.contestData,
            contestResult.weekStart,
            contestResult.weekEnd,
            username
          );

          cachedGlobalRankingsData = await loadGlobalRankingsData([], username, timezone);
          displayGlobalRankings(cachedGlobalRankingsData, username);

          // Load leaderboard data
          let leaderboardData = [await getUserProblemStats(username)];
          console.log(leaderboardData);

          // Fetch all profile pics
          leaderboardData = leaderboardData.map(async (stat) => {
            const userData = await getUserProfilePic(stat.username);
            const avatar = userData.userAvatar;
            return { ...stat, avatar };
          });

          const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
          Promise.all(leaderboardData).then((friendData) => {
            leaderboardTabs.forEach((tab) => {
              tab.addEventListener('click', () => {
                // once tab is clicked, change active and display new leaderboard data
                leaderboardTabs.forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                let difficulty = tab.getAttribute('data-difficulty');
                const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Weekly: 4 };
                displayLeaderboard(friendData, getWeeklyLeaderboardData(), username, diffMap[difficulty]);
              });
            });
            // load default tab as All for leaderboard
            const defaultTab = document.querySelector('.leaderboard-tab[data-difficulty="All"]');
            defaultTab.classList.add('active');
            displayLeaderboard(friendData, null, username, 0);
          });
        });
      });
    }
  } else {
    alert('Empty username. Please enter a username');
  }
});

/**
 * Listener for DOM Content Load (beginning of extension open)
 *
 * Validate current username, fetch AC submissions of self and friendss,
 * fetch friend list, and fetch leaderboard data
 */
document.addEventListener('DOMContentLoaded', async function () {
  // Clean up expired cache entries on popup open
  const removedCount = await cache.cleanExpired();
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} expired cache entries`);
  }

  // Initialize legacy streak corrections (runs once after update)
  await initializeLegacyStreaks();

  await initTabVisibilitySettings();
  await initCopyButtonSetting();
  await initRankThemeSetting();

  // DISABLED COLOR SCHEME TOGGLE - light mode looks bad
  // document.getElementById('mode-toggle').addEventListener('change', function() {
  //     if (this.checked) {
  //         document.documentElement.setAttribute('data-theme', 'light');
  //     } else {
  //         document.documentElement.setAttribute('data-theme', 'dark');
  //     }
  // });

  // check if username is already stored, else prompt
  chrome.storage.local.get('username', async function (result) {
    if (!result.username) {
      showPage('username-input');
    } else {
      console.log('Welcome back, ' + result.username);
      showAllSkeletons();
      showPage(getFirstEnabledPageId());
      // load in user AC data
      let allSubmissions = [];
      const data = await getACSubmissions(result.username, 5);
      allSubmissions = allSubmissions.concat(data);
      const currUsername = result.username;
      currentUsername = currUsername;
      setProfileHeader(currUsername);
      loadSelfSummary(currUsername);
      startSharedRefresh();

      // load in friend data
      chrome.storage.local.get({ friends: [] }, async (result) => {
        displayFriendsList(result.friends);

        // Load in AC data for activity page - CHANGE LIMIT BASED ON FRIENDS LIST
        // need to do this so promises resolve before updating in forEach
        Promise.all(result.friends.map((friend) => getACSubmissions(friend, 5))).then((friendData) => {
          friendData.forEach((submissions) => {
            allSubmissions = allSubmissions.concat(submissions);
          });
          cachedActivitySubmissions = allSubmissions;
          displayACSubmissions(allSubmissions, currUsername);
        });
        // default to first enabled tab
        showPage(getFirstEnabledPageId());

        // Load strikes users data with stored max strikes and timezone values
        chrome.storage.local.get({ maxStrikes: 3, timezone: 'America/Chicago', strikesStreaksView: 'both' }, async (strikesResult) => {
          const maxStrikes = strikesResult.maxStrikes;
          const timezone = strikesResult.timezone;

          cachedStrikesStreaksView = strikesResult.strikesStreaksView;
          document.getElementById('max-strikes-input').value = maxStrikes;
          document.getElementById('timezone-select').value = strikesResult.timezone;
          document.getElementById('strikes-streaks-select').value = strikesResult.strikesStreaksView;
          const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
            result.friends,
            currUsername,
            maxStrikes,
            timezone
          );
          cachedStrikesData = strikesUsers;
          cachedClearedStrikesData = clearedStrikesUsers;
          cachedStreaksData = streaksUsers;
          displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, currUsername, cachedStrikesStreaksView);

          // Load contest data
          const contestResult = await loadContestData(result.friends, currUsername, timezone);
          cachedContestData = contestResult.contestData;
          displayContestLeaderboard(
            contestResult.contestData,
            contestResult.weekStart,
            contestResult.weekEnd,
            currUsername
          );

          cachedGlobalRankingsData = await loadGlobalRankingsData(result.friends, currUsername, timezone);
          displayGlobalRankings(cachedGlobalRankingsData, currUsername);
        });

        // Load in friend leaderboard data
        let leaderboardData = await getUserProblemStats(currUsername);
        Promise.all(result.friends.map((friend) => getUserProblemStats(friend))).then((friendData) => {
          // fetch profile pics for each user

          // for each tab listen for click
          const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
          friendData.push(leaderboardData);

          // Fetch all profile pics
          friendData = friendData.map(async (stat) => {
            const userData = await getUserProfilePic(stat.username);
            const avatar = userData.userAvatar;
            return { ...stat, avatar };
          });

          Promise.all(friendData).then((friendData) => {
            leaderboardTabs.forEach((tab) => {
              tab.addEventListener('click', () => {
                // once tab is clicked, change active and display new leaderboard data
                leaderboardTabs.forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                let difficulty = tab.getAttribute('data-difficulty');
                const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Weekly: 4 };
                displayLeaderboard(friendData, getWeeklyLeaderboardData(), currUsername, diffMap[difficulty]);
              });
            });
            // load default tab as All for leaderboard
            const defaultTab = document.querySelector('.leaderboard-tab[data-difficulty="All"]');
            defaultTab.classList.add('active');
            displayLeaderboard(friendData, null, currUsername, 0);
          });
        });
      });
    }
  });
});

/**
 * Builds the weekly leaderboard from the accumulated contest data, ranking
 * users by how many problems they solved this week.
 * @returns {object[]} - An array of { username, avatar, count } sorted by count.
 */
function getWeeklyLeaderboardData() {
  return cachedContestData
    .map(({ username, avatar, submissions }) => ({
      username,
      avatar,
      count: Array.isArray(submissions) ? submissions.length : 0,
    }))
    .sort((x, y) => y.count - x.count);
}

/**
 * Loads contest leaderboard data for the current week (Monday-Sunday)
 * Calculates points based on difficulty: Easy = 1pt, Medium = 3pt, Hard = 6pt
 * @param {string[]} friends - An array of usernames representing the friends of the current user
 * @param {string} username - The username of the current user
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @returns {object} - Object containing contestData array and week info
 */
async function loadContestData(friends, username, timezone = 'America/Chicago') {
  // Handle auto-detect timezone
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  const { weekStart, weekEnd, weekStartFormatted, weekEndFormatted } = getCurrentWeekBounds(timezone);

  // Create cache key based on all users and current week
  const allUsers = [username, ...friends].sort();
  const cacheKey = `contest_${allUsers.join('_')}_${weekStartFormatted}`;

  // Check cache first
  const cachedData = await cache.get(cacheKey);
  if (cachedData !== null) {
    console.log(`Cache hit for contest data: ${cacheKey}`);
    return cachedData;
  }

  console.log(`Cache miss for contest data: ${cacheKey}, fetching from API`);

  const contestData = [];

  // Fetch submissions for each user. The public LeetCode endpoint caps results
  // at 20 regardless of the requested limit, so we filter to the current week
  // and merge each batch into a per-user weekly store. This accumulates
  // submissions across refreshes and captures more than the 20 most recent
  // when a user has been highly active.
  for (const user of allUsers) {
    const submissions = await getACSubmissions(user, 20);
    const userData = await getUserProfilePic(user);

    // Filter to the current week before accumulating so the store stays bounded
    const recentWeekSubmissions = filterSubmissionsInWeek(submissions, weekStart, weekEnd, timezone);
    const weekSubmissions = await accumulateWeeklySubmissions(user, weekStartFormatted, recentWeekSubmissions);

    // Calculate points for each submission
    let totalPoints = 0;
    const problemsWithDifficulty = await Promise.all(
      weekSubmissions.map(async (submission) => {
        const problemData = await questionDifficulty(submission.titleSlug);
        const difficulty = problemData.difficulty;
        const points = getPointsForDifficulty(difficulty);

        totalPoints += points;

        return { ...submission, difficulty, points };
      })
    );

    contestData.push({
      username: user,
      avatar: userData.userAvatar,
      points: totalPoints,
      submissions: problemsWithDifficulty,
    });
  }

  // Sort by points descending
  contestData.sort((a, b) => b.points - a.points);

  const result = {
    contestData,
    weekStart: weekStartFormatted,
    weekEnd: weekEndFormatted,
  };

  // Cache the result with 30-minute TTL
  await cache.set(cacheKey, result, TTL.CONTEST);

  return result;
}

/**
 * Finds the most recent stored rank before today for a user.
 * @param {Object} userDates - Map of YYYY-MM-DD to rank
 * @param {string} todayStr - Today's date string
 * @returns {{ rank: number, date: string } | null}
 */
function getMostRecentPriorRank(userDates, todayStr) {
  if (!userDates) {
    return null;
  }

  const priorDates = Object.keys(userDates)
    .filter((date) => date < todayStr)
    .sort();

  if (priorDates.length === 0) {
    return null;
  }

  const date = priorDates[priorDates.length - 1];
  return { rank: userDates[date], date };
}

/**
 * Loads problem-solving rank data for the current user and their friends.
 * Compares current ranks against the most recent prior daily snapshot, or last view.
 * @param {string[]} friends - An array of usernames representing the friends of the current user
 * @param {string} username - The username of the current user
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @param {object} options - Optional settings
 * @param {boolean} options.updateSnapshots - Whether to persist new rank snapshots (default true)
 * @returns {object[]} - An array of user objects with problem rank data and change info
 */
async function loadGlobalRankingsData(friends, username, timezone = 'America/Chicago', options = {}) {
  const { updateSnapshots = true } = options;
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  const allUsers = [username, ...friends];
  const todayStr = getTodayInTimezone(timezone);

  const storageResult = await new Promise((resolve) => {
    chrome.storage.local.get(['problemRankSnapshots'], resolve);
  });
  const problemRankSnapshots = storageResult.problemRankSnapshots || { lastViewed: {}, byDate: {} };

  const rankingsPromises = allUsers.map(async (user) => {
    const rankingData = await getGlobalRanking(user);
    const userData = await getUserProfilePic(user);

    let rankChange = null;
    let changeSource = null;
    let changeReferenceDate = null;

    if (rankingData.problemRank !== null) {
      const priorSnapshot = getMostRecentPriorRank(problemRankSnapshots.byDate?.[user], todayStr);

      if (priorSnapshot !== null) {
        rankChange = priorSnapshot.rank - rankingData.problemRank;
        changeSource = 'priorDay';
        changeReferenceDate = priorSnapshot.date;
      } else if (problemRankSnapshots.lastViewed?.[user] !== undefined) {
        rankChange = problemRankSnapshots.lastViewed[user] - rankingData.problemRank;
        changeSource = 'lastView';
      }
    }

    return {
      ...rankingData,
      avatar: userData.userAvatar,
      rankChange,
      changeSource,
      changeReferenceDate,
    };
  });

  const rankingsData = await Promise.all(rankingsPromises);

  if (!updateSnapshots) {
    return rankingsData;
  }

  const updatedSnapshots = {
    lastViewed: { ...(problemRankSnapshots.lastViewed || {}) },
    byDate: { ...(problemRankSnapshots.byDate || {}) },
  };

  rankingsData.forEach((user) => {
    if (user.problemRank !== null) {
      updatedSnapshots.lastViewed[user.username] = user.problemRank;

      if (!updatedSnapshots.byDate[user.username]) {
        updatedSnapshots.byDate[user.username] = {};
      }
      updatedSnapshots.byDate[user.username][todayStr] = user.problemRank;

      const dates = Object.keys(updatedSnapshots.byDate[user.username]).sort();
      if (dates.length > 60) {
        dates.slice(0, dates.length - 60).forEach((date) => {
          delete updatedSnapshots.byDate[user.username][date];
        });
      }
    }
  });

  await new Promise((resolve) => {
    chrome.storage.local.set({ problemRankSnapshots: updatedSnapshots }, resolve);
  });

  return rankingsData;
}

/**
 * Listener for add friend button
 *
 * Check if the entered username is valid, if so add, else throw error
 */
document.getElementById('add-friend-btn').addEventListener('click', async () => {
  const friendUsername = document.getElementById('friend-username').value.trim();

  // check if the username is valid by calling getUserProfilePic
  const userData = await getUserProfilePic(friendUsername);

  if (friendUsername) {
    if (userData === null) {
      alert('The username you entered is invalid. Please try again.');
    } else {
      chrome.storage.local.get({ friends: [] }, (result) => {
        const friends = result.friends;
        if (!friends.includes(friendUsername)) {
          friends.push(friendUsername);
          chrome.storage.local.set({ friends }, () => {
            console.log(`Friend ${friendUsername} added.`);
            displayFriendsList(friends);
          });
        } else {
          console.log(`Friend ${friendUsername} is already in the list.`);
        }
      });
    }
  } else {
    alert('Empty username. Please enter a username');
  }
});

/**
 * Listener for update max strikes button
 */
document.getElementById('update-max-strikes-btn').addEventListener('click', async () => {
  const maxStrikesInput = document.getElementById('max-strikes-input');
  const maxStrikes = parseInt(maxStrikesInput.value);

  if (maxStrikes < 1 || maxStrikes > 30) {
    alert('Please enter a value between 1 and 30');
    return;
  }

  // Store the max strikes value
  chrome.storage.local.set({ maxStrikes: maxStrikes }, async () => {
    console.log('Max strikes set to ' + maxStrikes);

    // Reload strikes data with new max value and current timezone
    chrome.storage.local.get(['username', 'friends', 'timezone'], async (result) => {
      if (result.username) {
        const timezone = result.timezone || 'America/Chicago';
        const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
          result.friends || [],
          result.username,
          maxStrikes,
          timezone
        );
        cachedStrikesData = strikesUsers;
        cachedClearedStrikesData = clearedStrikesUsers;
        cachedStreaksData = streaksUsers;
        displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, result.username, cachedStrikesStreaksView);
      }
    });
  });
});

/**
 * Listener for timezone setting change
 */
document.getElementById('timezone-select').addEventListener('change', async () => {
  const timezoneSelect = document.getElementById('timezone-select');
  const selectedTimezone = timezoneSelect.value;

  // Store the timezone value
  chrome.storage.local.set({ timezone: selectedTimezone }, async () => {
    console.log('Timezone set to ' + selectedTimezone);

    // Reload strikes data with new timezone
    chrome.storage.local.get(['username', 'friends', 'maxStrikes'], async (result) => {
      if (result.username) {
        const maxStrikes = result.maxStrikes || 3;
        const timezone = selectedTimezone;
        const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
          result.friends || [],
          result.username,
          maxStrikes,
          timezone
        );
        cachedStrikesData = strikesUsers;
        cachedClearedStrikesData = clearedStrikesUsers;
        cachedStreaksData = streaksUsers;
        displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, result.username, cachedStrikesStreaksView);
      }
    });
  });
});

/**
 * Listener for the streaks/strikes display setting
 */
document.getElementById('strikes-streaks-select').addEventListener('change', async (event) => {
  const viewMode = event.target.value;
  cachedStrikesStreaksView = viewMode;

  await new Promise((resolve) => chrome.storage.local.set({ strikesStreaksView: viewMode }, resolve));

  displayStrikesUsers(cachedStrikesData, cachedClearedStrikesData, cachedStreaksData, currentUsername, viewMode);
});

/**
 * Listener for copy strikes button
 */
let cachedStrikesData = [];
let cachedClearedStrikesData = [];
let cachedStreaksData = [];
let cachedStrikesStreaksView = 'both';
let cachedContestData = [];
let cachedGlobalRankingsData = [];
let cachedActivitySubmissions = [];
let currentUsername = '';

document.getElementById('copy-strikes-btn').addEventListener('click', () => {
  if (
    (!cachedStrikesData || cachedStrikesData.length === 0) &&
    (!cachedClearedStrikesData || cachedClearedStrikesData.length === 0) &&
    (!cachedStreaksData || cachedStreaksData.length === 0)
  ) {
    alert('No data to copy!');
    return;
  }

  // Build the formatted text
  let clipboardText = '';

  // Add streaks first (sorted by streak count descending)
  if (cachedStreaksData && cachedStreaksData.length > 0) {
    cachedStreaksData.forEach((user) => {
      clipboardText += `${user.username} 🔥[${user.streak}]\n`;
    });
    clipboardText += '\n';
  }

  // Add cleared strikes users (with checkmark)
  if (cachedClearedStrikesData && cachedClearedStrikesData.length > 0) {
    cachedClearedStrikesData.forEach((user) => {
      clipboardText += `${user.username} ✅\n`;
    });
    clipboardText += '\n';
  }

  // Group users by strike count
  const strikeGroups = {};
  cachedStrikesData.forEach((user) => {
    if (!strikeGroups[user.strikes]) {
      strikeGroups[user.strikes] = [];
    }
    strikeGroups[user.strikes].push(user.username);
  });

  // Sort strike numbers in ascending order
  const sortedStrikeNumbers = Object.keys(strikeGroups)
    .map(Number)
    .sort((a, b) => a - b);

  // Add strikes sections
  sortedStrikeNumbers.forEach((strikeCount) => {
    const emojis = '❌'.repeat(strikeCount);
    clipboardText += `Strike ${strikeCount} ${emojis}:\n`;
    strikeGroups[strikeCount].forEach((username) => {
      clipboardText += `${username}\n`;
    });
    clipboardText += '\n';
  });

  // Copy to clipboard
  navigator.clipboard
    .writeText(clipboardText.trim())
    .then(() => {
      // Visual feedback
      const button = document.getElementById('copy-strikes-btn');
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 1000);
    })
    .catch((err) => {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    });
});

/**
 * Reloads every tab's data. When `force` is true the caches are cleared first so
 * fresh data is always fetched; otherwise cached entries are reused until their
 * own TTLs expire (used by the shared refresh cycle).
 * @param {object} [options]
 * @param {boolean} [options.force=false]
 */
async function reloadAllData({ force = false } = {}) {
  const { username, friends = [], maxStrikes = 3, timezone = 'America/Chicago' } = await new Promise((resolve) =>
    chrome.storage.local.get(
      { username: null, friends: [], maxStrikes: 3, timezone: 'America/Chicago' },
      resolve
    )
  );

  if (!username) {
    return;
  }

  const allUsers = [username, ...friends];

  if (force) {
    for (const user of allUsers) {
      await cache.delete(`submissions_${user}_5`);
      await cache.delete(`submissions_${user}_20`);
      await cache.delete(`submissions_${user}_30`);
      await cache.delete(`submissions_${user}_50`);
      await cache.delete(`user_stats_${user}`);
      await cache.delete(`problem_ranking_${user}`);
      await cache.delete(`user_calendar_${user}`);
    }

    const { weekStart } = getCurrentWeekBounds(timezone);
    const weekStartFormatted = weekStart.toISOString().split('T')[0];
    const sortedUsers = [...allUsers].sort();
    await cache.delete(`contest_${sortedUsers.join('_')}_${weekStartFormatted}`);

    const todayStr = getTodayInTimezone(timezone);
    await cache.delete(`strikes_${sortedUsers.join('_')}_${maxStrikes}_${todayStr}`);
  }

  // Activity
  currentUsername = username;
  let allSubmissions = [await getACSubmissions(username, 5)];
  const friendSubmissions = await Promise.all(friends.map((friend) => getACSubmissions(friend, 5)));
  friendSubmissions.forEach((submissions) => {
    allSubmissions = allSubmissions.concat(submissions);
  });
  cachedActivitySubmissions = allSubmissions;
  displayACSubmissions(allSubmissions, username);
  loadSelfSummary(username);

  // Contest (loaded before the leaderboard so the Weekly view can reuse it)
  const contestResult = await loadContestData(friends, username, timezone);
  cachedContestData = contestResult.contestData;
  displayContestLeaderboard(contestResult.contestData, contestResult.weekStart, contestResult.weekEnd, username);

  // Leaderboard
  const leaderboardData = await getUserProblemStats(username);
  const leaderboardFriendData = await Promise.all(friends.map((friend) => getUserProblemStats(friend)));
  leaderboardFriendData.push(leaderboardData);

  const friendDataResolved = await Promise.all(
    leaderboardFriendData.map(async (stat) => {
      const userData = await getUserProfilePic(stat.username);
      return { ...stat, avatar: userData.userAvatar };
    })
  );

  // Rebind the leaderboard tabs after their rows are re-rendered
  document.querySelectorAll('.leaderboard-tab').forEach((tab) => {
    const newTab = tab.cloneNode(true);
    tab.parentNode.replaceChild(newTab, tab);
  });

  document.querySelectorAll('.leaderboard-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.leaderboard-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const difficulty = tab.getAttribute('data-difficulty');
      const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Weekly: 4 };
      displayLeaderboard(friendDataResolved, getWeeklyLeaderboardData(), username, diffMap[difficulty]);
    });
  });

  const activeTab = document.querySelector('.leaderboard-tab.active');
  const difficulty = activeTab ? activeTab.getAttribute('data-difficulty') : 'All';
  const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Weekly: 4 };
  displayLeaderboard(friendDataResolved, getWeeklyLeaderboardData(), username, diffMap[difficulty]);

  // Strikes
  const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
    friends,
    username,
    maxStrikes,
    timezone
  );
  cachedStrikesData = strikesUsers;
  cachedClearedStrikesData = clearedStrikesUsers;
  cachedStreaksData = streaksUsers;
  displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, username, cachedStrikesStreaksView);

  // Global rankings
  cachedGlobalRankingsData = await loadGlobalRankingsData(friends, username, timezone, {
    updateSnapshots: false,
  });
  displayGlobalRankings(cachedGlobalRankingsData, username);
}

/**
 * Renders the shared countdown on every tab and runs the single refresh cycle
 * that re-checks all data when it elapses.
 */
async function startSharedRefresh() {
  try {
    if (updateTimers.length === 0) {
      updateTimers = TIMER_CONTAINERS.map((id) => createUpdateTimer(id));
    }

    if (refreshCycle) {
      refreshCycle.destroy();
    }
    refreshCycle = await startRefreshCycle(() => reloadAllData());
  } catch (error) {
    console.error('Failed to start refresh cycle:', error);
  }
}

/**
 * Listener for refresh all data button in settings
 */
document.getElementById('refresh-all-btn').addEventListener('click', async () => {
  const button = document.getElementById('refresh-all-btn');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '⏳ Refreshing...';
  showAllSkeletons();

  try {
    await reloadAllData({ force: true });
    await resetRefreshSchedule();
    alert('All data refreshed successfully!');
  } catch (error) {
    console.error('Error refreshing all data:', error);
    alert('Error refreshing data. Please try again.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

/**
 * Listener for tab changes
 */
document.getElementById('activity-tab').addEventListener('click', () => showPage('activity'));
document.getElementById('leaderboard-tab').addEventListener('click', () => showPage('leaderboard'));
document.getElementById('contest-tab').addEventListener('click', () => showPage('contest'));
document.getElementById('global-rankings-tab').addEventListener('click', () => showPage('global-rankings'));
document.getElementById('strikes-tab').addEventListener('click', () => showPage('strikes'));

/**
 * Listener for settings icon in navbar
 */
document.getElementById('settings-icon').addEventListener('click', () => showPage('settings'));

document.getElementById('tab-visibility-toggles').addEventListener('change', async (event) => {
  const checkbox = event.target;
  if (!checkbox.matches('[data-tab-key]')) {
    return;
  }

  const key = checkbox.dataset.tabKey;
  const enabledTabs = await getEnabledTabs();

  if (!checkbox.checked) {
    const enabledCount = Object.values(enabledTabs).filter(Boolean).length;
    if (enabledCount <= 1) {
      checkbox.checked = true;
      return;
    }
  }

  enabledTabs[key] = checkbox.checked;
  await saveEnabledTabs(enabledTabs);
  applyTabVisibility(enabledTabs);
});

/**
 * Listener for the copy button setting
 */
document.getElementById('copy-button-toggle').addEventListener('change', async (event) => {
  const enabled = event.target.checked;
  await saveCopyButtonEnabled(enabled);
  applyCopyButtonEnabled(enabled);
});

/**
 * Listener for the podium rank theme setting
 */
document.getElementById('rank-theme-select').addEventListener('change', async (event) => {
  const theme = event.target.value;
  await saveRankTheme(theme);
  applyRankTheme(theme);
});

/**
 * Listener for activity search filter
 */
document.getElementById('activity-search').addEventListener('input', (e) => {
  const filterText = e.target.value;
  displayACSubmissions(cachedActivitySubmissions, currentUsername, filterText);
});

/**
 * Listener for clear filter button
 */
document.getElementById('activity-clear-filter').addEventListener('click', () => {
  document.getElementById('activity-search').value = '';
  displayACSubmissions(cachedActivitySubmissions, currentUsername, '');
});

/**
 * Populates the profile row in the top-left with the current user's avatar
 * and username. Reveals the identity block only once a username is known.
 * @param {String} username - The current user's LeetCode username.
 */
async function setProfileHeader(username) {
  if (!username) return;

  const identity = document.getElementById('profile-identity');
  const selfUsername = document.getElementById('self-username');
  selfUsername.textContent = username;
  selfUsername.onclick = () => {
    window.open(`https://leetcode.com/${encodeURIComponent(username)}/`, '_blank', 'noopener');
  };

  try {
    const profile = await getUserProfilePic(username);
    if (profile?.userAvatar) {
      document.getElementById('self-avatar').src = profile.userAvatar;
    }
  } catch (error) {
    console.error('Failed to load profile avatar:', error);
  }

  identity.hidden = false;
}

/**
 * Loads and renders the current user's solved totals and 30-day activity
 * heatmap at the top of the Activity tab.
 * @param {String} username - The current user's LeetCode username.
 */
async function loadSelfSummary(username) {
  if (!username) return;

  try {
    const [stats, calendar] = await Promise.all([
      getUserProblemStats(username),
      getUserCalendar(username),
    ]);
    displaySolvedStats(stats);
    displayActivityHeatmap(calendar);
  } catch (error) {
    console.error('Failed to load user summary:', error);
  }
}

/**
 * Changes which page is shown as content based off tab bar.
 * @param {String} pageId - The id of the page chosen.
 */
function showPage(pageId) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.remove('active');
  });

  document.querySelectorAll('.page').forEach((page) => {
    page.classList.remove('active');
  });

  document.getElementById(pageId).classList.add('active');
  // Settings page doesn't have a tab, it's triggered by the cogwheel icon
  if (pageId === 'username-input' || pageId === 'settings') {
    return;
  }
  const activeTabId = `${pageId.concat('-tab')}`;
  document.getElementById(activeTabId).classList.add('active');
}

