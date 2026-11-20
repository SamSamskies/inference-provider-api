# ipa-prompt-api-fallback

[![npm](https://img.shields.io/npm/v/ipa-prompt-api-fallback)](https://www.npmjs.com/package/ipa-prompt-api-fallback)

Chrome [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) (`LanguageModel`) compatibility backend for [`ipa-tools`](../ipa-tools) `createInference({ fallbacks })`.

**This is not IPA.** There is no origin permission prompt, no user-chosen provider/model, and no `permission_denied` from the browser. Do **not** assign this adapter to `window.inference`. `isInferenceAvailable()`, `getInference()`, and `waitForInference()` stay false/throwing on the fallback path.

## Install

```bash
npm install ipa-tools ipa-prompt-api-fallback
```

Requires `ipa-tools >=1.0.0`. Zero other runtime dependencies. Browser ESM only.

`ipa-tools` does **not** import this package. Your app imports both and passes the backend object into `fallbacks`.

This backend is **chat-only**: it does not advertise `methods.decide`, `methods.transcribe`, or `methods.synthesize`, so `createInference` skips it for decisions and speech without creating a session or starting a download. Direct non-chat requests fail with `invalid_request`.

## Usage

```ts
import { createInference } from "ipa-tools";
import { createPromptApiBackend } from "ipa-prompt-api-fallback";

const inference = createInference({
  fallbacks: [createPromptApiBackend()],
  onDownloadProgress(loaded) {
    status.textContent = `Downloading on-device model… ${Math.round(loaded * 100)}%`;
  },
});

const status = await inference.probe();
// { ipa: "unavailable", promptApi: "downloadable" }

sendButton.addEventListener("click", async () => {
  if (status.ipa === "unavailable" && status.promptApi !== "unavailable") {
    const ok = window.confirm(
      status.promptApi === "downloadable" || status.promptApi === "downloading"
        ? "No inference extension found. Chrome can use an on-device model (a few GB download). Continue?"
        : "No inference extension found. Use Chrome’s on-device model on this device?"
    );
    if (!ok) return;
  }

  const { message } = await inference.complete({
    method: "chat",
    messages: [{ role: "user", content: input.value }],
  });
  reply.textContent = message.content ?? "";
});
```

Resolution happens lazily on the first `complete`, `request`, or `runTools` call (inside a user gesture). `LanguageModel.create()` is **not** called at module load, and `probe()` / `getPromptApiAvailability()` never start a download.

## Chrome requirements

- Chrome with the Prompt API available (see [Chrome AI docs](https://developer.chrome.com/docs/ai/prompt-api)).
- Hardware and storage for Gemini Nano (often several GB on first download).
- User activation for `LanguageModel.create()`.
- Disclose download size when `promptApi` is `"downloadable"` — Chrome will not warn for you.

To check raw Chrome availability without `createInference`:

```ts
import { getPromptApiAvailability } from "ipa-prompt-api-fallback";

const promptApi = await getPromptApiAvailability();
```

## Mapping caveats

| IPA | Prompt API adapter |
| --- | --- |
| `accepted` | Synthesized (not a permission prompt) |
| `delta` / `done` | From `promptStreaming()` (lossy) |
| `usage` | Omitted |
| `decide` / `transcribe` / `synthesize` | Unsupported (unadvertised; direct requests fail with `invalid_request`) |
| `tools` / `toolCalling` / `webSearch` | Unsupported (`getFeatures().toolCalling === false`; `webSearch` absent) |
| `imageInput` / `imageOutput` / `output.images` | Unsupported (`imageInput` / `imageOutput` absent; image parts and `output.images` fail with `invalid_request`) |
| `options` (`reasoningEffort` / `temperature`) | Unsupported (unadvertised; ignored) |
| Provider / model picker | None — `done.model` is `"on-device"` |

## API

| Export | Role |
| --- | --- |
| `createPromptApiBackend(options?)` | `InferenceBackend` with `id: "promptApi"` |
| `getPromptApiAvailability(options?)` | Chrome `LanguageModel.availability()` wrapper |
| `CreatePromptApiBackendOptions` | Optional `expectedInputs` / `expectedOutputs` (defaults to English text) |
| `PromptApiAvailability` | `"unavailable" \| "downloadable" \| "downloading" \| "available"` |

## Local development

From the repository root (npm workspaces):

```bash
npm ci
npm run build -w ipa-prompt-api-fallback
npm test -w ipa-prompt-api-fallback
```

Demo: [`examples/prompt-api-fallback`](../../examples/prompt-api-fallback) ([live](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/)).
