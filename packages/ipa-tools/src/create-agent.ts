import { makeInferenceError } from "./errors.js";
import { getInference } from "./inference.js";
import { runTools, type RunToolsOptions, type RunToolsResult } from "./run-tools.js";
import type { Message, Tool } from "./types.js";

export type AgentToolContext = {
  /** Pass to app-owned fetches or other cancellable work. */
  signal?: AbortSignal;
};

export type AgentTool = {
  description?: string;
  parameters?: Record<string, unknown>;
  /** Arguments are parsed JSON, not schema-validated. Validate before use. */
  execute: (args: unknown, context: AgentToolContext) => unknown | Promise<unknown>;
};

export type CreateAgentOptions = {
  /** Activity label; instructions alone define the system message. */
  name: string;
  instructions: string;
  tools?: Record<string, AgentTool>;
  /** Defaults to the current window.inference at run time. Custom requests own capability checks. */
  request?: RunToolsOptions["request"];
};

export type AgentRunResult = RunToolsResult & {
  /** Final assistant text, or "" when capped or when the final message has no text. */
  output: string;
};

export type AgentEvent = { agentName: string } & (
  | { type: "agent_started" }
  | { type: "agent_completed"; result: AgentRunResult }
  | { type: "agent_failed"; error: unknown }
  | { type: "request_accepted" }
  | { type: "text_delta"; content: string }
  | { type: "reasoning_delta"; content: string }
  | { type: "tool_started"; id: string; name: string; arguments: unknown }
  | { type: "tool_completed"; id: string; name: string; result: string }
  | { type: "tool_failed"; id: string; name: string; error: unknown }
);

export type AgentRunOptions = Pick<RunToolsOptions,
  "signal" | "maxRounds" | "options" | "toolChoice"
> & {
  /** Explicit history; passing a previous result.messages is supported. No state is retained. */
  history?: Message[];
  /** Synchronous observer, in execution order. Exceptions propagate; handlers should not throw. */
  onEvent?: (event: AgentEvent) => void;
};

export type Agent = {
  readonly name: string;
  run(input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
};

/** Small, stateless convenience wrapper around runTools. No provider or session setup. */
export function createAgent(config: CreateAgentOptions): Agent {
  if (!config || typeof config.name !== "string" || !config.name.trim() ||
      typeof config.instructions !== "string") {
    throw makeInferenceError("invalid_request", "createAgent requires a name and instructions.");
  }
  const { name, instructions, request: customRequest } = config;
  if (config.tools != null && (typeof config.tools !== "object" || Array.isArray(config.tools))) {
    throw makeInferenceError("invalid_request", "Agent tools must be a named object.");
  }
  const descriptors = Object.entries(config.tools ?? {}).map(([toolName, tool]) => {
    if (!toolName || !tool || typeof tool.execute !== "function") {
      throw makeInferenceError("invalid_request", `Agent tool "${toolName}" requires an execute handler.`);
    }
    return [toolName, { ...tool }] as const;
  });
  const tools: Tool[] = descriptors.map(([toolName, tool]) => ({
    type: "function",
    function: { name: toolName, description: tool.description, parameters: tool.parameters },
  }));

  return {
    name,
    async run(input, options = {}) {
      const emit = (event: AgentEvent) => options.onEvent?.(event);
      let result: AgentRunResult;
      try {
        emit({ type: "agent_started", agentName: name });
        if (typeof input !== "string" ||
            (options.history !== undefined && !Array.isArray(options.history))) {
          throw makeInferenceError("invalid_request", "Agent run requires string input and an optional history array.");
        }
        if (options.signal?.aborted) {
          throw makeInferenceError("aborted", "Request aborted");
        }
        if (options.maxRounds !== undefined &&
            (!Number.isInteger(options.maxRounds) || options.maxRounds < 1)) {
          throw makeInferenceError("invalid_request", "Agent maxRounds must be a positive integer.");
        }
        let request = customRequest;
        if (!request) {
          const inference = getInference();
          if (tools.length && inference.getFeatures?.().toolCalling !== true) {
            throw makeInferenceError("invalid_request", "Agent function tools require getFeatures().toolCalling to be true.");
          }
          request = inference.request.bind(inference);
        }

        const history = options.history ?? [];
        // Replace a leading system message so reused result.messages (this agent
        // or another) never stack two instructions prompts.
        const rest = history[0]?.role === "system" ? history.slice(1) : history;
        const messages: Message[] = [{ role: "system", content: instructions }, ...rest];
        messages.push({ role: "user", content: input });
        const execute = Object.fromEntries(descriptors.map(([toolName, tool]) => [
          toolName, (args: unknown) => tool.execute(args, { signal: options.signal }),
        ]));
        const run = await runTools({
          messages,
          ...(tools.length ? { tools, execute } : {}),
          request,
          signal: options.signal,
          maxRounds: options.maxRounds,
          options: options.options,
          toolChoice: options.toolChoice,
          onAccepted: () => emit({ type: "request_accepted", agentName: name }),
          onDelta: (content) => emit({ type: "text_delta", agentName: name, content }),
          onReasoningDelta: (content) => emit({ type: "reasoning_delta", agentName: name, content }),
          onToolCall: (info) => emit({ type: "tool_started", agentName: name, ...info }),
          onToolResult: (info) => emit({ type: "tool_completed", agentName: name, ...info }),
          onToolError: (info) => emit({ type: "tool_failed", agentName: name, ...info }),
        });
        const message = run.final.message;
        const content = message.role === "assistant" ? message.content : null;
        const output = run.stopReason !== "end_turn" ? "" :
          typeof content === "string" ? content :
          content?.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
        result = { ...run, output };
      } catch (error) {
        // Preserve the original failure even if the observer also throws on failure.
        try { emit({ type: "agent_failed", agentName: name, error }); } catch { /* observer failed */ }
        throw error;
      }
      emit({ type: "agent_completed", agentName: name, result });
      return result;
    },
  };
}
