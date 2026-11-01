"use client";

/*
 * Parent dashboard (spec §6.9) — the orchestrator. Identity comes from
 * /auth/me; the roster comes from /parent/students; the selected learner's
 * three views (mastery, session summaries, at-home activities) load in
 * parallel from the consent-gated parent routes. The surface is read-only
 * by construction — there is no write call in lib/api-client's parent
 * section, mirroring the server-side boundary the route tests pin.
 *
 * Every state off the happy path renders honestly: loading, signed-out,
 * non-parent roles, load errors, revoked-consent denials, and each view's
 * own empty state.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AtHomeActivity,
  AuthUser,
  ParentMasteryOverview,
  ParentSessionSummary,
  ParentStudent,
} from "@workspace/api-zod";
import { FamilyRosterCard } from "@/components/parent/family-roster-card";
import { ParentActivitiesCard } from "@/components/parent/parent-activities-card";
import { ParentMasteryCard } from "@/components/parent/parent-mastery-card";
import { ParentSessionsCard } from "@/components/parent/parent-sessions-card";
import { Button, Card } from "@/components/ui";
import {
  ApiError,
  getParentMasteryOverview,
  getCurrentUser,
  listAtHomeActivities,
  listParentSessionSummaries,
  listParentStudents,
  logout,
} from "@/lib/api-client";

type LoadState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "wrong-role"; role: AuthUser["role"] }
  | { phase: "error"; message: string }
  | { phase: "ready"; roster: ParentStudent[] };

type ViewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "denied" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      mastery: ParentMasteryOverview;
      sessions: ParentSessionSummary[];
      activities: AtHomeActivity[];
    };

function deniedMessage(displayName: string): string {
  return `Family access isn't active for ${displayName} right now — summaries reappear when consent is granted again.`;
}

export default function ParentDashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ phase: "idle" });

  const loadRoster = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const me = await getCurrentUser();
      const user = me.user;
      if (user.role !== "parent") {
        setState({ phase: "wrong-role", role: user.role });
        return;
      }
      const roster = await listParentStudents();
      setState({ phase: "ready", roster: roster.students });
      const firstGranted = roster.students.find((s) => s.accessGranted) ?? null;
      setSelectedStudentId(firstGranted?.id ?? null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ phase: "signed-out" });
        return;
      }
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }, []);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const loadViews = useCallback(async (studentId: string) => {
    setViewState({ phase: "loading" });
    try {
      const [mastery, sessions, activities] = await Promise.all([
        getParentMasteryOverview(studentId),
        listParentSessionSummaries(studentId),
        listAtHomeActivities(studentId),
      ]);
      setViewState({
        phase: "ready",
        mastery: mastery,
        sessions: sessions.sessions,
        activities: activities.activities,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        // Consent was revoked (or never granted) between roster load and
        // view fetch — say so plainly instead of a generic error.
        setViewState({ phase: "denied" });
        return;
      }
      setViewState({
        phase: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }, []);

  useEffect(() => {
    if (selectedStudentId !== null) void loadViews(selectedStudentId);
    else setViewState({ phase: "idle" });
  }, [selectedStudentId, loadViews]);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      // The cookie is cleared server-side; navigate regardless.
      router.push("/login");
      router.refresh();
    }
  }

  function handleRetry() {
    if (selectedStudentId !== null) void loadViews(selectedStudentId);
    else void loadRoster();
  }

  if (state.phase === "loading") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 p-6">
        <h1 className="sr-only">Family dashboard</h1>
        <Card className="flex flex-col items-center gap-3">
          <p role="status" className="text-base font-bold text-ink">
            Loading your family dashboard…
          </p>
        </Card>
      </main>
    );
  }

  if (state.phase === "signed-out") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center justify-center gap-4 p-6">
        <Card className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">Please sign in</h1>
          <p className="text-base text-ink-soft">
            Your family dashboard is waiting right after you sign in.
          </p>
          <Button type="button" onClick={() => router.push("/login")}>
            Go to sign in
          </Button>
        </Card>
      </main>
    );
  }

  if (state.phase === "wrong-role") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center justify-center gap-4 p-6">
        <Card className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">This space is for families</h1>
          <p className="text-base text-ink-soft">
            You are signed in as a {state.role}. Learner and educator spaces live elsewhere.
          </p>
          <Button
            type="button"
            onClick={() => router.push(state.role === "student" ? "/dashboard" : "/")}
          >
            {state.role === "student" ? "Go to your dashboard" : "Back to start"}
          </Button>
        </Card>
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center justify-center gap-4 p-6">
        <Card className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-extrabold text-ink">We couldn&apos;t load your dashboard</h1>
          <p className="text-base text-ink-soft">{state.message}</p>
          <Button type="button" onClick={() => void loadRoster()}>
            Try again
          </Button>
        </Card>
      </main>
    );
  }

  const { roster } = state;
  const selectedStudent =
    selectedStudentId !== null
      ? (roster.find((s) => s.id === selectedStudentId) ?? null)
      : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold text-ink">PRIMER</h1>
        <Button variant="ghost" type="button" onClick={() => void handleLogout()}>
          Sign out
        </Button>
      </header>

      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-extrabold text-ink">Family dashboard</h2>
        <p className="text-base text-ink-soft">
          A quiet window on {roster.length === 1 ? "your learner" : "your learners"} — progress
          and encouragement, never transcripts or monitoring.
        </p>
      </Card>

      {roster.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-xl font-extrabold text-ink">No learners linked yet</h2>
          <p className="text-base text-ink-soft">
            When your child&apos;s account links to yours with recorded consent, their summaries
            appear here.
          </p>
        </Card>
      ) : (
        <>
          <FamilyRosterCard
            students={roster}
            selectedStudentId={selectedStudentId}
            onSelect={setSelectedStudentId}
          />

          {viewState.phase === "loading" ? (
            <Card>
              <p role="status" className="text-base font-bold text-ink">
                Loading summaries…
              </p>
            </Card>
          ) : null}

          {viewState.phase === "denied" ? (
            <Card>
              <p className="text-base font-bold text-ink">Consent isn&apos;t active</p>
              <p className="text-base text-ink-soft">
                {selectedStudent !== null
                  ? deniedMessage(selectedStudent.displayName)
                  : "Family access isn't active for this learner right now."}
              </p>
            </Card>
          ) : null}

          {viewState.phase === "error" ? (
            <Card>
              <p className="text-base font-bold text-ink">We couldn&apos;t load the summaries</p>
              <p className="text-base text-ink-soft">{viewState.message}</p>
              <Button type="button" onClick={handleRetry}>
                Try again
              </Button>
            </Card>
          ) : null}

          {viewState.phase === "ready" && selectedStudent !== null ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ParentMasteryCard overview={viewState.mastery} />
              <ParentSessionsCard summaries={viewState.sessions} />
              <ParentActivitiesCard activities={viewState.activities} />
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
