/**
 * Browser-compatible assertions for a successful decision stream and a known-valid
 * DecideRequest. Test support only; not part of window.inference or ipa-tools.
 */
export async function assertDecisionStream(request, stream) {
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const probability = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  // Allow floating point arithmetic at the specified absolute 0.02 boundary.
  const tolerance = 0.02 + 1e-12;
  function sameKeys(value, keys) {
    return record(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
  }

  check(request?.method === "decide" && record(request.questions), "Expected a valid DecideRequest.");
  const ids = Object.keys(request.questions);
  let accepted = false;
  let done;
  for await (const chunk of stream) {
    check(record(chunk), "Chunk must be an object.");
    check(!done, "No chunks may follow done.");
    if (chunk.type === "accepted") {
      check(!accepted, "Expected exactly one accepted.");
      accepted = true;
      continue;
    }
    check(accepted, "accepted must precede done.");
    check(chunk.type === "done", "Decisions must not emit deltas or partial answers.");
    check(typeof chunk.model === "string" && chunk.model.trim().length > 0, "done must identify a model.");
    check(!["message", "transcript", "audio"].some((key) => key in chunk), "Decision done must not contain another method's payload.");
    check(sameKeys(chunk.answers, ids), "answers must match the requested ids exactly.");
    for (const id of ids) {
      const question = request.questions[id];
      const answer = chunk.answers[id];
      check(record(answer), `${id}: answer must be an object.`);
      if (answer.type === "refusal") {
        check(sameKeys(answer, ["type"]), `${id}: refusal must not carry answer fields.`);
        continue;
      }
      check(answer.type === question.type, `${id}: answer type must match its question.`);
      if (question.type === "noul") {
        check(probability(answer.noul), `${id}: noul must be a probability.`);
        check(!["confidence", "probabilities", "choice", "score", "legend"].some((key) => key in answer), `${id}: noul has only its yes probability.`);
        continue;
      }
      check(probability(answer.confidence), `${id}: confidence must be in [0, 1].`);
      const keys = question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
      check(sameKeys(answer.probabilities, keys), `${id}: probabilities must match criteria keys.`);
      check(keys.every((key) => probability(answer.probabilities[key])), `${id}: invalid probability.`);
      const total = keys.reduce((sum, key) => sum + answer.probabilities[key], 0);
      check(Math.abs(total - 1) <= tolerance, `${id}: probabilities must sum to 1 within 0.02.`);
      if (question.type === "choice") {
        check(typeof answer.choice === "string" && keys.includes(answer.choice), `${id}: choice must be a requested option.`);
        check(answer.probabilities[answer.choice] === Math.max(...Object.values(answer.probabilities)), `${id}: choice must have maximum probability.`);
        check(!["noul", "score", "legend"].some((key) => key in answer), `${id}: choice must not contain another primitive's fields.`);
      } else {
        check(sameKeys(answer.legend, keys), `${id}: legend must use zero-based level indices.`);
        check(keys.every((key, i) => answer.legend[key] === question.criteria[i]), `${id}: legend must preserve requested descriptions.`);
        check(typeof answer.score === "number" && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= keys.length - 1, `${id}: score must be a bounded level index.`);
        const weighted = keys.reduce((sum, key, i) => sum + i * answer.probabilities[key], 0) / total;
        check(Math.abs(answer.score - weighted) <= tolerance, `${id}: score must match its probability-weighted level index.`);
        check(!["noul", "choice"].some((key) => key in answer), `${id}: score must not contain another primitive's fields.`);
      }
    }
    if (chunk.usage !== undefined) {
      check(record(chunk.usage), "Usage must be an object.");
      check(!["input_tokens", "output_tokens"].some((key) => key in chunk.usage), "Usage must use camelCase token fields.");
      for (const key of ["inputTokens", "outputTokens"]) {
        if (chunk.usage[key] !== undefined) check(Number.isSafeInteger(chunk.usage[key]) && chunk.usage[key] >= 0, "Token usage must be a nonnegative safe integer.");
      }
    }
    done = chunk;
  }
  check(accepted && done, "Successful stream must include accepted and done.");
  return done;
}
