# IPA Demo Web App

Minimal single-page chat app that consumes [`window.inference`](../../SPEC.md).

## Try it

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge) (load unpacked from that repository until the Chrome Web Store listing is live)
2. Serve this folder over a secure context, e.g.:

   ```bash
   npx serve .
   ```

3. Open the URL (typically `http://localhost:3000`)
4. Type a message and click **Send**

The extension prompts for permission on first use. Streaming replies append as `delta` chunks; the final `done` chunk shows the model and optional usage.

Use **Stop** to abort via `AbortSignal` (`aborted` error code).
