/**
 * Chrome Prompt API compatibility backend for ipa-tools.
 *
 * Not an IPA implementation. Pass the backend object into
 * `createInference({ fallbacks: [createPromptApiBackend()] })`.
 */

export {
  createPromptApiBackend,
  getPromptApiAvailability,
  type CreatePromptApiBackendOptions,
} from "./prompt-api-backend.js";

export type { PromptApiAvailability } from "./language-model.js";
