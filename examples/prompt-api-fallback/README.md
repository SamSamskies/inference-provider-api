# Today in history — IPA + Prompt API fallback POC

One-button local POC for [`ipa-prompt-api-fallback`](../../packages/ipa-prompt-api-fallback) with [`ipa-tools`](../../packages/ipa-tools) `createInference({ fallbacks })`.

Click **Get today’s fact** → a short historical fact for today’s month/day. IPA is tried first; Chrome Prompt API is the optional fallback.

## Setup

From the repo root:

```bash
npm install
npm run build
npx serve .
```

Open `http://localhost:3000/examples/prompt-api-fallback/` (port may vary).

### Chrome Prompt API

1. Use a Chrome build where `LanguageModel` is available ([docs](https://developer.chrome.com/docs/ai/prompt-api)).
2. On localhost the API is allowed; you may still need flags / model download via `chrome://on-device-internals`.
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
