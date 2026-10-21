# IPA Decisions Demo

A single-page inbox-triage app using the optional
[`decide` method](../../SPEC.md#typed-decisions-system-one). One request evaluates
three independent questions against the same message:

| Question | Primitive | Display |
| --- | --- | --- |
| Which team should handle it? | `choice` | Category, probability distribution, and confidence |
| How urgent is it? | `score` | Fractional position on a three-level urgency scale, and confidence |
| Does it ask for a reply? | `noul` | Probability of yes; no separate confidence value |

## Try it

The app will be available at `/decisions/` on the
[examples site](https://samsamskies.github.io/inference-provider-api/) after deployment.
To run the branch locally from the repository root:

```bash
npx serve examples
```

Open the printed localhost URL followed by `/decisions/`. Use a top-level HTTPS
or loopback HTTP page, rather than a `file:` URL.

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation)
   or another injector advertising `getFeatures().methods.decide === true`.
   In Bridge, configure a compatible provider/model in **Options → Decisions**.
   Capability discovery describes API support; the selected route still needs
   to be available. Provider setup and credentials stay in the extension.
2. Choose a fictional sample or edit the message, then click **Analyze message**.
   Approve Decisions for this site when prompted. A chat grant does not cover it.
3. Inspect the category probabilities, urgency score, and probability that a reply
   is needed. Expand **Request JSON** and **Result JSON** to inspect the contract.
4. Move **Review threshold**. The app flags category or urgency confidence below
   the threshold, plus any refused question. This recomputes the review flag from
   the existing answers without another model call.

The demo only labels the message; it does not send replies or route real tickets.
Messages and questions go to the provider approved in the extension. There is no
app-held API key, provider SDK, chat emulation, or build step.

## How it works

The app feature-detects stable decision support and calls
`window.inference.request({ method: "decide", state, questions, signal })`.
The request preview omits the `AbortSignal`, which is a local cancellation handle.
Decisions yield exactly `accepted`, then `done`; there are no text or partial-answer
deltas. The UI shows **Waiting for approval…**, then **Analyzing message…**, and
renders results only when the request completes. **Cancel** aborts during approval
or provider work. A partial or malformed stream produces no completed result.

Every answer is checked for `type: "refusal"` before reading its values. One
refusal leaves other answers usable; all refusals are still a completed request.
A refusal is distinct from a zero probability, missing answer, or permission denial.
Editing the message clears the previous results so they cannot be mistaken for
judgments about the new text. Oversized requests are disabled using the spec's
63 KiB UTF-8 limit for `JSON.stringify({ state, questions })`.

The urgency score is a probability-weighted position from 0 (routine) to 2
(critical), and can be fractional. Choice and Score confidence summarize their
distributions; they do not guarantee correctness. Noul near 0.5 means uncertainty
about yes/no, not medium urgency. The demo's initial 60% review threshold is an
illustration to adjust and evaluate, not a validated policy. The reply probability
is displayed separately and is not part of the confidence-threshold rule.
Only provider-reported input/output token usage is displayed, when supplied.

The three questions are independent: no answer is used as another question's
input. Code owns the review rule. See TypeSafe's
[primitives](https://docs.typesafe.ai/primitives) and
[confidence guidance](https://docs.typesafe.ai/confidence) for the programming model.

## Browser smoke test

- Without an injector, or with a chat-only injector, **Analyze message** stays
  disabled and connection guidance appears. Delayed injection is detected;
  **Check again** and returning focus to the page also refresh support. An
  experimental-only decision namespace does not enable the stable demo.
- With decision support, analyze a sample and approve it. Expect `accepted` →
  `done`, all three answers, the returned model, and only reported usage. Inspect
  the request: no page-selected provider/model or generation options are sent.
  Sample labels suggest scenarios rather than asserting expected model outputs.
- Move the review threshold above and below a returned confidence. The review
  flag should change without another request. A zero reply probability should
  display as 0%, not a refusal. Near 50% should remain a probability of yes.
- Try a per-question refusal and an all-refusal response with a test injector.
  Both complete successfully, display refused answers without fabricated numeric
  values, and require review at every threshold.
- Cancel while waiting for approval and during analysis. Expect **Cancelled. No
  completed result.** and enabled controls. Deny permission or select an
  unavailable route: expect useful guidance and no stale result.
- Edit the message after success: old results and result JSON should clear.
  Blank or oversized UTF-8 input should disable submission. Try a missing or
  malformed answer with a test injector: no partial success should be displayed.
- Check keyboard focus, narrow mobile layout, and the gallery's **Decisions** link.
