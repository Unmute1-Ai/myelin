import type { Metadata, Viewport } from "next";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineState } from "@/components/pwa/OfflineState";
import { RegisterServiceWorker } from "@/components/pwa/RegisterServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PRIMER by Unmute1AI",
    template: "%s · PRIMER",
  },
  description:
    "An adaptive tutoring platform that learns the child first, then teaches the lesson.",
  applicationName: "PRIMER",
  // Installable-app chrome for iOS home-screen launches (spec §6.14);
  // the manifest itself is app/manifest.ts, linked automatically.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PRIMER",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // --color-primary; the OS paints browser chrome with it on install.
  themeColor: "#5b21b6",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-background font-sans text-ink antialiased">
        <AccessibilityProvider>
          {/*
            Skip link: the first focusable element on every page — keyboard
            users reach the content without tabbing through navigation (spec
            §6.8: keyboard navigation is platform behavior, always on).
          */}
          <a href="#main" className="skip-link">
            Skip to main content
          </a>
          {children}
          {/* PWA shell (spec §6.14): honest offline notice everywhere, the
              install affordance until a dashboard takes it over, and the
              worker registration that powers both. */}
          <OfflineState />
          <InstallPrompt />
          <RegisterServiceWorker />
        </AccessibilityProvider>
      </body>
    </html>
  );
}
