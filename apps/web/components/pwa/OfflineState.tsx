"use client";

import { useEffect, useState } from "react";

/*
 * The honest offline banner (spec §6.14). Learner data always comes from the
 * network; when the connection drops we say exactly that — no cached page
 * pretending to be current, no invented progress. Rendered app-wide from the
 * root layout so every surface inherits it.
 */
export function OfflineState() {
  // Server render and first client paint assume online: navigator.onLine is
  // unreadable on the server, and the effect below corrects it immediately.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="mx-auto max-w-2xl rounded-card border border-line bg-lavender-soft px-6 py-4 text-center"
    >
      <p className="text-base font-bold text-ink">You&apos;re offline</p>
      <p className="mt-1 text-sm font-semibold text-ink-soft">
        Lessons and learner data need an internet connection. PRIMER won&apos;t show
        you stale or made-up progress — reconnect to pick up where you left
        off.
      </p>
    </div>
  );
}
