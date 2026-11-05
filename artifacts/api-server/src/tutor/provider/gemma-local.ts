// Gemma-local provider — the intended local-first Primer launch path.
// Uses an OpenAI-compatible endpoint (Ollama, llama.cpp, or a compatible
// local inference server). No cloud fallback: missing or unreachable local
// inference fails the turn visibly.

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
import { openAIToolCall } from "./openai";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1/chat/completions";
const DEFAULT_MODEL = "gemma3:4b";

function endpointFromEnv(): string {
  const configured = process.env["GEMMA_LOCAL_BASE_URL"] ?? DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("GEMMA_LOCAL_BASE_URL must be a valid URL");
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Gemma-local must use HTTPS or a loopback HTTP endpoint");
  }
  return url.toString();
}

export function createGemmaLocalProvider(): TutorProvider {
  const endpoint = endpointFromEnv();
  return {
    name: "gemma-local",
    async *turn(ctx: SessionContext): AsyncIterable<TurnEvent> {
      const model = process.env["GEMMA_LOCAL_MODEL"] ?? DEFAULT_MODEL;
      const apiKey = process.env["GEMMA_LOCAL_API_KEY"];
      const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      const body = {
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(PRIMER_SYSTEM_PROMPT, ctx.lesson) },
          ...historyToChatMessages(ctx.history),
          { role: "user", content: ctx.input },
        ],
        tools: [{
          type: "function",
          function: {
            name: PROPOSE_ACTION_TOOL_NAME,
            description: PROPOSE_ACTION_TOOL_DESCRIPTION,
            parameters: PROPOSE_ACTION_PARAMETERS,
          },
        }],
      };
      const raw = await postJson(endpoint, headers, body);
      const parsed = parseJsonResponse(raw) as Parameters<typeof openAIToolCall>[0];
      const text = parsed.choices?.[0]?.message?.content ?? "";
      const toolReply = toolCallToReply(openAIToolCall(parsed), text);
      for (const event of modelReplyToEvents(toolReply ?? parseModelReply(text))) {
        yield event;
      }
    },
  };
}
