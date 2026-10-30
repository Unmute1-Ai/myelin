// Gemini provider — DEVELOPMENT-ONLY per the 2026-10-30 local-first decision
// (Gemma-local is the launch requirement, not this). Thin HTTP client, no
// SDK. Selected via TUTOR_PROVIDER=gemini + GEMINI_API_KEY.

import type { DemoLesson } from "../lesson/types";
import { PRIMER_SYSTEM_PROMPT } from "../prompt";
import type { TurnEvent, TurnMessage, TutorProvider } from "../types";
import { buildSystemPrompt, modelReplyToEvents, parseModelReply, postJson } from "./llm";

const DEFAULT_MODEL = "gemini-2.0-flash";
const API_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export function createGeminiProvider(apiKey: string): TutorProvider {
  return {
    name: "gemini",

    async *turn(history: TurnMessage[], lesson: DemoLesson, input: string): AsyncIterable<TurnEvent> {
      const model = process.env["TUTOR_GEMINI_MODEL"] ?? DEFAULT_MODEL;
      const body = {
        systemInstruction: { parts: [{ text: buildSystemPrompt(PRIMER_SYSTEM_PROMPT, lesson) }] },
        contents: [
          ...history.map((m) => ({
            role: m.role === "learner" ? "user" : "model",
            parts: [{ text: m.content }],
          })),
          { role: "user", parts: [{ text: input }] },
        ],
      };
      const raw = await postJson(API_URL(model), { "x-goog-api-key": apiKey }, body);
      const parsed: GeminiResponse = JSON.parse(raw);
      const text = (parsed.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      for (const event of modelReplyToEvents(parseModelReply(text))) {
        yield event;
      }
    },
  };
}
