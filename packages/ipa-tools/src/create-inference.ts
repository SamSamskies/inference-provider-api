import {
  createResolver,
  normalizeFallbacks,
  requestNeedsImageInput,
  requestNeedsImageOutput,
  requestNeedsTools,
  requestNeedsWebSearch,
  type FallbackInput,
  type InferenceResolver,
  type ProbeStatus,
} from "./backends.js";
import { complete } from "./complete.js";
import { makeInferenceError } from "./errors.js";
import { assertRequestMethod, transcriptionMediaType } from "./methods.js";
import type { CompleteOptions } from "./complete.js";
import {
  runTools,
  type RunToolsOptions,
  type RunToolsResult,
} from "./run-tools.js";
import type {
  DoneChunk,
  Inference,
  ChatRequest,
  InferenceChunkFor,
  InferenceRequest,
} from "./types.js";

export type CreateInferenceOptions = {
  /**
   * Optional page-side backend tried only after IPA is unavailable.
   * At most one entry today (`MAX_FALLBACKS`).
   * Omit or `[]` for IPA only.
   */
  fallbacks?: FallbackInput[];
  /** Forwarded to fallback `create()` when the backend supports downloads. */
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
   * Does not start downloads. Probe failures report `"unavailable"`.
   */
  probe(): Promise<ProbeStatus>;
  request<R extends InferenceRequest>(request: R): AsyncIterable<InferenceChunkFor<R>>;
  complete(
    request: ChatRequest,
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
 * const inference = createInference();
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

    request<R extends InferenceRequest>(request: R): AsyncIterable<InferenceChunkFor<R>> {
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
        needsWebSearch: requestNeedsWebSearch(runOptions),
        needsImageInput: requestNeedsImageInput(runOptions),
        needsImageOutput: requestNeedsImageOutput(runOptions),
        signal: runOptions.signal,
      });
      return runTools({
        ...runOptions,
        request: inference.request.bind(inference) as Inference["request"],
      });
    },
  };
}

function requestWithResolver<R extends InferenceRequest>(
  resolver: InferenceResolver,
  request: R,
  resolveHints?: {
    needsTools?: boolean;
    needsWebSearch?: boolean;
    needsImageInput?: boolean;
    needsImageOutput?: boolean;
  }
): AsyncIterable<InferenceChunkFor<R>> {
  const chat = request.method === "chat" ? (request as ChatRequest) : undefined;
  const needsTools =
    resolveHints?.needsTools === true || requestNeedsTools(chat ?? {});
  const needsWebSearch =
    resolveHints?.needsWebSearch === true || requestNeedsWebSearch(chat ?? {});
  const needsImageInput =
    resolveHints?.needsImageInput === true || requestNeedsImageInput(chat ?? {});
  const needsImageOutput =
    resolveHints?.needsImageOutput === true || requestNeedsImageOutput(chat ?? {});

  return {
    async *[Symbol.asyncIterator]() {
      if (!["chat", "transcribe", "synthesize"].includes(request.method)) {
        throw makeInferenceError("invalid_request", `Unknown method "${request.method}".`);
      }
      const inference = await resolver.resolve({
        method: request.method,
        mediaType: request.method === "transcribe" ? transcriptionMediaType(request) : undefined,
        needsTools,
        needsWebSearch,
        needsImageInput,
        needsImageOutput,
        signal: request.signal,
      });
      assertRequestMethod(request, inference.getFeatures?.() ?? {});
      const bound = inference.request.bind(inference) as Inference["request"];
      yield* bound(request);
    },
  };
}
