# ipa-tools

Application helpers and TypeScript types for the [Inference Provider API](https://github.com/SamSamskies/inference-provider-api) (`window.inference`).

This package is **not** part of the injected API. Streaming stays on `window.inference.request`. Use `ipa-tools` for types, draining a stream to `done`, and the page-executed function-tool loop.

**Status:** `0.x` while IPA is an Experimental Draft.

## Install

```bash
npm install ipa-tools
```

Zero runtime dependencies. Browser ESM only (no Node APIs).

### CDN / no bundler

Native modules cannot resolve the bare specifier `ipa-tools`. Import from a CDN URL (or an import map). Pin a version (`@0.1.0`); for stronger supply-chain control, vendor `dist/` from npm instead of a transforming CDN.

```html
<script type="module">
  import { complete, runTools } from "https://esm.sh/ipa-tools@0.1.0";

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
      "ipa-tools": "https://cdn.jsdelivr.net/npm/ipa-tools@0.1.0/+esm"
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

Optional `options.request` overrides `window.inference.request` (useful in tests). If the stream ends without `done`, throws `provider_error` (`Stream ended without a done chunk.`). Errors from `request` are re-thrown as-is.

## `runTools`

Page-executed multi-round function-tool loop (port of Inference Bridge’s `runTools`):

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

Zod stays in the app (`parameters: z.toJSONSchema(Schema)` and `Schema.parse` inside `execute`). This package does not depend on Zod.

### Bridge `experimental.request` fallback

Until an implementation advertises `getFeatures().toolCalling` and accepts tools on stable `request`:

```ts
import { getInference, runTools } from "ipa-tools";

const inference = getInference();
const request =
  inference.getFeatures?.().toolCalling
    ? inference.request.bind(inference)
    : // Bridge experimental window — not part of IPA types
      (
        inference as typeof inference & {
          experimental?: { request?: typeof inference.request };
        }
      ).experimental?.request?.bind(
        (inference as { experimental?: object }).experimental
      ) ?? inference.request.bind(inference);

await runTools({ request, messages, tools, execute });
```

Once Bridge graduates tools onto `request`, the default (`window.inference.request`) is enough.

## `getInference` / `getFeatures` / `isInferenceError`

```ts
import { getInference, getFeatures, isInferenceError } from "ipa-tools";

const inference = getInference(); // throws unavailable if missing
const features = getFeatures(); // getInference().getFeatures?.() ?? {}

try {
  await complete({ method: "chat", messages: […] });
} catch (error) {
  if (isInferenceError(error) && error.code === "aborted") {
    // …
  }
}
```

Prefer `isInferenceError` over `instanceof` — injectors may reconstruct errors across isolated worlds.

## API surface (v1)

| Export | Role |
| --- | --- |
| Types | SPEC.md types + `Window` augmentation |
| `complete` | Drain `request` to one `done` chunk |
| `runTools` | Page-executed tool loop |
| `isInferenceError` | `error.code` check |
| `getInference` / `getFeatures` | Resolve `window.inference` |

Out of v1: Zod helpers, UI, injecting onto `window.inference`, hosted/MCP tools, streaming `toolCall` chunks.

## License

MIT — see the repository [LICENSE](../../LICENSE).
