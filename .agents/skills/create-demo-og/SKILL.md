---
name: create-demo-og
description: >-
  Create or update matching Open Graph preview cards and social metadata for demo
  apps in the inference-provider-api repository. Use when adding an OG image or
  share preview to a demo under examples/, or refreshing one of these demo cards.
---

# Create a demo OG image

Keep these cards consistent with the repository's existing visual system. Use the
bundled deterministic renderer for this geometric template; no image-generation
service or API credentials are needed. It requires macOS and Swift with AppKit.

## Choose the content

Read the target demo's `examples/DEMO/index.html` for its visible name, tagline,
accent colors, and canonical `og:url`. Inspect `examples/og/research.png` and one
other existing card for context. The shared layout is 1200 × 630 with a dark green
background, left-aligned title and short tagline, the Inference Provider API label,
and a simple card illustration on the right.

Use the demo's actual name and a short description of what it does. Choose an
accent that remains readable on the dark background; the research card uses
`#5CC7D1`. Keep copy within the text area rather than squeezing it against the
illustration. The renderer reduces the title size when needed and rejects text
that will not fit.

## Render and save

Run from the repository root. Replace the example content and output filename for
the selected demo. The bundled renderer is `scripts/render_og.swift`:

```sh
task_output_dir=$(mktemp -d)
swift .agents/skills/create-demo-og/scripts/render_og.swift \
  --output "$task_output_dir/research.png" \
  --title 'Topic Explorer' \
  --subtitle 'Ask a question. Follow the research.
Explore the sources.' \
  --accent '#5CC7D1'
```

The renderer writes exactly one PNG and refuses to overwrite an existing file.
If Swift cannot write its module cache in a sandbox, point `SWIFT_MODULECACHE_PATH`
and `CLANG_MODULE_CACHE_PATH` to a writable temporary directory for that command.

Inspect the generated image for text wrapping, legibility, and cropping. Check its
pixel dimensions, for example with `sips -g pixelWidth -g pixelHeight IMAGE.png`.
Save the selected result as `examples/og/DEMO.png`. For an update, replace only the
requested demo's asset; do not regenerate the other cards.

## Wire the social preview

Edit the target demo's HTML head, updating existing tags rather than duplicating
them. Keep the title, description, and canonical URL consistent with that page.
Set these image fields:

| Tag | Value |
| --- | --- |
| `og:image`, `twitter:image` | Absolute deployed URL of `og/DEMO.png` |
| `og:image:alt`, `twitter:image:alt` | Brief description of this demo's preview |
| `og:image:type` | `image/png` |
| `og:image:width` | `1200` |
| `og:image:height` | `630` |
| `twitter:card` | `summary_large_image` |
| `twitter:title`, `twitter:description` | The page's OG title and description |

The current Pages base is
`https://samsamskies.github.io/inference-provider-api/`; verify it against the
page's canonical URL. Images live at `og/DEMO.png`, outside the demo's own folder.
The gallery card uses `examples/og/index.png`.

Check `.github/workflows/deploy-pages.yml` for packaging. Its `examples/og/*.png`
copy already includes new PNGs; change the workflow only if the asset location
requires it. Finish with the saved asset path and an inline image preview. Follow
the user's current instructions for testing and Git actions.
