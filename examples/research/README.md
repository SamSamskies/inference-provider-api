# Topic Explorer

A browser-native research agent built with [`ipa-tools`](../../packages/ipa-tools) `createAgent()`. It searches English Wikipedia, reads relevant articles, and synthesizes an answer with clickable source markers and a live activity timeline.

No application backend, API key, or agent SDK is needed — Inference Bridge routes inference to the user's chosen provider or local model, and the Wikipedia API requires no key.

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/research/](https://samsamskies.github.io/inference-provider-api/research/)

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation) ([Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge)) and select a model with reliable function-tool calling.
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/research/), or serve the examples locally from the repository root over HTTPS or `localhost`:

   ```bash
   npx serve examples
   ```

   Then open the printed URL followed by `/research/`.
3. Ask a question and approve tool requests for this origin when prompted.

The page checks `isInferenceAvailable()` and `getFeatures().toolCalling === true` on load, listens for delayed injection via `waitForInference()`, and rechecks on page focus or **Check again**.

## How it works

1. **`search_articles({ query })`** queries Wikipedia's Action API search generator (`prop=info|extracts`, `inprop=url`, `exintro=1`, `explaintext=1`), returning up to 5 namespace-0 pages with canonical URLs and 400-character previews. Searches do not count as consulted evidence.
2. **`read_article({ pageId })`** accepts only a `pageId` returned by a prior search in the same run, fetches plain-text extracts up to 12,000 characters (disclosing truncation), and assigns a stable source marker (`[S1]`, `[S2]`, …).
3. **Final answer** is published only on `end_turn` after at least one article was read. Capped (`max_rounds`), failed, empty, or source-free runs do not publish a final answer, though retrieved sources remain visible.

### Source provenance & safety

- Tool results are treated as untrusted data. Only markers for articles actually read become clickable, using API-supplied HTTPS English Wikipedia URLs.
- Model-supplied HTML is rendered as plain text, and raw model URLs / Markdown links are stripped. Unknown markers are labeled unavailable.
- The **Sources consulted** list is built independently of the model's answer, with Wikipedia CC BY-SA 4.0 attribution.
- These checks verify retrieval and link provenance — **not factual accuracy for every claim**. Answers without valid inline citations are labeled accordingly.

## Code structure

Everything lives in [`index.html`](./index.html) in two sections:

- **Research:** `runResearch(question, options)` defines the agent (`name`, `instructions`, `tools`), Wikipedia fetchers, argument validation, limits, and answer validation — independent of the DOM.
- **View:** Renders the live activity timeline, sources, answer, and error states. `explore()` connects the form and callbacks to `runResearch()`.

## Wikipedia API & CORS

Both tools issue anonymous `GET` requests to `https://en.wikipedia.org/w/api.php` with `format=json`, `formatversion=2`, `origin=*`, `credentials: "omit"`, and `mode: "cors"`. Calls run serially and are cached within a single run. Search queries go to Wikipedia; questions and retrieved excerpts go to the user's selected inference provider.

On HTTP `429`/`503` or API `ratelimited`/`maxlag` responses, the demo stops immediately, surfaces any `Retry-After` hint, and never auto-retries. See Wikimedia's [CORS guidance](https://www.mediawiki.org/wiki/API:Cross-site_requests), [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette), and [rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits).

## Bounds and cancellation

Limits are centralized in `LIMITS` in [`index.html`](./index.html):

| Limit | Value |
| --- | --- |
| Question | 1,000 characters |
| Model rounds | 8 |
| Tool calls (including cache hits) | 10 |
| Search results | 5 per query |
| Search preview / article excerpt | 400 / 12,000 characters |
| Download size | 512,000 bytes per response (checked while streaming) |
| Serialized tool result | 20,000 UTF-16 code units (enforced by `ipa-tools`) |
| Streamed text/reasoning; final answer | 24,000 characters each |
| Network request (including body) | 15 seconds |
| Total research run | 2 minutes |

- **Stop** aborts the agent run, active inference request, and in-flight fetches; late events are ignored.
- Tool argument validation rejects unknown fields and unsearched `pageId` values before execution; both tools are read-only and do not require app-side write approval.
- Hosted IPA `{ type: "web_search" }` is not used here.

## Verification

Run `npm test` from the repository root. [`packages/ipa-tools/test/research-demo.test.ts`](../../packages/ipa-tools/test/research-demo.test.ts) runs deterministic integration tests against the inline script in `index.html` using the real `createAgent` loop with mocked IPA streams and Wikimedia responses (no provider calls or secrets required).
