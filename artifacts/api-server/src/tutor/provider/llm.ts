// Shared plumbing for the cloud providers. Development-only per the
// 2026-10-30 local-first decision — never a launch path; the scripted
// provider is the default. These call provider HTTP APIs directly (no SDKs)
// and never stream: one completion, mapped onto the TurnEvent stream.
//
// Trust boundary: model output is untrusted. A proposed action only becomes a
// pending confirmation in session state — the Sentinel gate in the routes
// owns every execution, and the check line is rendered verbatim in the UI.

import { PROPOSED_ACTIONS, type ProposedAction, type TurnEvent } from "../types";
import type { DemoLesson } from "../lesson/types";

const LLM_TIMEOUT_MS = 30_000;

/** What we ask cloud models to return (JSON; anything else degrades to plain text). */
export interface ModelReply {
  reply: string;
  spoken?: string;
  proposedAction?: string;
  checkLine?: string;
}

/** JSON-contract instruction appended to the verbatim Primer system prompt. */
export const REPLY_CONTRACT_INSTRUCTION = [
  "Lesson context and the learner's conversation are provided. Teach in Primer's voice.",
  "Reply with ONLY a JSON object, no prose around it, shaped like:",
  '{"reply": "<full-detail reply shown on screen>", "spoken": "<short spoken version>", "proposedAction": null, "checkLine": null}',
  'When you propose a consequential action, set "proposedAction" to exactly one of "advance_step", "mark_mastered", "assign_practice" and put the one-line check ("I heard this as: …") in "checkLine". Propose at most one action per turn.',
  "Never execute anything yourself — proposing is all you can do.",
].join("\n");

/** POST JSON and return the response body text; throws on non-2xx or timeout. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Never include request payloads in errors — they carry learner input.
    throw new Error(`Tutor provider request failed: HTTP ${response.status}`);
  }
  return response.text();
}

/** Parse the model's reply as JSON, degrading to a plain-text reply. */
export function parseModelReply(raw: string): ModelReply {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
      if (parsed !== null && typeof parsed === "object" && typeof (parsed as ModelReply).reply === "string") {
        return parsed as ModelReply;
      }
    } catch {
      // fall through: treat the whole text as the reply
    }
  }
  return { reply: raw };
}

/** Map a parsed model reply onto the TurnEvent stream, dropping invalid proposals. */
export function modelReplyToEvents(parsed: ModelReply): TurnEvent[] {
  const events: TurnEvent[] = [{ type: "text", delta: parsed.reply }];

  const valid =
    parsed.proposedAction !== undefined &&
    (PROPOSED_ACTIONS as readonly string[]).includes(parsed.proposedAction) &&
    typeof parsed.checkLine === "string" &&
    parsed.checkLine.length > 0;
  if (valid) {
    events.push({
      type: "proposed_action",
      action: parsed.proposedAction as ProposedAction,
      checkLine: parsed.checkLine!,
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
  history: { role: "tutor" | "learner"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  return history.map((m) => ({ role: m.role === "learner" ? ("user" as const) : ("assistant" as const), content: m.content }));
}

/** Render the demo lesson as a text block for model context. */
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