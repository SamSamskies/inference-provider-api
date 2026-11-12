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

Open the [live inbox-triage demo](https://samsamskies.github.io/inference-provider-api/decisions/).
To run it locally from the repository root:

```bash
npx serve examples
```

Open the printed localhost URL followed by `/decisions/`. Use a top-level HTTPS
or loopback HTTP page, rather than a `file:` URL.

1. Install [Inference Bridge](https://github.com/SamSamskies/inference-bridge#installation)
   or another injector advertising `getFeatures().methods.decide === true`.
   In Bridge, configure a compatible provider/model in **Options → Decisions**.
   For Gemini, save your Google AI Studio key in **Options → Providers**, then
   select **Google Gemini** and **gemini-decision-1** in Decisions. Use a current
   development build for the recently merged Gemini and native image support;
   see [Bridge support](#inference-bridge-support) below.
   Capability discovery describes API support; the selected route still needs
   to be available. Provider setup and credentials stay in the extension.
2. Choose a fictional sample or edit the message, then click **Analyze message**.
   Approve Decisions for this site when prompted. A chat grant does not cover it.
3. Inspect the category probabilities, urgency score, and probability that a reply
   is needed. Expand **Request JSON** and **Result JSON** to inspect the contract.

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
judgments about the new text. The demo imposes no fixed payload-size maximum.
The extension must document and enforce conservative question-count and
payload-size limits, and the selected provider/model may impose smaller limits.
`methods.decide: true` does not guarantee capacity for a particular request size.
Limit failures appear as `invalid_request` with the implementation's explanation;
the demo does not automatically shorten the message or split the request.

The urgency score is a probability-weighted position from 0 (routine) to 2
(critical), and can be fractional. Choice and Score confidence summarize their
distributions; they do not guarantee correctness. Noul near 0.5 means uncertainty
about yes/no, not medium urgency.
Only provider-reported input/output token usage is displayed, when supplied.

The three questions are independent: no answer is used as another question's
input. See TypeSafe's
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
- A zero reply probability should
  display as 0%, not a refusal. Near 50% should remain a probability of yes.
- Try a per-question refusal and an all-refusal response with a test injector.
  Both complete successfully and display refused answers without fabricated
  numeric values.
- Cancel while waiting for approval and during analysis. Expect **Cancelled. No
  completed result.** and enabled controls. Deny permission or select an
  unavailable route: expect useful guidance and no stale result.
- Edit the message after success: old results and result JSON should clear.
  **Custom message — edit below** should be selectable and focus the message
  field without changing its text or results. Typing should select that option
  automatically; choosing a sample should still load its fictional message.
  Blank input should disable submission. Input above 63 KiB should remain
  submittable when decision support is advertised; use a test injector to verify
  both success and a route's `invalid_request` limit error, with its explanation
  visible and no stale result. Try a missing or malformed answer with a test
  injector: no partial success should be displayed.
- Check keyboard focus, narrow mobile layout, and the gallery's **Decisions** link.

## Native image demo

Open **Image inspection** from the inbox demo, or visit
[`/decisions/images.html`](https://samsamskies.github.io/inference-provider-api/decisions/images.html)
(locally, `/decisions/images.html`). No console setup is needed.

1. Use an injector advertising `methods.decide === true` and at least one
   `decisionMedia.imageMediaTypes` entry. The page explains missing support and
   checks again after delayed injection, page focus, or **Check again**.
   Current Bridge development builds advertise JPEG, PNG, and WebP; choose a
   compatible native image route such as Gemini's `gemini-decision-1`.
2. Choose a supported local image. The page shows a local preview, type, and
   readable size (B, kB, or MB); selecting a file does not send it to a provider.
3. Click **Inspect image**, approve decision-image access in your extension,
   and view the probability of visible damage. **Cancel** works while waiting
   for approval or inference. You can replace or clear the file to start over.

The separate page keeps image judgments distinct from inbox triage. The
[image request module](./inspect-image.mjs) calls
`window.inference.request({ method: "decide", state, attachments, questions, signal })`
with a shared native Blob attachment. Chat `imageInput` alone does not enable
file selection. Current text-only injectors continue to run the inbox demo.
Feature detection is still required for older installed builds and other injectors.

The injector validates actual bytes and its documented media limits. The UI
shows `invalid_request` details for malformed/oversized input and `unavailable`
guidance for an unsupported selected route, without stripping media or switching
to chat. Existing text Decisions and chat-image grants do not authorize these
attachments. Refusal is shown separately from a zero probability. Replacing or
clearing a file clears old results; cancellation ignores late responses.
Preview object URLs are released on replacement, clear, and page exit.

Use a test injector to check missing support, MIME-specific gating, successful
inspection at 0% and 100%, refusal, malformed output, permission denial,
size-limit errors, unsupported saved routes, cancellation before/after
`accepted`, late results, and file replacement. Inspect the request outline
and result JSON, test keyboard controls and narrow layouts, and confirm that
only the explicitly selected image reaches the approved native route.

## Inference Bridge support

[Bridge PR #136](https://github.com/SamSamskies/inference-bridge/pull/136) merged
Gemini decisions, native shared image attachments, separate MIME-scoped image
grants, approval-route filtering, snapshot-preserving encoding, cancellation,
and resource-limit enforcement. Use the [development installation instructions](https://github.com/SamSamskies/inference-bridge#installation)
for a build containing that change; a merge does not establish store availability.

| Decision provider | Maximum questions | Native image input |
| --- | --- | --- |
| Google Gemini (`gemini-decision-1`) | 1,000 | Yes |
| OpenAI (`gpt-6-luna`) | 400 | Yes |
| OpenRouter | 1,000 | Only models whose decision catalog advertises image input |
| PayPerQ | 1,000 | Unavailable |
| Ollama local / Cloud | 64 | Only models advertising both decision and vision support |
| Chrome On-device | 16 | Unavailable; Chrome only |

Bridge's overall resource cap is 1,000 questions and 1 MiB of UTF-8 JSON for
`{ state, questions }`, with smaller route-specific question and translated-body
limits. These are implementation policies, not IPA requirements. Gemini supports
all three primitives through its native decisions endpoint; audio, video, and
PDF attachments are outside IPA's decision-image envelope.

Bridge accepts up to four static JPEG, PNG, or WebP attachments, at most 20 MB
decoded per image and 32 MB decoded total. The complete encoded page request and
provider body must each fit within 48 MB. Smaller provider limits also apply,
including Ollama Cloud's 4 MiB and 16 megapixels per image. See Bridge's
[current limits and native image mappings](https://github.com/SamSamskies/inference-bridge#native-decision-images)
for all transport and route budgets. Oversized requests fail with
`invalid_request` and an explanation; images and state are not silently resized,
truncated, omitted, or split into multiple requests.

Image approval lists attachment metadata and remembers allowed MIME types for
the exact origin, provider, and model. Existing text-decision and chat-image
grants remain separate. A well-formed advertised image on an unsupported saved
route fails with `unavailable`.

The [media conformance checks](../../packages/ipa-tools/test/conformance/README.md#decision-media)
remain available for injector validation. Their synthetic fixtures check the
contract; live-provider behavior must be verified in the owning implementation.
