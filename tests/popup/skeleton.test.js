import { describe, it, expect, afterEach } from 'vitest';
import { showSkeleton, showAllSkeletons } from '../../popup/skeleton.js';

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
