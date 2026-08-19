import {
  createResolver,
  requestNeedsTools,
  type FallbackInput,
} from "./backends.js";
import { makeInferenceError } from "./errors.js";
import { getInference } from "./inference.js";
import type {
  DoneChunk,
  Inference,
  InferenceOptions,
  InferenceRequest,
  Message,
  Tool,
  ToolCall,
  ToolChoice,
} from "./types.js";

export type ToolExecutor = (args: unknown) => unknown | Promise<unknown>;

/** Why `runTools` stopped. `"end_turn"` is a text `done`; `"max_rounds"` is tools on the last provider call. */
export type RunToolsStopReason = "end_turn" | "max_rounds";

export type RunToolsOptions = {
  messages: Message[];
  tools?: Tool[];
  execute?: Record<string, ToolExecutor>;
  toolChoice?: ToolChoice;
  /** Forwarded on every round. Same object each provider call. */
  options?: InferenceOptions;
  /** Default 5; max provider calls. Must be a positive finite number. */
  maxRounds?: number;
  onAccepted?: () => void;
  onDelta?: (content: string) => void;
  onReasoningDelta?: (content: string) => void;
  onToolCall?: (info: {
    id: string;
    name: string;
    arguments: unknown;
  }) => void;
  signal?: AbortSignal;
  /** Default `"chat"`. */
  method?: "chat";
  /** Defaults to `window.inference.request`. */
  request?: Inference["request"];
  /**
   * Tried only after IPA is unavailable (at most one entry; see `MAX_FALLBACKS`).
   * Prefer `createInference` when sending more than once (caches the resolved
   * backend).
   */
  fallbacks?: FallbackInput[];
  /** Forwarded to fallback `create()` when resolving via `fallbacks`. */
  onDownloadProgress?: (loaded: number) => void;
};

export type RunToolsResult = {
  messages: Message[];
  final: DoneChunk;
  stopReason: RunToolsStopReason;
};

/**
 * Serialize a tool handler result for a `role: "tool"` message.
 * Strings pass through; other values are JSON-stringified.
 */
export function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : "null";
  } catch (err) {
    throw makeInferenceError(
      "invalid_request",
      `Tool result is not JSON-serializable: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Parse `function.arguments` JSON. Empty / missing becomes `{}`.
 */
export function parseToolArguments(
  argumentsJson: string | undefined | null,
  toolName: string
): unknown {
  const raw =
    argumentsJson == null || argumentsJson === "" ? "{}" : argumentsJson;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw makeInferenceError(
      "invalid_request",
      `Tool "${toolName}" arguments are not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Page-executed multi-round function-tool loop.
 * Does not talk to providers or keys — only calls the supplied `request`
 * (or `window.inference.request`) and `execute` handlers.
 * `maxRounds` is max provider calls: last-round toolCalls are executed and
 * returned (`stopReason: "max_rounds"`), not thrown.
 */
export async function runTools(
  options: RunToolsOptions
): Promise<RunToolsResult> {
  if (options == null || typeof options !== "object") {
    throw makeInferenceError(
      "invalid_request",
      "runTools options must be an object."
    );
  }

  const {
    tools,
    execute,
    maxRounds = 5,
    toolChoice,
    options: requestOptions,
    onAccepted,
    onDelta,
    onReasoningDelta,
    onToolCall,
    signal,
    method = "chat",
  } = options;

  if (!Array.isArray(options.messages)) {
    throw makeInferenceError(
      "invalid_request",
      "runTools requires a messages array."
    );
  }
  if (
    typeof maxRounds !== "number" ||
    !Number.isFinite(maxRounds) ||
    maxRounds < 1
  ) {
    throw makeInferenceError(
      "invalid_request",
      "maxRounds must be a positive number."
    );
  }

  let request = options.request;
  if (!request) {
    if (options.fallbacks != null || options.onDownloadProgress != null) {
      const resolver = createResolver({
        fallbacks: options.fallbacks,
        onDownloadProgress: options.onDownloadProgress,
      });
      const inference = await resolver.resolve({
        needsTools: requestNeedsTools(options),
        signal,
      });
      request = inference.request.bind(inference);
    } else {
      const inference = getInference();
      request = inference.request.bind(inference);
    }
  }

  if (typeof request !== "function") {
    throw makeInferenceError(
      "invalid_request",
      "runTools requires a request function."
    );
  }

  let messages: Message[] = [...options.messages];

  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) {
      throw makeInferenceError("aborted", "Request aborted");
    }

    const req: InferenceRequest = {
      method,
      messages,
      signal,
    };
    if (tools !== undefined) req.tools = tools;
    if (toolChoice !== undefined) req.toolChoice = toolChoice;
    if (requestOptions !== undefined) req.options = requestOptions;

    let done: DoneChunk | undefined;
    for await (const chunk of request(req)) {
      if (signal?.aborted) {
        throw makeInferenceError("aborted", "Request aborted");
      }
      if (!chunk || typeof chunk !== "object") continue;
      if (chunk.type === "accepted" && typeof onAccepted === "function") {
        onAccepted();
      } else if (chunk.type === "delta" && typeof onDelta === "function") {
        onDelta(chunk.content);
      } else if (
        chunk.type === "reasoning_delta" &&
        typeof onReasoningDelta === "function"
      ) {
        onReasoningDelta(chunk.content);
      } else if (chunk.type === "done") {
        done = chunk;
      }
    }

    if (!done) {
      if (signal?.aborted) {
        throw makeInferenceError("aborted", "Request aborted");
      }
      throw makeInferenceError(
        "provider_error",
        "Stream ended without a done chunk."
      );
    }

    const message = done.message;
    const toolCalls =
      message &&
      typeof message === "object" &&
      message.role === "assistant" &&
      Array.isArray(message.toolCalls) &&
      message.toolCalls.length > 0
        ? message.toolCalls
        : null;

    if (!toolCalls) {
      if (message && typeof message === "object") {
        messages = [...messages, message];
      }
      return { messages, final: done, stopReason: "end_turn" };
    }

    const assistantMessage: Extract<Message, { role: "assistant" }> = {
      role: "assistant",
      content: message.role === "assistant" ? (message.content ?? null) : null,
      toolCalls,
    };
    if (
      message.role === "assistant" &&
      typeof message.reasoning === "string" &&
      message.reasoning
    ) {
      assistantMessage.reasoning = message.reasoning;
    }

    messages = [...messages, assistantMessage];

    for (const call of toolCalls) {
      if (signal?.aborted) {
        throw makeInferenceError("aborted", "Request aborted");
      }

      const name = toolCallName(call);
      if (typeof name !== "string" || !name) {
        throw makeInferenceError(
          "provider_error",
          "Tool call is missing a function name."
        );
      }

      const id = call && typeof call === "object" ? call.id : undefined;
      if (typeof id !== "string" || !id) {
        throw makeInferenceError(
          "provider_error",
          "Tool call is missing an id."
        );
      }

      const executor =
        execute && typeof execute === "object" ? execute[name] : undefined;
      if (typeof executor !== "function") {
        throw makeInferenceError(
          "invalid_request",
          `No execute handler for tool "${name}".`
        );
      }

      const args = parseToolArguments(call.function?.arguments, name);
      if (typeof onToolCall === "function") {
        onToolCall({ id, name, arguments: args });
      }
      const result = await executor(args);
      if (signal?.aborted) {
        throw makeInferenceError("aborted", "Request aborted");
      }
      messages = [
        ...messages,
        {
          role: "tool",
          toolCallId: id,
          content: serializeToolResult(result),
        },
      ];
    }

    if (round === maxRounds - 1) {
      return { messages, final: done, stopReason: "max_rounds" };
    }
  }

  throw makeInferenceError(
    "provider_error",
    `Tool loop exceeded maxRounds (${maxRounds}).`
  );
}

function toolCallName(call: ToolCall): string | undefined {
  if (
    call &&
    typeof call === "object" &&
    call.function &&
    typeof call.function === "object"
  ) {
    return call.function.name;
  }
  return undefined;
}
