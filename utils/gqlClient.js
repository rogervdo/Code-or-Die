/**
 * Shared GraphQL transport for LeetCode's public endpoint.
 *
 * Every query in GQLQueries/ goes through here so retries, backoff and the
 * global concurrency cap live in one place. The cap stops a 10+ friend roster
 * from firing dozens of simultaneous requests, and because the queue is FIFO,
 * work enqueued first (self summary, activity feed) is served first.
 */

const ENDPOINT = 'https://leetcode.com/graphql';
const MAX_CONCURRENT = 6;

let active = 0;
const waiting = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) {
    // Hand the slot straight to the next waiter (active stays put).
    next();
  } else {
    active -= 1;
  }
}

/**
 * POSTs a GraphQL document and returns the parsed body ({ data, errors }).
 * Retries transient failures (429 / 5xx) with exponential backoff.
 * @param {string} query - GraphQL document
 * @param {object} variables
 * @param {{ retries?: number }} [options]
 * @returns {Promise<object>} - Parsed response body
 */
export async function gqlRequest(query, variables, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    await acquire();
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });

      if (response.ok) {
        return await response.json();
      }
    } finally {
      release();
    }

    const transient = response.status === 429 || response.status >= 500;
    if (transient && attempt < retries) {
      await sleep(400 * 2 ** attempt);
      continue;
    }

    throw new Error(`HTTP error! status: ${response.status}`);
  }
}
