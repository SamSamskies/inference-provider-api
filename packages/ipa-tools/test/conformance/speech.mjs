/** Browser-compatible assertions for test streams; not part of window.inference or ipa-tools. */
export async function assertSpeechStream(request, stream, { expectedAudio } = {}) {
  // Legacy method-string calls retain the MP3 default.
  const method = typeof request === "string" ? request : request?.method;
  const mediaType = typeof request === "string" || request?.output?.mediaType === undefined
    ? "audio/mpeg" : request.output.mediaType;
  if (method === "synthesize" && mediaType !== "audio/mpeg" && mediaType !== "audio/wav") {
    throw new Error("Expected a supported synthesis output type.");
  }
  const parts = [];
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
      check(chunk.mediaType === mediaType, "Audio delta media type must match the requested format.");
      check(chunk.data instanceof Uint8Array && chunk.data.byteLength > 0, "Audio delta must contain Uint8Array bytes.");
      if (expectedAudio) {
        for (let i = 0; i < chunk.data.length; i++) {
          check(chunk.data[i] === expectedAudio[byteLength + i], "Encoded bytes differ or are out of order.");
        }
      }
      if (mediaType === "audio/wav") parts.push(chunk.data.slice());
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
      check(chunk.audio?.mediaType === mediaType, "done audio media type must match the requested format.");
      check(Number.isSafeInteger(chunk.audio?.byteLength) && chunk.audio.byteLength === byteLength, "done byteLength must equal streamed bytes.");
      check(!("data" in chunk.audio), "done audio must not duplicate encoded bytes.");
      if (expectedAudio) check(byteLength === expectedAudio.byteLength, "Encoded byte count differs from fixture.");
      if (mediaType === "audio/wav") {
        const bytes = new Uint8Array(byteLength);
        let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
        assertWav(bytes);
      }
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

/** Container checks, not a substitute for decoding in a real browser. */
function assertWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE" ||
    view.getUint32(4, true) !== bytes.length - 8) {
    throw new Error("WAV must contain exactly one complete RIFF/WAVE file.");
  }
  let format = false;
  let audio = false;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("Truncated WAV chunk header.");
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size;
    if (end > bytes.length) throw new Error("Truncated WAV chunk data.");
    if (tag(offset) === "RIFF") throw new Error("Repeated RIFF header in WAV transport.");
    if (tag(offset) === "fmt ") {
      if (format || size < 16 || view.getUint16(offset + 10, true) === 0 ||
        view.getUint32(offset + 12, true) === 0 || view.getUint16(offset + 20, true) === 0) {
        throw new Error("Invalid WAV format information.");
      }
      format = true;
    }
    if (tag(offset) === "data") {
      if (!format || audio || size === 0) throw new Error("Invalid WAV audio data.");
      audio = true;
    }
    offset = end + (size % 2);
  }
  if (offset !== bytes.length || !format || !audio) throw new Error("Incomplete WAV file.");
}
