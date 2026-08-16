# Inference Provider API (IPA)

> A proposed browser standard for provider-agnostic AI inference.

**Status:** Experimental Draft

**Spec:** [SPEC.md](./SPEC.md)

## Try It

### Reference Implementation

- [Inference Bridge](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) — official Chrome extension that injects `window.inference` and routes to OpenAI, Anthropic, OpenRouter, Ollama, or experimental OpenAI-compatible servers ([source](https://github.com/SamSamskies/inference-bridge))

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd), or for development clone the repository and load it unpacked from `chrome://extensions` (Developer mode → Load unpacked → select the repo root).

### Example Applications

- [Examples index](https://samsamskies.github.io/inference-provider-api/) — gallery of demo apps ([source](./examples/index.html))
- [Chat demo](https://samsamskies.github.io/inference-provider-api/chat/) — minimal chat UI that uses the API ([source](./examples/chat/))
- [Social demo](https://samsamskies.github.io/inference-provider-api/social/) — post + replies with a Grok-like Ask AI panel ([source](./examples/social/))
- [Translate demo](https://samsamskies.github.io/inference-provider-api/translate/) — short haiku translated with [`ipa-tools`](./packages/ipa-tools) `complete` ([source](./examples/translate/))

The specification defines the standard. Inference Bridge implements that standard and may also include experimental features that are not part of the API contract yet. Applications should target the Inference Provider API (`request` and `getFeatures`), not extension-specific namespaces.

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

`request` is required. `getFeatures` reports optional capabilities such as tool calling and request `options` (for example `reasoningEffort`, `temperature`); implementations that omit it advertise none. If the app only needs the final message, drain to `done` (inline sketch — or use [`ipa-tools`](./packages/ipa-tools)’s `complete`):

```ts
async function complete(request) {
  let done;
  for await (const chunk of window.inference.request(request)) {
    if (chunk.type === "done") done = chunk;
  }
  return done;
}

const { model, message, usage } = await complete({
  method: "chat",
  messages: [{ role: "user", content: "Is this true?:\n\nNostr is dead." }],
});
```

The helper is application code, not part of `window.inference`. It throws `InferenceError` the same way iterating `request` does.

Feature-detect optional capabilities before sending tools. Missing `getFeatures` means none:

```ts
const features = window.inference.getFeatures?.() ?? {};

if (features.toolCalling) {
  const tools = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    },
  ];

  for await (const chunk of window.inference.request({
    method: "chat",
    messages: [{ role: "user", content: "What's the weather in Austin?" }],
    tools,
  })) {
    if (chunk.type === "done" && chunk.message.toolCalls?.length) {
      // page executes the function, appends role: "tool" results, calls request again
    }
  }
}

// Prefer less thinking / lower temperature for translation when supported
for await (const chunk of window.inference.request({
  method: "chat",
  messages: [{ role: "user", content: "Translate to Spanish: Hello" }],
  options: {
    reasoningEffort: features.options?.reasoningEffort ? "none" : undefined,
    temperature: features.options?.temperature ? 0.2 : undefined,
  },
})) {
  // ...
}
```

Any multi-round tool loop is application code. Implementations that do not
advertise `toolCalling` reject `tools` with `invalid_request`. Unsupported
`options` keys are ignored (not rejected) so apps may send them for forward
compatibility. For a ready-made loop (plus types and `complete`), see the
non-normative [`ipa-tools`](./packages/ipa-tools) package
(`npm install ipa-tools`).

Some injectors may expose tools on `experimental.request` before advertising
`toolCalling` via `getFeatures`. Sending `tools` on IPA `request` without
that advertisement is `invalid_request`. For a detect-and-fallback pattern,
see [`ipa-tools`](./packages/ipa-tools#when-toolcalling-is-not-advertised).
The extension prompts the user for permission:

```text
Allow inference?
primal.net

Provider
[ Ollama ▼ ]

Model
[ Gemma 4 ▼ ]

Request preview
user: Is this true?:

Nostr is dead.

[ ] Remember for this site
Allow once, or deny only this request.

[Allow]  [Deny]
```

Request preview is optional extension UX for this draft, not part of the API
contract. When the request includes `tools`, the permission UI must list the
function names; a persistent chat grant does not silently cover a later tools
request.

The user chooses the provider and model. With “Remember for this site” checked, Allow
persists access for that origin together with the chosen provider and model; Deny
permanently blocks it. Changing the extension’s global default does not alter
existing origin grants.

Text chat is required. Tool calling is optional: implementations that support it
return `{ toolCalling: true }` from `getFeatures` and accept `tools` on
`request`. The page defines and executes function tools; the extension only
relays schemas, `toolCalls`, and results. Optional `options` (for example
`options.reasoningEffort`: `"auto" | "none" | "low" | "medium" | "high"`,
`options.temperature`: number in `[0, 2]`) lets apps prefer generation settings
when the matching `getFeatures().options` key is true — not a permission change;
user override or clamp controls are optional extension UX. See
[SPEC.md](./SPEC.md).

## Goals

- Standard browser API
- Provider agnostic
- Bring Your Own Key (BYOK)
- Local-first compatible
- Per-origin permissions
- Streaming support
- Zero backend required
- Optional capability discovery (`getFeatures`)
- Optional function tools, executed by the page
- Optional request `options` (for example `reasoningEffort`, `temperature`)

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
- Should images, embeddings, and speech use this API or separate APIs?
- How should extensions surface token usage? Should estimated cost remain optional UX until pricing metadata is defined?
- Should `getFeatures` grow beyond booleans (for example nested tool kinds), or stay one key per capability?
- Should hosted / provider-executed tools (web search, MCP) be specified, or remain implementation-specific?
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