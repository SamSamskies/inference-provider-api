import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInference } from "../src/create-inference.js";
import { makeInferenceError } from "../src/errors.js";
import type { DecideRequest, Inference, InferenceBackend, InferenceFeatures, InferenceRequest } from "../src/index.js";
import { assertDecisionStream } from "./conformance/decisions.mjs";
import { assertDecisionFailure, assertDecisionMediaSnapshot, assertDecisionMediaCancellation,
  assertDecisionMediaValidation, invalidDecisionMediaRequests } from "./conformance/decision-media.mjs";
import { inspectImage } from "../../../examples/decisions/inspect-image.mjs";

const fixture = (file: string) => JSON.parse(readFileSync(new URL(`./conformance/${file}`, import.meta.url), "utf8"));
const imageRequest: DecideRequest = fixture("decisions-image-request.json");
const blue = fixture("decisions-image-blue.json");
const features: InferenceFeatures = { methods: { decide: true }, decisionMedia: { imageMediaTypes: ["image/png", "image/jpeg"] } };
const done = { type: "done", model: "mock", answers: { damaged: { type: "noul", noul: 0.1 } } };
const accepted = { type: "accepted" };
async function* stream(chunks: unknown[]) { yield* chunks; }
async function collect(value: AsyncIterable<unknown>) { const chunks = []; for await (const chunk of value) chunks.push(chunk); return chunks; }
function inference(snapshot: InferenceFeatures, request = vi.fn()) {
  return { getFeatures: () => snapshot, request: ((input: InferenceRequest) => {
    request(input);
    return stream([accepted, done]);
  }) as Inference["request"] };
}
function backend(snapshot: InferenceFeatures, instance = inference(snapshot)) {
  const create = vi.fn(async () => instance);
  const route: InferenceBackend = { id: "test", probe: async () => "available", getFeatures: () => snapshot, create };
  return { route, create };
}
afterEach(() => vi.unstubAllGlobals());

describe("decision image capability routing", () => {
  it.each([undefined, []])("preserves text-only compatibility with attachments %j", async (attachments) => {
    const snapshot = { methods: { decide: true } };
    const delegated = vi.fn();
    const { route } = backend(snapshot, inference(snapshot, delegated));
    const input = { ...imageRequest, attachments };
    await collect(createInference({ fallbacks: [route] }).request(input));
    expect(delegated).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("checks lazily on first iteration, forwards exact Blob/base64 input, and does not read or fetch", async () => {
    const delegated = vi.fn();
    const { route, create } = backend(features, inference(features, delegated));
    const client = createInference({ fallbacks: [route] });
    const bytes = Uint8Array.from(atob(imageRequest.attachments![0]!.data as string), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    const read = vi.spyOn(blob, "arrayBuffer");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const input: DecideRequest = { ...imageRequest, attachments: [] };
    const pending = client.request(input);
    expect(create).not.toHaveBeenCalled();
    input.attachments = [{ type: "image", mediaType: "image/png", data: blob }];
    expect(await assertDecisionStream(input, pending)).toEqual(done);
    expect(delegated).toHaveBeenLastCalledWith(input);
    expect(delegated.mock.calls[0]![0].attachments[0].data).toBe(blob);
    await collect(client.request(imageRequest));
    expect(delegated).toHaveBeenLastCalledWith(imageRequest);
    expect(read).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { methods: { decide: true }, imageInput: true },
    { methods: { decide: true }, decisionMedia: { imageMediaTypes: [] } },
    { methods: { decide: true }, decisionMedia: { imageMediaTypes: ["image/*"] } },
    { methods: { decide: true }, decisionMedia: { imageMediaTypes: ["image/png", "image/png"] } },
    { methods: { decide: true }, decisionMedia: { imageMediaTypes: ["image/jpeg"] } },
    { methods: { decide: false }, decisionMedia: { imageMediaTypes: ["image/png"] } },
  ])("skips missing, mismatched, or malformed image discovery before create: %j", async (snapshot) => {
    const { route, create } = backend(snapshot as InferenceFeatures);
    await expect(collect(createInference({ fallbacks: [route] }).request(imageRequest)))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(create).not.toHaveBeenCalled();
  });

  it("requires all attachment types, including on created and cached instances", async () => {
    const delegated = vi.fn();
    const textFeatures = { methods: { decide: true } };
    const { route, create } = backend(features, inference(textFeatures, delegated));
    const client = createInference({ fallbacks: [route] });
    for (let i = 0; i < 2; i++) {
      await expect(collect(client.request(imageRequest))).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(delegated).not.toHaveBeenCalled();
    await collect(client.request({ ...imageRequest, attachments: [] }));
    expect(create).toHaveBeenCalledOnce();
    const pngOnly = backend({ ...features, decisionMedia: { imageMediaTypes: ["image/png"] } });
    await expect(collect(createInference({ fallbacks: [pngOnly.route] }).request({ ...imageRequest,
      attachments: [...imageRequest.attachments!, { type: "image", mediaType: "image/jpeg", data: "YQ==" }],
    }))).rejects.toMatchObject({ code: "invalid_request" });
    expect(pngOnly.create).not.toHaveBeenCalled();
  });

  it.each([true, false])("separates concurrent media/text capabilities (media first %j)", async (mediaFirst) => {
    const { route, create } = backend({ methods: { decide: true } });
    const client = createInference({ fallbacks: [route] });
    const text = { ...imageRequest, attachments: [] };
    const inputs = mediaFirst ? [imageRequest, text] : [text, imageRequest];
    const results = await Promise.allSettled(inputs.map((input) => collect(client.request(input))));
    expect(results[mediaFirst ? 0 : 1].status).toBe("rejected");
    expect(results[mediaFirst ? 1 : 0].status).toBe("fulfilled");
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([null, {}, new Array(1), [{ ...imageRequest.attachments![0], url: "https://example.invalid/a.png" }],
    [{ type: "image", mediaType: "image/png", data: new Uint8Array(1) }]])(
    "rejects malformed attachment envelopes before creation: %j", async (attachments) => {
      const { route, create } = backend(features);
      await expect(collect(createInference({ fallbacks: [route] }).request({ ...imageRequest, attachments } as never)))
        .rejects.toMatchObject({ code: "invalid_request" });
      expect(create).not.toHaveBeenCalled();
    });

  it("keeps IPA first and rejects unadvertised image input without fallback", async () => {
    const delegated = vi.fn();
    vi.stubGlobal("window", { inference: inference({ methods: { decide: true }, imageInput: true }, delegated) });
    const { route, create } = backend(features);
    await expect(collect(createInference({ fallbacks: [route] }).request(imageRequest)))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(delegated).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "invalid_request", "permission_denied", "aborted"] as const)(
    "propagates selected route %s, including media limit errors, without fallback", async (code) => {
      const error = makeInferenceError(code, code === "invalid_request" ? "Attachment 0 exceeds 1024 decoded bytes." : "Selected route failed.");
      vi.stubGlobal("window", { inference: { getFeatures: () => features, request: async function* () { throw error; } } });
      const { route, create } = backend(features);
      await expect(collect(createInference({ fallbacks: [route] }).request(imageRequest))).rejects.toBe(error);
      expect(create).not.toHaveBeenCalled();
    });

  it("closes the media delegate on iterator return and honors pre-abort", async () => {
    const closed = vi.fn();
    vi.stubGlobal("window", { inference: { getFeatures: () => features, request: async function* () {
      try { yield accepted; yield done; } finally { closed(); }
    } } });
    const iterator = createInference().request(imageRequest)[Symbol.asyncIterator]();
    await iterator.next(); await iterator.return?.();
    expect(closed).toHaveBeenCalledOnce();
    await expect(collect(createInference().request({ ...imageRequest, signal: AbortSignal.abort() })))
      .rejects.toMatchObject({ code: "aborted" });
    expect(closed).toHaveBeenCalledOnce();
  });
});

describe("browser native image example", () => {
  it("forwards Blob and raw-base64 images and handles refusal without invented values", async () => {
    const delegated = vi.fn();
    vi.stubGlobal("window", { inference: inference(features, delegated) });
    const onAccepted = vi.fn();
    const signal = new AbortController().signal;
    expect(await inspectImage(imageRequest.attachments![0], { signal, onAccepted })).toEqual(done);
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(delegated.mock.calls[0]![0]).toMatchObject({ method: "decide", attachments: imageRequest.attachments, signal });
    const blob = new Blob(["fixture"], { type: "image/png" });
    await inspectImage({ mediaType: "image/png", data: blob });
    expect(delegated.mock.calls[1]![0].attachments[0].data).toBe(blob);
    vi.stubGlobal("window", { inference: { getFeatures: () => features, request: () => stream([accepted,
      { ...done, answers: { damaged: { type: "refusal" } } }]) } });
    expect((await inspectImage(imageRequest.attachments![0])).answers.damaged).toEqual({ type: "refusal" });
  });

  it("feature-detects separately from chat images and preserves unavailable selected routes", async () => {
    const delegated = vi.fn();
    vi.stubGlobal("window", { inference: inference({ methods: { decide: true }, imageInput: true }, delegated) });
    await expect(inspectImage(imageRequest.attachments![0])).rejects.toMatchObject({ code: "invalid_request" });
    expect(delegated).not.toHaveBeenCalled();
    const error = makeInferenceError("unavailable", "Saved route cannot see images.");
    vi.stubGlobal("window", { inference: { getFeatures: () => features, request: async function* () { throw error; } } });
    await expect(inspectImage(imageRequest.attachments![0])).rejects.toBe(error);
  });
});

// These tests exercise the reusable assertions against controlled subjects. They
// do not claim that a browser injector implements consent/snapshotting/decoding.
describe("decision media conformance support", () => {
  it("runs malformed and implementation-specific oversized inputs and rejects any silently accepted case", async () => {
    // This controlled subject only classifies known test vectors, not real bytes.
    const oversized = { ...structuredClone(imageRequest), attachments: Array.from({ length: 3 }, () => imageRequest.attachments![0]) };
    const requests: unknown[] = [];
    const subject = { request: (input: unknown) => {
      requests.push(input);
      return input === imageRequest ? stream([accepted, done]) : (async function* () {
        throw makeInferenceError("invalid_request", "Attachment count/format violates test implementation limits.");
      })();
    } };
    expect(await assertDecisionMediaValidation({ inference: subject, valid: imageRequest, oversized: [oversized] })).toEqual(done);
    expect(requests).toContain(oversized);
    expect(requests.length).toBe(invalidDecisionMediaRequests(imageRequest).length + 2);
    await expect(assertDecisionMediaValidation({ inference: inference(features), valid: imageRequest, oversized: [oversized] }))
      .rejects.toThrow("must not yield accepted");
  });

  it("offers malformed format, source, encoding, and byte vectors without altering the valid fixture", () => {
    const original = structuredClone(imageRequest);
    const vectors = invalidDecisionMediaRequests(imageRequest);
    expect(vectors.length).toBeGreaterThan(20);
    expect(vectors.some((r: any) => r.attachments?.[0]?.data === "YR==")).toBe(true);
    expect(imageRequest).toEqual(original);
  });

  it.each(["invalid_request", "unavailable", "aborted"])("checks a %s failure and refuses done or silent exhaustion", async (code) => {
    const error = Object.assign(new Error("Attachment 0 exceeds the known size limit."), { code });
    async function* failure() { throw error; }
    expect(await assertDecisionFailure(failure(), code, { preflight: true })).toBe(error);
    await expect(assertDecisionFailure(stream([]), code)).rejects.toThrow("successful exhaustion");
    await expect(assertDecisionFailure(stream([accepted, done]), code)).rejects.toThrow("no done");
    async function* late() { yield accepted; throw error; }
    await expect(assertDecisionFailure(late(), code, { preflight: true })).rejects.toThrow("must not yield accepted");
    expect(await assertDecisionFailure(late(), code)).toBe(error);
  });

  it.each([false, true])("detects input mutation across pending approval (broken snapshot %j)", async (broken) => {
    const request = structuredClone(imageRequest);
    request.attachments![0]!.data = new Blob([Uint8Array.from(atob(request.attachments![0]!.data as string), (c) => c.charCodeAt(0))]);
    let announce!: () => void; let allow!: () => void;
    const approval = new Promise<void>((resolve) => { announce = resolve; });
    const gate = new Promise<void>((resolve) => { allow = resolve; });
    let forwarded: DecideRequest | undefined;
    const subject = { request: async function* (input: DecideRequest) {
      const snapshot = broken ? input : structuredClone(input);
      announce(); await gate; forwarded = snapshot;
      yield accepted; yield done;
    } };
    const result = assertDecisionMediaSnapshot({ inference: subject, request,
      waitForApproval: () => approval, approve: allow, readForwarded: () => forwarded,
      mutate: (input: DecideRequest) => { input.state = "changed"; input.questions.damaged!.instructions = "changed";
        input.attachments![0]!.data = blue.data; input.attachments!.push(blue); },
    });
    if (broken) await expect(result).rejects.toThrow("differs from approved snapshot");
    else expect(await result).toEqual(done);
  });

  it.each([false, true])("checks cancellation during approval/provider work and cleanup (accepted %j)", async (afterAccepted) => {
    let announce!: () => void;
    const stage = new Promise<void>((resolve) => { announce = resolve; });
    let cleaned = false;
    const subject = { request: async function* (input: DecideRequest) {
      try {
        if (afterAccepted) yield accepted;
        announce();
        await new Promise<void>((resolve) => input.signal!.addEventListener("abort", () => resolve(), { once: true }));
        throw makeInferenceError("aborted", "Cancelled");
      } finally { cleaned = true; }
    } };
    await assertDecisionMediaCancellation({ inference: subject, request: imageRequest,
      waitForStage: () => stage, assertCleanup: () => expect(cleaned).toBe(true) });
  });
});
