/**
 * ASL static-letter classifier — TypeScript inference runtime.
 *
 * Rebuilds the forward pass of the CNN trained in tools/training
 * (train_image_cnn.py, Sign Language MNIST, 24 static letters A-Z minus
 * J/Z) from the JSON tensor file aslLetterClassifier.weights.json. Pure
 * TypeScript, no ML dependency — loadable directly in the browser.
 *
 * Injection-point compatibility (EMS-Guardian pattern, aslClassifier.ts):
 *   type ModelPredictFn = (feat: number[]) => number[] | Promise<number[]>;
 *   setClassifierModel(fn);
 * createModelPredictFn() below returns exactly that contract: a function
 * taking the flat input vector and returning raw logits (length 24), ready
 * to hand to setClassifierModel(fn).
 *
 * Input contract: 784 floats, a 28x28 grayscale image in row-major order,
 * channel-first single channel, values in [0, 1] (pixel / 255).
 *
 * Measured accuracy: 86.38% on the official random test split of Sign
 * Language MNIST (7,172 images). This is NOT a per-signer held-out number;
 * the dataset carries no signer metadata, so that split is not computable.
 */

import weightsJson from './aslLetterClassifier.weights.json';

export interface TensorFile {
  shape: number[];
  data: number[];
}

interface WeightsPayload {
  format: string;
  inputShape: number[];
  inputRange: [number, number];
  letters: string[];
  layers: Record<string, TensorFile>;
  accuracyOfficialSplit: number;
  splitMethodology: string;
  dataset: string;
}

const W = weightsJson as unknown as WeightsPayload;

export const ASL_LETTERS: readonly string[] = W.letters;
export const INPUT_DIM = 784; // 28x28

function tensor(name: string): TensorFile {
  const t = W.layers[name];
  if (!t) throw new Error(`aslLetterClassifier: missing tensor ${name}`);
  return t;
}

/** 2-D conv, stride 1, padding 1, ReLU. Input/output in NCHW-1 (N=1) layout. */
function conv2dReLU(
  input: Float64Array, // [inC, H, W]
  inDims: [number, number, number],
  weight: number[], // [outC, inC, 3, 3]
  bias: number[],
  outC: number,
): { out: Float64Array; dims: [number, number, number] } {
  const [inC, H, Wd] = inDims;
  const out = new Float64Array(outC * H * Wd);
  const k = 3;
  const pad = 1;
  let o = 0;
  for (let oc = 0; oc < outC; oc++) {
    for (let i = 0; i < H; i++) {
      for (let j = 0; j < Wd; j++) {
        let acc = bias[oc];
        for (let ic = 0; ic < inC; ic++) {
          const inBase = ic * H * Wd;
          const wBase = ((oc * inC + ic) * k) * k;
          for (let di = 0; di < k; di++) {
            const si = i + di - pad;
            if (si < 0 || si >= H) continue;
            for (let dj = 0; dj < k; dj++) {
              const sj = j + dj - pad;
              if (sj < 0 || sj >= Wd) continue;
              acc += weight[wBase + di * k + dj] * input[inBase + si * Wd + sj];
            }
          }
        }
        out[o++] = acc > 0 ? acc : 0;
      }
    }
  }
  return { out, dims: [outC, H, Wd] };
}

/** 2x2 max pool, stride 2 (even dims). */
function maxPool2(
  input: Float64Array,
  dims: [number, number, number],
): { out: Float64Array; dims: [number, number, number] } {
  const [c, H, Wd] = dims;
  const OH = H / 2;
  const OW = Wd / 2;
  const out = new Float64Array(c * OH * OW);
  let o = 0;
  for (let ch = 0; ch < c; ch++) {
    const base = ch * H * Wd;
    for (let i = 0; i < OH; i++) {
      for (let j = 0; j < OW; j++) {
        const a = input[base + (2 * i) * Wd + 2 * j];
        const b = input[base + (2 * i) * Wd + 2 * j + 1];
        const d = input[base + (2 * i + 1) * Wd + 2 * j];
        const e = input[base + (2 * i + 1) * Wd + 2 * j + 1];
        out[o++] = Math.max(a, b, d, e);
      }
    }
  }
  return { out, dims: [c, OH, OW] };
}

/** Fully connected + ReLU. weight is [out, in] row-major (torch Linear). */
function denseReLU(input: Float64Array, weight: number[], bias: number[]): Float64Array {
  const outDim = bias.length;
  const inDim = input.length;
  const out = new Float64Array(outDim);
  let w = 0;
  for (let o = 0; o < outDim; o++) {
    let acc = bias[o];
    for (let i = 0; i < inDim; i++) acc += weight[w++] * input[i];
    out[o] = acc > 0 ? acc : 0;
  }
  return out;
}

function denseLinear(input: Float64Array, weight: number[], bias: number[]): Float64Array {
  const outDim = bias.length;
  const inDim = input.length;
  const out = new Float64Array(outDim);
  let w = 0;
  for (let o = 0; o < outDim; o++) {
    let acc = bias[o];
    for (let i = 0; i < inDim; i++) acc += weight[w++] * input[i];
    out[o] = acc;
  }
  return out;
}

/** Flatten NCHW-1 [C, H, W] to CHW row-major vector (torch flatten order). */
function flattenChw(input: Float64Array): Float64Array {
  return input; // already stored CHW-continuous
}

/** Full forward pass. Returns raw logits, length ASL_LETTERS.length (24). */
export function predictLogits(input: number[]): number[] {
  if (input.length !== INPUT_DIM) {
    throw new Error(`aslLetterClassifier: expected ${INPUT_DIM} inputs, got ${input.length}`);
  }
  const [cIn, hIn, wIn] = W.inputShape;
  let act = new Float64Array(input);
  let dims: [number, number, number] = [cIn, hIn, wIn];

  const c1 = conv2dReLU(act, dims, tensor('conv1.weight').data, tensor('conv1.bias').data, 16);
  const p1 = maxPool2(c1.out, c1.dims);
  const c2 = conv2dReLU(p1.out, p1.dims, tensor('conv2.weight').data, tensor('conv2.bias').data, 32);
  const p2 = maxPool2(c2.out, c2.dims);
  const flat = flattenChw(p2.out);
  const h1 = denseReLU(flat, tensor('fc1.weight').data, tensor('fc1.bias').data);
  const logits = denseLinear(h1, tensor('fc2.weight').data, tensor('fc2.bias').data);
  return Array.from(logits);
}

/** Softmax over logits (matching the EMS-Guardian classifier's confidence). */
export function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export type ModelPredictFn = (feat: number[]) => number[] | Promise<number[]>;

/**
 * Returns a predict function matching the EMS-Guardian injection contract:
 * setClassifierModel(createModelPredictFn()) — feat = flat 784-dim
 * normalized image, returns 24 raw logits (index maps into ASL_LETTERS).
 */
export function createModelPredictFn(): ModelPredictFn {
  return (feat: number[]): number[] => predictLogits(feat);
}
