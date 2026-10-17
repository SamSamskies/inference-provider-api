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

Then ask your agent to add an IPA-powered feature to your app. The skill guides integration with the browser API and points to the current spec, helpers, and examples. You can also give an agent [SPEC.md](./SPEC.md) directly for a one-off integration.

### Reference Implementation

- [Inference Bridge](https://github.com/SamSamskies/inference-bridge) — official Chrome and Firefox extension that injects `window.inference` and routes to OpenAI, Anthropic, OpenRouter, Ollama, or OpenAI-compatible servers

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/inference-bridge). For development in Chrome, clone the repository and load it unpacked from `chrome://extensions` (Developer mode → Load unpacked → select the repo root).

### Example Applications

- [Examples index](https://samsamskies.github.io/inference-provider-api/) — gallery of demo apps ([source](./examples/index.html))
- [Chat demo](https://samsamskies.github.io/inference-provider-api/chat/) — minimal chat UI that uses the API ([source](./examples/chat/))
- [Social demo](https://samsamskies.github.io/inference-provider-api/social/) — post + replies with a Grok-like Ask AI panel ([source](./examples/social/))
- [Translate demo](https://samsamskies.github.io/inference-provider-api/translate/) — short haiku translated with [`ipa-tools`](./packages/ipa-tools) `complete` ([source](./examples/translate/))
- [Avatar demo](https://samsamskies.github.io/inference-provider-api/avatar/) — describe a character, generate an SVG avatar with [`ipa-tools`](./packages/ipa-tools) `complete`, download PNG ([source](./examples/avatar/))
- [Nostr feed demo](https://samsamskies.github.io/inference-provider-api/nostr/) — a feed of Nostr notes filtered with natural language via IPA tool calling ([source](./examples/nostr/))
- [Charts demo](https://samsamskies.github.io/inference-provider-api/charts/) — natural-language charts via IPA tool calling (`render_chart` generative UI) ([source](./examples/charts/))
- [Prompt API fallback demo](https://samsamskies.github.io/inference-provider-api/prompt-api-fallback/) — today-in-history fact via `createInference` with [`ipa-prompt-api-fallback`](./packages/ipa-prompt-api-fallback) when no extension is present ([source](./examples/prompt-api-fallback/))

The specification defines the standard. Inference Bridge implements that standard and may also include experimental features that are not part of the API contract yet. Applications should target the Inference Provider API (`request` and `getFeatures`), not extension-specific namespaces. Bounded transcription and MP3 synthesis are optional spec methods; Inference Bridge [v0.17.0](https://github.com/SamSamskies/inference-bridge/releases/tag/v0.17.0) exposes them on stable `request`/`getFeatures`. Detect method support before use; see [speech examples](./examples/speech/README.md).

## Motivation

Today, every AI-powered web application has to reinvent the same infrastructure:

- Ask users for API keys
- Integrate every inference provider separately
- Proxy requests through their own backend
- Build custom permission systems

The **Inference Provider API (IPA)** proposes a standard browser interface that allows web applications to request inference from a user-approved browser extension without ever accessing API keys.

Inspired by [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md), IPA separates **applications** from **providers**, giving users complete control over where inference is performed.

## Design Principles

1. Users own their API keys.
2. Applications request inference, not providers.
3. Users choose providers.
4. Users choose models.
5. Applications should be provider agnostic.
6. Local and remote inference are first-class citizens.
7. Permission is explicit.
8. API keys never leave the browser extension.

## Example

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
    // optional: model reasoning / chain-of-thought
  } else if (chunk.type === "delta") {
    // append chunk.content to the reply UI
  } else if (chunk.type === "done") {
    // final message / usage; message.reasoning when reasoning was streamed
  }
}
```

`request` is required. Check `window.inference?.request` before enabling inference UI; a compatible injector may be missing. Use [`ipa-tools`](./packages/ipa-tools) (`npm install ipa-tools`) when you only need the final chat result or a page-executed tool loop:

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
| [Transcription](./SPEC.md#bounded-speech) | `features.methods?.transcribe?.acceptedMedia` | `method: "transcribe"` with completed `media`; text on `done.transcript` |
| [MP3 synthesis](./SPEC.md#bounded-speech) | `features.methods?.synthesize` | `method: "synthesize"` with `text`; MP3 bytes in `audio_delta` chunks |
| [Chat options](./SPEC.md#request-options) | `features.options?.reasoningEffort` / `features.options?.temperature` | Generation preferences in `options`; unsupported keys are ignored |

Detect optional capabilities before sending them. Function tools, hosted search, image input, and image output are independent; sending an unadvertised one is `invalid_request`. Unadvertised speech methods are also `invalid_request`. Hosted search does not produce page-side tool calls. See the [speech examples](./examples/speech/README.md) for uploads, bounded microphone recording, MP3 playback controls, URL input, and cancellation. The user chooses provider, model, and synthesis voice; the page controls recording and playback.

### Permissions

The injector obtains permission for the calling origin before sending content to a provider. The user chooses the provider and model. Remembered grants bind that route to the origin and method (plus voice for synthesis); changing a global default does not rewrite existing grants. A remembered denial blocks the origin.

Function tools, hosted search, image input/output, and speech require their own approval; a plain chat grant does not cover them. The approval UI must identify offered tools and capabilities, but a request preview is optional. Applications should disclose what page tools may send before the first request because later tool results can be sent without another preview.

An `accepted` chunk means permission has resolved, including through an existing grant; it does not prove a prompt appeared. See the specification's [behavior](./SPEC.md#behavior), [security](./SPEC.md#security), and capability-specific permission rules for details.

## Goals

- Standard browser API
- Provider agnostic
- Bring Your Own Key (BYOK)
- Local-first compatible
- Per-origin permissions
- Streaming support
- Zero backend required

## Non-goals

- Replacing provider SDKs
- Billing
- Authentication
- Defining inference protocols
- Choosing the "best" model

## Potential Providers

An IPA-compatible browser extension could route requests to any provider, including:

- OpenAI
- Anthropic
- Google Gemini
- xAI
- OpenRouter
- ppq.ai
- Routstr
- Ollama
- LM Studio
- Local inference servers

Applications should not need to know which provider the user has selected.

### Local providers (Ollama, LM Studio, etc.)

Local servers often reject requests that carry a `chrome-extension://` `Origin`
header (commonly HTTP 403). IPA extensions that support local inference should
strip or rewrite that header on their own requests to loopback endpoints so
users are not asked to set `OLLAMA_ORIGINS=chrome-extension://*` or similar
allowlists. Widening the local server's origin allowlist remains a fallback, not
the preferred path.

**Chrome MV3 reference:** [Inference Bridge](https://github.com/SamSamskies/inference-bridge)
does this with `declarativeNetRequestWithHostAccess` and dynamic rules in
[`src/ollama-origin-bypass.js`](https://github.com/SamSamskies/inference-bridge/blob/main/src/ollama-origin-bypass.js)
and
[`src/loopback-origin-bypass.js`](https://github.com/SamSamskies/inference-bridge/blob/main/src/loopback-origin-bypass.js)
that remove `Origin` / `Referer` for local Ollama and other loopback
OpenAI-compatible servers. See [SPEC.md](./SPEC.md) Security for the normative
guidance.

That permission lets the extension modify request headers only for hosts already
listed in `host_permissions`—it is not a browser-wide rewrite capability. Still
treat it as privileged: a compromised or overly broad extension could alter
headers on those hosts. Prefer port-scoped loopback permissions (for example
`http://localhost:11434/*`) over `http://localhost/*`, keep DNR rules limited to
local inference endpoints, and do not use DNR to touch remote provider traffic.
This is still preferable to asking every user to set
`OLLAMA_ORIGINS=chrome-extension://*`, which trusts every installed extension
talking to Ollama.

## Example Use Cases

- A "Grok" button on every social post.
- AI-powered documentation.
- Browser-based coding tools and other page-executed function tools.
- Translation.
- Writing assistance.
- Local-first AI applications.

## Open Questions

Some topics that still need community discussion:

- Is `window.inference` the right namespace?
- Which further capability constraints, if any, do applications need beyond tools and `options`?
- Are `"auto" | "none" | "low" | "medium" | "high"` the right `options.reasoningEffort` levels, or should the field become a provider-mapped budget/token object?
- Which further keys belong under `options` (for example `maxTokens`), and should clamp/override UX stay optional?
- Should model selection always remain under user control?
- Should embeddings use this API or a separate API? (Bounded speech: this API — `transcribe` / `synthesize` request variants. Realtime speech sessions remain separate future work. Images: content parts on chat plus `output.images`.)
- How should extensions surface token usage? Should estimated cost remain optional UX until pricing metadata is defined?
- Should `getFeatures` add a nested object later (for example for MCP), or stay one key per capability as with `toolCalling` and `webSearch`?
- Should other hosted / provider-executed tools (for example MCP) be specified, or remain implementation-specific?
- Should tool calls stream as their own chunk type, or stay on `done.message.toolCalls` only?
- Should structured outputs (e.g. JSON Schema / `responseFormat`) be part of IPA, or left to prompt engineering until providers converge?
- How should permission UIs present multi-message requests — e.g. emphasize the last user message and collapse system/context by default?
- Should applications be encouraged or required to round-trip `message.reasoning` on later turns for providers that benefit from it?

## Contributing

This proposal is intentionally in an early draft stage.

The goal is to collaboratively design an open browser standard for provider-agnostic inference—not a specific implementation.

Contributions of all kinds are welcome, including:

- Design feedback
- API suggestions
- Security considerations
- Alternative approaches
- Reference implementations
- Browser extension prototypes
- Related standards or prior art

If you have an idea or concern, please open an issue.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
