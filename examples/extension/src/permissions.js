/**
 * Origin permission prompts (Allow once / Always allow / Deny / Never allow).
 */

import {
  getSettings,
  grantOriginAlways,
  getOriginGrant,
  isOriginBlocked,
  blockOrigin,
} from "./storage.js";
import { getDefaultProvider } from "./providers/registry.js";

/**
 * @typedef {{
 *   requestId: string,
 *   origin: string,
 *   messages: Array<{ role: string, content: string }>,
 *   providerId: string,
 *   model: string,
 * }} ApprovalRequest
 */

/** @typedef {"allow_once" | "always" | "deny" | "never"} ApprovalDecision */

/** @type {Map<string, {
 *   request: ApprovalRequest,
 *   resolve: (result: { decision: ApprovalDecision, model: string }) => void,
 *   windowId?: number,
 * }>} */
const pendingApprovals = new Map();

/**
 * Ensure the origin may proceed. Opens an approval popup when needed.
 * @param {{
 *   requestId: string,
 *   origin: string,
 *   messages: Array<{ role: string, content: string }>,
 *   preferredModel?: string,
 * }} args
 * @returns {Promise<{ allowed: boolean, model: string, once: boolean }>}
 */
export async function ensurePermission(args) {
  const settings = await getSettings();
  const provider = getDefaultProvider();
  const globalDefault =
    (typeof args.preferredModel === "string" && args.preferredModel) ||
    settings.defaultModel ||
    provider.defaultModel;

  if (await isOriginBlocked(args.origin)) {
    return { allowed: false, model: globalDefault, once: false };
  }

  const existing = await getOriginGrant(args.origin);
  if (existing) {
    return {
      allowed: true,
      model: existing.model || globalDefault,
      once: false,
    };
  }

  const decision = await promptUser({
    requestId: args.requestId,
    origin: args.origin,
    messages: args.messages,
    providerId: provider.id,
    model: globalDefault,
  });

  const chosenModel = decision.model || globalDefault;

  switch (decision.decision) {
    case "allow_once":
      return { allowed: true, model: chosenModel, once: true };
    case "always":
      await grantOriginAlways(args.origin, { model: chosenModel });
      return { allowed: true, model: chosenModel, once: false };
    case "never":
      await blockOrigin(args.origin);
      return { allowed: false, model: chosenModel, once: false };
    case "deny":
      return { allowed: false, model: chosenModel, once: false };
    default:
      // Fail closed on unknown decisions.
      return { allowed: false, model: chosenModel, once: false };
  }
}

/**
 * @param {ApprovalRequest} request
 * @returns {Promise<{ decision: ApprovalDecision, model: string }>}
 */
function promptUser(request) {
  return new Promise((resolve, reject) => {
    pendingApprovals.set(request.requestId, { request, resolve });

    const url = chrome.runtime.getURL(
      `ui/approval.html?requestId=${encodeURIComponent(request.requestId)}`
    );

    const width = 480;
    const height = 820;

    chrome.windows.create(
      {
        url,
        type: "popup",
        width,
        height,
        focused: true,
      },
      (win) => {
        const entry = pendingApprovals.get(request.requestId);
        if (!entry) return;
        if (chrome.runtime.lastError || !win?.id) {
          pendingApprovals.delete(request.requestId);
          reject(new Error(chrome.runtime.lastError?.message || "Failed to open approval window"));
          return;
        }

        // Assign before any await/callback so onRemoved can match this entry.
        entry.windowId = win.id;

        // Some Chrome builds ignore or clamp the initial create size; force it.
        chrome.windows.update(win.id, { width, height }, () => {
          void chrome.runtime.lastError;
        });

        // If the user closed the popup before windowId was stored, onRemoved
        // missed this entry — settle as deny once we learn the window is gone.
        chrome.windows.get(win.id, (existing) => {
          if (chrome.runtime.lastError || !existing) {
            cancelApproval(request.requestId);
          }
        });
      }
    );
  });
}

/**
 * Called by the approval page.
 * @param {string} requestId
 * @param {{ decision: ApprovalDecision, model: string }} result
 * @returns {boolean}
 */
export function resolveApproval(requestId, result) {
  const entry = pendingApprovals.get(requestId);
  if (!entry) return false;
  pendingApprovals.delete(requestId);

  const decision =
    result?.decision === "allow_once" ||
    result?.decision === "always" ||
    result?.decision === "deny" ||
    result?.decision === "never"
      ? result.decision
      : "deny";

  entry.resolve({
    decision,
    model: typeof result.model === "string" ? result.model : entry.request.model,
  });

  // Let the approval page close itself after sendMessage succeeds.
  // Avoid windows.remove here — it can race with the page and obscure the decision.
  return true;
}

/**
 * @param {string} requestId
 * @returns {ApprovalRequest | null}
 */
export function getPendingApproval(requestId) {
  return pendingApprovals.get(requestId)?.request ?? null;
}

/**
 * Deny any approval tied to a closed window.
 * @param {number} windowId
 */
export function handleApprovalWindowClosed(windowId) {
  for (const [requestId, entry] of pendingApprovals.entries()) {
    if (entry.windowId === windowId) {
      pendingApprovals.delete(requestId);
      entry.resolve({ decision: "deny", model: entry.request.model });
    }
  }
}

/**
 * Deny a pending approval (e.g. request aborted while prompting).
 * @param {string} requestId
 */
export function cancelApproval(requestId) {
  const entry = pendingApprovals.get(requestId);
  if (!entry) return;
  pendingApprovals.delete(requestId);
  entry.resolve({ decision: "deny", model: entry.request.model });
  if (entry.windowId != null) {
    chrome.windows.remove(entry.windowId, () => {
      void chrome.runtime.lastError;
    });
  }
}
