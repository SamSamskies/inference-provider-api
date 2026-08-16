import { makeInferenceError } from "./errors.js";
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

/** Built-in fallback aliases resolved via optional peer packages. */
export type BuiltinFallbackId = "promptApi";

/**
 * A fallback entry: a built-in alias string, or a custom backend object
 * (escape hatch / tests). `"ipa"` is invalid — IPA is always tried first.
 */
export type FallbackEntry = BuiltinFallbackId | InferenceBackend;

/** Input accepted by `fallbacks` options (validated by `normalizeFallbacks`). */
export type FallbackInput = string | InferenceBackend;

export type ResolveOptions = {
  fallbacks?: FallbackInput[];
  onDownloadProgress?: (loaded: number) => void;
  signal?: AbortSignal;
  /** When true, skip fallbacks whose `getFeatures().toolCalling` is not true. */
  needsTools?: boolean;
};

export type ProbeStatus = {
  ipa: "available" | "unavailable";
} & Record<string, BackendAvailability | "available" | "unavailable">;

const BUILTIN_FALLBACKS = new Set<string>(["promptApi"]);

const MISSING_PEER_MESSAGE =
  'Install "ipa-prompt-api-fallback" to use fallbacks: ["promptApi"].';

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
 * Validate `fallbacks` shape. Throws `invalid_request` for `"ipa"`, unknown
 * strings, or malformed objects. Does not load peer packages.
 */
export function normalizeFallbacks(
  fallbacks: readonly FallbackInput[] | undefined
): FallbackEntry[] {
  if (fallbacks == null) return [];
  if (!Array.isArray(fallbacks)) {
    throw makeInferenceError(
      "invalid_request",
      "fallbacks must be an array."
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
      if (!BUILTIN_FALLBACKS.has(entry)) {
        throw makeInferenceError(
          "invalid_request",
          `Unknown fallback "${entry}".`
        );
      }
      normalized.push(entry as BuiltinFallbackId);
      continue;
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
      "fallbacks entries must be a known string or an InferenceBackend object."
    );
  }
  return normalized;
}

function isMissingModuleError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
  // Match resolver wording only — do not treat any message that merely names
  // the peer package as missing (that masks real import/init failures).
  return (
    message.includes("Cannot find module") ||
    message.includes("Failed to resolve") ||
    message.includes("Cannot find package")
  );
}

async function loadBuiltinBackend(
  id: BuiltinFallbackId
): Promise<InferenceBackend> {
  if (id === "promptApi") {
    try {
      // Optional peer — resolved at runtime only when requested.
      const specifier = "ipa-prompt-api-fallback";
      const mod = (await import(specifier)) as {
        backend?: InferenceBackend;
        default?: InferenceBackend;
      };
      const backend = mod.backend ?? mod.default;
      if (!isBackendObject(backend)) {
        throw makeInferenceError(
          "unavailable",
          'Package "ipa-prompt-api-fallback" does not export a valid InferenceBackend.'
        );
      }
      return backend;
    } catch (error) {
      if (
        isInferenceErrorUnavailable(error) &&
        error.message.includes("ipa-prompt-api-fallback")
      ) {
        throw error;
      }
      if (isMissingModuleError(error)) {
        throw makeInferenceError("unavailable", MISSING_PEER_MESSAGE);
      }
      throw error;
    }
  }
  throw makeInferenceError("invalid_request", `Unknown fallback "${id}".`);
}

function isInferenceErrorUnavailable(
  error: unknown
): error is Error & { code: string } {
  return (
    error != null &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "unavailable" &&
    error instanceof Error
  );
}

async function resolveBackendEntry(
  entry: FallbackEntry
): Promise<InferenceBackend> {
  if (typeof entry === "string") {
    return loadBuiltinBackend(entry);
  }
  return entry;
}

function fallbackProbeKey(entry: FallbackEntry): string {
  return typeof entry === "string" ? entry : entry.id;
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
 * downloads. Missing optional peers report `"unavailable"` (no throw).
 */
export async function probeFallbacks(
  fallbacks?: readonly FallbackInput[]
): Promise<ProbeStatus> {
  const entries = normalizeFallbacks(fallbacks);
  const status: ProbeStatus = {
    ipa: isInferenceAvailable() ? "available" : "unavailable",
  };

  for (const entry of entries) {
    const key = fallbackProbeKey(entry);
    if (typeof entry !== "string") {
      try {
        status[key] = await entry.probe();
      } catch {
        status[key] = "unavailable";
      }
      continue;
    }
    try {
      const backend = await resolveBackendEntry(entry);
      status[key] = await backend.probe();
    } catch {
      status[key] = "unavailable";
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
  let cachedFallbackId: string | undefined;
  /** Serialize resolve() so concurrent callers share one create()/cache fill. */
  let resolveMutex: Promise<void> = Promise.resolve();

  return {
    probe() {
      return probeFallbacks(fallbacks);
    },

    async resolve(resolveOptions) {
      let release!: () => void;
      const previous = resolveMutex;
      resolveMutex = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      try {
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
        let resolveLoadFailures = 0;
        let lastResolveError: unknown;

        for (const entry of fallbacks) {
          throwIfAborted();

          const entryId = typeof entry === "string" ? entry : entry.id;
          if (
            needsTools &&
            cachedFallback &&
            cachedFallbackId === entryId &&
            !supportsTools(cachedFallback)
          ) {
            // Already resolved this backend; it lacks toolCalling.
            skippedForTools = true;
            continue;
          }

          let backend: InferenceBackend;
          try {
            backend = await resolveBackendEntry(entry);
          } catch (error) {
            // Missing peer / load failure: try later entries (probe treats these
            // as "unavailable"). Rethrow only if every entry failed to load.
            resolveLoadFailures++;
            lastResolveError = error;
            continue;
          }
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

          const inference = await backend.create({
            onDownloadProgress,
            signal,
          });
          throwIfAborted();

          // Re-check after create(): a late injector (e.g. during a long
          // download) must still win over the fallback for this request.
          if (isInferenceAvailable()) {
            return getInference();
          }

          if (needsTools && !supportsTools(inference)) {
            skippedForTools = true;
            continue;
          }

          cachedFallback = inference;
          cachedFallbackId = entryId;
          return inference;
        }

        throwIfAborted();

        if (needsTools && skippedForTools) {
          throw makeInferenceError(
            "invalid_request",
            "No configured backend supports tool calling."
          );
        }

        if (
          fallbacks.length > 0 &&
          resolveLoadFailures === fallbacks.length &&
          lastResolveError != null
        ) {
          throw lastResolveError;
        }

        throw makeInferenceError(
          "unavailable",
          fallbacks.length === 0
            ? "window.inference is not available."
            : "No inference backend is available."
        );
      } finally {
        release();
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
