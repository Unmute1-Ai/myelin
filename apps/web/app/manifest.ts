import type { MetadataRoute } from "next";

/*
 * Grace install manifest. The PWA launches directly into the companion.
 * Learner data and conversation history are never cached by the service worker.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/companion",
    name: "Grace by Unmute1AI",
    short_name: "Grace",
    description:
      "An accessibility-first AI companion. Your voice, your choices, your control.",
    start_url: "/companion",
    scope: "/",
    display: "standalone",
    background_color: "#f9f8ff",
    theme_color: "#6d4aff",
    categories: ["education", "utilities"],
    icons: [
      {
        src: "/icons/grace.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
