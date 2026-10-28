# ipa-tools

[![npm](https://img.shields.io/npm/v/ipa-tools)](https://www.npmjs.com/package/ipa-tools)

Application helpers and TypeScript types for the [Inference Provider API](https://github.com/SamSamskies/inference-provider-api) (`window.inference`).

This package is **not** part of the injected API. Streaming stays on `window.inference.request`. Use `ipa-tools` for types, draining a stream to `done`, the page-executed function-tool loop, and lightweight agents.

## Install

```bash
npm install ipa-tools
```

Zero runtime dependencies. Browser ESM only (no Node APIs).

### CDN / no bundler

Native modules cannot resolve the bare specifier `ipa-tools`. Import from a CDN URL (or an import map). Pin a version (`@3.1.0`); for stronger supply-chain control, vendor `dist/` from npm instead of a transforming CDN.

```html
<script type="module">
  import { complete, runTools } from "https://esm.sh/ipa-tools@3.1.0";

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
      "ipa-tools": "https://cdn.jsdelivr.net/npm/ipa-tools@3.1.0/+esm"
    }
  }
</script>
<script type="module">
  import { complete } from "ipa-tools";
  // …
</script>
```

A module `src=` tag does **not** put exports on `window` — still use `import { … }`.

## Types

```ts
import type { InferenceRequest, InferenceChunk } from "ipa-tools";
// or: import "ipa-tools";
```

Importing the package (or its types) augments `Window` so `window.inference.request(...)` is typed. There is **no** package-level `request` / `stream` export.

### Migrating to 3.0.0

`SynthesisMediaType` (`audio/mpeg` or `audio/wav`) is now exported, and
`methods.synthesize` is a boolean or `{ outputMediaTypes: SynthesisMediaType[] }`.
Existing injectors may keep `true` for MP3 only. Pages that previously compared
only with `=== true` must also read the object form to discover WAV or
object-advertised MP3 support. Custom implementations must validate the
requested format and return matching MIME metadata. Existing MP3 requests and
omitted-format behavior stay unchanged.

### Migrating to 2.0.0

`InferenceRequest` / `InferenceMethod` now include `decide`, and `InferenceChunk`
includes `done.answers`. Add a decision branch to exhaustive method/result
handlers; the union example below shows how. Custom `Inference` implementations
must reject unadvertised methods with `invalid_request` before yielding.
Concrete chat/speech requests still infer their existing results. Chat-specific
aliases, `DoneChunk`, `complete()`, and `runTools()` keep their contracts.

### Method-specific streams

Since 1.0.0, `InferenceRequest` and `InferenceChunk` are all-method unions. Code that
previously used them to mean chat must use the narrow aliases:

```ts
import type { ChatRequest, ChatChunk, ChatDoneChunk, DoneChunk } from "ipa-tools";
const request: ChatRequest = {
  method: "chat", messages: [{ role: "user", content: "Hello" }],
};
// ChatChunk has done.message. DoneChunk remains exactly ChatDoneChunk.
```

Concrete requests infer their own chunks without casts:

```ts
import { createInference } from "ipa-tools";
const client = createInference();
for await (const chunk of client.request({ method: "synthesize", text: "Hello" })) {
  if (chunk.type === "audio_delta") console.log(chunk.data); // Uint8Array
  if (chunk.type === "done") console.log(chunk.audio.byteLength);
}
```

`TranscribeRequest` uses `media: { data: Blob }`, `{ data: string, mediaType }`
(raw base64), or `{ url, mediaType? }`. It yields `TranscriptionChunk` with
`done.transcript`. `SynthesizeRequest` yields `SynthesisChunk` with MP3 or WAV
`audio_delta`s and metadata-only `done.audio`. Exported usage and done types are
`TranscriptionUsage`, `SynthesisUsage`, `TranscriptionDoneChunk`, and
`SynthesisDoneChunk`. `TranscriptionMediaSource` and
`TranscriptionInputConstraint` describe sources and discovery constraints.

`DecideRequest` yields `DecisionChunk`, ending in `DecisionDoneChunk`.
`DecisionState` / `DecisionJsonValue`, `DecisionQuestion` (`NoulQuestion`,
`ChoiceQuestion`, `ScoreQuestion`), and `DecisionAnswer` (`NoulAnswer`,
`ChoiceAnswer`, `ScoreAnswer`, `RefusalAnswer`) describe the bounded contract.

Check `window.inference?.getFeatures?.().methods?.decide` before sending a
decision. The user selects the provider/model and grants decision permission
separately from chat or speech. Iterate `request({ method: "decide", state,
questions })` for `accepted` then `done.answers`; there are no deltas. Check
each answer's `type` for refusal before consuming probabilities or values.
See the spec's [decision example and validation rules](../../SPEC.md#typed-decisions-system-one).
An injector's experimental decision namespace does not advertise stable support.

For callers holding a union, `InferenceChunkFor<R>` distributes over `R`;
`InferenceDoneFor<R>` extracts its final result. Narrow a union's final chunk
by its payload, since `type: "done"` is shared:

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

`complete()` and `runTools()` remain chat-only. No decision/speech function or collector
is added; iterate `request` for typed answers or assemble encoded audio bytes in page code. See the
[browser examples](../../examples/speech/README.md). Detect advertised speech
methods before use; older injectors may omit them.

## `createInference`

IPA-first client with `complete` / `request` / `runTools` / `probe()`. Omit options for IPA only (same `unavailable` when no extension is installed). Does not mutate `window.inference`.

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

Optional `fallbacks` (at most one entry) can supply a page-side `InferenceBackend` after IPA is unavailable — compatibility adapters only, not IPA. `isInferenceAvailable()` / `getInference()` / `waitForInference()` stay injector-only.

Decisions and speech require a backend-level `getFeatures()` snapshot advertising the
requested method before `create()` is called. Transcription also matches a
known declared/Blob MIME essence to `acceptedMedia`; unknown URL MIME is left
for page-side resolution and implementation validation. Selection does not
fetch URLs or inspect media bytes. Container/codec constraints and conflicting
declared/detected MIME types must be validated by the backend. Features on the
created client are checked again, including for cached clients. An available
injector always takes precedence: its unadvertised method is `invalid_request`,
and an advertised route's `unavailable`, permission denial, or provider error
is propagated without silently trying another provider.

For synthesis, both snapshots must advertise the requested output type.
`synthesize: true` supports MP3 only; an object supports exactly its nonempty
`outputMediaTypes`. Omitted `output` or `output.mediaType` requests MP3 even
when only WAV is advertised. Unknown or unadvertised types are `invalid_request`
before backend creation/request; a chosen route's advertised-but-unavailable
format error remains `unavailable` without fallback. No encoder or provider is
silently substituted. The helper routes and delegates streams; provider output
validation and approval-route filtering remain implementation responsibilities.
See the [format-aware Blob example](../../examples/speech/README.md#text-to-an-mp3-or-wav-blob).

For decisions, both the backend and created client must advertise
`methods.decide: true`. A chat-only backend is skipped before `create()`,
including downloads or session setup; there is no decision-to-chat emulation.

Apps import backend packages themselves (no string aliases in `ipa-tools`):

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

Chrome Prompt API requirements, download disclosure, and mapping caveats live in the [`ipa-prompt-api-fallback`](../ipa-prompt-api-fallback) README. That path is **not** an IPA implementation.

### Hosted / custom HTTP fallback

Pass any object that implements `InferenceBackend`. A minimal same-origin JSON endpoint looks like this (consent, quotas, and auth headers stay in your app):

```ts
import {
  createInference,
  makeInferenceError,
  type InferenceBackend,
  type InferenceRequest,
  type InferenceChunkFor,
  type ChatChunk,
} from "ipa-tools";

/** Your `/api/infer` POST handler should return this JSON shape. */
type GeminiApiReply = { content: string; model: string };

function createGeminiApiBackend(): InferenceBackend {
  const features = {
    toolCalling: false,
    options: { reasoningEffort: true, temperature: true },
  } as const;

  return {
    id: "gemini-api",
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

            // Trust the endpoint contract (see GeminiApiReply).
            const { content, model } = (await res.json()) as GeminiApiReply;

            yield { type: "accepted" as const };
            yield {
              type: "done" as const,
              model,
              message: { role: "assistant" as const, content },
            };
          })();
          // Non-chat methods throw before yielding; TypeScript cannot narrow R.
          return stream as AsyncIterable<InferenceChunkFor<R>>;
        },
      };
    },
  };
}

const inference = createInference({
  fallbacks: [createGeminiApiBackend()],
});
```

This path is **not** IPA and must not be assigned to `window.inference`.

## `complete`

Drain a chat stream to one `done` chunk:

```ts
import { complete } from "ipa-tools";

const { model, message, usage } = await complete({
  method: "chat",
  messages: [{ role: "user", content: "Hello" }],
});
```

In tests, pass a mock via the second argument to override `window.inference.request`:

```ts
const mockRequest = async function* () {
  yield {
    type: "done",
    model: "test",
    message: { role: "assistant", content: "Hi" },
  };
};

const options = { request: mockRequest };

const done = await complete(
  { method: "chat", messages: [{ role: "user", content: "Hello" }] },
  options
);
```

If the stream ends without `done`, throws `provider_error` (`Stream ended without a done chunk.`). Errors from `request` are re-thrown as-is.

## `createAgent`

An optional wrapper around `runTools()`. Define system instructions and named
function tools together; each `run()` builds the conversation and delegates the
loop.

Paste this into your browser's DevTools console on a page with IPA enabled and
a model that supports function tools:

```javascript
const { createAgent } = await import("https://esm.sh/ipa-tools@3.1.0");

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

console.log(
  result.stopReason === "end_turn"
    ? result.output
    : "Round limit reached."
);
```

This tool takes no arguments. For tools that accept arguments, add
`validateArguments` (see [tool policies](#tool-validation-and-app-approval)) or
validate them in `execute` before performing work: parsed arguments are `unknown`,
and JSON Schema describes the tool to the model without validating its output.

The helper maintains message history during each run, including assistant tool
calls and tool results, and returns the full conversation as `result.messages`.
The agent object is **stateless between runs**: it does not automatically save
that history. Pass `{ history: result.messages }` to continue a conversation.
Omitting `history` starts a new conversation:

```javascript
const followUp = await agent.run("What date is that?", { history: result.messages });
console.log(followUp.output);
```

`name` labels events; `instructions` supplies the system message. Supplied
`history` precedes the current user input. A leading system message in `history`
is replaced with the current instructions, so reusing `result.messages` from this
agent or another does not stack two system prompts. Each run has independent
state, including when runs overlap. Creating an agent does not resolve IPA or
send a request.

`AgentRunResult` extends `RunToolsResult`: `messages`, `final`, and `stopReason`
remain available. `output` extracts text from the final assistant message
(joining text parts if needed). It is `""` for `max_rounds` and nontext output.
Streamed text may include intermediate commentary; it is not the final answer.
`maxRounds` defaults to 5 and must be a positive integer. Last-round tools still
execute before a `max_rounds` result. `options` and `toolChoice` pass through on
every provider call.

`AgentEvent` is a discriminated union with `agentName` on every event:

| `type` | Additional fields / meaning |
| --- | --- |
| `agent_started` | Run has begun, after input/`maxRounds` checks |
| `request_accepted` | A provider round was accepted |
| `text_delta` / `reasoning_delta` | `content`, when the provider emits it |
| `tool_started` | `id`, `name`, parsed `arguments`; before validation, approval, and execution |
| `tool_approval_requested` | `id`, `name`, parsed `arguments`, `round`, `maxRounds`, `signal`, and declared `tool`; before the app approval handler |
| `tool_completed` | `id`, `name`, serialized `result`; the content returned by the app's handler |
| `tool_failed` | `id`, `name`, original `error` |
| `agent_completed` | Full `result`; check its `stopReason` for a round limit |
| `agent_failed` | Original `error`; the run promise rejects with the same error |

Events are synchronous and ordered. Observers should not throw; their exceptions
propagate, except `agent_completed` and `agent_failed`, which preserve the run
result or original error. A parsing or missing-handler failure emits
`tool_failed` without `tool_started`; a malformed call lacking an ID/name fails
the run without a tool event. Validation, approval, executor, serialization, and cancellation failures reject the run;
errors are not converted to tool content or retried. Tool IDs come from the
provider, so scope them to the current run in your UI.

`signal` reaches every inference request and each executor's second argument.
Executors must pass it to their own asynchronous work to stop promptly. The loop
checks cancellation before further execution and after work returns; it cannot
interrupt a handler or custom request that ignores its signal. Cancellation is
an `agent_failed` event with an `aborted` error, and a `tool_failed` event if it
interrupts a tool's validation, approval, or execution.

The default route resolves the current `window.inference` and requires
`getFeatures().toolCalling === true` when tools are declared. Missing discovery
or a missing flag fails before a provider call; a text-only agent needs no tool
flag. This reports an IPA capability, not a guarantee that every selected model
supports tools. Handle provider errors and let users choose a compatible model.

Inject `request` at creation for deterministic tests or a custom client:

```ts
const testAgent = createAgent({
  name: "Test", instructions: "Be concise.",
  request: async function* () {
    yield { type: "done", model: "mock", message: { role: "assistant", content: "Hello" } };
  },
});
console.log((await testAgent.run("Hi")).output); // Hello
```

Custom requests own capability checks. For a `createInference()` client, pass
`request: (req) => inference.request(req)`; its existing feature checks apply.
Use direct `runTools()` below for separate declaration/executor maps, hosted
search tools, image output requests, or its individual callbacks. `createAgent`
adds no runtime dependencies or persistent memory. Validation and approval are
optional app-owned hooks; there is no built-in schema engine or approval UI,
and no change to `window.inference`.

## `runTools`

Page-executed multi-round function-tool loop:

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

Handlers run in the page. The package never talks to providers or API keys.

`options` (`temperature`, `reasoningEffort`) are forwarded on every round. `onAccepted` fires when a round yields `accepted`. `maxRounds` (default 5) is the max provider calls: if the last round has `toolCalls`, handlers still run and the result returns with `stopReason: "max_rounds"` instead of throwing. A text `done` is `stopReason: "end_turn"`. Use `maxRounds: 1` to run tools once and stop without a follow-up model turn.

`onToolCall({ id, name, arguments })` fires after argument parsing and policy
lookup, before validation, approval, and execution. `onToolResult({ id, name, result })` fires after successful execution,
cancellation checks, and serialization; `result` is the tool-message string.
`onToolError({ id, name, error })` reports parsing, missing-handler, policy,
validation, approval, execution, serialization, result-limit, or cancellation errors for calls with a valid ID/name. The loop
still rejects on these errors. These observers are synchronous; exceptions
propagate.

### Tool validation and app approval

These hooks run in the application. Inference Bridge's origin/provider grants
permit inference and offered tool descriptions; they do **not** approve later
page-side actions such as sending a message, deleting data, or making a purchase.
Mark consequential tools with `requiresApproval: true` and collect an explicit
decision in the app before executing them. Read-only tools can omit that flag.

On `createAgent`, put `validateArguments` and `requiresApproval` on each tool,
and pass `onApprovalRequest` to `agent.run()`:

```ts
const agent = createAgent({
  name: "Drafts",
  instructions: "Help manage drafts. Ask before deleting one.",
  tools: {
    deleteDraft: {
      description: "Delete a draft by ID",
      parameters: {
        type: "object", properties: { draftId: { type: "string" } },
        required: ["draftId"], additionalProperties: false,
      },
      validateArguments(args) {
        if (!args || typeof args !== "object" || Array.isArray(args)) return false;
        const value = args as Record<string, unknown>;
        return Object.keys(value).length === 1 && typeof value.draftId === "string" &&
          /^[a-zA-Z0-9_-]{1,80}$/.test(value.draftId);
      },
      requiresApproval: true,
      async execute(args, { signal }) {
        // A boolean validator does not narrow unknown in a separate handler.
        const { draftId } = args as { draftId: string };
        const response = await fetch(`/api/drafts/${draftId}`, { method: "DELETE", signal });
        if (!response.ok) throw new Error("Draft deletion failed");
        return { deleted: true }; // Return only bounded, nonsecret information.
      },
    },
  },
});

const controller = new AbortController();
await agent.run("Delete draft abc", {
  signal: controller.signal,
  maxToolResultChars: 8_000,
  onApprovalRequest: ({ name, arguments: args }) => {
    return window.confirm(`Allow ${name} with arguments ${JSON.stringify(args)}?`);
  },
});
```

When the model requests `deleteDraft`, the helper pauses and calls
`onApprovalRequest`. Clicking **OK** returns `true`, so `execute` runs. Clicking
**Cancel** returns `false`, so the tool never executes and the run rejects with
`permission_denied`. `requiresApproval` itself does not display a dialog; your
callback does. A custom dialog can return a `Promise<boolean>` instead.

For `runTools()` (also `createInference().runTools()`), supply a separate
`toolPolicies` map alongside `tools` and `execute`:

```ts
toolPolicies: {
  search: {}, // Explicitly run without validation or approval.
  deleteDraft: { validateArguments: validateDraftArguments, requiresApproval: true },
},
onApprovalRequest: ({ name, arguments: args }) => {
  return window.confirm(`Allow ${name} with arguments ${JSON.stringify(args)}?`);
},
maxToolResultChars: 8_000,
```

If `toolPolicies` is supplied, every called tool needs an **own** entry; missing
entries stop the run. `{}` explicitly opts a tool out of both guards. An agent
creates entries for all its declared tools when any tool opts in. Without any
policy hooks, existing callers keep their previous behavior.

`validateArguments(args, context)` may be synchronous or asynchronous and must
return exactly `true`. JSON parsing alone does not validate the declared schema.
Use a small predicate or adapt your schema library, checking required fields,
types, extra properties, lengths, and app constraints. A configured validator
returning `false`, `undefined`, or another value fails with `invalid_request`;
thrown/rejected errors propagate. Validation precedes approval and execution.
No arguments are transformed. Tools without a validator remain unvalidated.

The validator context and `ToolApprovalRequest` include tool-call `id`, `name`,
one-based provider `round`, `maxRounds`, the run's `signal`, and the declared
function `tool` when available (including its parameter schema). Approval adds
parsed `arguments`. Policies are copied at run start. With policies configured,
parsed arguments are deeply frozen for observers, hooks, and executors, so the
approved values cannot change while a decision is pending. Clone them in a
handler if local mutation is needed.

For a required tool, only an approval response of exactly `true` permits the
handler to run. A missing handler, `false`, or an invalid response rejects the
run with `permission_denied`; thrown/rejected approval errors propagate. There
is no retry, automatic grant, or error content sent to the model. The remaining
tools and provider rounds stop; earlier side effects are not rolled back.
A later failure in the same assistant turn does not return `result.messages`,
so a retry must not send that tool-call turn with only some `role: "tool"`
replies; start a new user turn or include a result for every call.
`onToolError` reports the failure. Agents emit `tool_approval_requested` before
the hook, followed by `tool_failed` and `agent_failed` on refusal/error. An
approval event observer may abort or throw to stop before the hook is called.

Validation and approval waits reject promptly with `aborted` when cancelled,
even if the hook's promise never settles. Late decisions cannot execute tools;
late rejections are consumed. Hooks should still use `signal` to stop their work
and dismiss UI. Cancellation cannot undo a handler's side effects or interrupt
a synchronous callback. Every call needs its own approval, including calls in
the last allowed round; `maxRounds` still bounds provider calls, not tool count,
elapsed time, or side effects. Use `AbortSignal.timeout()` or an app controller
for a time limit.

Handlers, hooks, events, errors, and returned history are page-side data and can
expose secrets to page code or logs. Tool descriptions, input messages, and tool
results can reach the selected model/provider. Redact secrets and personal data
**inside the handler before returning**; return only task-relevant fields and
bound external data before assembling a result. `maxToolResultChars` optionally
rejects oversized serialized results before `onToolResult` or another model
request (positive safe integer, UTF-16 code units, no truncation; unset preserves
existing behavior). It does not redact, cap memory during serialization, or undo
execution. Treat model arguments and retrieved tool content as untrusted, render
them safely in the UI, and enforce authorization on your server. These hooks
provide neither a remote sandbox nor a guarantee that arbitrary tools are safe.

### When `toolCalling`, `webSearch`, `imageInput`, or `imageOutput` is not advertised

`getFeatures` is optional; missing it (or omitting a flag) means that capability is not part of the IPA contract. Call `runTools` with function tools only when `getFeatures().toolCalling` is true. Send `{ type: "web_search" }` only when `getFeatures().webSearch` is true. Send `ImagePart`s only when `getFeatures().imageInput` is true. Set `output.images: true` only when `getFeatures().imageOutput` is true. The flags are independent: a search-only `tools` array must not require `toolCalling`; one-shot generate does not require `imageInput`. Hosted search is not page-executed — do not put `web_search` on `execute`. Do not rely on experimental injector surfaces for production apps.

## `waitForInference` / `getInference` / `getFeatures` / `isInferenceError`

Check immediately so a missing extension does not delay first paint. Poll in the background only if you want to pick up late injection.

```ts
import {
  waitForInference,
  getFeatures,
  isInferenceAvailable,
  isInferenceError,
} from "ipa-tools";

if (isInferenceAvailable()) {
  const features = getFeatures();
  // enable UI
} else {
  // show unavailable now — do not await waitForInference here
  void waitForInference()
    .then(() => {
      // extension appeared; enable UI
    })
    .catch(() => {
      // still missing after timeout; stay unavailable
    });
}

try {
  await complete({ method: "chat", messages: […] });
} catch (error) {
  if (isInferenceError(error) && error.code === "aborted") {
    // …
  }
}
```

`getInference()` throws immediately if it is missing. Prefer `isInferenceError` over `instanceof` — injectors may reconstruct errors across isolated worlds.

## API surface

| Export | Role |
| --- | --- |
| Types | SPEC.md types + `Window` augmentation |
| `complete` | Drain `request` to one `done` chunk |
| `runTools` | Page-executed tool loop |
| `createAgent` | Instructions, named function tools, and typed activity events over `runTools` |
| `createInference` | IPA-first client (`complete` / `request` / `runTools` / `probe()`) |
| `isInferenceError` | `error.code` check |
| `waitForInference` | Background poll until injected (do not await on first paint) |
| `getInference` / `getFeatures` / `isInferenceAvailable` | Resolve or check `window.inference` |

Out of scope: UI, injecting onto `window.inference`, MCP and other unspec'd hosted tools, streaming `toolCall` chunks. Hosted `{ type: "web_search" }` and image content parts (`imageInput` / `imageOutput`, `output.images`) are in the types.

## License

MIT — see the repository [LICENSE](../../LICENSE).
