# IPA Demo Chat App

Minimal single-page chat app that consumes [`window.inference`](../../SPEC.md).

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/chat/](https://samsamskies.github.io/inference-provider-api/chat/)

1. Install [Inference Bridge](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) from the Chrome Web Store (or for development, [clone the repo](https://github.com/SamSamskies/inference-bridge) and load it unpacked from `chrome://extensions`)
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/chat/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Type a message and press **Enter** (or click the send button). **Shift+Enter** inserts a new line.

The composer is a single rounded input shell: message field on top, tool toggles and actions underneath. Toggle **Search** to include `tools: [{ type: "web_search" }]` when `getFeatures().webSearch` is true; the model may then use hosted web search if needed. With search on, the request also prepends a system message that includes the user's full local datetime and steers the model to search for current or time-sensitive questions. The toggle stays disabled when search is not advertised.

The extension prompts for permission on first use (and again when search is newly offered). The UI shows **Waiting…** until the `accepted` chunk (permission resolved), then **Generating…** until the first `delta` or `done`. If the provider streams reasoning, the status switches to **Thinking…** and a collapsible **Reasoning** block appears above the reply (optional — many models emit none). Streaming replies append as `delta` chunks; the final `done` chunk shows the model and optional usage.

Prior turns are kept in an in-memory `messages` array and sent with each request so follow-ups keep conversation context. Reasoning is shown in the UI when present but is not sent back on later turns. While a reply is streaming, the send control becomes **Stop** and aborts via `AbortSignal` (`aborted` error code). Reload the page to reset the conversation.
