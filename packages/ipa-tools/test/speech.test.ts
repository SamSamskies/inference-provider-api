import { afterEach, describe, expect, it, vi } from "vitest";
import { createInference } from "../src/create-inference.js";
import { complete } from "../src/complete.js";
import { makeInferenceError } from "../src/errors.js";
import type { Inference, InferenceBackend, InferenceChunk, InferenceFeatures,
  InferenceRequest, SynthesizeRequest, TranscribeRequest } from "../src/types.js";

const transcription: TranscribeRequest = {
  method: "transcribe", media: { data: new Blob(["recording"], { type: "audio/wav" }) },
};
const synthesis: SynthesizeRequest = { method: "synthesize", text: "Hello" };
const chat = { method: "chat" as const, messages: [{ role: "user" as const, content: "Hello" }] };
const features: InferenceFeatures = { methods: {
  transcribe: { acceptedMedia: [{ mediaType: "audio/wav" }] }, synthesize: true,
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
        if (input.method === "transcribe") {
          yield { type: "done", model: "test", transcript: { text: "Hello" } };
        } else if (input.method === "synthesize") {
          yield { type: "audio_delta", mediaType: "audio/mpeg", data: new Uint8Array([1, 2, 3]) };
          yield { type: "done", model: "test", audio: { mediaType: "audio/mpeg", byteLength: 3 } };
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
  it.each([transcription, synthesis])("lazily routes $method to the advertised backend", async (request) => {
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
    "skips backends without advertised speech before create: %j", async (snapshot) => {
      const { route, create } = backend(snapshot);
      const client = createInference({ fallbacks: [route] });
      await expect(collect(client.request(synthesis))).rejects.toMatchObject({ code: "invalid_request" });
      await expect(collect(client.request(transcription))).rejects.toMatchObject({ code: "invalid_request" });
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

  it("keeps IPA first and rejects an unadvertised method without trying a fallback", async () => {
    const request = vi.fn();
    vi.stubGlobal("window", { inference: fakeInference({}, request) });
    const { route, create } = backend(features);
    await expect(collect(createInference({ fallbacks: [route] }).request(synthesis)))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(create).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not recreate a cached chat-only backend for speech", async () => {
    const { route, create } = backend({}, fakeInference({}));
    const client = createInference({ fallbacks: [route] });
    await client.complete(chat);
    await expect(collect(client.request(synthesis))).rejects.toMatchObject({ code: "invalid_request" });
    await client.complete(chat);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rechecks features on the created backend and avoids calling an incompatible request", async () => {
    const request = vi.fn();
    const { route } = backend(features, fakeInference({}, request));
    await expect(collect(createInference({ fallbacks: [route] }).request(synthesis)))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not let concurrent incompatible speech suppress a valid chat request", async () => {
    const { route, create } = backend({});
    const client = createInference({ fallbacks: [route] });
    const [speech, text] = await Promise.allSettled([
      collect(client.request(synthesis)), client.complete(chat),
    ]);
    expect(speech.status).toBe("rejected");
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

  it.each(["permission_denied", "unavailable", "provider_error", "aborted"] as const)(
    "propagates %s from the selected route without fallback", async (code) => {
      const error = makeInferenceError(code, "route failed");
      vi.stubGlobal("window", { inference: {
        getFeatures: () => features,
        request: async function* () { throw error; },
      } });
      const { route, create } = backend(features);
      await expect(collect(createInference({ fallbacks: [route] }).request(synthesis))).rejects.toBe(error);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("aborts before resolution without creating a backend", async () => {
    const { route, create } = backend(features);
    const client = createInference({ fallbacks: [route] });
    await expect(collect(client.request({ ...synthesis, signal: AbortSignal.abort() })))
      .rejects.toMatchObject({ code: "aborted" });
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates abort after accepted with no done and closes the delegate", async () => {
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
    const iterator = createInference().request({ ...synthesis, signal: controller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ type: "accepted" });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "aborted" });
    expect(closed).toHaveBeenCalledOnce();
  });

  it("rejects unknown methods and speech passed to complete before provider work", async () => {
    const { route, create } = backend(features);
    const client = createInference({ fallbacks: [route] });
    await expect(collect(client.request({ method: "speak" } as never))).rejects.toMatchObject({ code: "invalid_request" });
    await expect(complete(synthesis as never)).rejects.toMatchObject({ code: "invalid_request" });
    expect(create).not.toHaveBeenCalled();
  });
});
