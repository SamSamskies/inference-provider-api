import { assertDecisionStream } from "./decisions.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** A failed stream must throw its declared code and must never complete. */
export async function assertDecisionFailure(stream, code, { preflight = false } = {}) {
  let accepted = false;
  let failure;
  for await (const outcome of settleStream(stream)) {
    if (outcome.error) {
      failure = outcome.error;
      continue;
    }
    const chunk = outcome.chunk;
    check(chunk?.type === "accepted" && !accepted, "Failed decision may only yield one accepted and no done.");
    check(!preflight, "Preflight failure must not yield accepted.");
    accepted = true;
  }
  check(failure?.code === code, `Expected ${code}, got ${failure?.code ?? "successful exhaustion"}.`);
  check(typeof failure.message === "string" && failure.message.trim(), "Failure needs a useful explanation.");
  return failure;
}

async function* settleStream(stream) {
  try { for await (const chunk of stream) yield { chunk }; }
  catch (error) { yield { error }; }
}

/** Known malformed vectors for an advertised valid image request. No network fetching. */
export function invalidDecisionMediaRequests(valid) {
  const withAttachments = (attachments) => ({ ...structuredClone(valid), attachments });
  const image = valid.attachments[0];
  return [
    withAttachments(null), withAttachments({}), withAttachments(new Array(1)),
    ...[
      { ...image, type: "audio" }, { ...image, mediaType: "image/*" },
      { ...image, mediaType: "IMAGE/PNG" }, { ...image, mediaType: "image/png; charset=binary" },
      { ...image, url: "https://example.invalid/never-fetch.png" },
      { type: "image", url: "https://example.invalid/never-fetch.png" },
      { ...image, fileId: "provider-file" }, { ...image, data: "" },
      { ...image, data: "data:image/png;base64," + image.data },
      { ...image, data: "!!!!" }, { ...image, data: "YQ" },
      { ...image, data: "YR==" }, // Nonzero unused padding bits.
      { ...image, data: "YQ==\n" }, { ...image, data: "_w==" },
      { ...image, data: "YQ==" }, // Valid base64, corrupt image bytes.
      { ...image, mediaType: "image/jpeg" }, // Valid PNG bytes, wrong type.
      { ...image, data: new Blob([]) },
      { ...image, data: new Blob(["bad"], { type: "image/jpeg" }) },
      { ...image, data: new Uint8Array([1]) },
    ].map((entry) => withAttachments([entry])),
  ];
}

/** Run against a controlled implementation with its documented over-limit fixtures. */
export async function assertDecisionMediaValidation({ inference, valid, oversized }) {
  check(Array.isArray(oversized) && oversized.length > 0, "Supply documented over-limit media requests.");
  const done = await assertDecisionStream(valid, inference.request(valid));
  for (const request of [...invalidDecisionMediaRequests(valid), ...oversized]) {
    await assertDecisionFailure(inference.request(request), "invalid_request", { preflight: true });
  }
  return done;
}

/** Canonical test snapshot; Blob and base64 must represent the exact same bytes. */
async function inputSnapshot(request) {
  const snapshot = structuredClone({ state: request.state, questions: request.questions,
    attachments: request.attachments ?? [] });
  for (const image of snapshot.attachments) {
    if (image.data instanceof Blob) {
      const bytes = new Uint8Array(await image.data.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      image.data = btoa(binary);
    }
  }
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) :
    value !== null && typeof value === "object" ? Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(snapshot));
}

/**
 * Implementation integration hook: pause real approval, mutate page inputs, then
 * compare the adapter's provider-neutral input before native wire mapping.
 * Hooks must use the implementation suite's timeout; never run against real consent UI unattended.
 */
export async function assertDecisionMediaSnapshot({ inference, request, waitForApproval, mutate, approve, readForwarded }) {
  const expected = await inputSnapshot(request);
  // Save questions too: the page mutation must not change the response assertion.
  const approvedRequest = structuredClone({ ...request, signal: undefined });
  const result = assertDecisionStream(approvedRequest, inference.request(request))
    .then((done) => ({ done }), (error) => ({ error }));
  await waitForApproval();
  check((await readForwarded()) === undefined, "No provider input before approval.");
  await mutate(request);
  await approve();
  const outcome = await result;
  if (outcome.error) throw outcome.error;
  check(await inputSnapshot(await readForwarded()) === expected, "Forwarded decision input differs from approved snapshot.");
  return outcome.done;
}

/** Cancel at an implementation-controlled approval/encoding/upload/inference barrier. */
export async function assertDecisionMediaCancellation({ inference, request, waitForStage, assertCleanup }) {
  const controller = new AbortController();
  const result = assertDecisionFailure(inference.request({ ...request, signal: controller.signal }), "aborted")
    .then(() => ({}), (error) => ({ error }));
  await waitForStage();
  controller.abort();
  const outcome = await result;
  if (outcome.error) throw outcome.error;
  await assertCleanup();
}
