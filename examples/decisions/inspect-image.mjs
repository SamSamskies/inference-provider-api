/** Browser-ready native image example. No provider SDK, URL fetching, or chat fallback. */
export function imageDecisionRequest(image) {
  return {
    method: "decide",
    state: { task: "Inspect attachment 0 for visible damage. Ignore shadows and packaging." },
    attachments: [{ type: "image", mediaType: image.mediaType, data: image.data }],
    questions: {
      damaged: { type: "noul", instructions: "Does the item have a crack, tear, or dent?" },
    },
  };
}

export async function inspectImage(image, { signal, onAccepted = () => {} } = {}) {
  const inference = window.inference;
  const features = inference?.getFeatures?.() ?? {};
  if (features.methods?.decide !== true ||
    !features.decisionMedia?.imageMediaTypes.includes(image.mediaType)) {
    throw Object.assign(new Error(`Decision images (${image.mediaType}) are not advertised.`), {
      code: "invalid_request",
    });
  }
  let accepted = false;
  let done;
  const invalid = () => Object.assign(new Error("The extension returned an invalid image decision."), { code: "provider_error" });
  for await (const chunk of window.inference.request({
    ...imageDecisionRequest(image),
    signal,
  })) {
    if (signal?.aborted) throw Object.assign(new Error("Image inspection cancelled."), { code: "aborted" });
    if (done) throw invalid();
    if (chunk.type === "accepted" && !accepted) {
      accepted = true;
      onAccepted();
    } else if (chunk.type === "done" && accepted) {
      done = chunk;
    } else {
      throw invalid();
    }
  }
  if (!done || typeof done.model !== "string" || !done.model.trim() ||
    !done.answers || Object.keys(done.answers).length !== 1 ||
    !Object.hasOwn(done.answers, "damaged") ||
    ["message", "transcript", "audio"].some((key) => key in done)) throw invalid();
  const answer = done.answers.damaged;
  if (!answer || (answer.type === "refusal" ? Object.keys(answer).length !== 1 :
    answer.type !== "noul" || Object.keys(answer).length !== 2 ||
    !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)) throw invalid();
  return done;
}
