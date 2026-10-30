// Placeholder gloss for the sign panel. Real ASL gloss is a grammar of its
// own; this derives a rough, deterministic word-order sketch from the spoken
// line and the UI always labels it as a placeholder. No sign video is faked.
const SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "being",
  "been",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "so",
  "but",
  "it",
  "its",
  "that",
  "this",
  "these",
  "those",
  "your",
  "you",
  "we",
  "us",
  "our",
  "i",
  "me",
  "my",
  "he",
  "she",
  "they",
  "them",
  "their",
  "with",
  "as",
  "if",
  "let",
  "lets",
  "just",
  "very",
  "here",
  "there",
  "will",
  "would",
  "can",
  "do",
  "does",
  "did",
  "now",
]);

const GLOSS_WORD_LIMIT = 10;

/** Rough keyword sketch of a spoken line — placeholder, never real gloss. */
export function toPlaceholderGloss(text: string): string {
  const words = text
    .toUpperCase()
    .replace(/[^A-Z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const content = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  const gloss = (content.length > 0 ? content : words).slice(
    0,
    GLOSS_WORD_LIMIT,
  );
  return gloss.join(" ");
}
