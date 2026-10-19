# ipa-tools

[![npm](https://img.shields.io/npm/v/ipa-tools)](https://www.npmjs.com/package/ipa-tools)

Application helpers and TypeScript types for the [Inference Provider API](https://github.com/SamSamskies/inference-provider-api) (`window.inference`).

This package is **not** part of the injected API. Streaming stays on `window.inference.request`. Use `ipa-tools` for types, draining a stream to `done`, and the page-executed function-tool loop.

## Install

```bash
npm install ipa-tools
```

Zero runtime dependencies. Browser ESM only (no Node APIs).

### CDN / no bundler

Native modules cannot resolve the bare specifier `ipa-tools`. Import from a CDN URL (or an import map). Pin a version (`@2.0.0`); for stronger supply-chain control, vendor `dist/` from npm instead of a transforming CDN.

```html
<script type="module">
  import { complete, runTools } from "https://esm.sh/ipa-tools@2.0.0";

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
      "ipa-tools": "https://cdn.jsdelivr.net/npm/ipa-tools@2.0.0/+esm"
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
`done.transcript`. `SynthesizeRequest` yields `SynthesisChunk` with MP3
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
is added; iterate `request` for typed answers or assemble MP3 bytes in page code. See the
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

## API surface (v1)

| Export | Role |
| --- | --- |
| Types | SPEC.md types + `Window` augmentation |
| `complete` | Drain `request` to one `done` chunk |
| `runTools` | Page-executed tool loop |
| `createInference` | IPA-first client (`complete` / `request` / `runTools` / `probe()`) |
| `isInferenceError` | `error.code` check |
| `waitForInference` | Background poll until injected (do not await on first paint) |
| `getInference` / `getFeatures` / `isInferenceAvailable` | Resolve or check `window.inference` |

Out of v1: UI, injecting onto `window.inference`, MCP and other unspec'd hosted tools, streaming `toolCall` chunks. Hosted `{ type: "web_search" }` and image content parts (`imageInput` / `imageOutput`, `output.images`) are in the types.

## License

MIT — see the repository [LICENSE](../../LICENSE).
