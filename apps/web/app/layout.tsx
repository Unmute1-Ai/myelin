import type { Metadata, Viewport } from "next";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PRIMER by Unmute1AI",
    template: "%s · PRIMER",
  },
  description:
    "An adaptive tutoring platform that learns the child first, then teaches the lesson.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
        </AccessibilityProvider>
      </body>
    </html>
  );
}
