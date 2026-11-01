"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";

/*
 * Install affordance (spec §6.14): one-tap install via Chromium's
 * beforeinstallprompt, Add-to-Home-Screen guidance on iOS, and silence
 * everywhere else — including once the app is already installed.
 *
 * It mounts from the root layout so learners can install from any surface;
 * when the student dashboard wave lands, this is the component it renders
 * (mount it there and remove the layout mount if the dashboard wants it
 * positioned in its own card flow).
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function standaloneNow(): boolean {
  // Silence everywhere else: embedded webviews without matchMedia simply get
  // no install affordance rather than a crash.
  if (typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes standalone on its own nonstandard flag.
    ("standalone" in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function InstallPrompt() {
  const [standalone, setStandalone] = useState(false);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(
    null,
  );
  const [iosGuidance, setIosGuidance] = useState(false);

  useEffect(() => {
    setStandalone(standaloneNow());

    const onBeforeInstallPrompt = (event: Event) => {
      // Keep the choice inside PRIMER's own UI instead of the omnibox.
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setStandalone(true);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (isIOS() && !standaloneNow()) setIosGuidance(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // The event is one-shot: consumed or dismissed, it goes away. Chromium
    // re-fires beforeinstallprompt on a later visit if the learner wants it.
    if (outcome === "accepted") setStandalone(true);
    setPromptEvent(null);
  };

  if (standalone) return null;

  if (promptEvent) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <h2 className="text-lg font-bold text-ink">Take PRIMER everywhere</h2>
        <p className="mt-1 text-sm font-semibold text-ink-soft">
          Install the app on this device for one-tap learning.
        </p>
        <Button className="mt-4 w-full" onClick={() => void install()}>
          Install PRIMER
        </Button>
      </Card>
    );
  }

  if (iosGuidance) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <h2 className="text-lg font-bold text-ink">Take PRIMER everywhere</h2>
        <p className="mt-1 text-sm font-semibold text-ink-soft">
          On iPhone and iPad: tap the Share button
          {" "}
          <span aria-hidden="true">
            <svg
              className="inline size-4 align-[-2px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v12" />
              <path d="m7 8 5-5 5 5" />
              <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
          </span>
          , then choose <strong>Add to Home Screen</strong>.
        </p>
      </Card>
    );
  }

  return null;
}
