import { makeInferenceError } from "./errors.js";
import type { Inference, InferenceFeatures } from "./types.js";
import "./types.js";

/**
 * Resolve `window.inference` or throw `unavailable`.
 */
export function getInference(): Inference {
  const inference =
    typeof globalThis !== "undefined"
      ? (globalThis as typeof globalThis & { window?: Window }).window
          ?.inference ??
        (globalThis as typeof globalThis & { inference?: Inference }).inference
      : undefined;

  if (inference == null || typeof inference.request !== "function") {
    throw makeInferenceError(
      "unavailable",
      "window.inference is not available."
    );
  }

  return inference;
}

/**
 * Feature snapshot from the injector, or `{}` when `getFeatures` is missing.
 */
export function getFeatures(): InferenceFeatures {
  return getInference().getFeatures?.() ?? {};
}
