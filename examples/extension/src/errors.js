/**
 * InferenceError helpers shared by the service worker and page bridge.
 * Page scripts reconstruct a plain Error with a `code` property.
 */

export const ERROR_CODES = Object.freeze([
  "permission_denied",
  "invalid_request",
  "unavailable",
  "provider_error",
  "aborted",
]);

/**
 * @param {string} code
 * @param {string} message
 * @returns {{ name: string, message: string, code: string }}
 */
export function serializeInferenceError(code, message) {
  return {
    name: "InferenceError",
    message: message || code,
    code,
  };
}

/**
 * Reconstruct an Error with a `code` property for the page realm.
 * @param {{ name?: string, message?: string, code?: string }} serialized
 * @returns {Error & { code: string }}
 */
export function toInferenceError(serialized) {
  const error = new Error(serialized?.message || "Inference request failed");
  error.name = serialized?.name || "InferenceError";
  error.code = serialized?.code || "provider_error";
  return /** @type {Error & { code: string }} */ (error);
}
