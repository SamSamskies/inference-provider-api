import {
  createResolver,
  normalizeFallbacks,
  requestNeedsTools,
  type FallbackInput,
  type InferenceResolver,
  type ProbeStatus,
} from "./backends.js";
import { complete } from "./complete.js";
import type { CompleteOptions } from "./complete.js";
import {
  runTools,
  type RunToolsOptions,
  type RunToolsResult,
} from "./run-tools.js";
import type {
  DoneChunk,
  Inference,
  InferenceChunk,
  InferenceRequest,
} from "./types.js";

export type CreateInferenceOptions = {
  /**
   * Backends tried only after IPA is unavailable, in order.
   * Built-in: `"promptApi"` (optional peer `ipa-prompt-api-fallback`).
   * Custom `InferenceBackend` objects are an escape hatch (tests / third-party).
   * Omit or `[]` for IPA only.
   */
  fallbacks?: FallbackInput[];
  /** Forwarded to fallback `create()` (e.g. Prompt API model download). */
  onDownloadProgress?: (loaded: number) => void;
};

/**
 * Lazy IPA-first client. Resolves on first `complete` / `request` / `runTools`
 * (inside a user gesture). Does not mutate `window.inference`. Fallback
 * backends are compatibility adapters — not IPA.
 */
export type InferenceClient = {
  /**
   * Async probe of IPA plus configured fallbacks.
   * Does not start downloads. Missing peers report `"unavailable"`.
   */
  probe(): Promise<ProbeStatus>;
  request(request: InferenceRequest): AsyncIterable<InferenceChunk>;
  complete(
    request: InferenceRequest,
    options?: Omit<CompleteOptions, "fallbacks" | "onDownloadProgress" | "request">
  ): Promise<DoneChunk>;
  runTools(
    options: Omit<RunToolsOptions, "fallbacks" | "onDownloadProgress" | "request">
  ): Promise<RunToolsResult>;
};

/**
 * Create an IPA-first inference client with optional page-side fallbacks.
 *
 * @example
 * ```ts
 * const inference = createInference({ fallbacks: ["promptApi"] });
 * const status = await inference.probe();
 * const { message } = await inference.complete({
 *   method: "chat",
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 * ```
 */
export function createInference(
  options?: CreateInferenceOptions
): InferenceClient {
  // Validate fallbacks eagerly so typos fail at construction.
  normalizeFallbacks(options?.fallbacks);
  const resolver = createResolver(options);
  return createClientFromResolver(resolver);
}

function createClientFromResolver(resolver: InferenceResolver): InferenceClient {
  return {
    probe() {
      return resolver.probe();
    },

    request(request: InferenceRequest): AsyncIterable<InferenceChunk> {
      return requestWithResolver(resolver, request);
    },

    complete(request, completeOptions) {
      return complete(request, {
        ...completeOptions,
        request: (req) => requestWithResolver(resolver, req),
      });
    },

    async runTools(runOptions) {
      // Resolve once for the whole tool loop (same as one-shot runTools
      // with fallbacks). Re-resolving each round could switch providers
      // mid-conversation after a late IPA injection.
      const inference = await resolver.resolve({
        needsTools: requestNeedsTools(runOptions),
        signal: runOptions.signal,
      });
      return runTools({
        ...runOptions,
        request: inference.request.bind(inference) as Inference["request"],
      });
    },
  };
}

function requestWithResolver(
  resolver: InferenceResolver,
  request: InferenceRequest,
  resolveHints?: { needsTools?: boolean }
): AsyncIterable<InferenceChunk> {
  const needsTools =
    resolveHints?.needsTools === true || requestNeedsTools(request);

  return {
    async *[Symbol.asyncIterator]() {
      const inference = await resolver.resolve({
        needsTools,
        signal: request.signal,
      });
      const bound = inference.request.bind(inference) as Inference["request"];
      yield* bound(request);
    },
  };
}
