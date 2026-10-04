import { beforeEach, vi } from 'vitest';

/**
 * Minimal in-memory implementation of a chrome.storage area.
 * Supports the callback style used by the extension and the promise style
 * used by utils/timezoneHelper.js.
 */
function createStorageArea() {
  let store = {};

  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  function get(keys, callback) {
    const result = {};

    if (keys === null || keys === undefined) {
      for (const [key, value] of Object.entries(store)) {
        result[key] = clone(value);
      }
    } else if (typeof keys === 'string') {
      if (keys in store) result[keys] = clone(store[keys]);
    } else if (Array.isArray(keys)) {
      for (const key of keys) {
        if (key in store) result[key] = clone(store[key]);
      }
    } else if (typeof keys === 'object') {
      for (const [key, fallback] of Object.entries(keys)) {
        result[key] = key in store ? clone(store[key]) : clone(fallback);
      }
    }

    if (typeof callback === 'function') {
      callback(result);
      return undefined;
    }
    return Promise.resolve(result);
  }

  function set(items, callback) {
    for (const [key, value] of Object.entries(items)) {
      store[key] = clone(value);
    }
    if (typeof callback === 'function') {
      callback();
      return undefined;
    }
    return Promise.resolve();
  }

  function remove(keys, callback) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      delete store[key];
    }
    if (typeof callback === 'function') {
      callback();
      return undefined;
    }
    return Promise.resolve();
  }

  function clear(callback) {
    store = {};
    if (typeof callback === 'function') {
      callback();
      return undefined;
    }
    return Promise.resolve();
  }

  return {
    get,
    set,
    remove,
    clear,
    _reset: () => {
      store = {};
    },
    _dump: () => store,
  };
}

const local = createStorageArea();
const sync = createStorageArea();

globalThis.chrome = {
  storage: { local, sync },
  runtime: { lastError: undefined },
};

beforeEach(() => {
  local._reset();
  sync._reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
