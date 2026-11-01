/*
 * Card 9 — Profile editor (spec §6.2, §6.7): the learning record is
 * transparent and editable by the student. Subjects, pacing, and preferred
 * strategy are explicit choices the learner makes here; entries render with
 * their transparency notes (whyChanged) and can be added or removed by the
 * learner. All writes go through the API calls the page passes in — this
 * component never touches fetch.
 */
import { useId, useState, type FormEvent } from "react";
import { Button, Card, Input } from "@/components/ui";
import { formatDay } from "@/lib/format";
import type { LearningProfile, ProfileEntry } from "@workspace/api-zod";

const STRATEGY_CHOICES = [
  { value: "", label: "Let PRIMER decide (recommended)" },
  { value: "visual", label: "Pictures and diagrams" },
  { value: "step_by_step", label: "Step by step" },
  { value: "socratic", label: "Questions first" },
  { value: "example_based", label: "Worked examples" },
  { value: "practice", label: "Lots of practice" },
  { value: "adaptive_challenge", label: "Adaptive challenge" },
] as const;

const PACING_CHOICES = ["standard", "gentle", "intensive"] as const;

const ENTRY_KIND_LABELS: Record<ProfileEntry["kind"], string> = {
  gap: "Gap",
  misconception: "Misconception",
  successful_approach: "What worked",
  preference: "Preference",
  strategy_change: "Strategy change",
};

export interface ProfileEditorActions {
  onSaveProfile: (next: {
    subjects: string[];
    pacing: string;
    preferredStrategy: string | null;
  }) => void;
  onAddEntry: (next: { kind: ProfileEntry["kind"]; subject: string; detail: string }) => void;
  onDeleteEntry: (entryId: string) => void;
}

export function ProfileEditorCard({
  profile,
  entries,
  actions,
  saving,
  savingError,
}: {
  profile: LearningProfile;
  entries: ProfileEntry[];
  actions: ProfileEditorActions;
  saving: boolean;
  savingError: string | null;
}) {
  const uid = useId();
  const [subjectDraft, setSubjectDraft] = useState("");
  const [entryKind, setEntryKind] = useState<ProfileEntry["kind"]>("preference");
  const [entrySubject, setEntrySubject] = useState("");
  const [entryDetail, setEntryDetail] = useState("");

  function addSubject(formEvent: FormEvent) {
    formEvent.preventDefault();
    const next = subjectDraft.trim();
    if (!next || profile.subjects.includes(next)) return;
    actions.onSaveProfile({
      subjects: [...profile.subjects, next],
      pacing: profile.pacing,
      preferredStrategy: profile.preferredStrategy,
    });
    setSubjectDraft("");
  }

  function removeSubject(subject: string) {
    actions.onSaveProfile({
      subjects: profile.subjects.filter((s) => s !== subject),
      pacing: profile.pacing,
      preferredStrategy: profile.preferredStrategy,
    });
  }

  function addEntry(formEvent: FormEvent) {
    formEvent.preventDefault();
    const detail = entryDetail.trim();
    if (!detail) return;
    actions.onAddEntry({ kind: entryKind, subject: entrySubject.trim(), detail });
    setEntrySubject("");
    setEntryDetail("");
  }

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-extrabold text-ink">Your learning profile</h2>
        <p className="text-sm text-ink-soft">
          This is your record — you can see every note and change it. PRIMER only writes notes
          backed by real work you did.
        </p>
      </div>

      {/* Subjects — explicit picks, added and removed by the learner. */}
      <form onSubmit={addSubject} className="flex flex-col gap-2" aria-label="Add a subject">
        <label htmlFor={`${uid}-subject`} className="text-sm font-bold text-ink">
          Subjects
        </label>
        {profile.subjects.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Current subjects">
            {profile.subjects.map((subject) => (
              <li key={subject}>
                <button
                  type="button"
                  onClick={() => removeSubject(subject)}
                  className="flex items-center gap-2 rounded-full bg-lavender px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={`Remove subject ${subject}`}
                >
                  {subject}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">No subjects yet — add your first one.</p>
        )}
        <div className="flex gap-2">
          <Input
            id={`${uid}-subject`}
            value={subjectDraft}
            onChange={(e) => setSubjectDraft(e.target.value)}
            placeholder="e.g. Money math"
            maxLength={80}
          />
          <Button type="submit" disabled={saving || subjectDraft.trim().length === 0}>
            Add
          </Button>
        </div>
      </form>

      {/* Pacing + strategy — explicit learner choices (spec §6.4). */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={`${uid}-pacing`} className="text-sm font-bold text-ink">
            Pace
          </label>
          <select
            id={`${uid}-pacing`}
            value={profile.pacing}
            disabled={saving}
            onChange={(e) =>
              actions.onSaveProfile({
                subjects: profile.subjects,
                pacing: e.target.value,
                preferredStrategy: profile.preferredStrategy,
              })
            }
            className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {PACING_CHOICES.map((pacing) => (
              <option key={pacing} value={pacing}>
                {pacing[0].toUpperCase() + pacing.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={`${uid}-strategy`} className="text-sm font-bold text-ink">
            How PRIMER explains things
          </label>
          <select
            id={`${uid}-strategy`}
            value={profile.preferredStrategy ?? ""}
            disabled={saving}
            onChange={(e) =>
              actions.onSaveProfile({
                subjects: profile.subjects,
                pacing: profile.pacing,
                preferredStrategy: e.target.value === "" ? null : e.target.value,
              })
            }
            className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {STRATEGY_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* The transparent record — every entry with its note, deletable. */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-extrabold text-ink">Your learning record</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-soft">No notes in your record yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary">
                    {ENTRY_KIND_LABELS[entry.kind]}
                    {entry.subject ? ` · ${entry.subject}` : ""}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => actions.onDeleteEntry(entry.id)}
                    className="rounded-full px-3 py-1 text-xs font-bold text-danger transition-colors hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={`Remove note: ${entry.detail}`}
                  >
                    Remove
                  </button>
                </div>
                <p className="text-sm text-ink">{entry.detail}</p>
                {entry.whyChanged ? (
                  <p className="text-xs text-ink-soft">Why: {entry.whyChanged}</p>
                ) : null}
                <time
                  dateTime={new Date(entry.createdAt).toISOString()}
                  className="text-xs font-semibold text-ink-soft"
                >
                  {formatDay(entry.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Learner-authored note. Gaps/misconceptions are engine-derived; the
          form offers only the kinds a student may write about themselves. */}
      <form
        onSubmit={addEntry}
        className="flex flex-col gap-3"
        aria-label="Add a note to your record"
      >
        <h3 className="text-base font-extrabold text-ink">Add your own note</h3>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-entry-kind`} className="text-sm font-bold text-ink">
            What kind of note?
          </label>
          <select
            id={`${uid}-entry-kind`}
            value={entryKind}
            disabled={saving}
            onChange={(e) => setEntryKind(e.target.value as ProfileEntry["kind"])}
            className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="preference">A way I like to learn</option>
            <option value="successful_approach">Something that worked for me</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-entry-subject`} className="text-sm font-bold text-ink">
            Subject (optional)
          </label>
          <Input
            id={`${uid}-entry-subject`}
            value={entrySubject}
            onChange={(e) => setEntrySubject(e.target.value)}
            placeholder="e.g. Money math"
            maxLength={80}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-entry-detail`} className="text-sm font-bold text-ink">
            Your note
          </label>
          <Input
            id={`${uid}-entry-detail`}
            value={entryDetail}
            onChange={(e) => setEntryDetail(e.target.value)}
            placeholder="e.g. Pictures help me understand fractions"
            maxLength={400}
          />
        </div>
        <div>
          <Button type="submit" disabled={saving || entryDetail.trim().length === 0}>
            Add note
          </Button>
        </div>
      </form>

      {savingError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {savingError}
        </p>
      ) : null}
    </Card>
  );
}
