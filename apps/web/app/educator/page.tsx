"use client";

/*
 * Educator dashboard (spec §6.10) — the orchestrator. Identity comes from
 * /auth/me (401 → sign-in state); data comes from the educator-scoped
 * routes (students rollup, links, assignments, supports) through the typed
 * client in lib/api-client. The server enforces the granted-link boundary
 * and the authorization layer; this page renders only what the API
 * returned and renders honestly off the happy path (loading, signed-out,
 * wrong-role, load error, each card's empty state).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser, EducatorAssignment, EducatorLinkDetails } from "@workspace/api-zod";
import { AccessibilitySettingsCard } from "@/components/dashboard/accessibility-settings-card";
import { AssignmentsCard } from "@/components/educator/assignments-card";
import { ClassRollupCard } from "@/components/educator/class-rollup-card";
import { LinksCard } from "@/components/educator/links-card";
import { SupportsCard } from "@/components/educator/supports-card";
import { Button, Card } from "@/components/ui";
import {
  ApiError,
  createEducatorAssignment,
  createEducatorLink,
  getCurrentUser,
  getEducatorSupports,
  listEducatorAssignments,
  listEducatorLinks,
  listEducatorStudents,
  logout,
  updateEducatorSupports,
} from "@/lib/api-client";
import { deriveClassOverview, summarizeClass } from "@/lib/educator-data";

type LoadState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "wrong-role"; role: AuthUser["role"] }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      user: AuthUser;
      students: Awaited<ReturnType<typeof listEducatorStudents>>["students"];
      links: EducatorLinkDetails[];
      assignments: EducatorAssignment[];
    };

interface SupportsState {
  loading: boolean;
  supports: string[];
  notes: string | null;
}

const INITIAL_SUPPORTS: SupportsState = { loading: false, supports: [], notes: null };

export default function EducatorPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentName, setSelectedStudentName] = useState<string | null>(null);
  const [supports, setSupports] = useState<SupportsState>(INITIAL_SUPPORTS);
  const [savingSupports, setSavingSupports] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const me = await getCurrentUser();
      const user = me.user;
      if (user.role !== "educator") {
        setState({ phase: "wrong-role", role: user.role });
        return;
      }
      const [students, links, assignments] = await Promise.all([
        listEducatorStudents(),
        listEducatorLinks(),
        listEducatorAssignments(),
      ]);
      setState({
        phase: "ready",
        user,
        students: students.students,
        links: links.links,
        assignments: assignments.assignments,
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

  const selectStudent = useCallback(async (studentId: string, displayName: string) => {
    setSelectedStudentId(studentId);
    setSelectedStudentName(displayName);
    setSupports({ loading: true, supports: [], notes: null });
    try {
      const response = await getEducatorSupports(studentId);
      setSupports({ loading: false, supports: response.supports, notes: response.notes });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ phase: "signed-out" });
        return;
      }
      setSupports({ loading: false, supports: [], notes: null });
      setSaveError(
        error instanceof Error ? error.message : "Could not load this student's supports.",
      );
    }
  }, []);

  function handleSelect(studentId: string) {
    if (state.phase !== "ready") return;
    const row = state.students.find((student) => student.studentId === studentId);
    void selectStudent(studentId, row?.displayName ?? "student");
  }

  async function handleCreateAssignment(input: {
    title: string;
    subject: string;
    detail: string | null;
    studentId: string;
  }) {
    if (state.phase !== "ready") return;
    const snapshot = state;
    await createEducatorAssignment({
      title: input.title,
      subject: input.subject,
      // Contract optionals are undefined-able, not nullable — an empty
      // detail is omitted, never sent as null.
      ...(input.detail === null ? {} : { detail: input.detail }),
      studentId: input.studentId,
    });
    // Re-read the list so server-side fields (ids, timestamps, status) win
    // over any locally stitched guess.
    const refreshed = await listEducatorAssignments();
    setState({ ...snapshot, assignments: refreshed.assignments });
  }

  async function handleSaveSupports(input: { supports: string[]; notes: string | null }) {
    if (selectedStudentId === null) return;
    setSavingSupports(true);
    setSaveError(null);
    try {
      const response = await updateEducatorSupports(selectedStudentId, {
        supports: input.supports,
        notes: input.notes,
      });
      setSupports({ loading: false, supports: response.supports, notes: response.notes });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ phase: "signed-out" });
        return;
      }
      throw error;
    } finally {
      setSavingSupports(false);
    }
  }

  async function handleRequestLink(input: { studentEmail: string }) {
    if (state.phase !== "ready") return;
    const snapshot = state;
    await createEducatorLink({ studentEmail: input.studentEmail });
    const refreshed = await listEducatorLinks();
    setState({ ...snapshot, links: refreshed.links });
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

  const rows = useMemo(
    () => (state.phase === "ready" ? deriveClassOverview(state.students, state.assignments) : []),
    [state],
  );
  const summary = useMemo(() => summarizeClass(rows), [rows]);

  if (state.phase === "loading") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 p-6">
        <h1 className="sr-only">Your PRIMER educator dashboard</h1>
        <Card className="flex flex-col items-center gap-3">
          <p role="status" className="text-base font-bold text-ink">
            Loading your class…
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
          <p className="text-base text-ink-soft">Your class view is waiting right after you sign in.</p>
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
          <h1 className="text-2xl font-extrabold text-ink">This space is for educators</h1>
          <p className="text-base text-ink-soft">
            You are signed in as a {state.role}. Students have their own dashboard; families have
            theirs.
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
          <h1 className="text-2xl font-extrabold text-ink">We couldn&apos;t load your class</h1>
          <p className="text-base text-ink-soft">{state.message}</p>
          <Button type="button" onClick={() => void loadData()}>
            Try again
          </Button>
        </Card>
      </main>
    );
  }

  // Ready — cards in a responsive grid; supports follow the selected student.
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-ink">PRIMER</h1>
          <p className="text-sm text-ink-soft" aria-live="polite">
            {summary.totalStudents} linked {summary.totalStudents === 1 ? "student" : "students"} ·{" "}
            {summary.studentsWithGaps} with recorded gaps · {summary.totalGaps} gaps in total
          </p>
        </div>
        <Button variant="ghost" type="button" onClick={() => void handleLogout()}>
          Sign out
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ClassRollupCard rows={rows} selectedStudentId={selectedStudentId} onSelect={handleSelect} />
        <SupportsCard
          studentId={selectedStudentId}
          studentName={selectedStudentName}
          supports={supports.supports}
          notes={supports.notes}
          loading={supports.loading}
          saving={savingSupports}
          onSave={handleSaveSupports}
          onReload={(studentId) => handleSelect(studentId)}
        />
        <AssignmentsCard
          assignments={state.assignments}
          links={state.links}
          onCreate={handleCreateAssignment}
        />
        <LinksCard links={state.links} onRequest={handleRequestLink} />
        <AccessibilitySettingsCard />
      </div>

      {saveError !== null ? (
        <p role="alert" className="text-sm font-bold text-red-700">
          {saveError}
        </p>
      ) : null}
    </main>
  );
}
