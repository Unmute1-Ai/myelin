/*
 * Sign pipeline — stage 3: letter classifier.
 *
 * Takes a per-frame input bundle (16-dim pose features + optional 28x28
 * image crop) and returns a letter + a real softmax confidence. Two
 * execution paths:
 *
 *   • If a model is wired via setLetterClassifierModel(predict), use it.
 *     `predict` receives the full ClassifierInput (a model reads whichever
 *     modality it was trained on — the trained image CNN reads
 *     `input.image`) and returns raw logits of length LETTER_LABELS.length.
 *     This is the injection point — dropping in a model is one call.
 *   • Otherwise, fall back to a transparent, deterministic PLACEHOLDER:
 *     nearest-prototype matching over hand-authored letter shapes. It is
 *     NOT trained and NOT accurate — it responds to actual hand geometry
 *     so the demo pipeline is real end to end, and the UI labels it as a
 *     placeholder.
 */

import { FEATURE_DIM } from "./features";

// The 24 static ASL letters. J and Z are motion letters and are excluded —
// a single-frame pose classifier cannot see them.
export const LETTER_LABELS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
] as const;

export type Letter = (typeof LETTER_LABELS)[number];

export interface LetterPrediction {
  letter: Letter;
  confidence: number; // softmax probability of the picked letter, in [0,1]
}

export type ClassifierModelPredict = (input: ClassifierInput) => number[] | Promise<number[]>;

/** Everything a wired model may need for one frame. `features` is always
 *  present (the placeholder and any landmark model read it); `image` is the
 *  28x28 grayscale crop, filled in only when the video frame is readable. */
export interface ClassifierInput {
  features: number[];
  image: number[];
}

let modelPredict: ClassifierModelPredict | null = null;

/**
 * Injection point for a real classifier. Pass `predict(input) -> logits`
 * (logits must have LETTER_LABELS.length entries, same order). Pass null to
 * restore the built-in placeholder.
 */
export function setLetterClassifierModel(predict: ClassifierModelPredict | null): void {
  modelPredict = predict;
}

export function hasLetterClassifierModel(): boolean {
  return modelPredict !== null;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return sum > 0 ? exps.map((e) => e / sum) : exps.map(() => 1 / exps.length);
}

function argmax(xs: number[]): number {
  let best = -Infinity;
  let idx = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] > best) {
      best = xs[i];
      idx = i;
    }
  }
  return idx;
}

/* ------------------------------------------------------------------------ */
/* Placeholder: hand-authored nearest-prototype matcher                      */
/* ------------------------------------------------------------------------ */

// Each letter is a prototype in a compact view of the 16-dim feature space:
//   [extIndex, extMiddle, extRing, extPinky, gapIndexMiddle,
//    gapMiddleRing, gapRingPinky, gapThumbIndex]
// where ext* is the finger's mean interior angle divided by π (1 = straight,
// 0 = fully folded) and gap* are the normalized fingertip distances. Values
// are hand-authored from canonical ASL letter shapes — not learned from data.
//
// Known limits, stated plainly: K/P and G/Q differ only by orientation, which
// these features do not encode, so those pairs are inherently confusable
// here. This matcher exists to make the pipeline honest end to end, not to
// be good.
type Prototype = readonly [number, number, number, number, number, number, number, number];

// Derived per frame: finger extensions from angles 0..11 (mean of each
// finger's 3 angles / π) and the 4 gap features (indices 12..15 of feat).
function prototypeView(feat: number[]): number[] {
  const ext: number[] = [];
  for (let f = 0; f < 4; f++) {
    const sum = feat[f * 3] + feat[f * 3 + 1] + feat[f * 3 + 2];
    ext.push(sum / 3 / Math.PI);
  }
  return ext.concat(feat.slice(12));
}

const PROTOTYPES: Record<Letter, Prototype> = {
  //        extI  extM  extR  extP  gIM   gMR   gRP   gThumb
  A: [0.10, 0.10, 0.10, 0.10, 0.05, 0.05, 0.05, 0.45],
  B: [1.00, 1.00, 1.00, 1.00, 0.05, 0.05, 0.05, 0.70],
  C: [0.60, 0.60, 0.60, 0.60, 0.30, 0.30, 0.30, 0.60],
  D: [1.00, 0.15, 0.10, 0.10, 0.90, 0.05, 0.05, 0.15],
  E: [0.08, 0.08, 0.08, 0.08, 0.05, 0.05, 0.05, 0.15],
  F: [0.15, 1.00, 1.00, 1.00, 0.90, 0.05, 0.05, 0.10],
  G: [1.00, 0.10, 0.10, 0.10, 0.90, 0.05, 0.05, 0.50],
  H: [1.00, 1.00, 0.10, 0.10, 0.10, 0.90, 0.05, 0.40],
  I: [0.10, 0.10, 0.10, 1.00, 0.05, 0.05, 0.90, 0.40],
  K: [1.00, 1.00, 0.10, 0.10, 0.60, 0.90, 0.05, 0.60],
  L: [1.00, 0.10, 0.10, 0.10, 0.90, 0.05, 0.05, 1.00],
  M: [0.15, 0.15, 0.15, 0.30, 0.05, 0.05, 0.05, 0.60],
  N: [0.15, 0.15, 0.40, 0.60, 0.05, 0.05, 0.10, 0.45],
  O: [0.45, 0.45, 0.45, 0.45, 0.15, 0.15, 0.15, 0.10],
  P: [1.00, 1.00, 0.10, 0.10, 0.60, 0.90, 0.05, 0.60],
  Q: [1.00, 0.10, 0.10, 0.10, 0.90, 0.05, 0.05, 0.50],
  R: [1.00, 1.00, 0.10, 0.10, 0.05, 0.90, 0.05, 0.40],
  S: [0.10, 0.10, 0.10, 0.10, 0.05, 0.05, 0.05, 0.30],
  T: [0.15, 0.30, 0.30, 0.30, 0.10, 0.05, 0.05, 0.20],
  U: [1.00, 1.00, 0.10, 0.10, 0.35, 0.90, 0.05, 0.40],
  V: [1.00, 1.00, 0.10, 0.10, 0.70, 0.90, 0.05, 0.40],
  W: [1.00, 1.00, 1.00, 0.10, 0.50, 0.50, 0.90, 0.40],
  X: [0.50, 0.10, 0.10, 0.10, 0.90, 0.05, 0.05, 0.50],
  Y: [0.10, 0.10, 0.10, 1.00, 0.05, 0.05, 0.90, 0.90],
};

// Softmax temperature over squared distances: smaller = more confident
// nearest neighbor. Tuned so a clean prototype match reads ~0.9 and a vague
// hand reads low, without ever hitting exactly 1.
const DISTANCE_TEMPERATURE = 0.08;

function placeholderLogits(feat: number[]): number[] {
  const view = prototypeView(feat);
  const logits: number[] = [];
  for (const letter of LETTER_LABELS) {
    const p = PROTOTYPES[letter];
    let d2 = 0;
    for (let i = 0; i < p.length; i++) {
      const d = view[i] - p[i];
      d2 += d * d;
    }
    logits.push(-d2 / DISTANCE_TEMPERATURE);
  }
  return logits;
}

/* ------------------------------------------------------------------------ */

export async function classifyLetter(input: ClassifierInput): Promise<LetterPrediction> {
  if (input.features.length !== FEATURE_DIM) {
    throw new Error(
      `classifyLetter: expected ${FEATURE_DIM} features, got ${input.features.length}`,
    );
  }
  const logits = modelPredict ? await modelPredict(input) : placeholderLogits(input.features);
  if (logits.length !== LETTER_LABELS.length) {
    throw new Error(
      `classifyLetter: model returned ${logits.length} logits, expected ${LETTER_LABELS.length}`,
    );
  }
  const probs = softmax(logits);
  const id = argmax(probs);
  return { letter: LETTER_LABELS[id], confidence: probs[id] };
}
