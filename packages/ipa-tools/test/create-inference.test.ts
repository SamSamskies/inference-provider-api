import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createResolver,
  normalizeFallbacks,
  probeFallbacks,
  type InferenceBackend,
} from "../src/backends.js";
import { complete } from "../src/complete.js";
import { createInference } from "../src/create-inference.js";
import { isInferenceAvailable } from "../src/inference.js";
import { runTools } from "../src/run-tools.js";
import type { Inference, InferenceChunk, Message } from "../src/types.js";

function stubInference(inference: Inference) {
  (globalThis as { window: { inference: Inference } }).window = {
    inference,
  };
}

function fakeInference(options?: {
  id?: string;
  toolCalling?: boolean;
  message?: string;
}): Inference {
  const content = options?.message ?? `from:${options?.id ?? "ipa"}`;
  return {
    request: async function* (): AsyncIterable<InferenceChunk> {
      yield { type: "accepted" };
      yield {
        type: "done",
        model: options?.id ?? "test",
        message: { role: "assistant", content },
      };
    },
    getFeatures:
      options?.toolCalling === undefined
        ? undefined
        : () => ({ toolCalling: options.toolCalling }),
  };
}

function fakeBackend(options: {
  id: string;
  availability?: "unavailable" | "downloadable" | "downloading" | "available";
  toolCalling?: boolean;
  onCreate?: () => void;
}): InferenceBackend {
  const availability = options.availability ?? "available";
  return {
    id: options.id,
    async probe() {
      return availability;
    },
    getFeatures:
      options.toolCalling === undefined
        ? undefined
        : () => ({ toolCalling: options.toolCalling }),
    async create() {
      options.onCreate?.();
      return fakeInference({
        id: options.id,
        toolCalling: options.toolCalling,
        message: `from:${options.id}`,
      });
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { inference?: unknown }).inference;
});

describe("normalizeFallbacks", () => {
  it("rejects ipa string and unknown strings", () => {
    expect(() => normalizeFallbacks(["ipa"] as never)).toThrow(
      expect.objectContaining({
        code: "invalid_request",
        message: expect.stringContaining('"ipa" is not a fallback'),
      })
    );
    expect(() => normalizeFallbacks(["transformers"] as never)).toThrow(
      expect.objectContaining({
        code: "invalid_request",
        message: expect.stringContaining('Unknown fallback "transformers"'),
      })
    );
  });

  it("rejects more than one entry", () => {
    expect(() =>
      normalizeFallbacks([
        "promptApi",
        fakeBackend({ id: "custom" }),
      ])
    ).toThrow(
      expect.objectContaining({
        code: "invalid_request",
        message: expect.stringContaining("at most 1 entry"),
      })
    );
  });

  it("accepts promptApi and backend objects", () => {
    const backend = fakeBackend({ id: "custom" });
    expect(normalizeFallbacks(["promptApi"])).toEqual(["promptApi"]);
    expect(normalizeFallbacks([backend])).toEqual([backend]);
  });
});

describe("createInference / resolver", () => {
  it("uses IPA first when available and does not create fallbacks", async () => {
    stubInference(fakeInference({ id: "ipa", message: "from:ipa" }));
    let created = false;
    const inference = createInference({
      fallbacks: [
        fakeBackend({
          id: "nano",
          onCreate: () => {
            created = true;
          },
        }),
      ],
    });

    const done = await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(done.message).toEqual({ role: "assistant", content: "from:ipa" });
    expect(created).toBe(false);
  });

  it("uses the configured fallback when IPA is unavailable", async () => {
    const inference = createInference({
      fallbacks: [fakeBackend({ id: "b" })],
    });

    const done = await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(
      done.message.role === "assistant" ? done.message.content : null
    ).toBe("from:b");
  });

  it("caches the resolved fallback across calls", async () => {
    let creates = 0;
    const inference = createInference({
      fallbacks: [
        fakeBackend({
          id: "cached",
          onCreate: () => {
            creates += 1;
          },
        }),
      ],
    });

    await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "1" }],
    });
    await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "2" }],
    });

    expect(creates).toBe(1);
  });

  it("resolves lazily (no create until first use)", async () => {
    let creates = 0;
    createInference({
      fallbacks: [
        fakeBackend({
          id: "lazy",
          onCreate: () => {
            creates += 1;
          },
        }),
      ],
    });
    expect(creates).toBe(0);
  });

  it("throws when the fallback lacks toolCalling and tools are required", async () => {
    const inference = createInference({
      fallbacks: [fakeBackend({ id: "no-tools", toolCalling: false })],
    });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: { name: "ping" },
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
  });

  it("does not call create on a backend that advertises no toolCalling", async () => {
    let created = false;
    const inference = createInference({
      fallbacks: [
        fakeBackend({
          id: "no-tools",
          toolCalling: false,
          onCreate: () => {
            created = true;
          },
        }),
      ],
    });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "ping" } }],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });

    expect(created).toBe(false);
  });

  it("caches create() when tools support is only known after create", async () => {
    let creates = 0;
    const discoveredNoTools: InferenceBackend = {
      id: "discovered-no-tools",
      async probe() {
        return "available";
      },
      // No getFeatures — must create() to learn toolCalling is false.
      async create() {
        creates += 1;
        return fakeInference({
          id: "discovered-no-tools",
          toolCalling: false,
        });
      },
    };
    const inference = createInference({
      fallbacks: [discoveredNoTools],
    });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "ping" } }],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
    expect(creates).toBe(1);

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "ping" } }],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
    expect(creates).toBe(1);

    const done = await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(
      done.message.role === "assistant" ? done.message.content : null
    ).toBe("from:discovered-no-tools");
    expect(creates).toBe(1);
  });

  it("rejects a tools request after caching a no-tools fallback", async () => {
    let creates = 0;
    const inference = createInference({
      fallbacks: [
        fakeBackend({
          id: "no-tools",
          toolCalling: false,
          onCreate: () => {
            creates += 1;
          },
        }),
      ],
    });

    await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(creates).toBe(1);

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "ping" } }],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
    expect(creates).toBe(1);
  });

  it("does not recreate a cached no-tools promptApi peer on a tools request", async () => {
    let creates = 0;
    vi.doMock("ipa-prompt-api-fallback", () => ({
      backend: {
        id: "promptApi-impl",
        async probe() {
          return "available" as const;
        },
        getFeatures: () => ({ toolCalling: false }),
        async create() {
          creates += 1;
          return fakeInference({
            id: "promptApi-impl",
            toolCalling: false,
          });
        },
      } satisfies InferenceBackend,
    }));

    // Fresh module so createResolver picks up the mock via dynamic import.
    const { createInference: createInferenceFresh } = await import(
      "../src/create-inference.js"
    );

    const client = createInferenceFresh({
      fallbacks: ["promptApi"],
    });

    await client.complete({
      method: "chat",
      messages: [{ role: "user", content: "a" }],
    });
    expect(creates).toBe(1);

    await expect(
      client.complete({
        method: "chat",
        messages: [{ role: "user", content: "b" }],
        tools: [{ type: "function", function: { name: "ping" } }],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
    // Skip is keyed on the FallbackEntry ("promptApi"), not the loaded
    // backend.id ("promptApi-impl"), so the peer is not re-created.
    expect(creates).toBe(1);

    vi.doUnmock("ipa-prompt-api-fallback");
  });

  it("prefers IPA again if it appears after a fallback was cached", async () => {
    const inference = createInference({
      fallbacks: [fakeBackend({ id: "fallback" })],
    });

    await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "1" }],
    });

    stubInference(fakeInference({ id: "ipa", message: "from:ipa" }));

    const done = await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "2" }],
    });

    expect(done.message).toEqual({ role: "assistant", content: "from:ipa" });
  });

  it("does not mutate window.inference on the fallback path", async () => {
    const inference = createInference({
      fallbacks: [fakeBackend({ id: "nano" })],
    });

    await inference.complete({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    });

    expect((globalThis as { window?: { inference?: unknown } }).window).toBe(
      undefined
    );
    expect(isInferenceAvailable()).toBe(false);
  });

  it("probe reports ipa and fallback fields without creating", async () => {
    let creates = 0;
    const inference = createInference({
      fallbacks: [
        fakeBackend({
          id: "promptApi",
          availability: "downloadable",
          onCreate: () => {
            creates += 1;
          },
        }),
      ],
    });

    await expect(inference.probe()).resolves.toEqual({
      ipa: "unavailable",
      promptApi: "downloadable",
    });
    expect(creates).toBe(0);

    stubInference(fakeInference({ id: "ipa" }));
    await expect(inference.probe()).resolves.toEqual({
      ipa: "available",
      promptApi: "downloadable",
    });
  });

  it("throws unavailable when IPA and all fallbacks are unavailable", async () => {
    const inference = createInference({
      fallbacks: [fakeBackend({ id: "x", availability: "unavailable" })],
    });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toMatchObject({
      code: "unavailable",
      message: "No inference backend is available.",
    });
  });

  it("throws a tools-specific error when backends exist but lack toolCalling", async () => {
    const inference = createInference({
      fallbacks: [fakeBackend({ id: "promptApi", toolCalling: false })],
    });

    await expect(inference.probe()).resolves.toMatchObject({
      ipa: "unavailable",
      promptApi: "available",
    });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "ping" } }],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
  });

  it("surfaces create() errors from a tools-capable fallback", async () => {
    const failingTools: InferenceBackend = {
      id: "tools-capable",
      async probe() {
        return "available";
      },
      getFeatures: () => ({ toolCalling: true }),
      async create() {
        throw new Error("download failed");
      },
    };
    const inference = createInference({
      fallbacks: [failingTools],
    });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "ping" } }],
      })
    ).rejects.toThrow("download failed");
  });

  it("throws a clear missing-peer error for promptApi without the package", async () => {
    const inference = createInference({ fallbacks: ["promptApi"] });

    await expect(inference.probe()).resolves.toEqual({
      ipa: "unavailable",
      promptApi: "unavailable",
    });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("ipa-prompt-api-fallback"),
    });
  });

  it("surfaces real peer init failures instead of the missing-peer install prompt", async () => {
    vi.doMock("ipa-prompt-api-fallback", () => ({
      get backend() {
        throw new Error(
          "ipa-prompt-api-fallback failed to initialize: unexpected token"
        );
      },
    }));

    const { createInference: createInferenceFresh } = await import(
      "../src/create-inference.js"
    );
    const inference = createInferenceFresh({ fallbacks: ["promptApi"] });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow(
      "ipa-prompt-api-fallback failed to initialize: unexpected token"
    );

    vi.doUnmock("ipa-prompt-api-fallback");
  });

  it("surfaces the create() error when the fallback fails create", async () => {
    const failing: InferenceBackend = {
      id: "failing",
      async probe() {
        return "available";
      },
      async create() {
        throw new Error("download failed");
      },
    };
    const inference = createInference({ fallbacks: [failing] });

    await expect(
      inference.complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow("download failed");
  });

  it("streams via request() on a fallback backend", async () => {
    const inference = createInference({
      fallbacks: [fakeBackend({ id: "stream" })],
    });

    const chunks: InferenceChunk[] = [];
    for await (const chunk of inference.request({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.type)).toEqual(["accepted", "done"]);
  });

  it("keeps the same backend across runTools rounds after late IPA injection", async () => {
    let round = 0;
    const models: string[] = [];
    const backend: InferenceBackend = {
      id: "tools-fallback",
      async probe() {
        return "available";
      },
      getFeatures: () => ({ toolCalling: true }),
      async create(): Promise<Inference> {
        return {
          getFeatures: () => ({ toolCalling: true }),
          request: async function* () {
            round += 1;
            if (round === 1) {
              // IPA appears between rounds; the bound request must ignore it.
              stubInference(
                fakeInference({ id: "ipa", message: "from:ipa" })
              );
              const message: Message = {
                role: "assistant",
                content: null,
                toolCalls: [
                  {
                    id: "1",
                    type: "function",
                    function: { name: "noop", arguments: "{}" },
                  },
                ],
              };
              yield {
                type: "done" as const,
                model: "tools-fallback",
                message,
              };
              return;
            }
            models.push("tools-fallback");
            yield {
              type: "done" as const,
              model: "tools-fallback",
              message: { role: "assistant", content: "from:fallback" },
            };
          },
        };
      },
    };

    const client = createInference({ fallbacks: [backend] });
    const result = await client.runTools({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "noop" } }],
      execute: { noop: () => "ok" },
    });

    expect(isInferenceAvailable()).toBe(true);
    expect(models).toEqual(["tools-fallback"]);
    expect(result.final.message).toEqual({
      role: "assistant",
      content: "from:fallback",
    });
    expect(result.final.model).toBe("tools-fallback");
  });
});

describe("complete / runTools fallbacks option", () => {
  it("one-shot complete accepts fallbacks", async () => {
    const done = await complete(
      { method: "chat", messages: [{ role: "user", content: "hi" }] },
      { fallbacks: [fakeBackend({ id: "one-shot" })] }
    );
    expect(
      done.message.role === "assistant" ? done.message.content : null
    ).toBe("from:one-shot");
  });

  it("runTools validates options before creating a fallback backend", async () => {
    let created = false;
    await expect(
      runTools({
        messages: [{ role: "user", content: "hi" }],
        maxRounds: 0,
        fallbacks: [
          fakeBackend({
            id: "should-not-create",
            toolCalling: true,
            onCreate: () => {
              created = true;
            },
          }),
        ],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "maxRounds must be a positive number.",
    });
    expect(created).toBe(false);
  });

  it("runTools uses a tools-capable fallback", async () => {
    const result = await runTools({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "noop" } }],
      execute: {
        noop: () => "ok",
      },
      fallbacks: [
        {
          id: "tools",
          async probe() {
            return "available" as const;
          },
          async create(): Promise<Inference> {
            let round = 0;
            return {
              getFeatures: () => ({ toolCalling: true }),
              request: async function* () {
                round += 1;
                if (round === 1) {
                  const message: Message = {
                    role: "assistant",
                    content: null,
                    toolCalls: [
                      {
                        id: "1",
                        type: "function",
                        function: {
                          name: "noop",
                          arguments: "{}",
                        },
                      },
                    ],
                  };
                  yield {
                    type: "done" as const,
                    model: "tools",
                    message,
                  };
                  return;
                }
                yield {
                  type: "done" as const,
                  model: "tools",
                  message: { role: "assistant", content: "done" },
                };
              },
            };
          },
        },
      ],
    });

    expect(result.final.message).toEqual({
      role: "assistant",
      content: "done",
    });
  });

  it("runTools rejects a no-tools fallback", async () => {
    await expect(
      runTools({
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "noop" } }],
        execute: {
          noop: () => "ok",
        },
        fallbacks: [fakeBackend({ id: "no-tools", toolCalling: false })],
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
  });
});

describe("createResolver", () => {
  it("forwards onDownloadProgress to backend create", async () => {
    const progress = vi.fn();
    let seen: ((n: number) => void) | undefined;
    const backend: InferenceBackend = {
      id: "progress",
      async probe() {
        return "downloadable";
      },
      async create(createOptions) {
        seen = createOptions.onDownloadProgress;
        createOptions.onDownloadProgress?.(0.5);
        return fakeInference({ id: "progress" });
      },
    };

    const resolver = createResolver({
      fallbacks: [backend],
      onDownloadProgress: progress,
    });
    await resolver.resolve();

    expect(seen).toBe(progress);
    expect(progress).toHaveBeenCalledWith(0.5);
  });

  it("deduplicates concurrent resolve creates onto one backend session", async () => {
    let creates = 0;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const backend: InferenceBackend = {
      id: "slow",
      async probe() {
        return "available";
      },
      async create() {
        creates += 1;
        await createGate;
        return fakeInference({ id: "slow" });
      },
    };

    const resolver = createResolver({ fallbacks: [backend] });
    const first = resolver.resolve();
    const second = resolver.resolve();

    await vi.waitFor(() => {
      expect(creates).toBe(1);
    });
    releaseCreate();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(creates).toBe(1);
  });

  it("shares create() failure across concurrent resolve callers", async () => {
    let creates = 0;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const createError = Object.assign(new Error("download failed"), {
      code: "unavailable",
    });
    const backend: InferenceBackend = {
      id: "fail-create",
      async probe() {
        return "downloadable";
      },
      async create() {
        creates += 1;
        await createGate;
        throw createError;
      },
    };

    const resolver = createResolver({ fallbacks: [backend] });
    const first = resolver.resolve();
    const second = resolver.resolve();

    await vi.waitFor(() => {
      expect(creates).toBe(1);
    });
    releaseCreate();

    await expect(first).rejects.toBe(createError);
    await expect(second).rejects.toBe(createError);
    expect(creates).toBe(1);
  });

  it("does not retry forever when create() throws invalid_request", async () => {
    let creates = 0;
    const createError = Object.assign(new Error("bad create options"), {
      code: "invalid_request",
    });
    const backend: InferenceBackend = {
      id: "fail-invalid",
      async probe() {
        return "available";
      },
      async create() {
        creates += 1;
        throw createError;
      },
    };

    const resolver = createResolver({ fallbacks: [backend] });
    await expect(resolver.resolve()).rejects.toBe(createError);
    expect(creates).toBe(1);
  });

  it("does not share tools invalid_request with a concurrent plain resolve", async () => {
    let creates = 0;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    // No getFeatures — tools resolve must create() before learning toolCalling is false.
    const backend: InferenceBackend = {
      id: "no-tools",
      async probe() {
        return "available";
      },
      async create() {
        creates += 1;
        await createGate;
        return fakeInference({ id: "no-tools", toolCalling: false });
      },
    };

    const resolver = createResolver({ fallbacks: [backend] });
    const toolsResolve = resolver.resolve({ needsTools: true });
    const plainResolve = resolver.resolve();

    await vi.waitFor(() => {
      expect(creates).toBe(1);
    });
    releaseCreate();

    await expect(toolsResolve).rejects.toMatchObject({
      code: "invalid_request",
      message: "No configured backend supports tool calling.",
    });
    const plain = await plainResolve;
    expect(plain.getFeatures?.()).toEqual({ toolCalling: false });
    expect(creates).toBe(1);
  });

  it("prefers IPA injected during fallback create over the fallback", async () => {
    let creates = 0;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const backend: InferenceBackend = {
      id: "slow",
      async probe() {
        return "available";
      },
      async create() {
        creates += 1;
        await createGate;
        return fakeInference({ id: "slow" });
      },
    };

    const resolver = createResolver({ fallbacks: [backend] });
    const pending = resolver.resolve();

    await vi.waitFor(() => {
      expect(creates).toBe(1);
    });

    const ipa = fakeInference({ id: "ipa", message: "from:ipa" });
    stubInference(ipa);
    releaseCreate();

    await expect(pending).resolves.toBe(ipa);
  });

  it("throws aborted after create returns if the signal aborted during create", async () => {
    const controller = new AbortController();
    const backend: InferenceBackend = {
      id: "create-abort",
      async probe() {
        return "available";
      },
      async create() {
        controller.abort();
        return fakeInference({ id: "create-abort" });
      },
    };

    const resolver = createResolver({ fallbacks: [backend] });
    await expect(
      resolver.resolve({ signal: controller.signal })
    ).rejects.toMatchObject({
      code: "aborted",
      message: "Request aborted",
    });
  });

  it("prefers aborted over invalid_request when aborted during tools skip", async () => {
    const controller = new AbortController();
    const backend: InferenceBackend = {
      id: "no-tools",
      async probe() {
        return "available";
      },
      getFeatures: () => ({ toolCalling: false }),
      async create() {
        return fakeInference({ id: "no-tools", toolCalling: false });
      },
    };

    // Abort after probe so the tools gate continue can reach loop end.
    let probed = false;
    const probingBackend: InferenceBackend = {
      ...backend,
      async probe() {
        if (probed) return "available";
        probed = true;
        controller.abort();
        return "available";
      },
    };

    const resolver = createResolver({ fallbacks: [probingBackend] });
    await expect(
      resolver.resolve({ needsTools: true, signal: controller.signal })
    ).rejects.toMatchObject({
      code: "aborted",
      message: "Request aborted",
    });
  });
});

describe("probeFallbacks", () => {
  it("returns only ipa when fallbacks are omitted", async () => {
    await expect(probeFallbacks()).resolves.toEqual({ ipa: "unavailable" });
    stubInference(fakeInference({ id: "ipa" }));
    await expect(probeFallbacks()).resolves.toEqual({ ipa: "available" });
  });
});
