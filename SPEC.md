Inference Provider API
======================

`window.inference` capability for web browsers
----------------------------------------------

**Status:** Experimental Draft

`window.inference` may be injected by a browser or extension. After checking that it exists, websites call:

```ts
window.inference.request<R extends InferenceRequest>(request: R): AsyncIterable<InferenceChunkFor<R>>
window.inference.getFeatures(): InferenceFeatures
```

`request` is required. `getFeatures` reports optional capabilities (see Feature discovery). Implementations that omit `getFeatures` are treated as advertising none.

```ts
type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

type TextPart = {
  type: "text";
  text: string;
};

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

type ChatRequest = {
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
  output?: {
    images?: boolean;
  };
  /** Generation preferences for this request. See InferenceOptions. */
  options?: InferenceOptions;
  signal?: AbortSignal;
};

/** Finite JSON values only; no cycles, sparse arrays, binary, or custom objects. */
type DecisionJsonValue =
  | null | boolean | number | string
  | DecisionJsonValue[]
  | { [key: string]: DecisionJsonValue };

type DecisionState = string | DecisionJsonValue[] | { [key: string]: DecisionJsonValue };

type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
};

type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  /** 2–26 named choices; null means the key needs no further description. */
  criteria: Record<string, string | null>;
};

type ScoreQuestion = {
  type: "score";
  instructions: string;
  /** 2–10 ordered descriptions, indexed from zero. */
  criteria: string[];
};

type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

type DecideRequest = {
  method: "decide";
  state: DecisionState;
  /** 1–64 questions over the same state; no dependencies between answers. */
  questions: Record<string, DecisionQuestion>;
  signal?: AbortSignal;
};

/** Exactly one page-owned source. String data is raw base64, never a data URL. */
type TranscriptionMediaSource =
  | { mediaType: string; data: string; url?: never }
  | { mediaType?: string; data: Blob; url?: never }
  | { url: string; mediaType?: string; data?: never };

type TranscribeRequest = {
  method: "transcribe";
  media: TranscriptionMediaSource;
  /** Structurally valid BCP 47 hint; omitted means detect. */
  language?: string;
  signal?: AbortSignal;
};

type SynthesisMediaType = "audio/mpeg" | "audio/wav";

type SynthesizeRequest = {
  method: "synthesize";
  text: string;
  /** Omitted output or mediaType means MP3; WAV requires explicit discovery. */
  output?: { mediaType?: SynthesisMediaType };
  signal?: AbortSignal;
};

type InferenceRequest = ChatRequest | DecideRequest | TranscribeRequest | SynthesizeRequest;
type InferenceMethod = InferenceRequest["method"];

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
};

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
    };

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
};

type ChatChunk =
  | { type: "accepted" }
  | { type: "reasoning_delta"; content: string }
  | { type: "delta"; content: string }
  | { type: "done"; model: string; message: Message; usage?: Usage };

type NoulAnswer = { type: "noul"; noul: number };
type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
type RefusalAnswer = { type: "refusal" };
type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer | RefusalAnswer;

type DecisionChunk =
  | { type: "accepted" }
  | { type: "done"; model: string; answers: Record<string, DecisionAnswer>; usage?: Usage };

type TranscriptionUsage = { inputSeconds?: number };
type SynthesisUsage = {
  inputCharacters?: number;
  outputSeconds?: number;
};

type TranscriptionChunk =
  | { type: "accepted" }
  | { type: "delta"; content: string }
  | {
      type: "done";
      model: string;
      transcript: { text: string; language?: string };
      usage?: TranscriptionUsage;
    };

type SynthesisChunk =
  | { type: "accepted" }
  | { type: "audio_delta"; mediaType: SynthesisMediaType; data: Uint8Array }
  | {
      type: "done";
      model: string;
      audio: { mediaType: SynthesisMediaType; byteLength: number };
      usage?: SynthesisUsage;
    };

type InferenceChunk = ChatChunk | DecisionChunk | TranscriptionChunk | SynthesisChunk;

/** Distributes over request unions while preserving concrete method inference. */
type InferenceChunkFor<R extends InferenceRequest> =
  R extends ChatRequest ? ChatChunk :
  R extends DecideRequest ? DecisionChunk :
  R extends TranscribeRequest ? TranscriptionChunk :
  R extends SynthesizeRequest ? SynthesisChunk : never;

type InferenceDoneFor<R extends InferenceRequest> =
  Extract<InferenceChunkFor<R>, { type: "done" }>;
type ChatDoneChunk = InferenceDoneFor<ChatRequest>;
type DecisionDoneChunk = InferenceDoneFor<DecideRequest>;
type TranscriptionDoneChunk = InferenceDoneFor<TranscribeRequest>;
type SynthesisDoneChunk = InferenceDoneFor<SynthesizeRequest>;

type TranscriptionInputConstraint = {
  /** Normalized MIME essence; no wildcards. */
  mediaType: string;
  containers?: string[];
  audioCodecs?: string[];
};

type InferenceFeatures = {
  /** Chat is required. Absent or false optional methods mean unsupported. */
  methods?: {
    decide?: boolean;
    transcribe?: { acceptedMedia: TranscriptionInputConstraint[] };
    /** true means MP3 only; an object declares exactly its nonempty format list. */
    synthesize?: boolean | { outputMediaTypes: SynthesisMediaType[] };
  };
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
};

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
};

type InferenceErrorCode =
  | "permission_denied"
  | "invalid_request"
  | "unavailable"
  | "provider_error"
  | "aborted";

type InferenceError = Error & {
  code: InferenceErrorCode;
};

type Inference = {
  request<R extends InferenceRequest>(request: R): AsyncIterable<InferenceChunkFor<R>>;
  getFeatures?(): InferenceFeatures;
};

/** Compatible chat-only alias; never widened to the all-method done union. */
type DoneChunk = ChatDoneChunk;
```

`InferenceError` is an `Error` with a `code` property. Across extension isolated worlds, implementations may reconstruct errors from a serializable `{ name, message, code }` shape rather than preserving a subclass. Applications should check `error.code`, not `instanceof`.

Text chat (`method: "chat"` with `system` / `user` / `assistant` string messages) is required. Typed decisions (`method: "decide"`), bounded transcription (`method: "transcribe"`) and bounded speech synthesis (`method: "synthesize"`), tool calling, hosted web search, image input/output, and request `options` (for example `reasoningEffort`, `temperature`) are optional; implementations advertise them with `getFeatures`. String `content` on user and assistant messages stays valid so existing apps do not break.

The method determines the chunk union: chat yields `ChatChunk`, decisions yield
`DecisionChunk`, transcription yields `TranscriptionChunk`, and
synthesis yields `SynthesisChunk`. The conditional mapping distributes over an
`InferenceRequest` union. Equivalent overloads must also accept a union-typed
request. `ChatRequest`, `ChatChunk`, and `ChatDoneChunk` retain the narrow chat
contract; `DoneChunk` remains an alias of `ChatDoneChunk`.

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
2. The user chooses the provider and model, or the extension uses the route previously saved for that origin and method. Synthesis also binds the user-selected voice; pages cannot select it.
3. API keys never leave the extension. Applications never see them.
4. If a request fails, iteration throws an `InferenceError`. A failed request does not yield a `done` chunk.
5. `request` yields exactly one `accepted` chunk after the origin is permitted and the request is cleared to call a provider — including when a persistent grant already exists and no prompt is shown. `accepted` does not mean the user clicked Allow in a UI; applications must not assume a prompt occurred. Failures during permission or preflight do not yield `accepted`.
6. After `accepted`, a successful request yields method-specific chunks, then exactly one `done` chunk. No chunks follow `done`. Chat yields zero or more `reasoning_delta` and/or `delta` chunks (in any order); the chat-specific rules below apply to `method: "chat"`. Decisions follow [Typed decisions](#typed-decisions-system-one); speech follows [Bounded speech](#bounded-speech).
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
if (features.methods?.decide) {
  // decide returns typed answers over a shared JSON state
}
if (features.methods?.transcribe) {
  // transcribe accepts the advertised acceptedMedia constraints
}
if (features.methods?.synthesize) {
  // synthesize returns encoded audio bytes; the page controls format and playback
}
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
4. An absent key and `false` both mean unsupported. Applications must ignore unknown keys (including unknown keys under chat `options` and chat `output`) so later capabilities can be added without breaking callers. Unknown keys already allow a later draft to add a nested object (for example for MCP) without breaking callers that check `features.webSearch`.
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

18. `methods.decide: true` advertises all three typed decision primitives and per-question refusals. `methods.transcribe` advertises bounded transcription and must contain at least one `acceptedMedia` constraint. `methods.synthesize: true` is the legacy MP3-only advertisement; an object declares exactly its nonempty `outputMediaTypes` list, with every entry a `SynthesisMediaType`. A WAV-only implementation may advertise `{ outputMediaTypes: ["audio/wav"] }`. `false` or missing entries mean unsupported; chat remains required without a `methods.chat` entry. Optional methods are independent of one another and of chat capability flags.
19. Unknown or unadvertised methods are `invalid_request`. A well-formed advertised method that the selected provider/model/credentials cannot honor is `unavailable`; do not substitute chat, omit questions, drop media, or silently change the approved route.
20. Transcription constraints use normalized MIME essences and may include lowercase container and audio codec identifiers. Omitted narrower constraints mean no such preflight filter, not verified support for every codec. Speech discovery may describe the identity-free union of possible routes; approval must filter to matching input constraints or requested synthesis formats. Advertising a synthesis format does not guarantee the currently approved provider/model/voice route can produce it. No provider/model/voice identities or account state belong in discovery.

### Request options

`options` is a bag of generation preferences for a chat call — not model selection (the user still chooses provider and model). This draft defines `reasoningEffort` and `temperature`; later drafts may add further keys under the same object. Applications must ignore unknown keys; implementations must ignore keys they do not advertise. Other methods have closed request shapes and do not accept `options` in this draft.

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

### Typed decisions (System One)

`method: "decide"` evaluates a shared `state` against named, typed `questions`.
It returns probabilities and bounded decisions for application code, rather
than a chat message. The vocabulary follows the [TypeSafe primitives](https://docs.typesafe.ai/primitives)
and can be mapped to native decision APIs such as [Ollama System One](https://docs.ollama.com/api/systemone).
Provider protocols, endpoint names, and model catalogs remain implementation details.

#### Decision request and validation

Feature-detect `getFeatures().methods?.decide === true` before use. This flag
describes API support, independently of credentials, installed models, or site
approval. It covers `noul`, `choice`, and `score`; there are no per-provider or
per-primitive discovery flags in this draft.

The request has only `method`, `state`, `questions`, and optional `signal`.
Reject unknown top-level or question fields with `invalid_request`, including
page-selected `provider`, `model`, `keep_alive`, `messages`, `tools`, `output`,
`options`, or `stream`. The user chooses the decision provider and model;
implementations may offer different defaults from chat.

- `state` must be a non-whitespace string, a plain JSON object, or an array.
  Nested JSON values may include strings, booleans, null, and finite numbers.
  Empty objects and arrays are valid state; top-level null, numbers, and booleans
  are not. Reject cycles, undefined values, sparse arrays, non-finite numbers,
  functions, symbols, BigInts, binary objects, and custom objects such as
  `Date`, `Map`, or instances with custom serialization. Do not silently coerce
  or drop non-JSON values. Shared references without cycles are allowed.
- `questions` must be a plain object with 1–64 own entries. Every id must be a
  non-whitespace string; preserve ids exactly in `done.answers`. Each question
  has `type` and non-whitespace string `instructions`, plus `criteria` as below.
  Ids correlate answers; put the actual question in `instructions`.
- All questions are evaluated against the same state independently. An answer
  cannot refer to another answer in the same request. Applications make a later
  request when a decision depends on an earlier result.
- The UTF-8 encoding of `JSON.stringify({ state, questions })` must not exceed
  **63 KiB (64,512 bytes)**. This excludes `method`, `signal`, and provider-added
  fields. Reject deeper than **64 levels**, counting this wrapper as depth 0
  and each object-property or array-element descent as one level, including
  primitive leaves. These are API envelope limits, not a guarantee that every
  selected model has enough context for the maximum input.
- On first iteration, validate and snapshot `state` and `questions` before
  approval or provider I/O. Later page mutations must not alter the approved
  request. `signal` remains a cancellation handle and is never serialized.
  Do not truncate input to fit a route's limits. URLs or image-like strings
  inside state are ordinary data; the implementation must not fetch them or
  interpret them as media attachments.

| Question type | `criteria` | Answer |
| --- | --- | --- |
| `noul` | Optional object with only `"true"` and/or `"false"` string descriptions; either may be omitted | `{ type: "noul", noul }`, where `noul` is the probability of yes in `[0, 1]` |
| `choice` | Object with 2–26 non-whitespace option keys and string or null descriptions; null means the key needs no extra description | `{ type: "choice", choice, probabilities, confidence }` |
| `score` | Array of 2–10 string level descriptions, ordered from index 0 | `{ type: "score", score, legend, probabilities, confidence }` |

This draft deliberately bounds the portable envelope to string instructions
and descriptions. Structured instructions/criteria, media attachments, and
additional primitives supported by some native APIs are outside this envelope.

#### Decision answers and stream

A successful stream is exactly **`accepted` → `done`**. There are no text,
reasoning, audio, or partial-answer deltas. `done` contains a non-whitespace
`model`, `answers`, and optional `usage`; it has no chat `message`, `transcript`,
or synthesis `audio` payload. `usage` uses `inputTokens` / `outputTokens` when
reported, each a nonnegative safe integer; omit unreported usage, never invent it.

`answers` must contain exactly one own entry for every requested id and no
extra ids. Each answer's type must match its question, except that any question
may instead return **`{ type: "refusal" }`**. A refusal is an explicit provider
refusal for that question, not a missing answer, numeric zero, low confidence,
or permission denial. It carries no probability/choice/score fields. Other
questions can still succeed, and even an all-refusal result is a completed
request. Applications must check `answer.type` before reading answer fields.

For non-refused answers:

- Every probability and `confidence` must be finite and in `[0, 1]`.
  Noul has no separate confidence or distribution: near 0.5 means uncertainty
  about yes/no, rather than medium intensity.
- Choice `probabilities` must have exactly the requested option keys. `choice`
  must be one of the highest-probability keys; any tied maximum is valid.
- Score `legend` and `probabilities` must have exactly the zero-based decimal
  string indices `"0"` through `String(criteria.length - 1)`. Each legend value
  must equal the corresponding requested description. `score` is a finite
  probability-weighted level index in `[0, criteria.length - 1]`, possibly
  fractional. Its difference from `sum(index * probability) / sum(probability)`
  must be at most **0.02** to allow rounding.
- Choice and score distributions must sum to 1 within an absolute tolerance
  of **0.02**. Preserve provider probabilities; do not silently renormalize a
  malformed distribution. `confidence` summarizes concentration in that
  distribution; its formula is provider-defined in this draft. It is not a
  guarantee of correctness or a permission to act, and thresholds need
  evaluation for the application's data and selected model.

Implementations must validate the complete upstream result before yielding
`done`. Missing, extra, wrong-type, out-of-range, or inconsistent answers are
`provider_error`; do not expose a partial successful result or turn malformed
answers into refusals. Native wire shapes may be mapped (for example a boolean
predicate to `noul`, or ordered levels to zero-based score indices), but do not
emulate typed decisions by prompting a chat model and parsing generated text or
inventing probabilities. If the selected route cannot honor a well-formed
request, fail with `unavailable` and yield no `done`.

The normal cancellation rules apply during permission and provider work.
Aborting throws `aborted`, cancels in-flight provider work, and yields no
`done`. Stopping iteration must release resources and cancel unfinished work.

#### Decision permission

Decisions require a separate origin-and-method grant. A chat or speech grant
does not authorize `decide`; a decision grant does not authorize those methods.
A persistent grant binds the approved decision provider and model. Changing
that route requires fresh approval; changing global defaults must not rewrite
saved grants. Blocking an origin continues to block every method.

Approval must identify the decision operation, provider/model, and question
ids/types. A state or question-content preview is optional and may be
truncated, but the selected provider receives the complete bounded request.
No request content may reach a provider before permission resolves. Result
values never authorize the implementation to execute application actions;
application code owns how to use the answers.

```js
if (!window.inference?.getFeatures?.().methods?.decide) {
  throw new Error("This IPA implementation does not support typed decisions.");
}
const controller = new AbortController();
try {
  for await (const chunk of window.inference.request({
    method: "decide",
    state: { ticket: "My checkout page is blank after Pay." },
    questions: {
      is_bug: { type: "noul", instructions: "Is this a software defect?" },
      team: {
        type: "choice",
        instructions: "Which team should handle this ticket?",
        criteria: { billing: "Payments and refunds", technical: "Bugs and integrations", other: null },
      },
      urgency: {
        type: "score",
        instructions: "How urgent is the customer's problem?",
        criteria: ["Routine", "Should be fixed soon", "Blocking revenue right now"],
      },
    },
    signal: controller.signal,
  })) {
    if (chunk.type === "accepted") console.log("accepted");
    if (chunk.type === "done") {
      for (const [id, answer] of Object.entries(chunk.answers)) {
        if (answer.type === "refusal") console.log(id, "refused");
        else console.log(id, answer);
      }
    }
  }
} catch (error) {
  console.log(error.code); // permission_denied, invalid_request, unavailable, provider_error, aborted
}
// From a cancel control while awaiting permission/provider: controller.abort().
```

The shared [decision conformance assertions](./packages/ipa-tools/test/conformance/decisions.mjs)
check successful stream order and answer invariants. Mock fixtures verify the
contract; they do not certify live provider availability or model accuracy.

### Bounded speech

Transcription and synthesis are optional variants of the same `request` function.
They use transcription and speech endpoints with operation-specific models and
stream shapes. They are distinct from chat audio: transcription promises a
faithful transcript, while chat may summarize or answer questions. STT and TTS
are capability categories, not additional method names.

#### Transcription sources and validation

`transcribe` accepts a prerecorded, finite media file containing a supported,
decodable audio track. Audio-only files and provider-supported video containers
are valid. The `media` object must contain exactly one source, checked by
property presence rather than truthiness:

- `{ data: string, mediaType }`: non-empty raw base64, never a data URL. An
  explicit advertised media type is required; malformed base64 is rejected.
- `{ data: Blob, mediaType? }`: infer the media type from `Blob.type` when
  omitted. If declared and detected types are present, their normalized values
  must agree.
- `{ url: string, mediaType? }`: fetch a non-empty URL in the page realm, under
  normal page CORS, and convert the response to a bounded source. Use a usable
  response `Content-Type`; a declaration may supply a missing type, but a
  conflicting declared/detected type is `invalid_request`. URL/network/CORS
  failures are `invalid_request`; cancellation is `aborted`.

For example, `{ data: undefined, url: "..." }` violates source exclusivity. A
privileged implementation must never fetch an arbitrary page-supplied media URL.
Page-side URL resolution can occur before approval, once iteration starts; no
media may be sent to a provider before approval.

Normalize MIME parameters, casing, and unambiguous aliases before comparison
(for example `audio/mp3` to `audio/mpeg`, `audio/x-m4a` to `audio/mp4`, and
`audio/wave`, `audio/x-wav`, or `audio/vnd.wave` to `audio/wav`). Transcription
formats are capability-driven, not a universal allowlist. Advertise concrete
MIME types such as `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/webm`,
`video/mp4`, and `video/webm` only when supported. Provider adapters must declare
accepted types and should declare narrower container/audio-codec constraints
when reliably documented. Do not claim generic `video/*` support. Detect and
check narrower constraints when advertised; MIME/container acceptance alone
does not guarantee every audio codec works.

Malformed media, invalid base64, unsupported MIME/container/codec combinations
outside the advertised surface, and inputs exceeding a documented implementation
limit are `invalid_request`. A format mismatch specific to the selected route
after a well-formed advertised request is `unavailable`. Fail before `accepted`
whenever metadata makes the failure knowable; provider decoding can fail later.
A file without a supported audio track must fail with `invalid_request` and a
clear no-audio-track message. Provider-detected silence/no transcribable speech
must fail with a clear `invalid_request`, never an unexplained empty transcript.
Malformed provider responses or inconsistent stream results are `provider_error`.

`language`, when supplied, must be a structurally valid BCP 47 tag. Omission
means detect; it does not request translation. If the selected route cannot
faithfully represent a valid hint, fail with `unavailable` rather than discard it.

Only the audio track has transcription semantics. Visuals, subtitles, and other
non-audio tracks must not influence the transcript; do not inspect frames or
substitute multimodal chat/video understanding. Implementations may pass a
provider-supported container through unchanged and are not required to demux,
decode, extract, or transcode locally. If the selected route cannot accept the
file as supplied, fail clearly instead of silently converting or dropping tracks.
Ignoring visuals is a semantic guarantee, not a guarantee that visual bytes stay
local: disclose when the complete container may leave the page.

#### Synthesis input and output

`synthesize.text` must be a string containing non-whitespace text. Implementations
may set a documented maximum, measured in Unicode code points. The page supplies
no provider, model, voice ID, or voice sample. Those choices belong to the user
and implementation. Speech requests accept only their method-specific fields;
chat fields, page-selected route/voice fields, and unknown speech request or
`media`/`output` fields are `invalid_request` in this draft.

Omitting `output` or `output.mediaType` means `audio/mpeg`, including `output: {}`.
MP3 remains the default; WAV requires explicit `output: { mediaType: "audio/wav" }`
and an object advertisement containing `audio/wav`. Legacy
`methods.synthesize: true` means MP3 only. An object advertisement declares
exactly its nonempty supported format list; it does not implicitly include MP3.
Only the exact canonical values in `SynthesisMediaType` are valid output types;
unknown, aliased, or unadvertised types are `invalid_request`.

A well-formed advertised format unavailable on the user-selected or remembered
provider/model/voice route is `unavailable`. In particular, omitted output still
requests MP3 and fails with `unavailable` on a WAV-only route when MP3 is
advertised elsewhere; if MP3 is not advertised at all, it is `invalid_request`.
Filter approval choices by the requested format. Fail before `accepted` when
support is knowable, and never silently change encoding or providers. A saved
grant does not authorize switching routes to satisfy a different format.
Implementations must document conservative input/output limits and reject before
approval when source metadata makes that possible. The standard fixes no
provider-derived byte cap. Never truncate text or audio to fit a limit silently.

#### Speech stream invariants

The common lazy iteration, permission, error, and cancellation rules apply.
Permission and preflight failures precede `accepted`. A successful stream yields
exactly one `accepted`, then method-specific chunks, then exactly one `done`;
nothing follows `done`. Media bytes may remain in the page through approval;
metadata needed for approval may cross earlier. Implementations may begin a
flow-controlled page-to-implementation upload after `accepted`. A failure during
transfer or provider work throws an `InferenceError` and yields no `done`.
Aborting before or after `accepted`, returning from the iterator, navigation,
and page closure must cancel active transfer/provider work.

Transcription yields zero or more append-only `delta` chunks, then
`done.transcript.text`. When deltas are emitted, their concatenation must equal
the final text exactly. Providers without streaming may return only the final
`done` after `accepted`; this is the explicit exception to delta concatenation.
Do not expose replacement/interim corrections, timestamps, or segment objects.
`done.transcript.language` is optional provider-reported language information.
`usage.inputSeconds` is optional input duration in seconds.

Synthesis yields one or more `audio_delta` chunks, even for a non-streaming
upstream response. Every chunk contains `Uint8Array` encoded bytes and
the requested media type (including the MP3 default). Every `audio_delta.mediaType`
and `done.audio.mediaType` must match that type. Concatenating bytes in order
must reproduce exactly one complete playable file, with the original encoded
bytes preserved. `done.audio.byteLength` must equal that byte count; `done.audio` is
metadata and must not duplicate bytes. `usage.inputCharacters`, when reported,
counts input Unicode code points; `usage.outputSeconds` optionally reports output
duration. Usage is optional and must not be fabricated. Counts and durations
must be finite and nonnegative; byte lengths must be positive safe integers.

For WAV, chunks are transport fragments of one RIFF/WAVE file, not independent
WAV files. The complete file has a single RIFF container with valid sizes,
format information, and audio data; do not prepend a header to every chunk or
label headerless PCM as WAV. A complete unary provider result may be split into
bounded byte chunks with the same backpressure and cancellation rules. Invalid
containers, mismatched MIME types, truncated output, or inconsistent byte counts
are `provider_error` and must not yield a successful `done`.

IPA returns bytes and never starts playback. Pages may construct a `Blob` using
the returned media type, attach controls, and play only following an explicit user
action, subject to browser autoplay policy. See the browser-only
[speech examples](./examples/speech/README.md).

#### Speech permission and privacy

Existing grants are chat-only. Transcription and synthesis require separate
origin-and-method grants. A persistent grant binds the exact provider/model
and, for synthesis, voice. Changing that route requires fresh approval; changing
global defaults must not silently rewrite a saved grant. Blocking an origin
continues to block every method.

Transcription approval must identify the operation, provider/model, media type,
byte size, and container/audio codec/duration when known. For a video container,
disclose that the complete file may be uploaded even though only audio is
transcribed. Synthesis approval must identify generated speech and show the
provider/model/voice and requested output format. A page cannot override the route choice.

Implementations must update privacy disclosures before shipping speech. Recordings
can contain biometric voice data, bystander speech, location/health information,
and background conversations. Extensions must not capture the microphone or
autoplay speech. A page may use browser microphone permission to create a
recording, stop recording, then submit the completed bounded `Blob` with separate
IPA transcription approval; a live microphone stream is out of scope.

### Security

The API is available only to top-level pages in a secure context that have a
tuple origin — typically `https:` and loopback `http:` (`localhost`,
`127.0.0.1`, `[::1]`). Opaque origins, including `file:` documents, are not
supported: permission is scoped to the page's origin, and those contexts do not
provide a stable site identity for grants or blocks.

A persistent allow grant records the provider and model chosen at approval time,
scoped by origin and method (and voice for synthesis); later requests reuse that
approved route. Existing grants migrate as chat-only and authorize neither decisions
nor speech. Changing the approved route requires fresh approval. Blocking an origin
blocks every method. Changing a global
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
- Embeddings
- Decision media attachments, structured instructions/criteria, additional question types, partial answers, and page-selected decision routes or generation controls
- Live/unbounded audio, realtime or duplex speech sessions, and conversational audio understanding through chat
- Transcription translation, timestamps, segments, confidence, diarization, and transcript replacement
- Synthesis formats other than MP3 and WAV (including raw PCM), page-selected model/voice IDs, voice cloning, custom voice enrollment, multi-speaker audio, and speaking-rate/style controls
- Video understanding, frame inspection, OCR, or subtitle extraction through transcription
- Image generation as a page-facing `{ type: "image_generation" }` tool (content parts + `output.images` is the canonical surface)
- Other hosted / provider-executed tools (for example MCP)
- Options on `{ type: "web_search" }` such as search filters, recency, or location
- Structured citations / a `sources` field on `done` (links may appear as ordinary text in `message.content`)
- Streaming `toolCall` deltas
- An in-API agent loop (the page still owns the function-tool loop; hosted search turns stay hidden)

Estimated cost in the permission UI is optional extension UX and is not required by this draft.
