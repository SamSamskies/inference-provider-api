import { describe, expect, it } from "vitest";
import {
  isValidOrigin,
  validateInferenceRequest,
} from "../src/validate.js";

describe("validateInferenceRequest", () => {
  it("accepts a minimal valid chat request", () => {
    const result = validateInferenceRequest({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
      },
    });
  });

  it("rejects non-objects and arrays", () => {
    expect(validateInferenceRequest(null).ok).toBe(false);
    expect(validateInferenceRequest(undefined).ok).toBe(false);
    expect(validateInferenceRequest("chat").ok).toBe(false);
    expect(validateInferenceRequest([]).ok).toBe(false);
  });

  it("rejects unsupported methods", () => {
    const result = validateInferenceRequest({
      method: "embeddings",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/chat/);
  });

  it("rejects empty or missing messages", () => {
    expect(
      validateInferenceRequest({ method: "chat", messages: [] }).ok
    ).toBe(false);
    expect(validateInferenceRequest({ method: "chat" }).ok).toBe(false);
  });

  it("rejects invalid message shapes and roles", () => {
    expect(
      validateInferenceRequest({
        method: "chat",
        messages: [null],
      }).ok
    ).toBe(false);
    expect(
      validateInferenceRequest({
        method: "chat",
        messages: [{ role: "tool", content: "x" }],
      }).ok
    ).toBe(false);
    expect(
      validateInferenceRequest({
        method: "chat",
        messages: [{ role: "user", content: 42 }],
      }).ok
    ).toBe(false);
  });

  it("strips unknown fields and keeps system/user/assistant", () => {
    const result = validateInferenceRequest({
      method: "chat",
      temperature: 0.2,
      messages: [
        { role: "system", content: "be brief", extra: true },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.value.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("ignores a serialized signal field", () => {
    const result = validateInferenceRequest({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
      signal: { aborted: false },
    });
    expect(result.ok).toBe(true);
    expect(result.value).not.toHaveProperty("signal");
  });
});

describe("isValidOrigin", () => {
  it("accepts https and localhost http origins", () => {
    expect(isValidOrigin("https://example.com")).toBe(true);
    expect(isValidOrigin("http://localhost:3000")).toBe(true);
    expect(isValidOrigin("http://127.0.0.1:8080")).toBe(true);
  });

  it("rejects opaque, file, empty, and non-origin strings", () => {
    expect(isValidOrigin("null")).toBe(false);
    expect(isValidOrigin("file:///tmp/x.html")).toBe(false);
    expect(isValidOrigin("")).toBe(false);
    expect(isValidOrigin("https://example.com/path")).toBe(false);
    expect(isValidOrigin("not a url")).toBe(false);
  });
});
