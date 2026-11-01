"use client";

/*
 * Login shell wired to the real auth API (POST /api/auth/login through the
 * same-origin proxy). Success sets the httpOnly primer_session cookie on this
 * origin and sends the learner to the live tutor. Registration keeps its
 * shell until the onboarding wave wires it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Field } from "@/components/ui";
import { fieldErrors, loginSchema } from "@/lib/validation";

export default function LoginPage() {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setNotice(body?.message ?? "Sign-in didn't work. Try again in a moment.");
        return;
      }
      router.push("/tutor");
    } catch {
      setNotice("We couldn't reach the sign-in service. Check your connection and try again.");
    } finally {
      setBusy(false);
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
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        {notice ? (
          <p
            role="alert"
            className="mt-4 rounded-2xl bg-lavender-soft px-4 py-3 text-sm font-semibold text-danger"
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
