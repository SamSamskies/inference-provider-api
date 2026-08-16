Inference Provider API
======================

`window.inference` capability for web browsers
----------------------------------------------

**Status:** Experimental Draft

`window.inference` may be injected by a browser or extension. After checking that it exists, websites call:

```ts
window.inference.request(request: InferenceRequest): AsyncIterable<InferenceChunk>
window.inference.getFeatures(): InferenceFeatures
```

`request` is required. `getFeatures` reports optional capabilities (see Feature discovery). Implementations that omit `getFeatures` are treated as advertising none.

```ts
type InferenceRequest = {
  method: "chat";
  messages: Message[];
  /** Function tools. Only when getFeatures().toolCalling is true. */
  tools?: Tool[];
  toolChoice?: ToolChoice;
  /** Generation preferences for this request. See Request options. */
  options?: InferenceOptions;
  signal?: AbortSignal;
}

type InferenceOptions = {
  /**
   * Preferred reasoning / thinking effort.
   * Distinct from assistant `message.reasoning` (output text).
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Sampling temperature in `[0, 2]`.
   * Omitted means the implementation / provider default.
   */
  temperature?: number;
}

/** Omitted or `"auto"` means the implementation / provider default. */
type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high";

type Message =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      /** Model reasoning / chain-of-thought, when the provider exposes it. */
      reasoning?: string;
      toolCalls?: ToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
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

type InferenceFeatures = {
  /**
   * Implementation accepts tools, toolChoice, and tool messages on request.
   * Absent or false means unsupported.
   */
  toolCalling?: boolean;
  /**
   * Which InferenceOptions keys this implementation accepts.
   * Absent keys (and an absent options object) mean ignore those fields.
   */
  options?: {
    reasoningEffort?: boolean;
    temperature?: boolean;
  };
}

type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** JSON Schema object for the function arguments. */
    parameters?: { [key: string]: unknown };
  };
}

type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded argument object. */
    arguments: string;
  };
}

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

Text chat (`method: "chat"` with `system` / `user` / `assistant` string messages) is required. Tool calling and request `options` (for example `reasoningEffort`, `temperature`) are optional; implementations advertise them with `getFeatures`.

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
7. Concatenating every `delta.content` produces `done.message.content` when the assistant reply is text. Reasoning is not included in `content`. On a tool turn with no `delta` chunks, `done.message.content` may be `null` or `""`; applications must treat both as no text reply.
8. Concatenating every `reasoning_delta.content` produces `done.message.reasoning` when the provider exposed reasoning. If there were no `reasoning_delta` chunks, `done.message.reasoning` is omitted.
9. Providers or models that do not expose reasoning yield no `reasoning_delta` chunks and omit `message.reasoning`. Applications must treat reasoning as optional.
10. Providers that do not stream may yield no `reasoning_delta` or `delta` chunks and only a final `done` (with `message.content` and optional `message.reasoning` and/or `message.toolCalls`).
11. When sending prior assistant turns back in `messages`, applications may include `reasoning` if they received it. Implementations map it to the provider when the provider supports round-tripping reasoning; otherwise they may ignore it. Applications must not rely on every provider consuming prior reasoning.
12. `options` holds generation preferences (see Request options). They do not change the stream shape: applications must still treat `reasoning_delta` and `message.reasoning` as optional.
13. Aborting `signal`, closing the page, or navigating it aborts an active request with the `aborted` error code. When the document is unloading, the page may be unable to observe that rejection; implementations must still cancel in-flight provider work.

### Feature discovery

`getFeatures` is synchronous. It must not prompt, must not require permission, and must not perform network I/O. It returns a snapshot of **API surface this implementation supports**, not whether the user's current provider or model will honor a capability, and not whether the origin has a permission grant.

Applications must feature-detect. Older injectors may omit the method:

```ts
const features = window.inference.getFeatures?.() ?? {};
if (features.toolCalling) {
  // request accepts tools / toolChoice / tool messages
}
if (features.options?.reasoningEffort) {
  // request.options.reasoningEffort accepted; implementation will try to map it
}
if (features.options?.temperature) {
  // request.options.temperature accepted; implementation will try to map it
}
```

Rules:

1. `toolCalling: true` means `request` accepts `tools`, `toolChoice`, assistant `toolCalls`, and `role: "tool"` messages. It does not mean the selected model can call functions.
2. `options.reasoningEffort: true` means `request.options.reasoningEffort` is accepted and the implementation attempts to map it to the provider. It does not mean the selected model supports adjustable thinking. Advertise options **per key**; a bare `options: {}` advertises none. The same per-key rule applies to `options.temperature` and any later `options` keys.
3. An absent key and `false` both mean unsupported. Applications must ignore unknown keys (including unknown keys under `options`) so later capabilities can be added without breaking callers.
4. The result must not include provider name, model id, or other user or account identity.
5. Implementations that do not support tool calling must reject `tools`, `toolChoice`, `role: "tool"` messages, and assistant `toolCalls` with `invalid_request` — including implementations that omit `getFeatures`.
6. Implementations must **ignore** unsupported `options` keys (must not reject the request solely for including them). Applications may send future keys for forward compatibility; they have no effect until advertised.
7. Advertising `toolCalling` does not guarantee that the user's provider or model will emit `toolCalls`. The model may ignore tools and reply in text. Applications must handle a text-only `done` even when they offered tools. Implementations must not reject a well-formed tools request solely because the current model is weak at function calling.
8. Advertising an `options` key does not guarantee that the user's provider or model will honor that preference. Implementations map best-effort and must not fail a well-formed request solely because the current model cannot apply the option.

### Request options

`options` is a bag of generation preferences for this call — not model selection (the user still chooses provider and model). This draft defines `reasoningEffort` and `temperature`; later drafts may add further keys under the same object. Applications must ignore unknown keys; implementations must ignore keys they do not advertise.

#### `reasoningEffort`

Lets applications prefer less or more model reasoning / chain-of-thought (for example `"none"` or `"low"` for translation or autocomplete; `"high"` for harder multi-step tasks). It controls **generation**, not merely whether the page displays reasoning: omitting UI for `reasoning_delta` does not reduce latency or cost if the model still thinks.

This is distinct from assistant `message.reasoning` / `reasoning_delta`, which are optional **outputs** when a provider exposes chain-of-thought text.

- When omitted, behavior is `"auto"`: the implementation uses its default (typically the provider or model default).
- `"none"` asks to disable or minimize thinking when the provider supports that.
- `"low"`, `"medium"`, and `"high"` ask for increasing effort when the provider exposes an effort or budget control. Implementations map these onto provider-specific parameters (for example effort enums or token budgets); exact mapping is implementation-defined.
- When `getFeatures().options?.reasoningEffort` is true, values outside `ReasoningEffort` are `invalid_request`.
- When that feature key is absent or false, `options.reasoningEffort` is ignored (see Feature discovery).

Applications that care about latency or cost for simple tasks should pass `"none"` or `"low"` when support is advertised. Applications must not assume reasoning output disappears, or that every model becomes non-thinking, solely because they requested `"none"`.

#### `temperature`

Lets applications prefer less or more sampling randomness (for example low values for translation or extraction; higher values for brainstorming). Orthogonal to `reasoningEffort`: temperature affects token sampling; reasoning effort affects thinking budget / chain-of-thought.

- When omitted, the implementation uses its default (typically the provider or model default).
- When present, the value must be a finite number in the closed interval `[0, 2]` (OpenAI-style scale). Implementations map or clamp onto provider-specific ranges when a provider uses a different scale (for example `[0, 1]`).
- When `getFeatures().options?.temperature` is true, non-finite values or values outside `[0, 2]` are `invalid_request`.
- When that feature key is absent or false, `options.temperature` is ignored (see Feature discovery).

Applications must not assume every model honors temperature exactly; advertising means the implementation will attempt to pass it through.

#### Permission

`options` alone does not require a new permission prompt and does not widen a persistent grant. Implementations **may** let the user override or clamp values such as `reasoningEffort` or `temperature` in extension settings (or optionally in the approval UI). Override and clamp controls are **optional** extension UX — this draft does **not** require them on the permission prompt or elsewhere. Consent remains origin + provider/model (+ tools when present).

### Tool calling

Function tools are defined and **executed by the page**. The implementation relays JSON schemas, `toolCalls`, and `role: "tool"` results; it must not run application tool handlers or widen host permissions in order to execute tools.

This draft specifies function tools only. The implementation is not an agent runtime: the page owns any multi-round loop (send tools → receive `toolCalls` → execute → send `role: "tool"` results → repeat).

#### Request

- `tools`, when present, must be a non-empty array of function tools. `parameters` is a JSON Schema object for the function arguments.
- `toolChoice`, when omitted and `tools` is present, defaults to `"auto"` (the model may reply in text or call tools). `"none"` suppresses calls; `"required"` asks for at least one call; a function object forces that function.
- `role: "tool"` messages must include `toolCallId` (the `id` from the corresponding `ToolCall`) and string `content` (usually JSON text). They must not include `toolCalls` or `reasoning`.
- Assistant messages may include `toolCalls` (non-empty when present). `content` may be `null` when the turn is tool-only. `toolCalls[].function.arguments` is a JSON string, not a parsed object.
- `system` and `user` messages must not include `toolCalls` or `toolCallId`. Their `content` is always a string.

Streaming is unchanged: `accepted` → optional `reasoning_delta` / `delta` → `done`. Tool calls are not streamed as separate chunk types. When the model ends on tools, `done.message` is an assistant message with `toolCalls` (and `content` often `null` or empty).

When continuing a tool turn, the application appends that assistant message (including `toolCalls` and `reasoning` if present), then one `role: "tool"` message per call, then calls `request` again.

```ts
const features = window.inference.getFeatures?.() ?? {};
if (!features.toolCalling) {
  throw new Error("This IPA implementation does not support tool calling.");
}

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

const messages = [
  { role: "user", content: "What's the weather in Austin?" },
];

let done;
for await (const chunk of window.inference.request({
  method: "chat",
  messages,
  tools,
})) {
  if (chunk.type === "done") done = chunk;
}

if (done.message.role === "assistant" && done.message.toolCalls?.length) {
  messages.push({
    role: "assistant",
    content: done.message.content,
    toolCalls: done.message.toolCalls,
    ...(done.message.reasoning ? { reasoning: done.message.reasoning } : {}),
  });

  for (const call of done.message.toolCalls) {
    const args = JSON.parse(call.function.arguments);
    const result =
      call.function.name === "get_weather"
        ? { city: args.city, tempC: 22 }
        : { error: "unknown tool" };
    messages.push({
      role: "tool",
      toolCallId: call.id,
      content: JSON.stringify(result),
    });
  }

  for await (const chunk of window.inference.request({
    method: "chat",
    messages,
    tools,
  })) {
    if (chunk.type === "delta") {
      // append chunk.content
    }
  }
}
```

The loop above is application code, not part of `window.inference`. A non-normative helper library ([`ipa-tools`](./packages/ipa-tools)) provides TypeScript types, a `complete` drain helper, and a `runTools` loop; implementations are not required to ship it.

#### Permission

A persistent allow grant for text chat does not cover a later request that includes `tools`, or a wider tool set than the grant records. Implementations must prompt again in those cases, including when a persistent grant already exists for the origin.

When a request includes `tools`, the permission UI must list the function names so the user can see what the site is authorizing the model to request. Showing descriptions is optional. Request-content preview remains optional (see Security).

Implementations may treat a follow-up that only appends `role: "tool"` results for the just-approved assistant `toolCalls` as the same permission episode, so a multi-round tool loop does not re-prompt on every round. A new user turn, a new or wider `tools` list, or a history that is not a continuation of that episode requires a new prompt (or a covering persistent grant).

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

Function tools run in the page. A site that offers tools can cause the model to request those functions with attacker-influenced arguments (including via retrieved or user-supplied text). Implementations must not execute page-defined tools, and must not treat a chat-only persistent grant as consent for tools. Listing function names at approval time is required so the user can refuse a tools request independently of chat.

### Out of scope for this draft

Images, embeddings, speech, hosted / provider-executed tools (for example web search or MCP), streaming `toolCall` deltas, and an in-API agent loop.

Estimated cost in the permission UI is optional extension UX and is not required by this draft.
