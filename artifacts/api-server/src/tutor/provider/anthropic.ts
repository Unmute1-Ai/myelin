// Anthropic provider — DEVELOPMENT-ONLY per the 2026-10-30 local-first
// decision (Gemma-local is the launch requirement, not this). Thin HTTP
// client, no SDK. Selected via TUTOR_PROVIDER=anthropic + ANTHROPIC_API_KEY.
// Hardened: rate-limited, propose_action tool contract, typed failures.

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

const DEFAULT_MODEL = "claude-sonnet-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";

interface AnthropicResponse {
  content?: { type: string; text?: string; name?: string; input?: unknown }[];
}

/** Pull the first valid propose_action tool call out of content blocks; null otherwise. */
export function anthropicToolCall(content: AnthropicResponse["content"]): unknown | undefined {
  const block = (content ?? []).find((b) => b.type === "tool_use" && b.name === PROPOSE_ACTION_TOOL_NAME);
  return block?.input;
}

export function createAnthropicProvider(apiKey: string, limiter: RateLimiter = cloudRateLimiter()): TutorProvider {
  return {
    name: "anthropic",

    async *turn(ctx: SessionContext): AsyncIterable<TurnEvent> {
      const model = process.env["TUTOR_ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
      limiter.acquire();
      const body = {
        model,
        max_tokens: 1024,
        system: buildSystemPrompt(PRIMER_SYSTEM_PROMPT, ctx.lesson),
        messages: [...historyToChatMessages(ctx.history), { role: "user", content: ctx.input }],
        tools: [
          {
            name: PROPOSE_ACTION_TOOL_NAME,
            description: PROPOSE_ACTION_TOOL_DESCRIPTION,
            input_schema: PROPOSE_ACTION_PARAMETERS,
          },
        ],
      };
      const raw = await postJson(
        API_URL,
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body,
      );
      const parsed = parseJsonResponse(raw) as AnthropicResponse;
      const text = (parsed.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text ?? "")
        .join("");
      const toolReply = toolCallToReply(anthropicToolCall(parsed.content), text);
      for (const event of modelReplyToEvents(toolReply ?? parseModelReply(text))) {
        yield event;
      }
    },
  };
}
