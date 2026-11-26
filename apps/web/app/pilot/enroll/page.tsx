"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Field } from "@/components/ui";
import { PilotApiError, pilotEnroll } from "@/lib/pilot-api";

/*
 * Pilot enrollment (U1Si-Q pilot). Accessibility contract for this page:
 * every control is labeled and keyboard-reachable, focus moves to the status
 * region on every state change, status is announced through an aria-live
 * region, and no signal is color alone — every state also names itself in
 * text. The plain-language privacy disclosure renders BEFORE the consent
 * checkbox, because consent without understanding is not consent.
 */

type PageState =
  | { kind: "form" }
  | { kind: "submitted"; name: string }
  | { kind: "error"; headline: string; detail: string };

/** Map an enrollment API failure to plain language, per error shape. */
function enrollmentError(error: unknown): { headline: string; detail: string } {
  if (error instanceof PilotApiError) {
    if (error.code === "invalid_invite" || error.status === 403) {
      return {
        headline: "That invite code isn't valid.",
        detail: "Check the code from your invite and try again. Invite codes come from the Unmute1AI team.",
      };
    }
    if (error.code === "invite_expired" || error.status === 410) {
      return {
        headline: "That invite code has expired.",
        detail: "Ask the team for a fresh code — they issue new ones any time.",
      };
    }
    if (error.code === "invite_already_used") {
      return {
        headline: "You're all set already.",
        detail: "That invite code was used. If this is your account, sign in instead of enrolling again.",
      };
    }
    if (error.code === "email_already_registered") {
      return {
        headline: "You're all set already.",
        detail: "That email already has an Unmute1AI account. Sign in instead of enrolling again.",
      };
    }
    return { headline: "Enrollment didn't go through.", detail: error.message };
  }
  return {
    headline: "Can't reach Unmute1AI right now.",
    detail: "Check your connection and try again in a moment.",
  };
}

const CONTACT_METHODS = [
  { value: "email", label: "Email" },
  { value: "sms", label: "Text message" },
  { value: "asl_video_relay", label: "ASL video relay" },
] as const;

const TEXT_SIZES = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra large" },
] as const;

export default function PilotEnrollPage() {
  const [state, setState] = useState<PageState>({ kind: "form" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus management: when the page lands in a terminal state, focus moves
  // there so keyboard and screen-reader users land in the outcome, not on a
  // dead form.
  useEffect(() => {
    if (state.kind !== "form") headingRef.current?.focus();
  }, [state]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (key: string) => String(form.get(key) ?? "").trim();

    // Local validation mirrors the server contract (zod on the API side);
    // nothing here is the enforcement point — the server re-validates all of
    // it and the error states below translate its answers.
    const errors: Record<string, string> = {};
    if (get("code").length < 6) errors.code = "Enter the invite code you were given.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(get("email"))) errors.email = "Enter a valid email address.";
    if (get("password").length < 10) errors.password = "Use at least 10 characters.";
    if (get("displayName").length === 0) errors.displayName = "Tell us what to call you.";
    if (get("contactValue").length === 0) errors.contactValue = "Tell us where to reach you.";
    if (form.get("consentToParticipate") !== "on") {
      errors.consentToParticipate = "Joining the pilot needs your OK — we can't enroll you without it.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Move focus to the first invalid control, per WCAG best practice.
      const firstInvalid = ["code", "email", "password", "displayName", "contactValue", "consentToParticipate"].find(
        (key) => key in errors,
      );
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await pilotEnroll({
        code: get("code"),
        email: get("email"),
        password: get("password"),
        displayName: get("displayName"),
        contactMethod: get("contactMethod") as EnrollContactMethod,
        contactValue: get("contactValue"),
        accessibility: {
          captionsEnabled: form.get("captionsEnabled") === "on",
          textSize: (get("textSize") || "medium") as EnrollTextSize,
          aacInputEnabled: form.get("aacInputEnabled") === "on",
          reducedMotion: form.get("reducedMotion") === "on",
        },
        consent: {
          consentToParticipate: true,
          consentToLearningData: form.get("consentToLearningData") === "on",
          consentVersion: "pilot-v1",
        },
      });
      setState({ kind: "submitted", name: get("displayName") });
    } catch (error) {
      setState({ kind: "error", ...enrollmentError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind !== "form") {
    const submitted = state.kind === "submitted";
    return (
      <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
        <div
          role="status"
          aria-live="polite"
          className={`rounded-card border p-6 ${submitted ? "border-primary bg-primary-soft" : "border-line bg-card"}`}
        >
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold text-ink outline-none">
            {submitted ? "✅ You're enrolled" : "⚠️ Enrollment didn't complete"}
          </h1>
          {submitted ? (
            <p className="mt-2 text-ink">
              Welcome, {state.name}. Your pilot account is ready — you can sign in with the email and
              password you just chose.
            </p>
          ) : (
            <>
              <p className="mt-2 font-bold text-ink">{(state as { headline: string }).headline}</p>
              <p className="mt-1 text-ink-soft">{(state as { detail: string }).detail}</p>
              <div className="mt-4">
                <Button onClick={() => setState({ kind: "form" })}>Try again</Button>
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Join the pilot</h1>
        <p className="mt-1 text-ink-soft">
          Enrollment is by invite: enter the code the Unmute1AI team gave you.
        </p>
      </header>

      <div aria-live="polite" role="status" className="sr-only">
        {submitting ? "Enrolling…" : ""}
      </div>

      <Card>
        <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            id="code"
            label="Invite code"
            name="code"
            type="text"
            autoComplete="off"
            required
            error={fieldErrors.code}
          />
          <Field
            id="displayName"
            label="What should we call you?"
            name="displayName"
            type="text"
            autoComplete="nickname"
            required
            error={fieldErrors.displayName}
          />
          <Field
            id="email"
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={fieldErrors.email}
          />
          <Field
            id="password"
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby="password-hint"
            error={fieldErrors.password}
          />
          <p id="password-hint" className="text-xs text-ink-soft">
            At least 10 characters.
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold text-ink">Best way to reach you</legend>
            {CONTACT_METHODS.map((method, index) => (
              <label key={method.value} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="contactMethod"
                  value={method.value}
                  defaultChecked={index === 0}
                  className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                {method.label}
              </label>
            ))}
          </fieldset>
          <Field
            id="contactValue"
            label={
              // The label names the field; the value's meaning follows the
              // chosen contact method. Described text, not color, carries it.
              "Where should we reach you? (email address, phone number, or relay address)"
            }
            name="contactValue"
            type="text"
            required
            error={fieldErrors.contactValue}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold text-ink">Accessibility preferences (optional)</legend>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="captionsEnabled"
                defaultChecked
                className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              Show captions
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="aacInputEnabled"
                className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              I may type using an AAC device — allow extra time
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="reducedMotion"
                className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              Reduce motion
            </label>
            <div className="flex flex-col gap-1">
              <label htmlFor="textSize" className="text-sm text-ink">
                Text size
              </label>
              <select
                id="textSize"
                name="textSize"
                defaultValue="medium"
                className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {TEXT_SIZES.map((size) => (
                  <option key={size.value} value={size.value}>
                    {size.label}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          {/* The disclosure comes BEFORE the consent checkbox — in reading
              order, in the DOM, so no assistive tech reaches the checkbox
              without passing the disclosure first. */}
          <section aria-labelledby="privacy-heading" className="rounded-card bg-lavender-soft p-4">
            <h2 id="privacy-heading" className="text-sm font-extrabold text-ink">
              What happens with your information
            </h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
              <li>
                <strong>What we store:</strong> your name, email, contact preference, accessibility
                preferences, and your consent choices — on Unmute1AI servers.
              </li>
              <li>
                <strong>What leaves your device:</strong> only what you type or say during pilot
                sessions. Nothing is collected from your device in the background.
              </li>
              <li>
                <strong>Who sees it:</strong> the Unmute1AI team running the pilot. We don&apos;t sell
                your data and we don&apos;t share it outside the team.
              </li>
              <li>
                <strong>Saying no:</strong> learning-data consent is optional — you can join the
                pilot without it. You can change your mind later.
              </li>
            </ul>
          </section>

          <label className="flex items-start gap-2 text-sm font-bold text-ink">
            <input
              type="checkbox"
              id="consentToParticipate"
              name="consentToParticipate"
              required
              aria-describedby={fieldErrors.consentToParticipate ? "consent-error" : undefined}
              aria-invalid={fieldErrors.consentToParticipate ? true : undefined}
              className="mt-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            I have read the information above and I agree to take part in the pilot.
          </label>
          {fieldErrors.consentToParticipate ? (
            <p id="consent-error" className="text-sm font-semibold text-danger">
              {fieldErrors.consentToParticipate}
            </p>
          ) : null}

          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="consentToLearningData"
              className="mt-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            Optional: I allow the team to review my learning data to improve the product.
          </label>

          <Button type="submit" disabled={submitting}>
            {submitting ? "Enrolling…" : "Join the pilot"}
          </Button>
        </form>
      </Card>
    </main>
  );
}

type EnrollContactMethod = "email" | "sms" | "asl_video_relay";
type EnrollTextSize = "small" | "medium" | "large" | "xlarge";
