import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertDecisionStream } from "./conformance/decisions.mjs";

const fixture = (file: string) => JSON.parse(readFileSync(new URL(`./conformance/${file}`, import.meta.url), "utf8"));
const request = fixture("decisions-request.json");
const done = fixture("decisions-done.json");
const accepted = { type: "accepted" };
async function* stream(chunks: unknown[]) { yield* chunks; }

describe("shared decision stream conformance assertions", () => {
  it("accepts all three primitives, optional usage, and out-of-order answer keys", async () => {
    expect(await assertDecisionStream(request, stream([accepted, done]))).toEqual(done);
    const { usage, ...withoutUsage } = done;
    withoutUsage.answers = Object.fromEntries(Object.entries(done.answers).reverse());
    expect(await assertDecisionStream(request, stream([accepted, withoutUsage]))).not.toHaveProperty("usage");
  });

  it("accepts mixed and all-refusal answers without treating refusal as a failed request", async () => {
    const mixed = structuredClone(done);
    mixed.answers.team = { type: "refusal" };
    expect((await assertDecisionStream(request, stream([accepted, mixed]))).answers.team).toEqual({ type: "refusal" });
    const refused = { ...done, answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "refusal" }])) };
    expect(await assertDecisionStream(request, stream([accepted, refused]))).toEqual(refused);
  });

  it("allows tied choices, fractional scores, and rounded distributions without renormalizing", async () => {
    const rounded = structuredClone(done);
    rounded.answers.team = { type: "choice", choice: "billing", probabilities: { billing: 0.5, technical: 0.5, other: 0 }, confidence: 0.25 };
    rounded.answers.urgency.probabilities = { "0": 0.3333, "1": 0.3333, "2": 0.3333 };
    rounded.answers.urgency.score = 1;
    const result = await assertDecisionStream(request, stream([accepted, rounded]));
    expect(result.answers.urgency.probabilities["0"]).toBe(0.3333);
  });

  it.each([
    [], [done], [accepted], [accepted, accepted, done], [accepted, done, done],
    [accepted, done, { type: "delta", content: "late" }],
    [accepted, { type: "delta", content: "text" }, done],
    [accepted, { type: "reasoning_delta", content: "thinking" }, done],
    [accepted, { type: "audio_delta", data: new Uint8Array([1]) }, done],
    [accepted, { type: "answer", id: "is_bug", answer: done.answers.is_bug }, done],
  ])("rejects invalid stream ordering or a method-incompatible chunk %#", async (...chunks) => {
    await expect(assertDecisionStream(request, stream(chunks))).rejects.toThrow();
  });

  it.each([
    (value: any) => { value.model = " "; },
    (value: any) => { value.message = { role: "assistant", content: "fake decision" }; },
    (value: any) => { value.transcript = { text: "wrong method" }; },
    (value: any) => { value.audio = { mediaType: "audio/mpeg", byteLength: 1 }; },
    (value: any) => { delete value.answers.is_bug; },
    (value: any) => { value.answers.extra = { type: "refusal" }; },
    (value: any) => { value.answers.is_bug = { type: "score", score: 0 }; },
    (value: any) => { value.answers.is_bug.noul = NaN; },
    (value: any) => { value.answers.is_bug.noul = 1.01; },
    (value: any) => { value.answers.is_bug.noul = -0.01; },
    (value: any) => { value.answers.is_bug.confidence = 1; },
    (value: any) => { value.answers.is_bug = { type: "refusal", noul: 0 }; },
    (value: any) => { value.answers.team.choice = "unknown"; },
    (value: any) => { value.answers.team.choice = "billing"; },
    (value: any) => { value.answers.team.confidence = Infinity; },
    (value: any) => { value.answers.team.probabilities.billing = -0.1; },
    (value: any) => { value.answers.team.probabilities.billing = "0.1"; },
    (value: any) => { value.answers.team.probabilities.technical = 0.7; },
    (value: any) => { value.answers.team.probabilities.extra = 0; },
    (value: any) => { delete value.answers.team.probabilities.other; },
    (value: any) => { value.answers.urgency.score = 2.1; },
    (value: any) => { value.answers.urgency.score = 0; },
    (value: any) => { value.answers.urgency.score = NaN; },
    (value: any) => { value.answers.urgency.legend["0"] = "Changed description"; },
    (value: any) => { delete value.answers.urgency.legend["0"]; value.answers.urgency.legend["3"] = "Wrong index"; },
    (value: any) => { delete value.answers.urgency.probabilities["0"]; value.answers.urgency.probabilities["3"] = 0.05; },
    (value: any) => { value.usage.inputTokens = -1; },
    (value: any) => { value.usage.outputTokens = 0.5; },
    (value: any) => { value.usage.outputTokens = Number.MAX_SAFE_INTEGER + 1; },
    (value: any) => { value.usage = { input_tokens: 200 }; },
  ])("rejects malformed or inconsistent upstream answers %#", async (mutate) => {
    const invalid = structuredClone(done);
    mutate(invalid);
    await expect(assertDecisionStream(request, stream([accepted, invalid]))).rejects.toThrow();
  });

  it.each(["aborted", "provider_error"])("propagates %s without requiring a done", async (code) => {
    const error = Object.assign(new Error("Request failed"), { code });
    async function* failure() { yield accepted; throw error; }
    await expect(assertDecisionStream(request, failure())).rejects.toBe(error);
  });
});
