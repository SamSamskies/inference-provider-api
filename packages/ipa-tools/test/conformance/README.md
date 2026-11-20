# IPA conformance test support

Browser-compatible test helpers for verifying IPA implementations. These modules are test utilities — not package exports or `window.inference` methods. Their fixtures are synthetic and do not certify live providers, browser transports, or model accuracy.

## Files

- [`decisions.mjs`](./decisions.mjs) — validates a successful `decide` stream against a known-valid request (IDs, primitive types, refusals, probability distributions, choice maxima, score values/legends, and camelCase token usage). Example fixtures: [`decisions-request.json`](./decisions-request.json), [`decisions-done.json`](./decisions-done.json).
- [`decision-media.mjs`](./decision-media.mjs) — negative vectors, failure assertions, and snapshot/cancellation hooks for `decide` image attachments. Synthetic 1×1 PNG fixtures: [`decisions-image-request.json`](./decisions-image-request.json) (red), [`decisions-image-blue.json`](./decisions-image-blue.json) (blue).
- [`speech.mjs`](./speech.mjs) — validates transcription and encoded MP3/WAV synthesis streams. Media fixtures are documented in [`fixtures/README.md`](./fixtures/README.md).

## Typed decisions

Serve this directory from a secure page's origin and import the helper as a native ES module:

```js
const { assertDecisionStream } = await import("/conformance/decisions.mjs");
const request = await fetch("/conformance/decisions-request.json").then((r) => r.json());
if (!window.inference?.getFeatures?.().methods?.decide) {
  throw new Error("Typed decisions are not advertised by this injector.");
}
const done = await assertDecisionStream(request, window.inference.request(request));
console.log(done.model, done.answers, done.usage);
```

`assertDecisionStream` verifies response shape and consistency and propagates stream errors. Implementation test suites should additionally verify:

- **Validation & limits:** Question-count and payload-size maxima are implementation-defined (not universal IPA ceilings; e.g. >64 questions or >63 KiB is not inherently invalid). Test your documented boundaries, smaller selected-route limits, and upstream limit translations (`invalid_request` with a useful explanation, no `done`, and no provider I/O for locally knowable failures). Never silently truncate or split requests. Choice-count, score-level, and 64-level nesting limits still apply.
- **Permissions & lifecycle:** Separate origin/method grants, approval snapshot isolation, denial, unavailable routes, malformed provider output (`provider_error`, no `done`), no provider I/O before permission resolves, and cancellation via `AbortSignal` or iterator closure during approval and provider work.

## Speech synthesis & transcription

Pass the full request object to `assertSpeechStream` so the requested output media type is verified (`assertSpeechStream("synthesize", stream)` still checks the MP3 default):

```js
const { assertSpeechStream } = await import("/conformance/speech.mjs");
const request = {
  method: "synthesize",
  text: "The sky is blue.",
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

// Decode to verify playability (container validation alone does not prove it).
const context = new AudioContext();
try {
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  console.log(done.model, blob.size, decoded.duration, decoded.numberOfChannels);
} finally {
  await context.close();
}

const player = document.createElement("audio");
player.controls = true;
const url = URL.createObjectURL(blob);
player.src = url;
document.body.append(player); // Press Play; never autoplay.
// On removal/navigation: player.pause(); player.remove(); URL.revokeObjectURL(url).
```

WAV checks accept arbitrarily split headers and verify one complete RIFF/WAVE container, format/data chunks, exact container sizes, MIME consistency, and final byte count. Pass `{ expectedAudio: Uint8Array }` to assert exact upstream bytes across fragments.

Implementation suites should additionally verify:

- WAV requests exclude MP3-only saved routes, and omitted output still requests MP3 on a saved WAV-only route.
- Unadvertised formats fail with `invalid_request`; advertised formats unsupported on the chosen route fail with `unavailable` (before `accepted` whenever knowable).
- Malformed native output becomes `provider_error`.
- Cancellation before approval, during unary work or fragment delivery, iterator closure, and navigation stop work with no `done`.

## Decision media

Validate a successful native PNG decision request and the built-in negative vectors:

```js
const { assertDecisionStream } = await import("/conformance/decisions.mjs");
const { assertDecisionFailure, invalidDecisionMediaRequests } =
  await import("/conformance/decision-media.mjs");

const request = await fetch("/conformance/decisions-image-request.json").then((r) => r.json());
const features = window.inference?.getFeatures?.() ?? {};
if (
  features.methods?.decide !== true ||
  !features.decisionMedia?.imageMediaTypes?.includes("image/png")
) {
  throw new Error("Native PNG decision input is not advertised.");
}

await assertDecisionStream(request, window.inference.request(request));
for (const invalid of invalidDecisionMediaRequests(request)) {
  await assertDecisionFailure(window.inference.request(invalid), "invalid_request", {
    preflight: true,
  });
}
```

`assertDecisionMediaValidation({ inference, valid, oversized })` runs valid input, the malformed vectors, and a required nonempty array of implementation-specific over-limit requests built from your documented limits.

### Snapshot & cancellation hooks

Use `assertDecisionMediaSnapshot` and `assertDecisionMediaCancellation` with your implementation's controlled permission and provider test adapters:

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
  inference: testInjector,
  request,
  waitForStage: () => adapter.waitForUpload(),
  assertCleanup: () => adapter.assertCancelledAndReleased(),
});
```

### Additional implementation checks for decision media

- **Compatibility & discovery:** Preserve text-only requests (omitted `attachments` and `[]`), boolean `methods.decide === true`, all three primitives, exact answer IDs, and per-question refusals. URLs inside `state` remain plain data and trigger no fetch. Discovery is synchronous, identity-free, independent of grants/routes, and performs no network I/O.
- **Valid inputs:** Test both raw base64 and `Blob`/`File` inputs for every advertised MIME type, empty `Blob.type` with explicit `mediaType`, multiple shared attachments in order, and byte-exact forwarding to every question. Advertised decision media must work without chat `imageInput`; chat `imageInput` alone must not enable decision media.
- **Validation & limits:** Reject corrupt images, false MIME labels, `data:` URLs, whitespace, invalid padding, remote URLs, provider handles, unknown fields, and per-question attachments with `invalid_request` (no `accepted`/`done`, no consent prompt, zero provider I/O). Test exact-limit and one-over boundaries for count, per-image/total decoded bytes, encoded transport bytes, text payload, depth, and dimensions/frames. Never truncate, resize, OCR-substitute, split, or emulate via chat.
- **Routes & consent:** Unadvertised types fail with `invalid_request`; advertised types unsupported on a saved route fail with `unavailable` without switching routes or dropping attachments. Existing text Decisions and chat-image grants must trigger new MIME-scoped media consent showing operation, provider/model, question IDs/types, and each attachment's index, type, decoded size, count, and total bytes. Denial leaves zero uploads or inference.
- **Snapshots & cleanup:** Test both `Blob` and base64 sources. Pre-iteration mutations are included; mutations during encoding/approval must not alter approved data. Cancellation throws `aborted`, stops in-flight work, releases temporary media, and emits no `done`. Also test pre-abort, iterator closure, navigation, denial, failure, and success cleanup.
