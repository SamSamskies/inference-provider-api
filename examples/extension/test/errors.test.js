import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  serializeInferenceError,
  toInferenceError,
} from "../src/errors.js";

describe("errors", () => {
  it("exposes the known error codes", () => {
    expect(ERROR_CODES).toContain("permission_denied");
    expect(ERROR_CODES).toContain("aborted");
  });

  it("serializes an InferenceError payload", () => {
    expect(serializeInferenceError("unavailable", "No API key")).toEqual({
      name: "InferenceError",
      message: "No API key",
      code: "unavailable",
    });
  });

  it("reconstructs an Error with a code property", () => {
    const err = toInferenceError({
      name: "InferenceError",
      message: "Denied",
      code: "permission_denied",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InferenceError");
    expect(err.message).toBe("Denied");
    expect(err.code).toBe("permission_denied");
  });

  it("falls back when serialized fields are missing", () => {
    const err = toInferenceError({});
    expect(err.message).toMatch(/failed/i);
    expect(err.code).toBe("provider_error");
  });
});
