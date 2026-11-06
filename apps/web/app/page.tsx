import { Card, LinkButton } from "@/components/ui";
import { MascotSlot } from "@/components/mascot-slot";

/*
 * Landing shell. The four role-based surfaces (student, parent, educator,
 * admin) arrive with their dashboard waves — this page is the entry point
 * that routes visitors to the auth shells.
 */
export default function HomePage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-primary">
          Unmute1AI presents
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight text-ink">
          PRIMER
        </h1>
        <p className="text-lg font-semibold text-ink-soft">
          Learn the child. Then teach the lesson.
        </p>
      </header>

      <MascotSlot />

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold text-ink">Get started</h2>
        <p className="text-ink-soft">
          Sign in to continue a lesson, or create an account to start learning.
        </p>
        <div className="flex flex-col gap-3">
          <LinkButton href="/login">Sign in</LinkButton>
          <LinkButton href="/register" variant="secondary">
            Create an account
          </LinkButton>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Meet U1 Instinctive Companion</h2>
        <p className="text-sm text-ink-soft">
          MJ and Jake can contribute independently, with a separate synthesis step and explicit routing.
        </p>
        <LinkButton href="/companion" variant="secondary">
          Open companion
        </LinkButton>
      </Card>

      <p className="text-center text-sm text-ink-soft">
        Student, parent, and educator dashboards arrive with the next waves.
      </p>

      <div className="flex justify-center">
        <LinkButton href="/accessibility" variant="ghost">
          Accessibility settings
        </LinkButton>
      </div>
    </main>
  );
}
