/*
 * Card 4 — Linked students (spec §6.10): the educator's own links with
 * status, plus the request-link form. Linking is consent-gated upstream:
 * this card only ever requests; granting stays with the guardian/parent
 * side, and revocation shows up here as a status change.
 */
"use client";

import { useState } from "react";
import type { EducatorLinkDetails } from "@workspace/api-zod";
import { Button, Card, Field } from "@/components/ui";
import { formatDay } from "@/lib/format";

const STATUS_LABELS: Record<EducatorLinkDetails["status"], string> = {
  pending: "Pending consent",
  granted: "Active",
  revoked: "Revoked",
};

export function LinksCard({
  links,
  onRequest,
}: {
  links: EducatorLinkDetails[];
  onRequest: (input: { studentEmail: string }) => Promise<void>;
}) {
  const [studentEmail, setStudentEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!studentEmail.includes("@")) {
      setError("Enter the student's email address.");
      return;
    }
    setSaving(true);
    try {
      await onRequest({ studentEmail: studentEmail.trim() });
      setStudentEmail("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request the link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-extrabold text-ink">Your students</h2>
        <p className="mt-1 text-sm text-ink-soft">
          A student appears here after their parent grants your link request —
          consent always stays with the family.
        </p>
      </div>
      {links.length === 0 ? (
        <p className="text-base text-ink-soft">No links yet — request one below.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Linked students">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-lavender px-4 py-3"
            >
              <span className="font-bold text-ink">{link.student.displayName}</span>
              <span className="text-sm text-ink-soft">
                {link.student.email} ·{" "}
                <span
                  className={`font-bold ${
                    link.status === "granted"
                      ? "text-primary"
                      : link.status === "revoked"
                        ? "text-red-700"
                        : "text-ink-soft"
                  }`}
                >
                  {STATUS_LABELS[link.status]}
                </span>{" "}
                · since {formatDay(link.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 border-t border-line pt-4"
        noValidate
      >
        <h3 className="text-base font-extrabold text-ink">Request a link</h3>
        <Field
          id="link-student-email"
          label="Student email"
          type="email"
          value={studentEmail}
          onChange={(event) => setStudentEmail(event.target.value)}
          autoComplete="off"
          required
        />
        {error !== null ? (
          <p role="alert" className="text-sm font-bold text-red-700">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={saving} className="self-start">
          {saving ? "Requesting…" : "Request link"}
        </Button>
      </form>
    </Card>
  );
}
