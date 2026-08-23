/**
 * Hugging Face Transformers.js compatibility backend for ipa-tools.
 *
 * Not an IPA implementation. Pass the backend object into
 * `createInference({ fallbacks: [createTransformersBackend()] })`.
 */

export {
  createTransformersBackend,
  getTransformersAvailability,
  DEFAULT_MODEL_SIZE_HINT,
  DEFAULT_TRANSFORMERS_DTYPE,
  DEFAULT_TRANSFORMERS_MODEL,
  TRANSFORMERS_BACKEND_ID,
  type CreateTransformersBackendOptions,
} from "./transformers-backend.js";

export type { LoadTransformers, TransformersModule } from "./transformers.js";
