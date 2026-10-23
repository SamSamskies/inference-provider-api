# IPA Speech Demo

A single-page app for bounded transcription and MP3/WAV synthesis using
`window.inference.request`. Transcription and synthesis are detected independently;
an unsupported operation stays disabled while the other remains usable.

## Try it

**Demo URL:** [https://samsamskies.github.io/inference-provider-api/speech/](https://samsamskies.github.io/inference-provider-api/speech/)

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation)
   with speech support (v0.17.0+), or another injector advertising speech methods.
2. Open the demo, or serve the examples locally from the repository root:

   ```bash
   npx serve examples
   ```

   Open the printed localhost URL followed by `/speech/`. Do not open `index.html`
   as a `file:` URL.
3. **Transcribe:** choose an advertised audio/video file, then click **Transcribe**.
   If the browser reports no MIME type, select the file's actual advertised type.
   The extension still validates the container and codec; the page does not guess
   from the filename or override a conflicting detected type.
4. **Text to speech:** enter text, choose an advertised audio format, click **Generate speech**, and approve the operation
   in your extension. Click **Play** to listen. If your browser offers **Download**
   in the player's menu, use it to save the audio file.

The UI shows **Waiting for approval…**, then **Transcribing…** or **Generating audio…**
after `accepted`. Transcripts can stream, but final-only providers work too.
**Cancel** aborts the active request. Generated audio is exposed only after `done.audio.byteLength`
matches the received bytes and every MIME type matches the requested format. Audio never autoplays; clearing, replacing, or leaving
the page releases its object URLs. Provider, model, and voice selection stay in the
extension. No app-held API key or build step is needed.

When provided, usage appears beside the model: input audio seconds for transcription,
and input characters plus output audio seconds for speech generation. Missing usage
fields are omitted; the demo does not estimate token counts.

## Browser smoke test

- With the extension disabled, both operations should stay disabled and the page
  should explain how to connect. With only one speech method advertised, only
  that operation should be enabled. **Check again** rechecks capabilities when
  speech is unavailable; returning focus to the page also refreshes them.
- Upload a supported recording, approve transcription, and verify the final text.
  Try an empty or unsupported file and confirm it cannot be submitted. Try a
  provider that returns only a final transcript, without deltas.
- Generate speech and verify it stays paused until **Play**. Where supported,
  use the player's **Download** menu item and confirm the saved file plays.
  **Clear audio** should remove the player.
- Verify legacy MP3-only discovery, object discovery offering both formats, and
  WAV-only discovery. Show the format radio group only when both formats are
  advertised; a sole supported format is selected automatically. The selected format
  must match the player metadata and Blob MIME.
- Cancel while awaiting approval and during provider work. Expect **Cancelled**
  with no completed output; partial transcript text is labelled incomplete.
  Deny approval and verify a useful error appears and the controls recover.

## Developer snippets

These snippets use the normative `window.inference.request` methods from
[SPEC.md](../../SPEC.md#bounded-speech). Run them in a top-level HTTPS or
loopback HTTP page with an injector advertising speech. Inference Bridge
[v0.17.0+](https://github.com/SamSamskies/inference-bridge/releases/tag/v0.17.0)
exposes them on stable `request`/`getFeatures`; detect method support before use.

The user chooses provider/model/voice during approval. Existing chat grants do
not authorize speech. Files can include sensitive bystander/background speech;
a video container may be uploaded in full even though only audio is transcribed.
Playback starts only when the user presses Play.

### Upload a completed recording

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

### Text to an MP3 or WAV Blob

```js
const ipa = window.inference;
const synthesis = ipa?.getFeatures?.().methods?.synthesize;
const formats = synthesis === true ? ["audio/mpeg"] : synthesis?.outputMediaTypes ?? [];
// Choose WAV explicitly when supported; omitted output always means MP3.
const mediaType = formats.includes("audio/wav") ? "audio/wav" : "audio/mpeg";
if (!formats.includes(mediaType)) throw new Error("No supported synthesis format advertised.");
const parts = [];
let done;
for await (const chunk of ipa.request({
  method: "synthesize", text: "The sky is blue.", output: { mediaType },
})) {
  console.log(chunk);
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

Legacy `synthesize: true` advertises MP3 only. An object declares exactly its
nonempty `outputMediaTypes`, so WAV-only injectors need an explicit WAV request.
Omitted `output`, `output: {}`, and omitted `output.mediaType` all mean MP3;
unadvertised formats are `invalid_request`. An advertised format unavailable
on the user-selected or saved route is `unavailable`, without changing providers.
WAV fragments belong to one RIFF/WAVE file; assemble them without adding headers.
WAV needs an injector implementing [issue #68](https://github.com/SamSamskies/inference-provider-api/issues/68);
older speech releases may advertise only MP3.

Do not use `complete()` for speech. It stays chat-only; `done.audio` contains
metadata without duplicating audio bytes. No public `synthesize()` or audio
collector is needed.

### URL input, raw base64, and cancellation

URLs are resolved by the page under its normal CORS rules, once iteration starts.
They may be fetched before approval; provider upload waits for approval. Use an
actual same-origin or CORS-readable URL for an advertised media type:

```js
const ipa = window.inference;
if (!ipa?.getFeatures?.().methods?.transcribe) throw new Error("Stable transcription is not advertised.");
for await (const chunk of ipa.request({
  method: "transcribe",
  media: { url: "/packages/ipa-tools/test/conformance/fixtures/speech.wav" },
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
