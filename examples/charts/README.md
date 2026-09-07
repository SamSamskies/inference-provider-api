# IPA Charts Demo

Ask for a chart in plain language. The model calls a page-executed `render_chart` tool; the page draws bar, line, or pie charts from a fixed sales snapshot.

Uses [`ipa-tools`](https://www.npmjs.com/package/ipa-tools) `runTools` on stable IPA `request` when `getFeatures().toolCalling` is true.

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/charts/](https://samsamskies.github.io/inference-provider-api/charts/)

1. Install [Inference Bridge](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) from the Chrome Web Store (or for development, [clone the repo](https://github.com/SamSamskies/inference-bridge) and load it unpacked from `chrome://extensions`)
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/charts/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Type a request (or click a sample chip) and click **Chart**

The first IPA request includes the query plus a compact JSON copy of the dataset (column keys and rows), so that payload shows up in Inference Bridge’s request preview. The model then calls the page-executed `render_chart` tool with a chart type, title, category column, and numeric series. `maxRounds: 1` draws the chart and skips a follow-up `request` for a prose reply.

The extension prompts for permission (including the `render_chart` tool name) on first use. The **X** in the search field clears the chart. The **stop** icon appears in the field while a request is running and aborts via `AbortSignal` (`aborted` error code).
