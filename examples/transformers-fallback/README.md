# Today in history — IPA + Prompt API + Transformers.js

**Parked** with [`ipa-transformers-fallback`](../../packages/ipa-transformers-fallback) — per-origin download and WASM speed make this a poor default fallback. See [#37](https://github.com/SamSamskies/inference-provider-api/issues/37).

Local POC for [`ipa-transformers-fallback`](../../packages/ipa-transformers-fallback) with [`ipa-tools`](../../packages/ipa-tools) `createInference({ fallbacks })` (`MAX_FALLBACKS` is 2).

Click **Get today’s fact** → a short historical fact for today’s month/day.

1. **IPA** if Inference Bridge is installed
2. Else **Chrome Prompt API** (`ipa-prompt-api-fallback`)
3. Else **Transformers.js** in the page (`ipa-transformers-fallback`)

Fallbacks are not IPA. The page asks before any fallback download.

CDN + GitHub Pages will come after a `0.x` publish, same sequence as the Prompt API-only demo.

## Setup

From the repo root:

```bash
npm install
npm run build
npx serve .
```

Open `http://localhost:3000/examples/transformers-fallback/` (port may vary).

ONNX weights download only if Transformers.js `create()` runs. `probe()` may fetch the Transformers.js library (not the model) to check the origin cache. Prompt API does not load Hugging Face code.

### Inference Bridge

With the extension installed, IPA wins. `isInferenceAvailable()` stays **false** on fallback paths.

### Chrome Prompt API

1. Chrome with `LanguageModel` ([docs](https://developer.chrome.com/docs/ai/prompt-api)).
2. First download can be several GB — the confirm dialog says so when `promptApi` is `downloadable`.

### Transformers.js

1. A browser with WebAssembly.
2. First run of this backend downloads **about 800 MB** (`onnx-community/Qwen2.5-0.5B-Instruct`, q4).
3. Later visits can show `transformers: "available"` once the model is in the origin cache.

## Flows to verify

- [ ] IPA extension present → Bridge permission UI; Prompt API and Transformers.js unused
- [ ] No extension, Prompt API `available` → fact on-device; Transformers.js `pipeline()` not started
- [ ] No extension, Prompt API `downloadable` → confirm mentions a few GB **and** that Transformers.js (~800 MB) may run if Chrome’s model is not used; cancel skips both
- [ ] No extension, Prompt API `unavailable`, Transformers.js `downloadable` → confirm mentions ~800 MB **before** `create()`
- [ ] No extension, Prompt API `unavailable`, Transformers.js `available` (cached) → fact in-page, **no** confirm (download already happened)
- [ ] Prompt API `create()` fails → resolver walks to Transformers.js (same consent covers that failover)
- [ ] Stop during generate → `aborted`
- [ ] User gesture: button click (not module load)
- [ ] `isInferenceAvailable()` still false on a fallback path (check in DevTools if needed)

Related: [#37](https://github.com/SamSamskies/inference-provider-api/issues/37).
