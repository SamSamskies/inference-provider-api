# IPA Demo Extension

Minimal Manifest V3 Chrome extension that implements [`SPEC.md`](../../SPEC.md) by injecting `window.inference` and routing chat requests to a user-chosen provider (**OpenAI** or local **Ollama**).

API keys stay in the extension. Page scripts never see them.

## Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `examples/extension`
5. Open the extension **Options** page (or click the toolbar icon)
6. Choose a default provider:
   - **OpenAI** — paste your API key and choose a default model
   - **Ollama** — no API key; models are listed from your local Ollama install
7. Click **Save**

## Try it with OpenAI

1. Set **Default provider** to OpenAI and save an API key
2. On any top-level HTTPS page (or `http://localhost`), open DevTools and run the snippet below

## Try it with Ollama (no API key)

1. [Install Ollama](https://ollama.com/download) and start it (default: `http://localhost:11434`)
2. Pull at least one chat model, for example:

   ```bash
   ollama pull gemma4
   ```

3. In extension Options, set **Default provider** to **Ollama** (enabled only when Ollama is reachable and has at least one model)
4. Confirm the model dropdown populates from `GET /api/tags` (installed models only)
5. Click **Save**
6. Run the snippet below on an HTTPS or localhost page

If Ollama is not installed or not running, the **Ollama** option stays disabled with help text under the provider selector. Start Ollama, pull a model, then click **Check again** in Options.

This demo strips the `chrome-extension://` `Origin` header on requests to local Ollama (see root [SPEC.md](../../SPEC.md) / [README.md](../../README.md)). After updating the extension, use **Reload** on `chrome://extensions` so that rule is installed. If you still see HTTP 403, you can fall back to restarting Ollama with `OLLAMA_ORIGINS=chrome-extension://*`, but origin stripping is the preferred approach.

## Example request

```js
for await (const chunk of window.inference.request({
  method: "chat",
  messages: [{ role: "user", content: "Say hello in one short sentence." }],
})) {
  if (chunk.type === "delta") {
    console.log("delta", chunk.content);
  } else if (chunk.type === "done") {
    console.log("done", chunk.model, chunk.message, chunk.usage);
  }
}
```

The extension prompts for permission (**Allow** / **Deny**, with optional **Remember for this site**) unless the origin was previously always-allowed or blocked. The approval UI lets you choose **provider and model** for that grant.

Abort example:

```js
const controller = new AbortController();
const iter = window.inference.request({
  method: "chat",
  messages: [{ role: "user", content: "Write a long poem." }],
  signal: controller.signal,
});

setTimeout(() => controller.abort(), 500);

try {
  for await (const chunk of iter) {
    console.log(chunk);
  }
} catch (err) {
  console.log(err.code); // "aborted"
}
```

## Layout

```text
examples/extension/
  manifest.json
  background/service-worker.js   # permissions + orchestration
  content/inject.js              # MAIN world: window.inference
  content/content-script.js      # ISOLATED relay
  src/
    errors.js
    validate.js
    storage.js
    permissions.js
    ollama-origin-bypass.js      # strip chrome-extension Origin for local Ollama
    providers/
      registry.js                # add providers here
      openai.js                  # OpenAI streaming adapter
      ollama.js                  # Ollama /api/tags + /api/chat adapter
  ui/
    options.html|.js             # provider + model + API key
    approval.html|.js            # origin permission prompt
    shared.css
```

To add another provider later: implement the same provider shape as [`src/providers/openai.js`](src/providers/openai.js) / [`src/providers/ollama.js`](src/providers/ollama.js), register it in [`src/providers/registry.js`](src/providers/registry.js), and extend the options/approval UI if it needs credentials beyond the shared provider selector.

If you are building your own IPA extension with local providers, follow the Origin-stripping guidance in root [SPEC.md](../../SPEC.md) / [README.md](../../README.md) and reuse or adapt [`src/ollama-origin-bypass.js`](src/ollama-origin-bypass.js). That approach needs the Chrome permission `declarativeNetRequestWithHostAccess` plus loopback `host_permissions`. DNR can only rewrite traffic for those hosts; keep both the permission’s host scope and the rules tight (prefer `http://localhost:11434/*`, and do not apply header stripping to remote APIs). See the root README “Local providers” section for the security tradeoff versus `OLLAMA_ORIGINS`.

## Security behavior

- Injects only into top-level frames
- Requires a secure context (`https:` or `localhost` / loopback `http:`)
- Does not inject into `file:` pages
- Permission is per HTTP(S) origin and records the chosen provider + model
- Request validation happens in the extension before any provider call
- OpenAI credentials are read only inside the service worker
- Ollama traffic stays on `http://localhost:11434` (fixed for this demo)
- Local Ollama requests drop the extension `Origin` header (avoids Ollama's default 403 for `chrome-extension://`)

## Manual checks

- [ ] `window.inference` exists on `https://example.com` after install
- [ ] Missing on an `http://` non-localhost page (or request fails with `unavailable`)
- [ ] Missing on `file://` pages
- [ ] First request shows the approval popup with provider + model; Deny → `permission_denied`
- [ ] Remember + Deny blocks the origin; later requests fail with `permission_denied` without prompting
- [ ] Unblock in Options restores the permission prompt
- [ ] Allow once works without persisting; Remember + Allow appears under Options with provider + model
- [ ] Streaming yields `delta` chunks then a single `done`
- [ ] `done.message.content` matches concatenated deltas
- [ ] AbortSignal / tab close produces `aborted`
- [ ] Empty OpenAI API key (OpenAI selected) yields `unavailable` with a setup hint
- [ ] Ollama model list comes from `/api/tags` (not a hardcoded list)
- [ ] Ollama unavailable / no models → provider option disabled with help text (Options + approval)
- [ ] Ollama Check again enables the option after Ollama is running with models
- [ ] Ollama chat from the webapp succeeds after approving (no HTTP 403)
- [ ] Switching default provider does not rewrite existing origin grants

## Demo limitations

- OpenAI and local Ollama only (Ollama fixed at `http://localhost:11434`)
- Text chat only (no tools, images, embeddings, speech)
- No `file:` / opaque-origin pages
- No cost estimate in the approval UI
- Cross-realm errors are reconstructed as `Error` objects with a `code` property
