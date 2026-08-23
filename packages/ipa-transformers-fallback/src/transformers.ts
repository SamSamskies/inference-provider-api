/**
 * Minimal Transformers.js surface this backend calls.
 * Tests inject a mock; production loads `@huggingface/transformers`.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProgressInfo = {
  status?: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
};

export type TextGenerationCallOptions = {
  max_new_tokens?: number;
  temperature?: number;
  do_sample?: boolean;
  streamer?: unknown;
};

export type TextGenerationPipeline = {
  tokenizer: unknown;
  (
    messages: ChatMessage[],
    options?: TextGenerationCallOptions
  ): Promise<unknown>;
  dispose?: () => Promise<void> | void;
};

export type TextStreamerOptions = {
  skip_prompt?: boolean;
  skip_special_tokens?: boolean;
  callback_function?: (text: string) => void;
};

export type TextStreamerConstructor = new (
  tokenizer: unknown,
  options?: TextStreamerOptions
) => unknown;

export type ModelRegistryLike = {
  is_pipeline_cached?(
    task: string,
    modelId: string,
    options?: { dtype?: string; device?: string }
  ): Promise<boolean>;
};

export type TransformersModule = {
  pipeline(
    task: "text-generation",
    model: string,
    options?: {
      dtype?: string;
      device?: string;
      progress_callback?: (info: ProgressInfo) => void;
    }
  ): Promise<TextGenerationPipeline>;
  TextStreamer?: TextStreamerConstructor;
  ModelRegistry?: ModelRegistryLike;
};

export type LoadTransformers = () => Promise<TransformersModule>;

/** Default loader — dynamic import so tests never need the real package. */
export async function loadTransformers(): Promise<TransformersModule> {
  const mod = await import("@huggingface/transformers");
  return {
    pipeline: mod.pipeline as TransformersModule["pipeline"],
    TextStreamer: mod.TextStreamer as TextStreamerConstructor | undefined,
    ModelRegistry: mod.ModelRegistry,
  };
}
