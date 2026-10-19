import { isInferenceError, makeInferenceError } from "./errors.js";
import { getInference, isInferenceAvailable } from "./inference.js";
import { supportsTranscription } from "./methods.js";
import type {
  Inference,
  InferenceFeatures,
  ChatRequest,
  InferenceMethod,
} from "./types.js";

/**
 * Availability for a non-IPA backend (and for probe() fallback fields).
 * IPA itself is only `"available"` | `"unavailable"`.
 */
export type BackendAvailability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

/**
 * Optional page-side backend that returns an `Inference`-shaped client.
 * Not an IPA implementation: no origin permission prompt, no user-chosen
 * provider/model, and must not be assigned to `window.inference`.
 */
export type InferenceBackend = {
  id: string;
  probe(): Promise<BackendAvailability>;
  create(options: {
    onDownloadProgress?: (loaded: number) => void;
    signal?: AbortSignal;
  }): Promise<Inference>;
  /**
   * Optional feature snapshot used to skip `create()` when the call needs
   * tools, search, images, or an optional method/MIME type that this backend
   * does not advertise (avoids download / session side effects). Optional
   * methods require an explicit snapshot before create().
   */
  getFeatures?(): InferenceFeatures;
};

/**
 * A fallback entry: a custom backend object (tests / hosted API / third-party).
 * `"ipa"` is invalid — IPA is always tried first.
 *
 * Apps import backend packages themselves and pass an object. Keeping those
 * imports out of ipa-tools avoids bundling optional backends for every app.
 */
export type FallbackEntry = InferenceBackend;

/** Input accepted by `fallbacks` options (validated by `normalizeFallbacks`). */
export type FallbackInput = InferenceBackend;

export type ResolveOptions = {
  fallbacks?: FallbackInput[];
  onDownloadProgress?: (loaded: number) => void;
  signal?: AbortSignal;
};

type ResolveRequestOptions = {
  method?: InferenceMethod;
  mediaType?: string;
  signal?: AbortSignal;
  /** When true, skip a fallback whose `getFeatures().toolCalling` is not true. */
  needsTools?: boolean;
  /** When true, skip a fallback whose `getFeatures().webSearch` is not true. */
  needsWebSearch?: boolean;
  /** When true, skip a fallback whose `getFeatures().imageInput` is not true. */
  needsImageInput?: boolean;
  /** When true, skip a fallback whose `getFeatures().imageOutput` is not true. */
  needsImageOutput?: boolean;
};

export type ProbeStatus = {
  ipa: "available" | "unavailable";
} & Record<string, BackendAvailability>;

/**
 * Maximum entries allowed in `fallbacks`. Kept as an array so this can rise
 * later without an API rename; start at one for a simpler mental model.
 */
export const MAX_FALLBACKS = 1;

/** Thrown when every fallback was skipped for lacking toolCalling. */
const NO_TOOLS_BACKEND_MESSAGE =
  "No configured backend supports tool calling.";

function isBackendObject(value: unknown): value is InferenceBackend {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as InferenceBackend).id === "string" &&
    (value as InferenceBackend).id.length > 0 &&
    typeof (value as InferenceBackend).probe === "function" &&
    typeof (value as InferenceBackend).create === "function"
  );
}

/**
 * Validate `fallbacks` shape. Throws `invalid_request` for `"ipa"`, strings,
 * malformed objects, or more than {@link MAX_FALLBACKS} entries.
 */
export function normalizeFallbacks(
  fallbacks: readonly unknown[] | undefined
): FallbackEntry[] {
  if (fallbacks == null) return [];
  if (!Array.isArray(fallbacks)) {
    throw makeInferenceError(
      "invalid_request",
      "fallbacks must be an array."
    );
  }
  if (fallbacks.length > MAX_FALLBACKS) {
    throw makeInferenceError(
      "invalid_request",
      `fallbacks accepts at most ${MAX_FALLBACKS} entr${
        MAX_FALLBACKS === 1 ? "y" : "ies"
      } (got ${fallbacks.length}).`
    );
  }

  const normalized: FallbackEntry[] = [];
  for (const entry of fallbacks) {
    if (typeof entry === "string") {
      if (entry === "ipa") {
        throw makeInferenceError(
          "invalid_request",
          '"ipa" is not a fallback; IPA is always tried first.'
        );
      }
      throw makeInferenceError(
        "invalid_request",
        `Unknown fallback "${entry}". Pass an InferenceBackend object.`
      );
    }
    if (isBackendObject(entry)) {
      if (entry.id === "ipa") {
        throw makeInferenceError(
          "invalid_request",
          '"ipa" is not a fallback; IPA is always tried first.'
        );
      }
      normalized.push(entry);
      continue;
    }
    throw makeInferenceError(
      "invalid_request",
      "fallbacks entries must be an InferenceBackend object."
    );
  }
  return normalized;
}

type CapabilityNeeds = {
  method: InferenceMethod;
  mediaType?: string;
  tools: boolean;
  webSearch: boolean;
  imageInput: boolean;
  imageOutput: boolean;
};

function capabilityNeedsFrom(
  resolveOptions?: ResolveRequestOptions
): CapabilityNeeds {
  return {
    method: resolveOptions?.method ?? "chat",
    mediaType: resolveOptions?.mediaType,
    tools: resolveOptions?.needsTools === true,
    webSearch: resolveOptions?.needsWebSearch === true,
    imageInput: resolveOptions?.needsImageInput === true,
    imageOutput: resolveOptions?.needsImageOutput === true,
  };
}

function needsAnyCapability(needs: CapabilityNeeds): boolean {
  return (
    needs.method !== "chat" || needs.tools || needs.webSearch ||
    needs.imageInput || needs.imageOutput
  );
}

function featuresSupportNeeded(
  features: InferenceFeatures,
  needs: CapabilityNeeds
): boolean {
  if (needs.method === "decide" && features.methods?.decide !== true) {
    return false;
  }
  if (needs.method === "transcribe" && !supportsTranscription(features, needs.mediaType)) {
    return false;
  }
  if (needs.method === "synthesize" && features.methods?.synthesize !== true) {
    return false;
  }
  if (needs.tools && features.toolCalling !== true) return false;
  if (needs.webSearch && features.webSearch !== true) return false;
  if (needs.imageInput && features.imageInput !== true) return false;
  if (needs.imageOutput && features.imageOutput !== true) return false;
  return true;
}

function supportsNeeded(inference: Inference, needs: CapabilityNeeds): boolean {
  return featuresSupportNeeded(inference.getFeatures?.() ?? {}, needs);
}

/** Prefer advertised features so unsupported requests do not create sessions. */
function backendSupportsNeeded(
  backend: InferenceBackend,
  needs: CapabilityNeeds
): boolean | undefined {
  if (typeof backend.getFeatures !== "function") {
    return needs.method === "chat" ? undefined : false;
  }
  return featuresSupportNeeded(backend.getFeatures(), needs);
}

function capabilitySkipMessage(needs: CapabilityNeeds): string {
  const labels: string[] = [];
  if (needs.method === "decide") labels.push("typed decisions");
  if (needs.method === "transcribe") {
    labels.push(`transcription${needs.mediaType ? ` of ${needs.mediaType}` : ""}`);
  }
  if (needs.method === "synthesize") labels.push("speech synthesis");
  if (needs.tools) labels.push("tool calling");
  if (needs.webSearch) labels.push("web search");
  if (needs.imageInput) labels.push("image input");
  if (needs.imageOutput) labels.push("image output");
  if (labels.length === 0) {
    return NO_TOOLS_BACKEND_MESSAGE;
  }
  if (labels.length === 1) {
    return `No configured backend supports ${labels[0]}.`;
  }
  if (labels.length === 2) {
    return `No configured backend supports ${labels[0]} and ${labels[1]}.`;
  }
  const last = labels[labels.length - 1];
  return `No configured backend supports ${labels.slice(0, -1).join(", ")}, and ${last}.`;
}

const CAPABILITY_SKIP = Symbol("capabilitySkip");

function shouldRetryCapabilitySkip(
  error: unknown,
  needs: CapabilityNeeds
): boolean {
  if (
    !isInferenceError(error) ||
    error.code !== "invalid_request"
  ) {
    return false;
  }
  const skipped = (error as typeof error & {
    [CAPABILITY_SKIP]?: CapabilityNeeds;
  })[CAPABILITY_SKIP];
  if (!skipped) return false;
  if (skipped.method !== needs.method || skipped.mediaType !== needs.mediaType) return true;
  if (skipped.tools && !needs.tools) return true;
  if (skipped.webSearch && !needs.webSearch) return true;
  if (skipped.imageInput && !needs.imageInput) return true;
  if (skipped.imageOutput && !needs.imageOutput) return true;
  return false;
}

/**
 * Probe IPA plus each configured fallback. Does not create sessions or start
 * downloads. Probe failures report `"unavailable"` (no throw).
 */
export async function probeFallbacks(
  fallbacks?: readonly FallbackInput[]
): Promise<ProbeStatus> {
  const entries = normalizeFallbacks(fallbacks);
  const status: ProbeStatus = {
    ipa: isInferenceAvailable() ? "available" : "unavailable",
  };

  for (const entry of entries) {
    try {
      status[entry.id] = await entry.probe();
    } catch {
      status[entry.id] = "unavailable";
    }
  }

  return status;
}

export type InferenceResolver = {
  probe(): Promise<ProbeStatus>;
  resolve(options?: ResolveRequestOptions): Promise<Inference>;
};

/**
 * IPA-first resolver with optional fallbacks. Caches a successful fallback
 * Inference; re-checks IPA on every resolve so an injector that appears later
 * still wins.
 */
export function createResolver(options?: ResolveOptions): InferenceResolver {
  const fallbacks = normalizeFallbacks(options?.fallbacks);
  const onDownloadProgress = options?.onDownloadProgress;
  let cachedFallback: Inference | undefined;
  /** The FallbackEntry that produced `cachedFallback` (identity, not id string). */
  let cachedFallbackEntry: FallbackEntry | undefined;
  /**
   * Single-flight resolve so concurrent callers share one create()/cache fill
   * and the same success or failure (no duplicate downloads on create error).
   */
  let resolveInFlight: Promise<Inference> | undefined;

  async function resolveOnce(
    resolveOptions?: ResolveRequestOptions
  ): Promise<Inference> {
    const needs = capabilityNeedsFrom(resolveOptions);
    const signal = resolveOptions?.signal ?? options?.signal;
    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw makeInferenceError("aborted", "Request aborted");
      }
    };

    throwIfAborted();

    if (isInferenceAvailable()) {
      return getInference();
    }

    if (
      cachedFallback &&
      supportsNeeded(cachedFallback, needs)
    ) {
      return cachedFallback;
    }

    let skippedForCapabilities = false;
    let lastCreateError: unknown;

    for (const entry of fallbacks) {
      throwIfAborted();

      if (
        cachedFallback &&
        entry === cachedFallbackEntry &&
        !supportsNeeded(cachedFallback, needs)
      ) {
        // Already resolved this exact entry; it lacks a required capability.
        skippedForCapabilities = true;
        continue;
      }

      const backend = entry;
      throwIfAborted();

      let availability: BackendAvailability;
      try {
        availability = await backend.probe();
      } catch {
        continue;
      }
      throwIfAborted();
      if (availability === "unavailable") {
        continue;
      }

      if (
        backendSupportsNeeded(backend, needs) === false
      ) {
        skippedForCapabilities = true;
        continue;
      }

      // Re-check before create(): an injector that appeared during probe
      // must win without starting a fallback download.
      if (isInferenceAvailable()) {
        return getInference();
      }

      let inference: Inference;
      try {
        inference = await backend.create({
          onDownloadProgress,
          signal,
        });
      } catch (error) {
        // create() failure (download/init): try later entries, same as probe.
        // Still honor abort so cancel does not keep walking the chain.
        if (signal?.aborted) {
          throw makeInferenceError("aborted", "Request aborted");
        }
        if (
          error != null &&
          typeof error === "object" &&
          (error as { code?: unknown }).code === "aborted"
        ) {
          throw error;
        }
        lastCreateError = error;
        continue;
      }
      throwIfAborted();

      // Re-check after create(): a late injector (e.g. during a long
      // download) must still win over the fallback for this request.
      if (isInferenceAvailable()) {
        return getInference();
      }

      if (!supportsNeeded(inference, needs)) {
        // Cache so later capability requests skip recreate via cachedFallbackEntry.
        skippedForCapabilities = true;
        cachedFallback = inference;
        cachedFallbackEntry = entry;
        continue;
      }

      cachedFallback = inference;
      cachedFallbackEntry = entry;
      return inference;
    }

    throwIfAborted();

    // Prefer the real download/init error over tools-capability / unavailable.
    // A tools skip earlier in the chain must not mask a later create() failure.
    if (lastCreateError != null) {
      throw lastCreateError;
    }

    if (needsAnyCapability(needs) && skippedForCapabilities) {
      throw Object.assign(
        makeInferenceError("invalid_request", capabilitySkipMessage(needs)),
        { [CAPABILITY_SKIP]: needs }
      );
    }

    throw makeInferenceError(
      "unavailable",
      fallbacks.length === 0
        ? "window.inference is not available."
        : "No inference backend is available."
    );
  }

  return {
    probe() {
      return probeFallbacks(fallbacks);
    },

    async resolve(resolveOptions) {
      const needs = capabilityNeedsFrom(resolveOptions);
      const signal = resolveOptions?.signal ?? options?.signal;
      const throwIfAborted = () => {
        if (signal?.aborted) {
          throw makeInferenceError("aborted", "Request aborted");
        }
      };

      // Fast paths: avoid joining an in-flight download when we already have
      // a usable Inference (IPA or compatible cache).
      throwIfAborted();
      if (isInferenceAvailable()) {
        return getInference();
      }
      if (
        cachedFallback &&
        supportsNeeded(cachedFallback, needs)
      ) {
        return cachedFallback;
      }

      // Join or start a single in-flight attempt. Loop when:
      // - a concurrent weaker resolve succeeded with a backend that lacks a
      //   capability this caller needs, or
      // - a concurrent capability resolve rejected with a skip error while
      //   this caller does not need that capability (may succeed against the
      //   same chain).
      for (;;) {
        throwIfAborted();
        if (!resolveInFlight) {
          const pending = resolveOnce(resolveOptions).finally(() => {
            if (resolveInFlight === pending) {
              resolveInFlight = undefined;
            }
          });
          resolveInFlight = pending;
        }

        try {
          const shared = await resolveInFlight;
          throwIfAborted();
          if (isInferenceAvailable()) {
            return getInference();
          }
          if (supportsNeeded(shared, needs)) {
            return shared;
          }
          // Shared result lacks a capability this caller needs. Drop the
          // settled in-flight so the next loop starts resolveOnce with this
          // caller's flags instead of re-awaiting the same result.
          resolveInFlight = undefined;
          continue;
        } catch (error) {
          throwIfAborted();
          // Only retry for a capability-skip rejection from a concurrent
          // resolve this caller would not also produce — not
          // create()/validation invalid_request, which would loop forever
          // when no backend succeeds.
          if (shouldRetryCapabilitySkip(error, needs)) {
            resolveInFlight = undefined;
            continue;
          }
          // Share create/unavailable failures with concurrent waiters.
          throw error;
        }
      }
    },
  };
}

/** True when the request includes at least one function tool. */
export function requestNeedsTools(request: {
  tools?: ChatRequest["tools"];
}): boolean {
  return (
    Array.isArray(request.tools) &&
    request.tools.some((tool) => tool?.type === "function")
  );
}

/** True when the request includes `{ type: "web_search" }`. */
export function requestNeedsWebSearch(request: {
  tools?: ChatRequest["tools"];
}): boolean {
  return (
    Array.isArray(request.tools) &&
    request.tools.some((tool) => tool?.type === "web_search")
  );
}

function isImagePart(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "image"
  );
}

/** True when user or assistant `content` includes an ImagePart. */
export function requestNeedsImageInput(request: {
  messages?: ChatRequest["messages"];
}): boolean {
  if (!Array.isArray(request.messages)) return false;
  for (const message of request.messages) {
    if (message == null || typeof message !== "object") continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    if (content.some(isImagePart)) return true;
  }
  return false;
}

/** True when the request sets `output.images: true`. */
export function requestNeedsImageOutput(request: {
  output?: ChatRequest["output"];
}): boolean {
  return request.output?.images === true;
}
