import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgent, type ChatChunk, type ChatRequest } from "../src/index.js";
import { availability, answerSegments, createResearchTools, LIMITS, runResearch } from "../../../examples/research/research.js";

const page = { pageid: 11866, ns: 0, index: 1, title: "Global Positioning System",
  canonicalurl: "https://en.wikipedia.org/wiki/Global_Positioning_System", extract: "GPS became available for civilian use." };
const response = (value: unknown) => new Response(JSON.stringify(value));
const pages = (items = [page]) => response({ batchcomplete: true, query: { pages: items } });
const tool = (name: string, args: unknown, id = "call"): ChatChunk => ({ type: "done", model: "mock", message: {
  role: "assistant", content: "", toolCalls: [{ type: "function", id, function: { name, arguments: JSON.stringify(args) } }],
} });
const search = () => tool("search_articles", { query: "GPS civilian" }, "search");
const read = () => tool("read_article", { pageId: 11866 }, "read");
const answer = (content = "GPS was opened to civilians. [S1]"): ChatChunk => ({ type: "done", model: "mock", message: { role: "assistant", content } });
function inference(...turns: ChatChunk[][]) {
  let turn = 0;
  return { getFeatures: () => ({ toolCalling: true }), request: vi.fn((_req: ChatRequest): AsyncIterable<ChatChunk> => ({
    async *[Symbol.asyncIterator]() { yield { type: "accepted" }; yield* turns[turn++] ?? []; },
  })) };
}
function options(provider = inference([search()], [read()], [answer()])) {
  return { createAgent, inference: provider, input: "How did GPS reach civilians?", fetchImpl: vi.fn(async () => pages()) };
}
afterEach(() => vi.useRealTimers());

describe("Topic Explorer demo", () => {
  it("searches then reads over three model rounds, preserves source metadata, and emits progress", async () => {
    const opts = options();
    const events: any[] = [], sources: any[] = [];
    const result = await runResearch({ ...opts, onEvent: (e: unknown) => events.push(e), onSources: (s: unknown) => sources.push(s) });
    expect(result.output).toContain("[S1]");
    expect(result.sources).toEqual([{ pageId: page.pageid, title: page.title, url: page.canonicalurl,
      id: "S1", text: page.extract, truncated: false }]);
    expect(sources).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool_completed").map((e) => e.name)).toEqual(["search_articles", "read_article"]);
    expect(opts.inference.request).toHaveBeenCalledTimes(3);
    const calls = opts.fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(2);
    const searchUrl = new URL(calls[0]![0]);
    expect(searchUrl.origin + searchUrl.pathname).toBe("https://en.wikipedia.org/w/api.php");
    expect(searchUrl.searchParams.get("origin")).toBe("*");
    expect(searchUrl.searchParams.get("generator")).toBe("search");
    expect(searchUrl.searchParams.get("gsrlimit")).toBe("5");
    expect(calls[0]![1]).toMatchObject({ credentials: "omit", mode: "cors" });
    expect(new URL(calls[1]![0]).searchParams.get("pageids")).toBe("11866");
    expect(opts.inference.request.mock.calls[0]![0].messages[0]!.content).toContain("untrusted reference data");
    expect(answerSegments(result.output, result.sources).find((part: any) => part.source)?.source.url).toBe(page.canonicalurl);
  });

  it("rejects missing/unsupported extensions and insecure or framed contexts before provider/network work", async () => {
    expect(availability(undefined).ready).toBe(false);
    expect(availability({ request() {} }).ready).toBe(false);
    expect(availability({ request() {}, getFeatures() { throw Error(); } }).ready).toBe(false);
    expect(availability(inference(), false).ready).toBe(false);
    expect(availability(inference(), true, false).ready).toBe(false);
    const opts = options();
    opts.inference.getFeatures = () => ({ toolCalling: false });
    await expect(runResearch(opts)).rejects.toMatchObject({ code: "unavailable" });
    expect(opts.inference.request).not.toHaveBeenCalled();
    expect(opts.fetchImpl).not.toHaveBeenCalled();
  });

  it("never reads model-supplied URLs or unknown page IDs, and validates search arguments", async () => {
    for (const [name, args] of [["read_article", { pageId: 42 }], ["read_article", { url: "https://evil.test" }],
      ["search_articles", { query: "" }], ["search_articles", { query: "GPS", extra: "bad" }]]) {
      const opts = options(inference([tool(name as string, args)]));
      await expect(runResearch(opts)).rejects.toMatchObject({ code: "invalid_request" });
      expect(opts.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("filters non-article and forged source URLs instead of exposing them", async () => {
    const fetchImpl = vi.fn(async () => pages([
      page, { ...page, pageid: 2, canonicalurl: "https://evil.test/wiki/GPS" },
      { ...page, pageid: 3, canonicalurl: "javascript:alert(1)" },
      { ...page, pageid: 4, ns: 1 },
    ]));
    const research = createResearchTools({ signal: new AbortController().signal, fetchImpl });
    const result = await research.tools.search_articles.execute({ query: "GPS" });
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].url).toBe(page.canonicalurl);
  });

  it("handles empty generator results and lets the model refine a query", async () => {
    const opts = options(inference([search()], [tool("search_articles", { query: "GPS" }, "s2")], [read()], [answer()]));
    opts.fetchImpl.mockResolvedValueOnce(response({ batchcomplete: true }));
    const result = await runResearch(opts);
    expect(result.sources).toHaveLength(1);
    const toolMessage = opts.inference.request.mock.calls[1]![0].messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("No matching articles");
  });

  it("does not treat a search preview or missing article as consulted evidence", async () => {
    await expect(runResearch(options(inference([search()], [answer()])))).rejects.toMatchObject({ code: "no_sources" });
    const opts = options();
    opts.fetchImpl.mockResolvedValueOnce(pages()).mockResolvedValueOnce(pages([{ ...page, extract: "" }]));
    await expect(runResearch(opts)).rejects.toMatchObject({ code: "no_sources" });
  });

  it("caches repeated tool requests and truncates article text with an explicit flag", async () => {
    const fetchImpl = vi.fn(async () => pages([{ ...page, extract: "x".repeat(15_000) }]));
    const research = createResearchTools({ signal: new AbortController().signal, fetchImpl });
    await research.tools.search_articles.execute({ query: "GPS" });
    await research.tools.search_articles.execute({ query: "GPS" });
    const article = await research.tools.read_article.execute({ pageId: 11866 });
    await research.tools.read_article.execute({ pageId: 11866 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(article).toMatchObject({ truncated: true });
    expect(article.text).toHaveLength(LIMITS.articleChars);
  });

  it.each([429, 503])("surfaces HTTP %s backoff without retrying", async (status) => {
    const opts = options();
    opts.fetchImpl.mockResolvedValue(new Response("busy", { status, headers: { "Retry-After": "30" } }));
    await expect(runResearch(opts)).rejects.toMatchObject({ code: "rate_limited", message: expect.stringContaining("30") });
    expect(opts.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces API rate limits, malformed JSON, and transport failures", async () => {
    for (const value of [response({ error: { code: "ratelimited" } }), new Response("<html>error</html>")]) {
      const opts = options(); opts.fetchImpl.mockResolvedValue(value);
      await expect(runResearch(opts)).rejects.toHaveProperty("code");
    }
    const opts = options(); opts.fetchImpl.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(runResearch(opts)).rejects.toMatchObject({ code: "network_error" });
  });

  it("caps response download bytes before tool results reach the model", async () => {
    const opts = options();
    await expect(runResearch({ ...opts, limits: { ...LIMITS, maxResponseBytes: 20 } })).rejects.toMatchObject({ code: "response_limit" });
    expect(opts.inference.request).toHaveBeenCalledTimes(1);
  });

  it("bounds tool requests and preserves the distinction between a capped run and a final answer", async () => {
    const opts = options();
    await expect(runResearch({ ...opts, limits: { ...LIMITS, maxToolCalls: 1 } })).rejects.toMatchObject({ code: "tool_limit" });
    expect(opts.fetchImpl).toHaveBeenCalledTimes(1);
    await expect(runResearch({ ...options(), limits: { ...LIMITS, maxRounds: 2 } })).rejects.toMatchObject({ code: "round_limit" });
  });

  it("reports provider/model failures and refuses an empty final answer", async () => {
    const opts = options();
    opts.inference.request.mockImplementation(() => { throw Object.assign(Error("Tools not supported"), { code: "provider_error" }); });
    await expect(runResearch(opts)).rejects.toMatchObject({ code: "provider_error" });
    await expect(runResearch(options(inference([search()], [read()], [answer("")])))).rejects.toMatchObject({ code: "no_answer" });
  });

  it("releases a stalled model on cancellation and ignores late events", async () => {
    const controller = new AbortController(), opts = options(), events: any[] = [];
    let release!: () => void;
    opts.inference.request.mockImplementation(() => ({ async *[Symbol.asyncIterator]() {
      await new Promise<void>((resolve) => { release = resolve; });
      yield answer();
    } }));
    const run = runResearch({ ...opts, signal: controller.signal, onEvent: (e: unknown) => events.push(e) });
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    const count = events.length; release(); await Promise.resolve();
    expect(events).toHaveLength(count);
    expect(opts.fetchImpl).not.toHaveBeenCalled();
  });

  it("cancels a pending article fetch without starting another model round", async () => {
    const controller = new AbortController(), opts = options();
    opts.fetchImpl.mockImplementation(() => new Promise(() => {}));
    const run = runResearch({ ...opts, signal: controller.signal, onEvent: (e: any) => {
      if (e.type === "tool_started") queueMicrotask(() => controller.abort());
    } });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(opts.inference.request).toHaveBeenCalledTimes(1);
  });

  it("applies network and whole-run deadlines even when external work ignores abort", async () => {
    vi.useFakeTimers();
    const opts = options(); opts.fetchImpl.mockImplementation(() => new Promise(() => {}));
    const network = expect(runResearch(opts)).rejects.toMatchObject({ code: "network_timeout" });
    await vi.advanceTimersByTimeAsync(LIMITS.requestMs); await network;
    opts.inference.request.mockImplementation(() => ({ async *[Symbol.asyncIterator]() { await new Promise(() => {}); } }));
    const run = expect(runResearch(opts)).rejects.toMatchObject({ code: "run_timeout" });
    await vi.advanceTimersByTimeAsync(LIMITS.runMs); await run;
  });

  it("bounds streaming and unstreamed model output", async () => {
    const long = "x".repeat(LIMITS.outputChars + 1);
    await expect(runResearch(options(inference([{ type: "delta", content: long }, answer()])))).rejects.toMatchObject({ code: "output_limit" });
    await expect(runResearch(options(inference([search()], [read()], [answer(long)])))).rejects.toMatchObject({ code: "output_limit" });
  });

  it("links only known read-source markers; HTML, fabricated URLs and IDs cannot create links", () => {
    const sources = [{ id: "S1", title: page.title, url: page.canonicalurl }];
    const parts = answerSegments('<img src=x onerror=alert(1)> [S1] [S9] [fake](https://evil.test) https://bad.test', sources);
    expect(parts.filter((part: any) => part.source)).toEqual([{ text: "[S1]", source: sources[0] }]);
    const text = parts.map((part: any) => part.text).join("");
    expect(text).toContain("<img"); // Remains text, never innerHTML.
    expect(text).toContain("[source unavailable]");
    expect(text).not.toContain("https://evil.test");
    expect(text).not.toContain("https://bad.test");
    expect(answerSegments("* **History:** GPS [S1]", sources).slice(0, 2)).toEqual([
      { text: "• " }, { text: "History:", bold: true },
    ]);
  });
});
