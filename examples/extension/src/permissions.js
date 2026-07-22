/**
 * Origin permission prompts (Allow once / Always allow / Deny / Never allow).
 */

import {
  getSettings,
  grantOriginAlways,
  getOriginGrant,
  isOriginBlocked,
  blockOrigin,
  normalizeProviderId,
} from "./storage.js";
import { getDefaultProvider, getProvider } from "./providers/registry.js";

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
 *   resolve: (result: { decision: ApprovalDecision, providerId: string, model: string }) => void,
 *   windowId?: number,
 * }>} */
const pendingApprovals = new Map();

/**
 * Ensure the origin may proceed. Opens an approval popup when needed.
 * @param {{
 *   requestId: string,
 *   origin: string,
 *   messages: Array<{ role: string, content: string }>,
 *   preferredProviderId?: string,
 *   preferredModel?: string,
 * }} args
 * @returns {Promise<{ allowed: boolean, providerId: string, model: string, once: boolean }>}
 */
export async function ensurePermission(args) {
  const settings = await getSettings();
  const defaultProvider =
    getProvider(settings.defaultProviderId) || getDefaultProvider();
  const providerId = normalizeProviderId(
    args.preferredProviderId || settings.defaultProviderId || defaultProvider.id
  );
  const provider = getProvider(providerId) || defaultProvider;
  // Only reuse settings.defaultModel when it belongs to this provider.
  // Otherwise the approval UI can pre-select (and OpenAI can persist) a name
  // from another catalog — e.g. an Ollama tag after switching defaults, or
  // when preferredProviderId differs from settings.defaultProviderId.
  const settingsModelForProvider =
    normalizeProviderId(settings.defaultProviderId) === provider.id
      ? settings.defaultModel
      : "";
  const globalDefaultModel =
    (typeof args.preferredModel === "string" && args.preferredModel) ||
    settingsModelForProvider ||
    provider.defaultModel ||
    "";

  if (await isOriginBlocked(args.origin)) {
    return {
      allowed: false,
      providerId: provider.id,
      model: globalDefaultModel,
      once: false,
    };
  }

  const existing = await getOriginGrant(args.origin);
  if (existing) {
    const grantProviderId = normalizeProviderId(existing.providerId);
    // Fall back to the grant provider's default — not settings.defaultModel,
    // which may belong to a different provider.
    const grantProvider = getProvider(grantProviderId);
    const grantFallbackModel = grantProvider?.defaultModel || "";
    return {
      allowed: true,
      providerId: grantProviderId,
      model: existing.model || grantFallbackModel,
      once: false,
    };
  }

  const decision = await promptUser({
    requestId: args.requestId,
    origin: args.origin,
    messages: args.messages,
    providerId: provider.id,
    model: globalDefaultModel,
  });

  const chosenProviderId = normalizeProviderId(
    decision.providerId || provider.id
  );
  const chosenProvider = getProvider(chosenProviderId) || provider;
  // If the user picked a different provider in the approval UI, do not fall
  // back to globalDefaultModel (it was resolved for the prompt's provider).
  const chosenModel =
    decision.model ||
    (chosenProviderId === provider.id ? globalDefaultModel : "") ||
    chosenProvider.defaultModel ||
    "";

  switch (decision.decision) {
    case "allow_once":
      return {
        allowed: true,
        providerId: chosenProviderId,
        model: chosenModel,
        once: true,
      };
    case "always":
      await grantOriginAlways(args.origin, {
        providerId: chosenProviderId,
        model: chosenModel,
      });
      return {
        allowed: true,
        providerId: chosenProviderId,
        model: chosenModel,
        once: false,
      };
    case "never":
      await blockOrigin(args.origin);
      return {
        allowed: false,
        providerId: chosenProviderId,
        model: chosenModel,
        once: false,
      };
    case "deny":
      return {
        allowed: false,
        providerId: chosenProviderId,
        model: chosenModel,
        once: false,
      };
    default:
      // Fail closed on unknown decisions.
      return {
        allowed: false,
        providerId: chosenProviderId,
        model: chosenModel,
        once: false,
      };
  }
}

/**
 * @param {ApprovalRequest} request
 * @returns {Promise<{ decision: ApprovalDecision, providerId: string, model: string }>}
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
          const error = new Error(
            chrome.runtime.lastError?.message || "Failed to open approval window"
          );
          error.name = "InferenceError";
          /** @type {any} */ (error).code = "unavailable";
          reject(error);
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
 * @param {{ decision: ApprovalDecision, providerId?: string, model: string }} result
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

  // Blank providerId (e.g. Allow clicked before the select was filled) must
  // not go through normalizeProviderId — that maps "" to OpenAI.
  const rawProviderId =
    typeof result.providerId === "string" && result.providerId.trim()
      ? result.providerId
      : entry.request.providerId;

  entry.resolve({
    decision,
    providerId: normalizeProviderId(rawProviderId),
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
      entry.resolve({
        decision: "deny",
        providerId: entry.request.providerId,
        model: entry.request.model,
      });
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
  entry.resolve({
    decision: "deny",
    providerId: entry.request.providerId,
    model: entry.request.model,
  });
  if (entry.windowId != null) {
    chrome.windows.remove(entry.windowId, () => {
      void chrome.runtime.lastError;
    });
  }
}
