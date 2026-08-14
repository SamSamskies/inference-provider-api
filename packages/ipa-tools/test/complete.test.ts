import { describe, expect, it } from "vitest";
import { complete } from "../src/complete.js";
import { isInferenceError } from "../src/errors.js";
import type { InferenceChunk, InferenceRequest, Message } from "../src/types.js";

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

describe("complete", () => {
  it("returns the done chunk", async () => {
    const done = await complete(
      {
        method: "chat",
        messages: [{ role: "user", content: "Hello" }],
      },
      {
        request: fakeRequest([{ role: "assistant", content: "Hi there." }]),
      }
    );

    expect(done.type).toBe("done");
    expect(done.model).toBe("test-model");
    expect(done.message).toEqual({
      role: "assistant",
      content: "Hi there.",
    });
  });

  it("keeps the last done chunk when multiple appear", async () => {
    const done = await complete(
      { method: "chat", messages: [{ role: "user", content: "x" }] },
      {
        request: fakeRequest([
          [
            {
              type: "done",
              model: "first",
              message: { role: "assistant", content: "a" },
            },
            {
              type: "done",
              model: "second",
              message: { role: "assistant", content: "b" },
            },
          ],
        ]),
      }
    );

    expect(done.model).toBe("second");
    expect(
      done.message.role === "assistant" ? done.message.content : null
    ).toBe("b");
  });

  it("throws provider_error when the stream ends without done", async () => {
    await expect(
      complete(
        { method: "chat", messages: [{ role: "user", content: "x" }] },
        {
          request: fakeRequest([
            [{ type: "accepted" }, { type: "delta", content: "partial" }],
          ]),
        }
      )
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "provider_error",
      message: "Stream ended without a done chunk.",
    });
  });

  it("rejects when AbortSignal is already aborted without calling request", async () => {
    const signal = AbortSignal.abort();
    let called = false;
    await expect(
      complete(
        { method: "chat", messages: [{ role: "user", content: "x" }], signal },
        {
          request: async function* () {
            called = true;
            yield { type: "accepted" as const };
          },
        }
      )
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "aborted",
      message: "Request aborted",
    });
    expect(called).toBe(false);
  });

  it("rejects with aborted when the stream ends without a done chunk after abort", async () => {
    const controller = new AbortController();
    await expect(
      complete(
        {
          method: "chat",
          messages: [{ role: "user", content: "x" }],
          signal: controller.signal,
        },
        {
          request: async function* () {
            yield { type: "accepted" as const };
            yield { type: "delta" as const, content: "partial" };
            controller.abort();
          },
        }
      )
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "aborted",
      message: "Request aborted",
    });
  });

  it("forwards aborted from request", async () => {
    const aborted = Object.assign(new Error("Request aborted"), {
      name: "InferenceError",
      code: "aborted" as const,
    });

    await expect(
      complete(
        { method: "chat", messages: [{ role: "user", content: "x" }] },
        {
          request: async function* () {
            throw aborted;
          },
        }
      )
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("isInferenceError recognizes reconstructed errors", () => {
    expect(
      isInferenceError({
        name: "InferenceError",
        code: "aborted",
        message: "x",
      })
    ).toBe(true);
    expect(isInferenceError(new Error("nope"))).toBe(false);
    expect(isInferenceError(null)).toBe(false);
  });
});
