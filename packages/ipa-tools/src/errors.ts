import type { InferenceError, InferenceErrorCode } from "./types.js";

const INFERENCE_ERROR_CODES: ReadonlySet<string> = new Set([
  "permission_denied",
  "invalid_request",
  "unavailable",
  "provider_error",
  "aborted",
]);

/**
 * Create an InferenceError-shaped Error. Implementations may reconstruct the
 * same shape across isolated worlds; prefer `isInferenceError` over instanceof.
 */
export function makeInferenceError(
  code: InferenceErrorCode,
  message?: string
): InferenceError {
  const error = new Error(message || code) as InferenceError;
  error.name = "InferenceError";
  error.code = code;
  return error;
}

/**
 * True when `error` is a non-null object with a SPEC `code` string.
 * Needed because injectors reconstruct errors across extension worlds.
 */
export function isInferenceError(error: unknown): error is InferenceError {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && INFERENCE_ERROR_CODES.has(code);
}
