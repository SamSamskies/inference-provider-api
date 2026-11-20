# IPA Demo Chat App

Minimal single-page chat app that consumes [`window.inference`](../../SPEC.md).

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/chat/](https://samsamskies.github.io/inference-provider-api/chat/)

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation) ([Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge))
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/chat/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Type a message and press **Enter** (or click the send button). **Shift+Enter** inserts a new line.

## Features

- **Streaming & reasoning:** Shows **Waiting…** until `accepted`, then **Generating…** until the first `delta` or `done`. If the provider streams `reasoning_delta`, the status switches to **Thinking…** and a collapsible **Reasoning** block appears above the reply (reasoning is not sent back on later turns). The final `done` chunk displays the model and optional token usage.
- **Hosted web search:** Toggle **Search** to include `tools: [{ type: "web_search" }]` when `getFeatures().webSearch` is true (with a system message containing the local datetime). Stays disabled when search is not advertised.
- **Image attachments:** Attach, paste, or drop images when `getFeatures().imageInput` is true. Stays disabled when image input is not advertised.
- **Conversation & cancellation:** Prior turns are kept in an in-memory `messages` array; reload the page to reset. While streaming, the send button becomes **Stop** and aborts via `AbortSignal` (`aborted` error code). The extension prompts for permission on first use (and again when search or image input is newly used).
