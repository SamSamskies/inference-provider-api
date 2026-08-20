# Today in history — IPA + Prompt API fallback

One-button demo for [`ipa-prompt-api-fallback`](https://www.npmjs.com/package/ipa-prompt-api-fallback) with [`ipa-tools`](https://www.npmjs.com/package/ipa-tools) `createInference({ fallbacks })`.

**Live demo:** [https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/)

Click **Get today’s fact** → a short historical fact for today’s month/day. IPA is tried first; Chrome Prompt API is the optional fallback (not IPA when the fallback runs).

## Try it

1. Install [Inference Bridge](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) (optional — without it, Chrome Prompt API can still run when available).
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/), or serve this folder locally:

   ```bash
   npx serve .
   ```

3. Click **Get today’s fact**

### Chrome Prompt API

1. Use a Chrome build where `LanguageModel` is available ([docs](https://developer.chrome.com/docs/ai/prompt-api)).
2. On localhost / GitHub Pages the API is allowed when the browser supports it; you may still need flags / model download via `chrome://on-device-internals`.
3. First download can be several GB — the page asks before `create()` when status is `downloadable`.

### Inference Bridge

With the extension installed, IPA wins. Without it, Prompt API runs when available; `isInferenceAvailable()` stays **false**.

## Flows to verify

- [ ] IPA extension present → Bridge permission UI; Prompt API unused
- [ ] No extension, Prompt API `available` → fact on-device, no IPA prompt
- [ ] No extension, `downloadable` → confirm mentions a few GB **before** `create()`; cancel skips download
- [ ] After confirm (or already `available`) → progress if needed, then fact
- [ ] No extension, Prompt API `unavailable` → unavailable messaging
- [ ] User gesture: button click (not module load)
- [ ] `isInferenceAvailable()` still false on the fallback path (check in DevTools if needed)

Related: [#20](https://github.com/SamSamskies/inference-provider-api/issues/20).
