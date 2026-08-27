import {
  makeInferenceError,
  type Inference,
  type InferenceBackend,
  type InferenceChunk,
  type InferenceFeatures,
  type InferenceRequest,
  type BackendAvailability,
} from "ipa-tools";
import {
  getLanguageModel,
  mapPromptApiError,
  toDelta,
} from "./errors.js";
import type {
  LanguageModelCreateOptions,
  LanguageModelSession,
} from "./language-model.js";
import { toLanguageModelMessages } from "./messages.js";

/** Stable backend id — also the key returned from `createInference().probe()`. */
export const PROMPT_API_BACKEND_ID = "promptApi";

/** Model label on synthesized `done` chunks (lossy; not a user-chosen provider). */
export const PROMPT_API_MODEL = "on-device";

const DEFAULT_SESSION_OPTIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export type CreatePromptApiBackendOptions = {
  /**
   * Forwarded to `LanguageModel.availability()` / `create()`.
   * Defaults to English text in / text out.
   */
  expectedInputs?: LanguageModelCreateOptions["expectedInputs"];
  expectedOutputs?: LanguageModelCreateOptions["expectedOutputs"];
};

/**
 * Raw Chrome Prompt API availability (does not start a download).
 * Prefer `createInference(...).probe()` when using ipa-tools fallbacks.
 */
export async function getPromptApiAvailability(
  options?: CreatePromptApiBackendOptions
): Promise<BackendAvailability> {
  const LanguageModel = getLanguageModel();
  if (LanguageModel == null || typeof LanguageModel.availability !== "function") {
    return "unavailable";
  }

  try {
    const result = await LanguageModel.availability({
      ...DEFAULT_SESSION_OPTIONS,
      ...pickExpected(options),
    });
    return normalizeAvailability(result);
  } catch {
    return "unavailable";
  }
}

/**
 * Chrome Prompt API → `Inference` compatibility backend for
 * `createInference({ fallbacks: [...] })`.
 *
 * This is **not** IPA: no origin permission prompt, no user-chosen
 * provider/model, and it must not be assigned to `window.inference`.
 */
export function createPromptApiBackend(
  options?: CreatePromptApiBackendOptions
): InferenceBackend {
  const sessionOptions = {
    ...DEFAULT_SESSION_OPTIONS,
    ...pickExpected(options),
  };

  return {
    id: PROMPT_API_BACKEND_ID,

    probe() {
      return getPromptApiAvailability(options);
    },

    getFeatures(): InferenceFeatures {
      return { toolCalling: false };
    },

    async create(createOptions) {
      const LanguageModel = getLanguageModel();
      if (LanguageModel == null || typeof LanguageModel.create !== "function") {
        throw makeInferenceError(
          "unavailable",
          "Chrome Prompt API (LanguageModel) is not available."
        );
      }

      const signal = createOptions.signal;
      throwIfAborted(signal);

      let session: LanguageModelSession;
      try {
        session = await LanguageModel.create({
          ...sessionOptions,
          signal,
          monitor(monitor) {
            if (typeof createOptions.onDownloadProgress !== "function") return;
            monitor.addEventListener("downloadprogress", (event) => {
              const loaded =
                typeof event?.loaded === "number" ? event.loaded : 0;
              createOptions.onDownloadProgress?.(loaded);
            });
          },
        });
      } catch (error) {
        throw mapPromptApiError(error);
      }

      throwIfAborted(signal);
      return createInferenceFromSession(session, sessionOptions);
    },
  };
}

function createInferenceFromSession(
  baseSession: LanguageModelSession,
  sessionOptions: LanguageModelCreateOptions
): Inference {
  return {
    getFeatures() {
      return { toolCalling: false };
    },

    request(request: InferenceRequest): AsyncIterable<InferenceChunk> {
      return {
        async *[Symbol.asyncIterator]() {
          if (request.method !== "chat") {
            throw makeInferenceError(
              "invalid_request",
              'Only method "chat" is supported.'
            );
          }
          if (Array.isArray(request.tools) && request.tools.length > 0) {
            throw makeInferenceError(
              "invalid_request",
              "Prompt API backend does not support tools."
            );
          }
          if (request.output?.images === true) {
            throw makeInferenceError(
              "invalid_request",
              "Prompt API backend does not support image output."
            );
          }

          const signal = request.signal;
          throwIfAborted(signal);

          const prompts = toLanguageModelMessages(request.messages);
          let session: LanguageModelSession | undefined;

          try {
            session = await openRequestSession(
              baseSession,
              sessionOptions,
              signal
            );
            throwIfAborted(signal);

            // Synthesized: Prompt API has no IPA-style permission prompt.
            yield { type: "accepted" };

            const stream = session.promptStreaming(prompts, { signal });
            let previous = "";
            let full = "";

            for await (const raw of iteratePromptStream(stream)) {
              throwIfAborted(signal);
              const chunk = typeof raw === "string" ? raw : String(raw ?? "");
              const { delta, next } = toDelta(previous, chunk);
              previous = next;
              if (!delta) continue;
              full += delta;
              yield { type: "delta", content: delta };
            }

            throwIfAborted(signal);
            yield {
              type: "done",
              model: PROMPT_API_MODEL,
              message: { role: "assistant", content: full },
            };
          } catch (error) {
            throw mapPromptApiError(error);
          } finally {
            // Always destroy the per-request session (clone or one-shot create).
            // Never prompt on the warm base — that would accumulate context.
            if (session != null) {
              try {
                session.destroy();
              } catch {
                // ignore destroy errors
              }
            }
          }
        },
      };
    },
  };
}

/**
 * Prefer cloning the warm base session (keeps download / initial setup).
 * If clone is missing or fails for a non-abort reason, create a one-shot
 * session so each request starts with an empty conversation context.
 */
async function openRequestSession(
  baseSession: LanguageModelSession,
  sessionOptions: LanguageModelCreateOptions,
  signal?: AbortSignal
): Promise<LanguageModelSession> {
  if (typeof baseSession.clone === "function") {
    try {
      return await baseSession.clone({ signal });
    } catch (error) {
      if (signal?.aborted || isAbortName(error)) {
        throw mapPromptApiError(error);
      }
      // Fall through to one-shot create.
    }
  }

  const LanguageModel = getLanguageModel();
  if (LanguageModel == null || typeof LanguageModel.create !== "function") {
    throw makeInferenceError(
      "unavailable",
      "Chrome Prompt API (LanguageModel) is not available."
    );
  }

  try {
    return await LanguageModel.create({
      ...sessionOptions,
      signal,
    });
  } catch (error) {
    throw mapPromptApiError(error);
  }
}

async function* iteratePromptStream(
  stream: ReadableStream<string> | AsyncIterable<string>
): AsyncGenerator<string> {
  if (isAsyncIterable(stream)) {
    for await (const chunk of stream) {
      yield chunk;
    }
    return;
  }

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value != null) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function isAsyncIterable(
  value: ReadableStream<string> | AsyncIterable<string>
): value is AsyncIterable<string> {
  return (
    value != null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<string>)[Symbol.asyncIterator] === "function"
  );
}

function pickExpected(options?: CreatePromptApiBackendOptions) {
  const out: LanguageModelCreateOptions = {};
  if (options?.expectedInputs) out.expectedInputs = options.expectedInputs;
  if (options?.expectedOutputs) out.expectedOutputs = options.expectedOutputs;
  return out;
}

function normalizeAvailability(value: unknown): BackendAvailability {
  if (
    value === "unavailable" ||
    value === "downloadable" ||
    value === "downloading" ||
    value === "available"
  ) {
    return value;
  }
  return "unavailable";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw makeInferenceError("aborted", "Request aborted");
  }
}

function isAbortName(error: unknown): boolean {
  return (
    error != null &&
    typeof error === "object" &&
    "name" in error &&
    String((error as { name: unknown }).name) === "AbortError"
  );
}
