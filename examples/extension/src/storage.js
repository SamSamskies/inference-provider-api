/**
 * Extension-local settings. API keys never leave this storage / service worker.
 */

/**
 * @typedef {{ allowedAt: number, providerId?: string, model?: string }} OriginGrant
 * @typedef {{ blockedAt: number }} OriginBlock
 */

const DEFAULTS = Object.freeze({
  openaiApiKey: "",
  defaultProviderId: "openai",
  defaultModel: "gpt-4o-mini",
  /** @type {Record<string, OriginGrant>} */
  allowedOrigins: {},
  /** @type {Record<string, OriginBlock>} */
  blockedOrigins: {},
});

/**
 * Legacy grants / settings without a providerId are treated as OpenAI.
 * @param {string | undefined} providerId
 * @returns {string}
 */
export function normalizeProviderId(providerId) {
  return typeof providerId === "string" && providerId.trim()
    ? providerId.trim()
    : DEFAULTS.defaultProviderId;
}

/**
 * @returns {Promise<{
 *   openaiApiKey: string,
 *   defaultProviderId: string,
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
  const allowedOrigins =
    stored.allowedOrigins && typeof stored.allowedOrigins === "object"
      ? /** @type {Record<string, OriginGrant>} */ ({ ...stored.allowedOrigins })
      : {};
  const blockedOrigins =
    stored.blockedOrigins && typeof stored.blockedOrigins === "object"
      ? /** @type {Record<string, OriginBlock>} */ ({ ...stored.blockedOrigins })
      : {};

  // Drop opaque / file principals if a prior build stored grants under them.
  // Those keys are not stable site identities and must never authorize broadly.
  let scrubbed = false;
  for (const key of Object.keys(allowedOrigins)) {
    if (key === "null" || key === "file://" || key.startsWith("file:")) {
      delete allowedOrigins[key];
      scrubbed = true;
    }
  }
  for (const key of Object.keys(blockedOrigins)) {
    if (key === "null" || key === "file://" || key.startsWith("file:")) {
      delete blockedOrigins[key];
      scrubbed = true;
    }
  }
  if (scrubbed) {
    await chrome.storage.local.set({ allowedOrigins, blockedOrigins });
  }

  return {
    openaiApiKey:
      typeof stored.openaiApiKey === "string" ? stored.openaiApiKey : DEFAULTS.openaiApiKey,
    defaultProviderId: normalizeProviderId(
      typeof stored.defaultProviderId === "string" ? stored.defaultProviderId : undefined
    ),
    defaultModel:
      typeof stored.defaultModel === "string" && stored.defaultModel
        ? stored.defaultModel
        : DEFAULTS.defaultModel,
    allowedOrigins,
    blockedOrigins,
  };
}

/**
 * Opaque `"null"` is not a persistable site identity.
 * @param {string} origin
 * @returns {boolean}
 */
function isPersistableOriginKey(origin) {
  return typeof origin === "string" && origin.length > 0 && origin !== "null";
}

/**
 * @param {Partial<{
 *   openaiApiKey: string,
 *   defaultProviderId: string,
 *   defaultModel: string
 * }>} patch
 */
export async function saveSettings(patch) {
  const next = {};
  if (typeof patch.openaiApiKey === "string") {
    next.openaiApiKey = patch.openaiApiKey.trim();
  }
  if (typeof patch.defaultProviderId === "string" && patch.defaultProviderId.trim()) {
    next.defaultProviderId = patch.defaultProviderId.trim();
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
  if (!isPersistableOriginKey(origin)) return null;
  const { allowedOrigins } = await getSettings();
  return allowedOrigins[origin] ?? null;
}

/**
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
export async function isOriginBlocked(origin) {
  if (!isPersistableOriginKey(origin)) return false;
  const { blockedOrigins } = await getSettings();
  return Boolean(blockedOrigins[origin]);
}

/**
 * @param {string} origin
 * @param {{ providerId: string, model: string }} options
 */
export async function grantOriginAlways(origin, { providerId, model }) {
  if (!isPersistableOriginKey(origin)) return;
  const { allowedOrigins, blockedOrigins } = await getSettings();
  delete blockedOrigins[origin];
  allowedOrigins[origin] = {
    allowedAt: Date.now(),
    providerId: normalizeProviderId(providerId),
    model: typeof model === "string" && model.trim() ? model.trim() : undefined,
  };
  await chrome.storage.local.set({ allowedOrigins, blockedOrigins });
}

/**
 * Persist a never-allow decision for an origin.
 * @param {string} origin
 */
export async function blockOrigin(origin) {
  if (!isPersistableOriginKey(origin)) return;
  const { allowedOrigins, blockedOrigins } = await getSettings();
  delete allowedOrigins[origin];
  blockedOrigins[origin] = { blockedAt: Date.now() };
  await chrome.storage.local.set({ allowedOrigins, blockedOrigins });
}

/**
 * @param {string} origin
 */
export async function unblockOrigin(origin) {
  if (!isPersistableOriginKey(origin)) return;
  const { blockedOrigins } = await getSettings();
  delete blockedOrigins[origin];
  await chrome.storage.local.set({ blockedOrigins });
}

/**
 * Update the saved provider/model for an existing always-allow grant.
 * @param {string} origin
 * @param {{ providerId: string, model: string }} options
 * @returns {Promise<boolean>} false if the origin is not granted
 */
export async function setOriginProviderModel(origin, { providerId, model }) {
  if (!isPersistableOriginKey(origin)) return false;
  const { allowedOrigins } = await getSettings();
  const grant = allowedOrigins[origin];
  if (!grant) return false;
  const nextModel = typeof model === "string" ? model.trim() : "";
  if (!nextModel) return false;
  allowedOrigins[origin] = {
    ...grant,
    providerId: normalizeProviderId(providerId),
    model: nextModel,
  };
  await chrome.storage.local.set({ allowedOrigins });
  return true;
}

/**
 * @deprecated Prefer setOriginProviderModel — kept for call-site migration.
 * @param {string} origin
 * @param {string} model
 * @returns {Promise<boolean>}
 */
export async function setOriginModel(origin, model) {
  if (!isPersistableOriginKey(origin)) return false;
  const { allowedOrigins } = await getSettings();
  const grant = allowedOrigins[origin];
  if (!grant) return false;
  return setOriginProviderModel(origin, {
    providerId: normalizeProviderId(grant.providerId),
    model,
  });
}

/**
 * @param {string} origin
 */
export async function revokeOrigin(origin) {
  if (!isPersistableOriginKey(origin)) return;
  const { allowedOrigins } = await getSettings();
  delete allowedOrigins[origin];
  await chrome.storage.local.set({ allowedOrigins });
}

/**
 * @returns {Promise<Array<{ origin: string, providerId: string, model?: string, allowedAt: number }>>}
 */
export async function listAllowedOrigins() {
  const { allowedOrigins } = await getSettings();
  return Object.entries(allowedOrigins)
    .map(([origin, grant]) => ({
      origin,
      providerId: normalizeProviderId(grant?.providerId),
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
