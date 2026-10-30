import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  useConfirmTutorAction,
  useCreateTutorSession,
  useSendTutorTurn,
  type TutorProgress,
  type TutorProposedAction,
} from "@workspace/api-client-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toPlaceholderGloss } from "./gloss";
import { useSpeech } from "./useSpeech";

type Entry =
  | { id: number; role: "learner"; text: string }
  | { id: number; role: "tutor"; text: string; spoken: string | null }
  | { id: number; role: "system"; text: string };

type SessionStatus =
  | { phase: "starting" }
  | { phase: "ready"; sessionId: string }
  | { phase: "ended" }
  | { phase: "failed"; message: string };

type PendingProposal = {
  action: TutorProposedAction;
  checkLine: string;
};

/** The contract's error message when the API sent one; a plain line otherwise. */
function tutorErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const data = error.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
  }
  return "The tutor couldn't reply just now. Try again in a moment.";
}

const ACTION_LABELS: Record<TutorProposedAction, string> = {
  advance_step: "Moving to the next micro-step",
  mark_mastered: "Marking the lesson mastered",
  assign_practice: "Assigning practice",
};

export default function PrimerPage() {
  const [session, setSession] = useState<SessionStatus>({ phase: "starting" });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [progress, setProgress] = useState<TutorProgress | null>(null);
  const [pending, setPending] = useState<PendingProposal | null>(null);
  const [input, setInput] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);

  const nextEntryId = useRef(1);
  const voiceOnRef = useRef(false);
  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);

  const { speak, cancel, supported: speechSupported, speaking } = useSpeech();

  const createSession = useCreateTutorSession();
  const sendTurn = useSendTutorTurn();
  const confirmAction = useConfirmTutorAction();
  const createSessionMutate = createSession.mutate;
  const sendTurnMutate = sendTurn.mutate;
  const confirmMutate = confirmAction.mutate;

  const appendTutor = useCallback(
    (text: string, spoken: string | null) => {
      setEntries((prev) => [
        ...prev,
        { id: nextEntryId.current++, role: "tutor", text, spoken },
      ]);
      if (spoken !== null && spoken.trim() !== "" && voiceOnRef.current) {
        speak(spoken);
      }
    },
    [speak],
  );

  const startSession = useCallback(() => {
    setEntries([]);
    setProgress(null);
    setPending(null);
    setSession({ phase: "starting" });
    createSessionMutate(undefined, {
      onSuccess: (created) => {
        setSession({ phase: "ready", sessionId: created.sessionId });
      },
      onError: () => {
        setSession({
          phase: "failed",
          message:
            "Primer couldn't reach the tutor service. Start the API server, then try again.",
        });
      },
    });
  }, [createSessionMutate]);

  useEffect(() => {
    startSession();
  }, [startSession]);

  const handleTurnError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) {
      setSession({ phase: "ended" });
      return;
    }
    setEntries((prev) => [
      ...prev,
      { id: nextEntryId.current++, role: "system", text: tutorErrorMessage(error) },
    ]);
  }, []);

  const turn = useCallback(
    (rawInput: string) => {
      if (session.phase !== "ready") return;
      const text = rawInput.trim();
      if (text === "") return;

      const sessionId = session.sessionId;
      setEntries((prev) => [
        ...prev,
        { id: nextEntryId.current++, role: "learner", text },
      ]);
      setInput("");
      sendTurnMutate(
        { data: { sessionId, input: text } },
        {
          onSuccess: (response) => {
            setProgress(response.progress);
            appendTutor(response.reply, response.spoken);
            // Sentinel: a proposal is pending state, nothing more. The only
            // execution path is an explicit confirm below.
            if (
              response.proposedAction !== undefined &&
              response.checkLine !== undefined
            ) {
              setPending({
                action: response.proposedAction,
                checkLine: response.checkLine,
              });
            }
          },
          onError: handleTurnError,
        },
      );
    },
    [session, sendTurnMutate, appendTutor, handleTurnError],
  );

  const resolvePending = useCallback(
    (accepted: boolean) => {
      if (session.phase !== "ready" || pending === null) return;
      const sessionId = session.sessionId;
      setPending(null);
      confirmMutate(
        { data: { sessionId, accepted } },
        {
          onSuccess: (response) => {
            setProgress(response.progress);
            appendTutor(response.reply, response.spoken);
          },
          onError: (error) => {
            // 409: the pending action was already consumed — the dialog was
            // stale. Anything else surfaces through the transcript.
            handleTurnError(error);
          },
        },
      );
    },
    [session, pending, confirmMutate, appendTutor, handleTurnError],
  );

  const onVoiceChange = useCallback(
    (checked: boolean) => {
      setVoiceOn(checked);
      if (!checked) {
        cancel();
        return;
      }
      // Prove the toggle works immediately: speak the last spoken line.
      const lastSpoken = [...entries]
        .reverse()
        .find((e) => e.role === "tutor" && e.spoken !== null);
      if (lastSpoken && lastSpoken.role === "tutor" && lastSpoken.spoken) {
        speak(lastSpoken.spoken);
      }
    },
    [entries, speak, cancel],
  );

  // Keep the newest message in view.
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = transcriptRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport !== null && viewport !== undefined) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [entries, session.phase]);

  const lastTutor = [...entries].reverse().find((e) => e.role === "tutor");
  const lastSpokenText =
    lastTutor && lastTutor.role === "tutor"
      ? (lastTutor.spoken ?? lastTutor.text)
      : null;
  const gloss = lastSpokenText !== null ? toPlaceholderGloss(lastSpokenText) : null;

  const canSend =
    session.phase === "ready" && !sendTurn.isPending && input.trim() !== "";

  const progressLabel = (() => {
    if (progress === null) return "";
    if (progress.mastered) return "Mastered";
    if (progress.lessonComplete) return "Lesson complete";
    return `Step ${progress.stepIndex + 1} of ${progress.totalSteps}`;
  })();
  const progressValue =
    progress === null
      ? 0
      : progress.mastered || progress.lessonComplete
        ? 100
        : ((progress.stepIndex + 1) / progress.totalSteps) * 100;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Primer</h1>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline">Type in</Badge>
              <Badge variant="outline">
                {speaking ? "Voice — speaking…" : voiceOn ? "Voice on" : "Voice off"}
              </Badge>
              <Badge variant="outline">Sign gloss</Badge>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            The tutor that meets you how you communicate. Type however you like —
            Primer works with what you mean, not how it's phrased.
          </p>
        </header>

        {progress !== null && (
          <div className="flex items-center gap-3">
            <Progress
              value={progressValue}
              className="flex-1"
              aria-label="Lesson progress"
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {progressLabel}
            </span>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <ScrollArea ref={transcriptRef} className="h-[420px]">
              <div className="flex flex-col gap-3 p-4">
                {entries.length === 0 && session.phase === "ready" && (
                  <p className="pt-8 text-center text-sm text-muted-foreground">
                    Start however you like — "hi", a half-formed question, or
                    dive straight in.
                  </p>
                )}
                {entries.map((entry) =>
                  entry.role === "learner" ? (
                    <div key={entry.id} className="flex justify-end">
                      <p className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                        {entry.text}
                      </p>
                    </div>
                  ) : entry.role === "tutor" ? (
                    <div key={entry.id} className="flex justify-start">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
                        {entry.text}
                      </p>
                    </div>
                  ) : (
                    <p
                      key={entry.id}
                      className="px-2 text-center text-xs italic text-muted-foreground"
                    >
                      {entry.text}
                    </p>
                  ),
                )}
                {session.phase === "starting" && (
                  <p className="pt-8 text-center text-sm animate-pulse text-muted-foreground">
                    Starting your session…
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {session.phase === "ready" && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              turn(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="type however you like"
              aria-label="Message to Primer"
              disabled={sendTurn.isPending}
            />
            <Button type="submit" disabled={!canSend}>
              {sendTurn.isPending ? "Thinking…" : "Send"}
            </Button>
          </form>
        )}

        {session.phase === "failed" && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 p-4 text-center">
            <p className="text-sm">{session.message}</p>
            <Button variant="outline" onClick={startSession}>
              Try again
            </Button>
          </div>
        )}

        {session.phase === "ended" && (
          <div className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center">
            <p className="text-sm">This session has ended — nothing was saved.</p>
            <Button variant="outline" onClick={startSession}>
              Start a new session
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch
            id="primer-voice"
            checked={voiceOn}
            onCheckedChange={onVoiceChange}
            disabled={!speechSupported}
          />
          <Label htmlFor="primer-voice" className="text-sm">
            Speak replies aloud
          </Label>
          {!speechSupported && (
            <span className="text-xs text-muted-foreground">
              Speech isn't available in this browser.
            </span>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sign panel</CardTitle>
            <CardDescription className="text-xs">
              Placeholder — a rough word sketch, not real ASL gloss. No sign
              video exists yet; the captions below carry the spoken line.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="font-mono text-sm tracking-wide" aria-live="polite">
              {gloss !== null && gloss !== "" ? `GLOSS: ${gloss}` : "—"}
            </p>
            <p className="text-sm text-muted-foreground">
              {lastSpokenText ?? "Spoken captions appear here."}
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Session-only: nothing is saved anywhere, and this session ends when
          you close the tab. Refreshing starts a fresh one.
        </p>
      </div>

      {pending !== null && (
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>One quick check</AlertDialogTitle>
              <AlertDialogDescription>
                {pending.checkLine}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="text-xs text-muted-foreground">
              {ACTION_LABELS[pending.action]} — nothing happens until you
              confirm, and confirming once is all it takes.
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => resolvePending(false)}>
                Not yet
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => resolvePending(true)}>
                Yes, do it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
