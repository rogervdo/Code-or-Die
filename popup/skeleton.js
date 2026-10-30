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

// The Activity feed rows have no avatar, so they get a plain text rectangle
// instead of the avatar + lines + chip layout used by the other tabs.
const TEXT_ROW_CONTAINERS = ['graphql-results'];

const SKELETON_ROW = `
  <div class="skeleton-row">
    <div class="skeleton-avatar"></div>
    <div class="skeleton-col">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
    <div class="skeleton-chip"></div>
  </div>`;

const SKELETON_TEXT_ROW = `
  <div class="skeleton-row skeleton-text-row">
    <div class="skeleton-line skeleton-line-full"></div>
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

  const row = TEXT_ROW_CONTAINERS.includes(containerId) ? SKELETON_TEXT_ROW : SKELETON_ROW;
  container.innerHTML = `<div class="skeleton-list">${row.repeat(rows)}</div>`;
}

/**
 * Renders skeletons into every tab's results container, plus the Activity
 * summary and heatmap placeholders.
 * @param {number} rows
 */
export function showAllSkeletons(rows = DEFAULT_ROWS) {
  SKELETON_CONTAINERS.forEach((id) => showSkeleton(id, rows));
  showActivitySummarySkeleton();
  showHeatmapSkeleton();
}

// Activity summary numbers render as shimmer bars until the real counts land.
const SUMMARY_PLACEHOLDERS = {
  'summary-solved-total': 'sk-num-lg',
  'summary-easy': 'sk-num-sm',
  'summary-medium': 'sk-num-sm',
  'summary-hard': 'sk-num-sm',
  'heatmap-active-days': 'sk-num-md',
};

/**
 * Swaps the Activity summary counts (Solved, Easy/Med/Hard) and the 30-day
 * counter for shimmer bars. Each real value is written with textContent, which
 * replaces the bar.
 */
export function showActivitySummarySkeleton() {
  Object.entries(SUMMARY_PLACEHOLDERS).forEach(([id, sizeClass]) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `<span class="sk-num ${sizeClass}"></span>`;
    }
  });
}

// Matches HEATMAP_DAYS in display.js.
const HEATMAP_CELL_COUNT = 30;

/**
 * Fills the 30-day heatmap with placeholder squares while the calendar loads.
 * @param {number} cells
 */
export function showHeatmapSkeleton(cells = HEATMAP_CELL_COUNT) {
  const grid = document.getElementById('heatmap-grid');
  if (!grid) {
    return;
  }

  grid.innerHTML = Array.from(
    { length: cells },
    (_, index) => `<span class="heat-cell heat-cell-placeholder" style="--i:${index}"></span>`
  ).join('');
}
