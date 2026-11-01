import type { MetadataRoute } from "next";

/*
 * Web app manifest (spec §6.14). Next serves this at /manifest.webmanifest and
 * injects the <link rel="manifest"> into every page automatically.
 *
 * The colors are the installable twin of the design tokens in app/globals.css:
 * #5b21b6 is --color-primary, #f9f8ff is --color-background. Icons are static
 * files under public/icons/, generated from the approved mascot light variant
 * (art_oNYqJeCh): identity-locked art, logo-free, hearing aid visible and
 * matter-of-fact. Native home-screen widgets are explicitly out of scope
 * (spec §9.5) — the PWA is the installable surface.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PRIMER by Unmute1AI",
    short_name: "PRIMER",
    description:
      "An adaptive tutoring platform that learns the child first, then teaches the lesson.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f9f8ff",
    theme_color: "#5b21b6",
    categories: ["education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
