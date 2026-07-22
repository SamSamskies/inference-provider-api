/**
 * Ollama chat streaming adapter (local http://localhost:11434).
 * Models are discovered via GET /api/tags — no hardcoded catalog.
 */

export const OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function throwInference(code, message) {
  const error = new Error(message);
  error.name = "InferenceError";
  /** @type {any} */ (error).code = code;
  throw error;
}

/**
 * @param {unknown} err
 * @param {AbortSignal} signal
 * @returns {never}
 */
function rethrowNetwork(err, signal) {
  if (signal.aborted || (err && /** @type {Error} */ (err).name === "AbortError")) {
    throwInference("aborted", "Request aborted");
  }
  throwInference(
    "unavailable",
    err instanceof Error
      ? err.message
      : "Network error contacting Ollama. Is it running on localhost:11434?"
  );
}

/**
 * List locally installed Ollama models.
 * @param {{ signal?: AbortSignal }} [args]
 * @returns {Promise<string[]>}
 */
export async function listOllamaModels({ signal } = {}) {
  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal });
  } catch (err) {
    if (signal?.aborted || (err && /** @type {Error} */ (err).name === "AbortError")) {
      throwInference("aborted", "Request aborted");
    }
    throwInference(
      "unavailable",
      err instanceof Error
        ? err.message
        : "Network error contacting Ollama. Is it running on localhost:11434?"
    );
  }

  if (!response.ok) {
    throwInference(
      response.status >= 500 ? "unavailable" : "provider_error",
      `Ollama HTTP ${response.status} listing models`
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throwInference("provider_error", "Ollama returned invalid JSON for /api/tags");
  }

  const models = Array.isArray(body?.models) ? body.models : [];
  /** @type {string[]} */
  const names = [];
  for (const entry of models) {
    const name =
      typeof entry?.name === "string"
        ? entry.name
        : typeof entry?.model === "string"
          ? entry.model
          : "";
    if (name) names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   requiresApiKey: boolean,
 *   defaultModel: string,
 *   models?: readonly string[],
 *   listModels?: (args?: { signal?: AbortSignal }) => Promise<string[]>,
 *   streamChat: (args: {
 *     apiKey?: string,
 *     model: string,
 *     messages: Array<{ role: string, content: string }>,
 *     signal: AbortSignal,
 *     onDelta: (content: string) => void,
 *   }) => Promise<{ model: string, message: { role: "assistant", content: string }, usage?: { inputTokens?: number, outputTokens?: number } }>
 * }} Provider
 */

/** @type {Provider} */
export const ollamaProvider = {
  id: "ollama",
  label: "Ollama",
  requiresApiKey: false,
  // Placeholder until /api/tags is queried; never used as a hardcoded catalog.
  defaultModel: "",

  listModels: listOllamaModels,

  async streamChat({ model, messages, signal, onDelta }) {
    if (!model) {
      throwInference(
        "unavailable",
        "No Ollama model selected. Pull a model (e.g. ollama pull gemma4) and choose it in the extension."
      );
    }

    let response;
    try {
      response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
        }),
        signal,
      });
    } catch (err) {
      rethrowNetwork(err, signal);
    }

    if (!response.ok) {
      let detail = `Ollama HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (typeof body?.error === "string" && body.error) detail = body.error;
      } catch {
        // ignore parse failure
      }
      if (response.status === 403) {
        detail =
          "Ollama rejected the request (HTTP 403). Chrome extensions send a chrome-extension:// Origin that Ollama blocks by default. Reload this extension (so it can strip that header), or restart Ollama with OLLAMA_ORIGINS=chrome-extension://*";
      }
      const code =
        response.status === 403
          ? "unavailable"
          : response.status === 404
            ? "provider_error"
            : response.status >= 500
              ? "unavailable"
              : "provider_error";
      throwInference(code, detail);
    }

    if (!response.body) {
      throwInference("provider_error", "Ollama response had no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let resolvedModel = model;
    /** @type {{ inputTokens?: number, outputTokens?: number } | undefined} */
    let usage;

    /**
     * @param {string} line
     */
    function handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (typeof parsed.error === "string" && parsed.error) {
        throwInference("provider_error", parsed.error);
      }

      if (typeof parsed.model === "string" && parsed.model) {
        resolvedModel = parsed.model;
      }

      const delta = parsed.message?.content;
      if (typeof delta === "string" && delta.length > 0) {
        content += delta;
        onDelta(delta);
      }

      if (parsed.done) {
        const input =
          typeof parsed.prompt_eval_count === "number"
            ? parsed.prompt_eval_count
            : undefined;
        const output =
          typeof parsed.eval_count === "number" ? parsed.eval_count : undefined;
        if (input != null || output != null) {
          usage = { inputTokens: input, outputTokens: output };
        }
      }
    }

    /**
     * @param {boolean} flushRemainder
     */
    function drainBuffer(flushRemainder) {
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
      }
      if (flushRemainder && buffer.length > 0) {
        const line = buffer;
        buffer = "";
        handleLine(line);
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          drainBuffer(false);
        }
        if (done) {
          buffer += decoder.decode();
          drainBuffer(true);
          break;
        }
      }
    } catch (err) {
      if (/** @type {any} */ (err)?.code) throw err;
      if (signal.aborted || (err && /** @type {Error} */ (err).name === "AbortError")) {
        throwInference("aborted", "Request aborted");
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
