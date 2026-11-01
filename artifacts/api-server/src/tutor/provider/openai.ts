// OpenAI provider — DEVELOPMENT-ONLY per the 2026-10-30 local-first decision
// (Gemma-local is the launch requirement, not this). Thin HTTP client, no
// SDK. Selected via TUTOR_PROVIDER=openai + OPENAI_API_KEY. Hardened:
// rate-limited, propose_action tool contract, typed failures.

import { PRIMER_SYSTEM_PROMPT } from "../prompt";
import type { SessionContext, TurnEvent, TutorProvider } from "../types";
import {
  PROPOSE_ACTION_PARAMETERS,
  PROPOSE_ACTION_TOOL_DESCRIPTION,
  PROPOSE_ACTION_TOOL_NAME,
  buildSystemPrompt,
  historyToChatMessages,
  modelReplyToEvents,
  parseJsonResponse,
  parseModelReply,
  postJson,
  toolCallToReply,
} from "./llm";
import { cloudRateLimiter, type RateLimiter } from "./rate-limit";

const DEFAULT_MODEL = "gpt-4o";
const API_URL = "https://api.openai.com/v1/chat/completions";

interface OpenAIResponse {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
  }[];
}

/** Pull the first valid propose_action tool call out of message tool_calls; null otherwise. */
export function openAIToolCall(response: OpenAIResponse): unknown | undefined {
  const call = (response.choices?.[0]?.message?.tool_calls ?? []).find(
    (c) => c.function?.name === PROPOSE_ACTION_TOOL_NAME,
  );
  if (call?.function?.arguments === undefined) return undefined;
  try {
    return JSON.parse(call.function.arguments) as unknown;
  } catch {
    return undefined; // malformed arguments degrade to the text path
  }
}

export function createOpenAIProvider(apiKey: string, limiter: RateLimiter = cloudRateLimiter()): TutorProvider {
  return {
    name: "openai",

    async *turn(ctx: SessionContext): AsyncIterable<TurnEvent> {
      const model = process.env["TUTOR_OPENAI_MODEL"] ?? DEFAULT_MODEL;
      limiter.acquire();
      const body = {
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(PRIMER_SYSTEM_PROMPT, ctx.lesson) },
          ...historyToChatMessages(ctx.history),
          { role: "user", content: ctx.input },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: PROPOSE_ACTION_TOOL_NAME,
              description: PROPOSE_ACTION_TOOL_DESCRIPTION,
              parameters: PROPOSE_ACTION_PARAMETERS,
            },
          },
        ],
      };
      const raw = await postJson(API_URL, { authorization: `Bearer ${apiKey}` }, body);
      const parsed = parseJsonResponse(raw) as OpenAIResponse;
      const text = parsed.choices?.[0]?.message?.content ?? "";
      const toolReply = toolCallToReply(openAIToolCall(parsed), text);
      for (const event of modelReplyToEvents(toolReply ?? parseModelReply(text))) {
        yield event;
      }
    },
  };
}
