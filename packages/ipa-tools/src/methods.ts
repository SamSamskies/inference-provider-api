import { makeInferenceError } from "./errors.js";
import type {
  InferenceFeatures,
  InferenceRequest,
  TranscribeRequest,
  SynthesizeRequest,
  SynthesisMediaType,
  DecideRequest,
  ImageMediaType,
} from "./types.js";

const imageMediaTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Capability preflight only: does not read/encode/decode bytes or impose limits. */
export function decisionImageMediaTypes(request: DecideRequest): ImageMediaType[] {
  const attachments = request.attachments;
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments)) {
    throw makeInferenceError("invalid_request", "Decision attachments must be an array.");
  }
  const types = new Set<ImageMediaType>();
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(attachment)) ||
      Object.keys(attachment).length !== 3 ||
      Object.keys(attachment).some((key) => !["type", "mediaType", "data"].includes(key)) ||
      attachment.type !== "image" || !imageMediaTypes.includes(attachment.mediaType) ||
      !(typeof attachment.data === "string" ||
        (typeof Blob !== "undefined" && attachment.data instanceof Blob))) {
      throw makeInferenceError("invalid_request", "Invalid inline decision image attachment.");
    }
    types.add(attachment.mediaType);
  }
  return [...types].sort();
}

export function supportsDecisionMedia(
  features: InferenceFeatures,
  required: readonly ImageMediaType[] = []
): boolean {
  if (features.methods?.decide !== true) return false;
  if (required.length === 0) return true;
  const advertised = features.decisionMedia?.imageMediaTypes;
  return Array.isArray(advertised) && advertised.length > 0 &&
    new Set(advertised).size === advertised.length &&
    advertised.every((type) => imageMediaTypes.includes(type)) &&
    required.every((type) => advertised.includes(type));
}

/** MIME comparison only; container/codec validation belongs to the implementation. */
export function normalizeMediaType(value: string): string {
  const essence = value.split(";")[0]!.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-m4a": "audio/mp4",
    "audio/wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/vnd.wave": "audio/wav",
  };
  return aliases[essence] ?? essence;
}

/** Never fetches URLs or reads bytes during fallback selection. */
export function transcriptionMediaType(
  request: TranscribeRequest
): string | undefined {
  const media = request.media;
  if (typeof media?.mediaType === "string") return normalizeMediaType(media.mediaType);
  if (typeof Blob !== "undefined" && media?.data instanceof Blob && media.data.type) {
    return normalizeMediaType(media.data.type);
  }
  return undefined;
}

export function supportsTranscription(
  features: InferenceFeatures,
  mediaType?: string
): boolean {
  const accepted = features.methods?.transcribe?.acceptedMedia;
  return Array.isArray(accepted) && accepted.some((constraint) =>
    typeof constraint?.mediaType === "string" &&
    /^[a-z0-9!#$%&'+.^_`|~-]+\/[a-z0-9!#$%&'+.^_`|~-]+$/.test(constraint.mediaType) &&
    (mediaType === undefined || constraint.mediaType === mediaType)
  );
}

/** Output types are canonical enum values; transcription aliases do not apply. */
export function synthesisMediaType(request: SynthesizeRequest): SynthesisMediaType {
  const output = request.output;
  if (output !== undefined && (output === null || typeof output !== "object" ||
    Array.isArray(output) || Object.keys(output).some((key) => key !== "mediaType"))) {
    throw makeInferenceError("invalid_request", "Invalid synthesis output.");
  }
  const mediaType = output?.mediaType === undefined ? "audio/mpeg" : output.mediaType;
  if (mediaType !== "audio/mpeg" && mediaType !== "audio/wav") {
    throw makeInferenceError("invalid_request", "Unknown synthesis output media type.");
  }
  return mediaType;
}

export function supportsSynthesis(
  features: InferenceFeatures,
  mediaType = "audio/mpeg"
): boolean {
  const synthesis = features.methods?.synthesize;
  if (synthesis === true) return mediaType === "audio/mpeg";
  if (!synthesis || typeof synthesis !== "object") return false;
  const types = synthesis.outputMediaTypes;
  return Array.isArray(types) && types.length > 0 &&
    types.every((type) => type === "audio/mpeg" || type === "audio/wav") &&
    types.includes(mediaType as SynthesisMediaType);
}

export function assertRequestMethod(
  request: InferenceRequest,
  features: InferenceFeatures
): void {
  if (request.method === "chat") return;
  if (request.method === "decide") {
    if (supportsDecisionMedia(features, decisionImageMediaTypes(request))) return;
    throw makeInferenceError("invalid_request", "Decisions or their image media types are not advertised.");
  }
  if (request.method === "transcribe") {
    if (supportsTranscription(features, transcriptionMediaType(request))) return;
    throw makeInferenceError("invalid_request", "Transcription or its media type is not advertised.");
  }
  if (request.method === "synthesize") {
    if (supportsSynthesis(features, synthesisMediaType(request))) return;
    throw makeInferenceError("invalid_request", "Synthesis or its output media type is not advertised.");
  }
  throw makeInferenceError("invalid_request", `Method "${(request as InferenceRequest).method}" is not advertised.`);
}
