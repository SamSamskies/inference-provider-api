import { availability, runResearch, answerSegments } from "./research.js";

const el = (id) => document.getElementById(id);
let controller = null, helper;
const steps = new Map();

function loadHelper(signal) {
  helper ??= import("https://esm.sh/ipa-tools@3.2.0").catch(() => {
    helper = undefined;
    throw new Error("Could not load ipa-tools. Check your connection and try again.");
  });
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Research stopped.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Loading ipa-tools timed out. Check your connection and try again.")); }, 15_000);
    signal.addEventListener("abort", abort, { once: true });
    helper.then(resolve, reject).finally(cleanup);
    if (signal.aborted) abort();
  });
}

function support() {
  return availability(window.inference, window.isSecureContext, window.self === window.top);
}
function controls() {
  const running = controller !== null;
  el("explore").disabled = running || !support().ready || !el("question").value.trim();
  el("explore").hidden = running;
  el("stop").hidden = !running;
  el("question").disabled = running;
  document.querySelectorAll("[data-prompt]").forEach((button) => { button.disabled = running; });
  el("question-count").textContent = `${el("question").value.length} / 1,000`;
  document.querySelector(".answer-panel").setAttribute("aria-busy", String(running));
}
function refresh() {
  const state = support();
  el("connection").hidden = state.ready;
  el("connection-status").dataset.ready = String(state.ready);
  el("connection-status").textContent = state.ready ? "ready" : "unavailable";
  el("connection-status").title = state.message;
  el("connection-label").textContent = typeof window.inference?.request === "function" ? "Tool calling unavailable" : "Connect an extension";
  el("connection-help").textContent = state.message;
  el("install").hidden = typeof window.inference?.request === "function";
  controls();
  return state.ready;
}
function activity(title, detail = "", state = "complete") {
  el("empty-activity").hidden = true;
  const row = document.createElement("li");
  const label = document.createElement("strong"), description = document.createElement("small");
  label.textContent = title; description.textContent = detail;
  row.dataset.state = state; row.append(label, description); el("activity").append(row);
  return { row, label, description };
}
function sourceLink(source, label) {
  const link = document.createElement("a");
  link.href = source.url; link.textContent = label; link.target = "_blank"; link.rel = "noopener noreferrer";
  link.title = source.title;
  return link;
}
function showSources(sources) {
  el("sources").replaceChildren();
  for (const source of sources) {
    const row = document.createElement("li"), detail = document.createElement("small");
    row.append(sourceLink(source, `[${source.id}] ${source.title}`));
    detail.textContent = source.truncated ? "Wikipedia · excerpt truncated to 12,000 characters" : "Wikipedia · article text retrieved";
    row.append(detail); el("sources").append(row);
  }
  el("sources-section").hidden = !sources.length;
  el("source-count").textContent = `${sources.length} source${sources.length === 1 ? "" : "s"} read`;
}
function event(event) {
  switch (event.type) {
    case "agent_started":
      activity("Research started", "Waiting for your extension and selected model."); break;
    case "request_accepted":
      el("status").textContent = "Analyzing the question and gathered evidence…";
      el("activity-state").textContent = "Analyzing"; break;
    case "tool_started": {
      const search = event.name === "search_articles";
      const title = search ? "Searching Wikipedia" : "Reading an article";
      steps.set(event.id, activity(title, search ? event.arguments.query : `Page ${event.arguments.pageId}`, "running"));
      el("status").textContent = search ? "Searching for reference articles…" : "Reading selected article text…";
      el("activity-state").textContent = search ? "Searching" : "Reading";
      break;
    }
    case "tool_completed": {
      const step = steps.get(event.id);
      if (!step) break;
      const result = JSON.parse(event.result);
      step.row.dataset.state = result.error ? "failed" : "complete";
      if (event.name === "search_articles") {
        step.label.textContent = result.articles.length ? `Found ${result.articles.length} articles` : "No matching articles";
        step.description.textContent += result.articles.length ? ` · ${result.articles.map((article) => article.title).join(", ")}` : " · Trying another query may help.";
      } else {
        step.label.textContent = result.error ? "Article unavailable" : `Read ${result.title}`;
        step.description.textContent = result.error ?? `[${result.id}] ${result.text.length.toLocaleString()} characters${result.truncated ? " · truncated excerpt" : ""}`;
      }
      el("status").textContent = "Analyzing sources and deciding what to explore next…";
      el("activity-state").textContent = "Analyzing";
      break;
    }
    case "tool_failed": {
      const step = steps.get(event.id);
      if (step) { step.row.dataset.state = "failed"; step.label.textContent = "Tool failed"; step.description.textContent = event.error?.message ?? "Could not complete this step."; }
      break;
    }
    // Text deltas can be intermediate tool-round prose. Publish only the final answer.
    case "text_delta": el("status").textContent = "The model is working…"; break;
  }
}

async function explore(e) {
  e.preventDefault();
  if (controller || !support().ready || !el("question").value.trim()) return;
  const active = new AbortController(); controller = active;
  el("error").hidden = true; el("answer").hidden = true; el("answer").replaceChildren();
  el("empty-answer").hidden = false;
  el("empty-answer").querySelector("p").textContent = "Your answer will appear when the agent finishes. Follow its progress alongside.";
  el("activity").replaceChildren(); steps.clear(); showSources([]);
  el("status").textContent = "Starting research…"; el("activity-state").textContent = "Starting"; controls();
  try {
    // Load on demand so connection/setup guidance still works if the CDN is unavailable.
    const module = await loadHelper(active.signal);
    if (active.signal.aborted) throw new DOMException("Research stopped.", "AbortError");
    const result = await runResearch({ createAgent: module.createAgent, inference: window.inference,
      input: el("question").value, signal: active.signal, onEvent: event, onSources: showSources });
    for (const segment of answerSegments(result.output, result.sources)) {
      if (segment.source) el("answer").append(sourceLink(segment.source, segment.text));
      else if (segment.bold) {
        const strong = document.createElement("strong"); strong.textContent = segment.text; el("answer").append(strong);
      } else el("answer").append(document.createTextNode(segment.text));
    }
    el("answer").hidden = false; el("empty-answer").hidden = true;
    const linked = el("answer").querySelectorAll("a").length;
    activity("Research complete", linked ? "Answer ready. Follow the citations to inspect the evidence." : "The answer has no valid inline citations. Inspect the sources below before relying on it.");
    el("status").textContent = linked ? "Research complete. Check the sources behind the answer." : "Answer ready, but the model omitted valid inline citations. Check Sources consulted.";
    el("activity-state").textContent = "Complete";
  } catch (error) {
    const cancelled = active.signal.aborted || error?.code === "aborted" || error?.name === "AbortError";
    const message = cancelled ? "Research stopped. No completed answer." : error?.message ?? String(error);
    const guidance = {
      permission_denied: " Allow function tools for this site in Inference Bridge, then try again.",
      invalid_request: " Check your selected provider/model supports function tools and try again.",
      provider_error: " Check your provider and model in Inference Bridge, then try again.",
    };
    if (!cancelled) { el("error").textContent = message + (guidance[error?.code] ?? ""); el("error").hidden = false; }
    activity(cancelled ? "Research stopped" : "Research could not finish", message, "failed");
    el("status").textContent = cancelled ? message : "No completed answer. Any articles already read remain below.";
    el("activity-state").textContent = cancelled ? "Stopped" : "Failed";
  } finally {
    if (controller === active) { controller = null; controls(); }
  }
}

el("research-form").addEventListener("submit", explore);
el("question").addEventListener("input", controls);
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
  el("question").value = button.dataset.prompt; controls(); el("question").focus();
}));
el("stop").addEventListener("click", () => { controller?.abort(); el("status").textContent = "Stopping research…"; });
el("recheck").addEventListener("click", refresh);
window.addEventListener("focus", refresh);
window.addEventListener("pageshow", refresh);
let discovery;
window.addEventListener("pagehide", () => { clearInterval(discovery); controller?.abort(); });
if (!refresh()) {
  const deadline = Date.now() + 3000;
  discovery = setInterval(() => { if (refresh() || Date.now() >= deadline) clearInterval(discovery); }, 100);
}
