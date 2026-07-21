/**
 * ISOLATED-world content script: relays between page (MAIN) and service worker.
 *
 * Establishes a MessageChannel with the MAIN-world bridge at document_start
 * (before page scripts run). Stream traffic stays on that port so other
 * MAIN-world scripts cannot forge or sniff window.postMessage events.
 */
(() => {
  const CHANNEL = "__ipa_inference__";

  /** @type {Map<string, chrome.runtime.Port>} */
  const ports = new Map();

  const { port1: bridgePort, port2 } = new MessageChannel();

  bridgePort.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

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
  };

  // inject.js is listed first in the manifest so its init listener is ready.
  window.postMessage({ channel: CHANNEL, direction: "init" }, "*", [port2]);

  /**
   * @param {any} data
   */
  function handleStart(data) {
    const correlationId = data.id;

    /**
     * @param {object} payload
     */
    function postToPage(payload) {
      try {
        bridgePort.postMessage(payload);
      } catch {
        // ignore — page may have navigated away
      }
    }

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
    let cleanedUp = false;

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
        // Final done chunk ends the stream — drop the port map entry and disconnect.
        if (msg.chunk?.type === "done") {
          cleanup();
        }
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
      if (cleanedUp) return;
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
      if (cleanedUp) return;
      cleanedUp = true;
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
})();
