// Anthropic provider — DEVELOPMENT-ONLY per the 2026-10-30 local-first
// decision (Gemma-local is the launch requirement, not this). Thin HTTP
// client, no SDK. Selected via TUTOR_PROVIDER=anthropic + ANTHROPIC_API_KEY.

import type { DemoLesson } from "../lesson/types";
import { PRIMER_SYSTEM_PROMPT } from "../prompt";
import type { TurnEvent, TurnMessage, TutorProvider } from "../types";
import { buildSystemPrompt, historyToChatMessages, modelReplyToEvents, parseModelReply, postJson } from "./llm";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

export function createAnthropicProvider(apiKey: string): TutorProvider {
  return {
    name: "anthropic",

    async *turn(history: TurnMessage[], lesson: DemoLesson, input: string): AsyncIterable<TurnEvent> {
      const model = process.env["TUTOR_ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
      const body = {
        model,
        max_tokens: 1024,
        system: buildSystemPrompt(PRIMER_SYSTEM_PROMPT, lesson),
        messages: [...historyToChatMessages(history), { role: "user", content: input }],
      };
      const raw = await postJson(
        API_URL,
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body,
      );
      const parsed: AnthropicResponse = JSON.parse(raw);
      const text = (parsed.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text ?? "")
        .join("");
      for (const event of modelReplyToEvents(parseModelReply(text))) {
        yield event;
      }
    },
  };
}
