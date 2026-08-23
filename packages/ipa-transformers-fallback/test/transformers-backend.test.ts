import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInference,
  isInferenceAvailable,
  isInferenceError,
} from "ipa-tools";
import {
  createTransformersBackend,
  getTransformersAvailability,
  TRANSFORMERS_BACKEND_ID,
} from "../src/index.js";
import { loadedFromProgress } from "../src/progress.js";
import { extractGeneratedText } from "../src/messages.js";
import type { TransformersModule } from "../src/transformers.js";

class MockTextStreamer {
  callback: ((text: string) => void) | undefined;
  constructor(
    _tokenizer: unknown,
    options?: { callback_function?: (text: string) => void }
  ) {
    this.callback = options?.callback_function;
  }
}

function makePipeline(
  chunks: string[],
  generated?: unknown
): TransformersModule["pipeline"] extends (
  ...args: never[]
) => Promise<infer R>
  ? R extends Promise<infer P>
    ? P
    : never
  : never {
  const generate = Object.assign(
    async (
      _messages: unknown,
      options?: { streamer?: MockTextStreamer }
    ) => {
      const streamer = options?.streamer;
      for (const chunk of chunks) {
        streamer?.callback?.(chunk);
      }
      return (
        generated ?? [
          {
            generated_text: [
              { role: "assistant", content: chunks.join("") },
            ],
          },
        ]
      );
    },
    { tokenizer: {} }
  );
  return generate as never;
}

function mockTransformers(overrides?: {
  pipeline?: TransformersModule["pipeline"];
  isCached?: boolean | (() => Promise<boolean>);
  omitStreamer?: boolean;
  omitRegistry?: boolean;
}): TransformersModule {
  const pipeline =
    overrides?.pipeline ??
    (vi.fn(async (_task, _model, opts?: { progress_callback?: (info: { status?: string; progress?: number }) => void }) => {
      opts?.progress_callback?.({ status: "progress_total", progress: 40 });
      opts?.progress_callback?.({ status: "progress_total", progress: 100 });
      opts?.progress_callback?.({ status: "ready" });
      return makePipeline(["Hello", " world"]);
    }) as TransformersModule["pipeline"]);

  const transformers: TransformersModule = {
    pipeline,
  };
  if (!overrides?.omitStreamer) {
    transformers.TextStreamer = MockTextStreamer;
  }
  if (!overrides?.omitRegistry) {
    const isCached = overrides?.isCached;
    transformers.ModelRegistry = {
      async is_pipeline_cached() {
        if (typeof isCached === "function") return isCached();
        return isCached === true;
      },
    };
  }
  return transformers;
}

afterEach(() => {
  delete (globalThis as { window?: { inference?: unknown } }).window;
  vi.restoreAllMocks();
});

describe("loadedFromProgress", () => {
  it("maps progress_total 0–100 onto 0…1", () => {
    expect(loadedFromProgress({ status: "progress_total", progress: 40 })).toBe(
      0.4
    );
    expect(loadedFromProgress({ status: "progress_total", progress: 0.25 })).toBe(
      0.25
    );
    expect(loadedFromProgress({ status: "ready" })).toBe(1);
  });

  it("aggregates per-file loaded/total when progress_total is absent", () => {
    const files = new Map<string, { loaded: number; total: number }>();
    expect(
      loadedFromProgress(
        { status: "progress", file: "a.onnx", loaded: 25, total: 100 },
        files
      )
    ).toBe(0.25);
    expect(
      loadedFromProgress(
        { status: "progress", file: "b.onnx", loaded: 50, total: 100 },
        files
      )
    ).toBe(0.375);
  });
});

describe("extractGeneratedText", () => {
  it("reads chat and string generated_text", () => {
    expect(
      extractGeneratedText([
        {
          generated_text: [
            { role: "user", content: "Hi" },
            { role: "assistant", content: "Hello" },
          ],
        },
      ])
    ).toBe("Hello");
    expect(extractGeneratedText([{ generated_text: "plain" }])).toBe("plain");
  });
});

describe("getTransformersAvailability", () => {
  it("returns unavailable when loadTransformers throws", async () => {
    await expect(
      getTransformersAvailability({
        loadTransformers: async () => {
          throw new Error("missing");
        },
      })
    ).resolves.toBe("unavailable");
  });

  it("returns downloadable when WASM works and the model is not cached", async () => {
    const transformers = mockTransformers({ isCached: false });
    const pipeline = transformers.pipeline as ReturnType<typeof vi.fn>;
    await expect(
      getTransformersAvailability({
        loadTransformers: async () => transformers,
      })
    ).resolves.toBe("downloadable");
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("returns available when ModelRegistry reports a cache hit", async () => {
    await expect(
      getTransformersAvailability({
        loadTransformers: async () => mockTransformers({ isCached: true }),
      })
    ).resolves.toBe("available");
  });

  it("returns downloadable when ModelRegistry is missing", async () => {
    await expect(
      getTransformersAvailability({
        loadTransformers: async () => mockTransformers({ omitRegistry: true }),
      })
    ).resolves.toBe("downloadable");
  });
});

describe("createTransformersBackend", () => {
  it("exposes transformers id and honest features", () => {
    const backend = createTransformersBackend({
      loadTransformers: async () => mockTransformers(),
    });
    expect(backend.id).toBe(TRANSFORMERS_BACKEND_ID);
    expect(backend.getFeatures?.()).toEqual({
      toolCalling: false,
      options: { temperature: true },
    });
  });

  it("probe does not call pipeline()", async () => {
    const transformers = mockTransformers({ isCached: false });
    const pipeline = transformers.pipeline as ReturnType<typeof vi.fn>;
    const backend = createTransformersBackend({
      loadTransformers: async () => transformers,
    });
    await expect(backend.probe()).resolves.toBe("downloadable");
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("create reports download progress and streams accepted / delta / done", async () => {
    const progress: number[] = [];
    const backend = createTransformersBackend({
      loadTransformers: async () => mockTransformers(),
    });
    const inference = await backend.create({
      onDownloadProgress(loaded) {
        progress.push(loaded);
      },
    });

    expect(progress).toEqual([0.4, 1, 1]);

    const chunks: unknown[] = [];
    for await (const chunk of inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "accepted" },
      { type: "delta", content: "Hello" },
      { type: "delta", content: " world" },
      {
        type: "done",
        model: "onnx-community/Qwen2.5-0.5B-Instruct",
        message: { role: "assistant", content: "Hello world" },
      },
    ]);
  });

  it("without TextStreamer, emits one delta from the pipeline result", async () => {
    const pipeline = vi.fn(async () =>
      makePipeline([], [{ generated_text: "one shot" }])
    ) as TransformersModule["pipeline"];
    const inference = await createTransformersBackend({
      loadTransformers: async () =>
        mockTransformers({ pipeline, omitStreamer: true }),
    }).create({});

    const chunks: unknown[] = [];
    for await (const chunk of inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: "delta", content: "one shot" });
    expect(chunks).toContainEqual({
      type: "done",
      model: "onnx-community/Qwen2.5-0.5B-Instruct",
      message: { role: "assistant", content: "one shot" },
    });
  });

  it("rejects tools on request", async () => {
    const inference = await createTransformersBackend({
      loadTransformers: async () => mockTransformers(),
    }).create({});
    const iter = inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
      tools: [{ type: "function", function: { name: "noop" } }],
    })[Symbol.asyncIterator]();

    await expect(iter.next()).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("rejects tool messages", async () => {
    const inference = await createTransformersBackend({
      loadTransformers: async () => mockTransformers(),
    }).create({});
    const iter = inference.request({
      method: "chat",
      messages: [
        { role: "user", content: "Hi" },
        { role: "tool", toolCallId: "1", content: "{}" },
      ],
    })[Symbol.asyncIterator]();

    await expect(iter.next()).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("forwards temperature to the pipeline", async () => {
    const generate = vi.fn(async () => [{ generated_text: "ok" }]);
    const pipeline = vi.fn(async () =>
      Object.assign(generate, { tokenizer: {} })
    ) as TransformersModule["pipeline"];

    const inference = await createTransformersBackend({
      loadTransformers: async () =>
        mockTransformers({ pipeline, omitStreamer: true }),
    }).create({});

    for await (const _ of inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
      options: { temperature: 0.2 },
    })) {
      // drain
    }

    expect(generate).toHaveBeenCalledWith(
      [{ role: "user", content: "Hi" }],
      expect.objectContaining({
        temperature: 0.2,
        do_sample: true,
      })
    );
  });

  it("maps AbortError on create to aborted", async () => {
    const pipeline = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as TransformersModule["pipeline"];

    await expect(
      createTransformersBackend({
        loadTransformers: async () => mockTransformers({ pipeline }),
      }).create({})
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("honors AbortSignal during create", async () => {
    const pipeline = vi.fn(
      () => new Promise(() => {})
    ) as TransformersModule["pipeline"];
    const controller = new AbortController();
    const pending = createTransformersBackend({
      loadTransformers: async () => mockTransformers({ pipeline }),
    }).create({ signal: controller.signal });

    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("does not assign window.inference", async () => {
    (globalThis as { window: { inference?: unknown } }).window = {};
    await createTransformersBackend({
      loadTransformers: async () => mockTransformers(),
    }).create({});
    expect(
      (globalThis as { window: { inference?: unknown } }).window.inference
    ).toBeUndefined();
    expect(isInferenceAvailable()).toBe(false);
  });
});

describe("createInference + transformers backend", () => {
  it("probes ipa and transformers keys", async () => {
    (globalThis as { window: { inference?: unknown } }).window = {};
    const inference = createInference({
      fallbacks: [
        createTransformersBackend({
          loadTransformers: async () => mockTransformers({ isCached: false }),
        }),
      ],
    });
    await expect(inference.probe()).resolves.toEqual({
      ipa: "unavailable",
      transformers: "downloadable",
    });
  });

  it("resolves Transformers.js when IPA is missing", async () => {
    (globalThis as { window: { inference?: unknown } }).window = {};
    const inference = createInference({
      fallbacks: [
        createTransformersBackend({
          loadTransformers: async () => mockTransformers(),
        }),
      ],
    });
    const { message } = await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(message.content).toBe("Hello world");
    expect(isInferenceAvailable()).toBe(false);
  });

  it("skips Transformers.js for tools (feature gate)", async () => {
    const pipeline = vi.fn(async () => {
      throw new Error("should not create");
    }) as TransformersModule["pipeline"];
    (globalThis as { window: { inference?: unknown } }).window = {};

    const inference = createInference({
      fallbacks: [
        createTransformersBackend({
          loadTransformers: async () => mockTransformers({ pipeline }),
        }),
      ],
    });

    try {
      await inference.runTools({
        messages: [{ role: "user", content: "weather?" }],
        tools: [
          {
            type: "function",
            function: { name: "get_weather" },
          },
        ],
        execute: {
          async get_weather() {
            return {};
          },
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(isInferenceError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("invalid_request");
    }
    expect(pipeline).not.toHaveBeenCalled();
  });
});
