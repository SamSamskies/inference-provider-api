# Bounded speech in a browser

These snippets use the normative `window.inference.request` methods from
[SPEC.md](../../SPEC.md#bounded-speech). Run them in a top-level HTTPS or
loopback HTTP page with an injector advertising speech. Inference Bridge
[v0.17.0+](https://github.com/SamSamskies/inference-bridge/releases/tag/v0.17.0)
exposes them on stable `request`/`getFeatures`; detect method support before use.

The user chooses provider/model/voice during approval. Existing chat grants do
not authorize speech. Files can include sensitive bystander/background speech;
a video container may be uploaded in full even though only audio is transcribed.
IPA never captures the microphone or starts playback for the page.

## Upload a completed recording

Paste this into DevTools, then select a file in the added input:

```js
const ipa = window.inference;
const accepted = ipa?.getFeatures?.().methods?.transcribe?.acceptedMedia;
if (!accepted?.length) throw new Error("Stable transcription is not advertised.");

const picker = document.createElement("input");
picker.type = "file";
picker.accept = accepted.map(({ mediaType }) => mediaType).join(",");
document.body.append(picker);
const file = await new Promise((resolve) => {
  picker.addEventListener("change", () => resolve(picker.files[0]), { once: true });
  picker.addEventListener("cancel", () => resolve(null), { once: true });
});
picker.remove();
if (!file) throw new Error("No recording selected.");

for await (const chunk of ipa.request({ method: "transcribe", media: { data: file } })) {
  console.log(chunk);
  if (chunk.type === "delta") console.log("Append:", chunk.content);
  if (chunk.type === "done") console.log("Transcript:", chunk.transcript.text);
}
```

A missing `Blob.type` can be filled with an explicit advertised `mediaType`.
Do not guess from an arbitrary file extension or override a conflicting detected
type. File picker filters describe MIME types; implementation validation also
checks applicable container/codec constraints. Final-only providers emit
`accepted`, then `done`, with no text deltas.

## Record first, then transcribe

This adds a button. Clicking it obtains the page's browser microphone permission,
records five seconds, stops all microphone tracks, then requests IPA approval
for the completed file. It never sends a live microphone stream to IPA.

```js
const recordButton = document.createElement("button");
recordButton.textContent = "Record five seconds and transcribe";
document.body.append(recordButton);
recordButton.onclick = async () => {
  recordButton.disabled = true;
  let microphone;
  let recorder;
  let recording;
  try {
    const ipa = window.inference;
    const accepted = ipa?.getFeatures?.().methods?.transcribe?.acceptedMedia ?? [];
    const mimeType = ["audio/webm", "audio/mp4"].find((type) =>
      accepted.some((entry) => entry.mediaType === type) && MediaRecorder.isTypeSupported(type)
    );
    if (!mimeType) throw new Error("No advertised recording format is available.");
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(microphone, { mimeType });
      const parts = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) parts.push(data); };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = () => reject(new Error("Recording failed."));
      });
      recorder.start();
      const timer = setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, 5_000);
      try { await stopped; } finally { clearTimeout(timer); }
      recording = new Blob(parts, { type: recorder.mimeType });
    } finally {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      microphone?.getTracks().forEach((track) => track.stop());
    }
    for await (const chunk of ipa.request({ method: "transcribe", media: { data: recording } })) {
      if (chunk.type === "done") console.log(chunk.transcript.text);
    }
  } catch (error) {
    console.log(error.code ?? error.name, error.message);
  } finally {
    recordButton.disabled = false;
  }
};
```

## Text to an MP3 Blob

```js
const ipa = window.inference;
if (!ipa?.getFeatures?.().methods?.synthesize) throw new Error("Stable synthesis is not advertised.");
const parts = [];
let expectedBytes;
for await (const chunk of ipa.request({ method: "synthesize", text: "The sky is blue." })) {
  console.log(chunk);
  if (chunk.type === "audio_delta") parts.push(chunk.data);
  if (chunk.type === "done") expectedBytes = chunk.audio.byteLength;
}
const blob = new Blob(parts, { type: "audio/mpeg" });
if (!blob.size || blob.size !== expectedBytes) throw new Error("Incomplete MP3 stream.");
console.log(blob.type, blob.size);
const url = URL.createObjectURL(blob);
const audio = document.createElement("audio");
audio.controls = true;
audio.src = url;
document.body.append(audio); // Click Play explicitly; no autoplay.
const removeButton = document.createElement("button");
removeButton.textContent = "Remove audio";
removeButton.onclick = () => {
  audio.pause();
  audio.remove();
  URL.revokeObjectURL(url);
  removeButton.remove();
};
document.body.append(removeButton);
```

Do not use `complete()` for speech. It stays chat-only; `done.audio` contains
metadata without duplicating audio bytes. No public `synthesize()` or audio
collector is needed.

## URL input, raw base64, and cancellation

URLs are resolved by the page under its normal CORS rules, once iteration starts.
They may be fetched before approval; provider upload waits for approval. Use an
actual same-origin or CORS-readable URL for an advertised media type:

```js
const ipa = window.inference;
if (!ipa?.getFeatures?.().methods?.transcribe) throw new Error("Stable transcription is not advertised.");
for await (const chunk of ipa.request({
  method: "transcribe",
  media: { url: "/conformance/fixtures/speech.wav" },
  language: "en",
})) {
  if (chunk.type === "done") console.log(chunk.transcript.text);
}
```

For raw base64 use `media: { data: rawBase64String, mediaType: "audio/wav" }`;
a data URL is not raw base64. Do not specify both `url` and `data`.

```js
const controller = new AbortController();
const ipa = window.inference;
if (!ipa?.getFeatures?.().methods?.synthesize) throw new Error("Stable synthesis is not advertised.");
const stream = ipa.request({ method: "synthesize", text: "Cancel this request.", signal: controller.signal });
controller.abort(); // Before iteration: no approval or provider work.
try {
  for await (const chunk of stream) console.log(chunk);
} catch (error) {
  console.log(error.code); // "aborted"
}
```

To check cancellation after approval, omit the early `abort()` and call it when
the stream yields `accepted`. Expect `aborted` and no `done`. Production UI can
wire the same controller to a Cancel button and handle `permission_denied`,
`invalid_request`, `unavailable`, and `provider_error` distinctly.
