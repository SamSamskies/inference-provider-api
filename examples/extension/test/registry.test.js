import { describe, expect, it } from "vitest";
import {
  getDefaultProvider,
  getProvider,
  listProviders,
  resolveProviderModels,
} from "../src/providers/registry.js";

describe("provider registry", () => {
  it("registers openai and ollama", () => {
    const ids = listProviders().map((p) => p.id).sort();
    expect(ids).toEqual(["ollama", "openai"]);
    expect(getDefaultProvider().id).toBe("openai");
    expect(getProvider("missing")).toBeUndefined();
  });

  it("resolves static OpenAI models from the curated catalog", async () => {
    const openai = getProvider("openai");
    expect(openai).toBeDefined();
    const models = await resolveProviderModels(openai);
    expect(models).toContain("gpt-4o-mini");
    expect(models).toEqual([...openai.models]);
  });
});
