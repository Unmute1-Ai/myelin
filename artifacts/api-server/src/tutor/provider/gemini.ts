// Gemini provider — DEVELOPMENT-ONLY per the 2026-10-30 local-first decision
// (Gemma-local is the launch requirement, not this). Thin HTTP client, no
// SDK. Selected via TUTOR_PROVIDER=gemini + GEMINI_API_KEY. Hardened:
// rate-limited, propose_action tool contract, typed failures.

import { PRIMER_SYSTEM_PROMPT } from "../prompt";
import type { SessionContext, TurnEvent, TutorProvider } from "../types";
import {
  PROPOSE_ACTION_PARAMETERS,
  PROPOSE_ACTION_TOOL_DESCRIPTION,
  PROPOSE_ACTION_TOOL_NAME,
  buildSystemPrompt,
  modelReplyToEvents,
  parseJsonResponse,
  parseModelReply,
  postJson,
  toolCallToReply,
} from "./llm";
import { cloudRateLimiter, type RateLimiter } from "./rate-limit";

const DEFAULT_MODEL = "gemini-2.0-flash";
const API_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string; functionCall?: { name?: string; args?: unknown } }[];
    };
  }[];
}

/** Pull the first valid propose_action function call out of response parts; null otherwise. */
export function geminiToolCall(response: GeminiResponse): unknown | undefined {
  const part = (response.candidates?.[0]?.content?.parts ?? []).find(
    (p) => p.functionCall?.name === PROPOSE_ACTION_TOOL_NAME,
  );
  return part?.functionCall?.args;
}

export function createGeminiProvider(apiKey: string, limiter: RateLimiter = cloudRateLimiter()): TutorProvider {
  return {
    name: "gemini",

    async *turn(ctx: SessionContext): AsyncIterable<TurnEvent> {
      const model = process.env["TUTOR_GEMINI_MODEL"] ?? DEFAULT_MODEL;
      limiter.acquire();
      const body = {
        systemInstruction: { parts: [{ text: buildSystemPrompt(PRIMER_SYSTEM_PROMPT, ctx.lesson) }] },
        contents: [
          ...ctx.history.map((m) => ({
            role: m.role === "learner" ? "user" : "model",
            parts: [{ text: m.content }],
          })),
          { role: "user", parts: [{ text: ctx.input }] },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: PROPOSE_ACTION_TOOL_NAME,
                description: PROPOSE_ACTION_TOOL_DESCRIPTION,
                parameters: PROPOSE_ACTION_PARAMETERS,
              },
            ],
          },
        ],
      };
      const raw = await postJson(API_URL(model), { "x-goog-api-key": apiKey }, body);
      const parsed = parseJsonResponse(raw) as GeminiResponse;
      const text = (parsed.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      const toolReply = toolCallToReply(geminiToolCall(parsed), text);
      for (const event of modelReplyToEvents(toolReply ?? parseModelReply(text))) {
        yield event;
      }
    },
  };
}
