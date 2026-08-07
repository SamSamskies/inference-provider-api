Inference Provider API
======================

`window.inference` capability for web browsers
----------------------------------------------

**Status:** Experimental Draft

`window.inference` may be injected by a browser or extension. After checking that it exists, websites call:

```ts
window.inference.request(request: InferenceRequest): AsyncIterable<InferenceChunk>
```

```ts
type InferenceRequest = {
  method: "chat";
  messages: Message[];
  signal?: AbortSignal;
}

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Model reasoning / chain-of-thought, when the provider exposes it. */
  reasoning?: string;
}

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
}

type InferenceChunk =
  | { type: "accepted" }
  | { type: "reasoning_delta"; content: string }
  | { type: "delta"; content: string }
  | { type: "done"; model: string; message: Message; usage?: Usage };

type InferenceError = Error & {
  code:
    | "permission_denied"
    | "invalid_request"
    | "unavailable"
    | "provider_error"
    | "aborted";
}
```

`InferenceError` is an `Error` with a `code` property. Across extension isolated worlds, implementations may reconstruct errors from a serializable `{ name, message, code }` shape rather than preserving a subclass. Applications should check `error.code`, not `instanceof`.

### Example

```ts
for await (const chunk of window.inference.request({
  method: "chat",
  messages: [{ role: "user", content: "Hello" }],
})) {
  if (chunk.type === "accepted") {
    // permission resolved; provider call may begin
  } else if (chunk.type === "reasoning_delta") {
    // append chunk.content to a reasoning UI (optional)
  } else if (chunk.type === "delta") {
    // append chunk.content to the reply UI
  } else if (chunk.type === "done") {
    // final message / usage; message.reasoning is set when reasoning was streamed
  }
}
```

### Behavior

1. A request begins when the application starts iterating. The extension obtains permission for the calling origin before sending any content to a provider, prompting the user unless persistent permission already exists.
2. The user chooses the provider and model, or the extension uses the provider and model previously saved for that origin.
3. API keys never leave the extension. Applications never see them.
4. If a request fails, iteration throws an `InferenceError`. A failed request does not yield a `done` chunk.
5. `request` yields exactly one `accepted` chunk after the origin is permitted and the request is cleared to call a provider — including when a persistent grant already exists and no prompt is shown. `accepted` does not mean the user clicked Allow in a UI; applications must not assume a prompt occurred. Failures during permission or preflight do not yield `accepted`.
6. After `accepted`, `request` yields zero or more `reasoning_delta` and/or `delta` chunks (in any order), then exactly one `done` chunk. No chunks follow `done`.
7. Concatenating every `delta.content` produces `done.message.content`, the full assistant reply. Reasoning is not included in `content`.
8. Concatenating every `reasoning_delta.content` produces `done.message.reasoning` when the provider exposed reasoning. If there were no `reasoning_delta` chunks, `done.message.reasoning` is omitted.
9. Providers or models that do not expose reasoning yield no `reasoning_delta` chunks and omit `message.reasoning`. Applications must treat reasoning as optional.
10. Providers that do not stream may yield no `reasoning_delta` or `delta` chunks and only a final `done` (with `message.content` and optional `message.reasoning`).
11. When sending prior assistant turns back in `messages`, applications may include `reasoning` if they received it. Implementations map it to the provider when the provider supports round-tripping reasoning; otherwise they may ignore it. Applications must not rely on every provider consuming prior reasoning.
12. Aborting `signal`, closing the page, or navigating it aborts an active request with the `aborted` error code. When the document is unloading, the page may be unable to observe that rejection; implementations must still cancel in-flight provider work.

### Security

The API is available only to top-level pages in a secure context that have a
tuple origin — typically `https:` and loopback `http:` (`localhost`,
`127.0.0.1`, `[::1]`). Opaque origins, including `file:` documents, are not
supported: permission is scoped to the page's origin, and those contexts do not
provide a stable site identity for grants or blocks.

A persistent allow grant records the provider and model chosen at approval time;
later requests for that origin reuse that saved choice. Changing a global
default provider or model does not rewrite existing origin grants.
Implementations must validate requests and must not expose API keys or provider
credentials to page scripts.

Implementations that call local inference servers (for example Ollama on
loopback) should avoid requiring users to widen the server's allowed origins.
Browser extension requests often include a `chrome-extension://` (or similar)
`Origin` header that many local servers reject with HTTP 403. Prefer stripping
or rewriting that header on extension-initiated requests to the local server so
default local installs work without configuring `OLLAMA_ORIGINS` or equivalent
allowlists. Broad wildcards such as `chrome-extension://*` remain an optional
fallback, not the recommended default.

Implementations may show a truncated preview of request content in the permission UI to support informed consent. Previewing content is optional; applications must not assume the UI reveals message content. Implementations may emphasize some messages and collapse others (for example by role) without changing the request sent to the provider.

### Out of scope for this draft

Tool calling, images, embeddings, speech, and capability discovery.

Estimated cost in the permission UI is optional extension UX and is not required by this draft.
