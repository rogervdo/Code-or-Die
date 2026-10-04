/**
 * Skeleton loading placeholders shown while tab data is being fetched.
 *
 * Every tab's display function clears its container with innerHTML before
 * rendering, so placing a skeleton there is enough to hide it once the real
 * data arrives.
 */
const SKELETON_CONTAINERS = [
  'graphql-results',
  'leaderboard-results',
  'contest-results',
  'global-rankings-results',
  'strikes-list',
];

const DEFAULT_ROWS = 5;

const SKELETON_ROW = `
  <div class="skeleton-row">
    <div class="skeleton-avatar"></div>
    <div class="skeleton-col">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
    <div class="skeleton-chip"></div>
  </div>`;

/**
 * Renders skeleton rows into a single container.
 * @param {string} containerId
 * @param {number} rows
 */
export function showSkeleton(containerId, rows = DEFAULT_ROWS) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = `<div class="skeleton-list">${SKELETON_ROW.repeat(rows)}</div>`;
}

/**
 * Renders skeletons into every tab's results container.
 * @param {number} rows
 */
export function showAllSkeletons(rows = DEFAULT_ROWS) {
  SKELETON_CONTAINERS.forEach((id) => showSkeleton(id, rows));
}
