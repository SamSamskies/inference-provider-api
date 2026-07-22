import {
  getSettings,
  saveSettings,
  listAllowedOrigins,
  listBlockedOrigins,
  revokeOrigin,
  setOriginProviderModel,
  unblockOrigin,
} from "../src/storage.js";

const providerSelect = document.getElementById("provider");
const apiKeyField = document.getElementById("apiKeyField");
const apiKeyInput = document.getElementById("apiKey");
const toggleApiKeyButton = document.getElementById("toggleApiKey");
const ollamaStatusRow = document.getElementById("ollamaStatusRow");
const ollamaHint = document.getElementById("ollamaHint");
const checkOllamaButton = document.getElementById("checkOllama");
const modelSelect = document.getElementById("model");
const modelHint = document.getElementById("modelHint");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");
const originsEl = document.getElementById("origins");
const originsEmpty = document.getElementById("originsEmpty");
const blockedEl = document.getElementById("blocked");
const blockedEmpty = document.getElementById("blockedEmpty");

/** @type {Array<{ id: string, label: string, requiresApiKey: boolean, defaultModel: string, models?: string[] }>} */
let providers = [];

/** @type {Map<string, { models: string[], error?: string }>} */
const modelCache = new Map();

/**
 * @type {{
 *   available: boolean,
 *   models: string[],
 *   message: string,
 * }}
 */
let ollamaStatus = {
  available: false,
  models: [],
  message: "",
};

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

/**
 * Probe local Ollama. Unavailable or empty installs keep the option disabled.
 */
async function refreshOllamaStatus() {
  const response = await chrome.runtime.sendMessage({
    type: "list-models",
    providerId: "ollama",
  });

  if (!response?.ok) {
    ollamaStatus = {
      available: false,
      models: [],
      message:
        "Ollama is unavailable at http://localhost:11434, so this option is disabled. Install and start Ollama, then click Check again.",
    };
    modelCache.delete("ollama");
    return ollamaStatus;
  }

  const models = Array.isArray(response.models) ? response.models : [];
  if (models.length === 0) {
    ollamaStatus = {
      available: false,
      models: [],
      message:
        "Ollama is running but has no models installed, so this option is disabled. Run ollama pull gemma4, then click Check again.",
    };
    modelCache.delete("ollama");
    return ollamaStatus;
  }

  ollamaStatus = {
    available: true,
    models,
    message:
      "Ollama is available at http://localhost:11434. Models are listed from your local install.",
  };
  modelCache.delete("ollama");
  return ollamaStatus;
}

/**
 * @param {string} providerId
 */
function updateProviderChrome(providerId) {
  const provider = providers.find((p) => p.id === providerId);
  const needsKey = Boolean(provider?.requiresApiKey);
  apiKeyField.hidden = !needsKey;

  // Only surface Ollama help + Check again when the option is disabled.
  const showOllamaStatus = !ollamaStatus.available;
  ollamaStatusRow.hidden = !showOllamaStatus;
  checkOllamaButton.hidden = !showOllamaStatus;
  if (showOllamaStatus) {
    ollamaHint.textContent =
      ollamaStatus.message ||
      "Ollama is unavailable at http://localhost:11434, so this option is disabled.";
  }
}

/**
 * @param {string} providerId
 * @returns {Promise<{ models: string[], error?: string }>}
 */
async function fetchModels(providerId) {
  if (providerId === "ollama") {
    if (!ollamaStatus.available) {
      return { models: [], error: ollamaStatus.message };
    }
    return { models: ollamaStatus.models };
  }

  const cached = modelCache.get(providerId);
  if (cached) return cached;

  const response = await chrome.runtime.sendMessage({
    type: "list-models",
    providerId,
  });

  if (!response?.ok) {
    const result = {
      models: /** @type {string[]} */ ([]),
      error: response?.error?.message || "Failed to list models",
    };
    modelCache.set(providerId, result);
    return result;
  }

  const result = {
    models: Array.isArray(response.models) ? response.models : [],
  };
  modelCache.set(providerId, result);
  return result;
}

/**
 * @param {HTMLSelectElement} select
 * @param {string[]} models
 * @param {string | undefined} selected
 * @param {{ allowUnknown?: boolean }} [opts]
 */
function populateModelSelect(select, models, selected, opts = {}) {
  const allowUnknown = opts.allowUnknown !== false;
  select.replaceChildren();
  const set = new Set(models);
  // OpenAI may keep a saved model outside the curated list; Ollama only shows installed tags.
  if (selected && (models.includes(selected) || (allowUnknown && models.length > 0))) {
    set.add(selected);
  }
  for (const model of set) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    if (model === selected) option.selected = true;
    select.append(option);
  }
  if ((!selected || !set.has(selected)) && select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

/**
 * Map a stored/preferred provider id onto one that exists in the select and is
 * currently choosable. Unknown ids (and unavailable Ollama) must not be
 * returned as-is: the browser would select the first option while callers keep
 * the stale id, and refreshDefaultModels would then bail on the mismatch.
 * @param {string} selectedId
 * @returns {string}
 */
function resolveSelectableProviderId(selectedId) {
  /** @param {{ id: string }} p */
  const isChoosable = (p) => p.id !== "ollama" || ollamaStatus.available;
  const fallback =
    providers.find((p) => p.id === "openai" && isChoosable(p))?.id ||
    providers.find(isChoosable)?.id ||
    "";
  const known = providers.some((p) => p.id === selectedId);
  let effectiveId = known ? selectedId : fallback;
  if (!providers.some((p) => p.id === effectiveId && isChoosable(p))) {
    effectiveId = fallback;
  }
  return effectiveId;
}

/**
 * @param {HTMLSelectElement} select
 * @param {string} selectedId
 * @returns {string} the provider id actually selected after availability rules
 */
function populateProviderSelect(select, selectedId) {
  select.replaceChildren();
  const effectiveId = resolveSelectableProviderId(selectedId);

  for (const provider of providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    const unavailable = provider.id === "ollama" && !ollamaStatus.available;
    option.disabled = unavailable;
    option.textContent = unavailable
      ? `${provider.label} (unavailable)`
      : provider.label;
    if (provider.id === effectiveId) option.selected = true;
    select.append(option);
  }
  return effectiveId;
}

/** Bumped on each default-model load so a slower earlier fetch cannot repaint. */
let defaultModelsLoadId = 0;

/**
 * @param {string} providerId
 * @param {string | undefined} preferredModel
 */
async function refreshDefaultModels(providerId, preferredModel) {
  const loadId = ++defaultModelsLoadId;
  modelHint.hidden = true;
  modelHint.textContent = "";
  modelSelect.disabled = true;
  populateModelSelect(modelSelect, [], preferredModel);

  const { models, error } = await fetchModels(providerId);
  // Ignore stale responses after the user switches providers mid-flight.
  if (loadId !== defaultModelsLoadId || providerSelect.value !== providerId) {
    return;
  }

  populateModelSelect(modelSelect, models, preferredModel, {
    allowUnknown: providerId !== "ollama",
  });
  modelSelect.disabled = models.length === 0;

  if (error && providerId !== "ollama") {
    modelHint.hidden = false;
    modelHint.textContent = error;
  } else if (models.length === 0 && providerId !== "ollama") {
    modelHint.hidden = false;
    modelHint.textContent = "No models available for this provider.";
  }
}

/** Last saved defaults — restored when switching back to the saved provider. */
let savedDefaultProviderId = "openai";
let savedDefaultModel = "gpt-4o-mini";

/**
 * @param {string} providerId
 * @returns {string | undefined}
 */
function preferredDefaultModel(providerId) {
  if (providerId === savedDefaultProviderId) return savedDefaultModel;
  return providers.find((p) => p.id === providerId)?.defaultModel || undefined;
}

toggleApiKeyButton.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
  toggleApiKeyButton.textContent = showing ? "Show" : "Hide";
  toggleApiKeyButton.setAttribute("aria-pressed", showing ? "false" : "true");
});

providerSelect.addEventListener("change", async () => {
  const providerId = providerSelect.value;
  updateProviderChrome(providerId);
  await refreshDefaultModels(providerId, preferredDefaultModel(providerId));
});

checkOllamaButton.addEventListener("click", async () => {
  checkOllamaButton.disabled = true;
  checkOllamaButton.textContent = "Checking…";
  try {
    const wantedOllama = savedDefaultProviderId === "ollama";
    await refreshOllamaStatus();
    const nextId = populateProviderSelect(
      providerSelect,
      wantedOllama && ollamaStatus.available
        ? "ollama"
        : providerSelect.value === "ollama" && !ollamaStatus.available
          ? "openai"
          : providerSelect.value
    );
    updateProviderChrome(nextId);
    await refreshDefaultModels(nextId, preferredDefaultModel(nextId));
    await renderOrigins();
    setStatus(
      ollamaStatus.available ? "Ollama is available." : "Ollama is still unavailable.",
      ollamaStatus.available ? "ok" : "err"
    );
  } finally {
    checkOllamaButton.disabled = false;
    checkOllamaButton.textContent = "Check again";
  }
});

async function renderOrigins() {
  const grants = await listAllowedOrigins();
  originsEl.replaceChildren();
  originsEmpty.hidden = grants.length > 0;

  for (const grant of grants) {
    const li = document.createElement("li");

    const meta = document.createElement("div");
    meta.className = "origin-meta";

    const code = document.createElement("code");
    code.textContent = grant.origin;
    meta.append(code);

    const providerLabel = document.createElement("label");
    providerLabel.className = "origin-model";
    const providerCaption = document.createElement("span");
    providerCaption.textContent = "Provider";
    const originProviderSelect = document.createElement("select");
    originProviderSelect.setAttribute(
      "aria-label",
      `Provider for ${grant.origin}`
    );
    // Keep an already-granted Ollama selection visible even if currently unavailable.
    const originProviderId = populateOriginProviderSelect(
      originProviderSelect,
      grant.providerId
    );
    providerLabel.append(providerCaption, originProviderSelect);
    meta.append(providerLabel);

    const modelLabel = document.createElement("label");
    modelLabel.className = "origin-model";
    const modelCaption = document.createElement("span");
    modelCaption.textContent = "Model";
    const originModelSelect = document.createElement("select");
    originModelSelect.setAttribute("aria-label", `Model for ${grant.origin}`);
    modelLabel.append(modelCaption, originModelSelect);
    meta.append(modelLabel);

    const modelStatus = document.createElement("p");
    modelStatus.className = "hint origin-model-hint";
    meta.append(modelStatus);

    /** Bumped on each model load for this grant so slower fetches cannot repaint. */
    let originModelsLoadId = 0;

    /**
     * @param {string} providerId
     * @param {string | undefined} selectedModel
     * @returns {Promise<boolean>} true when this load still matches the select
     */
    async function loadOriginModels(providerId, selectedModel) {
      const loadId = ++originModelsLoadId;
      originModelSelect.disabled = true;
      modelStatus.textContent = "Loading models…";
      const { models, error } = await fetchModels(providerId);
      // Ignore stale responses after the user switches providers mid-flight.
      if (
        loadId !== originModelsLoadId ||
        originProviderSelect.value !== providerId
      ) {
        return false;
      }

      populateModelSelect(originModelSelect, models, selectedModel, {
        allowUnknown: providerId !== "ollama",
      });
      originModelSelect.disabled = models.length === 0;
      if (error) {
        modelStatus.textContent = error;
      } else if (models.length === 0) {
        modelStatus.textContent = "No models available.";
      } else {
        modelStatus.textContent = "";
      }
      return true;
    }

    async function persistGrant() {
      const providerId = originProviderSelect.value;
      const model = originModelSelect.value;
      if (!model) {
        setStatus(`Choose a model for ${grant.origin}`, "err");
        return;
      }
      const ok = await setOriginProviderModel(grant.origin, {
        providerId,
        model,
      });
      if (ok) {
        setStatus(`Updated ${grant.origin}`, "ok");
      } else {
        setStatus(`Could not update ${grant.origin}`, "err");
        await renderOrigins();
      }
    }

    originProviderSelect.addEventListener("change", async () => {
      originProviderSelect.disabled = true;
      const providerId = originProviderSelect.value;
      try {
        const applied = await loadOriginModels(providerId, undefined);
        if (!applied || originProviderSelect.value !== providerId) {
          return;
        }

        if (!originModelSelect.value) {
          // The select changes before dynamic model discovery completes.
          // Restore the persisted grant when the new provider cannot supply a
          // model so the UI never implies an unpersisted provider is active.
          await renderOrigins();
          setStatus(
            `Could not switch ${grant.origin}: no models are available.`,
            "err"
          );
          return;
        }

        await persistGrant();
      } finally {
        originProviderSelect.disabled = false;
      }
    });

    originModelSelect.addEventListener("change", () => {
      void persistGrant();
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "danger";
    button.textContent = "Revoke";
    button.addEventListener("click", async () => {
      await revokeOrigin(grant.origin);
      await renderOrigins();
      setStatus(`Revoked ${grant.origin}`, "ok");
    });

    li.append(meta, button);
    originsEl.append(li);

    void loadOriginModels(originProviderId, grant.model);
  }
}

/**
 * Like populateProviderSelect, but keeps a current Ollama grant selected even if disabled.
 * Unknown provider ids fall back so the select value matches what callers load.
 * @param {HTMLSelectElement} select
 * @param {string} selectedId
 * @returns {string} the provider id actually selected
 */
function populateOriginProviderSelect(select, selectedId) {
  select.replaceChildren();
  const known = providers.some((p) => p.id === selectedId);
  const effectiveId = known
    ? selectedId
    : providers.find((p) => p.id === "openai")?.id || providers[0]?.id || "";

  for (const provider of providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    const unavailable = provider.id === "ollama" && !ollamaStatus.available;
    // Allow keeping the current grant visible; block switching *to* Ollama when down.
    option.disabled = unavailable && effectiveId !== "ollama";
    option.textContent = unavailable
      ? `${provider.label} (unavailable)`
      : provider.label;
    if (provider.id === effectiveId) option.selected = true;
    select.append(option);
  }
  return effectiveId;
}

async function renderBlocked() {
  const blocks = await listBlockedOrigins();
  blockedEl.replaceChildren();
  blockedEmpty.hidden = blocks.length > 0;

  for (const block of blocks) {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = block.origin;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Unblock";
    button.addEventListener("click", async () => {
      await unblockOrigin(block.origin);
      await renderBlocked();
      setStatus(`Unblocked ${block.origin}`, "ok");
    });

    li.append(code, button);
    blockedEl.append(li);
  }
}

async function loadProviders() {
  const response = await chrome.runtime.sendMessage({ type: "list-providers" });
  providers = Array.isArray(response?.providers) ? response.providers : [];
}

async function load() {
  await loadProviders();
  await refreshOllamaStatus();
  const settings = await getSettings();
  savedDefaultProviderId = settings.defaultProviderId;
  savedDefaultModel = settings.defaultModel;
  apiKeyInput.value = settings.openaiApiKey;
  const effectiveProvider = populateProviderSelect(
    providerSelect,
    settings.defaultProviderId
  );
  updateProviderChrome(effectiveProvider);
  await refreshDefaultModels(effectiveProvider, preferredDefaultModel(effectiveProvider));
  await renderOrigins();
  await renderBlocked();
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  try {
    const providerId = providerSelect.value;
    const model = modelSelect.value;
    if (providerId === "ollama" && !ollamaStatus.available) {
      setStatus("Ollama is unavailable. Choose another provider or click Check again.", "err");
      return;
    }
    if (!model) {
      setStatus("Choose a default model before saving.", "err");
      return;
    }
    await saveSettings({
      openaiApiKey: apiKeyInput.value,
      defaultProviderId: providerId,
      defaultModel: model,
    });
    savedDefaultProviderId = providerId;
    savedDefaultModel = model;
    setStatus("Saved.", "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Failed to save", "err");
  } finally {
    saveButton.disabled = false;
  }
});

void load();
