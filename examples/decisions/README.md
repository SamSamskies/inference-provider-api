# IPA Decisions Demo

A single-page inbox-triage app using the optional [`decide` method](../../SPEC.md#typed-decisions-system-one). One request evaluates three independent questions against the same message:

| Question | Primitive | Display |
| --- | --- | --- |
| Which team should handle it? | `choice` | Category, probability distribution, and confidence |
| How urgent is it? | `score` | Fractional position on a three-level urgency scale (0–2), and confidence |
| Does it ask for a reply? | `noul` | Probability of yes (no separate confidence value) |

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/decisions/](https://samsamskies.github.io/inference-provider-api/decisions/)

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation) ([Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge)) — see Bridge’s [decisions guide](https://github.com/SamSamskies/inference-bridge#typed-decisions-system-one) for provider setup — or another injector advertising `getFeatures().methods.decide === true`.
2. Open the live demo, or serve the examples locally from the repository root over HTTPS or `localhost` (not `file:`):

   ```bash
   npx serve examples
   ```

   Then open the printed URL followed by `/decisions/`.
3. Pick a sample or edit the message, click **Analyze message**, and approve Decisions for this origin (a chat grant does not cover it).
4. Inspect the probabilities and expand **Request JSON** / **Result JSON** to view the wire contract.

## How it works

The page checks `window.inference?.getFeatures?.().methods?.decide === true` and calls:

```js
for await (const chunk of window.inference.request({
  method: "decide",
  state,
  questions,
  signal,
})) {
  if (chunk.type === "accepted") { /* permission resolved */ }
  if (chunk.type === "done") { /* chunk.answers */ }
}
```

- **Stream lifecycle:** Decisions yield `accepted` then `done` with no partial deltas. **Cancel** aborts during approval or inference; partial or malformed streams render no result.
- **Refusals:** Every answer is checked for `type: "refusal"` before reading values. A refusal is distinct from a `0%` probability, missing answer, or permission denial, and leaves other answers usable.
- **Independent questions & scores:** The three questions do not feed into one another. The urgency `score` is a probability-weighted position from `0` (routine) to `2` (critical). `noul` near `0.5` means uncertainty about yes/no, not medium urgency. See TypeSafe’s [primitives](https://docs.typesafe.ai/primitives) and [confidence guidance](https://docs.typesafe.ai/confidence).
- **Limits:** Payload-size and question-count limits are enforced by the injector and selected provider/model; exceeding them surfaces `invalid_request` without silently truncating or splitting.
- **Fresh state:** Editing the message clears previous results so stale judgments are never shown for new text. Only provider-reported token usage is displayed when present.

## Native image demo

Open **Image inspection** from the inbox demo, or visit [`/decisions/images.html`](https://samsamskies.github.io/inference-provider-api/decisions/images.html).

1. Requires an injector advertising `methods.decide === true` and at least one `decisionMedia.imageMediaTypes` entry (chat `imageInput` alone does not enable it).
2. Choose a supported local image to preview its type and size locally — selecting a file does not send it to a provider.
3. Click **Inspect image**, approve decision-image access in your extension (separate from text Decisions and chat-image grants), and view the probability of visible damage.

[`inspect-image.mjs`](./inspect-image.mjs) calls `window.inference.request({ method: "decide", state, attachments, questions, signal })` with a shared native `Blob` attachment. The injector validates bytes and media limits (`invalid_request` for malformed/oversized input; `unavailable` if the selected route does not support the advertised type). Replacing or clearing a file clears old results and releases preview object URLs.

## Browser smoke test

- **Feature gating:** Without an injector (or with a chat-only injector), **Analyze message** stays disabled; delayed injection, **Check again**, and window focus refresh support. On `images.html`, chat `imageInput` alone does not enable file selection.
- **Success & edge values:** Verify `accepted` → `done`, all three answers, model label, and reported usage. Confirm `0%` renders as `0%` (not a refusal), and test per-question and all-refusal responses with a test injector.
- **Errors & cancellation:** Cancel during approval and during inference; deny permission; test an unavailable route, malformed output, and an oversized input (`invalid_request` with explanation and no stale result).
- **Editing & cleanup:** Editing the message or replacing/clearing an image clears prior results; blank input disables submission.
