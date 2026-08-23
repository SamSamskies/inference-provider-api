import { makeInferenceError } from "ipa-tools";
import type { Message } from "ipa-tools";
import type { ChatMessage } from "./transformers.js";

/**
 * Map IPA chat messages onto Transformers.js chat `{ role, content }`.
 * Tool turns are unsupported (this backend advertises `toolCalling: false`).
 */
export function toChatMessages(messages: readonly Message[]): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw makeInferenceError(
      "invalid_request",
      "messages must be a non-empty array."
    );
  }

  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message == null || typeof message !== "object") {
      throw makeInferenceError("invalid_request", "Invalid message.");
    }
    if (message.role === "tool") {
      throw makeInferenceError(
        "invalid_request",
        "Transformers.js backend does not support tool messages."
      );
    }
    if (message.role === "system" || message.role === "user") {
      if (typeof message.content !== "string") {
        throw makeInferenceError(
          "invalid_request",
          `${message.role} message content must be a string.`
        );
      }
      out.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content ?? "",
      });
      continue;
    }
    throw makeInferenceError("invalid_request", "Invalid message role.");
  }

  const systemIndexes = out
    .map((m, i) => (m.role === "system" ? i : -1))
    .filter((i) => i >= 0);
  if (systemIndexes.length > 1) {
    throw makeInferenceError(
      "invalid_request",
      "At most one system message is supported."
    );
  }
  if (systemIndexes.length === 1 && systemIndexes[0] !== 0) {
    throw makeInferenceError(
      "invalid_request",
      "system message must be first."
    );
  }

  return out;
}

/** Pull assistant text out of a Transformers.js `text-generation` result. */
export function extractGeneratedText(result: unknown): string {
  const first = Array.isArray(result) ? result[0] : result;
  if (first == null || typeof first !== "object") return "";
  const generated = (first as { generated_text?: unknown }).generated_text;
  if (typeof generated === "string") return generated;
  if (Array.isArray(generated) && generated.length > 0) {
    const last = generated[generated.length - 1];
    if (
      last != null &&
      typeof last === "object" &&
      typeof (last as { content?: unknown }).content === "string"
    ) {
      return (last as { content: string }).content;
    }
  }
  return "";
}
