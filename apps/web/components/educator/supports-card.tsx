/*
 * Card 3 — Supports configuration (spec §6.10): read and edit the selected
 * student's supports. A support is a short instruction ("prefer visuals",
 * "chunk multi-step problems") the tutoring engine may use — it is not a
 * diagnosis and this card never offers diagnosis-shaped fields.
 */
"use client";

import { useEffect, useState } from "react";
import { Button, Card, Field } from "@/components/ui";

export function SupportsCard({
  studentId,
  studentName,
  supports,
  notes,
  loading,
  saving,
  onSave,
  onReload,
}: {
  studentId: string | null;
  studentName: string | null;
  supports: string[];
  notes: string | null;
  loading: boolean;
  saving: boolean;
  onSave: (input: { supports: string[]; notes: string | null }) => Promise<void>;
  onReload: (studentId: string) => void;
}) {
  const [supportsText, setSupportsText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever the selected student or a reload lands new data.
  useEffect(() => {
    setSupportsText(supports.join(", "));
    setNotesText(notes ?? "");
  }, [studentId, supports, notes]);

  if (studentId === null) {
    return (
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-extrabold text-ink">Supports</h2>
        <p className="text-base text-ink-soft">
          Choose a student in the gap report to view or edit their supports.
        </p>
      </Card>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        supports: supportsText
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== ""),
        notes: notesText.trim() === "" ? null : notesText.trim(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the supports.");
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-extrabold text-ink">Supports for {studentName}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Short instructions the tutor can follow — for example &ldquo;prefer
          pictures&rdquo; or &ldquo;chunk multi-step problems&rdquo;. Supports
          are strategies, never diagnoses.
        </p>
      </div>
      {loading ? (
        <p role="status" className="text-base text-ink-soft">
          Loading supports…
        </p>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3"
          noValidate
          aria-label={`Supports for ${studentName ?? "student"}`}
        >
          <Field
            id="supports-list"
            label="Supports (comma-separated)"
            value={supportsText}
            onChange={(event) => setSupportsText(event.target.value)}
            autoComplete="off"
          />
          <Field
            id="supports-notes"
            label="Notes for you (optional)"
            value={notesText}
            onChange={(event) => setNotesText(event.target.value)}
            autoComplete="off"
          />
          {error !== null ? (
            <p role="alert" className="text-sm font-bold text-red-700">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save supports"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onReload(studentId)}>
              Reset
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
