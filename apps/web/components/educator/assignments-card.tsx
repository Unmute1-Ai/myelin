/*
 * Card 2 — Learning objectives & assignments (spec §6.10): open assignments
 * as the objective list, plus the create-assignment form. Every assignment
 * targets exactly one linked student (contract: studentId is required), so
 * the educator picks the student — class-wide work is one assignment per
 * student, never a null target.
 */
"use client";

import { useState } from "react";
import type { EducatorAssignment, EducatorLinkDetails } from "@workspace/api-zod";
import { Button, Card, Field } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { deriveObjectives } from "@/lib/educator-data";

export function AssignmentsCard({
  assignments,
  links,
  onCreate,
}: {
  assignments: EducatorAssignment[];
  links: EducatorLinkDetails[];
  onCreate: (input: {
    title: string;
    subject: string;
    detail: string | null;
    studentId: string;
  }) => Promise<void>;
}) {
  const objectives = deriveObjectives(assignments);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [detail, setDetail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const grantedStudents = links.filter((link) => link.status === "granted");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (title.trim() === "" || subject.trim() === "") {
      setError("Give the assignment a title and a subject.");
      return;
    }
    if (studentId === "") {
      setError("Choose the student this assignment is for.");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        subject: subject.trim(),
        detail: detail.trim() === "" ? null : detail.trim(),
        studentId,
      });
      setTitle("");
      setSubject("");
      setDetail("");
      setStudentId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the assignment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-extrabold text-ink">Learning objectives</h2>
        <p className="mt-1 text-sm text-ink-soft">Open assignments, newest first.</p>
      </div>
      {objectives.length === 0 ? (
        <p className="text-base text-ink-soft">
          No open assignments yet — set the first objective below.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Open assignments">
          {objectives.map((objective) => (
            <li key={objective.id} className="rounded-2xl bg-lavender px-4 py-3">
              <p className="font-bold text-ink">{objective.title}</p>
              <p className="text-sm text-ink-soft">
                {objective.subject ?? "General"} · set {formatDay(objective.createdAt)}
              </p>
              {objective.detail !== null ? (
                <p className="mt-1 text-sm text-ink">{objective.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 border-t border-line pt-4"
        noValidate
      >
        <h3 className="text-base font-extrabold text-ink">New assignment</h3>
        <Field
          id="assignment-title"
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoComplete="off"
          required
        />
        <Field
          id="assignment-subject"
          label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          autoComplete="off"
          required
        />
        <Field
          id="assignment-detail"
          label="What to practice (optional)"
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          autoComplete="off"
        />
        <label
          className="flex flex-col gap-1 text-sm font-bold text-ink"
          htmlFor="assignment-student"
        >
          Assign to
          <select
            id="assignment-student"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-base font-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="" disabled>
              Choose a student
            </option>
            {grantedStudents.map((link) => (
              <option key={link.studentId} value={link.studentId}>
                {link.student.displayName}
              </option>
            ))}
          </select>
        </label>
        {error !== null ? (
          <p role="alert" className="text-sm font-bold text-red-700">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={saving} className="self-start">
          {saving ? "Saving…" : "Assign"}
        </Button>
      </form>
    </Card>
  );
}
