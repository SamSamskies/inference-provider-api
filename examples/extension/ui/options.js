import {
  getSettings,
  saveSettings,
  listAllowedOrigins,
  listBlockedOrigins,
  revokeOrigin,
  setOriginModel,
  unblockOrigin,
} from "../src/storage.js";
import { OPENAI_MODELS } from "../src/providers/openai.js";

const apiKeyInput = document.getElementById("apiKey");
const toggleApiKeyButton = document.getElementById("toggleApiKey");
const modelSelect = document.getElementById("model");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");
const originsEl = document.getElementById("origins");
const originsEmpty = document.getElementById("originsEmpty");
const blockedEl = document.getElementById("blocked");
const blockedEmpty = document.getElementById("blockedEmpty");

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

toggleApiKeyButton.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
  toggleApiKeyButton.textContent = showing ? "Show" : "Hide";
  toggleApiKeyButton.setAttribute("aria-pressed", showing ? "false" : "true");
});

/**
 * @param {HTMLSelectElement} select
 * @param {string | undefined} selected
 */
function populateModelSelect(select, selected) {
  select.replaceChildren();
  const models = new Set(OPENAI_MODELS);
  if (selected) models.add(selected);
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    if (model === selected) option.selected = true;
    select.append(option);
  }
  if (!selected && select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

async function renderOrigins(fallbackModel) {
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

    const modelLabel = document.createElement("label");
    modelLabel.className = "origin-model";
    const modelCaption = document.createElement("span");
    modelCaption.textContent = "Model";
    const originModelSelect = document.createElement("select");
    originModelSelect.setAttribute("aria-label", `Model for ${grant.origin}`);
    populateModelSelect(originModelSelect, grant.model || fallbackModel);
    originModelSelect.addEventListener("change", async () => {
      const ok = await setOriginModel(grant.origin, originModelSelect.value);
      if (ok) {
        setStatus(`Updated model for ${grant.origin}`, "ok");
      } else {
        setStatus(`Could not update ${grant.origin}`, "err");
        await renderOrigins(fallbackModel);
      }
    });
    modelLabel.append(modelCaption, originModelSelect);
    meta.append(modelLabel);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "danger";
    button.textContent = "Revoke";
    button.addEventListener("click", async () => {
      await revokeOrigin(grant.origin);
      await renderOrigins(fallbackModel);
      setStatus(`Revoked ${grant.origin}`, "ok");
    });

    li.append(meta, button);
    originsEl.append(li);
  }
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

async function load() {
  const settings = await getSettings();
  apiKeyInput.value = settings.openaiApiKey;
  populateModelSelect(modelSelect, settings.defaultModel);
  await renderOrigins(settings.defaultModel);
  await renderBlocked();
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  try {
    await saveSettings({
      openaiApiKey: apiKeyInput.value,
      defaultModel: modelSelect.value,
    });
    setStatus("Saved.", "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Failed to save", "err");
  } finally {
    saveButton.disabled = false;
  }
});

void load();
