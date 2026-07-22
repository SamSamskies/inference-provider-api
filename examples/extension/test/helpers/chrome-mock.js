/**
 * Minimal chrome.* stub for unit tests (storage + windows + runtime).
 */

/**
 * @returns {{
 *   store: Map<string, unknown>,
 *  reset: () => void,
 * }}
 */
export function installChromeMock() {
  /** @type {Map<string, unknown>} */
  const store = new Map();

  const storageLocal = {
    async get(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const key of keyList) {
        if (store.has(key)) out[key] = structuredClone(store.get(key));
      }
      return out;
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        store.set(key, structuredClone(value));
      }
    },
  };

  const chrome = {
    storage: { local: storageLocal },
    runtime: {
      lastError: undefined,
      getURL: (path) => `chrome-extension://test-id/${path}`,
    },
    windows: {
      create: (opts, cb) => {
        queueMicrotask(() => cb?.({ id: 1001 }));
      },
      update: (_id, _opts, cb) => {
        queueMicrotask(() => cb?.());
      },
      get: (id, cb) => {
        queueMicrotask(() => cb?.({ id }));
      },
      remove: (_id, cb) => {
        queueMicrotask(() => cb?.());
      },
    },
    declarativeNetRequest: {
      updateDynamicRules: async () => {},
    },
  };

  globalThis.chrome = chrome;

  return {
    store,
    reset() {
      store.clear();
      chrome.runtime.lastError = undefined;
    },
  };
}
