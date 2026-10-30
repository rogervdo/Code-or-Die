import { describe, it, expect, afterEach } from 'vitest';
import {
  showSkeleton,
  showAllSkeletons,
  showHeatmapSkeleton,
  showActivitySummarySkeleton,
} from '../../popup/skeleton.js';

const SKELETON_CONTAINERS = [
  'graphql-results',
  'leaderboard-results',
  'contest-results',
  'global-rankings-results',
  'strikes-list',
];

function installFakeDocument(ids) {
  const elements = {};
  ids.forEach((id) => {
    elements[id] = { innerHTML: '' };
  });

  globalThis.document = {
    getElementById: (id) => (id in elements ? elements[id] : null),
  };

  return elements;
}

const countRows = (html) => (html.match(/skeleton-row/g) || []).length;

afterEach(() => {
  delete globalThis.document;
});

describe('showSkeleton', () => {
  it('fills the container with the requested number of rows', () => {
    const elements = installFakeDocument(['graphql-results']);
    showSkeleton('graphql-results', 3);

    expect(elements['graphql-results'].innerHTML).toContain('skeleton-list');
    expect(countRows(elements['graphql-results'].innerHTML)).toBe(3);
  });

  it('defaults to 5 rows', () => {
    const elements = installFakeDocument(['graphql-results']);
    showSkeleton('graphql-results');

    expect(countRows(elements['graphql-results'].innerHTML)).toBe(5);
  });

  it('replaces any previous content', () => {
    const elements = installFakeDocument(['graphql-results']);
    elements['graphql-results'].innerHTML = '<p>stale</p>';

    showSkeleton('graphql-results', 2);

    expect(elements['graphql-results'].innerHTML).not.toContain('stale');
    expect(countRows(elements['graphql-results'].innerHTML)).toBe(2);
  });

  it('uses a plain text row (no avatar) for the Activity feed', () => {
    const elements = installFakeDocument(['graphql-results']);
    showSkeleton('graphql-results', 3);

    expect(elements['graphql-results'].innerHTML).not.toContain('skeleton-avatar');
    expect(elements['graphql-results'].innerHTML).toContain('skeleton-line-full');
  });

  it('keeps the avatar row for the other tabs', () => {
    const elements = installFakeDocument(['leaderboard-results']);
    showSkeleton('leaderboard-results', 1);

    expect(elements['leaderboard-results'].innerHTML).toContain('skeleton-avatar');
    expect(elements['leaderboard-results'].innerHTML).not.toContain('skeleton-line-full');
  });

  it('is a no-op for a missing container', () => {
    installFakeDocument([]);
    expect(() => showSkeleton('missing')).not.toThrow();
  });
});

describe('showAllSkeletons', () => {
  it('fills every tab results container', () => {
    const elements = installFakeDocument(SKELETON_CONTAINERS);
    showAllSkeletons();

    SKELETON_CONTAINERS.forEach((id) => {
      expect(countRows(elements[id].innerHTML)).toBe(5);
    });
  });

  it('honours a custom row count', () => {
    const elements = installFakeDocument(SKELETON_CONTAINERS);
    showAllSkeletons(2);

    SKELETON_CONTAINERS.forEach((id) => {
      expect(countRows(elements[id].innerHTML)).toBe(2);
    });
  });
});

describe('showHeatmapSkeleton', () => {
  it('fills the grid with placeholder cells', () => {
    const elements = installFakeDocument(['heatmap-grid']);
    showHeatmapSkeleton(30);

    const count = (elements['heatmap-grid'].innerHTML.match(/heat-cell-placeholder/g) || []).length;
    expect(count).toBe(30);
  });

  it('is a no-op for a missing grid', () => {
    installFakeDocument([]);
    expect(() => showHeatmapSkeleton()).not.toThrow();
  });
});

describe('showActivitySummarySkeleton', () => {
  it('inserts a shimmer placeholder into each summary number', () => {
    const elements = installFakeDocument([
      'summary-solved-total',
      'summary-easy',
      'summary-medium',
      'summary-hard',
      'heatmap-active-days',
    ]);

    showActivitySummarySkeleton();

    expect(elements['summary-solved-total'].innerHTML).toContain('sk-num-lg');
    expect(elements['summary-easy'].innerHTML).toContain('sk-num-sm');
    expect(elements['heatmap-active-days'].innerHTML).toContain('sk-num-md');
  });

  it('is a no-op for missing elements', () => {
    installFakeDocument([]);
    expect(() => showActivitySummarySkeleton()).not.toThrow();
  });
});
