import { describe, expect, it } from "vitest";

import { pixelToWorld } from "./pixelToWorld";

// Characterization test: ground-truth values produced by running the REAL prime
// pixel_to_world (.sources/prime/backend/app/inference/distance.py, pure numpy)
// in the backend venv against this exact H and these points. The JS port must
// reproduce them bit-for-bit (within 1e-9). This pins JS ↔ prime-numpy equivalence.
const H = [
  [2.0, 0.1, 5.0],
  [0.0, 3.0, -2.0],
  [0.001, 0.002, 1.0],
];

describe("pixelToWorld", () => {
  it("matches prime numpy output for a projective H (origin)", () => {
    const r = pixelToWorld(H, 0, 0);
    expect(r).not.toBeNull();
    expect(r![0]).toBeCloseTo(5.0, 9);
    expect(r![1]).toBeCloseTo(-2.0, 9);
  });

  it("matches prime numpy output at (100,50)", () => {
    const r = pixelToWorld(H, 100, 50);
    expect(r![0]).toBeCloseTo(175.0, 9);
    expect(r![1]).toBeCloseTo(123.33333333333334, 9);
  });

  it("matches prime numpy output at (640,480)", () => {
    const r = pixelToWorld(H, 640, 480);
    expect(r![0]).toBeCloseTo(512.6923076923076, 9);
    expect(r![1]).toBeCloseTo(553.0769230769231, 9);
  });

  it("matches prime numpy output at (10,20)", () => {
    const r = pixelToWorld(H, 10, 20);
    expect(r![0]).toBeCloseTo(25.71428571428571, 9);
    expect(r![1]).toBeCloseTo(55.238095238095234, 9);
  });

  it("passes a pixel through unchanged for identity H", () => {
    const I = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expect(pixelToWorld(I, 123, 456)).toEqual([123, 456]);
  });

  it("returns null when projective divisor w collapses to ~0", () => {
    const Hw0 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ];
    expect(pixelToWorld(Hw0, 5, 5)).toBeNull();
  });

  it("returns null when homography is null (calibration unset)", () => {
    expect(pixelToWorld(null, 1, 1)).toBeNull();
  });
});
