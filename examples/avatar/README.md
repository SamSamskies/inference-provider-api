# IPA Avatar Demo

Describe a character, generate an SVG avatar via [`ipa-tools`](../../packages/ipa-tools) `complete` on top of [`window.inference`](../../SPEC.md), then download PNG (or SVG).

The model returns markup, not pixels. The page extracts the first `<svg>`, strips scripts and external URLs, renders it as an image, and rasterizes a PNG in the canvas. That keeps the demo on IPA chat — no image-generation method required.

## Recommended models

SVG drawing is harder than a short translation. In Inference Bridge, pick a current **Claude** or **GPT-class** chat model (OpenAI, Anthropic, or OpenRouter).

Local (Ollama): a coding model such as [Qwen2.5-Coder](https://ollama.com/library/qwen2.5-coder) (14B or larger). Tiny chat models often return markdown or invalid markup.

```bash
ollama pull qwen2.5-coder:14b
```

## Try it

**Live demo:** [https://samsamskies.github.io/inference-provider-api/avatar/](https://samsamskies.github.io/inference-provider-api/avatar/)

1. Install [Inference Bridge](https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd) from the Chrome Web Store (or for development, [clone the repo](https://github.com/SamSamskies/inference-bridge) and load it unpacked from `chrome://extensions`)
2. Open the [live demo](https://samsamskies.github.io/inference-provider-api/avatar/), or serve this folder locally over a secure context:

   ```bash
   npx serve .
   ```

3. Pick a recommended prompt (or write your own) and click **Create avatar**

The extension prompts for permission on first use. **Clear** removes the preview. **Stop** aborts via `AbortSignal` (`aborted` error code). **Download PNG** rasterizes the SVG at 512×512. The 40px / 24px thumbnails are a size check — avatars have to read small.
