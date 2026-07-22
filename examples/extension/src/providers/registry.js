/**
 * Provider registry — add new adapters here without changing orchestration.
 */

import { openaiProvider } from "./openai.js";
import { ollamaProvider } from "./ollama.js";

/** @typedef {import("./openai.js").Provider} Provider */

/** @type {Map<string, Provider>} */
const providers = new Map([
  [openaiProvider.id, openaiProvider],
  [ollamaProvider.id, ollamaProvider],
]);

/**
 * @returns {Provider[]}
 */
export function listProviders() {
  return [...providers.values()];
}

/**
 * @param {string} id
 * @returns {Provider | undefined}
 */
export function getProvider(id) {
  return providers.get(id);
}

/**
 * Default provider for this demo build (OpenAI).
 * @returns {Provider}
 */
export function getDefaultProvider() {
  return openaiProvider;
}

/**
 * Resolve models for a provider (static catalog or async discovery).
 * @param {Provider} provider
 * @param {{ signal?: AbortSignal }} [args]
 * @returns {Promise<string[]>}
 */
export async function resolveProviderModels(provider, args = {}) {
  if (typeof provider.listModels === "function") {
    return provider.listModels(args);
  }
  return provider.models ? [...provider.models] : [];
}
