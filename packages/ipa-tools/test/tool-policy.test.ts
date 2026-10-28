import { describe, expect, it, vi } from "vitest";
import { runTools, type RunToolsOptions, type ToolPolicy,
  type ToolApprovalRequest, type ToolRunContext } from "../src/index.js";
import type { ChatChunk, ChatRequest, Message, Tool } from "../src/index.js";

const tool: Tool = { type: "function", function: { name: "send",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
} };
const call = (id = "c1", name = "send", args = '{"text":"hello"}'): Message => ({
  role: "assistant", content: null,
  toolCalls: [{ id, type: "function", function: { name, arguments: args } }],
});
function requestFor(...turns: Message[]) {
  let round = 0;
  return vi.fn((_req: ChatRequest): AsyncIterable<ChatChunk> => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "done", model: "test", message: turns[round++]! };
    },
  }));
}
function setup(policy: ToolPolicy = {}, extra: Partial<RunToolsOptions> = {}) {
  const execute = vi.fn((_args: unknown) => "sent");
  const onToolError = vi.fn();
  const onToolResult = vi.fn();
  const request = requestFor(call(), { role: "assistant", content: "Done" });
  const options: RunToolsOptions = { messages: [], tools: [tool], execute: { send: execute },
    toolPolicies: { send: policy }, request, onToolError, onToolResult, ...extra };
  return { execute, onToolError, onToolResult, request, options };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("tool policies", () => {
  it("validates before awaiting approval, supplies context, then executes and returns results", async () => {
    const order: string[] = [];
    const pending = deferred<boolean>();
    const entered = deferred<ToolApprovalRequest>();
    const controller = new AbortController();
    let validationContext: ToolRunContext | undefined;
    const { options, execute, onToolResult } = setup({
      validateArguments: (args, context) => {
        order.push("validate");
        expect(args).toEqual({ text: "hello" });
        validationContext = context;
        return true;
      }, requiresApproval: true,
    }, {
      maxRounds: 1, signal: controller.signal,
      onToolCall: () => { order.push("call"); },
      onApprovalRequest: (info) => {
        order.push("approval"); entered.resolve(info); return pending.promise;
      },
    });
    execute.mockImplementation(() => { order.push("execute"); return "sent"; });
    const run = runTools(options);
    const info = await entered.promise;
    expect(info).toEqual({ id: "c1", name: "send", arguments: { text: "hello" },
      tool, round: 1, maxRounds: 1, signal: controller.signal });
    const { arguments: _args, ...context } = info;
    expect(validationContext).toEqual(context);
    expect(execute).not.toHaveBeenCalled();
    expect(onToolResult).not.toHaveBeenCalled();
    pending.resolve(true);
    const result = await run;
    expect(order).toEqual(["call", "validate", "approval", "execute"]);
    expect(result.stopReason).toBe("max_rounds");
    expect(result.messages.at(-1)).toEqual({ role: "tool", toolCallId: "c1", content: "sent" });
    expect(onToolResult).toHaveBeenCalledExactlyOnceWith({ id: "c1", name: "send", result: "sent" });
  });

  it.each([false, undefined, null, "true", 1, {}])("fails closed on validation result %j", async (decision) => {
    const approve = vi.fn(() => true);
    const { options, execute, onToolError, onToolResult, request } = setup({
      validateArguments: (() => decision) as never, requiresApproval: true,
    }, { onApprovalRequest: approve });
    await expect(runTools(options)).rejects.toMatchObject({ code: "invalid_request" });
    expect(execute).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(onToolResult).not.toHaveBeenCalled();
    expect(onToolError).toHaveBeenCalledExactlyOnceWith({ id: "c1", name: "send", error: expect.any(Error) });
    expect(request).toHaveBeenCalledOnce();
  });

  it("waits for asynchronous validation before asking approval or executing", async () => {
    const entered = deferred<void>();
    const pending = deferred<boolean>();
    const approval = vi.fn(() => true);
    const { options, execute } = setup({
      validateArguments: () => { entered.resolve(); return pending.promise; }, requiresApproval: true,
    }, { onApprovalRequest: approval });
    const run = runTools(options);
    await entered.promise;
    expect(approval).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    pending.resolve(true);
    expect((await run).stopReason).toBe("end_turn");
    expect(approval).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([false, undefined, null, "true", 1, {}])("fails closed on approval result %j", async (decision) => {
    const { options, execute, onToolError, onToolResult, request } = setup({ requiresApproval: true }, {
      onApprovalRequest: (() => Promise.resolve(decision)) as never,
    });
    await expect(runTools(options)).rejects.toMatchObject({ code: "permission_denied" });
    expect(execute).not.toHaveBeenCalled();
    expect(onToolResult).not.toHaveBeenCalled();
    expect(onToolError).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it("stops on missing approval without executing later calls in the batch", async () => {
    const batch = call();
    if (batch.role === "assistant") batch.toolCalls!.push(
      { id: "c2", type: "function", function: { name: "send", arguments: "{}" } });
    const { options, execute, onToolError } = setup({ requiresApproval: true }, { request: requestFor(batch) });
    await expect(runTools(options)).rejects.toMatchObject({ code: "permission_denied" });
    expect(execute).not.toHaveBeenCalled();
    expect(onToolError).toHaveBeenCalledOnce();
  });

  it.each(["validation", "approval", "handler"])("preserves thrown %s errors and reports failure once", async (stage) => {
    const error = new Error("app failed");
    const { options, execute, onToolError, onToolResult } = setup({
      validateArguments: () => { if (stage === "validation") throw error; return true; },
      requiresApproval: true,
    }, { onApprovalRequest: async () => { if (stage === "approval") throw error; return true; } });
    execute.mockImplementation(() => { throw error; });
    await expect(runTools(options)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledTimes(stage === "handler" ? 1 : 0);
    expect(onToolError).toHaveBeenCalledExactlyOnceWith({ id: "c1", name: "send", error });
    expect(onToolResult).not.toHaveBeenCalled();
  });

  it.each(["validation", "approval"] as const)("aborts pending %s promptly and consumes late resolution/rejection", async (stage) => {
    for (const late of ["resolve", "reject"]) {
      const controller = new AbortController();
      const pending = deferred<boolean>();
      const entered = deferred<void>();
      const hook = () => { entered.resolve(); return pending.promise; };
      const approval = vi.fn(stage === "approval" ? hook : () => true);
      const { options, execute, onToolError, onToolResult, request } = setup({
        validateArguments: stage === "validation" ? hook : () => true, requiresApproval: true,
      }, { signal: controller.signal, onApprovalRequest: approval });
      const removeListener = vi.spyOn(controller.signal, "removeEventListener");
      const run = runTools(options);
      const rejected = expect(run).rejects.toMatchObject({ code: "aborted" });
      await entered.promise;
      controller.abort();
      await rejected;
      if (late === "resolve") pending.resolve(true); else pending.reject(new Error("too late"));
      await Promise.resolve();
      expect(execute).not.toHaveBeenCalled();
      expect(onToolResult).not.toHaveBeenCalled();
      expect(onToolError).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
      if (stage === "validation") expect(approval).not.toHaveBeenCalled();
      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    }
  });

  it.each(["validation", "approval"])("checks abort even when %s returns true", async (stage) => {
    const controller = new AbortController();
    const hook = () => { controller.abort(); return true; };
    const { options, execute } = setup({ validateArguments: stage === "validation" ? hook : () => true,
      requiresApproval: true }, { signal: controller.signal,
      onApprovalRequest: stage === "approval" ? hook : () => true });
    await expect(runTools(options)).rejects.toMatchObject({ code: "aborted" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not request approval or execute malformed or schema-invalid arguments", async () => {
    for (const args of ["{", '{"text":2}', "null", "[]", "", "{}"] ) {
      const validate = vi.fn((args: unknown) => !!args && typeof args === "object" &&
        typeof (args as { text?: unknown }).text === "string");
      const approval = vi.fn(() => true);
      const { options, execute } = setup({ validateArguments: validate, requiresApproval: true }, {
        request: requestFor(call("c1", "send", args)), onApprovalRequest: approval,
      });
      await expect(runTools(options)).rejects.toMatchObject({ code: "invalid_request" });
      expect(validate).toHaveBeenCalledTimes(args === "{" ? 0 : 1);
      expect(approval).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("requires own policy entries when configured, including names on Object.prototype", async () => {
    for (const name of ["send", "toString", "constructor", "__proto__"]) {
      const { options, execute } = setup({}, { request: requestFor(call("c1", name)),
        execute: Object.fromEntries([[name, vi.fn()]]), toolPolicies: {} });
      const handler = options.execute![name]!;
      await expect(runTools(options)).rejects.toMatchObject({ code: "invalid_request", message: `No tool policy for "${name}".` });
      expect(handler).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it.each([null, [], { send: null }, { send: { validateArguments: false } },
    { send: { requiresApproval: "yes" } }])("rejects invalid policy configuration %j before inference", async (toolPolicies) => {
    const { options, request, execute } = setup({}, { toolPolicies: toolPolicies as never });
    await expect(runTools(options)).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs explicitly unguarded read-only tools without approval and retains legacy behavior", async () => {
    for (const toolPolicies of [undefined, { send: {} }]) {
      const approve = vi.fn(() => false);
      const { options, execute } = setup({}, { toolPolicies, onApprovalRequest: approve });
      expect((await runTools(options)).stopReason).toBe("end_turn");
      expect(execute).toHaveBeenCalledOnce();
      expect(approve).not.toHaveBeenCalled();
    }
  });

  it("freezes nested args across observers, validation, approval, and execution", async () => {
    const seen: unknown[] = [];
    const observe = (args: unknown) => {
      seen.push(args);
      expect(Object.isFrozen(args)).toBe(true);
      const typed = args as { nested: { values: number[] } };
      expect(Object.isFrozen(typed.nested)).toBe(true);
      expect(() => typed.nested.values.push(3)).toThrow();
    };
    const { options, execute } = setup({ validateArguments: (args) => { observe(args); return true; },
      requiresApproval: true }, {
      request: requestFor(call("c1", "send", '{"nested":{"values":[1,2]}}')),
      maxRounds: 1, onToolCall: ({ arguments: args }) => observe(args),
      onApprovalRequest: ({ arguments: args }) => { observe(args); return true; },
    });
    execute.mockImplementation((args) => { observe(args); return "sent"; });
    await runTools(options);
    expect(seen).toHaveLength(4);
    expect(seen.every((args) => args === seen[0])).toBe(true);
  });

  it("snapshots policy flags before provider work or callbacks can change them", async () => {
    const policy = { requiresApproval: true };
    const { options, execute } = setup(policy, { onToolCall: () => { policy.requiresApproval = false; } });
    await expect(runTools(options)).rejects.toMatchObject({ code: "permission_denied" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("approves each call separately across rounds without exceeding maxRounds", async () => {
    const approve = vi.fn((_info: ToolApprovalRequest) => true);
    const request = requestFor(call(), call("c2"), call("c3"));
    const { options, execute } = setup({ requiresApproval: true }, { request, maxRounds: 2,
      onApprovalRequest: approve });
    expect((await runTools(options)).stopReason).toBe("max_rounds");
    expect(request).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(approve.mock.calls.map(([info]) => info.round)).toEqual([1, 2]);
  });

  it("stops before the handler when an observer throws or aborts", async () => {
    for (const abort of [true, false]) {
      const controller = new AbortController();
      const error = new Error("observer");
      const approve = vi.fn(() => true);
      const { options, execute, onToolError } = setup({ requiresApproval: true }, {
        signal: controller.signal, onApprovalRequest: approve,
        onToolCall: () => { if (abort) controller.abort(); else throw error; },
      });
      const run = runTools(options);
      if (abort) await expect(run).rejects.toMatchObject({ code: "aborted" });
      else await expect(run).rejects.toBe(error);
      expect(approve).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(onToolError).toHaveBeenCalledOnce();
    }
  });

  it("limits serialized result strings before observers or the next model request", async () => {
    const { options, execute, onToolError, onToolResult, request } = setup({}, { maxToolResultChars: 3 });
    await expect(runTools(options)).rejects.toMatchObject({ code: "invalid_request" });
    expect(execute).toHaveBeenCalledOnce();
    expect(onToolResult).not.toHaveBeenCalled();
    expect(onToolError).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    const exact = setup({}, { maxToolResultChars: 4 });
    expect((await runTools(exact.options)).stopReason).toBe("end_turn");
  });

  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid result limit %s before inference", async (maxToolResultChars) => {
    const { options, request } = setup({}, { maxToolResultChars });
    await expect(runTools(options)).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });
});
