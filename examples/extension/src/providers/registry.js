/**
 * Provider registry — add new adapters here without changing orchestration.
 */

import { openaiProvider } from "./openai.js";

/** @type {Map<string, import("./openai.js").Provider>} */
const providers = new Map([[openaiProvider.id, openaiProvider]]);

/**
 * @returns {import("./openai.js").Provider[]}
 */
export function listProviders() {
  return [...providers.values()];
}

/**
 * @param {string} id
 * @returns {import("./openai.js").Provider | undefined}
 */
export function getProvider(id) {
  return providers.get(id);
}

/**
 * Default provider for this demo build.
 * @returns {import("./openai.js").Provider}
 */
export function getDefaultProvider() {
  return openaiProvider;
}
