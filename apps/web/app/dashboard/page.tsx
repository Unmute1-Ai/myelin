"use client";

/*
 * Student dashboard (spec §6.7) — the orchestrator. Identity comes from
 * /auth/me (401 → sign-in state); data comes from the profile, progress,
 * session, and accessibility routes through the typed client in
 * lib/api-client. Components are presentational and receive contract-typed
 * props; every state off the happy path (loading, signed-out, wrong-role,
 * load error, and each card's empty state) renders honestly.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser, LearningProfile, ProfileEntry, ProgressEvent, TutoringSession } from "@workspace/api-zod";
import { AccessibilitySettingsCard } from "@/components/dashboard/accessibility-settings-card";
import { ContinueLearningCard } from "@/components/dashboard/continue-learning-card";
import { LearningObjectivesCard } from "@/components/dashboard/learning-objectives-card";
import { MascotWelcomeCard } from "@/components/dashboard/mascot-welcome-card";
import { MasteryEvidenceCard } from "@/components/dashboard/mastery-evidence-card";
import { ProgressTimelineCard } from "@/components/dashboard/progress-timeline-card";
import { ProfileEditorCard } from "@/components/dashboard/profile-editor-card";
import { RecentSessionsCard } from "@/components/dashboard/recent-sessions-card";
import { RecommendedActivitiesCard } from "@/components/dashboard/recommended-activities-card";
import { SubjectListCard } from "@/components/dashboard/subject-list-card";
import { Button, Card } from "@/components/ui";
import {
  createProfileEntry,
  deleteProfileEntry,
  getCurrentUser,
  getStudentProfile,
  listProgressEvents,
  listSessions,
  logout,
  updateLearningProfile,
  ApiError,
} from "@/lib/api-client";
import {
  deriveLearningObjectives,
  deriveMasteryLadder,
  deriveRecommendations,
  findResumeSession,
} from "@/lib/dashboard-data";

type LoadState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "wrong-role"; role: AuthUser["role"] }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      user: AuthUser;
      profile: LearningProfile;
      entries: ProfileEntry[];
      events: ProgressEvent[];
      sessions: TutoringSession[];
    };

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const me = await getCurrentUser();
      const user = me.user;
      if (user.role !== "student") {
        setState({ phase: "wrong-role", role: user.role });
        return;
      }
      // The learner's own data, in parallel — profile, timeline, sessions.
      // Accessibility preferences load through the app-wide provider, not here.
      const [studentProfile, progress, sessions] = await Promise.all([
        getStudentProfile(user.id),
        listProgressEvents(user.id),
        listSessions({ limit: 10 }),
      ]);
      setState({
        phase: "ready",
        user,
        profile: studentProfile.profile,
        entries: studentProfile.entries,
        events: progress.events,
        sessions: sessions.sessions,
      });
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
    void loadData();
  }, [loadData]);

  // One save path: set saving state, run the call, apply the result, surface
  // any failure — never a silent catch.
  const runSave = useCallback(
    async (call: () => Promise<unknown>, onSuccess: (saved: unknown) => void) => {
      setSaving(true);
      setSaveError(null);
      try {
        const saved = await call();
        onSuccess(saved);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Saving didn't work — try again.");
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  function handleSaveProfile(next: {
    subjects: string[];
    pacing: string;
    preferredStrategy: string | null;
  }) {
    if (state.phase !== "ready") return;
    const snapshot = state;
    void runSave(
      () => updateLearningProfile(snapshot.profile.studentId, next),
      (saved) => {
        const response = saved as { profile: LearningProfile; entries: ProfileEntry[] };
        setState({ ...snapshot, profile: response.profile, entries: response.entries });
      },
    );
  }

  function handleAddEntry(next: { kind: ProfileEntry["kind"]; subject: string; detail: string }) {
    if (state.phase !== "ready") return;
    const snapshot = state;
    void runSave(
      () =>
        createProfileEntry(snapshot.profile.studentId, {
          kind: next.kind,
          subject: next.subject.length > 0 ? next.subject : null,
          detail: next.detail,
        }),
      (saved) => {
        const response = saved as { entry: ProfileEntry };
        setState({ ...snapshot, entries: [...snapshot.entries, response.entry] });
      },
    );
  }

  function handleDeleteEntry(entryId: string) {
    if (state.phase !== "ready") return;
    const snapshot = state;
    void runSave(
      () => deleteProfileEntry(snapshot.profile.studentId, entryId),
      () => {
        setState({
          ...snapshot,
          entries: snapshot.entries.filter((e) => e.id !== entryId),
        });
      },
    );
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      // The cookie is cleared server-side; navigate regardless.
      router.push("/login");
      router.refresh();
    }
  }

  const objectives = useMemo(
    () => (state.phase === "ready" ? deriveLearningObjectives(state.profile, state.entries) : []),
    [state],
  );
  const ladder = useMemo(
    () => (state.phase === "ready" ? deriveMasteryLadder(state.events) : null),
    [state],
  );
  const recommendations = useMemo(
    () => (state.phase === "ready" ? deriveRecommendations(state.profile, state.entries) : []),
    [state],
  );
  const resume = useMemo(
    () => (state.phase === "ready" ? findResumeSession(state.sessions) : null),
    [state],
  );

  if (state.phase === "loading") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 p-6">
        <h1 className="sr-only">Your PRIMER dashboard</h1>
        <Card className="flex flex-col items-center gap-3">
          <p role="status" className="text-base font-bold text-ink">
            Loading your dashboard…
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
          <p className="text-base text-ink-soft">Your dashboard is waiting right after you sign in.</p>
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
          <h1 className="text-2xl font-extrabold text-ink">This space is for students</h1>
          <p className="text-base text-ink-soft">
            You are signed in as a {state.role}. Family and educator views arrive in their own
            release waves.
          </p>
          <Button type="button" onClick={() => void handleLogout()}>
            Sign out
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
          <Button type="button" onClick={() => void loadData()}>
            Try again
          </Button>
        </Card>
      </main>
    );
  }

  // Ready — the ten components, two-column on wide screens, single on mobile.
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold text-ink">PRIMER</h1>
        <Button variant="ghost" type="button" onClick={() => void handleLogout()}>
          Sign out
        </Button>
      </header>

      <MascotWelcomeCard displayName={state.user.displayName} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LearningObjectivesCard objectives={objectives} />
        <ContinueLearningCard session={resume} />
        <SubjectListCard subjects={state.profile.subjects} />
        <ProgressTimelineCard events={state.events} />
        {ladder ? <MasteryEvidenceCard ladder={ladder} /> : null}
        <RecommendedActivitiesCard recommendations={recommendations} />
        <RecentSessionsCard sessions={state.sessions} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProfileEditorCard
          profile={state.profile}
          entries={state.entries}
          actions={{
            onSaveProfile: handleSaveProfile,
            onAddEntry: handleAddEntry,
            onDeleteEntry: handleDeleteEntry,
          }}
          saving={saving}
          savingError={saveError}
        />
        <AccessibilitySettingsCard />
      </div>
    </main>
  );
}
