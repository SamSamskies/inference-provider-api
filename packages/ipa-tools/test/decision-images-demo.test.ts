import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageSupport, mountImageDemo } from "../../../examples/decisions/images.mjs";

const html = readFileSync(new URL("../../../examples/decisions/images.html", import.meta.url), "utf8");
const features = { methods: { decide: true }, decisionMedia: { imageMediaTypes: ["image/png"] } };
const done = (answer: any = { type: "noul", noul: 0 }) => ({ type: "done", model: "mock-native", answers: { damaged: answer } });
function provider(snapshot: any = features, response = done()) {
  return { getFeatures: () => snapshot, request: vi.fn(async function* () { yield { type: "accepted" }; yield response; }) };
}
function setup(ipa: any = provider()) {
  const nodes: Record<string, any> = {};
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const listeners: Record<string, Function> = {};
    let value = "";
    const node: any = { hidden: match[0].includes(" hidden"), disabled: match[0].includes(" disabled"),
      textContent: "", files: [], dataset: {}, attrs: {}, listeners,
      setAttribute(key: string, val: string) { this.attrs[key] = val; },
      removeAttribute(key: string) { delete this.attrs[key]; },
      addEventListener(key: string, fn: Function) { listeners[key] = fn; },
      focus: vi.fn(), fire: (key: string) => listeners[key]?.({ preventDefault() {} }),
    };
    Object.defineProperty(node, "value", { get: () => value, set: (val) => { value = val; if (val === "") node.files = []; } });
    nodes[match[1]!] = node;
  }
  const doc = { getElementById: (id: string) => nodes[id], activeElement: undefined };
  const listeners: Record<string, Function> = {};
  const win: any = { inference: ipa, isSecureContext: true, location: { origin: "http://localhost" },
    URL: { createObjectURL: vi.fn(() => `blob:test-${Math.random()}`), revokeObjectURL: vi.fn() },
    addEventListener: (type: string, handler: Function) => { listeners[type] = handler; },
    setInterval: vi.fn(() => 1), clearInterval: vi.fn(),
  };
  win.top = win;
  vi.stubGlobal("window", win);
  mountImageDemo(doc, win);
  const file = (name = "photo.png", type = "image/png") => new File(["image fixture"], name, { type });
  const choose = (image = file()) => {
    nodes["image-file"].files = [image]; nodes["image-file"].value = image.name;
    nodes["image-file"].fire("change"); nodes["image-preview"].onload?.();
    return image;
  };
  return { nodes, doc, win, listeners, choose, file, ipa };
}
afterEach(() => vi.unstubAllGlobals());

describe("native decision image UI", () => {
  it.each([undefined, { methods: { decide: true } }, { imageInput: true },
    { ...features, decisionMedia: { imageMediaTypes: ["image/*"] } }])(
    "gates file selection independently of text Decisions and chat images: %j", (snapshot) => {
      const { nodes, ipa } = setup(provider(snapshot ?? {}));
      expect(nodes["image-file"].disabled).toBe(true);
      expect(nodes.inspect.disabled).toBe(true);
      expect(nodes.connection.hidden).toBe(false);
      expect(ipa.request).not.toHaveBeenCalled();
    });

  it("detects delayed image support and respects secure top-level contexts", () => {
    const { nodes, win, listeners } = setup(undefined);
    win.inference = provider(); listeners.focus!();
    expect(nodes["image-file"].disabled).toBe(false);
    expect(nodes["image-file"].accept).toBe("image/png");
    win.isSecureContext = false; expect(imageSupport(win).types).toEqual([]);
    win.isSecureContext = true; win.top = {}; expect(imageSupport(win).types).toEqual([]);
  });

  it("previews locally, keeps the native input value, and releases URLs on replacement, clear, and exit", () => {
    const { nodes, choose, ipa, win, listeners } = setup();
    const first = choose();
    expect(nodes["image-file"].value).toBe(first.name);
    expect(nodes["image-figure"].hidden).toBe(false);
    expect(nodes["file-meta"].textContent).toBe("photo.png · image/png · 13 B");
    expect(nodes.inspect.disabled).toBe(false);
    expect(ipa.request).not.toHaveBeenCalled();
    choose(); expect(win.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    nodes["clear-image"].fire("click");
    expect(win.URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(nodes.inspect.disabled).toBe(true);
    choose(); listeners.pagehide!();
    expect(win.URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(nodes["image-result"].hidden).toBe(true);
  });

  it("rejects unsupported or unreadable files and clears old results", async () => {
    const { nodes, choose, file } = setup();
    choose(); await nodes["image-form"].fire("submit");
    expect(nodes["image-result"].hidden).toBe(false);
    choose(file("other.jpg", "image/jpeg"));
    expect(nodes.inspect.disabled).toBe(true);
    expect(nodes["file-error"].hidden).toBe(false);
    expect(nodes["image-result"].hidden).toBe(true);
    choose(); nodes["image-preview"].onerror();
    expect(nodes.inspect.disabled).toBe(true);
    expect(nodes["file-error"].textContent).toContain("could not be previewed");
  });

  it.each([{ type: "noul", noul: 0 }, { type: "noul", noul: 1 }, { type: "refusal" }])(
    "shows zero/full probability and refusal distinctly: %j", async (answer) => {
      const ipa = provider(features, done(answer));
      const { nodes, choose } = setup(ipa);
      const file = choose(); await nodes["image-form"].fire("submit");
      expect(ipa.request.mock.calls[0]![0]).toMatchObject({ method: "decide", attachments: [{ type: "image", mediaType: "image/png", data: file }] });
      expect(nodes["damage-answer"].textContent).toBe(answer.type === "refusal" ? "Refused" : `${answer.noul * 100}%`);
      expect(nodes["damage-meter"].hidden).toBe(answer.type === "refusal");
      expect(nodes["image-result"].hidden).toBe(false);
      expect(nodes["result-meta"].textContent).toBe("mock-native");
    });

  it.each(["unavailable", "invalid_request", "permission_denied", "provider_error"])(
    "shows actionable %s guidance and the implementation detail", async (code) => {
      const ipa = { getFeatures: () => features, request: async function* () {
        throw Object.assign(new Error("Attachment 0 exceeds 1024 bytes."), { code });
      } };
      const { nodes, choose } = setup(ipa);
      choose(); await nodes["image-form"].fire("submit");
      expect(nodes["request-error"].hidden).toBe(false);
      expect(nodes["request-error"].textContent).toContain("Attachment 0 exceeds 1024 bytes");
      if (code === "unavailable") expect(nodes["request-error"].textContent).toContain("compatible route");
      expect(nodes["image-result"].hidden).toBe(true);
      expect(nodes.inspect.disabled).toBe(false);
    });

  it("rejects an invalid probability without displaying partial success", async () => {
    const { nodes, choose } = setup(provider(features, done({ type: "noul", noul: 1.5 })));
    choose(); await nodes["image-form"].fire("submit");
    expect(nodes["request-error"].hidden).toBe(false);
    expect(nodes["image-result"].hidden).toBe(true);
  });

  it.each([false, true])("cancels during approval/inference, ignores late results, and allows retry (accepted %j)", async (accepted) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signal: AbortSignal | undefined;
    const ipa = { getFeatures: () => features, request: async function* (input: any) {
      signal = input.signal;
      if (accepted) yield { type: "accepted" };
      await gate; yield done();
    } };
    const { nodes, choose } = setup(ipa);
    choose(); const pending = nodes["image-form"].fire("submit");
    await vi.waitFor(() => expect(signal).toBeDefined());
    nodes["cancel-image"].fire("click");
    expect(signal!.aborted).toBe(true);
    expect(nodes.inspect.disabled).toBe(false);
    expect(nodes["request-status"].textContent).toContain("Cancelled");
    release(); await pending;
    expect(nodes["image-result"].hidden).toBe(true);
    await nodes["image-form"].fire("submit");
    expect(nodes["image-result"].hidden).toBe(accepted ? false : true); // A missing accepted is invalid.
  });
});
