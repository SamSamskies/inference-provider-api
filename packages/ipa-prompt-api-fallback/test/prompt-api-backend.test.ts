import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInference,
  isInferenceAvailable,
  isInferenceError,
} from "ipa-tools";
import {
  createPromptApiBackend,
  getPromptApiAvailability,
} from "../src/index.js";
import { PROMPT_API_MODEL } from "../src/prompt-api-backend.js";
import type { LanguageModelSession } from "../src/language-model.js";

type MockLanguageModel = {
  availability: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

function setLanguageModel(mock: MockLanguageModel | undefined): void {
  (globalThis as { LanguageModel?: MockLanguageModel }).LanguageModel = mock;
}

function asyncStream(chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeSession(
  overrides: Partial<LanguageModelSession> & {
    promptStreaming: LanguageModelSession["promptStreaming"];
  }
): LanguageModelSession {
  return {
    prompt: vi.fn(async () => ""),
    destroy: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  setLanguageModel(undefined);
  delete (globalThis as { window?: { inference?: unknown } }).window;
  vi.restoreAllMocks();
});

describe("getPromptApiAvailability", () => {
  it("returns unavailable when LanguageModel is missing", async () => {
    setLanguageModel(undefined);
    await expect(getPromptApiAvailability()).resolves.toBe("unavailable");
  });

  it("forwards availability() and normalizes unknown values", async () => {
    const availability = vi
      .fn()
      .mockResolvedValueOnce("downloadable")
      .mockResolvedValueOnce("nope");
    setLanguageModel({ availability, create: vi.fn() });

    await expect(getPromptApiAvailability()).resolves.toBe("downloadable");
    await expect(getPromptApiAvailability()).resolves.toBe("unavailable");
    expect(availability).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      })
    );
  });

  it("does not call create()", async () => {
    const create = vi.fn();
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create,
    });
    await getPromptApiAvailability();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("createPromptApiBackend", () => {
  it("exposes promptApi id and toolCalling false", async () => {
    const backend = createPromptApiBackend();
    expect(backend.id).toBe("promptApi");
    expect(backend.getFeatures?.()).toEqual({ toolCalling: false });
  });

  it("probe mirrors getPromptApiAvailability", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("downloading"),
      create: vi.fn(),
    });
    const backend = createPromptApiBackend();
    await expect(backend.probe()).resolves.toBe("downloading");
  });

  it("create throws unavailable when LanguageModel is missing", async () => {
    setLanguageModel(undefined);
    const backend = createPromptApiBackend();
    await expect(backend.create({})).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("create wires monitor download progress and returns Inference", async () => {
    const destroy = vi.fn();
    const clone = vi.fn(async () =>
      makeSession({
        promptStreaming: () => asyncStream(["Hi", " there"]),
        destroy,
      })
    );
    const base = makeSession({
      promptStreaming: () => asyncStream([]),
      clone,
      destroy: vi.fn(),
    });

    const create = vi.fn(async (options: {
      monitor?: (m: {
        addEventListener: (
          type: string,
          listener: (e: { loaded: number }) => void
        ) => void;
      }) => void;
    }) => {
      options.monitor?.({
        addEventListener(_type, listener) {
          listener({ loaded: 0.4 });
          listener({ loaded: 1 });
        },
      });
      return base;
    });

    setLanguageModel({
      availability: vi.fn().mockResolvedValue("downloadable"),
      create,
    });

    const progress: number[] = [];
    const backend = createPromptApiBackend();
    const inference = await backend.create({
      onDownloadProgress(loaded) {
        progress.push(loaded);
      },
    });

    expect(progress).toEqual([0.4, 1]);
    expect(create).toHaveBeenCalled();

    const chunks: unknown[] = [];
    for await (const chunk of inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "accepted" },
      { type: "delta", content: "Hi" },
      { type: "delta", content: " there" },
      {
        type: "done",
        model: PROMPT_API_MODEL,
        message: { role: "assistant", content: "Hi there" },
      },
    ]);
    expect(clone).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect(base.destroy).not.toHaveBeenCalled();
  });

  it("normalizes cumulative stream chunks into deltas", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () =>
        makeSession({
          promptStreaming: () => asyncStream(["Hel", "Hello", "Hello!"]),
          destroy: vi.fn(),
        })
      ),
    });

    const inference = await createPromptApiBackend().create({});
    const deltas: string[] = [];
    for await (const chunk of inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      if (chunk.type === "delta") deltas.push(chunk.content);
    }
    expect(deltas).toEqual(["Hel", "lo", "!"]);
  });

  it("without clone, creates and destroys a one-shot session per request", async () => {
    const requestDestroys: ReturnType<typeof vi.fn>[] = [];
    const create = vi.fn(async () => {
      const destroy = vi.fn();
      const session = makeSession({
        promptStreaming: () => asyncStream(["ok"]),
        destroy,
      });
      // First create is the warm base (no clone); later creates are one-shots.
      if (create.mock.calls.length > 1) requestDestroys.push(destroy);
      return session;
    });
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create,
    });

    const inference = await createPromptApiBackend().create({});
    expect(create).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 2; i++) {
      for await (const _ of inference.request({
        method: "chat",
        messages: [{ role: "user", content: `Hi ${i}` }],
      })) {
        // drain
      }
    }

    expect(create).toHaveBeenCalledTimes(3);
    expect(requestDestroys).toHaveLength(2);
    for (const destroy of requestDestroys) {
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("when clone fails non-abort, falls back to one-shot create", async () => {
    const oneShotDestroy = vi.fn();
    const base = makeSession({
      promptStreaming: () => asyncStream([]),
      clone: vi.fn(async () => {
        throw new Error("clone unsupported");
      }),
      destroy: vi.fn(),
    });
    const create = vi
      .fn()
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        makeSession({
          promptStreaming: () => asyncStream(["fallback"]),
          destroy: oneShotDestroy,
        })
      );

    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create,
    });

    const inference = await createPromptApiBackend().create({});
    const chunks: unknown[] = [];
    for await (const chunk of inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(create).toHaveBeenCalledTimes(2);
    expect(oneShotDestroy).toHaveBeenCalled();
    expect(base.destroy).not.toHaveBeenCalled();
    expect(chunks).toContainEqual({
      type: "done",
      model: PROMPT_API_MODEL,
      message: { role: "assistant", content: "fallback" },
    });
  });

  it("rejects tools on request", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () =>
        makeSession({
          promptStreaming: () => asyncStream(["x"]),
          destroy: vi.fn(),
        })
      ),
    });
    const inference = await createPromptApiBackend().create({});
    const iter = inference.request({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          type: "function",
          function: { name: "noop" },
        },
      ],
    })[Symbol.asyncIterator]();

    await expect(iter.next()).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("maps AbortError to aborted", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    });
    await expect(createPromptApiBackend().create({})).rejects.toMatchObject({
      code: "aborted",
    });
  });

  it("does not assign window.inference", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () =>
        makeSession({
          promptStreaming: () => asyncStream(["ok"]),
          destroy: vi.fn(),
        })
      ),
    });

    (globalThis as { window: { inference?: unknown } }).window = {};
    await createPromptApiBackend().create({});
    expect(
      (globalThis as { window: { inference?: unknown } }).window.inference
    ).toBeUndefined();
    expect(isInferenceAvailable()).toBe(false);
  });
});

describe("createInference + promptApi backend", () => {
  it("probes ipa and promptApi keys", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: vi.fn(),
    });
    (globalThis as { window: { inference?: unknown } }).window = {};

    const inference = createInference({
      fallbacks: [createPromptApiBackend()],
    });
    await expect(inference.probe()).resolves.toEqual({
      ipa: "unavailable",
      promptApi: "downloadable",
    });
  });

  it("resolves Prompt API when IPA is missing", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () =>
        makeSession({
          promptStreaming: () => asyncStream(["hey"]),
          destroy: vi.fn(),
        })
      ),
    });
    (globalThis as { window: { inference?: unknown } }).window = {};

    const inference = createInference({
      fallbacks: [createPromptApiBackend()],
    });
    const { message } = await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(message.content).toBe("hey");
    expect(isInferenceAvailable()).toBe(false);
  });

  it("skips Prompt API for tools (feature gate)", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () => {
        throw new Error("should not create");
      }),
    });
    (globalThis as { window: { inference?: unknown } }).window = {};

    const inference = createInference({
      fallbacks: [createPromptApiBackend()],
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
  });
});
