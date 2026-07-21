/**
 * Extension-local settings. API keys never leave this storage / service worker.
 */

/**
 * @typedef {{ allowedAt: number, model?: string }} OriginGrant
 * @typedef {{ blockedAt: number }} OriginBlock
 */

const DEFAULTS = Object.freeze({
  openaiApiKey: "",
  defaultModel: "gpt-4o-mini",
  /** @type {Record<string, OriginGrant>} */
  allowedOrigins: {},
  /** @type {Record<string, OriginBlock>} */
  blockedOrigins: {},
});

/**
 * @returns {Promise<{
 *   openaiApiKey: string,
 *   defaultModel: string,
 *   allowedOrigins: Record<string, OriginGrant>,
 *   blockedOrigins: Record<string, OriginBlock>
 * }>}
 */
export async function getSettings() {
  const stored = await chrome.storage.local.get([
    ...Object.keys(DEFAULTS),
    "blockedOrigins",
  ]);
  return {
    openaiApiKey:
      typeof stored.openaiApiKey === "string" ? stored.openaiApiKey : DEFAULTS.openaiApiKey,
    defaultModel:
      typeof stored.defaultModel === "string" && stored.defaultModel
        ? stored.defaultModel
        : DEFAULTS.defaultModel,
    allowedOrigins:
      stored.allowedOrigins && typeof stored.allowedOrigins === "object"
        ? /** @type {Record<string, OriginGrant>} */ (stored.allowedOrigins)
        : {},
    blockedOrigins:
      stored.blockedOrigins && typeof stored.blockedOrigins === "object"
        ? /** @type {Record<string, OriginBlock>} */ (stored.blockedOrigins)
        : {},
  };
}

/**
 * @param {Partial<{ openaiApiKey: string, defaultModel: string }>} patch
 */
export async function saveSettings(patch) {
  const next = {};
  if (typeof patch.openaiApiKey === "string") {
    next.openaiApiKey = patch.openaiApiKey.trim();
  }
  if (typeof patch.defaultModel === "string" && patch.defaultModel.trim()) {
    next.defaultModel = patch.defaultModel.trim();
  }
  if (Object.keys(next).length > 0) {
    await chrome.storage.local.set(next);
  }
}

/**
 * @param {string} origin
 * @returns {Promise<OriginGrant | null>}
 */
export async function getOriginGrant(origin) {
  const { allowedOrigins } = await getSettings();
  return allowedOrigins[origin] ?? null;
}

/**
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
export async function isOriginBlocked(origin) {
  const { blockedOrigins } = await getSettings();
  return Boolean(blockedOrigins[origin]);
}

/**
 * @param {string} origin
 * @param {{ model: string }} options
 */
export async function grantOriginAlways(origin, { model }) {
  const { allowedOrigins, blockedOrigins } = await getSettings();
  delete blockedOrigins[origin];
  allowedOrigins[origin] = {
    allowedAt: Date.now(),
    model: typeof model === "string" && model.trim() ? model.trim() : undefined,
  };
  await chrome.storage.local.set({ allowedOrigins, blockedOrigins });
}

/**
 * Persist a never-allow decision for an origin.
 * @param {string} origin
 */
export async function blockOrigin(origin) {
  const { allowedOrigins, blockedOrigins } = await getSettings();
  delete allowedOrigins[origin];
  blockedOrigins[origin] = { blockedAt: Date.now() };
  await chrome.storage.local.set({ allowedOrigins, blockedOrigins });
}

/**
 * @param {string} origin
 */
export async function unblockOrigin(origin) {
  const { blockedOrigins } = await getSettings();
  delete blockedOrigins[origin];
  await chrome.storage.local.set({ blockedOrigins });
}

/**
 * Update the saved model for an existing always-allow grant.
 * @param {string} origin
 * @param {string} model
 * @returns {Promise<boolean>} false if the origin is not granted
 */
export async function setOriginModel(origin, model) {
  const { allowedOrigins } = await getSettings();
  const grant = allowedOrigins[origin];
  if (!grant) return false;
  const nextModel = typeof model === "string" ? model.trim() : "";
  if (!nextModel) return false;
  allowedOrigins[origin] = {
    ...grant,
    model: nextModel,
  };
  await chrome.storage.local.set({ allowedOrigins });
  return true;
}

/**
 * @param {string} origin
 */
export async function revokeOrigin(origin) {
  const { allowedOrigins } = await getSettings();
  delete allowedOrigins[origin];
  await chrome.storage.local.set({ allowedOrigins });
}

/**
 * @returns {Promise<Array<{ origin: string, model?: string, allowedAt: number }>>}
 */
export async function listAllowedOrigins() {
  const { allowedOrigins } = await getSettings();
  return Object.entries(allowedOrigins)
    .map(([origin, grant]) => ({
      origin,
      model: grant?.model,
      allowedAt: grant?.allowedAt ?? 0,
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

/**
 * @returns {Promise<Array<{ origin: string, blockedAt: number }>>}
 */
export async function listBlockedOrigins() {
  const { blockedOrigins } = await getSettings();
  return Object.entries(blockedOrigins)
    .map(([origin, block]) => ({
      origin,
      blockedAt: block?.blockedAt ?? 0,
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}
