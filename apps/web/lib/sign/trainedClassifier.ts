/*
 * Sign pipeline — stage 3b: the REAL trained classifier.
 *
 * Wires the trained image CNN (merged on main as eff2d47, trained in
 * tools/training on Sign Language MNIST) into the demo's injection point
 * (setLetterClassifierModel). One call: wireTrainedImageClassifier().
 *
 * Which model, and why: the training task produced two models. The primary
 * image CNN ships a browser-ready pure-TypeScript inference runtime and
 * JSON weights, and its input (a 28x28 grayscale hand crop) can be derived
 * live from the webcam frame, so it is the model wired here. The secondary
 * landmark MLP (80.6% on a 5,080-sample single-uploader landmark dataset)
 * exists only as a torch checkpoint with no browser runtime or exported
 * weights — it cannot be wired end to end and is NOT used.
 *
 * Honest labeling — OFFLINE BENCHMARK, clearly separated from live numbers:
 * the merged model measures 86.38% on the official RANDOM test split of
 * Sign Language MNIST (7,172 images). That is NOT a per-signer held-out
 * number (the dataset carries no signer metadata) and NOT live-webcam
 * accuracy. Live accuracy on this device is measured only by the demo's
 * self-verification mode.
 */

import {
  ASL_LETTERS,
  createModelPredictFn,
} from "../../../../tools/training/inference/aslLetterClassifier";
import benchmarkWeights from "../../../../tools/training/inference/aslLetterClassifier.weights.json";
import { LETTER_LABELS, setLetterClassifierModel } from "./classifier";

export interface OfflineBenchmark {
  /** Fraction correct on the official random test split, in [0, 1]. */
  accuracy: number;
  dataset: string;
  methodology: string;
  testSize: number;
}

interface BenchmarkWeights {
  accuracyOfficialSplit: number;
  dataset: string;
  splitMethodology: string;
  testSize?: number;
}

const weights = benchmarkWeights as unknown as BenchmarkWeights;

export const OFFLINE_BENCHMARK: OfflineBenchmark = {
  accuracy: weights.accuracyOfficialSplit,
  dataset: weights.dataset,
  methodology: weights.splitMethodology,
  testSize: weights.testSize ?? 7172,
};

/**
 * Inject the trained image CNN as the demo's letter classifier. The predict
 * function ignores the 16-dim pose features and runs the CNN on the 28x28
 * image crop (input.image). Throws if the trained letters ever drift out of
 * sync with the demo's label order — a silent mismatch would mislabel every
 * prediction.
 */
export function wireTrainedImageClassifier(): void {
  if (ASL_LETTERS.length !== LETTER_LABELS.length) {
    throw new Error(
      `wireTrainedImageClassifier: trained model has ${ASL_LETTERS.length} letters, demo expects ${LETTER_LABELS.length}`,
    );
  }
  for (let i = 0; i < ASL_LETTERS.length; i++) {
    if (ASL_LETTERS[i] !== LETTER_LABELS[i]) {
      throw new Error(
        `wireTrainedImageClassifier: letter order mismatch at index ${i}: trained ${ASL_LETTERS[i]}, demo ${LETTER_LABELS[i]}`,
      );
    }
  }
  const predictImage = createModelPredictFn();
  setLetterClassifierModel((input) => predictImage(input.image));
}
