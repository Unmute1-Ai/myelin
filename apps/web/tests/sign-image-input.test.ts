import { describe, expect, it } from "vitest";
import { handCropBoxPixels, imageDataToInput } from "@/lib/sign/imageInput";
import type { LandmarkFrame } from "@/lib/sign/landmarks";

// A 21-landmark hand centered at the center of a 640x480 frame, spanning
// x in [0.4, 0.6] and y in [0.4, 0.6] of the frame.
function centeredHand(): LandmarkFrame {
  return Array.from({ length: 21 }, (_, i) => ({
    x: 0.4 + ((i % 7) / 6) * 0.2,
    y: 0.4 + (Math.floor(i / 7) / 2) * 0.2,
    z: 0,
  }));
}

describe("handCropBoxPixels", () => {
  it("returns a square box centered on the hand", () => {
    const box = handCropBoxPixels(centeredHand(), 640, 480);
    // Center of the hand: (320, 240). The box must stay square and inside.
    const centerX = box.sx + box.size / 2;
    const centerY = box.sy + box.size / 2;
    expect(box.size).toBeGreaterThan(0);
    expect(box.size).toBeLessThanOrEqual(480); // clamped to the shorter side
    expect(centerX).toBeCloseTo(320, 0);
    expect(centerY).toBeCloseTo(240, 0);
    expect(box.sx).toBeGreaterThanOrEqual(0);
    expect(box.sy).toBeGreaterThanOrEqual(0);
    expect(box.sx + box.size).toBeLessThanOrEqual(640);
    expect(box.sy + box.size).toBeLessThanOrEqual(480);
  });

  it("grows with the hand extent plus margin", () => {
    const spread = Array.from({ length: 21 }, (_, i) => ({
      x: 0.1 + ((i % 7) / 6) * 0.8, // wide hand: 80% of the frame
      y: 0.45,
      z: 0,
    }));
    const tight = handCropBoxPixels(centeredHand(), 640, 480);
    const wide = handCropBoxPixels(spread, 640, 480);
    expect(wide.size).toBeGreaterThan(tight.size);
  });

  it("clamps a hand at the frame edge instead of cropping out of bounds", () => {
    const cornerHand = centeredHand().map((p) => ({
      x: Math.min(p.x, 0.05),
      y: Math.min(p.y, 0.05),
      z: 0,
    }));
    const box = handCropBoxPixels(cornerHand, 640, 480);
    expect(box.sx).toBe(0);
    expect(box.sy).toBe(0);
    expect(box.sx + box.size).toBeLessThanOrEqual(640);
    expect(box.sy + box.size).toBeLessThanOrEqual(480);
  });

  it("rejects degenerate video dimensions and empty frames", () => {
    expect(() => handCropBoxPixels(centeredHand(), 0, 480)).toThrow(/dimensions/);
    expect(() => handCropBoxPixels([], 640, 480)).toThrow(/empty/);
  });
});

describe("imageDataToInput", () => {
  function rgba(pixels: [number, number, number][]): { data: number[]; width: number; height: number } {
    const data: number[] = [];
    for (const [r, g, b] of pixels) {
      data.push(r, g, b, 255);
    }
    return { data, width: pixels.length, height: 1 };
  }

  it("converts luminance to [0,1] row-major with a contrast stretch", () => {
    // Two pixels: dark gray and white. Luminances ~76 and ~255.
    const out = imageDataToInput(rgba([
      [80, 80, 80],
      [255, 255, 255],
    ]));
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0, 5); // darkest pixel stretches to 0
    expect(out[1]).toBeCloseTo(1, 5); // brightest stretches to 1
  });

  it("maps a flat image to all zeros instead of dividing by zero", () => {
    const out = imageDataToInput(
      rgba([
        [128, 128, 128],
        [128, 128, 128],
        [128, 128, 128],
        [128, 128, 128],
      ]),
    );
    expect(out).toHaveLength(4);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("rejects an RGBA buffer shorter than width*height*4", () => {
    expect(() => imageDataToInput({ data: [0, 0, 0, 255], width: 2, height: 2 })).toThrow(
      /RGBA/,
    );
  });

  it("respects the trained model's 28x28 input size end to end", () => {
    // 28x28=784 RGBA pixels, mid-gray with a white row.
    const pixels: [number, number, number][] = Array.from({ length: 784 }, (_, i) =>
      i < 28 ? [255, 255, 255] : [60, 60, 60],
    );
    const out = imageDataToInput(rgba(pixels));
    expect(out).toHaveLength(784);
  });
});
