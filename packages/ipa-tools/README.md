# ipa-tools

[![npm](https://img.shields.io/npm/v/ipa-tools)](https://www.npmjs.com/package/ipa-tools)

Application helpers and TypeScript types for the [Inference Provider API](https://github.com/SamSamskies/inference-provider-api) (`window.inference`).

This package is **not** part of the injected API. Streaming stays on `window.inference.request`. Use `ipa-tools` for types, draining a chat stream to `done`, page-executed function-tool loops, lightweight agents, and IPA-first clients with optional fallbacks.

## Install

```bash
npm install ipa-tools
```

Zero runtime dependencies. Browser ESM only (no Node APIs).

### CDN / no bundler

Native ES modules cannot resolve the bare specifier `ipa-tools`. Import from a pinned CDN URL (or an import map); for stronger supply-chain control, vendor `dist/` from npm instead of a transforming CDN.

```html
<script type="module">
  import { complete } from "https://esm.sh/ipa-tools@3.4.0";

  const { message } = await complete({
    method: "chat",
    messages: [{ role: "user", content: "Hello" }],
  });
  console.log(message);
</script>
```

Import map equivalent:

```html
<script type="importmap">
  {
    "imports": {
      "ipa-tools": "https://cdn.jsdelivr.net/npm/ipa-tools@3.4.0/+esm"
    }
  }
</script>
<script type="module">
  import { complete } from "ipa-tools";
</script>
```

A `<script type="module" src="...">` tag does **not** put exports on `window` — still use `import { ... }`.

## `complete`

Drain a chat stream to its final `done` chunk:

```ts
import { complete } from "ipa-tools";

const { model, message, usage } = await complete({
  method: "chat",
  messages: [{ role: "user", content: "Hello" }],
});
```

In tests, pass a mock `request` in the second argument to override `window.inference.request`:

```ts
const done = await complete(
  { method: "chat", messages: [{ role: "user", content: "Hello" }] },
  {
    request: async function* () {
      yield {
        type: "done",
        model: "test",
        message: { role: "assistant", content: "Hi" },
      };
    },
  }
);
```

`complete()` is chat-only. If the stream ends without `done`, it throws `provider_error` (`Stream ended without a done chunk.`). Errors from `request` are re-thrown as-is.

## `createAgent`

An optional wrapper around `runTools()` that bundles system `instructions` and named function tools. Each `agent.run()` manages the tool loop and emits typed activity events. See [Topic Explorer](https://samsamskies.github.io/inference-provider-api/research/) ([source](../../examples/research/)) for a full browser-native research agent.

Paste this into DevTools on a page with IPA enabled and a tool-capable model:

```js
const { createAgent } = await import("https://esm.sh/ipa-tools@3.4.0");

const agent = createAgent({
  name: "Clock",
  instructions: "Use the clock tool to answer questions about the current time.",
  tools: {
    getCurrentTime: {
      description: "Get the current date and time in UTC",
      parameters: { type: "object", properties: {} },
      execute: () => new Date().toISOString(),
    },
  },
});

const result = await agent.run("What time is it in UTC?");
console.log(result.stopReason === "end_turn" ? result.output : "Round limit reached.");
```

For tools that accept arguments, add `validateArguments` (see [Tool validation and app approval](#tool-validation-and-app-approval)) or validate them inside `execute`: parsed arguments are `unknown`, and JSON Schema only describes the tool to the model.

### Multi-turn conversations

The agent object is **stateless between runs**. Each run returns the full conversation as `result.messages`; pass `{ history: result.messages }` to continue it:

```js
const followUp = await agent.run("What date is that?", { history: result.messages });
console.log(followUp.output);
```

A leading `system` message in `history` is replaced with the agent's current `instructions`, so reusing `result.messages` never stacks duplicate system prompts. Each run has independent state, even when runs overlap.

### Result, events, and cancellation

- **`AgentRunResult`** extends `RunToolsResult` (`messages`, `final`, `stopReason`) and adds `output` (extracted text from the final assistant message, or `""` for `max_rounds` / nontext output).
- **`maxRounds`** defaults to `5` (positive integer). Last-round tools still execute before returning `stopReason: "max_rounds"`. `options` and `toolChoice` pass through on every round.
- **`signal`** is forwarded to every inference request and to each executor's second argument (`{ signal }`). Cancellation rejects with `aborted` and emits `agent_failed` (plus `tool_failed` if it interrupts a tool's validation, approval, or execution).
- **Capability check:** The default route resolves `window.inference` and requires `getFeatures().toolCalling === true` when tools are declared (text-only agents need no tool flag).
- **Testing / custom clients:** Pass `request` to `createAgent()` to inject a mock or wrap `createInference()` (`request: (req) => inference.request(req)`).

```ts
const testAgent = createAgent({
  name: "Test",
  instructions: "Be concise.",
  request: async function* () {
    yield { type: "done", model: "mock", message: { role: "assistant", content: "Hello" } };
  },
});
console.log((await testAgent.run("Hi")).output); // "Hello"
```

`AgentEvent` is a synchronous, ordered discriminated union with `agentName` on every event:

| `type` | Additional fields / meaning |
| --- | --- |
| `agent_started` | Run started (after input and `maxRounds` checks) |
| `request_accepted` | A provider round yielded `accepted` |
| `text_delta` / `reasoning_delta` | `content`, when emitted by the provider |
| `tool_started` | `id`, `name`, parsed `arguments`; before validation, approval, and execution |
| `tool_approval_requested` | `id`, `name`, parsed `arguments`, `round`, `maxRounds`, `signal`, declared `tool`; before `onApprovalRequest` |
| `tool_completed` | `id`, `name`, serialized `result` |
| `tool_failed` | `id`, `name`, original `error` |
| `agent_completed` | Full `result` (check `result.stopReason` for `max_rounds`) |
| `agent_failed` | Original `error` (the run promise rejects with the same error) |

Observer exceptions propagate, except in `agent_completed` and `agent_failed`, which preserve the run result or original error. Tool failures reject the run rather than sending error strings back to the model. Tool IDs come from the provider, so scope them to the current run in your UI.

Use `runTools()` directly when you need separate declaration/executor maps, hosted `{ type: "web_search" }`, `output.images`, or individual callbacks.

## `runTools`

Page-executed multi-round function-tool loop (chat-only):

```ts
import { runTools } from "ipa-tools";

const { final, messages } = await runTools({
  messages: [{ role: "user", content: "What's the weather in Austin?" }],
  tools: [
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
  ],
  execute: {
    async get_weather({ city }) {
      return { city, tempC: 22 };
    },
  },
  onDelta(content) {
    console.log(content);
  },
});
```

Handlers run in the page; `ipa-tools` never talks to providers or sees API keys.

- **`options`** (`temperature`, `reasoningEffort`) are forwarded on every round.
- **`maxRounds`** (default `5`) caps provider calls. If the last round requests tools, handlers still execute and the call resolves with `stopReason: "max_rounds"`. A final text reply resolves with `stopReason: "end_turn"`. Use `maxRounds: 1` to execute tools once without a follow-up model turn.
- **Callbacks:** `onAccepted`, `onDelta`, `onReasoningDelta`, `onToolCall({ id, name, arguments })`, `onToolResult({ id, name, result })`, and `onToolError({ id, name, error })`. All callbacks are synchronous; exceptions propagate.

### Tool validation and app approval

Inference Bridge's origin grants permit inference and offered tool descriptions — they do **not** approve page-side actions such as sending messages, deleting data, or making purchases. Mark consequential tools with `requiresApproval: true` and confirm them in your app before executing.

With `createAgent`, put `validateArguments` and `requiresApproval` on each tool and pass `onApprovalRequest` to `agent.run()`:

```ts
const agent = createAgent({
  name: "Drafts",
  instructions: "Help manage drafts. Ask before deleting one.",
  tools: {
    deleteDraft: {
      description: "Delete a draft by ID",
      parameters: {
        type: "object",
        properties: { draftId: { type: "string" } },
        required: ["draftId"],
        additionalProperties: false,
      },
      validateArguments(args) {
        if (!args || typeof args !== "object" || Array.isArray(args)) return false;
        const value = args as Record<string, unknown>;
        return (
          Object.keys(value).length === 1 &&
          typeof value.draftId === "string" &&
          /^[a-zA-Z0-9_-]{1,80}$/.test(value.draftId)
        );
      },
      requiresApproval: true,
      async execute(args, { signal }) {
        const { draftId } = args as { draftId: string };
        const response = await fetch(`/api/drafts/${draftId}`, { method: "DELETE", signal });
        if (!response.ok) throw new Error("Draft deletion failed");
        return { deleted: true }; // Return only bounded, non-secret data.
      },
    },
  },
});

const controller = new AbortController();
await agent.run("Delete draft abc", {
  signal: controller.signal,
  maxToolResultChars: 8_000,
  onApprovalRequest: ({ name, arguments: args }) =>
    window.confirm(`Allow ${name} with arguments ${JSON.stringify(args)}?`),
});
```

With `runTools()` (or `createInference().runTools()`), pass a `toolPolicies` map alongside `tools` and `execute`:

```ts
toolPolicies: {
  search: {}, // Explicitly opt out of validation and approval
  deleteDraft: { validateArguments: validateDraftArguments, requiresApproval: true },
},
onApprovalRequest: ({ name, arguments: args }) =>
  window.confirm(`Allow ${name} with arguments ${JSON.stringify(args)}?`),
maxToolResultChars: 8_000,
```

Key rules:

- **Explicit coverage:** When `toolPolicies` is supplied, every called tool must have an own entry (`{}` opts out). `createAgent` builds entries for all declared tools automatically when any tool opts in.
- **Validation:** `validateArguments(args, context)` (sync or async) runs before approval and execution and must return strictly `true` (otherwise the run rejects with `invalid_request`). Arguments are not transformed; with policies configured, parsed arguments are deeply frozen before observers, hooks, and executors see them.
- **Approval:** For `requiresApproval: true`, `onApprovalRequest(req)` (sync or async) must return strictly `true` — a missing handler, `false`, or any other value rejects with `permission_denied` without calling `execute`. Every call needs its own approval, including in the last round. No retry or error string is sent to the model, and earlier side effects are not rolled back.
- **Context fields:** Both validator context and `ToolApprovalRequest` receive `{ id, name, round, maxRounds, signal, tool }` (`ToolApprovalRequest` also includes `arguments`).
- **Cancellation:** Validation and approval waits reject immediately with `aborted` when `signal` aborts, even if the hook's promise never settles. Use `signal` inside hooks to dismiss UI or cancel async work, and `AbortSignal.timeout()` if you want an overall time limit.
- **Security & result size:** Tool results are sent to the selected provider. Redact secrets and personal data inside your handler before returning, and render model/tool output safely. Set `maxToolResultChars` (positive safe integer, UTF-16 code units) to reject oversized serialized results before `onToolResult` or the next model turn.

### Capability checks

`getFeatures` is optional; a missing flag means unsupported. Check each flag independently before using it:

- `getFeatures().toolCalling` — function tools (`runTools` / `createAgent`)
- `getFeatures().webSearch` — hosted `{ type: "web_search" }` (provider-executed; do **not** put `web_search` in `execute`)
- `getFeatures().imageInput` — `ImagePart` in messages
- `getFeatures().imageOutput` — `output: { images: true }`

## `createInference`

IPA-first client exposing `complete`, `request`, `runTools`, and `probe()`. Omit options for IPA-only usage (throws `unavailable` when no injector is present). Never mutates `window.inference`.

```ts
import { createInference } from "ipa-tools";

const inference = createInference();

sendButton.addEventListener("click", async () => {
  const { message } = await inference.complete({
    method: "chat",
    messages: [{ role: "user", content: input.value }],
  });
  reply.textContent = message.content ?? "";
});
```

Pass `fallbacks` (at most one `InferenceBackend`) to fall back only when IPA is unavailable. `isInferenceAvailable()`, `getInference()`, and `waitForInference()` remain injector-only.

```ts
import { createInference } from "ipa-tools";
import { createPromptApiBackend } from "ipa-prompt-api-fallback";

const inference = createInference({
  fallbacks: [createPromptApiBackend()],
  onDownloadProgress(loaded) {
    status.textContent = `Downloading on-device model… ${Math.round(loaded * 100)}%`;
  },
});

const status = await inference.probe();
// { ipa: "unavailable", promptApi: "downloadable" }
```

See the [`ipa-prompt-api-fallback`](../ipa-prompt-api-fallback) README for Chrome Prompt API requirements and caveats.

### Routing rules for non-chat methods

- An available `window.inference` injector always takes precedence: an unadvertised method fails with `invalid_request`, and an advertised route's `unavailable`, `permission_denied`, or `provider_error` propagates without falling back.
- Fallbacks are checked via `backend.getFeatures()` **before** `backend.create()` (and checked again on the created/cached client), so chat-only backends are skipped without creating sessions or starting downloads:
  - **`decide`:** Requires `methods.decide === true`. Requests with `attachments` also require every attachment's `mediaType` in `decisionMedia.imageMediaTypes`.
  - **`transcribe`:** Requires `methods.transcribe` and matches known declared/Blob MIME types against `acceptedMedia` (URLs with unknown MIME are left to implementation validation).
  - **`synthesize`:** Requires the requested output type to be advertised (`synthesize: true` advertises `audio/mpeg` only; an object advertises its `outputMediaTypes`). Omitted `output` or `output.mediaType` requests `audio/mpeg`.

### Custom HTTP fallback

Pass any object implementing `InferenceBackend` (consent, quotas, and auth stay in your app). Live examples: [Trending Nostr](https://trendingnostr.vercel.app) and [Advanced Nostr Search](https://advancednostrsearch.vercel.app).

```ts
import {
  createInference,
  makeInferenceError,
  type InferenceBackend,
  type InferenceRequest,
  type InferenceChunkFor,
  type ChatChunk,
} from "ipa-tools";

type ApiReply = { content: string; model: string };

function createHostedBackend(): InferenceBackend {
  const features = {
    toolCalling: false,
    options: { reasoningEffort: true, temperature: true },
  } as const;

  return {
    id: "hosted-api",
    getFeatures: () => features,
    async probe() {
      try {
        const res = await fetch("/api/infer", { method: "GET" });
        return res.ok ? "available" : "unavailable";
      } catch {
        return "unavailable";
      }
    },
    async create() {
      return {
        getFeatures: () => features,
        request<R extends InferenceRequest>(req: R): AsyncIterable<InferenceChunkFor<R>> {
          const stream: AsyncIterable<ChatChunk> = (async function* () {
            if (req.method !== "chat") {
              throw makeInferenceError("invalid_request", "This backend only supports chat.");
            }
            const res = await fetch("/api/infer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: req.messages,
                ...(req.options ? { options: req.options } : {}),
              }),
              signal: req.signal,
            });
            if (!res.ok) {
              throw makeInferenceError("provider_error", `HTTP ${res.status}`);
            }

            const { content, model } = (await res.json()) as ApiReply;
            yield { type: "accepted" as const };
            yield {
              type: "done" as const,
              model,
              message: { role: "assistant" as const, content },
            };
          })();
          return stream as AsyncIterable<InferenceChunkFor<R>>;
        },
      };
    },
  };
}

const inference = createInference({ fallbacks: [createHostedBackend()] });
```

Fallback backends are **not** IPA and must not be assigned to `window.inference`.

## Discovery & error helpers

Check availability immediately so a missing extension never blocks first paint. Use `waitForInference()` in the background only if you want to pick up late injection.

```ts
import {
  isInferenceAvailable,
  getFeatures,
  waitForInference,
  isInferenceError,
  complete,
} from "ipa-tools";

if (isInferenceAvailable()) {
  const features = getFeatures();
  // enable UI
} else {
  // show unavailable now — do not await waitForInference on first paint
  void waitForInference()
    .then(() => {
      // extension appeared; enable UI
    })
    .catch(() => {
      // still missing after timeout; stay unavailable
    });
}

try {
  await complete({ method: "chat", messages: [{ role: "user", content: "Hi" }] });
} catch (error) {
  if (isInferenceError(error) && error.code === "aborted") {
    // cancelled by user
  }
}
```

`getInference()` throws immediately if `window.inference` is missing. Always prefer `isInferenceError(error)` over `instanceof` — injectors may reconstruct errors across isolated worlds.

## Types & method-specific streams

Importing `ipa-tools` (or its types) augments `Window` so `window.inference.request(...)` is typed. There is **no** package-level `request` export.

```ts
import type { ChatRequest, ChatChunk, ChatDoneChunk, DoneChunk } from "ipa-tools";

const request: ChatRequest = {
  method: "chat",
  messages: [{ role: "user", content: "Hello" }],
};
// ChatChunk ends in ChatDoneChunk (done.message). DoneChunk is an alias for ChatDoneChunk.
```

Concrete requests infer their method-specific chunk streams automatically without casts:

```ts
import { createInference } from "ipa-tools";

const client = createInference();

// Speech synthesis -> SynthesisChunk (audio_delta + metadata-only done.audio)
for await (const chunk of client.request({ method: "synthesize", text: "Hello" })) {
  if (chunk.type === "audio_delta") console.log(chunk.data); // Uint8Array
  if (chunk.type === "done") console.log(chunk.audio.byteLength);
}

// Typed decisions -> DecisionChunk (accepted, then done.answers)
for await (const chunk of client.request({
  method: "decide",
  state: { text: "Server is down in prod!" },
  questions: {
    urgent: { type: "noul", instructions: "Is this urgent?" },
  },
})) {
  if (chunk.type === "done") {
    const answer = chunk.answers.urgent;
    if (answer.type !== "refusal") console.log(answer.noul);
  }
}
```

- **Speech:** `TranscribeRequest` accepts `media: { data: Blob }`, `{ data: string, mediaType }` (raw base64), or `{ url, mediaType? }` and yields `TranscriptionChunk` (`done.transcript`). `SynthesizeRequest` yields `SynthesisChunk` (MP3 or WAV `audio_delta`s and metadata-only `done.audio`). See the [speech examples](../../examples/speech/README.md) (including the [format-aware Blob example](../../examples/speech/README.md#text-to-an-mp3-or-wav-blob)).
- **Decisions:** `DecideRequest` yields `DecisionChunk` (`DecisionDoneChunk`) with `NoulQuestion` / `ChoiceQuestion` / `ScoreQuestion` and `NoulAnswer` / `ChoiceAnswer` / `ScoreAnswer` / `RefusalAnswer`. Optional inline `attachments` (`DecisionImageAttachment`) require `decisionMedia.imageMediaTypes` in addition to `methods.decide === true`. Always check `answer.type === "refusal"` before reading values. See [SPEC.md](../../SPEC.md#typed-decisions-system-one) and the [native image demo](../../examples/decisions/README.md#native-image-demo).
- **Generic / union callers:** `InferenceRequest` and `InferenceChunk` are all-method unions. Use `InferenceChunkFor<R>` / `InferenceDoneFor<R>` for generic code, and narrow `done` by payload:

```ts
import type { Inference, InferenceRequest } from "ipa-tools";

async function display(ipa: Inference, request: InferenceRequest) {
  for await (const chunk of ipa.request(request)) {
    if (chunk.type !== "done") continue;
    if ("message" in chunk) console.log(chunk.message.content);
    else if ("answers" in chunk) console.log(chunk.answers);
    else if ("transcript" in chunk) console.log(chunk.transcript.text);
    else console.log(chunk.audio.byteLength);
  }
}
```

## API surface

| Export | Role |
| --- | --- |
| Types | [SPEC.md](../../SPEC.md) types + `Window` augmentation |
| `complete` | Drain a chat `request` stream to its `done` chunk |
| `runTools` | Page-executed function-tool loop (chat) |
| `createAgent` | Instructions, named function tools, and typed events over `runTools` |
| `createInference` | IPA-first client (`complete` / `request` / `runTools` / `probe()`) |
| `isInferenceError` / `makeInferenceError` | Check or construct `InferenceError` objects |
| `isInferenceAvailable` / `getInference` / `getFeatures` | Synchronously check or read `window.inference` |
| `waitForInference` | Background poll until `window.inference` is injected |
| `parseToolArguments` / `serializeToolResult` | Tool argument parsing and result serialization helpers |
| `MAX_FALLBACKS` | Maximum fallback entries accepted by `createInference` (`1`) |

Out of scope: UI, injecting onto `window.inference`, MCP or other unspec'd hosted tools, streaming `toolCall` chunks.

## Migration

### Migrating to 3.0.0

- `SynthesisMediaType` (`"audio/mpeg" | "audio/wav"`) is exported, and `methods.synthesize` is now `boolean | { outputMediaTypes: SynthesisMediaType[] }`.
- Pages that previously checked `methods.synthesize === true` must also handle the object form to discover WAV or object-advertised MP3 support.
- Custom `Inference` implementations must validate the requested output format and return matching MIME metadata. Omitted-format requests still mean MP3.

### Migrating to 2.0.0

- `InferenceRequest` / `InferenceMethod` now include `"decide"`, and `InferenceChunk` includes `done.answers`. Add a decision branch to exhaustive method/result handlers.
- Custom `Inference` implementations must reject unadvertised methods with `invalid_request` before yielding.
- Chat aliases, `DoneChunk`, `complete()`, and `runTools()` are unchanged.

### Migrating to 1.0.0

- `InferenceRequest` and `InferenceChunk` became all-method unions. Code assuming chat should use `ChatRequest`, `ChatChunk`, and `ChatDoneChunk` (`DoneChunk` remains `ChatDoneChunk`).

## License

MIT — see the repository [LICENSE](../../LICENSE).
