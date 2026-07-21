/**
 * ISOLATED-world content script: relays between page (MAIN) and service worker.
 */
(() => {
  const CHANNEL = "__ipa_inference__";

  /** @type {Map<string, chrome.runtime.Port>} */
  const ports = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== "to-extension") return;

    if (data.type === "start") {
      handleStart(data);
      return;
    }

    if (data.type === "abort") {
      const port = ports.get(data.streamId);
      if (port) {
        try {
          port.postMessage({ type: "abort", streamId: data.streamId });
        } catch {
          // ignore
        }
      }
    }
  });

  /**
   * @param {any} data
   */
  function handleStart(data) {
    const correlationId = data.id;
    let port;
    try {
      port = chrome.runtime.connect({ name: "ipa-inference" });
    } catch (err) {
      postToPage({
        id: correlationId,
        error: {
          code: "unavailable",
          message: err instanceof Error ? err.message : "Extension unavailable",
        },
      });
      return;
    }

    let streamId = "";
    let started = false;

    port.onMessage.addListener((msg) => {
      if (msg.type === "started") {
        streamId = msg.streamId;
        ports.set(streamId, port);
        started = true;
        postToPage({
          id: correlationId,
          streamId,
        });
        return;
      }

      if (msg.type === "chunk") {
        postToPage({
          streamId,
          type: "chunk",
          chunk: msg.chunk,
        });
        return;
      }

      if (msg.type === "error") {
        if (!started) {
          postToPage({
            id: correlationId,
            error: msg.error,
          });
        } else {
          postToPage({
            streamId,
            type: "error",
            error: msg.error,
          });
        }
        cleanup();
      }
    });

    port.onDisconnect.addListener(() => {
      if (!started) {
        postToPage({
          id: correlationId,
          error: {
            code: "unavailable",
            message: chrome.runtime.lastError?.message || "Extension disconnected",
          },
        });
      } else {
        postToPage({
          streamId,
          type: "error",
          error: { code: "aborted", message: "Extension disconnected" },
        });
      }
      cleanup();
    });

    function cleanup() {
      if (streamId) ports.delete(streamId);
      try {
        port.disconnect();
      } catch {
        // ignore
      }
    }

    try {
      // Always use the tab's real origin — never trust a page-claimed origin.
      port.postMessage({
        type: "start",
        request: data.request,
        origin: location.origin,
        pageUrl: location.href,
      });
    } catch (err) {
      postToPage({
        id: correlationId,
        error: {
          code: "unavailable",
          message: err instanceof Error ? err.message : "Failed to start request",
        },
      });
      cleanup();
    }
  }

  /**
   * @param {object} payload
   */
  function postToPage(payload) {
    window.postMessage(
      {
        channel: CHANNEL,
        direction: "from-extension",
        ...payload,
      },
      "*"
    );
  }
})();
