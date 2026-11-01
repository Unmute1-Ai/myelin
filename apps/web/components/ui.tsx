import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/*
 * Shared UI primitives for the PRIMER surfaces (spec 6.7). Deliberately small:
 * dashboard waves compose these instead of re-rolling styles per surface.
 * Every interactive element gets a visible, token-colored focus ring —
 * keyboard navigation is a launch requirement, not polish.
 */

type ButtonVariant = "primary" | "secondary" | "ghost";

const buttonClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  secondary: "bg-mascot text-ink hover:bg-mascot-soft",
  ghost: "bg-transparent text-primary hover:bg-primary-soft",
};

function baseButtonClasses(variant: ButtonVariant, className: string): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3",
    "text-base font-bold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:cursor-not-allowed disabled:opacity-50",
    buttonClasses[variant],
    className,
  ].join(" ");
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant };

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={baseButtonClasses(variant, className)}
    />
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

export function LinkButton({ variant = "primary", className = "", ...props }: LinkButtonProps) {
  return (
    <Link
      {...props}
      className={baseButtonClasses(variant, className)}
    />
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-line bg-card px-4 py-3 text-base text-ink transition-colors placeholder:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
    />
  );
}

export function Field({
  id,
  label,
  error,
  className = "",
  ...inputProps
}: {
  id: string;
  label: string;
  error?: string;
} & ComponentProps<"input">) {
  const errorId = `${id}-error`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-card border border-line bg-card p-6 shadow-sm ${className}`}>
      {children}
    </section>
  );
}
