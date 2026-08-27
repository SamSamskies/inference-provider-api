/**
 * Inference Provider API types (from SPEC.md).
 * Importing this module augments `Window` with optional `inference`.
 */

export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export type TextPart = {
  type: "text";
  text: string;
};

/**
 * Image bytes (`data`) or a page-side URL (`url`), never both.
 * `done.message` image parts always use `{ mediaType, data }` as a base64 string.
 * On the page-facing API, `data` may be a `Blob`; injectors encode before an
 * isolated-world hop. `{ url }` is resolved in the page (same CORS as the site).
 */
export type ImagePart =
  | {
      type: "image";
      mediaType: ImageMediaType;
      data: string | Blob;
    }
  | { type: "image"; url: string };

export type ContentPart = TextPart | ImagePart;

export type InferenceRequest = {
  method: "chat";
  messages: Message[];
  /**
   * Function tools and/or `{ type: "web_search" }`.
   * Function tools only when getFeatures().toolCalling is true.
   * `{ type: "web_search" }` only when getFeatures().webSearch is true.
   */
  tools?: Tool[];
  toolChoice?: ToolChoice;
  /**
   * Image generation for this turn.
   * `output.images` only when getFeatures().imageOutput is true.
   * Extra keys under `output` are ignored (forward compatible).
   */
  output?: {
    images?: boolean;
  };
  /** Generation preferences for this request. See InferenceOptions. */
  options?: InferenceOptions;
  signal?: AbortSignal;
};

export type InferenceOptions = {
  /**
   * Preferred reasoning / thinking effort.
   * Distinct from assistant `message.reasoning` (output text).
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Sampling temperature in `[0, 2]`.
   * Omitted means the implementation / provider default.
   */
  temperature?: number;
};

/** Omitted or `"auto"` means the implementation / provider default. */
export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high";

export type Message =
  | {
      role: "system";
      content: string;
    }
  | {
      role: "user";
      content: string | ContentPart[];
    }
  | {
      role: "assistant";
      content: string | ContentPart[] | null;
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
   * Implementation accepts function tools, toolChoice, and tool messages
   * on request. Absent or false means unsupported.
   */
  toolCalling?: boolean;
  /**
   * Implementation accepts `{ type: "web_search" }` in `tools`.
   * Absent or false means unsupported. Independent of `toolCalling`.
   */
  webSearch?: boolean;
  /**
   * Implementation accepts ImageParts in `messages` (user uploads and
   * round-tripped assistant images). Absent or false means unsupported.
   * Independent of `imageOutput`.
   */
  imageInput?: boolean;
  /**
   * Implementation accepts `output.images`; `done.message` may contain
   * ImageParts. Absent or false means unsupported. Independent of `imageInput`.
   */
  imageOutput?: boolean;
  /**
   * Which InferenceOptions keys this implementation accepts.
   * Absent keys (and an absent options object) mean ignore those fields.
   */
  options?: {
    reasoningEffort?: boolean;
    temperature?: boolean;
  };
};

export type Tool =
  | {
      type: "function";
      function: {
        name: string;
        description?: string;
        /** JSON Schema object for the function arguments. */
        parameters?: { [key: string]: unknown };
      };
    }
  | { type: "web_search" };

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
