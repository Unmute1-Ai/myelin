"use client";

import { FormEvent, useEffect, useState } from "react";
import { CreateSessionResponse, PostSessionTurnResponse } from "@workspace/api-zod";

type Mode = "together" | "mj" | "jake";
type TurnView = {
  id: string;
  prompt: string;
  answer: string;
  mj?: string;
  jake?: string;
  note?: string;
};

async function readJson(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || "The request could not be completed.");
  }
  return data;
}

async function jakeTurn(input: string, currentSessionId: string | null) {
  let sessionId = currentSessionId;

  if (!sessionId) {
    const created = CreateSessionResponse.parse(
      await readJson(
        await fetch("/api/sessions", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Grace · Jake session" }),
        }),
      ),
    );
    sessionId = created.id;
  }

  const result = PostSessionTurnResponse.parse(
    await readJson(
      await fetch(
        "/api/sessions/" + encodeURIComponent(sessionId) + "/turns",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: input }),
        },
      ),
    ),
  );

  return { sessionId, answer: result.tutorTurn.content as string };
}

async function mjTurn(input: string): Promise<string> {
  const result = await readJson(
    await fetch("/api/companion/mj", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, consent: true }),
    }),
  );

  if (typeof result.answer !== "string" || !result.answer.trim()) {
    throw new Error("MJ returned an invalid response.");
  }

  return result.answer;
}

async function jointSynthesis(
  input: string,
  mjAssessment: string,
  jakeAssessment: string,
): Promise<string> {
  const result = await readJson(
    await fetch("/api/companion/synthesize", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input,
        mjAssessment,
        jakeAssessment,
        consent: true,
      }),
    }),
  );

  if (typeof result.answer !== "string" || !result.answer.trim()) {
    throw new Error("The synthesis service returned an invalid response.");
  }

  return result.answer;
}

function ProviderPill({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready?: boolean;
}) {
  const tone = ready === false
    ? "bg-amber-50 text-amber-900"
    : "bg-slate-100 text-slate-700";

  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs " + tone}>
      <span className="font-semibold">{label}</span>
      <span aria-hidden="true">·</span>
      <span>{value}</span>
    </span>
  );
}

export default function CompanionPage() {
  const [mode, setMode] = useState<Mode>("together");
  const [input, setInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mjConfigured, setMjConfigured] = useState(false);
  const [jakeProvider, setJakeProvider] = useState("unknown");
  const [statusReady, setStatusReady] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<TurnView[]>([]);

  useEffect(() => {
    let active = true;

    fetch("/api/companion/status", { credentials: "same-origin" })
      .then(readJson)
      .then((data) => {
        if (!active) return;
        setMjConfigured(Boolean(data.mjProviderReady));
        setJakeProvider(
          typeof data.jakeProvider === "string" ? data.jakeProvider : "unknown",
        );
        setStatusReady(true);
      })
      .catch(() => {
        if (active) setStatusReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  function changeMode(nextMode: Mode) {
    if (busy) return;
    setMode(nextMode);
    setConsent(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const prompt = input.trim();
    const requestedMode = mode;
    const hasConsent = consent;

    if (!prompt || busy) return;

    if (requestedMode !== "jake" && !hasConsent) {
      setError("Give one-turn permission before Grace routes this prompt to MJ.");
      return;
    }

    setBusy(true);
    setError("");
    setInput("");

    // Consent is consumed by this submission. A later turn always needs a
    // fresh affirmative action, including after a failed request.
    setConsent(false);

    const id = crypto.randomUUID();
    setTurns((old) => [
      ...old,
      { id, prompt, answer: "Grace is coordinating the selected systems…" },
    ]);

    try {
      let answer = "";
      let mj: string | undefined;
      let jake: string | undefined;
      let note: string | undefined;

      if (requestedMode === "jake") {
        const result = await jakeTurn(prompt, sessionId);
        setSessionId(result.sessionId);
        jake = result.answer;
        answer = jake;
      } else if (requestedMode === "mj") {
        mj = await mjTurn(prompt);
        answer = mj;
      } else {
        const [mjResult, jakeResult] = await Promise.allSettled([
          mjTurn(prompt),
          jakeTurn(prompt, sessionId),
        ]);

        if (mjResult.status === "fulfilled") {
          mj = mjResult.value;
        } else {
          note =
            "MJ: " +
            (mjResult.reason instanceof Error
              ? mjResult.reason.message
              : "unavailable");
        }

        if (jakeResult.status === "fulfilled") {
          jake = jakeResult.value.answer;
          setSessionId(jakeResult.value.sessionId);
        } else {
          note = [
            note,
            "Jake: " +
              (jakeResult.reason instanceof Error
                ? jakeResult.reason.message
                : "unavailable"),
          ]
            .filter(Boolean)
            .join(" · ");
        }

        if (mj && jake) {
          try {
            answer = await jointSynthesis(prompt, mj, jake);
          } catch (synthesisError) {
            answer =
              "Both specialists responded, but Grace could not complete the synthesis. Their separate assessments are preserved.";
            note = [
              note,
              synthesisError instanceof Error
                ? synthesisError.message
                : "Synthesis unavailable",
            ]
              .filter(Boolean)
              .join(" · ");
          }
        } else {
          answer =
            "A complete joint response was not possible. Grace has not generated a combined conclusion.";
        }
      }

      setTurns((old) =>
        old.map((turn) =>
          turn.id === id ? { ...turn, answer, mj, jake, note } : turn,
        ),
      );
    } catch (turnError) {
      setTurns((old) => old.filter((turn) => turn.id !== id));
      setError(
        turnError instanceof Error
          ? turnError.message
          : "The turn failed. No action was executed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const requiresConsent = mode !== "jake";
  const jakeProviderLabel =
    jakeProvider === "scripted"
      ? "scripted fallback"
      : jakeProvider === "gemma-local"
        ? "Gemma local"
        : jakeProvider === "unknown"
          ? "status unavailable"
          : jakeProvider;

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-7 px-5 py-8 sm:px-8"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <a
          href="/"
          className="text-sm font-extrabold tracking-[.18em] text-ink"
        >
          UNMUTE1AI
        </a>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-ink-soft">
            GRACE · INSTINCTIVE COMPANION
          </span>
          <a
            href="/login"
            className="text-xs font-bold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </a>
        </div>
      </header>

      <section className="grid items-center gap-6 rounded-[2rem] border border-white/70 bg-white/45 p-6 shadow-xl shadow-violet-950/5 backdrop-blur-xl md:grid-cols-[1fr_240px] md:p-9">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-bold uppercase tracking-[.22em] text-primary">
            GRACE · THE COMPANION HARNESS
          </p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
            One companion.
            <br />
            <span className="text-primary">Your voice. Your control.</span>
          </h1>
          <p className="max-w-2xl text-base leading-7 text-ink-soft">
            Grace coordinates two independent systems. MJ brings instinctive
            reasoning and investigation. Jake brings adaptive, learner-centered
            interaction. Grace keeps their roles separate and makes their
            contributions understandable.
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-ink-soft">
            <span className="rounded-full bg-violet-100 px-3 py-1.5">
              Grace · Orchestration
            </span>
            <span className="rounded-full bg-sky-100 px-3 py-1.5">
              MJ · Instinctive Intelligence
            </span>
            <span className="rounded-full bg-emerald-100 px-3 py-1.5">
              Jake · Adaptive interaction
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1.5">
              U1Si-Q · Independent authority
            </span>
          </div>
        </div>

        <div
          className="relative mx-auto flex h-56 w-56 items-center justify-center"
          role="img"
          aria-label="Grace companion orb in violet, blue, green, yellow, and white"
        >
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-violet-400/40 via-sky-300/40 to-emerald-300/40 blur-2xl" />
          <div className="absolute inset-4 rounded-full border border-white/80 bg-white/20 shadow-[inset_0_0_35px_rgba(255,255,255,.7)] backdrop-blur-2xl" />
          <div className="absolute inset-9 rounded-full bg-[radial-gradient(circle_at_30%_25%,white,rgba(167,139,250,.85)_30%,rgba(96,165,250,.75)_55%,rgba(52,211,153,.65)_78%,rgba(250,204,21,.5))] shadow-[0_0_65px_rgba(99,102,241,.3)]" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/70 bg-white/20 text-2xl font-black text-white shadow-lg backdrop-blur-md">
            G
          </div>
          <span className="absolute bottom-1 text-[10px] font-bold tracking-[.24em] text-primary">
            GRACE
          </span>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-[540px] flex-col rounded-3xl border border-line bg-white/75 p-4 shadow-sm backdrop-blur-xl sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-ink">Conversation</h2>
              <p className="text-xs text-ink-soft">
                Grace coordinates. You decide what gets shared.
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Advisory only · No actions executed
            </span>
          </div>

          <div className="flex-1 space-y-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-lavender-soft/60 p-8 text-center">
                <div
                  className="text-3xl text-primary"
                  aria-hidden="true"
                >
                  ✳
                </div>
                <p className="font-semibold text-ink">Grace is ready.</p>
                <p className="max-w-sm text-sm leading-6 text-ink-soft">
                  Choose MJ, Jake, or both. Your prompt goes only to the
                  systems selected for that turn.
                </p>
              </div>
            )}

            {turns.map((turn) => (
              <article key={turn.id} className="space-y-3">
                <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-white">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider opacity-70">
                    You
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {turn.prompt}
                  </p>
                </div>

                <div className="mr-auto max-w-full rounded-2xl rounded-bl-sm border border-line bg-white p-4 text-ink">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                    Grace
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-7">
                    {turn.answer}
                  </p>

                  {turn.note && (
                    <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">
                      {turn.note}
                    </p>
                  )}

                  {(turn.mj || turn.jake) && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {turn.mj && (
                        <div className="rounded-xl bg-sky-50 p-3">
                          <p className="mb-2 text-[10px] font-bold uppercase text-sky-800">
                            MJ · Independent assessment
                          </p>
                          <p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">
                            {turn.mj}
                          </p>
                        </div>
                      )}
                      {turn.jake && (
                        <div className="rounded-xl bg-violet-50 p-3">
                          <p className="mb-2 text-[10px] font-bold uppercase text-violet-800">
                            Jake · Independent response
                          </p>
                          <p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">
                            {turn.jake}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}

            {busy && (
              <p role="status" className="text-sm text-ink-soft">
                Grace is coordinating the selected systems…
              </p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}

          <form
            onSubmit={submit}
            className="mt-5 flex flex-col gap-3 border-t border-line pt-4"
          >
            <label
              htmlFor="grace-input"
              className="text-sm font-bold text-ink"
            >
              Your message
            </label>
            <textarea
              id="grace-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={6000}
              rows={4}
              placeholder="Write what you want Grace and the selected systems to understand…"
              className="w-full resize-y rounded-2xl border border-line bg-background px-4 py-3 text-base text-ink outline-none placeholder:text-ink-soft/70 focus-visible:ring-2 focus-visible:ring-ring"
            />

            {requiresConsent && (
              <label className="flex items-start gap-3 rounded-xl bg-lavender-soft p-3 text-xs leading-5 text-ink-soft">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-violet-700"
                />
                <span>
                  {mode === "together"
                    ? "I authorize this prompt and both current-turn specialist responses to be sent to the configured MJ model provider for joint synthesis. The provider may be remote depending on deployment configuration. This permission applies to this turn only."
                    : "I authorize this prompt to be sent to the configured MJ model provider for this turn. The provider may be remote depending on deployment configuration. This permission applies to this turn only."}
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-ink-soft">
                {input.length}/6000 ·{" "}
                {statusReady
                  ? mjConfigured
                    ? "MJ provider ready"
                    : "MJ provider not connected"
                  : "Checking provider status"}
              </span>
              <button
                type="submit"
                disabled={
                  busy ||
                  !input.trim() ||
                  (requiresConsent && !consent)
                }
                className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy
                  ? "Working…"
                  : mode === "together"
                    ? "Ask Grace and both systems"
                    : mode === "mj"
                      ? "Ask MJ through Grace"
                      : "Ask Jake through Grace"}
              </button>
            </div>
          </form>
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-3xl border border-line bg-white/75 p-5 shadow-sm">
            <h2 className="mb-3 font-bold text-ink">Choose intelligence</h2>
            <div className="grid gap-2">
              {([
                ["together", "Together", "MJ + Jake + separate synthesis"],
                ["mj", "MJ", "Reasoning, pattern analysis, investigation"],
                ["jake", "Jake", "Adaptive learning and interaction"],
              ] as const).map(([value, title, description]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeMode(value)}
                  disabled={busy}
                  aria-pressed={mode === value}
                  className={
                    "rounded-2xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 " +
                    (mode === value
                      ? "border-primary bg-primary-soft"
                      : "border-line bg-white hover:bg-lavender-soft")
                  }
                >
                  <span className="block text-sm font-bold text-ink">
                    {title}
                  </span>
                  <span className="mt-1 block text-xs text-ink-soft">
                    {description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-white/75 p-5 shadow-sm">
            <h2 className="mb-3 font-bold text-ink">Live provider status</h2>
            <div className="flex flex-wrap gap-2">
              <ProviderPill
                label="MJ"
                value={statusReady ? (mjConfigured ? "connected" : "not connected") : "checking"}
                ready={statusReady ? mjConfigured : undefined}
              />
              <ProviderPill
                label="Jake"
                value={jakeProviderLabel}
                ready={jakeProvider === "scripted" ? false : undefined}
              />
            </div>
            {jakeProvider === "scripted" && (
              <p className="mt-3 text-xs leading-5 text-amber-900">
                Jake is currently using the deterministic scripted provider,
                not live model inference. This is disclosed rather than dressed
                up as an AI response.
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-line bg-white/75 p-5 shadow-sm">
            <h2 className="mb-3 font-bold text-ink">Grace and the Bella Rules</h2>
            <ul className="space-y-3 text-xs leading-5 text-ink-soft">
              <li>
                <b className="text-ink">Dignity.</b> Communication differences
                are not defects to hide.
              </li>
              <li>
                <b className="text-ink">Autonomy.</b> You choose the systems
                and what each turn shares.
              </li>
              <li>
                <b className="text-ink">Low cognitive load.</b> Clear choices,
                plain language, and visible status.
              </li>
              <li>
                <b className="text-ink">No forced masking.</b> The interface
                does not require a single communication style.
              </li>
              <li>
                <b className="text-ink">Privacy boundaries.</b> MJ and Jake do
                not receive each other’s stored memories.
              </li>
              <li>
                <b className="text-ink">Fail safely.</b> A failed specialist
                does not become an invented answer.
              </li>
            </ul>
          </section>

          <section className="rounded-3xl border border-line bg-white/75 p-5 shadow-sm">
            <h2 className="mb-2 font-bold text-ink">What works in this build</h2>
            <p className="text-xs leading-5 text-ink-soft">
              The current interaction is keyboard-accessible text. Sign,
              speech, and AAC adapters are not connected in this build. U1Si-Q
              remains the independent authorization boundary; Grace has no
              execution authority.
            </p>
          </section>

          <p className="px-2 text-center text-[11px] leading-5 text-ink-soft">
            Intelligence interprets. Authority decides.
            <br />
            Accessibility without autonomy is not accessibility.
          </p>
        </aside>
      </section>
    </main>
  );
}
