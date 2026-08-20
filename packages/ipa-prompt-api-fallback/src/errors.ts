import { makeInferenceError } from "ipa-tools";
import type { LanguageModelStatic } from "./language-model.js";

/** Resolve the global `LanguageModel` constructor when present. */
export function getLanguageModel(): LanguageModelStatic | undefined {
  const value = (globalThis as { LanguageModel?: LanguageModelStatic })
    .LanguageModel;
  return value;
}

/** Map DOM / platform errors onto IPA error codes. */
export function mapPromptApiError(error: unknown): Error {
  if (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    ["permission_denied", "invalid_request", "unavailable", "provider_error", "aborted"].includes(
      (error as { code: string }).code
    )
  ) {
    return error as unknown as Error;
  }

  if (isAbortError(error)) {
    return makeInferenceError("aborted", "Request aborted");
  }

  const name =
    error != null && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  const message =
    error instanceof Error
      ? error.message
      : error != null
        ? String(error)
        : "Prompt API error";

  if (name === "NotSupportedError") {
    return makeInferenceError("unavailable", message);
  }
  if (name === "NetworkError") {
    return makeInferenceError(
      "provider_error",
      message || "Prompt API model download failed."
    );
  }
  if (name === "QuotaExceededError") {
    return makeInferenceError("provider_error", message);
  }

  return makeInferenceError("provider_error", message);
}

export function isAbortError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "AbortError") return true;
  if (
    "code" in error &&
    (error as { code: unknown }).code === "aborted"
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize Prompt API stream chunks. Some Chrome builds yield incremental
 * deltas; others yield cumulative text. Emit IPA `delta` strings either way.
 */
export function toDelta(previous: string, chunk: string): {
  delta: string;
  next: string;
} {
  if (chunk.startsWith(previous)) {
    return { delta: chunk.slice(previous.length), next: chunk };
  }
  return { delta: chunk, next: previous + chunk };
}
