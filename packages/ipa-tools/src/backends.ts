import { isInferenceError, makeInferenceError } from "./errors.js";
import { getInference, isInferenceAvailable } from "./inference.js";
import type {
  Inference,
  InferenceFeatures,
  InferenceRequest,
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
   * tools and `toolCalling` is not true (avoids download / session side effects).
   */
  getFeatures?(): InferenceFeatures;
};

/**
 * A fallback entry: a custom backend object (tests / hosted API / third-party).
 * `"ipa"` is invalid — IPA is always tried first.
 *
 * Built-in string aliases (e.g. `"promptApi"` → optional peer) are deferred
 * until those packages ship — a dynamic `import()` of a missing peer makes
 * Vite/Rollup warn or fail even when callers never request a fallback.
 */
export type FallbackEntry = InferenceBackend;

/** Input accepted by `fallbacks` options (validated by `normalizeFallbacks`). */
export type FallbackInput = InferenceBackend;

export type ResolveOptions = {
  fallbacks?: FallbackInput[];
  onDownloadProgress?: (loaded: number) => void;
  signal?: AbortSignal;
  /** When true, skip a fallback whose `getFeatures().toolCalling` is not true. */
  needsTools?: boolean;
};

export type ProbeStatus = {
  ipa: "available" | "unavailable";
} & Record<string, BackendAvailability | "available" | "unavailable">;

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

function supportsTools(inference: Inference): boolean {
  return inference.getFeatures?.().toolCalling === true;
}

/** Prefer backend-advertised features so we can skip `create()` for tools. */
function backendSupportsTools(backend: InferenceBackend): boolean | undefined {
  if (typeof backend.getFeatures !== "function") return undefined;
  return backend.getFeatures().toolCalling === true;
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
  resolve(options?: {
    needsTools?: boolean;
    signal?: AbortSignal;
  }): Promise<Inference>;
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

  async function resolveOnce(resolveOptions?: {
    needsTools?: boolean;
    signal?: AbortSignal;
  }): Promise<Inference> {
    const needsTools = resolveOptions?.needsTools === true;
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

    if (cachedFallback && (!needsTools || supportsTools(cachedFallback))) {
      return cachedFallback;
    }

    let skippedForTools = false;
    let lastCreateError: unknown;

    for (const entry of fallbacks) {
      throwIfAborted();

      if (
        needsTools &&
        cachedFallback &&
        entry === cachedFallbackEntry &&
        !supportsTools(cachedFallback)
      ) {
        // Already resolved this exact entry; it lacks toolCalling.
        skippedForTools = true;
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

      if (needsTools && backendSupportsTools(backend) === false) {
        skippedForTools = true;
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

      if (needsTools && !supportsTools(inference)) {
        // Cache so later tools requests skip recreate via cachedFallbackEntry.
        skippedForTools = true;
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

    if (needsTools && skippedForTools) {
      throw makeInferenceError("invalid_request", NO_TOOLS_BACKEND_MESSAGE);
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
      const needsTools = resolveOptions?.needsTools === true;
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
      if (cachedFallback && (!needsTools || supportsTools(cachedFallback))) {
        return cachedFallback;
      }

      // Join or start a single in-flight attempt. Loop when:
      // - a concurrent non-tools resolve succeeded with a no-tools backend, or
      // - a concurrent tools resolve rejected with tools invalid_request while
      //   this caller only needs plain chat (may succeed against the same chain).
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
          if (!needsTools || supportsTools(shared)) {
            return shared;
          }
        } catch (error) {
          throwIfAborted();
          // Only retry for the tools-capability rejection from a concurrent
          // needsTools resolve — not create()/validation invalid_request,
          // which would loop forever when no backend succeeds.
          if (
            !needsTools &&
            isInferenceError(error) &&
            error.code === "invalid_request" &&
            error.message === NO_TOOLS_BACKEND_MESSAGE
          ) {
            continue;
          }
          // Share create/unavailable failures with concurrent waiters.
          throw error;
        }
      }
    },
  };
}

/** True when the request carries a non-empty `tools` array. */
export function requestNeedsTools(request: {
  tools?: InferenceRequest["tools"];
}): boolean {
  return Array.isArray(request.tools) && request.tools.length > 0;
}
