/**
 * Minimal Chrome / Web Prompt API (`LanguageModel`) typings used by this
 * package. Not a complete DOM lib — only what the adapter calls.
 */

export type PromptApiAvailability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export type LanguageModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  prefix?: boolean;
};

export type LanguageModelExpectedModality = {
  type: "text" | "image" | "audio";
  languages?: string[];
};

export type LanguageModelCreateOptions = {
  expectedInputs?: LanguageModelExpectedModality[];
  expectedOutputs?: LanguageModelExpectedModality[];
  initialPrompts?: LanguageModelMessage[];
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
  monitor?: (monitor: CreateMonitor) => void;
};

export type LanguageModelPromptOptions = {
  signal?: AbortSignal;
};

export type CreateMonitor = {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEvent) => void
  ): void;
};

export type DownloadProgressEvent = {
  loaded: number;
};

export type LanguageModelSession = {
  prompt(
    input: string | LanguageModelMessage[],
    options?: LanguageModelPromptOptions
  ): Promise<string>;
  promptStreaming(
    input: string | LanguageModelMessage[],
    options?: LanguageModelPromptOptions
  ): ReadableStream<string> | AsyncIterable<string>;
  clone?(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
};

export type LanguageModelStatic = {
  availability(
    options?: LanguageModelCreateOptions
  ): Promise<PromptApiAvailability | string>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};

declare global {
  // Optional — present in Chrome with the Prompt API enabled.
  var LanguageModel: LanguageModelStatic | undefined;
}

export {};
