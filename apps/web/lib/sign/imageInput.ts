/*
 * Sign pipeline — stage 2b: image input for the trained image classifier.
 *
 * The merged trained model (tools/training/inference/aslLetterClassifier.ts)
 * consumes a 28x28 grayscale image, values in [0, 1] — the format of Sign
 * Language MNIST. The live pipeline has landmarks, not MNIST crops, so this
 * module derives that input from the camera frame: the landmark bounding box
 * picks the crop region, and the crop is rendered to a 28x28 canvas upstream
 * (components/sign) and converted to the flat vector here.
 *
 * Sign Language MNIST hands are light-on-dark silhouettes; a webcam crop is
 * not. The per-crop contrast stretch below removes lighting-level drift but
 * cannot close the domain gap — live accuracy legitimately differs from the
 * offline benchmark, which is exactly what the demo's self-verification mode
 * measures.
 */

import type { LandmarkFrame } from "./landmarks";

export interface PixelBox {
  /** Left edge of the crop in video pixels. */
  sx: number;
  /** Top edge of the crop in video pixels. */
  sy: number;
  /** Side length of the (square) crop in video pixels. */
  size: number;
}

/**
 * Square pixel-space crop box around all 21 landmarks, expanded by `margin`
 * (as a fraction of the hand extent on each side) and clamped to the video
 * frame. Square in PIXELS, so `drawImage(video, sx, sy, size, size, ...)`
 * yields an undistorted crop regardless of camera aspect ratio.
 */
export function handCropBoxPixels(
  frame: LandmarkFrame,
  videoWidth: number,
  videoHeight: number,
  margin = 0.25,
): PixelBox {
  if (videoWidth <= 0 || videoHeight <= 0) {
    throw new Error("handCropBoxPixels: video dimensions must be positive");
  }
  if (frame.length === 0) {
    throw new Error("handCropBoxPixels: empty landmark frame");
  }

  const xs = frame.map((p) => p.x * videoWidth);
  const ys = frame.map((p) => p.y * videoHeight);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Square side: fit both axes, then pad. A degenerate (single-point) hand
  // still gets a sensible window via the MIN_SIZE floor.
  const MIN_SIZE = Math.max(videoWidth, videoHeight) * 0.1;
  const extent = Math.max(maxX - minX, maxY - minY, MIN_SIZE);
  const pad = extent * margin;
  let size = extent + 2 * pad;

  // Center on the hand, then clamp the square back inside the frame.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  size = Math.min(size, videoWidth, videoHeight);
  const sx = Math.min(Math.max(cx - size / 2, 0), videoWidth - size);
  const sy = Math.min(Math.max(cy - size / 2, 0), videoHeight - size);

  return { sx: Math.round(sx), sy: Math.round(sy), size: Math.round(size) };
}

export interface GrayImageData {
  /** RGBA pixels, as produced by CanvasRenderingContext2D.getImageData. */
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/**
 * Convert an RGBA pixel block (a 28x28 hand crop) into the classifier's flat
 * input: luminance in [0, 1], row-major, length width*height. A min-max
 * contrast stretch normalizes exposure per crop; a flat (single-value) image
 * maps to all zeros so an empty crop reads as "dark" rather than exploding.
 */
export function imageDataToInput(image: GrayImageData): number[] {
  const n = image.width * image.height;
  if (image.data.length < n * 4) {
    throw new Error(
      `imageDataToInput: expected ${n * 4} RGBA values for a ${image.width}x${image.height} image, got ${image.data.length}`,
    );
  }

  const gray = new Float64Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = 0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2];
    gray[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min;
  const out = new Array<number>(n);
  if (range < 1e-6) {
    out.fill(0);
    return out;
  }
  for (let i = 0; i < n; i++) {
    out[i] = (gray[i] - min) / range;
  }
  return out;
}
