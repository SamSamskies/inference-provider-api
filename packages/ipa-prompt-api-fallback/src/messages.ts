import { makeInferenceError } from "ipa-tools";
import type { ContentPart, Message } from "ipa-tools";
import type { LanguageModelMessage } from "./language-model.js";

function hasImagePart(content: string | ContentPart[] | null): boolean {
  return (
    Array.isArray(content) && content.some((part) => part?.type === "image")
  );
}

function textFromContent(
  content: string | ContentPart[] | null,
  role: string
): string {
  if (hasImagePart(content)) {
    throw makeInferenceError(
      "invalid_request",
      "Prompt API backend does not support image input."
    );
  }
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) {
    throw makeInferenceError(
      "invalid_request",
      `${role} message content must be a string.`
    );
  }
  const texts: string[] = [];
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }
    throw makeInferenceError(
      "invalid_request",
      `${role} message content is invalid.`
    );
  }
  return texts.join("");
}

/**
 * Map IPA chat messages onto Prompt API `{ role, content }` messages.
 * Tool turns are unsupported (this backend advertises `toolCalling: false`).
 */
export function toLanguageModelMessages(
  messages: readonly Message[]
): LanguageModelMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw makeInferenceError(
      "invalid_request",
      "messages must be a non-empty array."
    );
  }

  const out: LanguageModelMessage[] = [];
  for (const message of messages) {
    if (message == null || typeof message !== "object") {
      throw makeInferenceError("invalid_request", "Invalid message.");
    }
    if (message.role === "tool") {
      throw makeInferenceError(
        "invalid_request",
        "Prompt API backend does not support tool messages."
      );
    }
    if (message.role === "system") {
      if (typeof message.content !== "string") {
        throw makeInferenceError(
          "invalid_request",
          "system message content must be a string."
        );
      }
      out.push({ role: "system", content: message.content });
      continue;
    }
    if (message.role === "user") {
      out.push({
        role: "user",
        content: textFromContent(message.content, "user"),
      });
      continue;
    }
    if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: textFromContent(message.content, "assistant"),
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
