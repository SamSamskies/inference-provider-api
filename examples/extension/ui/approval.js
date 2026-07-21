import { OPENAI_MODELS } from "../src/providers/openai.js";

const params = new URLSearchParams(location.search);
const requestId = params.get("requestId");

const originEl = document.getElementById("origin");
const modelSelect = document.getElementById("model");
const previewEl = document.getElementById("preview");
const errorEl = document.getElementById("error");
const rememberInput = document.getElementById("remember");
const rememberHint = document.getElementById("rememberHint");
const allowBtn = document.getElementById("allow");
const denyBtn = document.getElementById("deny");

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
  allowBtn.disabled = true;
  denyBtn.disabled = true;
  rememberInput.disabled = true;
}

function fillModels(selected) {
  modelSelect.replaceChildren();
  const models = new Set(OPENAI_MODELS);
  if (selected) models.add(selected);
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    if (model === selected) option.selected = true;
    modelSelect.append(option);
  }
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
  fillModels(request.model);
  previewEl.textContent = previewMessages(request.messages || []);
  updateRememberHint();
}

rememberInput.addEventListener("change", updateRememberHint);
allowBtn.addEventListener("click", () => decide("allow"));
denyBtn.addEventListener("click", () => decide("deny"));

void load();
