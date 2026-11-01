"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Field } from "@/components/ui";
import { register, ApiError } from "@/lib/api-client";
import {
  fieldErrors,
  registerRoleLabels,
  registerRoles,
  registerSchema,
} from "@/lib/validation";
import type { RegisterRole } from "@/lib/validation";

/*
 * Registration — validates locally (the UI mirror), then calls
 * POST /auth/register through the typed client. A duplicate email says so
 * (the API's 409) and points to sign-in; the student dashboard is the
 * landing surface after account creation. Role choice is required — the
 * platform's roles carry different permissions and consent rules.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<RegisterRole | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      confirmPassword: form.get("confirmPassword"),
      role,
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setNotice(null);
    setSubmitting(true);
    try {
      await register({
        email: parsed.data.email,
        password: parsed.data.password,
        displayName: parsed.data.name,
        role: parsed.data.role,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNotice("That email already has an account — sign in instead.");
      } else if (error instanceof ApiError) {
        setNotice(error.message);
      } else {
        setNotice("Can't reach PRIMER right now. Check your connection.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">
          Create your account
        </h1>
        <p className="mt-1 text-ink-soft">
          Everyone learns differently. PRIMER starts from that.
        </p>
      </header>

      <Card>
        <form
          noValidate
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold text-ink">
              I am a…
            </legend>
            <div className="flex flex-wrap gap-2">
              {registerRoles.map((value) => {
                const selected = role === value;
                return (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
                      selected
                        ? "border-primary bg-primary text-on-primary"
                        : "border-line bg-card text-ink hover:border-primary"
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={value}
                      checked={selected}
                      onChange={() => setRole(value)}
                      className="sr-only"
                    />
                    {registerRoleLabels[value]}
                  </label>
                );
              })}
            </div>
            {role === "student" ? (
              <p className="text-xs text-ink-soft">
                Students can join on their own now; guardian links arrive with
                the consent wave.
              </p>
            ) : null}
            {errors.role ? (
              <p className="text-sm font-semibold text-danger">
                {errors.role}
              </p>
            ) : null}
          </fieldset>

          <Field
            id="name"
            label="What should we call you?"
            name="name"
            type="text"
            autoComplete="nickname"
            error={errors.name}
          />
          <Field
            id="email"
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            error={errors.email}
          />
          <Field
            id="password"
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            error={errors.password}
          />
          <Field
            id="confirmPassword"
            label="Confirm password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword}
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating your account…" : "Create account"}
          </Button>
        </form>
        {notice ? (
          <p
            role="status"
            className="mt-4 rounded-2xl bg-lavender-soft px-4 py-3 text-sm font-semibold text-primary"
          >
            {notice}
          </p>
        ) : null}
      </Card>

      <p className="text-center text-sm text-ink-soft">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-bold text-primary underline underline-offset-4 hover:text-primary-strong"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
