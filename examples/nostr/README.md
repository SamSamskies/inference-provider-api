# IPA Nostr Feed Demo

A sample feed of real Nostr notes.

Filtering uses **Inference Bridge experimental tool calling** through [`ipa-tools`](https://www.npmjs.com/package/ipa-tools) `runTools`. Stable `window.inference.request` still rejects `tools` until `getFeatures().toolCalling` is true, so this demo passes `window.inference.experimental.request` into `runTools`. That experimental surface is Inference Bridge–specific and will go away once tools graduate onto IPA `request`.

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/nostr/](https://samsamskies.github.io/inference-provider-api/nostr/)

1. Install [Inference Bridge](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) from the Chrome Web Store (or for development, [clone the repo](https://github.com/SamSamskies/inference-bridge) and load it unpacked from `chrome://extensions`)
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/nostr/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Type a query (or click a sample chip) and click **Filter**

The first IPA request includes the query plus a compact JSON copy of the snapshot (numbered notes with names, truncated content, tags), so that payload shows up in Inference Bridge’s request preview. The model then calls the page-executed `show_notes` tool with matching note numbers. `maxRounds: 1` applies that filter and skips a follow-up `request` for a prose reply.

The extension prompts for permission (including the `show_notes` tool name) on first use. The **X** in the search field restores the full snapshot. The **stop** icon appears in the field while a request is running and aborts via `AbortSignal` (`aborted` error code).
