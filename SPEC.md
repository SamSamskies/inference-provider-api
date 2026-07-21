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
}

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
}

type InferenceChunk =
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
  if (chunk.type === "delta") {
    // append chunk.content to the UI
  } else if (chunk.type === "done") {
    // final message / usage
  }
}
```

### Behavior

1. A request begins when the application starts iterating. The extension obtains permission for the calling origin before sending any content to a provider, prompting the user unless persistent permission already exists.
2. The user chooses the provider and model, or the extension uses the provider and model previously saved for that origin.
3. API keys never leave the extension. Applications never see them.
4. If a request fails, iteration throws an `InferenceError`. A failed request does not yield a `done` chunk.
5. `request` yields zero or more `delta` chunks, then exactly one `done` chunk. No chunks follow `done`.
6. Concatenating every `delta.content` produces `done.message.content`, the full assistant reply.
7. Providers that do not stream may yield no `delta` chunks and only a final `done`.
8. Aborting `signal`, closing the page, or navigating it aborts an active request with the `aborted` error code.

### Security

The API is available only to top-level pages in a secure context. Permission is scoped to the page's origin. A persistent allow grant records the provider and model chosen at approval time; later requests for that origin reuse that saved choice. Changing a global default provider or model does not rewrite existing origin grants. Implementations must validate requests and must not expose API keys or provider credentials to page scripts.

Implementations may show a truncated preview of request content in the permission UI to support informed consent. Previewing content is optional; applications must not assume the UI reveals message content.

### Out of scope for this draft

Tool calling, images, embeddings, speech, and capability discovery.
