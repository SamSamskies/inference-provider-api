/** Browser-compatible assertions for test streams; not part of window.inference or ipa-tools. */
export async function assertSpeechStream(method, stream, { expectedAudio } = {}) {
  if (method !== "transcribe" && method !== "synthesize") throw new Error("Expected a speech method.");
  let accepted = false;
  let done;
  let text = "";
  let deltas = 0;
  let byteLength = 0;
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  for await (const chunk of stream) {
    check(chunk && typeof chunk === "object", "Chunk must be an object.");
    check(!done, "No chunks may follow done.");
    if (chunk.type === "accepted") {
      check(!accepted, "Expected exactly one accepted.");
      accepted = true;
      continue;
    }
    check(accepted, "accepted must precede method chunks.");
    if (method === "transcribe" && chunk.type === "delta") {
      check(typeof chunk.content === "string", "Transcript delta must be text.");
      text += chunk.content;
      deltas += 1;
      continue;
    }
    if (method === "synthesize" && chunk.type === "audio_delta") {
      check(chunk.mediaType === "audio/mpeg", "Synthesis must return audio/mpeg.");
      check(chunk.data instanceof Uint8Array && chunk.data.byteLength > 0, "Audio delta must contain Uint8Array bytes.");
      if (expectedAudio) {
        for (let i = 0; i < chunk.data.length; i++) {
          check(chunk.data[i] === expectedAudio[byteLength + i], "Encoded bytes differ or are out of order.");
        }
      }
      byteLength += chunk.data.byteLength;
      deltas += 1;
      continue;
    }
    check(chunk.type === "done", "Unexpected chunk for this method.");
    check(typeof chunk.model === "string" && chunk.model.length > 0, "done must identify a model.");
    check(!("message" in chunk), "Speech done must not contain a chat message.");
    if (method === "transcribe") {
      check(!("audio" in chunk), "Transcript done must not contain synthesis audio.");
      check(typeof chunk.transcript?.text === "string" && chunk.transcript.text.trim().length > 0, "Expected non-empty transcript text.");
      check(deltas === 0 || text === chunk.transcript.text, "Transcript deltas must equal final text.");
    } else {
      check(!("transcript" in chunk), "Synthesis done must not contain a transcript.");
      check(deltas > 0, "Synthesis must emit at least one audio_delta.");
      check(chunk.audio?.mediaType === "audio/mpeg", "done audio must be audio/mpeg.");
      check(Number.isSafeInteger(chunk.audio?.byteLength) && chunk.audio.byteLength === byteLength, "done byteLength must equal streamed bytes.");
      check(!("data" in chunk.audio), "done audio must not duplicate encoded bytes.");
      if (expectedAudio) check(byteLength === expectedAudio.byteLength, "Encoded byte count differs from fixture.");
    }
    if (chunk.usage !== undefined) {
      check(chunk.usage && typeof chunk.usage === "object", "Usage must be an object.");
      for (const key of method === "transcribe" ? ["inputSeconds"] : ["inputCharacters", "outputSeconds"]) {
        const value = chunk.usage[key];
        if (value !== undefined) check(typeof value === "number" && Number.isFinite(value) && value >= 0, "Usage must be finite and nonnegative.");
      }
    }
    done = chunk;
  }
  check(accepted && done, "Successful stream must include accepted and done.");
  return { method, deltas, byteLength, done };
}
