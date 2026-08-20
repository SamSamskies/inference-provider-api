# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Document `createInference` fallbacks with `ipa-prompt-api-fallback` object example ([#20](https://github.com/SamSamskies/inference-provider-api/issues/20)).

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
