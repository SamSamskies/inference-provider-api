import { makeInferenceError } from "./errors.js";
import { getInference } from "./inference.js";
import type { DoneChunk, Inference, InferenceRequest } from "./types.js";

export type CompleteOptions = {
  /** Defaults to `window.inference.request`. */
  request?: Inference["request"];
};

/**
 * Drain a chat stream until the `done` chunk and return it.
 * Re-throws whatever `request` throws. Throws `provider_error` if the stream
 * ends without a `done` chunk.
 */
export async function complete(
  request: InferenceRequest,
  options?: CompleteOptions
): Promise<DoneChunk> {
  let requestFn = options?.request;
  if (!requestFn) {
    const inference = getInference();
    requestFn = inference.request.bind(inference);
  }

  let done: DoneChunk | undefined;
  for await (const chunk of requestFn(request)) {
    if (chunk?.type === "done") {
      done = chunk;
    }
  }

  if (!done) {
    throw makeInferenceError(
      "provider_error",
      "Stream ended without a done chunk."
    );
  }

  return done;
}
