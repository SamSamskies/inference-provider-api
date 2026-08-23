import { makeInferenceError } from "ipa-tools";

/** Map Transformers.js / platform errors onto IPA error codes. */
export function mapTransformersError(error: unknown): Error {
  if (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    [
      "permission_denied",
      "invalid_request",
      "unavailable",
      "provider_error",
      "aborted",
    ].includes((error as { code: string }).code)
  ) {
    return error as unknown as Error;
  }

  if (isAbortError(error)) {
    return makeInferenceError("aborted", "Request aborted");
  }

  const message =
    error instanceof Error
      ? error.message
      : error != null
        ? String(error)
        : "Transformers.js error";

  return makeInferenceError("provider_error", message);
}

export function isAbortError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "AbortError") return true;
  if ("code" in error && (error as { code: unknown }).code === "aborted") {
    return true;
  }
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw makeInferenceError("aborted", "Request aborted");
  }
}

/** Race a promise against `signal`. Does not cancel the underlying work. */
export async function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  throwIfAborted(signal);
  if (signal == null) return promise;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(makeInferenceError("aborted", "Request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
