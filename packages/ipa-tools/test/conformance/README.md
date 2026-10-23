# IPA conformance test support

These browser-compatible modules are test helpers, not package exports or
methods on `window.inference`. Their fixtures are synthetic and do not certify
a live provider, browser transport, or model's accuracy.

- [`speech.mjs`](./speech.mjs) checks transcription and encoded MP3/WAV streams;
  [`fixtures/`](./fixtures/README.md) describes the media fixtures.
- [`decisions.mjs`](./decisions.mjs) checks a successful decision stream against
  a known-valid request, including ids, primitive types, refusals, probability
  distributions, choice maxima, score values/legends, and camelCase token usage.
  [`decisions-request.json`](./decisions-request.json) and
  [`decisions-done.json`](./decisions-done.json) provide a three-primitive example.

To check an implementation from a secure browser page, serve this directory
from the page's origin and import the helper as a native ES module:

```js
const { assertDecisionStream } = await import("/conformance/decisions.mjs");
const request = await fetch("/conformance/decisions-request.json").then((r) => r.json());
if (!window.inference?.getFeatures?.().methods?.decide) {
  throw new Error("Typed decisions are not advertised by this injector.");
}
const done = await assertDecisionStream(request, window.inference.request(request));
console.log(done.model, done.answers, done.usage);
```

Passing this helper verifies a successful response's shape and consistency.
An implementation test suite must also exercise request validation and limits,
snapshot isolation during approval, separate origin/method grants, denial,
unavailable routes, malformed provider responses (`provider_error`, no `done`),
and cancellation during approval and provider work. No provider I/O may happen
before permission resolves; abort and iterator closure must cancel unfinished
work. The helper propagates stream errors rather than accepting them as success.

For synthesis, pass the request so its output type is checked. Existing
`assertSpeechStream("synthesize", stream)` calls still check the MP3 default:

```js
const { assertSpeechStream } = await import("/conformance/speech.mjs");
const request = {
  method: "synthesize", text: "The sky is blue.",
  output: { mediaType: "audio/wav" },
};
const synthesis = window.inference?.getFeatures?.().methods?.synthesize;
if (!synthesis || synthesis === true || !synthesis.outputMediaTypes.includes("audio/wav")) {
  throw new Error("WAV synthesis is not advertised.");
}
const parts = [];
async function* capture() {
  for await (const chunk of window.inference.request(request)) {
    if (chunk.type === "audio_delta") parts.push(chunk.data.slice());
    yield chunk;
  }
}
const { done } = await assertSpeechStream(request, capture());
const blob = new Blob(parts, { type: done.audio.mediaType });
const context = new AudioContext();
try {
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  console.log(done.model, blob.size, decoded.duration, decoded.numberOfChannels);
} finally { await context.close(); }
const player = document.createElement("audio");
player.controls = true;
const url = URL.createObjectURL(blob);
player.src = url;
document.body.append(player); // Press Play; never autoplay.
// On removal/navigation: player.pause(); player.remove(); URL.revokeObjectURL(url).
```

WAV checks accept arbitrarily split headers and assert one complete RIFF/WAVE
container, format/data chunks, exact container sizes, requested MIME consistency,
and the final byte count. Optional `{ expectedAudio: Uint8Array }` checks exact
upstream bytes across fragments. Container validation alone does not prove
playability: decode a real native provider result and explicitly play it.
The checked-in `speech.wav` is locally generated speech, not a Gemini response.

Before an implementation ships, also verify that a WAV request excludes
MP3-only approval routes; omitted output still requests MP3 on a saved WAV-only
route. Reject unadvertised formats with `invalid_request`, and advertised formats
unsupported on the chosen route with `unavailable`, before `accepted` whenever
knowable. Cancellation before approval and during unary work/fragment delivery,
iterator closure, and navigation must stop work with no successful `done`.
Malformed native output must become `provider_error`. Passing mock conformance
checks does not graduate a dependent implementation or authorize merging it.
