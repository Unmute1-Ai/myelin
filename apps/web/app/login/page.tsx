"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Field } from "@/components/ui";
import { login, ApiError } from "@/lib/api-client";
import { fieldErrors, loginSchema } from "@/lib/validation";

/*
 * Login — validates locally (the UI mirror), then calls POST /auth/login
 * through the typed client. The API's single 401 covers both wrong-email
 * and wrong-password — the UI mirrors that honesty and never reveals which
 * part missed.
 */
export default function LoginPage() {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setNotice(null);
    setSubmitting(true);
    try {
      const result = await login(parsed.data);
      // Parents land on their family view; everyone else on the learner home
      // (its role card reroutes honestly if the space isn't theirs).
      router.push(result.user.role === "parent" ? "/parent" : "/dashboard");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof ApiError
          ? error.status === 401
            ? "That email or password doesn't match our records."
            : error.message
          : "Can't reach PRIMER right now. Check your connection.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">
          Welcome back
        </h1>
        <p className="mt-1 text-ink-soft">
          Sign in to keep learning where you left off.
        </p>
      </header>

      <Card>
        <form
          noValidate
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
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
            autoComplete="current-password"
            error={errors.password}
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
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
        New to PRIMER?{" "}
        <Link
          href="/register"
          className="font-bold text-primary underline underline-offset-4 hover:text-primary-strong"
        >
          Create an account
        </Link>
      </p>
    </main>
  );
}
