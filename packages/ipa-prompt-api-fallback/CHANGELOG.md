# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-17

### Changed

- Require `ipa-tools >=1.0.0` and implement its generic request-to-chunk signature. This backend stays chat-only: no speech methods are advertised, and direct speech requests fail with `invalid_request` before session work. Prompt API audio modality hints do not prove faithful transcription or MP3 synthesis support.

## [0.2.0] - 2026-08-27

### Added

- Map user/assistant text `ContentPart[]` onto Prompt API string content.

### Changed

- Reject image parts and `output.images` with `invalid_request`. This backend does not advertise `imageInput` / `imageOutput` (Prompt API output is still text).
- Peer `ipa-tools` is now `>=0.6.0` (image content part types).

## [0.1.0] - 2026-08-20

### Added

- Initial release: `createPromptApiBackend()` and `getPromptApiAvailability()` for Chrome Prompt API → IPA-shaped `Inference` ([#20](https://github.com/SamSamskies/inference-provider-api/issues/20)).
- Compatibility backend only — **not** an IPA implementation; does not mutate `window.inference`. Apps import this package and pass the backend into `ipa-tools` `createInference({ fallbacks })`.
