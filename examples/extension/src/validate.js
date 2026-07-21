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
 * True for a serialized tuple origin from `location.origin`.
 * Rejects the opaque-origin sentinel `"null"` — that string is shared by every
 * opaque context (`file:`, sandboxed docs, etc.) and must not be treated as a
 * site identity for grants or blocks.
 * @param {string} origin
 * @returns {boolean}
 */
export function isValidOrigin(origin) {
  if (typeof origin !== "string" || !origin) return false;
  if (origin === "null") return false;
  try {
    const url = new URL(origin);
    return url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Stable permission key for grants/blocks.
 * HTTPS (and other tuple) origins use `location.origin`. Opaque `file:` pages
 * use the document URL without a fragment so one local file cannot allow or
 * block every other opaque-origin page under the shared `"null"` key.
 * @param {string} origin
 * @param {string} pageUrl
 * @returns {string | null}
 */
export function resolvePermissionPrincipal(origin, pageUrl) {
  if (isValidOrigin(origin)) return origin;
  if (origin !== "null") return null;
  if (typeof pageUrl !== "string" || !pageUrl) return null;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "file:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
