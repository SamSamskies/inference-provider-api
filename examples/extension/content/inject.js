/**
 * MAIN-world bridge: defines window.inference per SPEC.md.
 * Injected only into top-level frames (manifest all_frames: false).
 *
 * Talks to the isolated content script over a MessagePort established at
 * document_start (before page scripts run), so other MAIN-world scripts
 * cannot observe or forge stream events via window.postMessage.
 */
(() => {
  if (window !== window.top) return;
  if (window.inference) return;

  const CHANNEL = "__ipa_inference__";
  let nextId = 1;

  /** @type {MessagePort | null} */
  let bridgePort = null;
  /** @type {Map<string, (data: any) => void>} */
  const pending = new Map();
  /** @type {Map<string, (data: any) => void>} */
  const streamHandlers = new Map();

  /**
   * @param {string} code
   * @param {string} message
   */
  function makeError(code, message) {
    const error = new Error(message || code);
    error.name = "InferenceError";
    /** @type {any} */ (error).code = code;
    return error;
  }

  function onWindowInit(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== "init") return;
    if (bridgePort || !event.ports || !event.ports[0]) return;

    bridgePort = event.ports[0];
    bridgePort.onmessage = onBridgeMessage;
    window.removeEventListener("message", onWindowInit);
  }

  window.addEventListener("message", onWindowInit);

  /**
   * @param {MessageEvent} event
   */
  function onBridgeMessage(event) {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (typeof data.id === "string" && pending.has(data.id)) {
      const settle = pending.get(data.id);
      pending.delete(data.id);
      settle(data);
      return;
    }

    if (typeof data.streamId === "string" && streamHandlers.has(data.streamId)) {
      streamHandlers.get(data.streamId)(data);
    }
  }

  /**
   * One-shot request/response with the content script over the private port.
   * @param {object} payload
   */
  function sendToExtension(payload) {
    return new Promise((resolve, reject) => {
      if (!bridgePort) {
        reject(makeError("unavailable", "Extension bridge is not ready."));
        return;
      }

      const id = `req_${nextId++}_${Math.random().toString(36).slice(2, 9)}`;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(makeError("unavailable", "Extension did not respond."));
      }, 30_000);

      pending.set(id, (data) => {
        clearTimeout(timeout);
        if (data.error) {
          reject(makeError(data.error.code || "provider_error", data.error.message));
        } else {
          resolve(data);
        }
      });

      try {
        bridgePort.postMessage({ id, ...payload });
      } catch (err) {
        clearTimeout(timeout);
        pending.delete(id);
        reject(
          makeError(
            "unavailable",
            err instanceof Error ? err.message : "Extension unavailable"
          )
        );
      }
    });
  }

  /**
   * Lazy AsyncIterable — the extension call starts when iteration begins.
   * @param {any} request
   */
  function createStream(request) {
    const signal = request && typeof request === "object" ? request.signal : undefined;

    return {
      [Symbol.asyncIterator]() {
        /** @type {"idle" | "open" | "closed"} */
        let state = "idle";
        /** @type {Array<{ kind: "chunk", value: any } | { kind: "end" } | { kind: "error", error: Error }>} */
        const queue = [];
        /** @type {Set<() => void>} */
        const waiters = new Set();
        let streamId = "";
        /** @type {(() => void) | null} */
        let onAbort = null;
        /** @type {Promise<void> | null} */
        let startPromise = null;

        function wake() {
          if (waiters.size === 0) return;
          const pending = [...waiters];
          waiters.clear();
          for (const n of pending) n();
        }

        function enqueue(item) {
          if (state === "closed" && item.kind !== "error") return;
          queue.push(item);
          wake();
        }

        function cleanupListeners() {
          if (streamId) {
            streamHandlers.delete(streamId);
          }
          if (onAbort && signal) {
            signal.removeEventListener("abort", onAbort);
            onAbort = null;
          }
        }

        function abortRemote() {
          if (!streamId || !bridgePort) return;
          try {
            bridgePort.postMessage({ type: "abort", streamId });
          } catch {
            // ignore
          }
        }

        function closeWithError(error) {
          if (state === "closed") return;
          state = "closed";
          cleanupListeners();
          enqueue({ kind: "error", error });
        }

        function closeNormally() {
          if (state === "closed") return;
          state = "closed";
          cleanupListeners();
          enqueue({ kind: "end" });
        }

        /**
         * @param {any} data
         */
        function onStreamData(data) {
          if (data.type === "chunk") {
            enqueue({ kind: "chunk", value: data.chunk });
            if (data.chunk?.type === "done") {
              closeNormally();
            }
          } else if (data.type === "error") {
            closeWithError(
              makeError(data.error?.code || "provider_error", data.error?.message)
            );
          }
        }

        async function start() {
          if (!window.isSecureContext) {
            throw makeError(
              "unavailable",
              "window.inference is only available in a secure context (HTTPS or localhost)."
            );
          }

          const serializable =
            request && typeof request === "object" ? { ...request } : {};
          delete serializable.signal;

          const started = await sendToExtension({
            type: "start",
            request: serializable,
          });

          streamId = started.streamId;
          state = "open";
          streamHandlers.set(streamId, onStreamData);

          if (signal) {
            if (signal.aborted) {
              abortRemote();
              throw makeError("aborted", "Request aborted");
            }
            onAbort = () => {
              abortRemote();
              closeWithError(makeError("aborted", "Request aborted"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        return {
          async next() {
            if (state === "idle") {
              // Share one in-flight start across concurrent next() callers.
              if (!startPromise) {
                startPromise = start().catch((err) => {
                  state = "closed";
                  cleanupListeners();
                  throw err;
                });
              }
              await startPromise;
            }

            while (true) {
              if (queue.length > 0) {
                const item = queue.shift();
                if (item.kind === "chunk") return { value: item.value, done: false };
                if (item.kind === "end") return { value: undefined, done: true };
                if (item.kind === "error") throw item.error;
              }

              if (state === "closed") {
                return { value: undefined, done: true };
              }

              await new Promise((resolve) => {
                waiters.add(resolve);
              });
            }
          },

          async return() {
            abortRemote();
            cleanupListeners();
            state = "closed";
            queue.length = 0;
            return { value: undefined, done: true };
          },

          async throw(err) {
            abortRemote();
            cleanupListeners();
            state = "closed";
            queue.length = 0;
            throw err;
          },
        };
      },
    };
  }

  Object.defineProperty(window, "inference", {
    value: Object.freeze({
      request(request) {
        return createStream(request);
      },
    }),
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
