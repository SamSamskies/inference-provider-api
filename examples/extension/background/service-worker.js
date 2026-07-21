/**
 * Service worker: permission gating, provider orchestration, streaming.
 */

import { serializeInferenceError } from "../src/errors.js";
import {
  validateInferenceRequest,
  resolvePermissionPrincipal,
} from "../src/validate.js";
import { getSettings } from "../src/storage.js";
import {
  ensurePermission,
  resolveApproval,
  getPendingApproval,
  handleApprovalWindowClosed,
  cancelApproval,
} from "../src/permissions.js";
import { getDefaultProvider, listProviders } from "../src/providers/registry.js";

/** @type {Map<string, {
 *   port: chrome.runtime.Port,
 *   controller: AbortController,
 *   tabId?: number,
 * }>} */
const activeStreams = new Map();

let streamCounter = 0;

function nextStreamId() {
  streamCounter += 1;
  return `stream_${Date.now()}_${streamCounter}`;
}

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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ipa-inference") return;

  /** @type {string | null} */
  let boundStreamId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === "start") {
      void handleStart(port, msg, (id) => {
        boundStreamId = id;
      });
      return;
    }
    if (msg.type === "abort") {
      const id = typeof msg.streamId === "string" ? msg.streamId : boundStreamId;
      if (id) abortStream(id, "Request aborted");
    }
  });

  port.onDisconnect.addListener(() => {
    if (boundStreamId) {
      abortStream(boundStreamId, "Port disconnected");
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-approval") {
    sendResponse({ request: getPendingApproval(message.requestId) });
    return false;
  }

  if (message?.type === "resolve-approval") {
    sendResponse({
      ok: resolveApproval(message.requestId, {
        decision: message.decision,
        model: message.model,
      }),
    });
    return false;
  }

  if (message?.type === "list-providers") {
    sendResponse({
      providers: listProviders().map((p) => ({
        id: p.id,
        label: p.label,
        models: [...p.models],
        defaultModel: p.defaultModel,
      })),
    });
    return false;
  }

  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  handleApprovalWindowClosed(windowId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, entry] of activeStreams.entries()) {
    if (entry.tabId === tabId) {
      abortStream(id, "Tab closed");
    }
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

/**
 * @param {chrome.runtime.Port} port
 * @param {any} msg
 * @param {(id: string) => void} onStreamId
 * @returns {Promise<string | null>}
 */
async function handleStart(port, msg, onStreamId) {
  const streamId = nextStreamId();
  const controller = new AbortController();
  const tabId = port.sender?.tab?.id;

  activeStreams.set(streamId, { port, controller, tabId });
  onStreamId(streamId);

  /**
   * @param {string} code
   * @param {string} message
   */
  const sendError = (code, message) => {
    try {
      port.postMessage({
        type: "error",
        error: serializeInferenceError(code, message),
      });
    } catch {
      // ignore
    }
  };

  try {
    const origin = typeof msg.origin === "string" ? msg.origin : "";
    const pageUrl = typeof msg.pageUrl === "string" ? msg.pageUrl : "";
    const principal = resolvePermissionPrincipal(origin, pageUrl);
    if (!principal) {
      sendError("invalid_request", "Invalid origin.");
      activeStreams.delete(streamId);
      return null;
    }

    if (pageUrl && !isPageSecureContext(pageUrl)) {
      sendError(
        "unavailable",
        "window.inference is only available in a secure context."
      );
      activeStreams.delete(streamId);
      return null;
    }

    const validated = validateInferenceRequest(msg.request);
    if (!validated.ok) {
      sendError("invalid_request", validated.message);
      activeStreams.delete(streamId);
      return null;
    }

    // Acknowledge so the page can attach stream listeners before permission UI.
    port.postMessage({ type: "started", streamId });

    const permission = await ensurePermission({
      requestId: streamId,
      origin: principal,
      messages: validated.value.messages,
    });

    // Aborted while the permission prompt was open.
    if (!activeStreams.has(streamId) || controller.signal.aborted) {
      return streamId;
    }

    if (!permission.allowed) {
      throwInference("permission_denied", "Permission denied by user.");
    }

    const settings = await getSettings();
    if (!settings.openaiApiKey) {
      throwInference(
        "unavailable",
        "OpenAI API key not configured. Open the IPA Demo extension options to add your key."
      );
    }

    const provider = getDefaultProvider();
    const model = permission.model || settings.defaultModel || provider.defaultModel;

    const result = await provider.streamChat({
      apiKey: settings.openaiApiKey,
      model,
      messages: validated.value.messages,
      signal: controller.signal,
      onDelta: (content) => {
        if (controller.signal.aborted) return;
        try {
          port.postMessage({
            type: "chunk",
            chunk: { type: "delta", content },
          });
        } catch {
          controller.abort();
        }
      },
    });

    if (controller.signal.aborted) {
      throwInference("aborted", "Request aborted");
    }

    // Still tracked? Port may have already aborted/cleaned up.
    if (!activeStreams.has(streamId)) {
      return streamId;
    }

    port.postMessage({
      type: "chunk",
      chunk: {
        type: "done",
        model: result.model,
        message: result.message,
        usage: result.usage,
      },
    });
    activeStreams.delete(streamId);
    return streamId;
  } catch (err) {
    const code = /** @type {any} */ (err)?.code || "provider_error";
    const message = err instanceof Error ? err.message : "Inference failed";
    if (activeStreams.has(streamId)) {
      sendError(code, message);
    }
    cancelApproval(streamId);
    activeStreams.delete(streamId);
    return streamId;
  }
}

/**
 * @param {string} streamId
 * @param {string} reason
 */
function abortStream(streamId, reason) {
  const entry = activeStreams.get(streamId);
  cancelApproval(streamId);
  if (!entry) return;

  activeStreams.delete(streamId);
  try {
    entry.controller.abort();
  } catch {
    // ignore
  }
  try {
    entry.port.postMessage({
      type: "error",
      error: serializeInferenceError("aborted", reason),
    });
  } catch {
    // ignore
  }
}

/**
 * @param {string} pageUrl
 */
function isPageSecureContext(pageUrl) {
  try {
    const url = new URL(pageUrl);
    if (url.protocol === "https:") return true;
    if (url.protocol === "file:") return true;
    if (url.protocol === "http:") {
      return (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]"
      );
    }
    return false;
  } catch {
    return false;
  }
}
