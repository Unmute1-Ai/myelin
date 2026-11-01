"use client";

/*
 * The live tutor (spec 6.7): a persistent, meaning-first chat over the
 * student's own sessions. Everything on this page rides the same-origin
 * /api proxy — no API base configuration in the browser.
 *
 * Sentinel discipline (spec 6.11): when the tutor proposes an action the
 * composer is replaced by the proposal card showing the check line verbatim;
 * the action executes only on the learner's explicit Confirm. Decline parks
 * it without executing. Nothing here executes from chat text alone.
 *
 * Hints, not answers (spec 6.7): struggling never reveals the answer — the
 * tutor re-teaches with a worked example instead. "Explain it differently"
 * is always one tap away; it sends the learner's own ask ("Can you explain
 * it differently?") so the adaptive selector treats it as student-authored.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Button, Card } from "@/components/ui";
import { MascotSlot } from "@/components/mascot-slot";
import { ApiError, createSession, getMe, listMaterials, listSessions, listTurns, postConfirm, postTurn, uploadMaterial } from "@/lib/session-api";
import type { SessionTurn, TutoringSession } from "@workspace/api-zod";

type Phase = "loading" | "signed-out" | "ready" | "error";

interface ChatMessage {
  turn: SessionTurn;
  /** Human-readable why-this-strategy note from the exchange (spec 6.2). */
  strategyWhy?: string;
  strategyId?: string;
}

const EXPLAIN_DIFFERENTLY_ASK = "Can you explain it differently?";

/** Client-side gate mirroring the API's contract: text-bearing uploads only. */
const ACCEPTED_UPLOAD_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json"];

function isTextUpload(file: File): boolean {
  return file.type.startsWith("text/") || ACCEPTED_UPLOAD_TYPES.includes(file.type);
}

/** Message rows where the learner is the author, right-aligned and tinted. */
function isStudentTurn(turn: SessionTurn): boolean {
  return turn.author === "student";
}

function speakerLabel(turn: SessionTurn): string {
  return isStudentTurn(turn) ? "You" : "Tutor";
}

function roleLabel(turn: SessionTurn | null): string {
  if (turn === null) return "Message";
  return turn.kind === "advance" ? "Progress" : speakerLabel(turn);
}

export default function TutorPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [session, setSession] = useState<TutoringSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [materials, setMaterials] = useState<Array<{ id: string; filename: string; sizeBytes: number }>>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const pending = session?.pendingAction ?? null;
  const pendingCheckLine = session?.pendingCheckLine ?? null;

  const loadSession = useCallback(async (existing: TutoringSession | null) => {
    const active = existing ?? (await resumeOrCreate());
    const [turns, materialList] = await Promise.all([
      listTurns(active.id),
      listMaterials(active.id),
    ]);
    setSession(active);
    setMessages(turns.turns.map((turn) => ({ turn })));
    setMaterials(materialList.materials.map(({ id, filename, sizeBytes }) => ({ id, filename, sizeBytes })));
    setPhase("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        if (me === null) {
          setPhase("signed-out");
          return;
        }
        await loadSession(null);
      } catch (error) {
        if (cancelled) return;
        setPhaseError(describeError(error));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, pending]);

  async function resumeOrCreate(): Promise<TutoringSession> {
    const { sessions } = await listSessions({ status: "active" });
    if (sessions.length > 0) return sessions[0]!;
    return createSession({});
  }

  function describeError(error: unknown): string {
    if (error instanceof ApiError) return error.message;
    return "We couldn't reach the tutor. Check your connection and try again.";
  }

  async function sendMessage(content: string): Promise<void> {
    if (session === null || busy || pending) return;
    const trimmed = content.trim();
    if (trimmed.length === 0) return;

    setBusy(true);
    setActionError(null);
    try {
      const exchange = await postTurn(session.id, trimmed);
      setMessages((current) => [
        ...current,
        { turn: exchange.studentTurn },
        { turn: exchange.tutorTurn, strategyId: exchange.strategyId, strategyWhy: exchange.strategyWhy },
      ]);
      setDraft("");
      // The exchange returns the fresh pending state — keep the row in sync
      // without a refetch round-trip.
      setSession((current) =>
        current === null ? current : { ...current, pendingAction: exchange.proposedAction ?? null, pendingCheckLine: exchange.checkLine ?? null },
      );
      speak(exchange.tutorTurn);
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function answerProposal(accepted: boolean): Promise<void> {
    if (session === null || busy || pending === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await postConfirm(session.id, accepted);
      setMessages((current) => [...current, ...result.tutorTurns.map((turn) => ({ turn }))]);
      setSession((current) =>
        current === null ? current : { ...current, pendingAction: null, pendingCheckLine: null },
      );
      speakText(result.spoken || result.reply);
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File): Promise<void> {
    if (session === null) return;
    setUploadNote(null);
    setActionError(null);

    if (!isTextUpload(file)) {
      setUploadNote("Only text files can be added right now (notes, CSV, JSON).");
      return;
    }
    if (file.size > 200_000) {
      setUploadNote("That file is too large — keep notes under about 200 KB.");
      return;
    }

    setBusy(true);
    try {
      const content = await file.text();
      const material = await uploadMaterial(session.id, {
        filename: file.name.slice(0, 255),
        mimeType: file.type || "text/plain",
        content,
      });
      setMaterials((current) => [...current, { id: material.id, filename: material.filename, sizeBytes: material.sizeBytes }]);
      setUploadNote(`Added "${material.filename}" — the tutor can now use it when you ask about your notes.`);
    } catch (error) {
      setUploadNote(describeError(error));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function speak(turn: SessionTurn): void {
    if (isStudentTurn(turn)) return;
    speakText(turn.content);
  }

  function speakText(text: string): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || text.length === 0) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }

  function submitDraft(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendMessage(draft);
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter makes a new line. AAC/keyboard-friendly.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  function startNewLesson(): void {
    void (async () => {
      setBusy(true);
      setActionError(null);
      try {
        const created = await createSession({});
        await loadSession(created);
      } catch (error) {
        setActionError(describeError(error));
      } finally {
        setBusy(false);
      }
    })();
  }

  if (phase === "loading") {
    return (
      <CenteredShell>
        <p role="status" className="text-lg font-semibold text-ink-soft">
          Getting your lesson ready…
        </p>
      </CenteredShell>
    );
  }

  if (phase === "signed-out") {
    return (
      <CenteredShell>
        <Card className="flex flex-col items-center gap-4 text-center">
          <MascotSlot variant="welcome" />
          <h1 className="text-2xl font-extrabold text-ink">Sign in to keep learning</h1>
          <p className="text-ink-soft">Your tutor remembers where you stopped — sign in to pick up the lesson.</p>
          <Link
            href="/login"
            className="rounded-full bg-primary px-6 py-3 text-base font-bold text-on-primary hover:bg-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sign in
          </Link>
        </Card>
      </CenteredShell>
    );
  }

  if (phase === "error") {
    return (
      <CenteredShell>
        <Card className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">The tutor is unreachable</h1>
          <p className="text-ink-soft">{phaseError}</p>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </Card>
      </CenteredShell>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Live tutor</h1>
          <p className="text-sm text-ink-soft" aria-live="polite">
            {session?.title ? session.title : "Money math — counting coins and making change"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-full border border-line bg-card px-4 py-2 text-sm font-bold text-primary hover:bg-primary-soft focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <span>Add notes</span>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept=".txt,.md,.csv,.json,text/*,application/json"
              aria-label="Add your own study notes (text files)"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
              disabled={busy}
            />
          </label>
          <Button variant="ghost" className="px-4 py-2 text-sm" onClick={startNewLesson} disabled={busy}>
            New lesson
          </Button>
        </div>
      </header>

      {materials.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Your study materials">
          {materials.map((material) => (
            <li
              key={material.id}
              className="rounded-full bg-mascot-soft px-3 py-1 text-xs font-bold text-ink"
              title={`${material.sizeBytes} bytes of text`}
            >
              📄 {material.filename}
            </li>
          ))}
        </ul>
      ) : null}

      {uploadNote ? (
        <p role="status" className="rounded-2xl bg-lavender-soft px-4 py-3 text-sm font-semibold text-primary">
          {uploadNote}
        </p>
      ) : null}

      <div
        ref={transcriptRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-card border border-line bg-card p-4"
        aria-label="Lesson conversation"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <MascotSlot variant="sessions" />
            <p className="max-w-sm text-ink-soft">
              Hi! I&apos;m your tutor. We&apos;re working on counting coins and making change — say hello and we&apos;ll pick up
              right where you left off.
            </p>
            <Button onClick={() => void sendMessage("hi")} disabled={busy}>
              Start the lesson
            </Button>
          </div>
        ) : (
          messages.map(({ turn, strategyId, strategyWhy }) => (
            <article
              key={turn.id}
              className={`flex max-w-[85%] flex-col gap-1 ${
                isStudentTurn(turn) ? "self-end" : "self-start"
              }`}
              aria-label={`${roleLabel(turn)} message`}
            >
              {turn.kind === "advance" ? (
                <p className="rounded-2xl bg-lavender-soft px-4 py-2 text-sm font-bold text-primary">
                  {turn.content.replace(/^\[(advanced|teaching) /, "").replace(/\]$/, "")}
                </p>
              ) : (
                <>
                  <div
                    className={`whitespace-pre-wrap rounded-3xl px-4 py-3 text-base leading-relaxed ${
                      isStudentTurn(turn)
                        ? "bg-primary text-on-primary"
                        : "border border-line bg-white text-ink"
                    }`}
                  >
                    {turn.content.replace(/^\[teaching \S+\]\n\n/, "")}
                  </div>
                  <div className={`flex items-center gap-2 text-xs text-ink-soft ${isStudentTurn(turn) ? "justify-end" : ""}`}>
                    <span>{speakerLabel(turn)}</span>
                    {!isStudentTurn(turn) ? (
                      <button
                        type="button"
                        onClick={() => speak(turn)}
                        className="font-bold text-primary underline underline-offset-2 hover:text-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
                        aria-label={`Read the tutor's message aloud`}
                      >
                        Read aloud
                      </button>
                    ) : null}
                    {!isStudentTurn(turn) && turn.kind === "reteach" ? (
                      <span className="rounded-full bg-mascot-soft px-2 py-0.5 font-bold text-ink">another way</span>
                    ) : null}
                    {!isStudentTurn(turn) && strategyId !== undefined && strategyId.length > 0 ? (
                      <span className="rounded-full bg-lavender-soft px-2 py-0.5 font-bold text-primary">{strategyId}</span>
                    ) : null}
                  </div>
                  {strategyWhy ? (
                    <p className="text-xs text-ink-soft" title="Why this teaching approach">
                      {strategyWhy}
                    </p>
                  ) : null}
                </>
              )}
            </article>
          ))
        )}
      </div>

      {actionError ? (
        <p role="alert" className="rounded-2xl bg-lavender-soft px-4 py-3 text-sm font-semibold text-danger">
          {actionError}
        </p>
      ) : null}

      {pending !== null ? (
        <Card className="flex flex-col gap-3 border-primary">
          <p className="text-sm font-bold uppercase tracking-wide text-primary">Waiting for your yes</p>
          <p className="text-base text-ink">{pendingCheckLine}</p>
          <div className="flex gap-3">
            <Button onClick={() => void answerProposal(true)} disabled={busy}>
              Yes, do it
            </Button>
            <Button variant="secondary" onClick={() => void answerProposal(false)} disabled={busy}>
              Not yet
            </Button>
          </div>
        </Card>
      ) : (
        <form onSubmit={submitDraft} className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={composerKeyDown}
              rows={2}
              maxLength={4000}
              placeholder="Type your answer or ask a question…"
              aria-label="Your message to the tutor"
              className="flex-1 resize-none rounded-2xl border border-line bg-card px-4 py-3 text-base text-ink placeholder:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              disabled={busy || session === null}
            />
            <Button type="submit" disabled={busy || draft.trim().length === 0}>
              {busy ? "Thinking…" : "Send"}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => void sendMessage(EXPLAIN_DIFFERENTLY_ASK)}
            disabled={busy}
            className="self-start rounded-full bg-mascot-soft px-4 py-2 text-sm font-bold text-ink hover:bg-mascot focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            ✨ Explain it differently
          </button>
        </form>
      )}
    </main>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      {children}
    </main>
  );
}
