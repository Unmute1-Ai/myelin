// Shared plumbing for the cloud providers. Development-only per the
// 2026-10-30 local-first decision — never a launch path; the scripted
// provider is the default. These call provider HTTP APIs directly (no SDKs)
// and never stream: one completion, mapped onto the TurnEvent stream.
//
// Hardening contract (spec §6.5): typed failures (timeout/HTTP/parse/rate
// limit), schema-validated structured outputs that degrade field-by-field to
// plain text — never a crash, never leaked internals — and a propose_action
// TOOL contract so tool-calling models can propose through a structured
// channel instead of JSON prose.
//
// Trust boundary: model output is untrusted. A proposed action only becomes a
// pending confirmation in session state — the Sentinel gate in the routes
// owns every execution, and the check line is rendered verbatim in the UI.

import { z } from "zod/v4";
import { PROPOSED_ACTIONS, type ProposedAction, type TurnEvent } from "../types";
import type { DemoLesson } from "../lesson/types";
import { ProviderHTTPError, ProviderParseError, ProviderTimeoutError } from "./errors";

export const LLM_TIMEOUT_MS_DEFAULT = 30_000;

/** Timeout override for dev runs: TUTOR_PROVIDER_TIMEOUT_MS (positive integer ms). */
export function providerTimeoutMs(): number {
  const raw = process.env["TUTOR_PROVIDER_TIMEOUT_MS"];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : LLM_TIMEOUT_MS_DEFAULT;
}

/**
 * The propose_action tool models may call instead of embedding the action in
 * JSON. Proposing is all it can do — the Sentinel gate in the routes owns
 * execution, for tool calls exactly as for JSON fields.
 */
export const PROPOSE_ACTION_TOOL_NAME = "propose_action";
export const PROPOSE_ACTION_TOOL_DESCRIPTION =
  "Propose ONE consequential action (advance a lesson step, mark the lesson mastered, or assign practice). " +
  "The learner still confirms visibly before anything executes — this tool proposes, it never executes.";
export const PROPOSE_ACTION_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: [...PROPOSED_ACTIONS] },
    checkLine: {
      type: "string",
      description: 'One-line confirmation check starting "I heard this as: "',
    },
  },
  required: ["action", "checkLine"],
  additionalProperties: false,
} as const;

/**
 * Structured reply contract. `reply` is required (else the raw text becomes
 * the reply); the other fields degrade independently — an invalid proposed
 * action is dropped, not fatal, so a chatty model never loses its teaching.
 */
export interface ModelReply {
  reply: string;
  spoken?: string;
  proposedAction?: ProposedAction | null;
  checkLine?: string | null;
}

export const modelReplySchema = z.object({
  reply: z.string(),
  spoken: z.string().min(1).optional().catch(undefined),
  proposedAction: z.enum(["advance_step", "mark_mastered", "assign_practice"]).nullish().catch(undefined),
  // Trim-then-require: a whitespace-only check line is not a check line —
  // the confirm UI renders it verbatim, so blanks degrade to no proposal.
  checkLine: z.string().trim().min(1).nullish().catch(undefined),
});

const toolArgsSchema = z.object({
  action: z.enum(["advance_step", "mark_mastered", "assign_practice"]),
  checkLine: z.string().trim().min(1),
});

/** JSON-contract instruction appended to the verbatim Primer system prompt. */
export const REPLY_CONTRACT_INSTRUCTION = [
  "Lesson context and the learner's conversation are provided. Teach in Primer's voice.",
  "Reply with ONLY a JSON object, no prose around it, shaped like:",
  '{"reply": "<full-detail reply shown on screen>", "spoken": "<short spoken version>", "proposedAction": null, "checkLine": null}',
  'When you propose a consequential action, call the propose_action tool OR set "proposedAction" to exactly one of "advance_step", "mark_mastered", "assign_practice" and put the one-line check ("I heard this as: …") in "checkLine". Propose at most one action per turn.',
  "Never execute anything yourself — proposing is all you can do.",
].join("\n");

/**
 * POST JSON and return the response body text. Typed failures only:
 * timeout → ProviderTimeoutError, non-2xx → ProviderHTTPError. Request
 * payloads never appear in errors — they carry learner input.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(providerTimeoutMs()),
    });
  } catch (error) {
    const name = typeof (error as { name?: unknown } | null)?.name === "string"
      ? ((error as { name: string }).name)
      : "";
    if (name === "TimeoutError" || name === "AbortError") throw new ProviderTimeoutError();
    throw error;
  }
  if (!response.ok) {
    // 401/403 still a ProviderHTTPError — the status distinguishes auth issues in logs/tests.
    throw new ProviderHTTPError(response.status);
  }
  return response.text();
}

/** Parse a provider response body as JSON; malformed bodies are a typed parse failure. */
export function parseJsonResponse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProviderParseError();
  }
}

/**
 * Parse the model's reply. Preference order: a valid propose_action TOOL
 * call (structured channel) beats embedded JSON; embedded JSON beats plain
 * text. Any path degrades to a plain-text reply — never throws on model output.
 */
export function parseModelReply(raw: string, toolArguments?: unknown): ModelReply {
  if (toolArguments !== undefined) {
    const tool = toolCallToReply(toolArguments, raw);
    if (tool !== null) return tool;
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const candidate: unknown = JSON.parse(raw.slice(start, end + 1));
      if (candidate !== null && typeof candidate === "object" && typeof (candidate as ModelReply).reply === "string") {
        // Per-field validation: invalid action/checkLine/spoken drop out, the reply survives.
        const parsed = modelReplySchema.parse(candidate);
        // A proposal is a PAIR: an action without its check line (or the
        // reverse) is not confirmable, so the whole proposal drops.
        const hasAction = parsed.proposedAction !== undefined && parsed.proposedAction !== null;
        const hasCheck = typeof parsed.checkLine === "string" && parsed.checkLine.length > 0;
        const proposal = hasAction && hasCheck ? { proposedAction: parsed.proposedAction, checkLine: parsed.checkLine } : {};
        // A blank reply is not a reply — the learner would see nothing. The
        // documented fallback is the raw model text.
        const reply = parsed.reply.trim().length > 0 ? parsed.reply : raw;
        return { reply, spoken: parsed.spoken, ...proposal };
      }
    } catch {
      // fall through: treat the whole text as the reply
    }
  }
  return { reply: raw };
}

/** Validate propose_action tool arguments; null when the model called it wrong. */
export function toolCallToReply(args: unknown, fallbackReply: string): ModelReply | null {
  const parsed = toolArgsSchema.safeParse(args);
  if (!parsed.success) return null;
  return {
    reply: fallbackReply.trim().length > 0 ? fallbackReply : parsed.data.checkLine,
    proposedAction: parsed.data.action,
    checkLine: parsed.data.checkLine,
  };
}

/** Map a parsed model reply onto the TurnEvent stream, dropping invalid proposals. */
export function modelReplyToEvents(parsed: ModelReply): TurnEvent[] {
  const events: TurnEvent[] = [{ type: "text", delta: parsed.reply }];

  const action = parsed.proposedAction;
  const checkLine = parsed.checkLine;
  if (action !== undefined && action !== null && typeof checkLine === "string" && checkLine.length > 0) {
    events.push({
      type: "proposed_action",
      action,
      checkLine,
    });
  }

  const spoken =
    typeof parsed.spoken === "string" && parsed.spoken.length > 0
      ? parsed.spoken
      : parsed.reply.slice(0, 200);
  events.push({ type: "done", spoken });
  return events;
}

/** Conversation messages → chat message pairs (tags and markers stripped). */
export function historyToChatMessages(
  history: readonly { role: "tutor" | "learner"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  return history.map((m) => ({ role: m.role === "learner" ? ("user" as const) : ("assistant" as const), content: m.content }));
}

/** Render a lesson as a text block for model context. */
export function lessonBlock(lesson: DemoLesson): string {
  const steps = lesson.steps
    .map(
      (s, i) =>
        `${i + 1}. ${s.concept}\n   Teaching: ${s.teaching.replace(/\n+/g, " ")}\n   Check question: ${s.check.question}`,
    )
    .join("\n");
  return `Lesson: ${lesson.title}\n${steps}`;
}

/** Build the full system prompt: verbatim Primer prompt + lesson context + reply contract. */
export function buildSystemPrompt(verbatimPrompt: string, lesson: DemoLesson): string {
  return `${verbatimPrompt}\n\n## Lesson module\n\n${lessonBlock(lesson)}\n\n## Reply format\n\n${REPLY_CONTRACT_INSTRUCTION}`;
}
