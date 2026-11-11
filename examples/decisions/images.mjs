import { imageDecisionRequest, inspectImage } from "./inspect-image.mjs";

const canonicalTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const typeNames = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP", "image/gif": "GIF" };

export function imageSupport(win = window) {
  const context = win.isSecureContext && win.location.origin !== "null" && win.top === win;
  if (!context) return { types: [], message: "Open this demo in a top-level HTTPS or localhost page. File URLs are not supported." };
  if (typeof win.inference?.request !== "function") return { types: [], message: "Install an IPA extension, then reload this page." };
  let features;
  try { features = win.inference.getFeatures?.() ?? {}; } catch { features = {}; }
  const types = features.decisionMedia?.imageMediaTypes;
  if (features.methods?.decide !== true || !Array.isArray(types) || !types.length ||
    new Set(types).size !== types.length || !types.every((type) => canonicalTypes.includes(type))) {
    return { types: [], message: "Your extension needs native image support for Decisions. Text Decisions and chat images alone do not enable this demo." };
  }
  return { types: [...types], message: "" };
}

export function mountImageDemo(doc = document, win = window) {
  const el = (id) => doc.getElementById(id);
  const fileInput = el("image-file");
  const preview = el("image-preview");
  let types = [];
  let selected;
  let previewUrl;
  let active;
  let selection = 0;
  let discoveryTimer;

  function clearResults() {
    el("image-result").hidden = true;
    el("empty-result").hidden = false;
    el("result-json").textContent = "No completed result yet.";
    el("request-error").hidden = true;
    el("request-error").textContent = "";
  }

  function updateControls() {
    const busy = Boolean(active);
    fileInput.disabled = busy || !types.length;
    el("inspect").disabled = busy || !selected || !types.includes(selected.type);
    el("clear-image").disabled = busy || !selected;
    el("cancel-image").hidden = !busy;
    el("results-panel").setAttribute("aria-busy", String(busy));
  }

  function releasePreview() {
    preview.removeAttribute("src");
    if (previewUrl) win.URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  }

  function clearSelection(resetInput = true) {
    selection++;
    selected = undefined;
    if (resetInput) fileInput.value = "";
    releasePreview();
    el("image-figure").hidden = true;
    el("empty-image").hidden = false;
    el("file-error").hidden = true;
    fileInput.removeAttribute("aria-invalid");
    el("request-json").textContent = "Choose an image to build a request. Binary data is omitted from this outline.";
    clearResults();
    updateControls();
  }

  function refreshFeatures() {
    const support = imageSupport(win);
    types = support.types;
    el("connection-status").textContent = types.length ? "Image support ready" : "Image support unavailable";
    el("connection-status").dataset.ready = String(Boolean(types.length));
    el("connection").hidden = Boolean(types.length);
    el("connection-title").textContent = "Image support unavailable";
    el("connection-message").textContent = support.message;
    el("file-hint").textContent = types.length ? `Choose ${types.map((type) => typeNames[type]).join(", ")}. Size limits depend on your extension and selected route.` : "File selection becomes available when your extension supports image Decisions.";
    fileInput.accept = types.length ? types.join(",") : canonicalTypes.join(",");
    updateControls();
    return types.length > 0;
  }

  function fileError(message) {
    clearSelection();
    el("file-error").textContent = message;
    el("file-error").hidden = false;
    fileInput.setAttribute("aria-invalid", "true");
    el("request-status").textContent = message;
  }

  function chooseImage() {
    const file = fileInput.files?.[0];
    clearSelection(false);
    if (!file) return;
    if (!types.includes(file.type)) {
      fileError("Choose an image with a type supported by your extension.");
      return;
    }
    if (!file.size) { fileError("This file is empty. Choose another image."); return; }
    const current = selection;
    const url = win.URL.createObjectURL(file);
    previewUrl = url;
    preview.onload = () => {
      if (current !== selection) return;
      selected = file;
      el("image-figure").hidden = false;
      el("empty-image").hidden = true;
      el("file-meta").textContent = `${file.name} · ${file.type} · ${file.size.toLocaleString()} bytes`;
      el("request-json").textContent = JSON.stringify(imageDecisionRequest({ mediaType: file.type,
        data: `[File: ${file.size} bytes; binary omitted from outline]` }), null, 2);
      el("request-status").textContent = "Image ready. Inspect it when you’re ready to send it.";
      updateControls();
    };
    preview.onerror = () => {
      if (current === selection) fileError("This file could not be previewed as an image. Choose another file.");
    };
    preview.src = url;
  }

  function cancel() {
    if (!active) return;
    active.abort();
    active = undefined; // Late extension results cannot replace a newer inspection.
    clearResults();
    el("request-status").textContent = "Cancelled. No completed result.";
    const restoreFocus = doc.activeElement === el("cancel-image");
    updateControls();
    if (restoreFocus) el("inspect").focus();
  }

  async function inspect(event) {
    event.preventDefault();
    if (active || !selected || !refreshFeatures() || !types.includes(selected.type)) return;
    clearResults();
    const controller = new AbortController();
    active = controller;
    el("request-status").textContent = "Waiting for image approval…";
    updateControls();
    try {
      const done = await inspectImage({ mediaType: selected.type, data: selected }, {
        signal: controller.signal,
        onAccepted: () => { if (active === controller) el("request-status").textContent = "Inspecting image…"; },
      });
      if (active !== controller || controller.signal.aborted) return;
      const answer = done.answers.damaged;
      const refused = answer.type === "refusal";
      el("damage-answer").textContent = refused ? "Refused" : `${Math.round(answer.noul * 100)}%`;
      el("damage-meter").hidden = refused;
      el("damage-scale").hidden = refused;
      if (!refused) el("damage-meter").value = answer.noul;
      el("damage-description").textContent = refused ? "The provider declined to judge this image. No probability was returned." : "Probability that the item has visible damage. This is a yes/no judgment, not a measure of damage severity.";
      const usage = [];
      if (Number.isSafeInteger(done.usage?.inputTokens) && done.usage.inputTokens >= 0) usage.push(`${done.usage.inputTokens} input tokens`);
      if (Number.isSafeInteger(done.usage?.outputTokens) && done.usage.outputTokens >= 0) usage.push(`${done.usage.outputTokens} output tokens`);
      el("result-meta").textContent = [done.model, ...usage].join(" · ");
      el("result-json").textContent = JSON.stringify(done, null, 2);
      el("image-result").hidden = false;
      el("empty-result").hidden = true;
      el("request-status").textContent = refused ? "Inspection complete. The provider refused this question." : "Inspection complete.";
    } catch (error) {
      if (active !== controller) return;
      if (error.code === "aborted" || controller.signal.aborted) {
        el("request-status").textContent = "Cancelled. No completed result.";
      } else {
        const guidance = {
          unavailable: "The selected Decisions route cannot inspect this image. Choose a compatible route in your extension and retry.",
          permission_denied: "Image inspection was not approved. Allow image Decisions for this site in your extension to retry.",
          invalid_request: "The image type, format, or size was rejected.",
          provider_error: "The provider could not complete a valid image decision. Try again or check your extension’s route.",
        };
        el("request-error").textContent = `${guidance[error.code] ?? "Image inspection failed."} ${error.message ?? ""}`;
        el("request-error").hidden = false;
        el("request-status").textContent = "No completed result. See the error below.";
      }
    } finally {
      if (active === controller) {
        active = undefined;
        const restoreFocus = doc.activeElement === el("cancel-image");
        updateControls();
        if (restoreFocus) el("inspect").focus();
      }
    }
  }

  fileInput.addEventListener("change", chooseImage);
  el("image-form").addEventListener("submit", inspect);
  el("clear-image").addEventListener("click", () => { clearSelection(); el("request-status").textContent = "Choose an image to get started."; fileInput.focus(); });
  el("cancel-image").addEventListener("click", cancel);
  el("recheck").addEventListener("click", refreshFeatures);
  win.addEventListener("focus", refreshFeatures);
  win.addEventListener("pageshow", refreshFeatures);
  win.addEventListener("pagehide", () => { win.clearInterval(discoveryTimer); cancel(); clearSelection(); });
  if (!refreshFeatures()) {
    const deadline = Date.now() + 3_000;
    discoveryTimer = win.setInterval(() => {
      if (refreshFeatures() || Date.now() >= deadline) win.clearInterval(discoveryTimer);
    }, 100);
  }
}

if (typeof document !== "undefined") mountImageDemo();
