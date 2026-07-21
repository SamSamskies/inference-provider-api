/**
 * MAIN-world bridge: defines window.inference per SPEC.md.
 * Injected only into top-level frames (manifest all_frames: false).
 */
(() => {
  if (window !== window.top) return;
  if (window.inference) return;

  const CHANNEL = "__ipa_inference__";
  let nextId = 1;

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

  /**
   * One-shot request/response with the content script.
   * @param {object} payload
   */
  function sendToExtension(payload) {
    return new Promise((resolve, reject) => {
      const id = `req_${nextId++}_${Math.random().toString(36).slice(2, 9)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(makeError("unavailable", "Extension did not respond."));
      }, 30_000);

      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.channel !== CHANNEL || data.direction !== "from-extension") return;
        if (data.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (data.error) {
          reject(makeError(data.error.code || "provider_error", data.error.message));
        } else {
          resolve(data);
        }
      }

      window.addEventListener("message", onMessage);
      window.postMessage({ channel: CHANNEL, direction: "to-extension", id, ...payload }, "*");
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
        /** @type {(() => void) | null} */
        let notify = null;
        let streamId = "";
        /** @type {((event: MessageEvent) => void) | null} */
        let onMessage = null;
        /** @type {(() => void) | null} */
        let onAbort = null;

        function wake() {
          if (notify) {
            const n = notify;
            notify = null;
            n();
          }
        }

        function enqueue(item) {
          if (state === "closed" && item.kind !== "error") return;
          queue.push(item);
          wake();
        }

        function cleanupListeners() {
          if (onMessage) {
            window.removeEventListener("message", onMessage);
            onMessage = null;
          }
          if (onAbort && signal) {
            signal.removeEventListener("abort", onAbort);
            onAbort = null;
          }
        }

        function abortRemote() {
          if (!streamId) return;
          window.postMessage(
            { channel: CHANNEL, direction: "to-extension", type: "abort", streamId },
            "*"
          );
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

          onMessage = (event) => {
            if (event.source !== window) return;
            const data = event.data;
            if (!data || data.channel !== CHANNEL || data.direction !== "from-extension") return;
            if (data.streamId !== streamId) return;

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
          };
          window.addEventListener("message", onMessage);

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
              try {
                await start();
              } catch (err) {
                state = "closed";
                cleanupListeners();
                throw err;
              }
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
                notify = resolve;
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
