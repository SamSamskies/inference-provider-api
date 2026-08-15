# Examples review rules

## CDN imports of published packages are intentional

Demos under `examples/` should load published packages the way real consumers do (pinned CDN ESM imports such as `https://esm.sh/ipa-tools@0.1.0`, jsDelivr, or an import map to the same). That is the point of the demo: show the public package API, not a vendored copy of `packages/*/dist`.

Do **not** flag:

- Runtime dependence on a CDN / npm registry for `ipa-tools` (or similar published helpers) in example HTML
- GitHub Pages only copying static HTML without bundling `packages/`
- Suggestions to vendor `dist/`, switch to relative `./ipa-tools/` imports, or rewrite the demo to call `window.inference` directly just to avoid the CDN

Do flag real bugs in demo logic (null handling, broken parse paths, incorrect API usage, etc.).
