# IPA Speech Demo

A single-page app for bounded transcription and MP3/WAV speech synthesis using `window.inference.request`. Transcription and synthesis are feature-detected independently: if only one is advertised, the other stays disabled.

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/speech/](https://samsamskies.github.io/inference-provider-api/speech/)

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation) ([Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge)) with speech support (v0.17.0+), or another injector advertising speech methods.
2. Open the live demo, or serve the examples locally from the repository root over HTTPS or `localhost` (not `file:`):

   ```bash
   npx serve examples
   ```

   Then open the printed URL followed by `/speech/`.
3. **Transcribe:** Choose an advertised audio/video file and click **Transcribe**. If the browser reports no MIME type, select the file's actual advertised type (the injector still validates container and codec).
4. **Text to speech:** Enter text, choose an advertised audio format (MP3 or WAV), click **Generate speech**, approve in your extension, and press **Play** (audio never autoplays).

### Behavior

- Shows **Waiting for approval…**, then **Transcribing…** or **Generating audio…** after `accepted`. Both streaming and final-only transcription providers are supported.
- **Cancel** aborts via `AbortSignal`. Generated audio is exposed only after `done.audio.byteLength` matches the received bytes and every MIME type matches the requested format; clearing, replacing, or leaving the page revokes object URLs.
- Provider, model, and voice selection stay in the extension. Reported usage (audio seconds / input characters) is displayed when provided.

## Developer snippets

These snippets use the normative `window.inference.request` speech methods from [SPEC.md](../../SPEC.md#bounded-speech) and can be run in DevTools on any HTTPS or `localhost` page with a speech-capable injector.

Existing chat grants do not authorize speech. Remember that audio/video files may contain sensitive background speech, and video containers may be uploaded in full even though only audio is transcribed.

### Upload a completed recording

Paste into DevTools, then pick a file in the added input:

```js
const ipa = window.inference;
const accepted = ipa?.getFeatures?.().methods?.transcribe?.acceptedMedia;
if (!accepted?.length) throw new Error("Transcription is not advertised.");

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

If `file.type` is empty, pass an explicit advertised `mediaType` alongside `data` (do not guess from a filename extension). Final-only providers emit `accepted` then `done` with no `delta` chunks.

### Text to an MP3 or WAV Blob

```js
const ipa = window.inference;
const synthesis = ipa?.getFeatures?.().methods?.synthesize;
const formats = synthesis === true ? ["audio/mpeg"] : synthesis?.outputMediaTypes ?? [];
// Request WAV explicitly when advertised; omitted output always means MP3.
const mediaType = formats.includes("audio/wav") ? "audio/wav" : "audio/mpeg";
if (!formats.includes(mediaType)) throw new Error("No supported synthesis format advertised.");

const parts = [];
let done;
for await (const chunk of ipa.request({
  method: "synthesize",
  text: "The sky is blue.",
  output: { mediaType },
})) {
  if (chunk.type === "audio_delta") {
    if (chunk.mediaType !== mediaType || !(chunk.data instanceof Uint8Array) || !chunk.data.byteLength) {
      throw new Error("Invalid audio bytes or unexpected encoding.");
    }
    parts.push(chunk.data.slice());
  }
  if (chunk.type === "done") done = chunk;
}
if (done?.audio?.mediaType !== mediaType) throw new Error("Unexpected final encoding.");

const blob = new Blob(parts, { type: done.audio.mediaType });
if (!blob.size || !Number.isSafeInteger(done.audio.byteLength) || blob.size !== done.audio.byteLength) {
  throw new Error("Incomplete audio stream.");
}

const url = URL.createObjectURL(blob);
const audio = document.createElement("audio");
audio.controls = true;
audio.src = url;
document.body.append(audio); // Click Play explicitly; never autoplay.

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

- `synthesize: true` advertises MP3 only; an object advertises its exact `outputMediaTypes`. Omitted `output` or `output.mediaType` always requests MP3.
- Unadvertised formats fail with `invalid_request`; an advertised format unavailable on the chosen route fails with `unavailable`.
- WAV `audio_delta` chunks belong to one RIFF/WAVE file — concatenate them directly without adding headers.
- Do not use `ipa-tools` `complete()` for speech (it is chat-only; `done.audio` holds metadata without duplicating audio bytes).

### URL input, raw base64, and cancellation

URLs are fetched by the page under normal CORS rules once iteration starts (provider upload still waits for approval). The example path below assumes you are serving the **repository root** (e.g. `npx serve .` from the repo root); replace with any same-origin or CORS-readable audio URL:

```js
const ipa = window.inference;
if (!ipa?.getFeatures?.().methods?.transcribe) throw new Error("Transcription is not advertised.");
for await (const chunk of ipa.request({
  method: "transcribe",
  media: { url: "/packages/ipa-tools/test/conformance/fixtures/speech.wav" },
  language: "en",
})) {
  if (chunk.type === "done") console.log(chunk.transcript.text);
}
```

For raw base64, pass `media: { data: rawBase64String, mediaType: "audio/wav" }` (not a `data:` URL, and do not pass both `url` and `data`).

To cancel via `AbortSignal`:

```js
const controller = new AbortController();
const ipa = window.inference;
if (!ipa?.getFeatures?.().methods?.synthesize) throw new Error("Synthesis is not advertised.");

const stream = ipa.request({
  method: "synthesize",
  text: "Cancel this request.",
  signal: controller.signal,
});
controller.abort(); // Aborting before iteration avoids approval and provider work.

try {
  for await (const chunk of stream) console.log(chunk);
} catch (error) {
  console.log(error.code); // "aborted"
}
```

To test cancellation after approval, call `controller.abort()` when `chunk.type === "accepted"` arrives.

## Browser smoke test

- **Feature gating:** With the extension disabled, both operations stay disabled; with only one advertised, only that one is enabled. **Check again** and window focus refresh capabilities.
- **Transcription:** Upload a supported recording, approve, and verify the final transcript (also test final-only providers and empty/unsupported files).
- **Synthesis & formats:** Verify legacy `synthesize: true` (MP3-only), object discovery with both MP3 and WAV (format radio group shown), and WAV-only discovery. Confirm audio stays paused until **Play** and **Clear audio** removes the player.
- **Cancellation & denial:** Cancel during approval and during provider work (partial transcripts should be labeled incomplete); deny approval and confirm controls recover.
