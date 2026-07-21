# IPA Demo Extension

Minimal Manifest V3 Chrome extension that implements [`SPEC.md`](../../SPEC.md) by injecting `window.inference` and routing chat requests to **OpenAI**.

API keys stay in the extension. Page scripts never see them.

## Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `examples/extension`
5. Open the extension **Options** page (or click the toolbar icon)
6. Paste your OpenAI API key and choose a default model
7. Click **Save**

## Try it

On any top-level HTTPS page (or `http://localhost`), open DevTools and run:

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

The extension prompts for permission (**Allow** / **Deny**, with optional **Remember for this site**) unless the origin was previously always-allowed or blocked.

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
    providers/
      registry.js                # add providers here
      openai.js                  # OpenAI streaming adapter
  ui/
    options.html|.js             # API key + default model
    approval.html|.js            # origin permission prompt
    shared.css
```

To add another provider later: implement the same `streamChat` shape as [`src/providers/openai.js`](src/providers/openai.js), register it in [`src/providers/registry.js`](src/providers/registry.js), and extend the options/approval UI to choose among providers.

## Security behavior

- Injects only into top-level frames
- Requires a secure context (`https:` or `localhost` / loopback `http:`)
- Does not inject into `file:` pages
- Permission is per HTTP(S) origin
- Request validation happens in the extension before any provider call
- OpenAI credentials are read only inside the service worker

## Manual checks

- [ ] `window.inference` exists on `https://example.com` after install
- [ ] Missing on an `http://` non-localhost page (or request fails with `unavailable`)
- [ ] Missing on `file://` pages
- [ ] First request shows the approval popup; Deny → `permission_denied`
- [ ] Remember + Deny blocks the origin; later requests fail with `permission_denied` without prompting
- [ ] Unblock in Options restores the permission prompt
- [ ] Allow once works without persisting; Remember + Allow appears under Options
- [ ] Streaming yields `delta` chunks then a single `done`
- [ ] `done.message.content` matches concatenated deltas
- [ ] AbortSignal / tab close produces `aborted`
- [ ] Empty API key yields `unavailable` with a setup hint

## Demo limitations

- OpenAI only
- Text chat only (no tools, images, embeddings, speech)
- No `file:` / opaque-origin pages
- No cost estimate in the approval UI
- Cross-realm errors are reconstructed as `Error` objects with a `code` property
