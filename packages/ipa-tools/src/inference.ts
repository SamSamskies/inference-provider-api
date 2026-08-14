import { makeInferenceError } from "./errors.js";
import type { Inference, InferenceFeatures } from "./types.js";
import "./types.js";

function lookupInference(): Inference | undefined {
  const inference =
    typeof globalThis !== "undefined"
      ? (globalThis as typeof globalThis & { window?: Window }).window
          ?.inference ??
        (globalThis as typeof globalThis & { inference?: Inference }).inference
      : undefined;

  if (inference == null || typeof inference.request !== "function") {
    return undefined;
  }
  return inference;
}

/**
 * True when `window.inference` (or `globalThis.inference`) is present with a
 * `request` function. Does not wait for late injection.
 */
export function isInferenceAvailable(): boolean {
  return lookupInference() != null;
}

/**
 * Resolve `window.inference` or throw `unavailable`.
 */
export function getInference(): Inference {
  const inference = lookupInference();
  if (!inference) {
    throw makeInferenceError(
      "unavailable",
      "window.inference is not available."
    );
  }
  return inference;
}

export type WaitForInferenceOptions = {
  /** Milliseconds to wait. Default 3000. `0` checks once and does not poll. */
  timeout?: number;
  /** Poll interval in milliseconds. Default 50. */
  interval?: number;
  signal?: AbortSignal;
};

/**
 * Resolve `window.inference`, polling until it is injected or `timeout` elapses.
 * Do not await this before first paint: with no extension installed it waits
 * the full timeout. Check `isInferenceAvailable()` immediately, then poll in
 * the background if you want to pick up late injection.
 * Throws `unavailable` on timeout, `aborted` if `signal` aborts.
 */
export async function waitForInference(
  options?: WaitForInferenceOptions
): Promise<Inference> {
  const timeout = options?.timeout ?? 3000;
  const interval = options?.interval ?? 50;
  const signal = options?.signal;

  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) {
    throw makeInferenceError(
      "invalid_request",
      "timeout must be a non-negative number."
    );
  }
  if (
    typeof interval !== "number" ||
    !Number.isFinite(interval) ||
    interval < 1
  ) {
    throw makeInferenceError(
      "invalid_request",
      "interval must be a positive number."
    );
  }

  if (signal?.aborted) {
    throw makeInferenceError("aborted", "Request aborted");
  }

  const existing = lookupInference();
  if (existing) return existing;
  if (timeout === 0) {
    throw makeInferenceError(
      "unavailable",
      "window.inference is not available."
    );
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(makeInferenceError("aborted", "Request aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    const tick = () => {
      const found = lookupInference();
      if (found) {
        cleanup();
        resolve(found);
        return;
      }
      if (Date.now() - started >= timeout) {
        cleanup();
        reject(
          makeInferenceError(
            "unavailable",
            "window.inference is not available."
          )
        );
        return;
      }
      timer = setTimeout(tick, interval);
    };

    timer = setTimeout(tick, interval);
  });
}

/**
 * Feature snapshot from the injector, or `{}` when `getFeatures` is missing.
 */
export function getFeatures(): InferenceFeatures {
  return getInference().getFeatures?.() ?? {};
}
