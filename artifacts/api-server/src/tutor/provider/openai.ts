// OpenAI provider — DEVELOPMENT-ONLY per the 2026-10-30 local-first decision
// (Gemma-local is the launch requirement, not this). Thin HTTP client, no
// SDK. Selected via TUTOR_PROVIDER=openai + OPENAI_API_KEY.

import type { DemoLesson } from "../lesson/types";
import { PRIMER_SYSTEM_PROMPT } from "../prompt";
import type { TurnEvent, TurnMessage, TutorProvider } from "../types";
import { buildSystemPrompt, historyToChatMessages, modelReplyToEvents, parseModelReply, postJson } from "./llm";

const DEFAULT_MODEL = "gpt-4o";
const API_URL = "https://api.openai.com/v1/chat/completions";

interface OpenAIResponse {
  choices?: { message?: { content?: string } }[];
}

export function createOpenAIProvider(apiKey: string): TutorProvider {
  return {
    name: "openai",

    async *turn(history: TurnMessage[], lesson: DemoLesson, input: string): AsyncIterable<TurnEvent> {
      const model = process.env["TUTOR_OPENAI_MODEL"] ?? DEFAULT_MODEL;
      const body = {
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(PRIMER_SYSTEM_PROMPT, lesson) },
          ...historyToChatMessages(history),
          { role: "user", content: input },
        ],
      };
      const raw = await postJson(API_URL, { authorization: `Bearer ${apiKey}` }, body);
      const parsed: OpenAIResponse = JSON.parse(raw);
      const text = parsed.choices?.[0]?.message?.content ?? "";
      for (const event of modelReplyToEvents(parseModelReply(text))) {
        yield event;
      }
    },
  };
}
