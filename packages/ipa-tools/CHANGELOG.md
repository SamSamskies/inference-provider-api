# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

These changes require the next major release, **3.0.0**; 2.x remains MP3-only.

### Breaking

- `SynthesisChunk` MIME fields now use the exported `SynthesisMediaType` union (`audio/mpeg` or `audio/wav`), and `InferenceFeatures.methods.synthesize` also accepts `{ outputMediaTypes: SynthesisMediaType[] }`. Exhaustive MIME handlers and boolean-only discovery code must account for the new variants. Existing requests, the MP3 default, and legacy `synthesize: true` keep their behavior.

### Added

- Optional explicit WAV synthesis, identity-free format discovery, and format-aware fallback filtering before session creation, including created/cached/concurrent client checks. Unknown and unadvertised formats fail with `invalid_request`; selected-route errors propagate without changing providers.
- Browser demo format selection and returned-MIME Blob assembly; shared conformance assertions for byte-exact WAV fragments, one RIFF/WAVE container, MIME/length consistency, malformed output, and cancellation. Synthetic fixtures validate transport, not live provider availability.

## [2.0.0] - 2026-10-19

### Breaking

- `InferenceRequest`, `InferenceMethod`, and `InferenceChunk` now include `decide`; generic done results include `done.answers`. Exhaustive handlers must handle decisions, and custom `Inference` implementations must reject unadvertised methods before yielding. Concrete chat/speech requests retain their result types; `ChatRequest`, `ChatChunk`, `ChatDoneChunk`, `DoneChunk`, `complete()`, and `runTools()` keep their existing contracts.

### Added

- Optional IPA `decide` request, JSON state, typed question/answer, refusal, chunk, and done types, with `methods.decide` discovery.
- Decision-aware `createInference().request` and fallback selection. Both backend and created-client snapshots must advertise decisions; unsupported fallbacks are skipped before session creation, and injector failures never trigger a silent fallback.
- Shared browser-compatible decision stream assertions and mock fixtures for typed results, refusals, probability/score consistency, cancellation, and method-specific TypeScript inference. These verify the contract, not live provider availability or decision accuracy.

## [1.0.0] - 2026-10-17

### Breaking

- `InferenceRequest` and `InferenceChunk` now cover chat, bounded transcription, and MP3 synthesis. Use `ChatRequest`, `ChatChunk`, and `ChatDoneChunk` for existing chat-only code; `DoneChunk` remains chat-only. Concrete `request()` calls infer their method-specific chunk stream. See the README migration guide ([#50](https://github.com/SamSamskies/inference-provider-api/issues/50)).
- `Inference.request`, `createInference().request`, and backend clients use `InferenceChunkFor<R>`; custom backends must reject unadvertised methods before yielding. A backend's feature snapshot must advertise speech before it can be selected for speech. `complete()` and `runTools()` remain chat-only.

### Added

- Speech request/source, media constraint, chunk, usage, done, and conditional mapping types; identity-free `methods` discovery.
- Method- and MIME-aware fallback selection, including cached/concurrent requests; no fallback after an available injector rejects or fails a request.
- Compile-time migration/inference checks, browser speech examples, and shared stream conformance fixtures. These are contract tests, not certification of live providers.

## [0.6.0] - 2026-08-27

### Added

- SPEC-aligned image content parts: `ImagePart` / `TextPart` / `ContentPart`, `output.images` on `InferenceRequest`, and `imageInput` / `imageOutput` on `InferenceFeatures` ([#42](https://github.com/SamSamskies/inference-provider-api/issues/42)).
- `createInference` fallbacks skip backends that do not advertise `imageInput` / `imageOutput` when the request includes image parts or `output.images`.

## [0.5.0] - 2026-08-24

### Added

- SPEC-aligned `webSearch` on `InferenceFeatures` and `{ type: "web_search" }` on `Tool` ([#39](https://github.com/SamSamskies/inference-provider-api/issues/39)).

### Changed

- Document a minimal custom HTTP `InferenceBackend` recipe for `createInference({ fallbacks })` (hosted endpoints; not IPA).
- `createInference` fallbacks treat search-only `tools` as needing `webSearch`, not `toolCalling`. Function tools and hosted search are gated independently.

## [0.4.1] - 2026-08-20

### Changed

- Document `createInference` fallbacks with `ipa-prompt-api-fallback` object example ([#20](https://github.com/SamSamskies/inference-provider-api/issues/20) phase 3).

## [0.4.0] - 2026-08-19

### Added

- `runTools` `options?: InferenceOptions`, reused on every provider call ([#33](https://github.com/SamSamskies/inference-provider-api/issues/33)).
- `runTools` `onAccepted?: () => void` for `type: "accepted"` stream chunks.
- `RunToolsResult.stopReason`: `"end_turn"` (text `done`) or `"max_rounds"` (tools ran on the last provider call).

### Changed

- `maxRounds` is the max provider calls. Tool calls on the last round are executed and the loop returns instead of throwing `Tool loop exceeded maxRounds`.

## [0.3.1] - 2026-08-17

### Fixed

- Removed built-in `fallbacks: ["promptApi"]` string alias (and its dynamic `import("ipa-prompt-api-fallback")`) until that peer package exists. Vite/Rollup were analyzing the import for every consumer, even when no fallback was configured. Pass a custom `InferenceBackend` object instead.

## [0.3.0] - 2026-08-17

### Added

- `createInference({ fallbacks, onDownloadProgress })` — IPA-first client with optional page-side fallbacks (at most one via `MAX_FALLBACKS`), lazy resolve, caching, `probe()`, and tools feature-gating ([#20](https://github.com/SamSamskies/inference-provider-api/issues/20) phase 1).
- `fallbacks` / `onDownloadProgress` on one-shot `complete` and `runTools` (prefer `createInference` for repeated sends).
- Types: `InferenceBackend`, `BackendAvailability`, `FallbackInput`, `ProbeStatus`, `MAX_FALLBACKS`.

## [0.2.0] - 2026-08-16

### Added

- SPEC-aligned `InferenceOptions` / `ReasoningEffort` types, including `options.temperature` (`[0, 2]`) and feature discovery via `getFeatures().options`.

## [0.1.0] - 2026-08-14

### Added

- Initial release: SPEC.md TypeScript types with `Window` augmentation.
- `complete` — drain `window.inference.request` (or an injected `request`) to a `done` chunk.
- `runTools` — page-executed multi-round function-tool loop (port of Inference Bridge `run-tools.js`).
- `waitForInference`, `getInference`, `isInferenceAvailable`, `getFeatures`, `isInferenceError`, and `makeInferenceError`.
