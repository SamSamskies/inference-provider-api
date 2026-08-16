# ipa-tools

[![npm](https://img.shields.io/npm/v/ipa-tools)](https://www.npmjs.com/package/ipa-tools)

Application helpers and TypeScript types for the [Inference Provider API](https://github.com/SamSamskies/inference-provider-api) (`window.inference`).

This package is **not** part of the injected API. Streaming stays on `window.inference.request`. Use `ipa-tools` for types, draining a stream to `done`, and the page-executed function-tool loop.

**Status:** `0.x` while IPA is an Experimental Draft.

## Install

```bash
npm install ipa-tools
```

Zero runtime dependencies. Browser ESM only (no Node APIs).

### CDN / no bundler

Native modules cannot resolve the bare specifier `ipa-tools`. Import from a CDN URL (or an import map). Pin a version (`@0.2.0`); for stronger supply-chain control, vendor `dist/` from npm instead of a transforming CDN.

```html
<script type="module">
  import { complete, runTools } from "https://esm.sh/ipa-tools@0.2.0";

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
      "ipa-tools": "https://cdn.jsdelivr.net/npm/ipa-tools@0.2.0/+esm"
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

## `complete`

Drain a stream to one `done` chunk:

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

### When `toolCalling` is not advertised

`getFeatures` is optional; missing it (or omitting `toolCalling`) means tools are not part of the IPA contract. Call `runTools` only when `getFeatures().toolCalling` is true — otherwise the injector must reject `tools` with `invalid_request`. Do not rely on experimental injector surfaces for production apps.

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
| `isInferenceError` | `error.code` check |
| `waitForInference` | Background poll until injected (do not await on first paint) |
| `getInference` / `getFeatures` / `isInferenceAvailable` | Resolve or check `window.inference` |

Out of v1: UI, injecting onto `window.inference`, hosted/MCP tools, streaming `toolCall` chunks.

## License

MIT — see the repository [LICENSE](../../LICENSE).
