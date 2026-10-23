import { makeInferenceError } from "./errors.js";
import type {
  InferenceFeatures,
  InferenceRequest,
  TranscribeRequest,
  SynthesizeRequest,
  SynthesisMediaType,
} from "./types.js";

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
  if (request.method === "decide" && features.methods?.decide === true) return;
  if (request.method === "transcribe") {
    if (supportsTranscription(features, transcriptionMediaType(request))) return;
    throw makeInferenceError("invalid_request", "Transcription or its media type is not advertised.");
  }
  if (request.method === "synthesize") {
    if (supportsSynthesis(features, synthesisMediaType(request))) return;
    throw makeInferenceError("invalid_request", "Synthesis or its output media type is not advertised.");
  }
  throw makeInferenceError("invalid_request", `Method "${request.method}" is not advertised.`);
}
