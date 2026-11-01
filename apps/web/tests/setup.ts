import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-text-size");
  document.documentElement.removeAttribute("data-contrast");
  document.documentElement.removeAttribute("data-motion");
  document.documentElement.removeAttribute("data-aac-input");
  document.documentElement.removeAttribute("data-breaks");
  document.documentElement.removeAttribute("data-speech");
  vi.unstubAllGlobals();
});

// jsdom has no Web Speech API — provide a minimal, observable stand-in so the
// provider's TTS path is exercisable. Individual tests can spy on these.
class FakeUtterance {
  text: string;
  onend: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const speakSpy = vi.fn();
const cancelSpy = vi.fn();

Object.defineProperty(window, "speechSynthesis", {
  configurable: true,
  value: { speak: speakSpy, cancel: cancelSpy },
});
Object.defineProperty(window, "SpeechSynthesisUtterance", {
  configurable: true,
  value: FakeUtterance,
});

export { speakSpy, cancelSpy };
