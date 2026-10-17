import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertSpeechStream } from "./conformance/speech.mjs";

const fixture = (file: string) => readFileSync(new URL(`./conformance/fixtures/${file}`, import.meta.url));
const mp3 = new Uint8Array(fixture("speech.mp3"));
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
