/*
 * Sign pipeline — stage 1: landmark types and normalization.
 *
 * Landmarks follow the MediaPipe Hands index convention (0 = wrist,
 * 1-4 = thumb, 5-8 = index, 9-12 = middle, 13-16 = ring, 17-20 = pinky).
 * Raw camera landmarks arrive in image coordinates and vary with where the
 * hand sits in frame; every downstream stage works on a normalized copy so
 * translation and distance-from-camera cancel out.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type LandmarkFrame = Landmark[]; // length 21

export const LANDMARK_COUNT = 21;

// Palm span: MCP joints 5 (index) and 17 (pinky) bracket the palm width.
// Used as the scale unit — it is stable across hand sizes better than any
// single bone length.
export function palmSpan(frame: LandmarkFrame): number {
  if (frame.length < 18) return 1;
  const dx = frame[5].x - frame[17].x;
  const dy = frame[5].y - frame[17].y;
  const dz = frame[5].z - frame[17].z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return d > 1e-6 ? d : 1;
}

/**
 * Translate the frame so the wrist sits at the origin and scale so the palm
 * span is 1. Returns a new array; the input is not mutated.
 */
export function normalizeFrame(frame: LandmarkFrame): LandmarkFrame {
  if (frame.length < LANDMARK_COUNT) {
    throw new Error(`normalizeFrame: expected ${LANDMARK_COUNT} landmarks, got ${frame.length}`);
  }
  const span = palmSpan(frame);
  const wrist = frame[0];
  return frame.map((p) => ({
    x: (p.x - wrist.x) / span,
    y: (p.y - wrist.y) / span,
    z: (p.z - wrist.z) / span,
  }));
}
