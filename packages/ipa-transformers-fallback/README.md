# ipa-transformers-fallback

**Parked.** Not a good default IPA fallback today: ~800 MB **per origin**, WASM/CPU is far slower than Prompt API / Nano, and the cache does not follow the user across sites. Revisit if a much smaller model ships or consumer WebGPU is fast enough everywhere. Branch: `feat/ipa-transformers-fallback` ([#37](https://github.com/SamSamskies/inference-provider-api/issues/37)).

[Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js) compatibility backend for [`ipa-tools`](../ipa-tools) `createInference({ fallbacks })`.

**This is not IPA.** There is no origin permission prompt, no user-chosen provider/model, and no `permission_denied` from the browser. Do **not** assign the adapter to `window.inference`. `isInferenceAvailable()` / `getInference()` / `waitForInference()` stay false/throwing on the fallback path.

`0.x` while IPA is Experimental Draft. Not published yet — use the workspace package.

## Install

```bash
npm install ipa-tools ipa-transformers-fallback @huggingface/transformers
```

Peer dependencies: `ipa-tools` `>=0.3.0`, optional `@huggingface/transformers` `>=4.1.0` (needed unless you inject `loadTransformers`). Browser ESM only.

`ipa-tools` does **not** import this package. Your app imports both and passes the backend object into `fallbacks`.

## Usage

```ts
import { createInference } from "ipa-tools";
import { createPromptApiBackend } from "ipa-prompt-api-fallback";
import {
  createTransformersBackend,
  DEFAULT_MODEL_SIZE_HINT,
  DEFAULT_TRANSFORMERS_MODEL,
} from "ipa-transformers-fallback";

const inference = createInference({
  fallbacks: [
    createPromptApiBackend(),
    createTransformersBackend(),
  ],
  onDownloadProgress(loaded) {
    status.textContent = `Downloading model… ${Math.round(loaded * 100)}%`;
  },
});

const status = await inference.probe();
// { ipa: "unavailable", promptApi: "downloadable", transformers: "downloadable" }

sendButton.addEventListener("click", async () => {
  if (status.ipa === "unavailable") {
    const promptApi = status.promptApi;
    const transformers = status.transformers;
    const anyFallback =
      (promptApi != null && promptApi !== "unavailable") ||
      (transformers != null && transformers !== "unavailable");
    if (!anyFallback) return;

    const transformersDl =
      transformers === "downloadable" || transformers === "downloading";
    const ok = await confirm(
      transformersDl
        ? `No inference extension found. Chrome’s Prompt API is tried first; otherwise this page can run ${DEFAULT_TRANSFORMERS_MODEL} (${DEFAULT_MODEL_SIZE_HINT} first download). Continue?`
        : "No inference extension found. Use Chrome’s on-device model, or an in-browser model already on this device?"
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

Resolve happens lazily on first `complete` / `request` / `runTools` (inside a user gesture). `pipeline()` is **not** called at module load. `probe()` / `getTransformersAvailability()` never start the weight download.

`ipa-tools` `MAX_FALLBACKS` is 2, so Prompt API can sit in front of Transformers.js. Disclose every download that might run before `create()`. The resolver skips `"unavailable"` entries and walks to the next if `create()` fails.

## Default model

| Option | Default |
| --- | --- |
| `model` | `onnx-community/Qwen2.5-0.5B-Instruct` |
| `dtype` | `q4` |
| First download | **about 800 MB** (q4 ONNX + tokenizer) |

Override with `createTransformersBackend({ model, dtype, device })`. Disclose size when probe is `"downloadable"` — the library will not warn for you.

`probe()` is `"available"` when Transformers.js `ModelRegistry.is_pipeline_cached` reports a full cache hit, `"downloadable"` when WebAssembly works but weights are not cached, `"downloading"` while that backend’s `create()` is in flight, and `"unavailable"` when WASM is missing or the library fails to load.

## Mapping caveats

| IPA | Transformers.js adapter |
| --- | --- |
| `accepted` | Synthesized (not a permission prompt) |
| `delta` / `done` | From `TextStreamer` (or one-shot `generated_text` if no streamer) |
| `usage` | Omitted |
| `tools` / `toolCalling` | Unsupported (`getFeatures().toolCalling === false`) |
| `options.temperature` | Forwarded (`do_sample` when `> 0`) |
| `options.reasoningEffort` | Ignored |
| Provider / model picker | None — `done.model` is the Hugging Face model id |
| Abort mid-generate | Stops yielding; underlying WASM work may continue briefly |

## API

| Export | Role |
| --- | --- |
| `createTransformersBackend()` | `InferenceBackend` with `id: "transformers"` |
| `getTransformersAvailability()` | Cache/WASM probe; never calls `pipeline()` |
| `CreateTransformersBackendOptions` | `model`, `dtype`, `device`, `maxNewTokens`, `loadTransformers` |
| `DEFAULT_TRANSFORMERS_MODEL` / `DEFAULT_MODEL_SIZE_HINT` | Default id and size disclosure |

Inject `loadTransformers` in tests (and in pages that import Transformers.js from a CDN) so this package does not have to resolve `@huggingface/transformers` at build time.

## Local development

From the repo root (npm workspaces):

```bash
npm install
npm run build
npm test -w ipa-transformers-fallback
```

POC: [`examples/transformers-fallback`](../../examples/transformers-fallback). Serve the **repo root** so the import map can reach `packages/*/dist`:

```bash
npx serve .
```

Then open `/examples/transformers-fallback/`. CDN + GitHub Pages will follow a later publish, same as Prompt API.
