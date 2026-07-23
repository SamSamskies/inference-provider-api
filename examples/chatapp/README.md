# IPA Demo Chat App

Minimal single-page chat app that consumes [`window.inference`](../../SPEC.md).

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/](https://samsamskies.github.io/inference-provider-api/)

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge): clone the repo, then in `chrome://extensions` enable Developer mode → Load unpacked → select the repo root (until a Chrome Web Store listing is available)
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Type a message and click **Send**

The extension prompts for permission on first use. The UI shows **Waiting…** until the `accepted` chunk (permission resolved), then **Generating…** until the first `delta` or `done`. Streaming replies append as `delta` chunks; the final `done` chunk shows the model and optional usage.

Use **Stop** to abort via `AbortSignal` (`aborted` error code).
