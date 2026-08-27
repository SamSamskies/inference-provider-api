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
type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

type TextPart = { type: "text"; text: string };

/**
 * Image bytes (`data`) or a page-side URL (`url`), never both.
 * `done.message` image parts always use `{ mediaType, data }` as a base64 string.
 * On the page-facing API, `data` may be a `Blob`; injectors encode before an
 * isolated-world hop. `{ url }` is resolved in the page (same CORS as the site).
 */
type ImagePart =
  | {
      type: "image";
      mediaType: ImageMediaType;
      data: string | Blob;
    }
  | { type: "image"; url: string };

type ContentPart = TextPart | ImagePart;

type InferenceRequest = {
  method: "chat";
  messages: Message[];
  /**
   * Function tools and/or `{ type: "web_search" }`.
   * Function tools only when getFeatures().toolCalling is true.
   * `{ type: "web_search" }` only when getFeatures().webSearch is true.
   */
  tools?: Tool[];
  toolChoice?: ToolChoice;
  /**
   * Image generation for this turn.
   * `output.images` only when getFeatures().imageOutput is true.
   * Extra keys under `output` are ignored (forward compatible).
   */
  output?: { images?: boolean };
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
      role: "system";
      content: string;
    }
  | {
      role: "user";
      content: string | ContentPart[];
    }
  | {
      role: "assistant";
      content: string | ContentPart[] | null;
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
   * Implementation accepts function tools, toolChoice, and tool messages
   * on request. Absent or false means unsupported.
   */
  toolCalling?: boolean;
  /**
   * Implementation accepts `{ type: "web_search" }` in `tools`.
   * Absent or false means unsupported. Independent of `toolCalling`.
   */
  webSearch?: boolean;
  /**
   * Implementation accepts ImageParts in `messages` (user uploads and
   * round-tripped assistant images). Absent or false means unsupported.
   * Independent of `imageOutput`.
   */
  imageInput?: boolean;
  /**
   * Implementation accepts `output.images`; `done.message` may contain
   * ImageParts. Absent or false means unsupported. Independent of `imageInput`.
   */
  imageOutput?: boolean;
  /**
   * Which InferenceOptions keys this implementation accepts.
   * Absent keys (and an absent options object) mean ignore those fields.
   */
  options?: {
    reasoningEffort?: boolean;
    temperature?: boolean;
  };
}

type Tool =
  | {
      type: "function";
      function: {
        name: string;
        description?: string;
        /** JSON Schema object for the function arguments. */
        parameters?: { [key: string]: unknown };
      };
    }
  | { type: "web_search" };

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

Text chat (`method: "chat"` with `system` / `user` / `assistant` string messages) is required. Tool calling, hosted web search, image input/output, and request `options` (for example `reasoningEffort`, `temperature`) are optional; implementations advertise them with `getFeatures`. String `content` on user and assistant messages stays valid so existing apps do not break.

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
7. Concatenating every `delta.content` produces `done.message.content` when the assistant reply is text. Reasoning is not included in `content`. On a tool turn with no `delta` chunks, `done.message.content` may be `null` or `""`; applications must treat both as no text reply. When the reply includes images, `done.message.content` is a `ContentPart[]`; concatenating every `delta.content` produces the concatenation of the `type: "text"` parts, in order. Image parts appear only on `done` (no `image_delta` in this draft). An image-only reply uses `content: [{ type: "image", ... }, ...]` with zero `delta`s — do not use `null` to mean “here is a PNG.”
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
  // request accepts function tools / toolChoice / tool messages
}
if (features.webSearch) {
  // request accepts tools: [{ type: "web_search" }, ...]
}
if (features.imageInput) {
  // messages may include ImageParts
}
if (features.imageOutput) {
  // request.output.images accepted; done.message may include ImageParts
}
if (features.options?.reasoningEffort) {
  // request.options.reasoningEffort accepted; implementation will try to map it
}
if (features.options?.temperature) {
  // request.options.temperature accepted; implementation will try to map it
}
```

Rules:

1. `toolCalling: true` means `request` accepts function tools, `toolChoice`, assistant `toolCalls`, and `role: "tool"` messages. It does not mean the selected model can call functions, and it does not advertise `{ type: "web_search" }`.
2. `webSearch: true` means `request` accepts `{ type: "web_search" }` in `tools`. It does not mean the selected provider can search, and not whether the origin has a grant. `webSearch` and `toolCalling` are independent: a search-only `tools` array must not require `toolCalling`; function tools must not require `webSearch`.
3. `options.reasoningEffort: true` means `request.options.reasoningEffort` is accepted and the implementation attempts to map it to the provider. It does not mean the selected model supports adjustable thinking. Advertise options **per key**; a bare `options: {}` advertises none. The same per-key rule applies to `options.temperature` and any later `options` keys.
4. An absent key and `false` both mean unsupported. Applications must ignore unknown keys (including unknown keys under `options` and under `output`) so later capabilities can be added without breaking callers. Unknown keys already allow a later draft to add a nested object (for example for MCP) without breaking callers that check `features.webSearch`.
5. The result must not include provider name, model id, or other user or account identity.
6. Implementations that do not support tool calling must reject function tools, `toolChoice` values other than `"auto"` and `"none"`, `role: "tool"` messages, and assistant `toolCalls` with `invalid_request` — including implementations that omit `getFeatures`. A search-only `tools` array (`[{ type: "web_search" }]`) must not be rejected solely for lacking `toolCalling`. `"none"` and `"auto"` remain valid on a search-only request so the page can suppress hosted search without `toolCalling`.
7. Implementations that do not support hosted web search must reject `{ type: "web_search" }` with `invalid_request` — including implementations that omit `getFeatures`. Function tools must not be rejected solely for lacking `webSearch`. Same reject rule as function tools, not the ignore rule used for `options`.
8. If `tools` contains a kind that is not advertised, or an unknown `tools[].type`, the whole request is `invalid_request`. Do not silently drop hosted search or function tools. Extra keys on `{ type: "web_search" }` are ignored (forward compatible).
9. Implementations must **ignore** unsupported `options` keys (must not reject the request solely for including them). Applications may send future keys for forward compatibility; they have no effect until advertised.
10. Advertising `toolCalling` does not guarantee that the user's provider or model will emit `toolCalls`. The model may ignore tools and reply in text. Applications must handle a text-only `done` even when they offered tools. Implementations must not reject a well-formed tools request solely because the current model is weak at function calling.
11. Advertising `webSearch` does not guarantee that the model will actually search, only that the implementation will enable search for providers that can honor it. Applications must still handle a text `done`. If the request includes `{ type: "web_search" }` and the **currently selected** provider cannot honor it (or required extra credentials are missing), do not complete a normal chat reply — see Hosted web search.
12. Advertising an `options` key does not guarantee that the user's provider or model will honor that preference. Implementations map best-effort and must not fail a well-formed request solely because the current model cannot apply the option.
13. `imageInput: true` means `request` accepts `ImagePart`s in `messages` (on `user` and `assistant` roles). It does not mean the selected model can see images, and not whether the origin has a grant. Independent of `imageOutput`.
14. `imageOutput: true` means `request` accepts `output.images` and `done.message` may contain `ImagePart`s. It does not mean the selected model will draw, and not whether the origin has a grant. Independent of `imageInput`. Advertising `imageOutput` does **not** mean the implementation accepts round-tripped assistant image parts without `imageInput`.
15. Implementations that do not support image input must reject `ImagePart`s in `messages` with `invalid_request` — including implementations that omit `getFeatures`. Do not drop image parts and answer as if they were seen. Same reject rule as function tools, not the ignore rule used for `options`.
16. Implementations that do not support image output must reject `output.images: true` with `invalid_request` — including implementations that omit `getFeatures`. Extra keys under `output` are ignored (forward compatible). If the page does not set `output.images: true`, implementations must not put `ImagePart`s on `done.message` (text only, as today).
17. Advertising `imageInput` / `imageOutput` does not guarantee that the user's provider or model can see or draw. Applications must still handle a text-only `done` when they set `output.images: true`. If the request includes image parts and/or `output.images: true` and the **currently selected** provider cannot honor that, do not complete a normal chat reply — see Images.

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

`options` alone does not require a new permission prompt and does not widen a persistent grant. Implementations **may** let the user override or clamp values such as `reasoningEffort` or `temperature` in extension settings (or optionally in the approval UI). Override and clamp controls are **optional** extension UX — this draft does **not** require them on the permission prompt or elsewhere. Consent remains origin + provider/model (+ tools and image input/output when present).

### Tool calling

Function tools are defined and **executed by the page**. The implementation relays JSON schemas, `toolCalls`, and `role: "tool"` results; it must not run application tool handlers or widen host permissions in order to execute tools.

This draft specifies function tools and hosted web search (see Hosted web search). Other hosted tool types (for example MCP) are out of scope. The implementation is not an agent runtime: the page owns any multi-round function-tool loop (send tools → receive `toolCalls` → execute → send `role: "tool"` results → repeat). Hosted search turns stay hidden from the page.

#### Request

- `tools`, when present, must be a non-empty array of function tools and/or `{ type: "web_search" }`. Mixed arrays are allowed only when **both** `toolCalling` and `webSearch` are advertised; if the array contains a kind that is not advertised, the whole request is `invalid_request`. `parameters` on a function tool is a JSON Schema object for the function arguments. `{ type: "web_search" }` has no `function` and no parameters in this draft.
- `toolChoice` remains a function-tool control. When omitted and `tools` is present, it defaults to `"auto"` (the model may reply in text or call function tools). `"none"` suppresses function calls **and** hosted search. `"required"` asks for at least one function call; a function object forces that function. `"auto"`, `"required"`, and a named function do not force a web search. There is no `{ type: "web_search" }` variant of `toolChoice` in this draft.
- `role: "tool"` messages must include `toolCallId` (the `id` from the corresponding `ToolCall`) and string `content` (usually JSON text). They must not include `toolCalls` or `reasoning`.
- Assistant messages may include `toolCalls` (non-empty when present). `content` may be `null` when the turn is tool-only. `toolCalls[].function.arguments` is a JSON string, not a parsed object.
- `system` and `user` messages must not include `toolCalls` or `toolCallId`. `system` `content` is always a string. `user` `content` may be a string or a `ContentPart[]` (see Images).

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

A persistent allow grant for text chat does not cover a later request that includes `tools`, or a wider tool set than the grant records. A function-tools grant does not cover `{ type: "web_search" }`, and a hosted-search grant does not cover function tools. Implementations must prompt again in those cases, including when a persistent grant already exists for the origin.

When a request includes function tools, the permission UI must list the function names so the user can see what the site is authorizing the model to request. Showing descriptions is optional. Hosted search has its own disclosure (see Hosted web search). Request-content preview remains optional (see Security).

Implementations may treat a follow-up that only appends `role: "tool"` results for the just-approved assistant `toolCalls` as the same permission episode, so a multi-round tool loop does not re-prompt on every round. Adding or removing `{ type: "web_search" }` is a wider tool set and needs a new prompt (or a covering grant). A new user turn, a new or wider `tools` list, or a history that is not a continuation of that episode requires a new prompt (or a covering persistent grant). Those follow-ups often have no second preview: tool result bodies can reach the provider without appearing in the Allow UI.

Applications SHOULD make the data a tool will return to the provider inspectable **before** the user allows inference. Do not rely on a later `role: "tool"` message for that disclosure. Practical options (any one can suffice):

- Include the data, or a faithful truncated copy, in the first `messages` so an implementation preview can show it.
- Name the class of data in the tool `description` (for example “returns the user’s currently loaded social posts”).
- Disclose it in the page UI next to the action that starts `request`.

This is a `SHOULD`, not a `MUST`. Live or huge tool results cannot always be inlined on the first turn. The requirement is honesty about what will be sent, not stuffing every payload into `messages`. Applications must not assume the permission UI reveals message content or later tool-result rounds.

### Hosted web search

Hosted web search is **not page-executed**. The implementation (or the selected provider) runs it. The page must not see `toolCalls` / `role: "tool"` turns for `web_search`, and must not implement `execute.web_search`.

`getFeatures().webSearch === true` means the implementation **accepts the type**, not that every provider will search, and not that the origin has a grant.

```ts
const features = window.inference.getFeatures?.() ?? {};
if (features.webSearch) {
  for await (const chunk of window.inference.request({
    method: "chat",
    messages: [{ role: "user", content: "What's the weather in New York City today?" }],
    tools: [{ type: "web_search" }],
  })) {
    if (chunk.type === "delta") {
      // append chunk.content — search is folded into the assistant text
    }
  }
}
```

Mixed arrays are allowed when both flags are advertised:

```ts
tools: [
  { type: "web_search" },
  {
    type: "function",
    function: { name: "get_weather", parameters: { type: "object" } },
  },
]
```

#### Execution and stream

Stream shape is unchanged: `accepted` → optional `reasoning_delta` / `delta` → `done`. Search is folded into the assistant text. Citations, source lists, and search-status chunks are out of scope; implementations may put links in `message.content` as ordinary text.

Who runs the search is an implementation detail (provider-hosted vs extension-executed, including a hidden local loop such as Ollama → ollama.com), as long as the page contract is the same.

#### `toolChoice`

`"none"` means “do not use tools this turn.” Hosted search is a tool, so `"none"` suppresses it as well as function calls. Pages that keep `{ type: "web_search" }` in `tools` can still disable it for a given turn without rebuilding the array. Implementations must omit or disable hosted search for that request (not warn-and-continue, and not run a hidden search loop).

`"auto"` / `"required"` / a named function do not force a web search. `"required"` and a named function without `toolCalling` (or without any function tool in `tools`) are `invalid_request`.

#### Permission

A chat-only persistent grant does not cover `{ type: "web_search" }`. A function-tools grant does not cover it either. Hosted search is a distinct identity in the grant.

When `tools` includes `{ type: "web_search" }`, the permission UI must disclose that the provider or implementation will query the public web (and may fetch result pages). Listing a clear hosted-search label is required; showing extra description is optional.

Follow-up rounds that only append `role: "tool"` results for **page** function calls stay in the existing tools episode. Adding or removing `{ type: "web_search" }` is a wider tool set and needs a new prompt (or a covering grant).

#### Provider cannot search

Do **not** warn-and-continue: a successful `done` after the page asked for search, with no search, is a silent capability lie.

If the request includes `{ type: "web_search" }` and the **currently selected** provider cannot honor it (or required extra credentials are missing), do not complete a normal chat reply. Implementations should disable Allow in the permission UI, or fail the request with **`unavailable`**.

Use `unavailable` (not `invalid_request`) for this case:

- `{ type: "web_search" }` on an implementation that advertised `webSearch` is a well-formed request. The failure is that *this* provider or credential set cannot honor it right now — same bucket as a missing key or a provider that is not ready.
- `invalid_request` stays the code for unadvertised `{ type: "web_search" }`, unknown `tools[].type`, and other malformed requests. Using it for a provider mismatch would teach apps that the tool shape itself was wrong.

Prefer disabling Allow so the user never hits the error; if the request still proceeds, throw `unavailable`. Advertising `webSearch` does not guarantee the model will actually search, only that the implementation will enable search for providers that can. Applications must still handle a text `done`.

### Images

Vision and image generation stay on `method: "chat"`. One `ImagePart` type is used in `messages` and on `done.message`. String `content` remains valid. Do not hang image generation under `options` (unsupported options are ignored; silently not generating is the same class of lie as dropping `{ type: "web_search" }`). Do not add a page-facing `{ type: "image_generation" }` tool in this draft; implementations may map `output.images` to a provider tool internally.

`getFeatures().imageInput` / `imageOutput` report **API surface**, not whether the current model can see or draw, and not whether the origin has a grant. The flags are independent, like `toolCalling` / `webSearch`.

```ts
const features = window.inference.getFeatures?.() ?? {};

// Vision Q&A (image input only)
if (features.imageInput) {
  for await (const chunk of window.inference.request({
    method: "chat",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this photo?" },
          { type: "image", url: "https://example.com/photo.png" },
        ],
      },
    ],
  })) {
    if (chunk.type === "delta") {
      // append chunk.content
    }
  }
}

// One-shot generate (image output only)
if (features.imageOutput) {
  for await (const chunk of window.inference.request({
    method: "chat",
    messages: [{ role: "user", content: "a red fox sticker" }],
    output: { images: true },
  })) {
    if (chunk.type === "done") {
      // done.message.content may be a ContentPart[] with ImageParts,
      // or text only if the model did not draw
    }
  }
}
```

Edit / iterate is both in one request: image parts in `messages` **and** `output.images: true`. Round-trip like `reasoning`: if the next turn should see the picture, send that assistant message back, image parts included. `imageOutput` does **not** imply the implementation will accept those round-tripped parts without `imageInput`.

A non-normative `generateImage` helper can live in `ipa-tools` later without a spec change.

#### Encoding

- **Portable form:** `{ type: "image", mediaType, data }` where `data` is raw base64 (not a `data:` URL). This is what `done.message` uses.
- **Blob:** On the page-facing API, `data` may be a `Blob`. Browser injectors must accept `Blob` and encode to base64 before crossing into an isolated world or service worker.
- **`{ url }`:** Browser implementations that inject into a document SHOULD accept `{ type: "image", url }` on user and assistant parts and MUST resolve it **in the page** (same CORS as the site) to `{ mediaType, data }` before the provider or a privileged extension world sees the request. Infer `mediaType` from the response (`Content-Type` / `Blob.type`); do not require the page to pass it. Local models stay offline — they still receive bytes. Non-page IPA (for example Node) MAY reject `{ url }` with `invalid_request`. Fetch, CORS, or network failure is `invalid_request`, not a silent drop. `fetch()` CORS is stricter than `<img src>`; prefer Blob/base64 when the page already has bytes.
- **XOR:** A part must have `data` or `url`, not both. Both or neither is `invalid_request`.
- **MIME:** `image/jpeg`, `image/png`, `image/webp`, `image/gif`. Implementations MAY normalize `image/jpg` to `image/jpeg`. Other MIME types are `invalid_request`.
- **Size:** Implementation-defined. Fail closed when the provider or transport rejects. This draft does not set a portable byte cap.
- **No host fetch:** The implementation must not fetch image URLs itself in order to honor `{ url }`. Page-side resolve keeps local models offline and avoids extra host URL-fetch permissions.
- Image parts are not allowed on `system` or `tool` messages.

#### Stream

Stream shape stays text-shaped: `accepted` → optional `reasoning_delta` / `delta` → `done`. No `image_delta` in this draft (same as no streaming `toolCall`s).

- Text-only reply: `content` is a string; concatenating `delta`s produces it.
- Reply with images: `content` is a `ContentPart[]`; concatenating `delta`s produces the concatenation of the `type: "text"` parts, in order. Image parts appear only on `done`.
- Image-only reply: `content` is `[{ type: "image", ... }, ...]`, zero `delta`s. Keep `null` / `""` as “no text” for tool-only turns; do not use `null` for “here is a PNG.”

#### Permission

A persistent chat grant covers neither image parts in `messages` nor `output.images`. `imageInput` and `imageOutput` are distinct grant identities (photos leaving the page vs paying for / receiving generated media), sibling to tools — not stuffed into the tools fingerprint. A request that includes image parts **and** `output.images` needs both.

Permission UI must disclose each. Thumbnails stay optional like today’s content preview.

#### Provider cannot see or draw

Do **not** warn-and-continue: a successful `done` after the page sent image parts, as if they were seen, is a silent capability lie. Same for `output.images: true` with no generation path.

If the request includes image parts and/or `output.images: true` and the **currently selected** provider cannot honor that (or required extra credentials are missing), do not complete a normal chat reply. Implementations should disable Allow in the permission UI, or fail the request with **`unavailable`**.

Use `unavailable` (not `invalid_request`) for this case:

- Image parts / `output.images` on an implementation that advertised the matching flag is a well-formed request. The failure is that *this* provider or model cannot honor it right now — same bucket as hosted search.
- `invalid_request` stays the code for unadvertised image parts / `output.images`, malformed parts, and other malformed requests.

Prefer disabling Allow so the user never hits the error; if the request still proceeds, throw `unavailable`. Advertising `imageOutput` does not mean the model will draw. Applications must still handle a text-only `done`.

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

Implementations may show a truncated preview of request content in the permission UI to support informed consent. Previewing content is optional; applications must not assume the UI reveals message content, including `role: "tool"` payloads on a later round of the same permission episode. Implementations may emphasize some messages and collapse others (for example by role) without changing the request sent to the provider.

Function tools run in the page. A site that offers tools can cause the model to request those functions with attacker-influenced arguments (including via retrieved or user-supplied text). Implementations must not execute page-defined tools, and must not treat a chat-only persistent grant as consent for tools. Listing function names at approval time is required so the user can refuse a tools request independently of chat.

Hosted web search is implementation- or provider-executed, not page-executed. The page never sees `web_search` `toolCalls` and must not run a page-side search handler. A chat-only grant and a function-tools grant each do not cover `{ type: "web_search" }`. Listing a hosted-search label at approval time is required so the user can refuse public-web lookup independently of chat and of page function tools. Implementations that fetch result pages (not only a search index) must disclose that fetch, not only “web search”.

Image parts in `messages` and `output.images` are each distinct from chat, function tools, and hosted search. A chat-only grant covers neither. Listing an image-input label when `messages` contain `ImagePart`s, and an image-output label when `output.images` is true, is required so the user can refuse photos leaving the page independently of receiving generated media. Thumbnails in the permission UI are optional. The host must not fetch `{ url }` itself; page-side resolve keeps local models offline.

### Out of scope for this draft

- `method: "image"` (would duplicate chat and force a later migration)
- Image parts on `system` or `tool` messages
- Streaming partial images (`image_delta`)
- Size / quality / aspect-ratio enums (later `options` keys, ignore-if-unsupported)
- Embeddings, speech, or audio
- Image generation as a page-facing `{ type: "image_generation" }` tool (content parts + `output.images` is the canonical surface)
- Other hosted / provider-executed tools (for example MCP)
- Options on `{ type: "web_search" }` such as search filters, recency, or location
- Structured citations / a `sources` field on `done` (links may appear as ordinary text in `message.content`)
- Streaming `toolCall` deltas
- An in-API agent loop (the page still owns the function-tool loop; hosted search turns stay hidden)

Estimated cost in the permission UI is optional extension UX and is not required by this draft.
