# Today in history — IPA + Prompt API fallback

One-button demo for [`ipa-prompt-api-fallback`](../../packages/ipa-prompt-api-fallback) with [`ipa-tools`](../../packages/ipa-tools) `createInference({ fallbacks })`.

**Live demo:** [https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/)

Click **Get today’s fact** to fetch a short historical fact for today’s date. IPA is tried first; Chrome’s on-device Prompt API is used only when no IPA injector is installed (not IPA when the fallback runs).

## Try it

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation) ([Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge)) — optional; without it, Chrome’s Prompt API can still run when available.
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/), or serve this folder locally:

   ```bash
   npx serve .
   ```

3. Click **Get today’s fact**

### Chrome Prompt API

- Requires a Chrome build where `LanguageModel` is available ([Chrome AI docs](https://developer.chrome.com/docs/ai/prompt-api)).
- Allowed on `localhost` and GitHub Pages when supported; you may need flags or a model download via `chrome://on-device-internals`.
- First download can be several GB — the page asks for confirmation before calling `create()` when status is `"downloadable"`.
- When running on the fallback path, `isInferenceAvailable()` remains `false`.

## Manual checklist

- [ ] IPA extension present → Bridge permission UI; Prompt API unused
- [ ] No extension, Prompt API `available` → fact generated on-device, no IPA prompt
- [ ] No extension, `downloadable` → confirmation mentions a few GB **before** `create()`; canceling skips download
- [ ] After confirm (or already `available`) → download progress if needed, then fact
- [ ] No extension, Prompt API `unavailable` → unavailable message shown
- [ ] Only triggers on button click (user gesture), never at module load
- [ ] `isInferenceAvailable()` remains `false` on the fallback path
