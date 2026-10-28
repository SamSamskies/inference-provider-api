import { createAgent, type Agent, type AgentEvent, type AgentRunOptions,
  type AgentRunResult, type AgentTool, type AgentToolContext,
  type CreateAgentOptions, type ChatRequest, type ChatChunk,
} from "../../src/index.js";

const tool: AgentTool = {
  parameters: { type: "object" },
  execute(args, context) {
    const signal: AbortSignal | undefined = context.signal;
    const executionContext: AgentToolContext = context;
    // @ts-expect-error Tool arguments are unknown until validated by the app
    args.query;
    return { ok: true };
  },
};
const config: CreateAgentOptions = {
  name: "Explorer", instructions: "Cite sources", tools: { search: tool },
  request: async function* (req: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: "done", model: "mock", message: { role: "assistant", content: "Done" } };
  },
};
const agent: Agent = createAgent(config);
const options: AgentRunOptions = { history: [], maxRounds: 8, signal: new AbortController().signal };
const run: Promise<AgentRunResult> = agent.run("Question", options);
// @ts-expect-error name is read-only in the public API
agent.name = "Other";
// @ts-expect-error run input is a user string, not a request or message array
agent.run([{ role: "user", content: "Question" }]);
// @ts-expect-error named tools require executors
createAgent({ name: "Test", instructions: "", tools: { missing: { description: "Missing" } } });

function render(event: AgentEvent) {
  const agentName: string = event.agentName;
  switch (event.type) {
    case "agent_started":
    case "request_accepted": break;
    case "agent_completed": {
      const result: AgentRunResult = event.result;
      const output: string = result.output;
      const stop: "end_turn" | "max_rounds" = result.stopReason;
      break;
    }
    case "agent_failed": {
      const error: unknown = event.error;
      // @ts-expect-error failed runs have no success result
      event.result;
      break;
    }
    case "text_delta":
    case "reasoning_delta": {
      const content: string = event.content;
      break;
    }
    case "tool_started": {
      const args: unknown = event.arguments;
      const id: string = event.id;
      const name: string = event.name;
      // @ts-expect-error tool has not completed yet
      event.result;
      break;
    }
    case "tool_approval_requested": {
      const args: unknown = event.arguments;
      const round: number = event.round;
      const signal: AbortSignal | undefined = event.signal;
      break;
    }
    case "tool_completed": {
      const content: string = event.result;
      const id: string = event.id;
      break;
    }
    case "tool_failed": {
      const error: unknown = event.error;
      const id: string = event.id;
      break;
    }
    default: {
      const exhaustive: never = event;
    }
  }
}
