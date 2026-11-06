"use client";
import { FormEvent, useEffect, useState } from "react";
import { CreateSessionResponse, PostSessionTurnResponse } from "@workspace/api-zod";

type Mode = "together" | "mj" | "jake";
type TurnView = { id: string; prompt?: string; answer: string; mj?: string; jake?: string; note?: string };
async function body(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || "The request could not be completed.");
  return data;
}
async function jakeTurn(input: string, current: string | null) {
  let sessionId = current;
  if (!sessionId) {
    const created = CreateSessionResponse.parse(await body(await fetch("/api/sessions", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "U1 Instinctive Companion" }),
    })));
    sessionId = created.id;
  }
  const result = PostSessionTurnResponse.parse(await body(await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/turns`,
    { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: input }) },
  )));
  return { sessionId, answer: result.tutorTurn.content };
}
async function mjTurn(input: string) {
  const result = await body(await fetch("/api/companion/mj", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, consent: true }),
  }));
  if (typeof result.answer !== "string") throw new Error("MJ returned an invalid response.");
  return result.answer as string;
}
async function jointSynthesis(input: string, mjAssessment: string, jakeAssessment: string) {
  const result = await body(await fetch("/api/companion/synthesize", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, mjAssessment, jakeAssessment, consent: true }),
  }));
  if (typeof result.answer !== "string") throw new Error("Synthesis returned an invalid response.");
  return result.answer as string;
}

export default function CompanionPage() {
  const [mode, setMode] = useState<Mode>("together");
  const [input, setInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mjConfigured, setMjConfigured] = useState(false);
  const [jakeProvider, setJakeProvider] = useState("scripted");
  const [statusReady, setStatusReady] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<TurnView[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/companion/status", { credentials: "same-origin" })
      .then(body).then((data) => { if (active) { setMjConfigured(Boolean(data.mjProviderReady)); setJakeProvider(typeof data.jakeProvider === "string" ? data.jakeProvider : "scripted"); setStatusReady(true); } })
      .catch(() => { if (active) setStatusReady(true); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy) return;
    if (mode !== "jake" && !consent) { setError("Confirm one-turn permission to send this message to the configured MJ model provider."); return; }
    setBusy(true); setError(""); setInput("");
    const id = crypto.randomUUID();
    setTurns((old) => [...old, { id, prompt, answer: "Working…" }]);
    try {
      let answer = "";
      let mj: string | undefined;
      let jake: string | undefined;
      let note: string | undefined;
      if (mode === "jake") {
        const result = await jakeTurn(prompt, sessionId);
        setSessionId(result.sessionId); jake = result.answer; answer = jake;
      } else if (mode === "mj") {
        mj = await mjTurn(prompt); answer = mj;
      } else {
        const [m, j] = await Promise.allSettled([mjTurn(prompt), jakeTurn(prompt, sessionId)]);
        if (m.status === "fulfilled") mj = m.value;
        else note = "MJ: " + (m.reason instanceof Error ? m.reason.message : "unavailable");
        if (j.status === "fulfilled") { jake = j.value.answer; setSessionId(j.value.sessionId); }
        else note = [note, "Jake: " + (j.reason instanceof Error ? j.reason.message : "unavailable")].filter(Boolean).join(" · ");
        if (mj && jake) {
          try { answer = await jointSynthesis(prompt, mj, jake); }
          catch (e) { answer = "Both specialists responded, but synthesis failed. Their separate assessments are preserved."; note = [note, e instanceof Error ? e.message : "Synthesis unavailable"].filter(Boolean).join(" · "); }
        } else {
          answer = "A complete joint response was not possible. No combined conclusion was generated.";
        }
      }
      setTurns((old) => old.map((turn) => turn.id === id ? { ...turn, answer, mj, jake, note } : turn));
    } catch (e) {
      setTurns((old) => old.filter((turn) => turn.id !== id));
      setError(e instanceof Error ? e.message : "Turn failed. No action was executed.");
    } finally { setBusy(false); }
  }

  const requiresConsent = mode !== "jake";
  return <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-7 px-5 py-8 sm:px-8">
    <header className="flex items-center justify-between"><a href="/" className="text-sm font-extrabold tracking-[.18em] text-ink">U1 / MYELIN</a><div className="flex items-center gap-3"><span className="rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-ink-soft">INSTINCTIVE COMPANION</span><a href="/login" className="text-xs font-bold text-primary underline-offset-4 hover:underline">Sign in</a></div></header>
    <section className="grid items-center gap-6 rounded-[2rem] border border-white/70 bg-white/45 p-6 shadow-xl shadow-violet-950/5 backdrop-blur-xl md:grid-cols-[1fr_220px] md:p-9">
      <div className="flex flex-col gap-4"><p className="text-xs font-bold uppercase tracking-[.22em] text-primary">MJ × JAKE</p><h1 className="text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">One companion.<br/><span className="text-primary">Two ways to think.</span></h1><p className="max-w-xl text-base leading-7 text-ink-soft">MJ investigates, reasons, and challenges assumptions. Jake adapts the learning and interaction experience. Together, they synthesize their independent contributions.</p><div className="flex flex-wrap gap-2 text-xs text-ink-soft"><span className="rounded-full bg-violet-100 px-3 py-1.5">MJ · Instinctive Intelligence</span><span className="rounded-full bg-sky-100 px-3 py-1.5">Jake · Primer / Myelin</span><span className="rounded-full bg-amber-100 px-3 py-1.5">U1Si-Q · Authority</span></div></div>
      <div className="relative mx-auto flex h-52 w-52 items-center justify-center" aria-label="U1 companion orb"><div className="absolute inset-0 rounded-full bg-gradient-to-tr from-violet-400/40 via-sky-300/40 to-emerald-300/40 blur-2xl"/><div className="absolute inset-5 rounded-full border border-white/80 bg-white/20 shadow-[inset_0_0_35px_rgba(255,255,255,.7)] backdrop-blur-2xl"/><div className="absolute inset-10 rounded-full bg-[radial-gradient(circle_at_30%_25%,white,rgba(167,139,250,.8)_30%,rgba(96,165,250,.7)_55%,rgba(52,211,153,.6)_78%,rgba(250,204,21,.4))] shadow-[0_0_65px_rgba(99,102,241,.3)]"/><div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/70 bg-white/20 text-2xl font-black text-white shadow-lg backdrop-blur-md">U1</div><span className="absolute bottom-2 text-[10px] font-bold tracking-[.24em] text-primary">INSTINCTIVE</span></div>
    </section>
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-[520px] flex-col rounded-3xl border border-line bg-white/75 p-4 shadow-sm backdrop-blur-xl sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold text-ink">Conversation</h2><p className="text-xs text-ink-soft">Neither specialist can execute actions.</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">Advisory only</span></div>
        <div className="flex-1 space-y-4" aria-live="polite">{turns.length === 0 && <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-lavender-soft/60 p-8 text-center"><div className="text-3xl text-primary">✳</div><p className="font-semibold text-ink">Ready when you are.</p><p className="max-w-sm text-sm leading-6 text-ink-soft">Choose MJ, Jake, or Together. Your message is routed only to the systems you select.</p></div>}
          {turns.map((turn) => <article key={turn.id} className="space-y-3"><div className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-white"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider opacity-70">You</p><p className="whitespace-pre-wrap text-sm leading-6">{turn.prompt}</p></div><div className="mr-auto max-w-full rounded-2xl rounded-bl-sm border border-line bg-white p-4 text-ink"><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">U1 Companion</p><p className="whitespace-pre-wrap text-sm leading-7">{turn.answer}</p>{turn.note && <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">{turn.note}</p>}{(turn.mj || turn.jake) && <div className="mt-4 grid gap-3 sm:grid-cols-2">{turn.mj && <div className="rounded-xl bg-sky-50 p-3"><p className="mb-2 text-[10px] font-bold uppercase text-sky-800">MJ · Assessment</p><p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">{turn.mj}</p></div>}{turn.jake && <div className="rounded-xl bg-violet-50 p-3"><p className="mb-2 text-[10px] font-bold uppercase text-violet-800">Jake · Learning response</p><p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">{turn.jake}</p></div>}</div>}</div></article>)}
          {busy && <p role="status" className="text-sm text-ink-soft">Selected systems are working…</p>}
        </div>
        {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3 border-t border-line pt-4"><label htmlFor="companion-input" className="text-sm font-bold text-ink">Your message</label><textarea id="companion-input" value={input} onChange={(e) => setInput(e.target.value)} maxLength={6000} rows={4} placeholder="Tell them what you're thinking about…" className="w-full resize-y rounded-2xl border border-line bg-background px-4 py-3 text-base text-ink outline-none placeholder:text-ink-soft/70 focus-visible:ring-2 focus-visible:ring-ring"/>{requiresConsent && <label className="flex items-start gap-3 rounded-xl bg-lavender-soft p-3 text-xs leading-5 text-ink-soft"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-violet-700"/><span>{mode === "together" ? "I authorize this prompt and both current-turn specialist responses to be sent to the configured MJ model provider for joint synthesis. The provider may be remote depending on deployment configuration. This is one-turn consent only." : "I authorize this prompt to be sent to the configured MJ model provider for this turn. The provider may be remote depending on deployment configuration. This is one-turn consent only."}</span></label>}<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-ink-soft">{input.length}/6000 · {statusReady ? mjConfigured ? "MJ provider ready" : "MJ provider not ready" : "Checking MJ"}</span><button type="submit" disabled={busy || !input.trim() || (requiresConsent && !consent)} className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Working…" : mode === "together" ? "Ask both systems" : mode === "mj" ? "Ask MJ" : "Ask Jake"}</button></div></form>
      </div>
      <aside className="flex flex-col gap-4"><section className="rounded-3xl border border-line bg-white/75 p-5 shadow-sm"><h2 className="mb-3 font-bold text-ink">Choose intelligence</h2><div className="grid gap-2">{([["together","Together","MJ + Jake + synthesis"],["mj","MJ","Reasoning and investigation"],["jake","Jake","Adaptive learning and interaction"]] as const).map(([value,title,desc])=><button key={value} type="button" onClick={()=>setMode(value)} aria-pressed={mode===value} className={`rounded-2xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode===value?"border-primary bg-primary-soft":"border-line bg-white hover:bg-lavender-soft"}`}><span className="block text-sm font-bold text-ink">{title}</span><span className="mt-1 block text-xs text-ink-soft">{desc}</span></button>)}</div></section>
      <section className="rounded-3xl border border-line bg-white/75 p-5 shadow-sm"><h2 className="mb-3 font-bold text-ink">System boundaries</h2><ul className="space-y-3 text-xs leading-5 text-ink-soft"><li><b className="text-ink">Separate roles.</b> Neither receives the other's stored memories.</li><li><b className="text-ink">Explicit routing.</b> MJ is called only when selected and consented to.</li><li><b className="text-ink">No silent memory writes.</b> Jake's turns are stored in Myelin. MJ's durable learning is not enabled here.</li><li><b className="text-ink">No execution authority.</b> Responses cannot approve or perform consequential actions.</li><li><b className="text-ink">Accessibility.</b> Keyboard-accessible text interface. Sign, speech, and AAC adapters remain future integration work.</li></ul></section><p className="px-2 text-center text-[11px] leading-5 text-ink-soft">Intelligence recommends. Authority decides.<br/>Accessibility first. Always.</p></aside>
    </section>
  </main>;
}
