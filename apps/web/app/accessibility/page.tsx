import { Card } from "@/components/ui";
import { AccessibilitySettingsForm } from "@/components/accessibility/AccessibilitySettingsForm";
import { SpeakButton } from "@/components/accessibility/SpeakButton";
import { CaptionRegion } from "@/components/accessibility/CaptionRegion";
import { QuickResponses } from "@/components/accessibility/QuickResponses";
import { BreakReminder } from "@/components/accessibility/BreakReminder";

export const metadata = {
  title: "Accessibility",
  description:
    "Tune text size, contrast, captions, speech, input options, and pacing — applied everywhere in PRIMER.",
};

/*
 * The accessibility settings surface (spec §6.8). The controls at the top
 * apply app-wide; below them, live examples of each support so a learner can
 * see (and hear) the difference before committing to a preference.
 */
export default function AccessibilityPage() {
  const demoSentence =
    "Welcome to PRIMER. This sentence can be read aloud, and its words can be shown as captions.";

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-6 py-12"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Accessibility</h1>
        <p className="text-lg text-ink-soft">
          Make PRIMER fit you. Every setting here applies to every page, for
          every role — no diagnosis is asked for, needed, or stored.
        </p>
      </header>

      <AccessibilitySettingsForm />

      <section aria-labelledby="try-it-heading" className="flex flex-col gap-4">
        <h2 id="try-it-heading" className="text-xl font-bold text-ink">
          Try each support right here
        </h2>

        <Card className="flex flex-col gap-4">
          <h3 className="text-lg font-bold text-ink">Speech and captions</h3>
          <p className="text-base text-ink" id="demo-sentence">
            {demoSentence}
          </p>
          <SpeakButton text={demoSentence} aria-describedby="demo-sentence" />
          <CaptionRegion />
        </Card>

        <Card className="flex flex-col gap-4">
          <h3 className="text-lg font-bold text-ink">AAC-friendly quick responses</h3>
          <p className="text-sm text-ink-soft">
            Turn the option on above and these large, labeled buttons appear
            wherever you&apos;d otherwise type — in lessons and tutor chats.
          </p>
          <QuickResponses />
        </Card>

        <Card className="flex flex-col gap-4">
          <h3 className="text-lg font-bold text-ink">Pacing and breaks</h3>
          <p className="text-sm text-ink-soft">
            With breaks on, PRIMER offers a pause after your interval — it
            never takes one for you. This is the reminder, live:
          </p>
          <BreakReminder />
        </Card>
      </section>
    </main>
  );
}
