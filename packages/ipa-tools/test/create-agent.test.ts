import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgent, type AgentEvent, type AgentTool, type ChatChunk,
  type ChatRequest, type Message } from "../src/index.js";

const call = (name = "search", id = "c1", args = '{"query":"GPS"}'): Message => ({
  role: "assistant", content: "Looking up sources",
  toolCalls: [{ type: "function", id, function: { name, arguments: args } }],
});
const done = (message: Message): ChatChunk => ({ type: "done", model: "test", message });
const answer = done({ role: "assistant", content: "GPS history [source]" });
function mockRequest(...turns: ChatChunk[][]) {
  let round = 0;
  return vi.fn((_request: ChatRequest): AsyncIterable<ChatChunk> => ({
    async *[Symbol.asyncIterator]() { yield* turns[round++] ?? []; },
  }));
}
const search: AgentTool = {
  description: "Search articles",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  execute: () => ({ title: "GPS", url: "https://example.org/GPS" }),
};

afterEach(() => vi.unstubAllGlobals());

describe("createAgent", () => {
  it("maps two tools, streams events, and preserves full results over three rounds", async () => {
    const request = mockRequest(
      [{ type: "accepted" }, { type: "reasoning_delta", content: "Plan" },
        { type: "delta", content: "Searching" }, done(call())],
      [done(call("read", "c2", '{"title":"GPS"}'))],
      [{ type: "delta", content: "GPS history [source]" }, answer],
    );
    const executeSearch = vi.fn(search.execute);
    const executeRead = vi.fn(() => "Article text");
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const agent = createAgent({ name: "Explorer", instructions: "Cite real sources.", request,
      tools: { search: { ...search, execute: executeSearch }, read: { execute: executeRead } },
    });
    const history: Message[] = [{ role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" }];
    const options = { temperature: 0, reasoningEffort: "low" as const };
    const result = await agent.run("GPS history?", { history, signal: controller.signal,
      maxRounds: 8, options, toolChoice: "auto", onEvent: (event) => events.push(event) });

    expect(result.output).toBe("GPS history [source]");
    expect(result.final).toBe(answer);
    expect(result.stopReason).toBe("end_turn");
    expect(result.messages).toHaveLength(9);
    expect(request).toHaveBeenCalledTimes(3);
    const firstRequest = request.mock.calls[0]![0];
    expect(firstRequest.messages).toEqual([{ role: "system", content: "Cite real sources." },
      ...history, { role: "user", content: "GPS history?" }]);
    expect(firstRequest.tools).toEqual([
      { type: "function", function: { name: "search", description: search.description, parameters: search.parameters } },
      { type: "function", function: { name: "read" } },
    ]);
    expect(JSON.stringify(firstRequest.tools)).not.toContain("execute");
    for (const [req] of request.mock.calls) {
      expect(req.signal).toBe(controller.signal);
      expect(req.options).toBe(options);
      expect(req.toolChoice).toBe("auto");
    }
    expect(executeSearch).toHaveBeenCalledWith({ query: "GPS" }, { signal: controller.signal });
    expect(executeRead).toHaveBeenCalledWith({ title: "GPS" }, { signal: controller.signal });
    expect(events.map((event) => event.type)).toEqual([
      "agent_started", "request_accepted", "reasoning_delta", "text_delta",
      "tool_started", "tool_completed", "tool_started", "tool_completed",
      "text_delta", "agent_completed",
    ]);
    expect(events.every((event) => event.agentName === "Explorer")).toBe(true);
    expect(events[4]).toEqual({ type: "tool_started", agentName: "Explorer", id: "c1",
      name: "search", arguments: { query: "GPS" } });
    expect(events[5]).toEqual({ type: "tool_completed", agentName: "Explorer", id: "c1",
      name: "search", result: JSON.stringify(search.execute({}, {})) });
    expect(events.at(-1)).toEqual({ type: "agent_completed", agentName: "Explorer", result });
    expect(history).toHaveLength(2);
  });

  it("accepts full prior messages without duplicating system instructions and retains no hidden history", async () => {
    const request = mockRequest([answer], [answer], [answer]);
    const agent = createAgent({ name: "Explorer", instructions: "Be helpful", request });
    const first = await agent.run("One");
    const snapshot = [...first.messages];
    await agent.run("Two", { history: first.messages });
    await agent.run("Three");
    expect(request.mock.calls[1]![0].messages).toEqual([...snapshot, { role: "user", content: "Two" }]);
    expect(first.messages).toEqual(snapshot);
    expect(request.mock.calls[2]![0].messages).toEqual([
      { role: "system", content: "Be helpful" }, { role: "user", content: "Three" },
    ]);
    expect(request.mock.calls[0]![0].tools).toBeUndefined();
  });

  it("replaces a mismatched leading system message instead of stacking instructions", async () => {
    const request = mockRequest([answer]);
    const history: Message[] = [
      { role: "system", content: "Old instructions" },
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ];
    await createAgent({ name: "Explorer", instructions: "Be helpful", request })
      .run("Follow up", { history });
    expect(request.mock.calls[0]![0].messages).toEqual([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Follow up" },
    ]);
    expect(history[0]).toEqual({ role: "system", content: "Old instructions" });
  });

  it("keeps overlapping runs' messages, events, and signals separate", async () => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const firstSignal = new AbortController().signal;
    const secondSignal = new AbortController().signal;
    const firstEvents: AgentEvent[] = [];
    const secondEvents: AgentEvent[] = [];
    const request = mockRequest([done(call())], [done(call())], [answer], [answer]);
    const signals: Array<AbortSignal | undefined> = [];
    const agent = createAgent({ name: "Test", instructions: "", request, tools: { search: {
      execute: async (_args, { signal }) => {
        signals.push(signal);
        if (signal === firstSignal) { entered(); await blocked; }
        return "result";
      },
    } } });
    const first = agent.run("One", { signal: firstSignal, onEvent: (event) => firstEvents.push(event) });
    await started;
    const second = await agent.run("Two", { signal: secondSignal, onEvent: (event) => secondEvents.push(event) });
    expect(firstEvents.some((event) => event.type === "agent_completed")).toBe(false);
    release();
    const firstResult = await first;
    expect(signals).toEqual([firstSignal, secondSignal]);
    expect(firstResult.messages.filter((message) => message.role === "user")).toEqual([{ role: "user", content: "One" }]);
    expect(second.messages.filter((message) => message.role === "user")).toEqual([{ role: "user", content: "Two" }]);
    expect(firstEvents.at(-1)).toMatchObject({ type: "agent_completed", result: firstResult });
    expect(secondEvents.at(-1)).toMatchObject({ type: "agent_completed", result: second });
  });

  it("preserves the original error when the failure observer throws", async () => {
    const error = new Error("Provider offline");
    const agent = createAgent({ name: "Test", instructions: "", request: () => { throw error; } });
    await expect(agent.run("hi", { onEvent: (event) => {
      if (event.type === "agent_failed") throw new Error("Observer failed");
    } })).rejects.toBe(error);
  });

  it("returns the run result when the completion observer throws", async () => {
    const request = mockRequest([answer]);
    const result = await createAgent({ name: "Test", instructions: "", request }).run("hi", {
      onEvent: (event) => {
        if (event.type === "agent_completed") throw new Error("Observer failed");
      },
    });
    expect(result.output).toBe("GPS history [source]");
    expect(result.stopReason).toBe("end_turn");
  });

  it("executes last-round tools, keeps max_rounds, and exposes no final output", async () => {
    const request = mockRequest([done(call())], [answer]);
    const execute = vi.fn(search.execute);
    const events: AgentEvent[] = [];
    const result = await createAgent({ name: "Explorer", instructions: "Research", request,
      tools: { search: { execute } },
    }).run("GPS", { maxRounds: 1, onEvent: (event) => events.push(event) });
    expect(request).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(result.stopReason).toBe("max_rounds");
    expect(result.output).toBe("");
    expect(result.final.message).toEqual(call());
    expect(result.messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "c1" });
    expect(events.at(-1)).toMatchObject({ type: "agent_completed", result: { stopReason: "max_rounds" } });
  });

  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid agent maxRounds %s before requesting", async (maxRounds) => {
    const request = mockRequest([answer]);
    const events: AgentEvent[] = [];
    await expect(createAgent({ name: "Test", instructions: "", request })
      .run("hi", { maxRounds, onEvent: (event) => events.push(event) }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["agent_failed"]);
  });

  it.each([
    { input: 1, options: {} },
    { input: "hi", options: { history: { not: "array" } } },
  ])("rejects invalid input or history before agent_started: %j", async ({ input, options }) => {
    const request = mockRequest([answer]);
    const events: AgentEvent[] = [];
    await expect(createAgent({ name: "Test", instructions: "", request })
      .run(input as never, { ...options, onEvent: (event) => events.push(event) }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["agent_failed"]);
  });

  it.each(["executor", "serialization", "arguments", "missing_handler"])("reports tool and agent failure for %s errors", async (kind) => {
    const error = new Error("Tool offline");
    const circular: { self?: unknown } = {}; circular.self = circular;
    const execute = vi.fn(() => {
      if (kind === "executor") throw error;
      return circular;
    });
    const request = mockRequest([done(call(kind === "missing_handler" ? "other" : "search",
      "c1", kind === "arguments" ? "{" : "{}"))]);
    const events: AgentEvent[] = [];
    const run = createAgent({ name: "Test", instructions: "", request, tools: { search: { execute } } })
      .run("hi", { onEvent: (event) => events.push(event) });
    await expect(run).rejects.toBeDefined();
    expect(events.at(-2)).toMatchObject({ type: "tool_failed", id: "c1",
      name: kind === "missing_handler" ? "other" : "search" });
    expect(events.at(-1)).toMatchObject({ type: "agent_failed" });
    expect(events.some((event) => event.type === "tool_completed" || event.type === "agent_completed")).toBe(false);
    if (kind === "executor") {
      expect(events.at(-1)).toMatchObject({ error });
      await expect(run).rejects.toBe(error);
    }
    if (kind === "arguments" || kind === "missing_handler") expect(execute).not.toHaveBeenCalled();
  });

  it("reports provider failures and missing done chunks", async () => {
    const error = new Error("Provider offline");
    for (const request of [mockRequest([]), () => { throw error; }]) {
      const events: AgentEvent[] = [];
      await expect(createAgent({ name: "Test", instructions: "", request })
        .run("hi", { onEvent: (event) => events.push(event) })).rejects.toBeDefined();
      expect(events.map((event) => event.type)).toEqual(["agent_started", "agent_failed"]);
    }
  });

  it("rejects pre-abort before resolving window.inference", async () => {
    const events: AgentEvent[] = [];
    await expect(createAgent({ name: "Test", instructions: "" }).run("hi", {
      signal: AbortSignal.abort(), onEvent: (event) => events.push(event),
    })).rejects.toMatchObject({ code: "aborted" });
    expect(events.at(-1)).toMatchObject({ type: "agent_failed", error: { code: "aborted" } });
  });

  it("cancels app-owned work via the executor signal and stops further calls", async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const request = mockRequest([done(call())], [answer]);
    await expect(createAgent({ name: "Test", instructions: "", request, tools: { search: {
      execute: async (_args, { signal }) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        return "partial";
      },
    } } }).run("hi", { maxRounds: 1, signal: controller.signal, onEvent: (event) => events.push(event) }))
      .rejects.toMatchObject({ code: "aborted" });
    expect(request).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual(["agent_started", "tool_started", "tool_failed", "agent_failed"]);
  });

  it("does not execute when cancelled by tool_started", async () => {
    const controller = new AbortController();
    const execute = vi.fn(() => "result");
    await expect(createAgent({ name: "Test", instructions: "", request: mockRequest([done(call())]),
      tools: { search: { execute } },
    }).run("hi", { signal: controller.signal, onEvent: (event) => {
      if (event.type === "tool_started") controller.abort();
    } })).rejects.toMatchObject({ code: "aborted" });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["during_delta", "after_done", "after_tool_completed"])("catches cancellation %s", async (when) => {
    const controller = new AbortController();
    const request = vi.fn((_req: ChatRequest): AsyncIterable<ChatChunk> => ({ async *[Symbol.asyncIterator]() {
      if (when === "during_delta") {
        yield { type: "delta", content: "partial" };
      } else if (when === "after_done") {
        yield answer;
        controller.abort();
      } else yield done(call());
    } }));
    const events: AgentEvent[] = [];
    await expect(createAgent({ name: "Test", instructions: "", request, tools: { search } }).run("hi", {
      maxRounds: 1, signal: controller.signal, onEvent: (event) => {
        events.push(event);
        if (event.type === "text_delta" || event.type === "tool_completed") controller.abort();
      },
    })).rejects.toMatchObject({ code: "aborted" });
    expect(events.at(-1)).toMatchObject({ type: "agent_failed" });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([undefined, {}, { toolCalling: false }, { toolCalling: true }])("guards the default IPA route using features %j", async (features) => {
    const request = mockRequest([answer]);
    vi.stubGlobal("inference", { request, ...(features ? { getFeatures: () => features } : {}) });
    const agent = createAgent({ name: "Test", instructions: "", tools: { search } });
    if (features?.toolCalling) {
      expect((await agent.run("hi")).output).toBe("GPS history [source]");
      expect(request).toHaveBeenCalledOnce();
    } else {
      await expect(agent.run("hi")).rejects.toMatchObject({ code: "invalid_request" });
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("resolves IPA lazily, binds request, and permits text-only agents without tool capabilities", async () => {
    const agent = createAgent({ name: "Test", instructions: "" });
    const inference = { request(_req: ChatRequest) {
      expect(this).toBe(inference);
      return mockRequest([answer])(_req);
    } };
    vi.stubGlobal("inference", inference);
    expect((await agent.run("hi")).output).toBe("GPS history [source]");
  });

  it("extracts only final text parts and preserves image parts in final", async () => {
    const content = [{ type: "text" as const, text: "First" },
      { type: "image" as const, mediaType: "image/png" as const, data: "base64" },
      { type: "text" as const, text: " second" }];
    const result = await createAgent({ name: "Test", instructions: "",
      request: mockRequest([done({ role: "assistant", content })]),
    }).run("hi");
    expect(result.output).toBe("First second");
    expect(result.final.message.content).toBe(content);
  });

  it("never dispatches a tool name inherited from Object.prototype", async () => {
    const events: AgentEvent[] = [];
    await expect(createAgent({ name: "Test", instructions: "", tools: { search },
      request: mockRequest([done(call("toString"))]),
    }).run("hi", { onEvent: (event) => events.push(event) })).rejects.toMatchObject({ code: "invalid_request" });
    expect(events.at(-2)).toMatchObject({ type: "tool_failed", name: "toString", id: "c1" });
  });

  it("validates and approves consequential tools while read-only tools run without prompting", async () => {
    const request = mockRequest([done(call())], [done(call("send", "c2"))], [answer]);
    const validate = vi.fn(() => true);
    const send = vi.fn(() => "sent");
    const approve = vi.fn(async () => true);
    const events: AgentEvent[] = [];
    const result = await createAgent({ name: "Test", instructions: "", request, tools: {
      search,
      send: { parameters: search.parameters, validateArguments: validate, requiresApproval: true, execute: send },
    } }).run("hi", { onApprovalRequest: approve, onEvent: (event) => events.push(event) });
    expect(result.output).toBe("GPS history [source]");
    expect(validate).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: "c2", name: "send", arguments: { query: "GPS" }, round: 2, maxRounds: 5,
    }));
    expect(send).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual([
      "agent_started", "tool_started", "tool_completed", "tool_started",
      "tool_approval_requested", "tool_completed", "agent_completed",
    ]);
    const offered = JSON.stringify(request.mock.calls[0]![0].tools);
    for (const field of ["execute", "validateArguments", "requiresApproval", "toolPolicies", "onApprovalRequest"]) {
      expect(offered).not.toContain(field);
    }
  });

  it.each(["missing", "denied", "thrown", "invalid"])("stops with UI-visible events when approval is %s", async (kind) => {
    const execute = vi.fn(() => "sent");
    const error = new Error("approval failed");
    const request = mockRequest([done(call())], [answer]);
    const events: AgentEvent[] = [];
    const onApprovalRequest = kind === "missing" ? undefined : () => {
      if (kind === "thrown") throw error;
      return kind === "invalid" ? "yes" as never : false;
    };
    const run = createAgent({ name: "Test", instructions: "", request, tools: {
      search: { requiresApproval: true, execute },
    } }).run("hi", { onApprovalRequest, onEvent: (event) => events.push(event) });
    if (kind === "thrown") await expect(run).rejects.toBe(error);
    else await expect(run).rejects.toMatchObject({ code: "permission_denied" });
    expect(execute).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual([
      "agent_started", "tool_started", "tool_approval_requested", "tool_failed", "agent_failed",
    ]);
  });

  it("keeps approval decisions scoped to overlapping runs even with identical tool IDs", async () => {
    let enter!: () => void;
    let deny!: (value: boolean) => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const pending = new Promise<boolean>((resolve) => { deny = resolve; });
    const execute = vi.fn(() => "sent");
    const request = mockRequest([done(call())], [done(call())], [answer]);
    const agent = createAgent({ name: "Test", instructions: "", request, tools: {
      search: { execute, requiresApproval: true },
    } });
    const first = agent.run("One", { onApprovalRequest: () => { enter(); return pending; } });
    const rejected = expect(first).rejects.toMatchObject({ code: "permission_denied" });
    await entered;
    const second = await agent.run("Two", { onApprovalRequest: () => true });
    expect(second.output).toBe("GPS history [source]");
    deny(false);
    await rejected;
    expect(execute).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each(["abort", "throw"])("does not call the approval handler after the approval event observers %s", async (kind) => {
    const controller = new AbortController();
    const error = new Error("observer failed");
    const approve = vi.fn(() => true);
    const execute = vi.fn(() => "sent");
    const run = createAgent({ name: "Test", instructions: "", request: mockRequest([done(call())]), tools: {
      search: { execute, requiresApproval: true },
    } }).run("hi", { signal: controller.signal, onApprovalRequest: approve, onEvent: (event) => {
      if (event.type === "tool_approval_requested") {
        if (kind === "abort") controller.abort(); else throw error;
      }
    } });
    if (kind === "abort") await expect(run).rejects.toMatchObject({ code: "aborted" });
    else await expect(run).rejects.toBe(error);
    expect(approve).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not prompt or execute after failed validation and forwards result limits", async () => {
    const execute = vi.fn(() => "large result");
    const approve = vi.fn(() => true);
    const events: AgentEvent[] = [];
    const request = mockRequest([done(call())], [done(call())]);
    const invalid = createAgent({ name: "Test", instructions: "", request, tools: {
      search: { execute, validateArguments: () => false, requiresApproval: true },
    } });
    await expect(invalid.run("hi", { onApprovalRequest: approve, onEvent: (event) => events.push(event) }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(execute).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["agent_started", "tool_started", "tool_failed", "agent_failed"]);

    const bounded = createAgent({ name: "Test", instructions: "", request, tools: { search: { execute } } });
    await expect(bounded.run("hi", { maxToolResultChars: 3 }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(execute).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
