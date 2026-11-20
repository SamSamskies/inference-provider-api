# IPA Social Demo

Read-only social post + replies demo with a Grok-like **Ask AI** side panel that uses [`window.inference`](../../SPEC.md).

The thread in [`data.json`](./data.json) is **fabricated illustration data** for the demo — not live posts from any network. No posting, reacting, or other write actions. Portrait images in [`avatars/`](./avatars/) are sample photos from [randomuser.me](https://randomuser.me/).

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/social/](https://samsamskies.github.io/inference-provider-api/social/)

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation) ([Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge))
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/social/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Click **Ask AI** on the post

The panel requests a streaming summary of the post and replies via IPA, then keeps conversation history so you can ask follow-ups. Use **Clear** to reset (and re-summarize). Use **Stop** to abort via `AbortSignal` (`aborted` error code).

The extension prompts for permission on first use. The UI shows **Waiting…** until the `accepted` chunk, then **Generating…** until the first `delta` or `done`.
