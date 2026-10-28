/**
 * Application helpers and TypeScript types for the Inference Provider API.
 *
 * Streaming stays on `window.inference.request`. Importing this package
 * (or its types) applies the `Window` augmentation.
 */

import "./types.js";

export type {
  ChatRequest,
  ChatChunk,
  ChatDoneChunk,
  DecideRequest,
  DecisionJsonValue,
  DecisionState,
  DecisionQuestion,
  NoulQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  DecisionAnswer,
  NoulAnswer,
  ChoiceAnswer,
  ScoreAnswer,
  RefusalAnswer,
  DecisionChunk,
  DecisionDoneChunk,
  ContentPart,
  DoneChunk,
  ImageMediaType,
  ImagePart,
  Inference,
  InferenceChunk,
  InferenceChunkFor,
  InferenceDoneFor,
  InferenceMethod,
  InferenceError,
  InferenceErrorCode,
  InferenceFeatures,
  InferenceOptions,
  InferenceRequest,
  Message,
  ReasoningEffort,
  TextPart,
  TranscribeRequest,
  TranscriptionMediaSource,
  TranscriptionInputConstraint,
  TranscriptionChunk,
  TranscriptionDoneChunk,
  TranscriptionUsage,
  SynthesizeRequest,
  SynthesisMediaType,
  SynthesisChunk,
  SynthesisDoneChunk,
  SynthesisUsage,
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
  createAgent,
  type Agent,
  type AgentEvent,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentTool,
  type AgentToolContext,
  type CreateAgentOptions,
} from "./create-agent.js";
export {
  parseToolArguments,
  runTools,
  serializeToolResult,
  type RunToolsOptions,
  type RunToolsResult,
  type RunToolsStopReason,
  type ToolExecutor,
  type ToolRunContext,
  type ToolPolicy,
  type ToolArgumentValidator,
  type ToolApprovalRequest,
  type ToolApprovalHandler,
} from "./run-tools.js";
export {
  createInference,
  type CreateInferenceOptions,
  type InferenceClient,
} from "./create-inference.js";
export {
  MAX_FALLBACKS,
  type BackendAvailability,
  type FallbackEntry,
  type FallbackInput,
  type InferenceBackend,
  type ProbeStatus,
} from "./backends.js";
