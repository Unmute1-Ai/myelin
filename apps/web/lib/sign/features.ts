/*
 * Sign pipeline — stage 2: feature extraction.
 *
 * Produces a 16-dim vector from one normalized hand frame:
 *   • 12 joint angles  (3 interior joints x 4 non-thumb fingers)
 *   • 3 fingertip gaps (index↔middle, middle↔ring, ring↔pinky, / palm span)
 *   • 1 thumb gap      (thumb tip ↔ index tip, / palm span)
 *
 * Angles are translation- and scale-invariant on their own; the gap features
 * are computed on the normalized frame so distance from camera cancels out.
 * This is the contract the trained classifier (separate task) will consume —
 * keep FEATURE_DIM and the ordering stable.
 */

import type { Landmark, LandmarkFrame } from "./landmarks";

export const FEATURE_DIM = 16;
export const ANGLE_COUNT = 12;
export const GAP_COUNT = 4;

// Finger chains used for the 12 interior-joint angles. The wrist (0) anchors
// each chain; the three interior joints are chain indices 1..3 and each
// contributes one angle between adjacent bones. The thumb is excluded — its
// MCP geometry is noisier and letter shapes separate better on the other
// four fingers plus the gap features below.
const FINGER_CHAINS: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 5, 6, 7, 8], // index
  [0, 9, 10, 11, 12], // middle
  [0, 13, 14, 15, 16], // ring
  [0, 17, 18, 19, 20], // pinky
];

const FINGER_TIPS = [8, 12, 16, 20];

function sub(a: Landmark, b: Landmark): [number, number, number] {
  return [a.x - b.x, a.y - b.y, a.z - b.z];
}

function dot(u: [number, number, number], v: [number, number, number]): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

function norm(u: [number, number, number]): number {
  return Math.sqrt(dot(u, u));
}

// Angle at `joint` between the vectors to `prev` and `next`, in radians,
// clamped to [0, π]. A straight finger ≈ π; a fully folded joint ≈ 0.
function jointAngle(prev: Landmark, joint: Landmark, next: Landmark): number {
  const a = sub(prev, joint);
  const b = sub(next, joint);
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot(a, b) / (na * nb)));
  return Math.acos(cos);
}

export function extractAngles(frame: LandmarkFrame): number[] {
  const angles: number[] = [];
  for (const chain of FINGER_CHAINS) {
    for (let j = 1; j <= 3; j++) {
      angles.push(jointAngle(frame[chain[j - 1]], frame[chain[j]], frame[chain[j + 1]]));
    }
  }
  return angles; // length 12
}

// Distance between two fingertip tips, in palm-span units.
function tipGap(frame: LandmarkFrame, a: number, b: number, span: number): number {
  const [dx, dy, dz] = sub(frame[a], frame[b]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / span;
}

/**
 * Build the 16-dim feature vector from a *normalized* frame (see
 * normalizeFrame). Returns zeros for an empty frame so callers can feed a
 * straight-line pipeline without null handling.
 */
export function buildFeatureVector(frame: LandmarkFrame): number[] {
  if (frame.length === 0) return new Array(FEATURE_DIM).fill(0);
  if (frame.length !== 21) {
    throw new Error(`buildFeatureVector: expected 21 landmarks, got ${frame.length}`);
  }

  const angles = extractAngles(frame);

  // Fingertip gaps on the normalized frame: the span is already 1, so the
  // raw normalized distances are the gap features.
  const gaps = [
    tipGap(frame, FINGER_TIPS[0], FINGER_TIPS[1], 1), // index ↔ middle
    tipGap(frame, FINGER_TIPS[1], FINGER_TIPS[2], 1), // middle ↔ ring
    tipGap(frame, FINGER_TIPS[2], FINGER_TIPS[3], 1), // ring ↔ pinky
    tipGap(frame, FINGER_TIPS[0], 4, 1), // index tip ↔ thumb tip
  ];

  return angles.concat(gaps); // length 16
}
