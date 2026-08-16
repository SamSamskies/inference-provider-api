# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-16

### Added

- SPEC-aligned `InferenceOptions` / `ReasoningEffort` types, including `options.temperature` (`[0, 2]`) and feature discovery via `getFeatures().options`.

## [0.1.0] - 2026-08-14

### Added

- Initial release: SPEC.md TypeScript types with `Window` augmentation.
- `complete` — drain `window.inference.request` (or an injected `request`) to a `done` chunk.
- `runTools` — page-executed multi-round function-tool loop (port of Inference Bridge `run-tools.js`).
- `waitForInference`, `getInference`, `isInferenceAvailable`, `getFeatures`, `isInferenceError`, and `makeInferenceError`.
