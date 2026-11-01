"use client";

import { useEffect } from "react";

/*
 * Registers the offline app-shell worker (spec §6.14). Production-only: in
 * dev, a worker serving cached shells across hot reloads would hide code
 * changes from the very people editing the shell.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      // A registration failure degrades the app to online-only. Surface it —
      // a silent catch here would quietly disable the offline shell.
      console.error("[pwa] service worker registration failed:", error);
    });
  }, []);

  return null;
}
