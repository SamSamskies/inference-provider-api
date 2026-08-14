import { afterEach, describe, expect, it } from "vitest";
import { getFeatures, getInference } from "../src/inference.js";
import type { Inference } from "../src/types.js";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { inference?: unknown }).inference;
});

describe("getInference / getFeatures", () => {
  it("throws unavailable when inference is missing", () => {
    expect(() => getInference()).toThrow(
      expect.objectContaining({
        name: "InferenceError",
        code: "unavailable",
      })
    );
  });

  it("resolves window.inference", () => {
    const inference: Inference = {
      request: async function* () {},
      getFeatures: () => ({ toolCalling: true }),
    };
    (globalThis as { window: { inference: Inference } }).window = {
      inference,
    };

    expect(getInference()).toBe(inference);
    expect(getFeatures()).toEqual({ toolCalling: true });
  });

  it("returns {} when getFeatures is omitted", () => {
    const inference: Inference = {
      request: async function* () {},
    };
    (globalThis as { window: { inference: Inference } }).window = {
      inference,
    };

    expect(getFeatures()).toEqual({});
  });
});
