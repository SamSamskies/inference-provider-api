/**
 * Ambient module so this package can `import("@huggingface/transformers")`
 * without taking a compile-time dependency. Apps supply the library via the
 * peer, a bundler, or an import map (tests inject `loadTransformers`).
 */
declare module "@huggingface/transformers" {
  export const pipeline: (...args: never[]) => Promise<unknown>;
  export const TextStreamer: new (
    tokenizer: unknown,
    options?: unknown
  ) => unknown;
  export const ModelRegistry: {
    is_pipeline_cached?(
      task: string,
      modelId: string,
      options?: Record<string, unknown>
    ): Promise<boolean>;
  };
}
