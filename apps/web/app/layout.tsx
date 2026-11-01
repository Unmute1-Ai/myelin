import type { Metadata, Viewport } from "next";
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
        {children}
      </body>
    </html>
  );
}
