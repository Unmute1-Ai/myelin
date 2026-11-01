/*
 * Apply stored accessibility preferences to the document (spec §6.8,
 * "applied app-wide"). Called whenever prefs load or change: text size
 * scales the root font, high contrast and reduced motion set data
 * attributes the global stylesheet honors. DOM is touched only through
 * this one function so the behavior stays inspectable and testable.
 */
import type { AccessibilityPrefs } from "@workspace/api-zod";

const TEXT_SIZE_SCALES: Record<AccessibilityPrefs["textSize"], string> = {
  small: "87.5%",
  medium: "100%",
  large: "112.5%",
  xlarge: "125%",
};

export function applyAccessibilityPrefs(
  prefs: Pick<AccessibilityPrefs, "textSize" | "highContrast" | "reducedMotion">,
): void {
  if (typeof document === "undefined") return; // SSR guard — nothing to apply.
  const root = document.documentElement;
  root.style.fontSize = TEXT_SIZE_SCALES[prefs.textSize];
  root.dataset.highContrast = String(prefs.highContrast);
  root.dataset.reducedMotion = String(prefs.reducedMotion);
}
