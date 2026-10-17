# Speech implementation alignment and conformance

The normative contract is [SPEC.md — Bounded speech](../SPEC.md#bounded-speech).
Issue [#50](https://github.com/SamSamskies/inference-provider-api/issues/50)
tracks its design. The spec now includes the optional methods; Inference Bridge
graduation and package publication are separate steps. This document records
implementation evidence and checks, not a claim that live providers passed.

## Reference snapshot

Compared on 2026-10-17 against the clean local Inference Bridge checkout at
[`69bdcf66d6396bcb1f3a3c0955bed24d12ce4364`](https://github.com/SamSamskies/inference-bridge/tree/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364).
Source links below are pinned so later implementation changes cannot silently
change the evidence.

| Contract | Bridge implementation at this snapshot | Graduation checks |
| --- | --- | --- |
| One `request` function, method discrimination | [`content/inject.js`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/content/inject.js) accepts speech through `experimental.request`; stable request remains chat-only | Add speech to stable `request` and `getFeatures`; keep unadvertised methods fail-closed. `decide` remains experimental and outside this spec. |
| Speech discovery | Experimental `methods.transcribe.acceptedMedia` contains six normalized MIME entries; `methods.synthesize` is independent; both default off | Expose enabled stable support without network, prompts, provider/model/voice IDs, or account state. No new `methods.chat` flag is required. |
| Sources and CORS | Injector handles `media` Blob/base64/page-fetched URL; only source metadata crosses before approval | Keep source XOR based on property presence; verify declared/detected MIME conflicts, CORS failures, and no privileged URL fetch. |
| Bounds and encoding | [`src/speech.js`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/src/speech.js): 24,000,000 input bytes, 4,096 synthesis Unicode code points, 32,000,000 output bytes, 256 KiB internal transfer chunks | These are Bridge limits, not permanent spec constants or public chunk sizes. Retest exact bounds and cancellation on both browsers. |
| MIME/container/codec surface | [`src/providers/registry.js`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/src/providers/registry.js) filters MIME, then model-specific MIME support; discovery has no narrower container/codec arrays | Preserve concrete MIME claims and fail clearly on decoder rejection; add narrower filters when reliably known. Omitted constraints do not certify every codec. |
| Transcription stream | [`background/service-worker.js`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/background/service-worker.js) forwards append-only text, verifies deltas against final text when present, permits final-only responses | Preserve exactly one `accepted` and `done`, clear no-speech/no-track errors, audio-only semantics, and valid language-hint behavior. |
| Synthesis stream | Worker emits ordered byte chunks and checks exact final byte count; injector returns page-owned `Uint8Array`s | Preserve `audio/mpeg`, at least one `audio_delta`, metadata-only `done.audio`, backpressure, and no autoplay. |
| Grants and privacy | [`src/permissions.js`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/src/permissions.js), [`src/storage.js`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/src/storage.js), and [`PRIVACY.md`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/PRIVACY.md) separate speech grants from chat and bind provider/model/voice | Verify old grants stay chat-only, route changes require approval, blocks cover every method, and metadata/whole-container disclosure stays accurate. |
| Cross-browser transport | [`content/content-script.js`](https://github.com/SamSamskies/inference-bridge/blob/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/content/content-script.js) relays bounded base64/length chunks; page owns media buffers | Retest Firefox isolated-world boundaries, upload/download cancellation, iterator close, reload/navigation, and extension-worker reconnection. The transport encoding is not a page-facing API type. |

The OpenAI adapter uses dedicated transcription/speech endpoints. OpenRouter
does too, with live operation-specific model/voice catalogs; video input is
narrowed to its OpenAI transcription routes. Ollama supports transcription only
after an installed model reports audio capability; its current conservative
surface is WAV, plus MP3 for the specifically verified model in its adapter.
Generic OpenAI-compatible naming, Prompt API audio hints, and Web Speech playback
do not establish support. See the pinned
[`src/providers/`](https://github.com/SamSamskies/inference-bridge/tree/69bdcf66d6396bcb1f3a3c0955bed24d12ce4364/src/providers)
implementations for details; provider identifiers do not belong in the portable
request or discovery types.

## Shared checks

Run `npm test` from this repository. It builds packages in dependency order,
runs the existing chat/fallback regressions and speech routing/byte-stream
checks, and compiles request-to-chunk and migration assertions. The
[stream assertion module](../conformance/speech.mjs) also runs in a browser;
its tests use [checked-in media fixtures](../conformance/fixtures/README.md).
No keys, provider calls, microphone capture, or playback are needed for these
automated contract tests.

To exercise a real implementation after it advertises stable speech, serve the
repository over loopback HTTP or HTTPS and open its page with the injector.
Paste this in that page's DevTools, then select an advertised audio fixture:

```js
const { assertSpeechStream } = await import("/conformance/speech.mjs");
const picker = document.createElement("input");
picker.type = "file";
document.body.append(picker);
await new Promise((resolve) => picker.addEventListener("change", resolve, { once: true }));
const file = picker.files[0];
picker.remove();
const report = await assertSpeechStream("transcribe", window.inference.request({
  method: "transcribe", media: { data: file },
}));
console.log(report);
console.log(await assertSpeechStream("synthesize", window.inference.request({
  method: "synthesize", text: "The sky is blue.",
})));
```

The checker verifies stream shapes, ordering, final transcript agreement when
deltas exist, byte counts, and optional usage. It propagates implementation
errors. It does not decode MP3 or determine whether words were transcribed
faithfully. A passing mock/transport test is not provider semantic evidence.

For each real provider route and browser, record the implementation commit,
browser/runtime version, date, approved provider/model/voice (in the test report,
not discovery), media fixture SHA-256, MIME/container/codec, language hint,
chunk sequence, final text or output byte count, and failure code/message.
Different providers need not return identical words, voices, or bytes.

- [ ] Run audio WAV/MP3/M4A/WebM and supported MP4/WebM video-with-audio fixtures.
- [ ] Compare the two video fixtures with identical audio and changed visuals;
      verify only audio contributes to transcription, allowing model variability.
- [ ] Reject the silent and no-audio-track fixtures clearly; test unsupported
      containers/codecs and corrupt/truncated bytes.
- [ ] Test valid/invalid language hints, MIME conflicts, malformed base64, source
      XOR, missing types, and exact implementation input/text/output bounds.
- [ ] Exercise final-only and append-only transcription. Test corrupt stream
      results as `provider_error`, with no successful `done` after a failure.
- [ ] Exercise one-chunk and multi-chunk MP3 synthesis; reconstruct an
      `audio/mpeg` Blob and compare bytes with a deterministic transport fixture.
- [ ] Verify lazy start, deny before `accepted`, abort before/after `accepted`,
      iterator close, navigation, and page close, including active IPC transfers.
- [ ] Test page-owned URL fetch/CORS success and failure with instrumentation
      proving no privileged media-URL fetch.
- [ ] Verify persisted chat/speech grants, route/voice binding, separate revoke,
      whole-container disclosure, synthetic-speech notice, and explicit playback.
- [ ] Exercise two independently operated routes for each operation. A gateway
      forwarding to the same provider/model family is transport evidence, not
      independent semantic evidence. STT and TTS evidence must be recorded separately.

These remain implementation verification tasks. Updating the spec does not
require claiming that this checklist or a live two-provider matrix has passed.
