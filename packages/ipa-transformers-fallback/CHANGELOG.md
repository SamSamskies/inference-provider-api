# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial package: `createTransformersBackend()` and `getTransformersAvailability()` for Hugging Face Transformers.js → IPA-shaped `Inference` ([#37](https://github.com/SamSamskies/inference-provider-api/issues/37)).
- Workspace POC `examples/transformers-fallback`: IPA, then Prompt API, then Transformers.js (`MAX_FALLBACKS` 2).
- Compatibility backend only — **not** an IPA implementation; does not mutate `window.inference`. Apps import this package and pass the backend into `ipa-tools` `createInference({ fallbacks })`.
- Default model `onnx-community/Qwen2.5-0.5B-Instruct` (`dtype: "q4"`, about 800 MB first download).
