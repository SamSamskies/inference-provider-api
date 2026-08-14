import { describe, expect, it, vi } from "vitest";
import {
  parseToolArguments,
  runTools,
  serializeToolResult,
} from "../src/run-tools.js";
import type { InferenceChunk, InferenceRequest, Message, Tool } from "../src/types.js";

function fakeRequest(turns: Array<InferenceChunk[] | Message>) {
  let i = 0;
  return (_req: InferenceRequest): AsyncIterable<InferenceChunk> => {
    const turn = turns[i++];
    const chunks: InferenceChunk[] = Array.isArray(turn)
      ? turn
      : [
          { type: "accepted" },
          { type: "done", message: turn as Message, model: "test-model" },
        ];
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    };
  };
}

const weatherTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
      },
    },
  },
];

describe("serializeToolResult / parseToolArguments", () => {
  it("keeps strings and JSON-stringifies objects", () => {
    expect(serializeToolResult("already")).toBe("already");
    expect(serializeToolResult({ tempC: 22 })).toBe('{"tempC":22}');
  });

  it("serializes undefined/void results as a string", () => {
    expect(serializeToolResult(undefined)).toBe("null");
    expect(typeof serializeToolResult(undefined)).toBe("string");
  });

  it("throws invalid_request when the result is not JSON-serializable", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    try {
      serializeToolResult(circular);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({
        name: "InferenceError",
        code: "invalid_request",
      });
      expect((err as Error).message).toMatch(/not JSON-serializable/);
    }
  });

  it("parses arguments JSON and treats empty as {}", () => {
    expect(parseToolArguments('{"city":"Austin"}', "get_weather")).toEqual({
      city: "Austin",
    });
    expect(parseToolArguments("", "get_weather")).toEqual({});
    expect(parseToolArguments(null, "get_weather")).toEqual({});
  });

  it("throws invalid_request on bad JSON", () => {
    try {
      parseToolArguments("{", "get_weather");
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({
        name: "InferenceError",
        code: "invalid_request",
      });
    }
  });
});

describe("runTools", () => {
  it("returns immediately when the first turn has no toolCalls", async () => {
    const input: Message[] = [{ role: "user", content: "hi" }];
    const result = await runTools({
      request: fakeRequest([{ role: "assistant", content: "Just text." }]),
      messages: input,
      tools: weatherTools,
      execute: { get_weather: async () => ({}) },
    });

    expect(result.final.message).toEqual({
      role: "assistant",
      content: "Just text.",
    });
    expect(result.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Just text." },
    ]);
    expect(input).toEqual([{ role: "user", content: "hi" }]);
  });

  it("runs toolCalls then returns the final text done chunk", async () => {
    const execute = {
      get_weather: vi.fn(async ({ city }: { city: string }) => ({
        city,
        tempC: 22,
      })),
    };

    const result = await runTools({
      request: fakeRequest([
        {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"city":"Austin"}',
              },
            },
          ],
        },
        {
          role: "assistant",
          content: "It is 22°C in Austin.",
        },
      ]),
      messages: [{ role: "user", content: "Weather in Austin?" }],
      tools: weatherTools,
      execute,
    });

    expect(execute.get_weather).toHaveBeenCalledWith({ city: "Austin" });
    expect(
      result.final.message.role === "assistant"
        ? result.final.message.content
        : null
    ).toBe("It is 22°C in Austin.");
    expect(result.messages).toEqual([
      { role: "user", content: "Weather in Austin?" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city":"Austin"}',
            },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        content: '{"city":"Austin","tempC":22}',
      },
      { role: "assistant", content: "It is 22°C in Austin." },
    ]);
  });

  it("runs parallel toolCalls on one turn", async () => {
    const execute = {
      get_weather: vi.fn(async () => ({ tempC: 22 })),
      get_time: vi.fn(async () => ({ localTime: "3:45 PM" })),
    };

    const result = await runTools({
      request: fakeRequest([
        {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_weather",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"city":"Austin"}',
              },
            },
            {
              id: "call_time",
              type: "function",
              function: {
                name: "get_time",
                arguments: '{"city":"Austin"}',
              },
            },
          ],
        },
        { role: "assistant", content: "Done." },
      ]),
      messages: [{ role: "user", content: "hi" }],
      execute,
    });

    expect(execute.get_weather).toHaveBeenCalledOnce();
    expect(execute.get_time).toHaveBeenCalledOnce();
    const toolMessages = result.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((m) => (m.role === "tool" ? m.toolCallId : ""))).toEqual([
      "call_weather",
      "call_time",
    ]);
  });

  it("forwards tools and toolChoice on each round", async () => {
    const seen: InferenceRequest[] = [];
    const request = (req: InferenceRequest) => {
      seen.push(req);
      if (seen.length === 1) {
        return fakeRequest([
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: { name: "get_weather", arguments: "{}" },
              },
            ],
          },
        ])(req);
      }
      return fakeRequest([{ role: "assistant", content: "done" }])(req);
    };

    await runTools({
      request,
      messages: [{ role: "user", content: "hi" }],
      tools: weatherTools,
      toolChoice: "auto",
      execute: { get_weather: async () => ({ ok: true }) },
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]?.tools).toEqual(weatherTools);
    expect(seen[0]?.toolChoice).toBe("auto");
    expect(seen[1]?.tools).toEqual(weatherTools);
    expect(seen[1]?.toolChoice).toBe("auto");
    expect(seen[1]?.messages).toHaveLength(3);
  });

  it("throws when execute handler is missing", async () => {
    await expect(
      runTools({
        request: fakeRequest([
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: "{}" },
              },
            ],
          },
        ]),
        messages: [{ role: "user", content: "hi" }],
        tools: weatherTools,
        execute: {},
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "invalid_request",
      message: 'No execute handler for tool "get_weather".',
    });
  });

  it("throws when maxRounds is exceeded", async () => {
    const request = fakeRequest([
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "get_weather", arguments: "{}" },
          },
        ],
      },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "c2",
            type: "function",
            function: { name: "get_weather", arguments: "{}" },
          },
        ],
      },
    ]);

    await expect(
      runTools({
        request,
        messages: [{ role: "user", content: "hi" }],
        tools: weatherTools,
        execute: { get_weather: async () => ({ ok: true }) },
        maxRounds: 2,
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "provider_error",
      message: "Tool loop exceeded maxRounds (2).",
    });
  });

  it("forwards onDelta and onReasoningDelta; onToolCall after parse before execute", async () => {
    const deltas: string[] = [];
    const reasoning: string[] = [];
    const toolCalls: object[] = [];
    let executeOrder = 0;

    await runTools({
      request: fakeRequest([
        [
          { type: "reasoning_delta", content: "think" },
          { type: "delta", content: "calling " },
          {
            type: "done",
            model: "test-model",
            message: {
              role: "assistant",
              content: "calling ",
              reasoning: "think",
              toolCalls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "get_weather", arguments: "{}" },
                },
              ],
            },
          },
        ],
        [
          { type: "delta", content: "22C" },
          {
            type: "done",
            model: "test-model",
            message: { role: "assistant", content: "22C" },
          },
        ],
      ]),
      messages: [{ role: "user", content: "hi" }],
      execute: {
        get_weather: async () => {
          executeOrder += 1;
          return { tempC: 22 };
        },
      },
      onDelta: (c) => deltas.push(c),
      onReasoningDelta: (c) => reasoning.push(c),
      onToolCall(info) {
        toolCalls.push({ ...info, executeOrderBefore: executeOrder });
      },
    });

    expect(deltas).toEqual(["calling ", "22C"]);
    expect(reasoning).toEqual(["think"]);
    expect(toolCalls).toEqual([
      {
        id: "c1",
        name: "get_weather",
        arguments: {},
        executeOrderBefore: 0,
      },
    ]);
  });

  it("rejects with aborted when the signal aborts during execute", async () => {
    const controller = new AbortController();
    await expect(
      runTools({
        request: fakeRequest([
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: "{}" },
              },
            ],
          },
        ]),
        messages: [{ role: "user", content: "hi" }],
        tools: weatherTools,
        execute: {
          get_weather: async () => {
            controller.abort();
            return { ok: true };
          },
        },
        maxRounds: 1,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "aborted",
      message: "Request aborted",
    });
  });

  it("rejects when AbortSignal is already aborted", async () => {
    const signal = AbortSignal.abort();
    await expect(
      runTools({
        request: fakeRequest([{ role: "assistant", content: "hi" }]),
        messages: [{ role: "user", content: "hi" }],
        signal,
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "aborted",
    });
  });

  it("does not mutate the input messages array", async () => {
    const input: Message[] = [{ role: "user", content: "hi" }];
    await runTools({
      request: fakeRequest([
        {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: { name: "get_weather", arguments: "{}" },
            },
          ],
        },
        { role: "assistant", content: "ok" },
      ]),
      messages: input,
      execute: { get_weather: async () => ({ ok: true }) },
    });
    expect(input).toEqual([{ role: "user", content: "hi" }]);
    expect(input).toHaveLength(1);
  });

  it("throws provider_error when a tool call is missing a function name", async () => {
    await expect(
      runTools({
        request: fakeRequest([
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: { name: "", arguments: "{}" },
              },
            ],
          },
        ]),
        messages: [{ role: "user", content: "hi" }],
        execute: { get_weather: async () => ({}) },
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "provider_error",
      message: "Tool call is missing a function name.",
    });
  });

  it("throws provider_error when a tool call is missing an id", async () => {
    const execute = { get_weather: vi.fn(async () => ({ ok: true })) };
    await expect(
      runTools({
        request: fakeRequest([
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "",
                type: "function",
                function: { name: "get_weather", arguments: "{}" },
              },
            ],
          },
        ]),
        messages: [{ role: "user", content: "hi" }],
        execute,
        onToolCall: () => {
          throw new Error("onToolCall should not run");
        },
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "provider_error",
      message: "Tool call is missing an id.",
    });
    expect(execute.get_weather).not.toHaveBeenCalled();
  });

  it("throws invalid_request for non-serializable tool results", async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(
      runTools({
        request: fakeRequest([
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: { name: "get_weather", arguments: "{}" },
              },
            ],
          },
        ]),
        messages: [{ role: "user", content: "hi" }],
        execute: { get_weather: async () => circular },
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "invalid_request",
    });
  });

  it("throws invalid_request for bad JSON arguments", async () => {
    await expect(
      runTools({
        request: fakeRequest([
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: { name: "get_weather", arguments: "{" },
              },
            ],
          },
        ]),
        messages: [{ role: "user", content: "hi" }],
        execute: { get_weather: async () => ({}) },
      })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "invalid_request",
    });
  });

  it("preserves assistant reasoning on tool turns", async () => {
    const result = await runTools({
      request: fakeRequest([
        {
          role: "assistant",
          content: null,
          reasoning: "need weather",
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: { name: "get_weather", arguments: "{}" },
            },
          ],
        },
        { role: "assistant", content: "22C" },
      ]),
      messages: [{ role: "user", content: "hi" }],
      execute: { get_weather: async () => ({ tempC: 22 }) },
    });

    const assistant = result.messages[1];
    expect(assistant).toMatchObject({
      role: "assistant",
      reasoning: "need weather",
    });
  });
});
