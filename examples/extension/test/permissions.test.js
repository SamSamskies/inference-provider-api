import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "./helpers/chrome-mock.js";
import {
  cancelApproval,
  ensurePermission,
  getPendingApproval,
  handleApprovalWindowClosed,
  resolveApproval,
} from "../src/permissions.js";
import {
  blockOrigin,
  grantOriginAlways,
  getOriginGrant,
  isOriginBlocked,
  saveSettings,
} from "../src/storage.js";

const chromeMock = installChromeMock();

beforeEach(() => {
  chromeMock.reset();
  vi.restoreAllMocks();
});

/**
 * @param {string} requestId
 */
async function waitForPending(requestId) {
  await vi.waitFor(() => {
    expect(getPendingApproval(requestId)).not.toBeNull();
  });
}

describe("ensurePermission", () => {
  it("denies blocked origins without prompting", async () => {
    await blockOrigin("https://blocked.example");

    await expect(
      ensurePermission({
        requestId: "r1",
        origin: "https://blocked.example",
        messages: [{ role: "user", content: "hi" }],
      })
    ).resolves.toEqual({
      allowed: false,
      providerId: "openai",
      model: "gpt-4o-mini",
      once: false,
    });
    expect(getPendingApproval("r1")).toBeNull();
  });

  it("reuses an existing always-allow grant without prompting", async () => {
    await grantOriginAlways("https://app.example", {
      providerId: "ollama",
      model: "gemma4",
    });

    await expect(
      ensurePermission({
        requestId: "r2",
        origin: "https://app.example",
        messages: [{ role: "user", content: "hi" }],
      })
    ).resolves.toEqual({
      allowed: true,
      providerId: "ollama",
      model: "gemma4",
      once: false,
    });
    expect(getPendingApproval("r2")).toBeNull();
  });

  it("falls back to the grant provider default model, not settings.defaultModel", async () => {
    await saveSettings({
      defaultProviderId: "openai",
      defaultModel: "gpt-4o",
    });
    await grantOriginAlways("https://app.example", {
      providerId: "ollama",
      model: "",
    });

    await expect(
      ensurePermission({
        requestId: "r3",
        origin: "https://app.example",
        messages: [{ role: "user", content: "hi" }],
      })
    ).resolves.toMatchObject({
      allowed: true,
      providerId: "ollama",
      // ollamaProvider.defaultModel
      model: expect.any(String),
    });

    const result = await ensurePermission({
      requestId: "r3b",
      origin: "https://app.example",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.model).not.toBe("gpt-4o");
  });

  it("does not reuse settings.defaultModel when preferred provider differs", async () => {
    await saveSettings({
      defaultProviderId: "ollama",
      defaultModel: "gemma4",
    });

    const pending = ensurePermission({
      requestId: "r4",
      origin: "https://app.example",
      messages: [{ role: "user", content: "hi" }],
      preferredProviderId: "openai",
    });
    await waitForPending("r4");

    const request = getPendingApproval("r4");
    expect(request).toMatchObject({
      providerId: "openai",
      model: "gpt-4o-mini",
    });
    expect(request.model).not.toBe("gemma4");

    resolveApproval("r4", {
      decision: "deny",
      providerId: "openai",
      model: "gpt-4o-mini",
    });
    await expect(pending).resolves.toMatchObject({ allowed: false });
  });

  it("allow_once does not persist a grant", async () => {
    const pending = ensurePermission({
      requestId: "r5",
      origin: "https://once.example",
      messages: [{ role: "user", content: "hi" }],
    });
    await waitForPending("r5");

    resolveApproval("r5", {
      decision: "allow_once",
      providerId: "openai",
      model: "gpt-4o-mini",
    });

    await expect(pending).resolves.toEqual({
      allowed: true,
      providerId: "openai",
      model: "gpt-4o-mini",
      once: true,
    });
    await expect(getOriginGrant("https://once.example")).resolves.toBeNull();
  });

  it("always persists provider + model", async () => {
    const pending = ensurePermission({
      requestId: "r6",
      origin: "https://always.example",
      messages: [{ role: "user", content: "hi" }],
    });
    await waitForPending("r6");

    resolveApproval("r6", {
      decision: "always",
      providerId: "ollama",
      model: "gemma4",
    });

    await expect(pending).resolves.toEqual({
      allowed: true,
      providerId: "ollama",
      model: "gemma4",
      once: false,
    });
    await expect(getOriginGrant("https://always.example")).resolves.toMatchObject({
      providerId: "ollama",
      model: "gemma4",
    });
  });

  it("never blocks the origin", async () => {
    const pending = ensurePermission({
      requestId: "r7",
      origin: "https://never.example",
      messages: [{ role: "user", content: "hi" }],
    });
    await waitForPending("r7");

    resolveApproval("r7", {
      decision: "never",
      providerId: "openai",
      model: "gpt-4o-mini",
    });

    await expect(pending).resolves.toMatchObject({ allowed: false, once: false });
    await expect(isOriginBlocked("https://never.example")).resolves.toBe(true);
  });

  it("uses the chosen provider default when switching providers in the prompt", async () => {
    await saveSettings({
      defaultProviderId: "openai",
      defaultModel: "gpt-4o",
    });

    const pending = ensurePermission({
      requestId: "r8",
      origin: "https://switch.example",
      messages: [{ role: "user", content: "hi" }],
    });
    await waitForPending("r8");

    // User picks Ollama but leaves model blank — must not keep gpt-4o.
    resolveApproval("r8", {
      decision: "allow_once",
      providerId: "ollama",
      model: "",
    });

    const result = await pending;
    expect(result).toMatchObject({
      allowed: true,
      providerId: "ollama",
      once: true,
    });
    // Ollama has no static defaultModel; never keep the OpenAI settings model.
    expect(result.model).not.toBe("gpt-4o");
  });
});

describe("resolveApproval", () => {
  it("keeps the pending request provider when providerId is blank", async () => {
    const pending = ensurePermission({
      requestId: "r9",
      origin: "https://blank.example",
      messages: [{ role: "user", content: "hi" }],
      preferredProviderId: "ollama",
      preferredModel: "gemma4",
    });
    await waitForPending("r9");

    resolveApproval("r9", {
      decision: "allow_once",
      providerId: "   ",
      model: "gemma4",
    });

    await expect(pending).resolves.toMatchObject({
      allowed: true,
      providerId: "ollama",
      model: "gemma4",
    });
  });

  it("treats unknown decisions as deny", async () => {
    const pending = ensurePermission({
      requestId: "r10",
      origin: "https://bad.example",
      messages: [{ role: "user", content: "hi" }],
    });
    await waitForPending("r10");

    resolveApproval("r10", {
      // @ts-expect-error intentional bad decision
      decision: "maybe",
      providerId: "openai",
      model: "gpt-4o-mini",
    });

    await expect(pending).resolves.toMatchObject({ allowed: false });
  });
});

describe("cancelApproval and window close", () => {
  it("denies when cancelApproval is called", async () => {
    const pending = ensurePermission({
      requestId: "r11",
      origin: "https://cancel.example",
      messages: [{ role: "user", content: "hi" }],
    });
    await waitForPending("r11");

    cancelApproval("r11");
    await expect(pending).resolves.toMatchObject({ allowed: false });
    expect(getPendingApproval("r11")).toBeNull();
  });

  it("denies when the approval window is closed", async () => {
    const pending = ensurePermission({
      requestId: "r12",
      origin: "https://closed.example",
      messages: [{ role: "user", content: "hi" }],
    });
    await waitForPending("r12");

    // chrome-mock assigns window id 1001
    handleApprovalWindowClosed(1001);
    await expect(pending).resolves.toMatchObject({ allowed: false });
    expect(getPendingApproval("r12")).toBeNull();
  });
});
