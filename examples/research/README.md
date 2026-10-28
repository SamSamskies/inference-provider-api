# Topic Explorer

A browser-native research agent built with `ipa-tools` **3.2.0** `createAgent()`.
It searches English Wikipedia, chooses and reads articles, and synthesizes an
answer with source markers. The activity timeline reflects actual tool execution.

No application-operated inference backend, application provider credentials, or
agent SDK is required. Inference Bridge routes inference to the user's cloud
provider or local model server and retains credentials. The public research API
needs no key. No changes to `window.inference` or `SPEC.md` are involved.

## Run

Serve the repository root, for example with `python3 -m http.server 8000`, then
open `http://localhost:8000/examples/research/` in a top-level tab. Or use the
[hosted demo](https://samsamskies.github.io/inference-provider-api/research/).
Install/configure [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation),
choose a model with reliable function tools, and allow the origin's tool requests.
HTTPS or localhost is required. `getFeatures().toolCalling === true` is checked
before any inference; the feature flag does not guarantee that the selected model
can fulfill tool requests. Setup, permission, provider, API and network errors are
shown on the page. The compact header matches the other demos, with a readiness
badge; the connection/setup panel appears only when needed. `isInferenceAvailable()`
and `getFeatures()` check readiness immediately; `waitForInference()` detects late
extension injection in the background. The setup panel also has a manual "Check
again" control, and readiness is checked when the page regains focus.

The script imports the helpers from the pinned `https://esm.sh/ipa-tools@3.2.0`
at the top, as in the Nostr demo. The module must load before the page's controls
initialize. Google Fonts is optional; system fonts are the fallback. The gallery
and Pages workflow include the demo.

## Reading the code

The entire demo is in `index.html`, like the other examples. Its script has two
sections:

- **Research:** `runResearch(question, options)` defines the agent with `name`,
  `instructions`, and `tools`, then calls `agent.run()`. It uses
  the default `window.inference` route from the package README. Wikipedia tools,
  cancellation, limits, and answer validation live here, without DOM updates.
- **View:** named functions render activity, sources, answers, and errors.
  `explore()` passes the question and view callbacks to `runResearch()`.
  Connection setup uses the discovery helpers above, and `isInferenceError()`
  identifies IPA errors for cancellation and provider-specific guidance.

## Research flow

1. `search_articles({ query })` uses the Action API search generator with
   `prop=info|extracts`, `inprop=url`, `exintro=1`, and `explaintext=1`.
   It returns up to five namespace-0 pages, original titles/canonical URLs and
   previews of up to 400 characters. Searches do not count as consulted evidence.
2. `read_article({ pageId })` accepts only a page ID already returned by search.
   It fetches `prop=info|extracts&explaintext=1`, keeps up to 12,000 characters,
   discloses truncation, and assigns a stable source marker such as `[S1]`.
   The model can search again for related topics or another perspective.
3. The final answer is published only on `end_turn` after at least one article
   was read. Search and read require separate tool steps. Capped, failed, empty,
   or source-free runs have no completed answer. Retrieved sources remain visible.

The instructions treat tool results as untrusted data and require source markers.
Only markers for actually read sources become clickable, with URLs supplied by the
API, validated to be HTTPS English Wikipedia articles. Model-supplied HTML is text;
Markdown link targets and raw model URLs are removed. Unknown source markers are
marked unavailable. Sources consulted is built independently of the model answer.
These checks verify retrieval and link provenance, **not factual support for every
claim**. An answer without valid inline citations is explicitly labeled. Summaries
can still be incorrect; inspect the articles and their underlying references.

## API and CORS assumptions

Both tools use GET `https://en.wikipedia.org/w/api.php` with `format=json`,
`formatversion=2`, `origin=*`, `credentials: "omit"` and `mode: "cors"`.
No cookies or authentication are sent. The search generator batches metadata and
previews in a single request. Calls execute serially, and repeated searches/reads
are cached only within the run. Search content goes directly to Wikipedia;
questions and retrieved excerpts go to the selected inference provider.

On October 28, 2026, live search and full-text read requests succeeded without
authentication; the search response advertised `Access-Control-Allow-Origin: *`
and `Access-Control-Allow-Credentials: false`. Deployments and user networks may
still block these requests. The UI reports failures instead of using a proxy.

See the official [CORS guidance](https://www.mediawiki.org/wiki/API:Cross-site_requests),
[search generator](https://www.mediawiki.org/wiki/API:Search),
[TextExtracts API](https://www.mediawiki.org/wiki/Extension:TextExtracts#API),
[API etiquette](https://www.mediawiki.org/wiki/API:Etiquette), and
[Wikimedia API rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits).
Limits can vary by client and infrastructure. The demo stops on HTTP 429/503 or
API `ratelimited`/`maxlag` errors, displays available `Retry-After` guidance, and
never automatically retries or hammers a busy API.

## Bounds and cancellation

The `LIMITS` constant in `index.html` centralizes the application limits:

| Limit | Value |
| --- | --- |
| Question | 1,000 characters |
| Model rounds | 8 |
| Tool calls (including cache hits) | 10 |
| Search results | 5 per query |
| Search preview / article excerpt | 400 / 12,000 characters |
| Download size | 512,000 bytes per response, checked while streaming |
| Serialized tool result | 20,000 UTF-16 code units, enforced by `ipa-tools` |
| Combined streamed text/reasoning; final answer | 24,000 characters each |
| Network request, including response body | 15 seconds |
| Research run | 2 minutes |

Stop aborts the run, model request and fetches. The UI also releases on cancellation
or deadlines if an external implementation ignores abort; late events are ignored.
The extension/provider must cooperate to stop any inference already executing.
No reasoning text is exposed in the UI. `max_rounds` never masquerades as a final
prose answer. Tool argument validation rejects unknown fields and unsearched page
IDs before tool execution; both tools are read-only and need no app-side write approval.

Wikipedia is an encyclopedia, with incomplete and potentially dated coverage.
This is not an unrestricted crawler or real-time web index. Hosted IPA
`{ type: "web_search" }` is an optional extension for future demos, **not enabled or
required here**; it would require `getFeatures().webSearch` and a compatible model.
Wikipedia text attribution and the CC BY-SA 4.0 license are shown with the sources.

## Verification

Run `npm test` from the repository root. The deterministic research integration
tests in `packages/ipa-tools/test/research-demo.test.ts` load the inline script
before its page event setup and use the real `createAgent` loop with mocked IPA
streams and Wikimedia responses. They cover multi-step
research, source provenance, empty results, validation, feature gating, failures,
rate limits, truncation, byte/tool/round/output bounds, timeouts and cancellation.
No provider calls or secrets are needed for these tests.
