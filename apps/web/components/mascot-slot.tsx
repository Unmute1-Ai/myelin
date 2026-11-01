/*
 * Mascot art slot (spec §6.6, usage notes art_4J78bf2H).
 *
 * The production art shipped to `apps/web/public/mascot/` — this renders it
 * via next/image with literal alt text. Usage-constraint compliance lives
 * here so every consumer inherits it: live text is overlaid by callers
 * (never baked into art), the full character stays in frame, and the
 * hearing aid and sneakers are never edited — callers consume the shipped
 * files as-is.
 */
import Image from "next/image";

export type MascotVariant = "dashboard" | "welcome" | "progress" | "sessions";

const VARIANTS: Record<MascotVariant, { src: string; alt: string; width: number; height: number }> = {
  dashboard: {
    src: "/mascot/mascot-light-dashboard.png",
    alt: "PRIMER mascot: an illustrated learner with curly brown hair, round gold glasses, and a behind-the-ear hearing aid, waving in front of a soft lavender background.",
    width: 1024,
    height: 1024,
  },
  welcome: {
    src: "/mascot/empty-welcome.png",
    alt: "PRIMER mascot holding an empty speech bubble, ready to start a first conversation.",
    width: 1152,
    height: 896,
  },
  progress: {
    src: "/mascot/empty-progress.png",
    alt: "PRIMER mascot beside an empty chart, waiting for your first progress to record.",
    width: 1152,
    height: 896,
  },
  sessions: {
    src: "/mascot/empty-sessions.png",
    alt: "PRIMER mascot beside an empty chat window, waiting for your first tutoring session.",
    width: 1152,
    height: 896,
  },
};

export function MascotSlot({
  variant = "dashboard",
  className = "",
  imageClassName = "",
  priority = false,
}: {
  variant?: MascotVariant;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  const art = VARIANTS[variant];
  return (
    <div className={`relative overflow-hidden rounded-card ${className}`}>
      <Image
        src={art.src}
        alt={art.alt}
        width={art.width}
        height={art.height}
        priority={priority}
        className={`h-auto w-full object-cover ${imageClassName}`}
        sizes="(max-width: 768px) 100vw, 480px"
      />
    </div>
  );
}
