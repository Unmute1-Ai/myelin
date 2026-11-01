// Retrieval over the learner's own uploaded materials (spec §6.7). Deliberately
// deterministic and dependency-free: chunk uploaded text, score it lexically
// against the learner's input, return the top passages as MaterialContext.
// Text-only by design — no binaries, no embeddings, no external service.

import type { MaterialContext } from "../tutor/session-context";

export const MATERIAL_MAX_CHARS = 100_000;

/** v1 accepts text-bearing files only — no images, audio, or video. */
export function isTextMaterial(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return (
    normalized === "text/csv" ||
    normalized === "application/json" ||
    normalized.startsWith("text/")
  );
}

export interface MaterialChunk {
  readonly index: number;
  readonly text: string;
}

/** Split content into paragraph-sized chunks (≤ maxChars), in order. */
export function chunkMaterial(content: string, maxChars = 500): MaterialChunk[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      // A single oversized paragraph becomes its own chunk (hard-capped so a
      // pathological upload cannot blow the context).
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + 1 + paragraph.length <= maxChars) {
      chunks[chunks.length - 1] = `${last} ${paragraph}`;
    } else {
      chunks.push(paragraph);
    }
  }

  return chunks.map((text, index) => ({ text, index }));
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "it", "its", "this", "that", "these",
  "those", "i", "im", "my", "your", "we", "our", "do", "does", "did", "not",
  "no", "yes", "at", "as", "by", "from", "but", "if", "then", "than", "so",
  "can", "could", "would", "should", "me", "us", "what", "when", "where",
  "which", "who", "whom", "why", "how", "about", "into", "over", "under",
  "again", "more", "most", "some", "any", "there", "here", "please", "tell",
  "say", "said", "get", "got", "like", "just", "hey", "hi", "hello", "okay",
  "ok", "uh", "um",
]);

/** Lowercased word tokens, stop words dropped, min length 2. Pure. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Lexical relevance of one chunk to the query terms: unique query terms the
 * chunk covers, weighted mildly by how often they occur. Ties keep chunk
 * order (stable sort downstream) so equal scores are deterministic.
 */
export function scoreChunk(chunk: Pick<MaterialChunk, "text">, queryTerms: readonly string[]): number {
  if (queryTerms.length === 0) return 0;
  const tokens = tokenize(chunk.text);
  if (tokens.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let score = 0;
  for (const term of queryTerms) {
    const hits = counts.get(term);
    if (hits !== undefined) score += 1 + Math.min(hits - 1, 4) * 0.1;
  }
  return score;
}

export interface RetrieveInput {
  readonly materialId: string;
  readonly filename: string;
  readonly content: string;
  readonly createdAt: Date;
}

export interface RetrieveOptions {
  limit?: number;
}

/** Question-shaped input — the predicate both the engine and the provider use. */
export function asksAboutMaterials(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("?")) return true;
  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  return ["what", "when", "where", "which", "who", "why", "how", "tell", "explain", "does", "is", "are", "can"].includes(first);
}

/**
 * The learner's own materials, ranked and capped. Chunks with zero lexical
 * overlap are never returned — the tutor must not pretend to know content
 * it cannot ground in.
 */
export function retrievePassages(
  query: string,
  materials: readonly RetrieveInput[],
  options: RetrieveOptions = {},
): MaterialContext[] {
  const limit = options.limit ?? 3;
  const queryTerms = [...new Set(tokenize(query))];
  if (materials.length === 0 || queryTerms.length === 0) return [];

  const scored: { ctx: MaterialContext; score: number; order: number }[] = [];
  let order = 0;
  for (const material of materials) {
    for (const chunk of chunkMaterial(material.content)) {
      const score = scoreChunk(chunk, queryTerms);
      if (score <= 0) continue;
      scored.push({
        ctx: { materialId: material.materialId, filename: material.filename, passage: chunk.text },
        score,
        order: order++,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.ctx);
}

/** The scripted provider's grounded, hint-framed reply for a material question. */
export function groundedMaterialReply(ctx: readonly MaterialContext[]): string {
  const passage = ctx[0];
  if (passage === undefined) {
    return "I looked through your materials but nothing in them matches that yet. Want to try the check question while you think about it?";
  }
  return [
    `From your own notes (${passage.filename}):`,
    "",
    `“${passage.passage}”`,
    "",
    "That's your material talking — now, what do you think it means for our problem?",
  ].join("\n");
}
