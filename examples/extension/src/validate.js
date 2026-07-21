const ROLES = new Set(["system", "user", "assistant"]);

/**
 * Validate an InferenceRequest from a page script.
 * @param {unknown} request
 * @returns {{ ok: true, value: { method: "chat", messages: Array<{role: string, content: string}> } } | { ok: false, message: string }}
 */
export function validateInferenceRequest(request) {
  if (request == null || typeof request !== "object" || Array.isArray(request)) {
    return { ok: false, message: "Request must be an object." };
  }

  const req = /** @type {Record<string, unknown>} */ (request);

  if (req.method !== "chat") {
    return { ok: false, message: 'Only method "chat" is supported in this draft.' };
  }

  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return { ok: false, message: "messages must be a non-empty array." };
  }

  const messages = [];
  for (let i = 0; i < req.messages.length; i++) {
    const msg = req.messages[i];
    if (msg == null || typeof msg !== "object" || Array.isArray(msg)) {
      return { ok: false, message: `messages[${i}] must be an object.` };
    }
    const m = /** @type {Record<string, unknown>} */ (msg);
    if (typeof m.role !== "string" || !ROLES.has(m.role)) {
      return {
        ok: false,
        message: `messages[${i}].role must be "system", "user", or "assistant".`,
      };
    }
    if (typeof m.content !== "string") {
      return { ok: false, message: `messages[${i}].content must be a string.` };
    }
    messages.push({ role: m.role, content: m.content });
  }

  if ("signal" in req && req.signal != null) {
    // AbortSignal cannot cross realms; page bridge handles abort via messages.
    // Ignore any serialized signal field if present.
  }

  return {
    ok: true,
    value: {
      method: "chat",
      messages,
    },
  };
}

/**
 * True for a serialized origin string from `location.origin`.
 * Accepts opaque origins (`"null"`), which `file:` documents typically use.
 * @param {string} origin
 * @returns {boolean}
 */
export function isValidOrigin(origin) {
  if (typeof origin !== "string" || !origin) return false;
  // Opaque origins serialize as the literal string "null" (not a URL).
  if (origin === "null") return true;
  try {
    const url = new URL(origin);
    return url.origin === origin;
  } catch {
    return false;
  }
}
