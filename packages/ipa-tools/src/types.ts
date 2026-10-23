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

export type ChatRequest = {
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

/** Finite JSON values only; no cycles, sparse arrays, binary, or custom objects. */
export type DecisionJsonValue =
  | null | boolean | number | string
  | DecisionJsonValue[]
  | { [key: string]: DecisionJsonValue };

export type DecisionState = string | DecisionJsonValue[] | { [key: string]: DecisionJsonValue };

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  /** 2–26 named choices; null means the key needs no further description. */
  criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  /** 2–10 ordered descriptions, indexed from zero. */
  criteria: string[];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type DecideRequest = {
  method: "decide";
  state: DecisionState;
  /** 1–64 questions over the same state; no dependencies between answers. */
  questions: Record<string, DecisionQuestion>;
  signal?: AbortSignal;
};

/** Exactly one page-owned source. String data is raw base64, never a data URL. */
export type TranscriptionMediaSource =
  | { mediaType: string; data: string; url?: never }
  | { mediaType?: string; data: Blob; url?: never }
  | { url: string; mediaType?: string; data?: never };

export type TranscribeRequest = {
  method: "transcribe";
  media: TranscriptionMediaSource;
  /** Structurally valid BCP 47 hint; omitted means detect. */
  language?: string;
  signal?: AbortSignal;
};

export type SynthesisMediaType = "audio/mpeg" | "audio/wav";

export type SynthesizeRequest = {
  method: "synthesize";
  text: string;
  /** Omitted output or mediaType means MP3; WAV requires explicit discovery. */
  output?: { mediaType?: SynthesisMediaType };
  signal?: AbortSignal;
};

export type InferenceRequest = ChatRequest | DecideRequest | TranscribeRequest | SynthesizeRequest;
export type InferenceMethod = InferenceRequest["method"];

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

export type ChatChunk =
  | { type: "accepted" }
  | { type: "reasoning_delta"; content: string }
  | { type: "delta"; content: string }
  | { type: "done"; model: string; message: Message; usage?: Usage };

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type RefusalAnswer = { type: "refusal" };
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer | RefusalAnswer;

export type DecisionChunk =
  | { type: "accepted" }
  | { type: "done"; model: string; answers: Record<string, DecisionAnswer>; usage?: Usage };

export type TranscriptionUsage = { inputSeconds?: number };
export type SynthesisUsage = {
  inputCharacters?: number;
  outputSeconds?: number;
};

export type TranscriptionChunk =
  | { type: "accepted" }
  | { type: "delta"; content: string }
  | {
      type: "done";
      model: string;
      transcript: { text: string; language?: string };
      usage?: TranscriptionUsage;
    };

export type SynthesisChunk =
  | { type: "accepted" }
  | { type: "audio_delta"; mediaType: SynthesisMediaType; data: Uint8Array }
  | {
      type: "done";
      model: string;
      audio: { mediaType: SynthesisMediaType; byteLength: number };
      usage?: SynthesisUsage;
    };

export type InferenceChunk = ChatChunk | DecisionChunk | TranscriptionChunk | SynthesisChunk;

/** Distributes over request unions while preserving concrete method inference. */
export type InferenceChunkFor<R extends InferenceRequest> =
  R extends ChatRequest ? ChatChunk :
  R extends DecideRequest ? DecisionChunk :
  R extends TranscribeRequest ? TranscriptionChunk :
  R extends SynthesizeRequest ? SynthesisChunk : never;

export type InferenceDoneFor<R extends InferenceRequest> =
  Extract<InferenceChunkFor<R>, { type: "done" }>;
export type ChatDoneChunk = InferenceDoneFor<ChatRequest>;
export type DecisionDoneChunk = InferenceDoneFor<DecideRequest>;
export type TranscriptionDoneChunk = InferenceDoneFor<TranscribeRequest>;
export type SynthesisDoneChunk = InferenceDoneFor<SynthesizeRequest>;

export type TranscriptionInputConstraint = {
  /** Normalized MIME essence; no wildcards. */
  mediaType: string;
  containers?: string[];
  audioCodecs?: string[];
};

export type InferenceFeatures = {
  /** Chat is required. Absent or false optional methods mean unsupported. */
  methods?: {
    decide?: boolean;
    transcribe?: { acceptedMedia: TranscriptionInputConstraint[] };
    /** true means MP3 only; an object declares exactly its nonempty format list. */
    synthesize?: boolean | { outputMediaTypes: SynthesisMediaType[] };
  };
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
  request<R extends InferenceRequest>(request: R): AsyncIterable<InferenceChunkFor<R>>;
  getFeatures?(): InferenceFeatures;
};

/** Compatible chat-only alias; never widened to the all-method done union. */
export type DoneChunk = ChatDoneChunk;

declare global {
  interface Window {
    inference?: Inference;
  }
}

export {};
