# Inference Provider API (IPA)

> A proposed browser standard for provider-agnostic AI inference.

**Status:** Experimental Draft

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
      content: "Summarize this Nostr note."
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

[Allow Once]
[Always Allow]
[Deny]
```

The user chooses the provider and model.

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
- How should extensions surface token usage and cost?
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