import {
  createResolver,
  requestNeedsTools,
  type FallbackInput,
} from "./backends.js";
import { makeInferenceError } from "./errors.js";
import { getInference } from "./inference.js";
import type { DoneChunk, Inference, InferenceRequest } from "./types.js";

export type CompleteOptions = {
  /** Defaults to `window.inference.request`. */
  request?: Inference["request"];
  /**
   * Tried only after IPA is unavailable. Prefer `createInference` when sending
   * more than once (caches the resolved backend).
   */
  fallbacks?: FallbackInput[];
  /** Forwarded to fallback `create()` when resolving via `fallbacks`. */
  onDownloadProgress?: (loaded: number) => void;
};

/**
 * Drain a chat stream until the `done` chunk and return it.
 * Re-throws whatever `request` throws. Throws `aborted` if `request.signal`
 * is aborted. Throws `provider_error` if the stream ends without a `done` chunk.
 */
export async function complete(
  request: InferenceRequest,
  options?: CompleteOptions
): Promise<DoneChunk> {
  const signal = request.signal;
  if (signal?.aborted) {
    throw makeInferenceError("aborted", "Request aborted");
  }

  let requestFn = options?.request;
  if (!requestFn) {
    if (options?.fallbacks != null || options?.onDownloadProgress != null) {
      const resolver = createResolver({
        fallbacks: options.fallbacks,
        onDownloadProgress: options.onDownloadProgress,
      });
      const inference = await resolver.resolve({
        needsTools: requestNeedsTools(request),
        signal,
      });
      requestFn = inference.request.bind(inference);
    } else {
      const inference = getInference();
      requestFn = inference.request.bind(inference);
    }
  }

  let done: DoneChunk | undefined;
  for await (const chunk of requestFn(request)) {
    if (signal?.aborted) {
      throw makeInferenceError("aborted", "Request aborted");
    }
    if (chunk?.type === "done") {
      done = chunk;
    }
  }

  if (!done) {
    if (signal?.aborted) {
      throw makeInferenceError("aborted", "Request aborted");
    }
    throw makeInferenceError(
      "provider_error",
      "Stream ended without a done chunk."
    );
  }

  return done;
}
