# Examples review rules

## CDN imports of published packages are intentional

Demos under `examples/` should load published packages the way real consumers do (pinned CDN ESM imports such as `https://esm.sh/ipa-tools@0.3.1`, jsDelivr, or an import map to the same). That is the point of the demo: show the public package API, not a vendored copy of `packages/*/dist`.

Do **not** flag:

- Runtime dependence on a CDN / npm registry for `ipa-tools` (or similar published helpers) in example HTML
- GitHub Pages only copying static HTML without bundling `packages/`
- Suggestions to vendor `dist/`, switch to relative `./ipa-tools/` imports, or rewrite the demo to call `window.inference` directly just to avoid the CDN
- Demos treating `window.inference` presence as sufficient for readiness (without a separate `isSupportedContext()` / secure-context guard). The bridge only injects on supported origins; dual-checking `file:`, opaque `"null"`, or non-loopback `http:` is optional polish, not a required demo fix.

## Failed Nostr filter keeps the last successful slice

In `examples/nostr/index.html`, a filter run that does not successfully apply `show_notes` (missing tool call, invalid args, or parse failure) should show an error and leave `visibleIds` / `appliedFilter` unchanged. Clearing the previous filter would make the new query look like it matched the full feed.

Do **not** flag keeping prior results on a failed refilter. Do flag treating invalid or missing `show_notes` as a successful apply.

Do flag real bugs in demo logic (null handling, broken parse paths, incorrect API usage, etc.).
