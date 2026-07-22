const params = new URLSearchParams(location.search);
const requestId = params.get("requestId");

const originEl = document.getElementById("origin");
const providerSelect = document.getElementById("provider");
const ollamaHint = document.getElementById("ollamaHint");
const modelSelect = document.getElementById("model");
const modelHint = document.getElementById("modelHint");
const previewEl = document.getElementById("preview");
const errorEl = document.getElementById("error");
const rememberInput = document.getElementById("remember");
const rememberHint = document.getElementById("rememberHint");
const allowBtn = document.getElementById("allow");
const denyBtn = document.getElementById("deny");

/** @type {Array<{ id: string, label: string, defaultModel: string }>} */
let providers = [];

/** Whether the current provider has a usable model selection. */
let modelsReady = false;

/** Bumped on each model load so a slower earlier fetch cannot repaint. */
let modelsLoadId = 0;

// Keep Allow disabled until loadModelsForProvider finishes (HTML also starts disabled).
allowBtn.disabled = true;

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

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
  allowBtn.disabled = true;
  denyBtn.disabled = true;
  rememberInput.disabled = true;
}

function setModelHint(message) {
  if (!message) {
    modelHint.hidden = true;
    modelHint.textContent = "";
    return;
  }
  modelHint.hidden = false;
  modelHint.textContent = message;
}

function updateOllamaHint(_providerId) {
  if (!ollamaStatus.available) {
    ollamaHint.hidden = false;
    ollamaHint.textContent = ollamaStatus.message;
    return;
  }
  ollamaHint.hidden = true;
  ollamaHint.textContent = "";
}

function updateAllowEnabled() {
  if (errorEl.hidden === false && errorEl.textContent) {
    // Hard page error already disables controls.
    return;
  }
  allowBtn.disabled = !modelsReady || !modelSelect.value;
}

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
        "Ollama is unavailable at http://localhost:11434, so this option is disabled. Install and start Ollama (and pull a model) to enable it.",
    };
    return ollamaStatus;
  }

  const models = Array.isArray(response.models) ? response.models : [];
  if (models.length === 0) {
    ollamaStatus = {
      available: false,
      models: [],
      message:
        "Ollama is running but has no models installed, so this option is disabled. Run ollama pull gemma4, then try again.",
    };
    return ollamaStatus;
  }

  ollamaStatus = {
    available: true,
    models,
    message: "Using local Ollama at http://localhost:11434.",
  };
  return ollamaStatus;
}

/**
 * @param {HTMLSelectElement} select
 * @param {string[]} models
 * @param {string | undefined} selected
 * @param {{ allowUnknown?: boolean }} [opts]
 */
function fillModels(select, models, selected, opts = {}) {
  const allowUnknown = opts.allowUnknown !== false;
  select.replaceChildren();
  const set = new Set(models);
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
 * the stale id, and loadModelsForProvider would then bail on the mismatch.
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
 * @param {string} selectedId
 * @returns {string}
 */
function fillProviders(selectedId) {
  providerSelect.replaceChildren();
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
    providerSelect.append(option);
  }
  return effectiveId;
}

/**
 * @param {string} providerId
 * @param {string | undefined} preferredModel
 */
async function loadModelsForProvider(providerId, preferredModel) {
  const loadId = ++modelsLoadId;
  modelsReady = false;
  updateAllowEnabled();
  updateOllamaHint(providerId);
  modelSelect.disabled = true;
  setModelHint("Loading models…");
  fillModels(modelSelect, [], preferredModel);

  /**
   * @returns {boolean}
   */
  function isCurrentLoad() {
    return loadId === modelsLoadId && providerSelect.value === providerId;
  }

  if (providerId === "ollama") {
    if (!isCurrentLoad()) return;
    if (!ollamaStatus.available) {
      setModelHint("");
      fillModels(modelSelect, [], undefined);
      modelsReady = false;
      updateAllowEnabled();
      return;
    }
    fillModels(modelSelect, ollamaStatus.models, preferredModel, {
      allowUnknown: false,
    });
    modelSelect.disabled = ollamaStatus.models.length === 0;
    setModelHint("");
    modelsReady = ollamaStatus.models.length > 0;
    updateAllowEnabled();
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "list-models",
    providerId,
  });

  // Ignore stale responses after the user switches providers mid-flight.
  if (!isCurrentLoad()) return;

  if (!response?.ok) {
    setModelHint(response?.error?.message || "Failed to list models.");
    fillModels(modelSelect, [], undefined);
    modelsReady = false;
    updateAllowEnabled();
    return;
  }

  const models = Array.isArray(response.models) ? response.models : [];
  fillModels(modelSelect, models, preferredModel, {
    allowUnknown: true,
  });
  modelSelect.disabled = models.length === 0;

  if (models.length === 0) {
    setModelHint("No models available for this provider.");
    modelsReady = false;
  } else {
    setModelHint("");
    modelsReady = true;
  }
  updateAllowEnabled();
}

function previewMessages(messages) {
  return messages
    .map((m) => {
      const content =
        m.content.length > 280 ? `${m.content.slice(0, 280)}…` : m.content;
      return `${m.role}:\n${content}`;
    })
    .join("\n\n");
}

function updateRememberHint() {
  rememberHint.textContent = rememberInput.checked
    ? "Allow always, or never allow this site again."
    : "Allow once, or deny only this request.";
}

/**
 * @param {"allow" | "deny"} action
 */
async function decide(action) {
  // Read before disabling — some browsers can odd-path disabled controls.
  const remember = Boolean(rememberInput.checked);

  allowBtn.disabled = true;
  denyBtn.disabled = true;
  rememberInput.disabled = true;

  /** @type {"allow_once" | "always" | "deny" | "never"} */
  const decision =
    action === "allow"
      ? remember
        ? "always"
        : "allow_once"
      : remember
        ? "never"
        : "deny";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "resolve-approval",
      requestId,
      decision,
      providerId: providerSelect.value,
      model: modelSelect.value,
    });
    if (!response?.ok) {
      showError("This permission request is no longer active.");
      return;
    }
    window.close();
  } catch (err) {
    showError(err instanceof Error ? err.message : "Failed to send decision");
  }
}

async function load() {
  if (!requestId) {
    showError("Missing request id.");
    return;
  }

  const providersResponse = await chrome.runtime.sendMessage({
    type: "list-providers",
  });
  providers = Array.isArray(providersResponse?.providers)
    ? providersResponse.providers
    : [];
  if (providers.length === 0) {
    showError("No inference providers are available.");
    return;
  }

  await refreshOllamaStatus();

  const response = await chrome.runtime.sendMessage({
    type: "get-approval",
    requestId,
  });
  const request = response?.request;
  if (!request) {
    showError("This permission request expired or was cancelled.");
    return;
  }

  originEl.textContent = request.origin;
  const requestedId =
    typeof request.providerId === "string" &&
    providers.some((p) => p.id === request.providerId)
      ? request.providerId
      : providers[0].id;
  const providerId = fillProviders(requestedId);
  previewEl.textContent = previewMessages(request.messages || []);
  updateRememberHint();
  await loadModelsForProvider(
    providerId,
    providerId === requestedId ? request.model : undefined
  );
}

providerSelect.addEventListener("change", () => {
  const provider = providers.find((p) => p.id === providerSelect.value);
  void loadModelsForProvider(
    providerSelect.value,
    provider?.defaultModel || undefined
  );
});

rememberInput.addEventListener("change", updateRememberHint);
allowBtn.addEventListener("click", () => decide("allow"));
denyBtn.addEventListener("click", () => decide("deny"));

void load();
