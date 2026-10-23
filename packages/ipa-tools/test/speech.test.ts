import { afterEach, describe, expect, it, vi } from "vitest";
import { createInference } from "../src/create-inference.js";
import { complete } from "../src/complete.js";
import { makeInferenceError } from "../src/errors.js";
import type { DecideRequest, Inference, InferenceBackend, InferenceChunk, InferenceFeatures,
  InferenceRequest, SynthesizeRequest, TranscribeRequest } from "../src/types.js";

const transcription: TranscribeRequest = {
  method: "transcribe", media: { data: new Blob(["recording"], { type: "audio/wav" }) },
};
const synthesis: SynthesizeRequest = { method: "synthesize", text: "Hello" };
const decision: DecideRequest = {
  method: "decide", state: { ticket: "Checkout is broken" },
  questions: { is_bug: { type: "noul", instructions: "Is this a software defect?" } },
};
const chat = { method: "chat" as const, messages: [{ role: "user" as const, content: "Hello" }] };
const features: InferenceFeatures = { methods: {
  decide: true, transcribe: { acceptedMedia: [{ mediaType: "audio/wav" }] }, synthesize: true,
} };

async function collect(stream: AsyncIterable<unknown>) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function fakeInference(snapshot: InferenceFeatures = features, request = vi.fn()) {
  const inference: Inference = {
    getFeatures: () => snapshot,
    request: (<R extends InferenceRequest>(input: R) => {
      request(input);
      return (async function* (): AsyncIterable<InferenceChunk> {
        yield { type: "accepted" };
        if (input.method === "decide") {
          yield { type: "done", model: "test", answers: { is_bug: { type: "noul", noul: 0.95 } } };
        } else if (input.method === "transcribe") {
          yield { type: "done", model: "test", transcript: { text: "Hello" } };
        } else if (input.method === "synthesize") {
          const mediaType = input.output?.mediaType ?? "audio/mpeg";
          yield { type: "audio_delta", mediaType, data: new Uint8Array([1, 2, 3]) };
          yield { type: "done", model: "test", audio: { mediaType, byteLength: 3 } };
        } else {
          yield { type: "done", model: "test", message: { role: "assistant", content: "Hello" } };
        }
      })();
    }) as Inference["request"],
  };
  return inference;
}

function backend(snapshot?: InferenceFeatures, instance = fakeInference(snapshot)) {
  const create = vi.fn(async () => instance);
  const probe = vi.fn(async () => "available" as const);
  const route: InferenceBackend = {
    id: "test", create, probe,
    ...(snapshot ? { getFeatures: () => snapshot } : {}),
  };
  return { route, create, probe };
}

afterEach(() => vi.unstubAllGlobals());

describe("method-aware request routing", () => {
  it.each([transcription, synthesis, decision])("lazily routes $method to the advertised backend", async (request) => {
    const { route, create, probe } = backend(features);
    const stream = createInference({ fallbacks: [route] }).request(request);
    expect(create).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    const chunks = await collect(stream);
    expect(chunks[0]).toEqual({ type: "accepted" });
    expect(chunks.at(-1)).toHaveProperty("type", "done");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, {}, { methods: {} }, { methods: { synthesize: false } }])(
    "skips backends without advertised optional methods before create: %j", async (snapshot) => {
      const { route, create } = backend(snapshot);
      const client = createInference({ fallbacks: [route] });
      await expect(collect(client.request(synthesis))).rejects.toMatchObject({ code: "invalid_request" });
      await expect(collect(client.request(transcription))).rejects.toMatchObject({ code: "invalid_request" });
      await expect(collect(client.request(decision))).rejects.toMatchObject({ code: "invalid_request" });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([[], [{ mediaType: "audio/*" }], [{ mediaType: "video/mp4" }]])(
    "skips an empty, wildcard, or mismatched transcription surface: %j", async (acceptedMedia) => {
      const { route, create } = backend({ methods: { transcribe: { acceptedMedia } } });
      await expect(collect(createInference({ fallbacks: [route] }).request(transcription)))
        .rejects.toMatchObject({ code: "invalid_request" });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("matches normalized Blob MIME and raw-base64 MIME without reading bytes", async () => {
    const { route } = backend(features);
    const client = createInference({ fallbacks: [route] });
    const data = new Blob(["a"], { type: "audio/x-wav; codecs=pcm" });
    const read = vi.spyOn(data, "arrayBuffer");
    await collect(client.request({ method: "transcribe", media: { data } }));
    await collect(client.request({ method: "transcribe", media: { data: "YQ==", mediaType: "AUDIO/WAVE" } }));
    expect(read).not.toHaveBeenCalled();
  });

  it("passes URL sources to the page-side implementation without fetching during selection", async () => {
    const request = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { route } = backend(features, fakeInference(features, request));
    const input: TranscribeRequest = { method: "transcribe", media: { url: "https://media.example/a.wav" } };
    await collect(createInference({ fallbacks: [route] }).request(input));
    expect(request).toHaveBeenCalledWith(input);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([synthesis, decision])("keeps IPA first and rejects unadvertised $method without trying a fallback", async (input) => {
    const request = vi.fn();
    vi.stubGlobal("window", { inference: fakeInference({}, request) });
    const { route, create } = backend(features);
    await expect(collect(createInference({ fallbacks: [route] }).request(input)))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(create).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([synthesis, decision])("does not recreate a cached chat-only backend for $method", async (input) => {
    const { route, create } = backend({}, fakeInference({}));
    const client = createInference({ fallbacks: [route] });
    await client.complete(chat);
    await expect(collect(client.request(input))).rejects.toMatchObject({ code: "invalid_request" });
    await client.complete(chat);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([synthesis, decision])("rechecks $method on the created backend and avoids calling an incompatible request", async (input) => {
    const request = vi.fn();
    const { route } = backend(features, fakeInference({}, request));
    await expect(collect(createInference({ fallbacks: [route] }).request(input)))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([synthesis, decision])("does not let concurrent incompatible $method suppress a valid chat request", async (input) => {
    const { route, create } = backend({});
    const client = createInference({ fallbacks: [route] });
    const [optional, text] = await Promise.allSettled([
      collect(client.request(input)), client.complete(chat),
    ]);
    expect(optional.status).toBe("rejected");
    expect(text.status).toBe("fulfilled");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rechecks MIME needs when concurrent requests need different media types", async () => {
    const { route } = backend(features);
    const client = createInference({ fallbacks: [route] });
    const bad: TranscribeRequest = { method: "transcribe", media: { data: "YQ==", mediaType: "video/mp4" } };
    const [mp4, wav] = await Promise.allSettled([
      collect(client.request(bad)), collect(client.request(transcription)),
    ]);
    expect(mp4.status).toBe("rejected");
    expect(wav.status).toBe("fulfilled");
  });

  it.each((["permission_denied", "unavailable", "provider_error", "aborted"] as const)
    .flatMap((code) => [synthesis, decision].map((input) => ({ code, input }))))(
    "propagates $code for $input.method from the selected route without fallback", async ({ code, input }) => {
      const error = makeInferenceError(code, "route failed");
      vi.stubGlobal("window", { inference: {
        getFeatures: () => features,
        request: async function* () { throw error; },
      } });
      const { route, create } = backend(features);
      await expect(collect(createInference({ fallbacks: [route] }).request(input))).rejects.toBe(error);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([synthesis, decision])("aborts $method before resolution without creating a backend", async (input) => {
    const { route, create } = backend(features);
    const client = createInference({ fallbacks: [route] });
    await expect(collect(client.request({ ...input, signal: AbortSignal.abort() })))
      .rejects.toMatchObject({ code: "aborted" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([synthesis, decision])("propagates $method abort after accepted with no done and closes the delegate", async (input) => {
    const controller = new AbortController();
    const closed = vi.fn();
    vi.stubGlobal("window", { inference: {
      getFeatures: () => features,
      request: async function* (request: InferenceRequest) {
        try {
          yield { type: "accepted" };
          if (request.signal?.aborted) throw makeInferenceError("aborted", "Request aborted");
        } finally { closed(); }
      },
    } });
    const iterator = createInference().request({ ...input, signal: controller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ type: "accepted" });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "aborted" });
    expect(closed).toHaveBeenCalledOnce();
  });

  it("rejects unknown methods and non-chat passed to complete before provider work", async () => {
    const { route, create } = backend(features);
    const client = createInference({ fallbacks: [route] });
    await expect(collect(client.request({ method: "speak" } as never))).rejects.toMatchObject({ code: "invalid_request" });
    await expect(complete(synthesis as never)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(complete(decision as never)).rejects.toMatchObject({ code: "invalid_request" });
    expect(create).not.toHaveBeenCalled();
  });

  it("passes decision state/questions/signal unchanged to IPA with chat-only capability flags absent", async () => {
    const request = vi.fn();
    vi.stubGlobal("window", { inference: fakeInference({ methods: { decide: true } }, request) });
    const input = { ...decision, signal: new AbortController().signal };
    const chunks = await collect(createInference().request(input));
    expect(request).toHaveBeenCalledExactlyOnceWith(input);
    expect(chunks).toEqual([
      { type: "accepted" },
      { type: "done", model: "test", answers: { is_bug: { type: "noul", noul: 0.95 } } },
    ]);
  });

  it("treats false decide as unsupported even when other methods are advertised", async () => {
    const { route, create } = backend({ ...features, methods: { ...features.methods, decide: false } });
    await expect(collect(createInference({ fallbacks: [route] }).request(decision)))
      .rejects.toMatchObject({ code: "invalid_request", message: "No configured backend supports typed decisions." });
    expect(create).not.toHaveBeenCalled();
  });
});

const wav: SynthesizeRequest = { ...synthesis, output: { mediaType: "audio/wav" } };
const wavOnly: InferenceFeatures = { methods: { synthesize: { outputMediaTypes: ["audio/wav"] } } };
const both: InferenceFeatures = { methods: { synthesize: { outputMediaTypes: ["audio/mpeg", "audio/wav"] } } };

describe("format-aware synthesis routing", () => {
  it.each([features, both])("preserves omitted, empty, and explicit MP3 output with %j", async (snapshot) => {
    const request = vi.fn();
    const { route } = backend(snapshot, fakeInference(snapshot, request));
    const client = createInference({ fallbacks: [route] });
    for (const input of [synthesis, { ...synthesis, output: {} }, { ...synthesis, output: { mediaType: undefined } }, { ...synthesis, output: { mediaType: "audio/mpeg" as const } }]) {
      const chunks = await collect(client.request(input));
      expect(chunks.at(-1)).toHaveProperty("audio.mediaType", "audio/mpeg");
      expect(request).toHaveBeenLastCalledWith(input);
    }
  });

  it.each([wavOnly, both])("lazily forwards explicit WAV unchanged to %j", async (snapshot) => {
    const request = vi.fn();
    const { route, create, probe } = backend(snapshot, fakeInference(snapshot, request));
    const input = { ...wav, signal: new AbortController().signal };
    const stream = createInference({ fallbacks: [route] }).request(input);
    expect(create).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    const chunks = await collect(stream);
    expect(request).toHaveBeenCalledExactlyOnceWith(input);
    expect(chunks.at(-1)).toHaveProperty("audio.mediaType", "audio/wav");
  });

  it.each([features, { methods: { synthesize: { outputMediaTypes: [] } } },
    { methods: { synthesize: { outputMediaTypes: ["audio/*"] } } },
    { methods: { synthesize: { outputMediaTypes: ["audio/wav", "audio/l16"] } } }])(
    "skips unadvertised WAV and malformed format lists before create: %j", async (snapshot) => {
      const { route, create } = backend(snapshot as InferenceFeatures);
      await expect(collect(createInference({ fallbacks: [route] }).request(wav)))
        .rejects.toMatchObject({ code: "invalid_request" });
      expect(create).not.toHaveBeenCalled();
    });

  it.each([synthesis, { ...synthesis, output: {} }, { ...synthesis, output: { mediaType: "audio/mpeg" as const } }])(
    "does not change default MP3 to WAV on a WAV-only backend: %j", async (input) => {
      const { route, create } = backend(wavOnly);
      await expect(collect(createInference({ fallbacks: [route] }).request(input)))
        .rejects.toMatchObject({ code: "invalid_request" });
      expect(create).not.toHaveBeenCalled();
    });

  it.each(["audio/l16", "audio/wave", "AUDIO/WAV", "audio/wav; codecs=pcm", "", null, 42])(
    "rejects unknown output %j before backend initialization", async (mediaType) => {
      const { route, create, probe } = backend(both);
      await expect(collect(createInference({ fallbacks: [route] }).request({ ...synthesis, output: { mediaType } } as never)))
        .rejects.toMatchObject({ code: "invalid_request" });
      expect(probe).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

  it.each([null, "audio/wav", [], { format: "wav" }])(
    "rejects malformed output objects before backend creation: %j", async (output) => {
      const { route, create, probe } = backend(both);
      await expect(collect(createInference({ fallbacks: [route] }).request({ ...synthesis, output } as never)))
        .rejects.toMatchObject({ code: "invalid_request" });
      expect(create).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
    });

  it("checks the injector advertisement without trying a WAV-capable fallback", async () => {
    const request = vi.fn();
    vi.stubGlobal("window", { inference: fakeInference(features, request) });
    const { route, create } = backend(both);
    await expect(collect(createInference({ fallbacks: [route] }).request(wav)))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rechecks the created client and cached client formats before calling request", async () => {
    const request = vi.fn();
    const { route, create } = backend(both, fakeInference(features, request));
    const client = createInference({ fallbacks: [route] });
    await expect(collect(client.request(wav))).rejects.toMatchObject({ code: "invalid_request" });
    await expect(collect(client.request(wav))).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
    await collect(client.request(synthesis));
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([true, false])("separates concurrent WAV and MP3 needs (WAV first: %j)", async (wavFirst) => {
    const { route, create } = backend(wavOnly);
    const client = createInference({ fallbacks: [route] });
    const inputs = wavFirst ? [wav, synthesis] : [synthesis, wav];
    const results = await Promise.allSettled(inputs.map((input) => collect(client.request(input))));
    expect(results[wavFirst ? 0 : 1].status).toBe("fulfilled");
    expect(results[wavFirst ? 1 : 0].status).toBe("rejected");
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([wav, synthesis])("propagates unavailable on the chosen route without switching providers: %j", async (input) => {
    const error = makeInferenceError("unavailable", "The saved voice route cannot produce this format.");
    vi.stubGlobal("window", { inference: {
      getFeatures: () => both, request: async function* () { throw error; },
    } });
    const { route, create } = backend(both);
    await expect(collect(createInference({ fallbacks: [route] }).request(input))).rejects.toBe(error);
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves WAV backpressure and closes the delegate when iteration stops", async () => {
    let pulls = 0;
    const closed = vi.fn();
    vi.stubGlobal("window", { inference: {
      getFeatures: () => wavOnly,
      request: async function* () {
        try {
          yield { type: "accepted" };
          for (let index = 0; index < 4; index++) {
            pulls++;
            yield { type: "audio_delta", mediaType: "audio/wav", data: new Uint8Array([index]) };
          }
        } finally { closed(); }
      },
    } });
    const iterator = createInference().request(wav)[Symbol.asyncIterator]();
    expect(pulls).toBe(0);
    await iterator.next();
    expect(pulls).toBe(0);
    await iterator.next();
    expect(pulls).toBe(1);
    await iterator.return?.();
    expect(pulls).toBe(1);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("propagates WAV abort after accepted and closes without done", async () => {
    const controller = new AbortController();
    const closed = vi.fn();
    vi.stubGlobal("window", { inference: {
      getFeatures: () => wavOnly,
      request: async function* (input: SynthesizeRequest) {
        try {
          yield { type: "accepted" };
          if (input.signal?.aborted) throw makeInferenceError("aborted", "Cancelled");
          yield { type: "audio_delta", mediaType: "audio/wav", data: new Uint8Array([1]) };
        } finally { closed(); }
      },
    } });
    const iterator = createInference().request({ ...wav, signal: controller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ type: "accepted" });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "aborted" });
    expect(closed).toHaveBeenCalledOnce();
  });

  it("rejects pre-aborted WAV before backend creation", async () => {
    const { route, create, probe } = backend(wavOnly);
    await expect(collect(createInference({ fallbacks: [route] }).request({ ...wav, signal: AbortSignal.abort() })))
      .rejects.toMatchObject({ code: "aborted" });
    expect(create).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
});
