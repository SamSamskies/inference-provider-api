import {
  createResolver,
  requestNeedsImageInput,
  requestNeedsImageOutput,
  requestNeedsTools,
  requestNeedsWebSearch,
  type FallbackInput,
} from "./backends.js";
import { makeInferenceError } from "./errors.js";
import { getInference } from "./inference.js";
import type {
  DoneChunk,
  InferenceOptions,
  ChatRequest,
  ChatChunk,
  Message,
  Tool,
  ToolCall,
  ToolChoice,
} from "./types.js";

export type ToolExecutor = (args: unknown) => unknown | Promise<unknown>;

export type ToolRunContext = {
  readonly id: string;
  readonly name: string;
  /** One-based provider round and the configured provider-call limit. */
  readonly round: number;
  readonly maxRounds: number;
  readonly signal?: AbortSignal;
  /** The app's declared function tool, when available. */
  readonly tool?: Extract<Tool, { type: "function" }>;
};

/** Return exactly true to accept; false, invalid returns, and throws stop the run. */
export type ToolArgumentValidator = (
  args: unknown, context: ToolRunContext
) => boolean | Promise<boolean>;

export type ToolPolicy = {
  /** No built-in schema engine. Check the declared schema and app constraints here. */
  validateArguments?: ToolArgumentValidator;
  requiresApproval?: boolean;
};

export type ToolApprovalRequest = ToolRunContext & {
  /** Parsed JSON, deeply frozen whenever toolPolicies is configured. */
  readonly arguments: unknown;
};

export type ToolApprovalHandler = (request: ToolApprovalRequest) => boolean | Promise<boolean>;

/** Why `runTools` stopped. `"end_turn"` is a text `done`; `"max_rounds"` is tools on the last provider call. */
export type RunToolsStopReason = "end_turn" | "max_rounds";

export type RunToolsOptions = {
  messages: Message[];
  tools?: Tool[];
  execute?: Record<string, ToolExecutor>;
  /** Opt in per run. Every executed tool must have an own entry; {} explicitly opts out of guards. */
  toolPolicies?: Record<string, ToolPolicy>;
  /** App-owned approval; required tools only execute on exactly true. */
  onApprovalRequest?: ToolApprovalHandler;
  /** Optional serialized result limit in UTF-16 code units; oversized results stop the run. */
  maxToolResultChars?: number;
  toolChoice?: ToolChoice;
  /** Forwarded on every round. Same object each provider call. */
  options?: InferenceOptions;
  /** Forwarded on every round when requesting image output. */
  output?: ChatRequest["output"];
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
  /** After execution, cancellation checks, and successful result serialization. */
  onToolResult?: (info: { id: string; name: string; result: string }) => void;
  /** Parsing, policy, validation, approval, execution, serialization, or cancellation failure. */
  onToolError?: (info: { id: string; name: string; error: unknown }) => void;
  signal?: AbortSignal;
  /** Default `"chat"`. */
  method?: "chat";
  /** Defaults to `window.inference.request`. */
  request?: (request: ChatRequest) => AsyncIterable<ChatChunk>;
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
    onApprovalRequest,
    maxToolResultChars,
    maxRounds = 5,
    toolChoice,
    options: requestOptions,
    output,
    onAccepted,
    onDelta,
    onReasoningDelta,
    onToolCall,
    onToolResult,
    onToolError,
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
  if (maxToolResultChars !== undefined &&
      (!Number.isSafeInteger(maxToolResultChars) || maxToolResultChars < 1)) {
    throw makeInferenceError("invalid_request", "maxToolResultChars must be a positive safe integer.");
  }
  // Copy app-owned policy before provider work or callbacks can change it mid-run.
  const policies = snapshotToolPolicies(options.toolPolicies);

  let request = options.request;
  if (!request) {
    if (options.fallbacks != null || options.onDownloadProgress != null) {
      const resolver = createResolver({
        fallbacks: options.fallbacks,
        onDownloadProgress: options.onDownloadProgress,
      });
      const inference = await resolver.resolve({
        needsTools: requestNeedsTools(options),
        needsWebSearch: requestNeedsWebSearch(options),
        needsImageInput: requestNeedsImageInput(options),
        needsImageOutput: requestNeedsImageOutput(options),
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

    const req: ChatRequest = {
      method,
      messages,
      signal,
    };
    if (tools !== undefined) req.tools = tools;
    if (toolChoice !== undefined) req.toolChoice = toolChoice;
    if (requestOptions !== undefined) req.options = requestOptions;
    if (output !== undefined) req.output = output;

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

    if (signal?.aborted) {
      throw makeInferenceError("aborted", "Request aborted");
    }
    if (!done) {
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

      let content: string;
      try {
        const executor =
          execute && typeof execute === "object" && Object.hasOwn(execute, name)
            ? execute[name] : undefined;
        if (typeof executor !== "function") {
          throw makeInferenceError(
            "invalid_request",
            `No execute handler for tool "${name}".`
          );
        }

        const args = parseToolArguments(call.function?.arguments, name);
        const policy = policies?.get(name);
        if (policies && !policy) {
          throw makeInferenceError("invalid_request", `No tool policy for "${name}".`);
        }
        if (policies) freezeArguments(args);
        const context: ToolRunContext = Object.freeze({
          id, name, round: round + 1, maxRounds, signal,
          tool: tools?.find((tool): tool is Extract<Tool, { type: "function" }> =>
            tool.type === "function" && tool.function.name === name),
        });
        if (typeof onToolCall === "function") {
          onToolCall({ id, name, arguments: args });
        }
        if (signal?.aborted) {
          throw makeInferenceError("aborted", "Request aborted");
        }
        if (policy?.validateArguments !== undefined) {
          const valid = await awaitToolGate(() => policy.validateArguments!(args, context), signal);
          if (valid !== true) {
            throw makeInferenceError("invalid_request", `Tool "${name}" arguments failed validation.`);
          }
        }
        if (policy?.requiresApproval) {
          if (typeof onApprovalRequest !== "function") {
            throw makeInferenceError("permission_denied", `Tool "${name}" requires app approval.`);
          }
          const approved = await awaitToolGate(() => onApprovalRequest(
            Object.freeze({ ...context, arguments: args })
          ), signal);
          if (approved !== true) {
            throw makeInferenceError("permission_denied", `App approval denied for tool "${name}".`);
          }
        }
        if (signal?.aborted) {
          throw makeInferenceError("aborted", "Request aborted");
        }
        const result = await executor(args);
        if (signal?.aborted) {
          throw makeInferenceError("aborted", "Request aborted");
        }
        content = serializeToolResult(result);
        if (maxToolResultChars !== undefined && content.length > maxToolResultChars) {
          throw makeInferenceError("invalid_request", `Tool "${name}" result exceeds maxToolResultChars.`);
        }
        if (signal?.aborted) {
          throw makeInferenceError("aborted", "Request aborted");
        }
      } catch (error) {
        onToolError?.({ id, name, error });
        throw error;
      }
      messages = [
        ...messages,
        {
          role: "tool",
          toolCallId: id,
          content,
        },
      ];
      onToolResult?.({ id, name, result: content });
    }

    if (signal?.aborted) {
      throw makeInferenceError("aborted", "Request aborted");
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

function snapshotToolPolicies(policies: RunToolsOptions["toolPolicies"]): Map<string, ToolPolicy> | undefined {
  if (policies === undefined) return undefined;
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) {
    throw makeInferenceError("invalid_request", "toolPolicies must be a named object.");
  }
  return new Map(Object.entries(policies).map(([name, policy]) => {
    if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
        (policy.validateArguments !== undefined && typeof policy.validateArguments !== "function") ||
        (policy.requiresApproval !== undefined && typeof policy.requiresApproval !== "boolean")) {
      throw makeInferenceError("invalid_request", `Invalid tool policy for "${name}".`);
    }
    return [name, { validateArguments: policy.validateArguments, requiresApproval: policy.requiresApproval }];
  }));
}

/** Parsed JSON is acyclic. Iterate to avoid overflowing on deeply nested arguments. */
function freezeArguments(args: unknown): void {
  const pending = [args];
  while (pending.length) {
    const value = pending.pop();
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) pending.push(child);
      Object.freeze(value);
    }
  }
}

/** Abort pending gates promptly; consume late rejections and never resume execution. */
async function awaitToolGate(action: () => boolean | Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) throw makeInferenceError("aborted", "Request aborted");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal) {
      onAbort = () => reject(makeInferenceError("aborted", "Request aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  const pending = Promise.resolve().then(() => {
    if (signal?.aborted) throw makeInferenceError("aborted", "Request aborted");
    return action();
  });
  pending.catch(() => {});
  try {
    const result = await Promise.race([pending, aborted]);
    if (signal?.aborted) throw makeInferenceError("aborted", "Request aborted");
    return result;
  } finally {
    if (onAbort) signal!.removeEventListener("abort", onAbort);
  }
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
