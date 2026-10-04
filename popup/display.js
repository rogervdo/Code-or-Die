/**
 * display.js - This file contains methods that render various pages with new data.
 *              Commonly called inside eventListeners from popup.js
 */

import questionDifficulty from '../GQLQueries/questionDifficulty.js';
import { timeDifference } from './helper.js';
import getUserProfilePic from '../GQLQueries/getUserProfilePic.js';
import { removeFriendData } from '../utils/friendData.js';
import {
  buildActivityGrid,
  formatAxisDate,
  formatHeatmapTooltip,
  getActivityLevel,
} from '../utils/activityHeatmap.js';

/**
 * Displays the friends list.
 * @param {Array} friends - The list of friends.
 */
export function displayFriendsList(friends) {
  const friendsContainer = document.getElementById('friends-list-container');
  friendsContainer.innerHTML = ''; // Clear previous friends list

  if (!friends || friends.length === 0) {
    friendsContainer.innerHTML = '<p>No friends found.</p>';
    return;
  }

  const list = document.createElement('ul');
  list.classList.add('friends-list');

  friends.forEach(friend => {
    const listItem = document.createElement('li');
    listItem.classList.add('friend-item');

    const friendName = document.createElement('span');
    friendName.textContent = friend;

    const removeButton = document.createElement('button');
    removeButton.textContent = 'x';
    removeButton.classList.add('remove-btn');
    removeButton.addEventListener('click', () => {
        // Remove friend from stored list and purge everything we stored for them
        chrome.storage.local.get({ friends: [] }, (result) => {
            const updatedFriends = result.friends.filter(f => f !== friend);
            chrome.storage.local.set({ friends: updatedFriends }, async () => {
            displayFriendsList(updatedFriends);
            await removeFriendData(friend);
            });
        });
    });

    listItem.appendChild(friendName);
    listItem.appendChild(removeButton);
    list.appendChild(listItem);
  });

  friendsContainer.appendChild(list);
}

/**
 * Displays the leaderboard.
 * @param {Array} leaderboardStats - The leaderboard statistics.
 * @param {string} username - The current username.
 * @param {number} diff - The difficulty level (0: All, 1: Easy, 2: Medium, 3: Hard, 4: Weekly).
 *                         4 (Weekly) is a special case, not a difficulty.
 */
export function displayLeaderboard(leaderboardStats, weeklyStats, username, diff) {
  // choose between default leaderboard stats or weekly stats
  if (diff === 4) leaderboardStats = weeklyStats;
  // sort by problems solved
  if (diff !== 4) {
    leaderboardStats.sort(function(x, y) {
      return y.acSubmissionNum[diff].count - x.acSubmissionNum[diff].count;
    })
  }
  

  // create container
  const resultsContainer = document.getElementById('leaderboard-results');
  resultsContainer.innerHTML = ''; // Clear previous results

  if (!leaderboardStats || leaderboardStats.length === 0) {
    resultsContainer.innerHTML = '<p>No friends found.</p>';
    return;
  }

  // Fetch all profile pics
  // const newLeaderboardStats = leaderboardStats.map(async (stat) => {
  //   const userData = await getUserProfilePic(stat.username);
  //   const avatar = userData.userAvatar;
  //   return { ...stat, avatar };
  // });

  Promise.all(leaderboardStats).then((leaderboardStats) => {
    // create each list element
    const list = document.createElement('ul');
    list.classList.add('all-problems-list');

    leaderboardStats.forEach( (stat, idx) => {
      const listItem = document.createElement('li');
      listItem.classList.add('stat-row');
      if (idx < 3) {
        listItem.classList.add(`rank-${idx + 1}`);
      }

      // Rank (ordinal, matching the Contest tab)
      const rank = document.createElement('p');
      rank.classList.add('stat-row-rank');
      rank.textContent = formatOrdinal(idx + 1);

      // Avatar
      const avatar = document.createElement('img');
      avatar.classList.add('profile-pic');
      avatar.src = `${stat.avatar}`;
      avatar.alt = `${stat.username}'s profile picture`;

      // Username
      const username = document.createElement('p');
      username.classList.add('stat-row-username');
      username.textContent = stat.username;

      // number of problems solved
      const problemsSolved = (diff === 4) ? stat.count : stat.acSubmissionNum[diff].count;
      const solvedContainer = document.createElement('div');
      solvedContainer.classList.add('stat-row-points-container');

      const solved = document.createElement('p');
      solved.classList.add('stat-row-points');
      solved.textContent = `${problemsSolved}`;

      const solvedLabel = document.createElement('span');
      solvedLabel.classList.add('stat-row-points-label');
      solvedLabel.textContent = 'solved';

      solvedContainer.appendChild(solved);
      solvedContainer.appendChild(solvedLabel);

      listItem.appendChild(rank);
      listItem.appendChild(avatar);
      listItem.appendChild(username);
      listItem.appendChild(solvedContainer);

      list.appendChild(listItem);
    });

    resultsContainer.appendChild(list)
   
  });

}

/**
 * Displays most recent AC Submission results of friendss.
 * @param {Array} submissions - The submissions data of all friends and self.
 * @param {string} username - The current username.
 */
/**
 * Displays users with streaks (consecutive days solving) and strikes (consecutive days missed).
 * @param {Array} strikesUsers - Array of user objects with username, avatar, and strikes count.
 * @param {Array} clearedStrikesUsers - Array of user objects who cleared their strikes yesterday.
 * @param {Array} streaksUsers - Array of user objects with username, avatar, streak count, and last problem date.
 * @param {string} currentUsername - The current user's username.
 * @param {'both'|'strikes'|'streaks'} viewMode - Which section(s) to render.
 */
export function displayStrikesUsers(
  strikesUsers,
  clearedStrikesUsers,
  streaksUsers,
  currentUsername,
  viewMode = 'both'
) {
  const currentUserStreak = (streaksUsers || []).find((user) => user.username === currentUsername);
  const streakCount = currentUserStreak ? currentUserStreak.streak : 0;

  const headerStreak = document.getElementById('header-streak-count');
  if (headerStreak) {
    headerStreak.textContent = streakCount;
  }

  // Reflect the streak on the toolbar icon badge
  if (typeof chrome !== 'undefined' && chrome.action?.setBadgeText) {
    chrome.action.setBadgeBackgroundColor({ color: '#ff9f0a' });
    chrome.action.setBadgeTextColor?.({ color: '#1e1e1e' });
    chrome.action.setBadgeText({ text: streakCount > 0 ? String(streakCount) : '' });
  }

  const resultsContainer = document.getElementById('strikes-list');
  resultsContainer.innerHTML = ''; // Clear previous results

  const showStrikes = viewMode !== 'streaks';
  const showStreaks = viewMode !== 'strikes';

  const hasStrikes =
    (strikesUsers && strikesUsers.length > 0) || (clearedStrikesUsers && clearedStrikesUsers.length > 0);
  const hasStreaks = streaksUsers && streaksUsers.length > 0;

  const renderedAny = (showStreaks && hasStreaks) || (showStrikes && hasStrikes);
  if (!renderedAny) {
    resultsContainer.innerHTML =
      viewMode === 'streaks' ? '<p>No streaks yet.</p>' : '<p>No strikes! Everyone is staying active!</p>';
    return;
  }

  // Streaks section (shown above strikes)
  if (showStreaks && hasStreaks) {
    const streaksHeader = document.createElement('h3');
    streaksHeader.classList.add('streaks-header');
    streaksHeader.textContent = 'Streaks';
    resultsContainer.appendChild(streaksHeader);

    const streaksList = document.createElement('ul');
    streaksList.classList.add('streaks-users-list');

    streaksUsers.forEach(user => {
      const listItem = document.createElement('li');
      listItem.classList.add('streaks-user-item');

      // Avatar
      const avatar = document.createElement('img');
      avatar.classList.add('profile-pic');
      avatar.src = user.avatar;
      avatar.alt = `${user.username}'s profile picture`;

      // Username (display "You" for current user, make clickable for others)
      const username = document.createElement('p');
      username.classList.add('streaks-username');

      if (user.username === currentUsername) {
        username.textContent = 'You';
      } else {
        const usernameLink = document.createElement('a');
        usernameLink.href = `https://leetcode.com/${user.username}`;
        usernameLink.textContent = user.username;
        usernameLink.target = '_blank';
        usernameLink.classList.add('username-link');
        username.appendChild(usernameLink);
      }

      // Last problem date
      const lastProblemDate = document.createElement('p');
      lastProblemDate.classList.add('last-problem-date');
      lastProblemDate.textContent = user.lastProblemDate;

      // Streak display with fire emoji
      const streakDisplay = document.createElement('div');
      streakDisplay.classList.add('streak-display');

      const streakText = document.createElement('p');
      streakText.classList.add('streak-text');
      streakText.textContent = `${user.streak}`;

      const streakEmoji = document.createElement('p');
      streakEmoji.classList.add('streak-emoji');
      streakEmoji.textContent = '🔥';

      streakDisplay.appendChild(streakText);
      streakDisplay.appendChild(streakEmoji);

      listItem.appendChild(avatar);
      listItem.appendChild(username);
      listItem.appendChild(lastProblemDate);
      listItem.appendChild(streakDisplay);
      streaksList.appendChild(listItem);
    });

    resultsContainer.appendChild(streaksList);
  }

  // Strikes section
  if (showStrikes && hasStrikes) {
    const strikesHeader = document.createElement('h3');
    strikesHeader.classList.add('streaks-header');
    strikesHeader.textContent = 'Strikes';
    resultsContainer.appendChild(strikesHeader);

    const list = document.createElement('ul');
    list.classList.add('strikes-users-list');

    // Display users with current strikes
    strikesUsers.forEach(user => {
      const listItem = document.createElement('li');
      listItem.classList.add('strikes-user-item');

      // Avatar
      const avatar = document.createElement('img');
      avatar.classList.add('profile-pic');
      avatar.src = user.avatar;
      avatar.alt = `${user.username}'s profile picture`;

      // Username (display "You" for current user, make clickable for others)
      const username = document.createElement('p');
      username.classList.add('strikes-username');

      if (user.username === currentUsername) {
        username.textContent = 'You';
      } else {
        const usernameLink = document.createElement('a');
        usernameLink.href = `https://leetcode.com/${user.username}`;
        usernameLink.textContent = user.username;
        usernameLink.target = '_blank';
        usernameLink.classList.add('username-link');
        username.appendChild(usernameLink);
      }

      // "Clears Today" indicator (if user solved a problem today)
      const clearsTodayIndicator = document.createElement('p');
      clearsTodayIndicator.classList.add('clears-today');
      if (user.clearsToday) {
        clearsTodayIndicator.textContent = 'Clears Today';
      }

      // Strikes display with X emojis
      const strikesDisplay = document.createElement('div');
      strikesDisplay.classList.add('strikes-display');

      const strikesText = document.createElement('p');
      strikesText.classList.add('strikes-text');
      strikesText.textContent = `Strike ${user.strikes}`;

      const strikesEmojis = document.createElement('p');
      strikesEmojis.classList.add('strikes-emojis');
      strikesEmojis.textContent = '❌'.repeat(user.strikes);

      strikesDisplay.appendChild(strikesText);
      strikesDisplay.appendChild(strikesEmojis);

      listItem.appendChild(avatar);
      listItem.appendChild(username);
      listItem.appendChild(clearsTodayIndicator);
      listItem.appendChild(strikesDisplay);
      list.appendChild(listItem);
    });

    // Display users who cleared their strikes yesterday (at the bottom)
    if (clearedStrikesUsers && clearedStrikesUsers.length > 0) {
      clearedStrikesUsers.forEach(user => {
        const listItem = document.createElement('li');
        listItem.classList.add('strikes-user-item', 'cleared-strikes');

        // Avatar
        const avatar = document.createElement('img');
        avatar.classList.add('profile-pic');
        avatar.src = user.avatar;
        avatar.alt = `${user.username}'s profile picture`;

        // Username (display "You" for current user, make clickable for others)
        const username = document.createElement('p');
        username.classList.add('strikes-username');

        if (user.username === currentUsername) {
          username.textContent = 'You';
        } else {
          const usernameLink = document.createElement('a');
          usernameLink.href = `https://leetcode.com/${user.username}`;
          usernameLink.textContent = user.username;
          usernameLink.target = '_blank';
          usernameLink.classList.add('username-link');
          username.appendChild(usernameLink);
        }

        // Checkmark indicator
        const checkmarkDisplay = document.createElement('div');
        checkmarkDisplay.classList.add('cleared-display');

        const checkmarkEmoji = document.createElement('p');
        checkmarkEmoji.classList.add('checkmark-emoji');
        checkmarkEmoji.textContent = '✅';

        checkmarkDisplay.appendChild(checkmarkEmoji);

        listItem.appendChild(avatar);
        listItem.appendChild(username);
        listItem.appendChild(checkmarkDisplay);
        list.appendChild(listItem);
      });
    }

    resultsContainer.appendChild(list);
  }
}

/**
 * Displays the contest leaderboard with weekly points
 * @param {Array} contestData - Array of user objects with username, avatar, points, and submissions
 * @param {string} weekStart - Start date of the week (YYYY-MM-DD)
 * @param {string} weekEnd - End date of the week (YYYY-MM-DD)
 * @param {string} currentUsername - The current user's username
 */
export function displayContestLeaderboard(contestData, weekStart, weekEnd, currentUsername) {
  const resultsContainer = document.getElementById('contest-results');
  const weekDatesContainer = document.getElementById('contest-week-dates');
  resultsContainer.innerHTML = ''; // Clear previous results

  // Display week dates
  weekDatesContainer.textContent = `Week: ${weekStart} to ${weekEnd}`;

  if (!contestData || contestData.length === 0) {
    resultsContainer.innerHTML = '<p>No contest data available.</p>';
    return;
  }

  // Create list
  const list = document.createElement('ul');
  list.classList.add('contest-list');

  contestData.forEach((user, idx) => {
    const listItem = document.createElement('li');
    listItem.classList.add('contest-row');
    if (idx < 3) {
      listItem.classList.add(`rank-${idx + 1}`);
    }

    // Rank (ordinal, matching the Global Rankings tab)
    const rank = document.createElement('p');
    rank.classList.add('contest-rank');
    rank.textContent = formatOrdinal(idx + 1);

    // Avatar
    const avatar = document.createElement('img');
    avatar.classList.add('profile-pic');
    avatar.src = user.avatar;
    avatar.alt = `${user.username}'s profile picture`;

    // Username (display "You" for current user, make clickable for others)
    const username = document.createElement('p');
    username.classList.add('contest-username');

    if (user.username === currentUsername) {
      username.textContent = 'You';
    } else {
      const usernameLink = document.createElement('a');
      usernameLink.href = `https://leetcode.com/${user.username}`;
      usernameLink.textContent = user.username;
      usernameLink.target = '_blank';
      usernameLink.classList.add('username-link');
      username.appendChild(usernameLink);
    }

    // Problem indicators (one count chip per non-zero difficulty)
    const problemIndicators = document.createElement('div');
    problemIndicators.classList.add('contest-problem-indicators');

    // Count problems by difficulty
    const difficultyCounts = { Easy: 0, Medium: 0, Hard: 0 };
    user.submissions.forEach(submission => {
      if (difficultyCounts.hasOwnProperty(submission.difficulty)) {
        difficultyCounts[submission.difficulty]++;
      }
    });

    // Compact, bounded chips (e.g. "3E 2M 1H") instead of one mark per problem
    const difficultyChips = [
      ['Easy', 'E'],
      ['Medium', 'M'],
      ['Hard', 'H'],
    ];
    let chipCount = 0;
    difficultyChips.forEach(([difficulty, letter]) => {
      const count = difficultyCounts[difficulty];
      if (count === 0) {
        return;
      }

      const chip = document.createElement('span');
      chip.classList.add('contest-diff-chip', difficulty.toLowerCase());
      chip.textContent = `${count}${letter}`;
      problemIndicators.appendChild(chip);
      chipCount++;
    });

    if (chipCount === 0) {
      problemIndicators.textContent = '—';
    }

    // Points
    const pointsContainer = document.createElement('div');
    pointsContainer.classList.add('contest-points-container');

    const points = document.createElement('p');
    points.classList.add('contest-points');
    points.textContent = user.points;

    const pointsLabel = document.createElement('span');
    pointsLabel.classList.add('contest-points-label');
    pointsLabel.textContent = 'pts';

    pointsContainer.appendChild(points);
    pointsContainer.appendChild(pointsLabel);

    // Username + problem dots share a wrappable block so a long username
    // pushes the dots to a new line instead of being truncated
    const identity = document.createElement('div');
    identity.classList.add('contest-identity');
    identity.appendChild(username);
    identity.appendChild(problemIndicators);

    listItem.appendChild(rank);
    listItem.appendChild(avatar);
    listItem.appendChild(identity);
    listItem.appendChild(pointsContainer);

    list.appendChild(listItem);
  });

  resultsContainer.appendChild(list);
}

/**
 * Formats a number as an ordinal string (1st, 2nd, 3rd, etc.)
 * @param {number} n - The number to format
 * @returns {string} - Ordinal string
 */
function formatOrdinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const mod100 = n % 100;
  const suffix = suffixes[(mod100 - 20) % 10] || suffixes[mod100] || suffixes[0];
  return `${n}${suffix}`;
}

/**
 * Formats a problem rank number with commas
 * @param {number} rank - Problem rank number
 * @returns {string} - Formatted rank string
 */
function formatProblemRankValue(rank) {
  return rank.toLocaleString();
}

/**
 * Formats rank change delta with commas
 * @param {number} delta - Rank change amount
 * @returns {string} - Formatted delta string
 */
function formatRankChange(delta) {
  return Math.abs(delta).toLocaleString();
}

/**
 * Formats a snapshot date for display in tooltips
 * @param {string} dateStr - YYYY-MM-DD date string
 * @returns {string} - Formatted date string
 */
function formatSnapshotDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getRankChangeTitle(user, improved) {
  const action = improved ? 'Improved' : 'Dropped';

  if (user.changeSource === 'priorDay' && user.changeReferenceDate) {
    return `${action} since ${formatSnapshotDate(user.changeReferenceDate)}`;
  }

  if (user.changeSource === 'lastView') {
    return `${action} vs last view`;
  }

  return improved ? 'Rank improved' : 'Rank dropped';
}

function getNoChangeTitle(user) {
  if (user.changeSource === 'priorDay' && user.changeReferenceDate) {
    return `No change since ${formatSnapshotDate(user.changeReferenceDate)}`;
  }

  if (user.changeSource === 'lastView') {
    return 'No change since last view';
  }

  return 'No change';
}

/**
 * Displays problem-solving global rankings for selected users
 * @param {Array} rankingsData - Array of user ranking objects
 * @param {string} currentUsername - The current user's username
 */
export function displayGlobalRankings(rankingsData, currentUsername) {
  const resultsContainer = document.getElementById('global-rankings-results');
  resultsContainer.innerHTML = '';

  if (!rankingsData || rankingsData.length === 0) {
    resultsContainer.innerHTML = '<p>No ranking data available.</p>';
    return;
  }

  const rankedUsers = rankingsData.filter((user) => user.problemRank !== null);
  const unrankedUsers = rankingsData.filter((user) => user.problemRank === null);

  rankedUsers.sort((a, b) => a.problemRank - b.problemRank);

  const list = document.createElement('ul');
  list.classList.add('global-rankings-list');

  rankedUsers.forEach((user, idx) => {
    const listItem = document.createElement('li');
    listItem.classList.add('global-rankings-row');
    if (idx < 3) {
      listItem.classList.add(`rank-${idx + 1}`);
    }

    const left = document.createElement('div');
    left.classList.add('global-rankings-left');

    const spot = document.createElement('span');
    spot.classList.add('global-rankings-spot');
    spot.textContent = formatOrdinal(idx + 1);

    const avatar = document.createElement('img');
    avatar.classList.add('global-rankings-avatar');
    avatar.src = user.avatar;
    avatar.alt = `${user.username}'s profile picture`;

    const username = document.createElement('span');
    username.classList.add('global-rankings-username');

    if (user.username === currentUsername) {
      username.classList.add('is-you');
      username.textContent = 'You';
    } else {
      const usernameLink = document.createElement('a');
      usernameLink.href = `https://leetcode.com/${user.username}`;
      usernameLink.textContent = user.username;
      usernameLink.target = '_blank';
      usernameLink.classList.add('username-link');
      username.appendChild(usernameLink);
    }

    left.appendChild(spot);
    left.appendChild(avatar);
    left.appendChild(username);

    const change = document.createElement('div');
    change.classList.add('global-rankings-change');

    if (user.rankChange !== null && user.rankChange !== 0) {
      if (user.rankChange > 0) {
        change.classList.add('up');
        change.textContent = `↑ ${formatRankChange(user.rankChange)}`;
        change.title = getRankChangeTitle(user, true);
      } else {
        change.classList.add('down');
        change.textContent = `↓ ${formatRankChange(user.rankChange)}`;
        change.title = getRankChangeTitle(user, false);
      }
    } else if (user.rankChange === 0) {
      change.classList.add('neutral', 'no-change');
      change.textContent = '=';
      change.title = getNoChangeTitle(user);
    } else {
      change.classList.add('neutral', 'no-data');
      change.textContent = '—';
      change.title = 'No previous data';
    }

    const rank = document.createElement('div');
    rank.classList.add('global-rankings-rank');

    const rankLabel = document.createElement('span');
    rankLabel.classList.add('global-rankings-rank-label');
    rankLabel.textContent = 'Rank';

    const rankValue = document.createElement('span');
    rankValue.classList.add('global-rankings-rank-value');
    rankValue.textContent = formatProblemRankValue(user.problemRank);

    rank.appendChild(rankLabel);
    rank.appendChild(rankValue);

    listItem.appendChild(left);
    listItem.appendChild(change);
    listItem.appendChild(rank);

    list.appendChild(listItem);
  });

  unrankedUsers.forEach((user) => {
    const listItem = document.createElement('li');
    listItem.classList.add('global-rankings-row');

    const left = document.createElement('div');
    left.classList.add('global-rankings-left');

    const spot = document.createElement('span');
    spot.classList.add('global-rankings-spot');
    spot.textContent = '—';

    const avatar = document.createElement('img');
    avatar.classList.add('global-rankings-avatar');
    avatar.src = user.avatar;
    avatar.alt = `${user.username}'s profile picture`;

    const username = document.createElement('span');
    username.classList.add('global-rankings-username');

    if (user.username === currentUsername) {
      username.classList.add('is-you');
      username.textContent = 'You';
    } else {
      const usernameLink = document.createElement('a');
      usernameLink.href = `https://leetcode.com/${user.username}`;
      usernameLink.textContent = user.username;
      usernameLink.target = '_blank';
      usernameLink.classList.add('username-link');
      username.appendChild(usernameLink);
    }

    left.appendChild(spot);
    left.appendChild(avatar);
    left.appendChild(username);

    const unranked = document.createElement('span');
    unranked.classList.add('global-rankings-unranked');
    unranked.textContent = 'No rank';

    listItem.appendChild(left);
    listItem.appendChild(unranked);

    list.appendChild(listItem);
  });

  resultsContainer.appendChild(list);
}

// Track the current render ID to prevent race conditions
let currentRenderID = 0;

export async function displayACSubmissions(submissions, username, filterText = '') {
  const resultsContainer = document.getElementById('graphql-results');

  // Increment render ID to invalidate previous renders
  const renderID = ++currentRenderID;

  resultsContainer.innerHTML = ''; // Clear previous results

  if (!submissions || submissions.length === 0) {
    resultsContainer.innerHTML = '<p>No submissions found.</p>';
    return;
  }
  submissions.sort(function(x, y) {
    return y.timestamp - x.timestamp;
  })
  console.log(submissions)


  // Fetch all difficulties
  const submissionWithDifficultyPromises = submissions.map(async (submission) => {
    const problem_data = await questionDifficulty(submission.titleSlug);
    const difficulty = problem_data.difficulty;
    const isPaidOnly = problem_data.isPaidOnly;
    return { ...submission, difficulty, isPaidOnly };
  });

  // wait for fetching difficulties and then populate activity list with submissions in
  // order of most recent
  Promise.all(submissionWithDifficultyPromises).then((submissionsWithDiff) => {
    // Check if this render is still valid (not superseded by a newer search)
    if (renderID !== currentRenderID) {
      return; // Discard outdated results
    }

    // Clear again right before rendering to ensure no stale content
    resultsContainer.innerHTML = '';

    const list = document.createElement('ul');
    list.classList.add('submission-list');

    // Apply filter
    const filter = filterText.toLowerCase().trim();
    let filteredSubmissions = submissionsWithDiff;

    if (filter) {
      filteredSubmissions = submissionsWithDiff.filter(submission => {
        const submissionUsername = submission.username.toLowerCase();
        return submissionUsername.includes(filter) || (submission.username === username && 'you'.includes(filter));
      });
    }

    if (filteredSubmissions.length === 0) {
      resultsContainer.innerHTML = `<p>No submissions found for "${filterText}".</p>`;
      return;
    }

    filteredSubmissions.forEach( submission => {
      // display current user as You
      const originalUsername = submission.username;
      if (submission.username === username) {
        submission.username = "You";
      }
      const problemLink = "https://leetcode.com/problems/" + submission.titleSlug + "/description/";

      const listItem = document.createElement('li');
      listItem.classList.add('submission');

      // create "User solved problem" with link
      const title = document.createElement('p');
      title.classList.add('submission-title');

      const titleLink = document.createElement('a');
      titleLink.href = problemLink;
      titleLink.textContent = submission.title;
      titleLink.target = '_blank'; // open link in a new tab
      titleLink.classList.add('submission-link');

      title.innerHTML = `${submission.username} solved `;
      title.appendChild(titleLink);

      if (submission.isPaidOnly) {
        const lock = document.createElement('span');
        lock.classList.add('premium-lock');
        lock.title = 'Premium problem';
        lock.innerHTML =
          '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
        title.appendChild(lock);
      }

      // problem difficulty
      const diff = document.createElement('p');
      diff.classList.add('submission-diff');
      diff.classList.add(`${submission.difficulty.toLowerCase()}`);
      diff.textContent = `${submission.difficulty}`;

      // timestamp
      const timestamp = document.createElement('p');
      timestamp.classList.add('submission-timestamp');
      timestamp.textContent = `${timeDifference(Date.now(), new Date(submission.timestamp * 1000))}`;

      // listItem.appendChild(user);
      listItem.appendChild(title);
      listItem.appendChild(diff);
      listItem.appendChild(timestamp);

      list.appendChild(listItem);
    });

    resultsContainer.appendChild(list)
  });

}

/**
 * Updates an element's text content when it exists.
 * @param {string} id
 * @param {string|number} value
 */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

/**
 * Renders the current user's solved-problem totals and per-difficulty breakdown
 * in the Activity tab summary card.
 * @param {{acSubmissionNum: {difficulty: string, count: number}[]}} stats - Result of getUserProblemStats
 */
export function displaySolvedStats(stats) {
  const entries = (stats && stats.acSubmissionNum) || [];
  const countFor = (difficulty) => {
    const entry = entries.find((item) => item.difficulty === difficulty);
    return entry ? entry.count : 0;
  };

  setText('summary-solved-total', countFor('All'));
  setText('summary-easy', countFor('Easy'));
  setText('summary-medium', countFor('Medium'));
  setText('summary-hard', countFor('Hard'));
}

const HEATMAP_DAYS = 30;

/**
 * Renders the trailing 30-day activity heatmap. Each square is shaded by that
 * day's submission count and reveals the exact count on hover.
 * @param {{submissionCalendar: Object.<string, number>}} calendarData - Result of getUserCalendar
 */
export function displayActivityHeatmap(calendarData) {
  const grid = document.getElementById('heatmap-grid');
  const tooltip = document.getElementById('heatmap-tooltip');
  if (!grid) {
    return;
  }

  grid.innerHTML = '';
  if (tooltip) {
    tooltip.hidden = true;
  }

  const { cells, activeDays, maxCount } = buildActivityGrid(
    calendarData ? calendarData.submissionCalendar : {},
    { days: HEATMAP_DAYS }
  );

  setText('heatmap-active-days', `${activeDays}/${HEATMAP_DAYS}`);
  setText('heatmap-axis-start', cells.length ? formatAxisDate(cells[0].date) : '');

  const lastIndex = cells.length - 1;

  cells.forEach((cell, index) => {
    const cellEl = document.createElement('span');
    cellEl.classList.add('heat-cell', `heat-level-${getActivityLevel(cell.count, maxCount)}`);

    if (index === lastIndex) {
      cellEl.classList.add('is-today');
      if (cell.count > 0) {
        const check = document.createElement('span');
        check.classList.add('heat-cell-check');
        check.textContent = '✓';
        cellEl.appendChild(check);
      }
    }

    attachHeatmapTooltip(cellEl, cell, tooltip);
    grid.appendChild(cellEl);
  });
}

/**
 * Shows the day's submission count in a floating tooltip on hover.
 * @param {HTMLElement} cellEl
 * @param {{date: string, count: number}} cell
 * @param {HTMLElement|null} tooltip
 */
function attachHeatmapTooltip(cellEl, cell, tooltip) {
  if (!tooltip) {
    return;
  }

  cellEl.addEventListener('mouseenter', () => {
    tooltip.textContent = formatHeatmapTooltip(cell);
    tooltip.hidden = false;
    positionTooltip(tooltip, cellEl);
  });

  cellEl.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
  });
}

/**
 * Positions the tooltip above the hovered cell, clamped to the card and flipped
 * below when there is no room above.
 * @param {HTMLElement} tooltip
 * @param {HTMLElement} cellEl
 */
function positionTooltip(tooltip, cellEl) {
  const panel = tooltip.offsetParent;
  if (!panel) {
    return;
  }

  const maxLeft = panel.clientWidth - tooltip.offsetWidth - 4;
  const centeredLeft = cellEl.offsetLeft + cellEl.offsetWidth / 2 - tooltip.offsetWidth / 2;
  tooltip.style.left = `${Math.max(4, Math.min(centeredLeft, maxLeft))}px`;

  const above = cellEl.offsetTop - tooltip.offsetHeight - 6;
  tooltip.style.top =
    above >= 0 ? `${above}px` : `${cellEl.offsetTop + cellEl.offsetHeight + 6}px`;
}