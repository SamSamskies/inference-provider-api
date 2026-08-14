import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFeatures,
  getInference,
  isInferenceAvailable,
  waitForInference,
} from "../src/inference.js";
import type { Inference } from "../src/types.js";

function stubInference(inference: Inference) {
  (globalThis as { window: { inference: Inference } }).window = {
    inference,
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { inference?: unknown }).inference;
});

describe("getInference / getFeatures / isInferenceAvailable", () => {
  it("throws unavailable when inference is missing", () => {
    expect(isInferenceAvailable()).toBe(false);
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
    stubInference(inference);

    expect(isInferenceAvailable()).toBe(true);
    expect(getInference()).toBe(inference);
    expect(getFeatures()).toEqual({ toolCalling: true });
  });

  it("returns {} when getFeatures is omitted", () => {
    const inference: Inference = {
      request: async function* () {},
    };
    stubInference(inference);

    expect(getFeatures()).toEqual({});
  });
});

describe("waitForInference", () => {
  it("resolves immediately when inference is already present", async () => {
    const inference: Inference = {
      request: async function* () {},
    };
    stubInference(inference);

    await expect(waitForInference()).resolves.toBe(inference);
  });

  it("resolves when inference is injected after the first check", async () => {
    vi.useFakeTimers();
    const inference: Inference = {
      request: async function* () {},
    };
    const pending = waitForInference({ timeout: 1000, interval: 50 });

    await vi.advanceTimersByTimeAsync(50);
    stubInference(inference);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBe(inference);
  });

  it("throws unavailable when timeout elapses", async () => {
    vi.useFakeTimers();
    const pending = waitForInference({ timeout: 200, interval: 50 });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "InferenceError",
      code: "unavailable",
      message: "window.inference is not available.",
    });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it("throws unavailable immediately when timeout is 0 and missing", async () => {
    await expect(waitForInference({ timeout: 0 })).rejects.toMatchObject({
      name: "InferenceError",
      code: "unavailable",
    });
  });

  it("throws aborted when the signal is already aborted", async () => {
    await expect(
      waitForInference({ signal: AbortSignal.abort() })
    ).rejects.toMatchObject({
      name: "InferenceError",
      code: "aborted",
      message: "Request aborted",
    });
  });

  it("throws aborted when the signal aborts while waiting", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForInference({
      timeout: 1000,
      interval: 50,
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "InferenceError",
      code: "aborted",
    });
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await assertion;
  });

  it("throws invalid_request for a negative timeout", async () => {
    await expect(waitForInference({ timeout: -1 })).rejects.toMatchObject({
      name: "InferenceError",
      code: "invalid_request",
    });
  });
});
