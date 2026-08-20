# ipa-prompt-api-fallback

Chrome [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) (`LanguageModel`) compatibility backend for [`ipa-tools`](../ipa-tools) `createInference({ fallbacks })`.

**This is not IPA.** There is no origin permission prompt, no user-chosen provider/model, and no `permission_denied` from the browser. Do **not** assign the adapter to `window.inference`. `isInferenceAvailable()` / `getInference()` / `waitForInference()` stay false/throwing on the fallback path.

**Status:** `0.x` while IPA is an Experimental Draft ([#20](https://github.com/SamSamskies/inference-provider-api/issues/20)).

## Install

```bash
npm install ipa-tools ipa-prompt-api-fallback
```

[![npm](https://img.shields.io/npm/v/ipa-prompt-api-fallback)](https://www.npmjs.com/package/ipa-prompt-api-fallback)

Peer dependency: `ipa-tools` `>=0.3.0`. Zero other runtime deps. Browser ESM only.

`ipa-tools` does **not** import this package. Your app imports both and passes the backend object into `fallbacks`.

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
    const ok = await confirm(
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

Resolve happens lazily on first `complete` / `request` / `runTools` (inside a user gesture). `LanguageModel.create()` is **not** called at module load. `probe()` / `getPromptApiAvailability()` never start the download.

## Chrome requirements

- Chrome with the Prompt API available (see [Chrome AI docs](https://developer.chrome.com/docs/ai/prompt-api)).
- Hardware / storage requirements for Gemini Nano (often several GB on first download).
- User activation for `LanguageModel.create()`.
- Disclose download size when `promptApi` is `"downloadable"` — Chrome will not warn for you.

Raw availability (Chrome-specific) without going through `createInference`:

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
| `tools` / `toolCalling` | Unsupported (`getFeatures().toolCalling === false`) |
| Provider / model picker | None — `done.model` is `"on-device"` |

## API

| Export | Role |
| --- | --- |
| `createPromptApiBackend()` | `InferenceBackend` with `id: "promptApi"` |
| `getPromptApiAvailability()` | Chrome `LanguageModel.availability()` wrapper |
| `CreatePromptApiBackendOptions` | Optional expected input/output languages |
| `PromptApiAvailability` | `"unavailable" \| "downloadable" \| "downloading" \| "available"` |

## Local development

From the repo root (npm workspaces):

```bash
npm install
npm run build -w ipa-prompt-api-fallback
npm test -w ipa-prompt-api-fallback
```

POC: [`examples/prompt-api-fallback`](../../examples/prompt-api-fallback) (also on [GitHub Pages](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/)).
