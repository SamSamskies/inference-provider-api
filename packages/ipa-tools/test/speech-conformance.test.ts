import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertSpeechStream } from "./conformance/speech.mjs";

const fixture = (file: string) => readFileSync(new URL(`./conformance/fixtures/${file}`, import.meta.url));
const mp3 = new Uint8Array(fixture("speech.mp3"));
const wav = new Uint8Array(fixture("speech.wav"));
const accepted = { type: "accepted" };
const transcript = { type: "done", model: "fixture", transcript: { text: "The sky is blue." }, usage: { inputSeconds: 1 } };
const audio = { type: "done", model: "fixture", audio: { mediaType: "audio/mpeg", byteLength: mp3.length } };
async function* stream(chunks: unknown[]) { yield* chunks; }

describe("shared speech stream conformance assertions", () => {
  it("accepts final-only and append-only transcription", async () => {
    expect((await assertSpeechStream("transcribe", stream([accepted, transcript]))).deltas).toBe(0);
    expect((await assertSpeechStream("transcribe", stream([
      accepted, { type: "delta", content: "The sky " }, { type: "delta", content: "is blue." }, transcript,
    ]))).deltas).toBe(2);
  });

  it.each([1, 257, mp3.length])("preserves exact MP3 bytes with upstream chunk size %i", async (size) => {
    const parts: Uint8Array[] = [];
    async function* upstream() {
      yield accepted;
      for (let offset = 0; offset < mp3.length; offset += size) {
        const data = mp3.slice(offset, offset + size);
        parts.push(data);
        yield { type: "audio_delta", mediaType: "audio/mpeg", data };
      }
      yield audio;
    }
    const report = await assertSpeechStream("synthesize", upstream(), { expectedAudio: mp3 });
    expect(report.byteLength).toBe(mp3.length);
    const blob = new Blob(parts, { type: "audio/mpeg" });
    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(mp3);
  });

  it.each([
    [transcript],
    [accepted],
    [accepted, accepted, transcript],
    [accepted, transcript, transcript],
    [accepted, transcript, { type: "delta", content: "late" }],
    [accepted, { type: "delta", content: "wrong" }, transcript],
    [accepted, { ...transcript, transcript: { text: " " } }],
    [accepted, { type: "reasoning_delta", content: "not transcription" }, transcript],
    [accepted, { ...transcript, usage: { inputSeconds: -1 } }],
  ])("rejects a malformed transcription stream %#", async (...chunks) => {
    await expect(assertSpeechStream("transcribe", stream(chunks))).rejects.toThrow();
  });

  const delta = { type: "audio_delta", mediaType: "audio/mpeg", data: mp3 };
  it.each([
    [accepted, audio],
    [accepted, { ...delta, mediaType: "audio/wav" }, audio],
    [accepted, { ...delta, data: "base64" }, audio],
    [accepted, { ...delta, data: new Uint8Array() }, audio],
    [accepted, delta, { ...audio, audio: { mediaType: "audio/mpeg", byteLength: mp3.length - 1 } }],
    [accepted, delta, { ...audio, audio: { ...audio.audio, data: mp3 } }],
    [accepted, delta, { ...audio, usage: { outputSeconds: Infinity } }],
  ])("rejects a malformed synthesis stream %#", async (...chunks) => {
    await expect(assertSpeechStream("synthesize", stream(chunks))).rejects.toThrow();
  });

  it("detects reordered encoded bytes even when total length matches", async () => {
    await expect(assertSpeechStream("synthesize", stream([
      accepted, { ...delta, data: mp3.slice().reverse() }, audio,
    ]), { expectedAudio: mp3 })).rejects.toThrow("bytes");
  });

  it("propagates an implementation error after accepted without accepting a successful done", async () => {
    const error = Object.assign(new Error("Transfer failed"), { code: "provider_error" });
    async function* failure() { yield accepted; throw error; }
    await expect(assertSpeechStream("synthesize", failure())).rejects.toBe(error);
  });

  it("verifies the checked-in audio/video and negative fixtures against their manifest", () => {
    const manifest = JSON.parse(fixture("manifest.json").toString());
    expect(manifest).toHaveLength(10);
    for (const entry of manifest) {
      const bytes = fixture(entry.file);
      expect(bytes.byteLength).toBe(entry.byteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
    expect(manifest.find((entry: { file: string }) => entry.file === "no-audio.mp4"))
      .toMatchObject({ hasVideo: true, audioCodecs: [] });
  });
});

const wavRequest = { method: "synthesize", text: "The sky is blue.", output: { mediaType: "audio/wav" } };
const wavDone = (bytes: Uint8Array) => ({ type: "done", model: "fixture", audio: { mediaType: "audio/wav", byteLength: bytes.length } });
const wavDelta = (data: Uint8Array) => ({ type: "audio_delta", mediaType: "audio/wav", data });

describe("WAV speech stream conformance", () => {
  it.each([1, 7, 257, wav.length])("preserves one WAV file with fragment size %i, including split headers", async (size) => {
    const parts: Uint8Array[] = [];
    async function* upstream() {
      yield accepted;
      for (let offset = 0; offset < wav.length; offset += size) {
        const part = wav.slice(offset, offset + size);
        parts.push(part);
        yield wavDelta(part);
      }
      yield wavDone(wav);
    }
    const result = await assertSpeechStream(wavRequest, upstream(), { expectedAudio: wav });
    expect(result.byteLength).toBe(wav.length);
    const blob = new Blob(parts, { type: result.done.audio.mediaType });
    expect(blob.type).toBe("audio/wav");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(wav);
  });

  it.each([
    [accepted, { ...wavDelta(wav), mediaType: "audio/mpeg" }, wavDone(wav)],
    [accepted, wavDelta(wav), audio],
    [accepted, wavDelta(wav), { ...wavDone(wav), audio: { mediaType: "audio/wav", byteLength: wav.length - 1 } }],
    [accepted, wavDelta(wav), { ...wavDone(wav), audio: { ...wavDone(wav).audio, data: wav } }],
  ])("rejects inconsistent WAV metadata %#", async (...chunks) => {
    await expect(assertSpeechStream(wavRequest, stream(chunks))).rejects.toThrow();
  });

  it.each([
    new Uint8Array([...wav, ...wav]), // Independent files instead of transport fragments.
    wav.slice(0, -1),
    wav.slice(44), // Headerless PCM must not be labeled WAV.
    mp3,
    new Uint8Array(44),
    (() => { const data = wav.slice(); new DataView(data.buffer).setUint32(16, data.length, true); return data; })(),
    (() => { const data = wav.slice(0, 36); new DataView(data.buffer).setUint32(4, data.length - 8, true); return data; })(),
  ])("rejects malformed, truncated, or repeated WAV containers %#", async (bytes) => {
    await expect(assertSpeechStream(wavRequest, stream([accepted, wavDelta(bytes), wavDone(bytes)])))
      .rejects.toThrow();
  });

  it("rejects a repeated RIFF header even if the outer length was rewritten", async () => {
    const bytes = new Uint8Array([...wav, ...wav]);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    await expect(assertSpeechStream(wavRequest, stream([accepted, wavDelta(bytes), wavDone(bytes)])))
      .rejects.toThrow("RIFF");
  });

  it("detects corrupted WAV samples even when container and byte count remain valid", async () => {
    const bytes = wav.slice(); bytes[bytes.length - 1] ^= 255;
    await expect(assertSpeechStream(wavRequest, stream([accepted, wavDelta(bytes), wavDone(bytes)]), { expectedAudio: wav }))
      .rejects.toThrow("bytes");
  });

  it.each([0, 1])("propagates cancellation after %i WAV fragments without accepting done", async (fragments) => {
    const controller = new AbortController();
    let closed = false;
    const seen: unknown[] = [];
    const error = Object.assign(new Error("Cancelled"), { code: "aborted" });
    async function* upstream() {
      try {
        yield accepted;
        if (fragments) yield wavDelta(wav.slice(0, 257));
        controller.abort();
        if (controller.signal.aborted) throw error;
        yield wavDone(wav);
      } finally { closed = true; }
    }
    async function* observed() { for await (const chunk of upstream()) { seen.push(chunk); yield chunk; } }
    await expect(assertSpeechStream(wavRequest, observed())).rejects.toBe(error);
    expect(closed).toBe(true);
    expect(seen).toHaveLength(1 + fragments);
  });
});
