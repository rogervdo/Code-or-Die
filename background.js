import { loadStrikesUsersData } from './utils/streakUtils.js';

const ALARM_NAME = 'streak-badge-refresh';
const REFRESH_PERIOD_MINUTES = 30;
const BADGE_COLOR = '#ff9f0a';
const BADGE_TEXT_COLOR = '#1e1e1e';

function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ username: null, maxStrikes: 3, timezone: 'America/Chicago' }, (result) => {
      resolve(result);
    });
  });
}

/**
 * Recomputes the current user's streak and mirrors it on the toolbar badge.
 * Runs from the background worker so the badge stays current without the popup
 * needing to be open.
 */
async function updateStreakBadge() {
  const { username, maxStrikes, timezone } = await getStoredSettings();

  if (!username) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  try {
    const { streaksUsers } = await loadStrikesUsersData([], username, maxStrikes, timezone);
    const currentUser = (streaksUsers || []).find((user) => user.username === username);
    const streak = currentUser ? currentUser.streak : 0;

    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
    }
    await chrome.action.setBadgeText({ text: streak > 0 ? String(streak) : '' });
  } catch (error) {
    console.error('[Badge] Failed to update streak badge:', error);
  }
}

function scheduleAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarm();
  updateStreakBadge();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarm();
  updateStreakBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    updateStreakBadge();
  }
});
