# Inference Provider API (IPA)

> A proposed browser standard for provider-agnostic AI inference.

**Status:** Experimental Draft

**Spec:** [SPEC.md](./SPEC.md)

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
  if (chunk.type === "delta") {
    // append chunk.content to the UI
  } else if (chunk.type === "done") {
    // final message / usage
  }
}
```

The extension prompts the user for permission:

```text
primal.net wants to use inference

Use:

○ GPT-5
● Claude Sonnet 4
○ PPQ Auto
○ Gemma 4 (Local)

Estimated Cost
$0.0012

[ ] Remember for this site

[Allow]
[Deny]
```

Estimated cost is optional extension UX for this draft, not part of the API
contract.

The user chooses the provider and model. With “Remember for this site” checked, Allow
persists access for that origin together with the chosen provider and model; Deny
permanently blocks it. Changing the extension’s global default does not alter
existing origin grants.

This first draft intentionally supports only text chat. The goal is to make the
smallest useful API available for experiments, learn from real applications,
and expand the standard only when those applications demonstrate a need.

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

**Chrome MV3 reference:** the [demo extension](./examples/extension/) does this
with `declarativeNetRequestWithHostAccess` and dynamic rules in
[`examples/extension/src/ollama-origin-bypass.js`](./examples/extension/src/ollama-origin-bypass.js)
that remove `Origin` / `Referer` only for local Ollama. See [SPEC.md](./SPEC.md)
Security for the normative guidance.

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

- A "Grok" button on every Nostr note.
- AI-powered documentation.
- Browser-based coding tools.
- Translation.
- Writing assistance.
- Local-first AI applications.

## Open Questions

Some topics that still need community discussion:

- Is `window.inference` the right namespace?
- Which capability constraints, if any, do applications need?
- Should model selection always remain under user control?
- Should tool calling be added in a future version?
- Should images, embeddings, and speech use this API or separate APIs?
- How should extensions surface token usage? Should estimated cost remain optional UX until pricing metadata is defined?
- Should applications be able to discover available capabilities?

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