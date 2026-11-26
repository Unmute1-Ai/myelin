import { describe, expect, it } from "vitest";
import {
  LETTER_LABELS,
  classifyLetter,
  hasLetterClassifierModel,
  setLetterClassifierModel,
} from "@/lib/sign/classifier";
import { FEATURE_DIM, buildFeatureVector } from "@/lib/sign/features";
import { normalizeFrame } from "@/lib/sign/landmarks";
import type { LandmarkFrame } from "@/lib/sign/landmarks";

// Build a synthetic 21-landmark hand. Each finger chain starts at its MCP
// pointing up, and each interior joint turns the chain by (π - angle), so
// angle = π gives a straight finger and a small angle gives a tight fold.
// MCPs sit 1/3 palm-span apart, so adjacent straight fingertips end up
// ~0.33 apart after normalization. Only the index-tip ↔ thumb-tip distance
// is used from the thumb chain, so it is parked roughly at `thumbGap`.
function syntheticFrame(angle: number, gap: number, thumbGap: number): LandmarkFrame {
  const frame: LandmarkFrame = new Array(21);
  frame[0] = { x: 0, y: 0, z: 0 }; // wrist (normalization re-centers anyway)

  const mcpY = 1;
  const bone = 0.5;
  const chains = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  chains.forEach((chain, f) => {
    let x = (f - 1.5) * gap;
    let y = mcpY;
    frame[chain[0]] = { x, y, z: 0 };
    let dir = Math.PI / 2; // finger points up from the MCP
    for (let j = 1; j < 4; j++) {
      dir += Math.PI - angle; // interior joint bend
      x += bone * Math.cos(dir);
      y += bone * Math.sin(dir);
      frame[chain[j]] = { x, y, z: 0 };
    }
  });

  // Thumb chain (landmarks 1-4), tip (4) placed `thumbGap` from the index
  // tip (8). Intermediates are geometric filler — no feature reads them.
  const tip = frame[8];
  frame[1] = { x: -0.6, y: 0.1, z: 0 };
  frame[2] = { x: -0.6, y: 0.2, z: 0 };
  frame[3] = { x: -0.6, y: 0.3, z: 0 };
  frame[4] = { x: tip.x - thumbGap, y: tip.y, z: 0 };

  return frame;
}

describe("letter labels", () => {
  it("has exactly the 24 static ASL letters (no J, no Z)", () => {
    expect(LETTER_LABELS).toHaveLength(24);
    expect(LETTER_LABELS).not.toContain("J");
    expect(LETTER_LABELS).not.toContain("Z");
  });
});

describe("feature extraction", () => {
  it("produces a 16-dim vector from 21 landmarks", () => {
    const features = buildFeatureVector(normalizeFrame(syntheticFrame(Math.PI, 0.1, 0.3)));
    expect(features).toHaveLength(FEATURE_DIM);
  });

  it("rejects malformed frames", () => {
    expect(() => buildFeatureVector([{ x: 0, y: 0, z: 0 }])).toThrow();
  });
});

describe("placeholder classifier", () => {
  it("is active when no model is injected", () => {
    setLetterClassifierModel(null);
    expect(hasLetterClassifierModel()).toBe(false);
  });

  it("returns a valid letter and confidence for a straight-finger frame", async () => {
    setLetterClassifierModel(null);
    const features = buildFeatureVector(normalizeFrame(syntheticFrame(Math.PI, 0.05, 0.3)));
    const prediction = await classifyLetter(features);
    expect(LETTER_LABELS).toContain(prediction.letter);
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.confidence).toBeLessThanOrEqual(1);
  });

  it("uses an injected model instead of the placeholder", async () => {
    const calls: number[][] = [];
    setLetterClassifierModel((features) => {
      calls.push(features);
      // Logits favoring "W" (index 21 in LETTER_LABELS).
      return LETTER_LABELS.map((_, i) => (i === 21 ? 10 : 0));
    });
    expect(hasLetterClassifierModel()).toBe(true);
    const features = buildFeatureVector(normalizeFrame(syntheticFrame(Math.PI, 0.05, 0.3)));
    const prediction = await classifyLetter(features);
    expect(prediction.letter).toBe("W");
    expect(prediction.confidence).toBeGreaterThan(0.9);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(FEATURE_DIM);
    setLetterClassifierModel(null);
  });

  it("rejects models that return the wrong number of logits", async () => {
    setLetterClassifierModel(() => [1, 2, 3]);
    const features = buildFeatureVector(normalizeFrame(syntheticFrame(Math.PI, 0.05, 0.3)));
    await expect(classifyLetter(features)).rejects.toThrow(/logits/);
    setLetterClassifierModel(null);
  });

  it("distinguishes a fist-like frame from a flat-hand frame", async () => {
    setLetterClassifierModel(null);
    const flat = buildFeatureVector(normalizeFrame(syntheticFrame(Math.PI, 0.05, 0.3)));
    const fist = buildFeatureVector(normalizeFrame(syntheticFrame(0.1, 0.05, 0.3)));
    const flatPrediction = await classifyLetter(flat);
    const fistPrediction = await classifyLetter(fist);
    // Straight fingers read as an open-hand letter, folded as a fist letter.
    expect(["B", "C", "D", "G", "H", "K", "L", "U", "V", "W", "X", "P", "Q", "R"]).toContain(
      flatPrediction.letter,
    );
    expect(["A", "E", "M", "N", "S", "T"]).toContain(fistPrediction.letter);
  });
});
