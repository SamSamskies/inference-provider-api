import {
  makeInferenceError,
  type Inference,
  type InferenceBackend,
  type InferenceChunk,
  type InferenceFeatures,
  type InferenceRequest,
  type BackendAvailability,
} from "ipa-tools";
import { abortable, mapTransformersError, throwIfAborted } from "./errors.js";
import { extractGeneratedText, toChatMessages } from "./messages.js";
import { createProgressAggregator } from "./progress.js";
import {
  loadTransformers as defaultLoadTransformers,
  type LoadTransformers,
  type TextGenerationPipeline,
  type TransformersModule,
} from "./transformers.js";

/** Stable backend id — also the key returned from `createInference().probe()`. */
export const TRANSFORMERS_BACKEND_ID = "transformers";

/**
 * Default instruct model (ONNX). First q4 download is roughly 800 MB —
 * disclose that before `create()` when status is `downloadable`.
 */
export const DEFAULT_TRANSFORMERS_MODEL =
  "onnx-community/Qwen2.5-0.5B-Instruct";

export const DEFAULT_TRANSFORMERS_DTYPE = "q4";

/** Human-readable size hint for {@link DEFAULT_TRANSFORMERS_MODEL} + q4. */
export const DEFAULT_MODEL_SIZE_HINT = "about 800 MB";

const DEFAULT_MAX_NEW_TOKENS = 256;

const FEATURES: InferenceFeatures = {
  toolCalling: false,
  options: { temperature: true },
};

export type CreateTransformersBackendOptions = {
  /** Hugging Face model id. Defaults to {@link DEFAULT_TRANSFORMERS_MODEL}. */
  model?: string;
  /** Quantization / dtype passed to `pipeline()` (default `"q4"`). */
  dtype?: string;
  /** Device hint (`"wasm"`, `"webgpu"`, `"auto"`, …). Omitted = library default. */
  device?: string;
  /** Generation cap per request (default 256). */
  maxNewTokens?: number;
  /**
   * Inject the Transformers.js module (tests, CDN). Defaults to
   * `import("@huggingface/transformers")`.
   */
  loadTransformers?: LoadTransformers;
};

/**
 * Transformers.js availability for the given model. Does **not** call
 * `pipeline()` / start a weight download. Prefer `createInference().probe()`.
 *
 * - `"unavailable"` — no WebAssembly, or the library failed to load
 * - `"available"` — `ModelRegistry.is_pipeline_cached` is true
 * - `"downloadable"` — WASM works; weights are not known to be cached
 */
export async function getTransformersAvailability(
  options?: CreateTransformersBackendOptions
): Promise<BackendAvailability> {
  if (typeof WebAssembly === "undefined") {
    return "unavailable";
  }

  const load = options?.loadTransformers ?? defaultLoadTransformers;
  let transformers: TransformersModule;
  try {
    transformers = await load();
  } catch {
    return "unavailable";
  }
  if (typeof transformers.pipeline !== "function") {
    return "unavailable";
  }

  const isCached = transformers.ModelRegistry?.is_pipeline_cached;
  if (typeof isCached !== "function") {
    return "downloadable";
  }

  try {
    const cached = await isCached(
      "text-generation",
      options?.model ?? DEFAULT_TRANSFORMERS_MODEL,
      cacheOptions(options)
    );
    return cached ? "available" : "downloadable";
  } catch {
    return "downloadable";
  }
}

/**
 * Hugging Face Transformers.js → `Inference` compatibility backend for
 * `createInference({ fallbacks: [...] })`.
 *
 * This is **not** IPA: no origin permission prompt, no user-chosen
 * provider/model, and it must not be assigned to `window.inference`.
 */
export function createTransformersBackend(
  options?: CreateTransformersBackendOptions
): InferenceBackend {
  const model = options?.model ?? DEFAULT_TRANSFORMERS_MODEL;
  const dtype = options?.dtype ?? DEFAULT_TRANSFORMERS_DTYPE;
  const maxNewTokens = options?.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS;
  const load = options?.loadTransformers ?? defaultLoadTransformers;

  let creating = false;
  let ready = false;

  return {
    id: TRANSFORMERS_BACKEND_ID,

    async probe() {
      if (creating) return "downloading";
      if (ready) return "available";
      return getTransformersAvailability(options);
    },

    getFeatures() {
      return FEATURES;
    },

    async create(createOptions) {
      throwIfAborted(createOptions.signal);
      creating = true;
      let pipeline: TextGenerationPipeline | undefined;
      try {
        const transformers = await load();
        throwIfAborted(createOptions.signal);
        if (typeof transformers.pipeline !== "function") {
          throw makeInferenceError(
            "unavailable",
            "Transformers.js pipeline() is not available."
          );
        }

        let sawProgress = false;
        const loadedFromInfo = createProgressAggregator();
        pipeline = await abortable(
          transformers.pipeline("text-generation", model, {
            dtype,
            ...(options?.device ? { device: options.device } : {}),
            progress_callback(info) {
              throwIfAborted(createOptions.signal);
              const loaded = loadedFromInfo(info);
              if (loaded == null) return;
              sawProgress = true;
              createOptions.onDownloadProgress?.(loaded);
            },
          }),
          createOptions.signal
        );
        throwIfAborted(createOptions.signal);

        if (!sawProgress) {
          createOptions.onDownloadProgress?.(1);
        }

        ready = true;
        return createInferenceFromPipeline(pipeline, transformers, {
          model,
          maxNewTokens,
        });
      } catch (error) {
        if (pipeline != null) {
          try {
            await pipeline.dispose?.();
          } catch {
            // ignore dispose errors
          }
        }
        throw mapTransformersError(error);
      } finally {
        creating = false;
      }
    },
  };
}

function cacheOptions(options?: CreateTransformersBackendOptions): {
  dtype: string;
  device?: string;
} {
  const out: { dtype: string; device?: string } = {
    dtype: options?.dtype ?? DEFAULT_TRANSFORMERS_DTYPE,
  };
  if (options?.device) out.device = options.device;
  return out;
}

function createInferenceFromPipeline(
  pipeline: TextGenerationPipeline,
  transformers: TransformersModule,
  config: { model: string; maxNewTokens: number }
): Inference {
  return {
    getFeatures() {
      return FEATURES;
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
              "Transformers.js backend does not support tools."
            );
          }

          const signal = request.signal;
          throwIfAborted(signal);

          const messages = toChatMessages(request.messages);
          yield { type: "accepted" };

          const genOptions: {
            max_new_tokens: number;
            temperature?: number;
            do_sample?: boolean;
            streamer?: unknown;
          } = { max_new_tokens: config.maxNewTokens };

          const temperature = request.options?.temperature;
          if (typeof temperature === "number") {
            genOptions.temperature = temperature;
            genOptions.do_sample = temperature > 0;
          }

          try {
            const Streamer = transformers.TextStreamer;
            if (typeof Streamer === "function") {
              yield* streamGenerate(pipeline, Streamer, messages, genOptions, {
                model: config.model,
                signal,
              });
              return;
            }

            const result = await abortable(
              Promise.resolve(pipeline(messages, genOptions)),
              signal
            );
            throwIfAborted(signal);
            const full = extractGeneratedText(result);
            if (full) {
              yield { type: "delta", content: full };
            }
            yield {
              type: "done",
              model: config.model,
              message: { role: "assistant", content: full },
            };
          } catch (error) {
            throw mapTransformersError(error);
          }
        },
      };
    },
  };
}

async function* streamGenerate(
  pipeline: TextGenerationPipeline,
  Streamer: NonNullable<TransformersModule["TextStreamer"]>,
  messages: ReturnType<typeof toChatMessages>,
  genOptions: {
    max_new_tokens: number;
    temperature?: number;
    do_sample?: boolean;
    streamer?: unknown;
  },
  config: { model: string; signal?: AbortSignal }
): AsyncGenerator<InferenceChunk> {
  const queue = createTextQueue();
  const streamer = new Streamer(pipeline.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function(text: string) {
      if (config.signal?.aborted) return;
      if (text) queue.push(text);
    },
  });
  genOptions.streamer = streamer;

  const generate = Promise.resolve(pipeline(messages, genOptions)).then(
    () => {
      queue.close();
    },
    (error) => {
      queue.fail(error);
    }
  );

  let full = "";
  try {
    for await (const text of queue) {
      throwIfAborted(config.signal);
      full += text;
      yield { type: "delta", content: text };
    }
  } finally {
    await generate.catch(() => {
      // Rejection is surfaced via queue.fail / iterate throw.
    });
  }

  throwIfAborted(config.signal);
  yield {
    type: "done",
    model: config.model,
    message: { role: "assistant", content: full },
  };
}

function createTextQueue(): AsyncIterable<string> & {
  push(text: string): void;
  close(): void;
  fail(error: unknown): void;
} {
  const items: string[] = [];
  let done = false;
  let error: unknown;
  let notify: (() => void) | undefined;

  const wake = () => {
    const fn = notify;
    notify = undefined;
    fn?.();
  };

  return {
    push(text: string) {
      if (done) return;
      items.push(text);
      wake();
    },
    close() {
      done = true;
      wake();
    },
    fail(err: unknown) {
      error = err;
      done = true;
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length === 0 && !done) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
        if (error != null) throw error;
        const next = items.shift();
        if (next != null) {
          yield next;
          continue;
        }
        if (done) return;
      }
    },
  };
}
