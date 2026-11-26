import { afterAll, describe, expect, it } from "vitest";
import { LETTER_LABELS, classifyLetter, setLetterClassifierModel } from "@/lib/sign/classifier";
import {
  ASL_LETTERS,
  INPUT_DIM,
  predictLogits,
} from "../../../tools/training/inference/aslLetterClassifier";
import {
  OFFLINE_BENCHMARK,
  wireTrainedImageClassifier,
} from "@/lib/sign/trainedClassifier";

afterAll(() => {
  // Never leak the trained model into other test files.
  setLetterClassifierModel(null);
});

describe("offline benchmark metadata", () => {
  it("matches the merged eval report: 86.38% on the Sign Language MNIST random split", () => {
    // Source: tools/training/artifacts/eval_report.json headline, merged as eff2d47.
    expect(OFFLINE_BENCHMARK.accuracy).toBeCloseTo(0.8638, 3);
    expect(OFFLINE_BENCHMARK.testSize).toBe(7172);
  });
});

describe("trained image CNN", () => {
  it("uses the same 24-letter order as the demo", () => {
    expect(ASL_LETTERS).toEqual([...LETTER_LABELS]);
  });

  it("produces 24 deterministic logits for a 784-dim input", () => {
    const input = Array.from({ length: INPUT_DIM }, (_, i) => (i % 28) / 27);
    const first = predictLogits(input);
    const second = predictLogits(input);
    expect(first).toHaveLength(24);
    expect(second).toEqual(first);
    expect(first.every((l) => Number.isFinite(l))).toBe(true);
  });

  it("rejects inputs that are not 784 long", () => {
    expect(() => predictLogits([1, 2, 3])).toThrow(/784/);
  });

  it("wires through the injection point and classifies a full input bundle", async () => {
    wireTrainedImageClassifier();
    // The demo passes 16 pose features plus the 28x28 crop; the CNN reads
    // only the crop.
    const prediction = await classifyLetter({
      features: Array.from({ length: 16 }, () => 0.5),
      image: Array.from({ length: INPUT_DIM }, (_, i) => (i % 7 === 0 ? 1 : 0)),
    });
    expect(LETTER_LABELS).toContain(prediction.letter);
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.confidence).toBeLessThanOrEqual(1);
  });
});
