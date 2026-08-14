/**
 * Inference Provider API types (from SPEC.md).
 * Importing this module augments `Window` with optional `inference`.
 */

export type InferenceRequest = {
  method: "chat";
  messages: Message[];
  /** Function tools. Only when getFeatures().toolCalling is true. */
  tools?: Tool[];
  toolChoice?: ToolChoice;
  signal?: AbortSignal;
};

export type Message =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      /** Model reasoning / chain-of-thought, when the provider exposes it. */
      reasoning?: string;
      toolCalls?: ToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
    };

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type InferenceChunk =
  | { type: "accepted" }
  | { type: "reasoning_delta"; content: string }
  | { type: "delta"; content: string }
  | { type: "done"; model: string; message: Message; usage?: Usage };

export type InferenceFeatures = {
  /**
   * Implementation accepts tools, toolChoice, and tool messages on request.
   * Absent or false means unsupported.
   */
  toolCalling?: boolean;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** JSON Schema object for the function arguments. */
    parameters?: { [key: string]: unknown };
  };
};

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded argument object. */
    arguments: string;
  };
};

export type InferenceErrorCode =
  | "permission_denied"
  | "invalid_request"
  | "unavailable"
  | "provider_error"
  | "aborted";

export type InferenceError = Error & {
  code: InferenceErrorCode;
};

export type Inference = {
  request(request: InferenceRequest): AsyncIterable<InferenceChunk>;
  getFeatures?(): InferenceFeatures;
};

export type DoneChunk = Extract<InferenceChunk, { type: "done" }>;

declare global {
  interface Window {
    inference?: Inference;
  }
}

export {};
