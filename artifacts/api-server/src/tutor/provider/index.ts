// Provider selection: TUTOR_PROVIDER picks the brain; the scripted default
// needs no key. Cloud providers are development-only per the 2026-10-30
// local-first decision and throw at selection time when their key is missing
// — fail loud at startup, never silently downgrade.

import type { TutorProvider } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createOpenAIProvider } from "./openai";
import { createScriptedProvider } from "./scripted";

/** Misspelled or unsupported TUTOR_PROVIDER values fail here, not mid-lesson. */
export class UnknownProviderError extends Error {}

export function createProvider(): TutorProvider {
  const selected = process.env["TUTOR_PROVIDER"] ?? "scripted";

  switch (selected) {
    case "scripted":
      return createScriptedProvider();
    case "anthropic": {
      const key = process.env["ANTHROPIC_API_KEY"];
      if (!key) throw new UnknownProviderError("TUTOR_PROVIDER=anthropic set but ANTHROPIC_API_KEY is missing");
      return createAnthropicProvider(key);
    }
    case "openai": {
      const key = process.env["OPENAI_API_KEY"];
      if (!key) throw new UnknownProviderError("TUTOR_PROVIDER=openai set but OPENAI_API_KEY is missing");
      return createOpenAIProvider(key);
    }
    case "gemini": {
      const key = process.env["GEMINI_API_KEY"];
      if (!key) throw new UnknownProviderError("TUTOR_PROVIDER=gemini set but GEMINI_API_KEY is missing");
      return createGeminiProvider(key);
    }
    default:
      throw new UnknownProviderError(`Unknown TUTOR_PROVIDER "${selected}"`);
  }
}
