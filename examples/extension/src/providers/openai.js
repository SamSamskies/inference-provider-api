/**
 * OpenAI chat Completions streaming adapter.
 * Implements the provider interface used by the registry.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Curated chat models for the demo UI — not a live OpenAI catalog. */
export const OPENAI_MODELS = Object.freeze([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5-mini",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-4o",
]);

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   models: readonly string[],
 *   defaultModel: string,
 *   streamChat: (args: {
 *     apiKey: string,
 *     model: string,
 *     messages: Array<{ role: string, content: string }>,
 *     signal: AbortSignal,
 *     onDelta: (content: string) => void,
 *   }) => Promise<{ model: string, message: { role: "assistant", content: string }, usage?: { inputTokens?: number, outputTokens?: number } }>
 * }} Provider
 */

/** @type {Provider} */
export const openaiProvider = {
  id: "openai",
  label: "OpenAI",
  models: OPENAI_MODELS,
  defaultModel: "gpt-4o-mini",

  async streamChat({ apiKey, model, messages, signal, onDelta }) {
    let response;
    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });
    } catch (err) {
      if (signal.aborted || (err && /** @type {Error} */ (err).name === "AbortError")) {
        const aborted = new Error("Request aborted");
        aborted.name = "InferenceError";
        /** @type {any} */ (aborted).code = "aborted";
        throw aborted;
      }
      const unavailable = new Error(
        err instanceof Error ? err.message : "Network error contacting OpenAI"
      );
      unavailable.name = "InferenceError";
      /** @type {any} */ (unavailable).code = "unavailable";
      throw unavailable;
    }

    if (!response.ok) {
      let detail = `OpenAI HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error?.message) detail = body.error.message;
      } catch {
        // ignore parse failure
      }
      const code =
        response.status === 401 || response.status === 403
          ? "provider_error"
          : response.status === 429
            ? "provider_error"
            : response.status >= 500
              ? "unavailable"
              : "provider_error";
      const error = new Error(detail);
      error.name = "InferenceError";
      /** @type {any} */ (error).code = code;
      throw error;
    }

    if (!response.body) {
      const error = new Error("OpenAI response had no body");
      error.name = "InferenceError";
      /** @type {any} */ (error).code = "provider_error";
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let resolvedModel = model;
    /** @type {{ inputTokens?: number, outputTokens?: number } | undefined} */
    let usage;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trimStart();
          if (!data || data === "[DONE]") continue;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (typeof parsed.model === "string" && parsed.model) {
            resolvedModel = parsed.model;
          }

          if (parsed.usage) {
            usage = {
              inputTokens: parsed.usage.prompt_tokens,
              outputTokens: parsed.usage.completion_tokens,
            };
          }

          const choice = parsed.choices?.[0];
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            content += delta;
            onDelta(delta);
          }
        }
      }
    } catch (err) {
      if (signal.aborted || (err && /** @type {Error} */ (err).name === "AbortError")) {
        const aborted = new Error("Request aborted");
        aborted.name = "InferenceError";
        /** @type {any} */ (aborted).code = "aborted";
        throw aborted;
      }
      throw err;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    return {
      model: resolvedModel,
      message: { role: "assistant", content },
      usage,
    };
  },
};
