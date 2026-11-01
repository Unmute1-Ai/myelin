// Unit tests for the cloud-provider LLM plumbing: structured reply
// validation, tool-argument extraction, and fetch failure mapping
// (timeout / HTTP status / unparseable body). fetch is stubbed — no network.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderHTTPError, ProviderParseError, ProviderTimeoutError } from "./errors";
import {
  buildSystemPrompt,
  historyToChatMessages,
  modelReplySchema,
  parseJsonResponse,
  parseModelReply,
  postJson,
  toolCallToReply,
} from "./llm";
import { DEMO_LESSON } from "../lesson/money-math";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("modelReplySchema / parseModelReply", () => {
  it("parses a complete structured reply", () => {
    const parsed = parseModelReply(
      JSON.stringify({ reply: "Nice!", spoken: "Nice work.", proposedAction: "advance_step", checkLine: "I heard this as: ok?" }),
    );
    expect(parsed.reply).toBe("Nice!");
    expect(parsed.spoken).toBe("Nice work.");
    expect(parsed.proposedAction).toBe("advance_step");
    expect(parsed.checkLine).toBe("I heard this as: ok?");
  });

  it("degrades invalid proposedAction to none without losing the teaching", () => {
    const parsed = parseModelReply(JSON.stringify({ reply: "Hello!", spoken: "Hi.", proposedAction: "delete_everything" }));
    expect(parsed.reply).toBe("Hello!");
    expect(parsed.proposedAction).toBeUndefined();
  });

  it("drops a proposal whose check line is empty", () => {
    const parsed = parseModelReply(
      JSON.stringify({ reply: "Yes!", proposedAction: "mark_mastered", checkLine: "  " }),
    );
    expect(parsed.proposedAction).toBeUndefined();
  });

  it("an empty reply falls back to the raw model text", () => {
    expect(parseModelReply(JSON.stringify({ reply: "" })).reply).toBe('{"reply":""}');
  });

  it("spoken text survives JSON-in-JSON quoting without leaking escapes", () => {
    const parsed = parseModelReply(JSON.stringify({ reply: "R1", spoken: `R2\nwith "quotes" and 'apostrophes'` }));
    expect(parsed.spoken).toBe(`R2\nwith "quotes" and 'apostrophes'`);
  });

  it("non-JSON raw text becomes the reply verbatim", () => {
    const parsed = parseModelReply("Just words, no JSON.");
    expect(parsed.reply).toBe("Just words, no JSON.");
  });
});

describe("toolCallToReply", () => {
  it("a valid tool call yields the structured proposal without echo-doubling", () => {
    const reply = toolCallToReply(
      { action: "advance_step", checkLine: "I heard this as: right answer?" },
      "Great work!",
    );
    expect(reply).not.toBeNull();
    expect(reply?.reply).toBe("Great work!");
    expect(reply?.proposedAction).toBe("advance_step");
    expect(reply?.checkLine).toBe("I heard this as: right answer?");
  });

  it("a tool call without accompanying text proposes on its own", () => {
    const reply = toolCallToReply({ action: "mark_mastered", checkLine: "I heard this as: done?" }, "");
    expect(reply).not.toBeNull();
    expect(reply?.reply).not.toBe("");
    expect(reply?.proposedAction).toBe("mark_mastered");
  });

  it("an unknown action or missing check line degrades to the text path", () => {
    // Null means "no valid tool call" — provider call sites then take the
    // text path (parseModelReply on the raw text), which carries the reply.
    expect(toolCallToReply({ action: "wipe_session", checkLine: "I heard this as: x" }, "Fallback text.")).toBeNull();
  });

  it("a malformed action string degrades to the text path", () => {
    expect(toolCallToReply({ action: 42, checkLine: "I heard this as: x" }, "Fallback text.")).toBeNull();
  });

  it("a whitespace-only check line is not a valid proposal", () => {
    expect(toolCallToReply({ action: "advance_step", checkLine: "   " }, "Text.")).toBeNull();
  });
});

describe("postJson failure mapping", () => {
  it("maps a non-2xx status onto ProviderHTTPError without leaking the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"secret stuff"}', { status: 500 })),
    );
    const error = await postJson("https://x.test", {}, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHTTPError);
    expect((error as ProviderHTTPError).status).toBe(500);
    expect((error as Error).message).not.toContain("secret stuff");
  });

  it("maps fetch rejections named TimeoutError/AbortError onto ProviderTimeoutError", async () => {
    // The abort schedule itself is Node's AbortSignal.timeout — the mapping
    // (stdlib failure → typed error) is the contract under test.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const timeout = new Error("The operation was aborted due to timeout");
        timeout.name = "TimeoutError";
        throw timeout;
      }),
    );
    await expect(postJson("https://x.test", {}, {})).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("maps AbortError rejections onto ProviderTimeoutError too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const aborted = new DOMException("aborted", "AbortError");
        throw aborted;
      }),
    );
    await expect(postJson("https://x.test", {}, {})).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("a generic network failure propagates unchanged (not swallowed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(postJson("https://x.test", {}, {})).rejects.toThrow("ECONNREFUSED");
  });

  it("maps an unparseable provider body onto ProviderParseError", () => {
    expect(() => parseJsonResponse("not json at all")).toThrow(ProviderParseError);
    expect(parseJsonResponse('{"ok":true}')).toEqual({ ok: true });
  });

  it("sends the method, headers, and JSON body it was given", async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await postJson("https://x.test", { authorization: "Bearer k" }, { model: "m" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json", authorization: "Bearer k" }),
        body: JSON.stringify({ model: "m" }),
      }),
    );
  });
});

describe("prompt builders", () => {
  it("buildSystemPrompt embeds the base prompt and lesson content", () => {
    const prompt = buildSystemPrompt("BASE RULES", DEMO_LESSON);
    expect(prompt).toContain("BASE RULES");
    expect(prompt).toContain(DEMO_LESSON.title);
    // lessonBlock flattens teaching newlines into the block
    const firstTeaching = DEMO_LESSON.steps[0]?.teaching ?? "";
    expect(prompt).toContain(firstTeaching.split("\n")[0] ?? "");
    expect(prompt).toContain(DEMO_LESSON.steps[0]?.check.question ?? "");
  });

  it("historyToChatMessages maps learner/tutor roles onto user/assistant", () => {
    const messages = historyToChatMessages([
      { role: "learner", content: "hi" },
      { role: "tutor", content: "hello" },
    ]);
    expect(messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("modelReplySchema parity", () => {
  it("schema and parser agree on a partial reply", () => {
    const raw = JSON.stringify({ reply: "Only the reply." });
    const parsed = modelReplySchema.parse(JSON.parse(raw));
    expect(parsed.reply).toBe("Only the reply.");
    expect(parseModelReply(raw).reply).toBe("Only the reply.");
  });
});
