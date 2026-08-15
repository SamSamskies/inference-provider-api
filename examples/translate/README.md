# IPA Translate Demo

Short fabricated haiku with a language selector. Translates via [`ipa-tools`](../../packages/ipa-tools) `complete` on top of [`window.inference`](../../SPEC.md).

Chrome (title, controls, status) stays in English so the UI remains usable after translation. A haiku keeps token use and latency low — helpful for local models. The original stays visible beside the translation.

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/translate/](https://samsamskies.github.io/inference-provider-api/translate/)

1. Install [Inference Bridge](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) from the Chrome Web Store (or for development, [clone the repo](https://github.com/SamSamskies/inference-bridge) and load it unpacked from `chrome://extensions`)
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/translate/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Pick a language and click **Translate**

The extension prompts for permission on first use. **Clear** removes the translation card contents. **Stop** aborts via `AbortSignal` (`aborted` error code).
