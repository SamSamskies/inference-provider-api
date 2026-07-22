import { beforeEach, describe, expect, it } from "vitest";
import { installChromeMock } from "./helpers/chrome-mock.js";
import {
  blockOrigin,
  getOriginGrant,
  getSettings,
  grantOriginAlways,
  isOriginBlocked,
  listAllowedOrigins,
  listBlockedOrigins,
  normalizeProviderId,
  revokeOrigin,
  saveSettings,
  setOriginProviderModel,
  unblockOrigin,
} from "../src/storage.js";

const chromeMock = installChromeMock();

beforeEach(() => {
  chromeMock.reset();
});

describe("normalizeProviderId", () => {
  it("trims valid ids and defaults blanks to openai", () => {
    expect(normalizeProviderId("ollama")).toBe("ollama");
    expect(normalizeProviderId("  openai  ")).toBe("openai");
    expect(normalizeProviderId("")).toBe("openai");
    expect(normalizeProviderId("   ")).toBe("openai");
    expect(normalizeProviderId(undefined)).toBe("openai");
  });
});

describe("getSettings", () => {
  it("returns defaults when storage is empty", async () => {
    await expect(getSettings()).resolves.toMatchObject({
      openaiApiKey: "",
      defaultProviderId: "openai",
      defaultModel: "gpt-4o-mini",
      allowedOrigins: {},
      blockedOrigins: {},
    });
  });

  it("scrubs opaque and file origins from stored grants/blocks", async () => {
    chromeMock.store.set("allowedOrigins", {
      "https://ok.example": { allowedAt: 1, providerId: "openai", model: "gpt-4o-mini" },
      null: { allowedAt: 2, providerId: "openai", model: "gpt-4o-mini" },
      "file://": { allowedAt: 3 },
      "file:///tmp/x": { allowedAt: 4 },
    });
    chromeMock.store.set("blockedOrigins", {
      "https://blocked.example": { blockedAt: 5 },
      null: { blockedAt: 6 },
    });

    const settings = await getSettings();
    expect(Object.keys(settings.allowedOrigins)).toEqual(["https://ok.example"]);
    expect(Object.keys(settings.blockedOrigins)).toEqual([
      "https://blocked.example",
    ]);
    expect(chromeMock.store.get("allowedOrigins")).toEqual({
      "https://ok.example": {
        allowedAt: 1,
        providerId: "openai",
        model: "gpt-4o-mini",
      },
    });
  });
});

describe("origin grants and blocks", () => {
  it("grants, lists, updates, and revokes an origin", async () => {
    await grantOriginAlways("https://app.example", {
      providerId: "ollama",
      model: "gemma4",
    });

    await expect(getOriginGrant("https://app.example")).resolves.toMatchObject({
      providerId: "ollama",
      model: "gemma4",
    });
    await expect(listAllowedOrigins()).resolves.toEqual([
      expect.objectContaining({
        origin: "https://app.example",
        providerId: "ollama",
        model: "gemma4",
      }),
    ]);

    await expect(
      setOriginProviderModel("https://app.example", {
        providerId: "openai",
        model: "gpt-4o-mini",
      })
    ).resolves.toBe(true);

    await expect(getOriginGrant("https://app.example")).resolves.toMatchObject({
      providerId: "openai",
      model: "gpt-4o-mini",
    });

    await revokeOrigin("https://app.example");
    await expect(getOriginGrant("https://app.example")).resolves.toBeNull();
  });

  it("refuses to persist opaque null origins", async () => {
    await grantOriginAlways("null", {
      providerId: "openai",
      model: "gpt-4o-mini",
    });
    await blockOrigin("null");
    await expect(getOriginGrant("null")).resolves.toBeNull();
    await expect(isOriginBlocked("null")).resolves.toBe(false);
  });

  it("blocks an origin and clears any prior grant", async () => {
    await grantOriginAlways("https://app.example", {
      providerId: "openai",
      model: "gpt-4o-mini",
    });
    await blockOrigin("https://app.example");

    await expect(getOriginGrant("https://app.example")).resolves.toBeNull();
    await expect(isOriginBlocked("https://app.example")).resolves.toBe(true);
    await expect(listBlockedOrigins()).resolves.toEqual([
      expect.objectContaining({ origin: "https://app.example" }),
    ]);

    await unblockOrigin("https://app.example");
    await expect(isOriginBlocked("https://app.example")).resolves.toBe(false);
  });

  it("grantOriginAlways clears a prior block for the same origin", async () => {
    await blockOrigin("https://app.example");
    await grantOriginAlways("https://app.example", {
      providerId: "ollama",
      model: "gemma4",
    });
    await expect(isOriginBlocked("https://app.example")).resolves.toBe(false);
    await expect(getOriginGrant("https://app.example")).resolves.toMatchObject({
      providerId: "ollama",
      model: "gemma4",
    });
  });

  it("does not overwrite defaultModel with blank saveSettings patches", async () => {
    await saveSettings({
      defaultProviderId: "ollama",
      defaultModel: "gemma4",
      openaiApiKey: " sk-test ",
    });
    let settings = await getSettings();
    expect(settings).toMatchObject({
      defaultProviderId: "ollama",
      defaultModel: "gemma4",
      openaiApiKey: "sk-test",
    });

    await saveSettings({ defaultModel: "   " });
    settings = await getSettings();
    expect(settings.defaultModel).toBe("gemma4");
  });

  it("setOriginProviderModel rejects empty models and missing grants", async () => {
    await expect(
      setOriginProviderModel("https://missing.example", {
        providerId: "openai",
        model: "gpt-4o-mini",
      })
    ).resolves.toBe(false);

    await grantOriginAlways("https://app.example", {
      providerId: "openai",
      model: "gpt-4o-mini",
    });
    await expect(
      setOriginProviderModel("https://app.example", {
        providerId: "openai",
        model: "  ",
      })
    ).resolves.toBe(false);
  });
});
