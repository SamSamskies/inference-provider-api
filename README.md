# Inference Provider API (IPA)

> A proposed browser standard for provider-agnostic AI inference.

**Status:** Experimental Draft

**Spec:** [SPEC.md](./SPEC.md)

## Try It

### Build an app with a coding agent

Install the [build-with-ipa skill](./skills/build-with-ipa/SKILL.md) in your app project:

```bash
npx skills add SamSamskies/inference-provider-api --skill build-with-ipa
```

Then ask your agent to add an IPA-powered feature to your app. The skill guides integration with the browser API and points to the spec, helpers, and examples.

### Reference Implementation

[Inference Bridge](https://github.com/SamSamskies/inference-bridge) is the reference Chrome and Firefox extension that injects `window.inference` and connects to local or cloud providers.

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge). See its [installation guide](https://github.com/SamSamskies/inference-bridge#installation) for development builds.

### Example Applications

- [Examples index](https://samsamskies.github.io/inference-provider-api/) — gallery of demo apps ([source](./examples/index.html))
- [Chat demo](https://samsamskies.github.io/inference-provider-api/chat/) — minimal chat UI that uses the API ([source](./examples/chat/))
- [Social demo](https://samsamskies.github.io/inference-provider-api/social/) — post + replies with a Grok-like Ask AI panel ([source](./examples/social/))
- [Translate demo](https://samsamskies.github.io/inference-provider-api/translate/) — short haiku translated with [`ipa-tools`](./packages/ipa-tools) `complete` ([source](./examples/translate/))
- [Avatar demo](https://samsamskies.github.io/inference-provider-api/avatar/) — describe a character, generate an SVG avatar with [`ipa-tools`](./packages/ipa-tools) `complete`, download PNG ([source](./examples/avatar/))
- [Nostr feed demo](https://samsamskies.github.io/inference-provider-api/nostr/) — a feed of Nostr notes filtered with natural language via IPA tool calling ([source](./examples/nostr/))
- [Charts demo](https://samsamskies.github.io/inference-provider-api/charts/) — natural-language charts via IPA tool calling (`render_chart` generative UI) ([source](./examples/charts/))
- [Speech demo](https://samsamskies.github.io/inference-provider-api/speech/) — transcribe an uploaded file, generate speech, and play MP3 or WAV ([source](./examples/speech/))
- [Decisions demo](https://samsamskies.github.io/inference-provider-api/decisions/) — triage a message with typed category, urgency, and reply-needed judgments ([source](./examples/decisions/))
- [Prompt API fallback demo](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/) — today-in-history fact via `createInference` with [`ipa-prompt-api-fallback`](./packages/ipa-prompt-api-fallback) when no extension is present ([source](./examples/prompt-api-fallback/))

## Motivation

AI-powered web applications often have to:

- Ask users for API keys
- Integrate every inference provider separately
- Proxy requests through their own backend
- Build custom permission systems

IPA lets applications request inference through a user-controlled browser or extension without handling the user's API keys.

Inspired by [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md), IPA separates **applications** from **providers**, giving users complete control over where inference is performed.

## Design Principles

1. Users own their API keys; applications never access them.
2. Applications use a provider-agnostic inference API.
3. Users choose providers and models.
4. Local and remote inference are first-class citizens.
5. Permission is explicit.

## Example

`request` is required. Check `window.inference?.request` before enabling inference UI; a compatible browser or extension may be missing.

```ts
for await (const chunk of window.inference.request({
  method: "chat",
  messages: [
    {
      role: "user",
      content: `Is this true?:\n\nNostr is dead.`
    }
  ]
})) {
  if (chunk.type === "accepted") {
    // permission resolved; provider call may begin
  } else if (chunk.type === "reasoning_delta") {
    // optional reasoning output
  } else if (chunk.type === "delta") {
    // append chunk.content to the reply UI
  } else if (chunk.type === "done") {
    // final message / usage; message.reasoning when reasoning was streamed
  }
}
```

Use [`ipa-tools`](./packages/ipa-tools) (`npm install ipa-tools`) when you only need the final chat result or a page-executed tool loop:

```ts
import { complete } from "ipa-tools";

const { model, message, usage } = await complete({
  method: "chat",
  messages: [{ role: "user", content: "Is this true?:\n\nNostr is dead." }],
});
```

The helpers are application code. The injected API stays on `request` and optional `getFeatures`.

### Optional capabilities

`getFeatures` returns a synchronous snapshot of supported API features. Missing flags mean unsupported; flags do not guarantee that the user's selected provider or model can fulfill a request.

```ts
const features = window.inference.getFeatures?.() ?? {};
```

| Capability | Feature gate | Request and result |
| --- | --- | --- |
| [Function tools](./SPEC.md#tool-calling) | `features.toolCalling` | Function tools in `tools`; the page executes `done.message.toolCalls`, or uses `ipa-tools`'s `runTools` |
| [Hosted web search](./SPEC.md#hosted-web-search) | `features.webSearch` | `tools: [{ type: "web_search" }]`; the injector or provider executes search |
| [Image input](./SPEC.md#images) | `features.imageInput` | Image parts in user or assistant messages |
| [Image output](./SPEC.md#images) | `features.imageOutput` | `output: { images: true }`; image parts appear on `done.message.content` |
| [Typed decisions](./SPEC.md#typed-decisions-system-one) | `features.methods?.decide` | `method: "decide"` with JSON `state` and named `noul` / `choice` / `score` questions; `accepted` then `done.answers`, including per-question refusals |
| [Transcription](./SPEC.md#bounded-speech) | `features.methods?.transcribe?.acceptedMedia` | `method: "transcribe"` with completed `media`; text on `done.transcript` |
| [Speech synthesis](./SPEC.md#bounded-speech) | `features.methods?.synthesize` | `method: "synthesize"` with `text`; MP3 by default, optional advertised WAV in `audio_delta` chunks |
| [Chat options](./SPEC.md#request-options) | `features.options?.reasoningEffort` / `features.options?.temperature` | Generation preferences in `options`; unsupported keys are ignored |

Optional capabilities are independent. Unadvertised tools, hosted search, images, and optional methods are rejected with `invalid_request`. See the [speech examples](./examples/speech/README.md) for uploads, format discovery and playback, URL input, and cancellation.

### Permissions

The injector obtains permission for the calling origin before sending content to a provider. The user chooses the provider and model. Remembered grants bind that route to the origin and method (plus voice for synthesis); changing a global default does not rewrite existing grants. A remembered denial blocks the origin.

Function tools, hosted search, image input/output, typed decisions, and speech require their own approval; a plain chat grant does not cover them. The approval UI must identify offered tools and capabilities, but a request preview is optional. Decision approval identifies question ids/types. Applications should disclose what page tools may send before the first request because later tool results can be sent without another preview.

An `accepted` chunk means permission has resolved, including through an existing grant; it does not prove a prompt appeared. See the specification's [behavior](./SPEC.md#behavior), [security](./SPEC.md#security), and capability-specific permission rules for details.

An inference/tool-description grant does not approve every side effect an application might execute. Page-owned tools can use `ipa-tools`' optional [argument validation and app approval hooks](./packages/ipa-tools/README.md#tool-validation-and-app-approval) before executing consequential actions.

## Non-goals

- Replacing provider SDKs
- Billing
- Authentication
- Defining inference protocols
- Choosing the "best" model

## Open Questions

Some topics that still need community discussion:

- Which further capability constraints, if any, do applications need beyond tools and `options`?
- Are `"auto" | "none" | "low" | "medium" | "high"` the right `options.reasoningEffort` levels, or should the field become a provider-mapped budget/token object?
- Which further keys belong under `options` (for example `maxTokens`)?
- Should embeddings use this API or a separate API?
- Should other hosted / provider-executed tools (for example MCP) be specified, or remain implementation-specific?
- Should tool calls stream as their own chunk type, or stay on `done.message.toolCalls` only?
- Should arbitrary structured chat outputs (e.g. JSON Schema / `responseFormat`, beyond typed decisions) be part of IPA, or left to prompt engineering until providers converge?

## Contributing

For package development, use Node.js 22 (22.12 or later), 24, or 26+ and npm. From the repository root, run `npm ci`, then `npm test` to build both packages and run their tests and TypeScript checks.

Open an issue or pull request for spec feedback, API proposals, examples, reference implementations, or related standards and prior art.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
