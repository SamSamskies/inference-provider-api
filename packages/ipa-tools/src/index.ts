/**
 * Application helpers and TypeScript types for the Inference Provider API.
 *
 * Streaming stays on `window.inference.request`. Importing this package
 * (or its types) applies the `Window` augmentation.
 */

import "./types.js";

export type {
  DoneChunk,
  Inference,
  InferenceChunk,
  InferenceError,
  InferenceErrorCode,
  InferenceFeatures,
  InferenceOptions,
  InferenceRequest,
  Message,
  ReasoningEffort,
  Tool,
  ToolCall,
  ToolChoice,
  Usage,
} from "./types.js";

export { isInferenceError, makeInferenceError } from "./errors.js";
export {
  getFeatures,
  getInference,
  isInferenceAvailable,
  waitForInference,
  type WaitForInferenceOptions,
} from "./inference.js";
export { complete, type CompleteOptions } from "./complete.js";
export {
  parseToolArguments,
  runTools,
  serializeToolResult,
  type RunToolsOptions,
  type RunToolsResult,
  type ToolExecutor,
} from "./run-tools.js";
