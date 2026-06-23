// JS port of prime backend pixel_to_world (.sources/prime/backend/app/inference/distance.py
// L12-30). Applies a 3x3 homography to a single pixel and returns its world (X, Y) in metres.
// numpy-equivalent: dst = H @ [u, v, 1]; w = dst[2]; null if |w| < 1e-9; else [dst0/w, dst1/w].

export type Homography = number[][];

export function pixelToWorld(
  H: Homography | null,
  u: number,
  v: number,
): [number, number] | null {
  if (H === null) return null; // calibration 미설정

  // dst = H · [u, v, 1]
  const x = H[0][0] * u + H[0][1] * v + H[0][2];
  const y = H[1][0] * u + H[1][1] * v + H[1][2];
  const w = H[2][0] * u + H[2][1] * v + H[2][2];

  // projective division 시 w 가 0 에 수렴하면 신뢰 불가(지평선 근처 등) → null.
  if (Math.abs(w) < 1e-9) return null;

  return [x / w, y / w];
}

// 2차 다항식 픽셀→월드(어안 왜곡 흡수, backend _compute_polynomial 와 짝).
// poly = { x:[6], y:[6], norm:[cu,cv,su,sv] }. 백엔드와 동일 정규화 후 [1,u,v,u²,uv,v²] 평가.
export type Poly = { x: number[]; y: number[]; norm: number[] };

export function pixelToWorldPoly(
  poly: Poly | null,
  u: number,
  v: number,
): [number, number] | null {
  if (poly === null) return null;
  const [cu, cv, su, sv] = poly.norm;
  const un = (u - cu) / su;
  const vn = (v - cv) / sv;
  const f = [1, un, vn, un * un, un * vn, vn * vn];
  let X = 0;
  let Y = 0;
  for (let i = 0; i < 6; i++) {
    X += f[i] * poly.x[i];
    Y += f[i] * poly.y[i];
  }
  return [X, Y];
}
