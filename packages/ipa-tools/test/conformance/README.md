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

Decision question-count and payload-size maxima are implementation-defined, not
universal IPA ceilings. A request with 65 questions or more than 63 KiB of
serialized `state` + `questions` is not inherently invalid. A successful stream
for a request within an implementation's and selected route's limits must still
correlate every answer exactly, regardless of size. `methods.decide: true` does
not guarantee that a particular request size fits.

Implementation suites must test their documented question-count and payload-size
boundaries (including how bytes/fields are counted), smaller selected-route
limits, and requests exceeding each applicable limit. Expect `invalid_request`
with a useful explanation, no `done`, and no provider inference I/O for locally
known failures; reject before approval whenever possible. Also test translating
upstream limit rejections when a limit cannot be checked locally. Assert that
questions/state are not silently truncated and one request is not automatically
split into multiple provider calls to fit a limit. Keep structural validation,
answer correlation, approval snapshot isolation, and cancellation checks at
these boundaries. Choice-count, score-level, and 64-level nesting limits remain
unchanged.

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

## Decision media

[`decisions-image-request.json`](./decisions-image-request.json) contains a valid
1×1 red PNG as raw base64; [`decisions-image-blue.json`](./decisions-image-blue.json)
is a distinct blue PNG for replacement/snapshot tests. They are synthetic RGB
fixtures, not native provider results or meaningful damage evidence.
[`decision-media.mjs`](./decision-media.mjs) supplies browser-compatible negative
vectors, failure assertions, and integration hooks for snapshot/cancellation.
`assertDecisionMediaValidation({ inference, valid, oversized })` runs successful
input, the malformed vectors, and a required nonempty array of implementation-specific
over-limit requests. Construct `oversized` from the implementation's documented
limits, covering each independent budget; the harness imposes no universal caps.
The unit tests verify these assertions against controlled subjects; actual
validation, consent, transport, and native mapping must be tested in the owning
implementation.

On an injector advertising PNG decision input, validate successful native input
without changing stream assertions:

```js
const { assertDecisionStream } = await import("/conformance/decisions.mjs");
const { assertDecisionFailure, invalidDecisionMediaRequests } =
  await import("/conformance/decision-media.mjs");
const request = await fetch("/conformance/decisions-image-request.json").then((r) => r.json());
const features = window.inference?.getFeatures?.() ?? {};
if (features.methods?.decide !== true ||
    !features.decisionMedia?.imageMediaTypes.includes("image/png")) {
  throw new Error("Native PNG decision input is not advertised.");
}
await assertDecisionStream(request, window.inference.request(request));
for (const invalid of invalidDecisionMediaRequests(request)) {
  await assertDecisionFailure(window.inference.request(invalid), "invalid_request", { preflight: true });
}
```

For implementation suites, use controlled approval and provider adapters, a
finite test timeout, and spies on transport, fetch, native inference, and upload:

- Preserve existing text/JSON requests, including omitted attachments and `[]`,
  boolean `methods.decide === true`, all three primitives, exact answer ids, and
  per-question refusals. State containing URLs or media-shaped JSON must remain
  data and trigger no fetch. Discovery is synchronous, identity-free, independent
  of grants/accounts/selected route, and performs no network I/O.
- Exercise valid base64 and Blob/File images for every advertised MIME type,
  empty Blob MIME with explicit type, multiple shared attachments in order, and
  native byte-exact forwarding to every question. Advertised media without chat
  `imageInput` must work; chat-image support without decision media must reject.
- Run all negative vectors above (on every relevant MIME surface), unknown
  request/question/attachment fields, and requests with per-question attachments.
  Assert `invalid_request`, no `accepted`/`done`, no consent for known malformed
  inputs, and zero provider I/O. Corrupt images, false MIME labels, data URLs,
  whitespace, invalid padding bits, remote URLs and provider handles must fail.
- Test each documented count, per-image decoded byte, total decoded byte, total
  encoded transport, text payload, depth, and dimension/frame boundary, including
  exact-limit success and one-over failure. Supply oversized requests to
  `assertDecisionFailure(stream, "invalid_request", { preflight: true })`.
  Confirm base64 overhead is counted in transport, decoded bytes in media, text
  separately, and shared media only once regardless of question count. No
  truncation, resizing, OCR substitution, splitting, or chat emulation is allowed.
- A well-formed but unadvertised image type is `invalid_request`. An advertised
  type unavailable on a saved route is `unavailable`, with no route switch or
  attachment omission. Test smaller selected-route limits and upstream limit
  rejections: `invalid_request` with the attachment/budget and known limit value,
  no `done`; known preflight failures must have no `accepted`.
- Existing text Decisions and chat-image grants must each trigger new media
  consent. Approval shows the operation, provider/model, ids/types, and every
  image index/type/decoded size, count, and total bytes. Covering MIME-scoped
  grants can be reused; widening types or changing route requires approval.
  Denial must leave zero uploads/inference. Discovery must not reveal grants.

The snapshot hook starts iteration, waits for the implementation's approval
barrier, checks no input has been forwarded, invokes page mutation, approves,
and compares the provider-neutral adapter input with the original input. Capture
`readForwarded()` immediately before native wire mapping; inspect the final
native wire/upload bytes separately. Hooks are supplied by the implementation's
controlled permission layer, not by the page-facing API:

```js
const { assertDecisionMediaSnapshot, assertDecisionMediaCancellation } =
  await import("/conformance/decision-media.mjs");
await assertDecisionMediaSnapshot({
  inference: testInjector,
  request: structuredClone(request),
  waitForApproval: () => permissions.waitForPending(),
  approve: () => permissions.approve(),
  readForwarded: () => adapter.lastDecisionInput, // undefined before approval
  mutate: (input) => {
    input.state = "Replaced after snapshot";
    input.questions.damaged.instructions = "Replaced after snapshot";
    input.attachments[0].data = blueImage.data;
    input.attachments.push(blueImage);
  },
});
// Repeat at encoding, pending approval, upload, and inference barriers.
await assertDecisionMediaCancellation({
  inference: testInjector, request,
  waitForStage: () => adapter.waitForUpload(),
  assertCleanup: () => adapter.assertCancelledAndReleased(),
});
```

Run snapshot cases with both Blob and base64 sources. Mutations made before
first iteration must be included; mutations during encoding/approval must not
change approved types, array order, exact bytes, state, or questions. Cancellation
must throw `aborted`, cancel pending/in-flight work, release temporary media, and
emit no `done`. Also test pre-abort, iterator closure, navigation, denial, failure,
and success cleanup, including late non-cancellable upload results and provider
retention/deletion behavior. No bytes may reach providers before consent.
