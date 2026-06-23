"""카메라별 거리측정 calibration core.

prime backend (ipcam.py L226-378 + inference/distance.py) 에서 extract.
사용자가 이미지 위 N점(4~12)의 픽셀↔월드 대응을 주면 단일 평면 homography 를
`cv2.findHomography` 로 fit 하고, 저장된 H 로 픽셀→월드 변환을 제공한다.

prime 대비 strip:
- `threshold_m`(거리경보용 — 본 모듈 non-goal) 필드/검증 제거.
- `set_source_calibration`(추론 스트리밍 파이프라인) — 본 모듈은 그 파이프라인 없음.
- inlier 의 outlier-alert 의미 — `cv2.findHomography(src, dst, 0)` 는 RANSAC 이 아니라
  least-squares 라 outlier 제거가 없다. `inlier_mask` 는 호환 위해 남기되 전부 1
  (의미 = "사용된 점").
"""

import numpy as np
import cv2
from fastapi import HTTPException
from pydantic import BaseModel, field_validator, model_validator

_MIN_POINTS = 4
_MAX_POINTS = 12


class CalibrationState(BaseModel):
    """카메라별 거리측정 calibration 상태 — GET 응답 형식."""
    enabled: bool
    pixel_points: list[list[float]] | None = None
    world_points: list[list[float]] | None = None
    homography: list[list[float]] | None = None
    reprojection_errors: list[float] | None = None
    mean_reprojection_error: float | None = None
    inlier_mask: list[int] | None = None
    # 2차 다항식 픽셀→월드 매핑(어안 왜곡 흡수 — homography 보완). 프론트가 있으면 측정에 우선 사용.
    poly_x: list[float] | None = None
    poly_y: list[float] | None = None
    poly_norm: list[float] | None = None  # [cu, cv, su, sv] 픽셀 정규화 파라미터
    poly_errors_m: list[float] | None = None
    poly_mean_error_m: float | None = None


class CalibrationUpdate(BaseModel):
    """PUT 요청 — N점(4~12) pixel/world 좌표 + homography 산출."""
    pixel_points: list[list[float]]
    world_points: list[list[float]]
    enabled: bool = True

    @field_validator("pixel_points", "world_points")
    @classmethod
    def _each_point_must_be_2d(cls, v: list[list[float]]) -> list[list[float]]:
        for i, pt in enumerate(v):
            if len(pt) != 2:
                raise ValueError(f"점 {i}은(는) [x, y] 2개 값이어야 합니다 (받은 값: {len(pt)}개)")
        return v

    @model_validator(mode="after")
    def _validate_points(self) -> "CalibrationUpdate":
        n_px = len(self.pixel_points)
        n_wd = len(self.world_points)

        if n_px != n_wd:
            raise ValueError(
                f"pixel_points({n_px}개)와 world_points({n_wd}개)의 길이가 다릅니다"
            )
        if not (_MIN_POINTS <= n_px <= _MAX_POINTS):
            raise ValueError(
                f"점 개수는 {_MIN_POINTS}~{_MAX_POINTS}개여야 합니다 (받은 값: {n_px}개)"
            )

        px_tuples = [tuple(p) for p in self.pixel_points]
        if len(set(px_tuples)) != len(px_tuples):
            raise ValueError("pixel_points에 중복 좌표가 있습니다")

        wd_tuples = [tuple(p) for p in self.world_points]
        if len(set(wd_tuples)) != len(wd_tuples):
            raise ValueError("world_points에 중복 좌표가 있습니다")

        _check_collinearity(self.pixel_points, "pixel_points")
        _check_collinearity(self.world_points, "world_points")

        return self


def _check_collinearity(points: list[list[float]], name: str) -> None:
    """모든 점이 한 직선 위에 있으면 ValueError."""
    pts = np.array(points, dtype=np.float64)
    base = pts[0]
    v0 = pts[1] - base
    norm_v0 = np.linalg.norm(v0)
    if norm_v0 < 1e-9:
        raise ValueError(f"{name}의 처음 두 점이 동일합니다")
    v0 = v0 / norm_v0

    for i in range(2, len(pts)):
        vi = pts[i] - base
        cross = abs(v0[0] * vi[1] - v0[1] * vi[0])
        if cross > 1e-6:
            return
    raise ValueError(f"{name}의 모든 점이 한 직선 위에 있습니다 — homography 계산 불가")


def _default_calibration_state() -> dict:
    return {
        "enabled": False,
        "pixel_points": None,
        "world_points": None,
        "homography": None,
        "reprojection_errors": None,
        "mean_reprojection_error": None,
        "inlier_mask": None,
        "poly_x": None,
        "poly_y": None,
        "poly_norm": None,
        "poly_errors_m": None,
        "poly_mean_error_m": None,
    }


class HomographyResult:
    __slots__ = ("H", "reprojection_errors", "mean_reprojection_error", "inlier_mask")

    def __init__(
        self,
        H: list[list[float]],
        reprojection_errors: list[float],
        mean_reprojection_error: float,
        inlier_mask: list[int],
    ):
        self.H = H
        self.reprojection_errors = reprojection_errors
        self.mean_reprojection_error = mean_reprojection_error
        self.inlier_mask = inlier_mask


def _compute_homography(
    pixel_points: list[list[float]],
    world_points: list[list[float]],
) -> HomographyResult:
    """다점 homography 계산.

    4점: exact fit (reprojection 0).
    5점+: least-squares — 모든 점이 H에 기여, outlier 제거 없음
    (`cv2.findHomography(src, dst, 0)`, RANSAC 아님).
    """
    src = np.array(pixel_points, dtype=np.float64)
    dst = np.array(world_points, dtype=np.float64)

    n = len(pixel_points)
    H, mask = cv2.findHomography(src, dst, 0)

    if H is None:
        raise HTTPException(
            status_code=400,
            detail="homography 계산 실패 — 점 배치가 부적절합니다",
        )

    det = np.linalg.det(H)
    if abs(det) < 1e-10:
        raise HTTPException(
            status_code=400,
            detail="homography 행렬이 singular입니다 — 점 배치를 확인하세요",
        )

    inlier_mask = [1] * n

    H_inv = np.linalg.inv(H)
    reproj = cv2.perspectiveTransform(dst.reshape(-1, 1, 2), H_inv)
    errors = np.linalg.norm(reproj.reshape(-1, 2) - src, axis=1)

    return HomographyResult(
        H=H.tolist(),
        reprojection_errors=[round(float(e), 2) for e in errors],
        mean_reprojection_error=round(float(errors.mean()), 2),
        inlier_mask=inlier_mask,
    )


def _compute_polynomial(
    pixel_points: list[list[float]],
    world_points: list[list[float]],
) -> dict:
    """2차 다항식 픽셀→월드 fit — 어안/광각 렌즈 왜곡을 점 데이터로 흡수(A=intrinsic 보정 없이).

    homography(평면 8DOF)는 핀홀 가정이라 어안 왜곡에 못 맞춘다(큰 reproj). 2차 다항식
    [1, u, v, u², uv, v²] 은 자유도가 높아 부드러운 왜곡을 따라간다. **점이 둘러싼 영역
    안에서만** 정확(보간), 밖은 외삽이라 부정확. 점이 많을수록(>6) least-squares 로 안정.

    픽셀 좌표는 큰 값(u²~1e6)이라 정규화(평균=0, 반범위=1) 후 fit 해 조건수를 안정화한다.
    정규화 파라미터(poly_norm)를 함께 저장 → 프론트가 평가 시 동일 정규화 적용.
    """
    px = np.array(pixel_points, dtype=np.float64)
    wd = np.array(world_points, dtype=np.float64)
    u, v = px[:, 0], px[:, 1]
    cu, cv = float(u.mean()), float(v.mean())
    su = float(max((u.max() - u.min()) / 2, 1e-6))
    sv = float(max((v.max() - v.min()) / 2, 1e-6))
    un, vn = (u - cu) / su, (v - cv) / sv
    A = np.column_stack([np.ones_like(un), un, vn, un * un, un * vn, vn * vn])
    cx, *_ = np.linalg.lstsq(A, wd[:, 0], rcond=None)
    cy, *_ = np.linalg.lstsq(A, wd[:, 1], rcond=None)
    err = np.sqrt((A @ cx - wd[:, 0]) ** 2 + (A @ cy - wd[:, 1]) ** 2)
    return {
        "poly_x": [float(c) for c in cx],
        "poly_y": [float(c) for c in cy],
        "poly_norm": [cu, cv, su, sv],
        "poly_errors_m": [round(float(e), 4) for e in err],
        "poly_mean_error_m": round(float(err.mean()), 4),
    }


def pixel_to_world(
    homography: list[list[float]] | None,
    u: float,
    v: float,
) -> tuple[float, float] | None:
    """단일 픽셀 (u, v) 를 H 행렬로 월드 (X, Y) m 로 변환.

    homography 가 None 이면 None 반환 (calibration 미설정).
    projective division 시 w 가 0 에 수렴하면 None (지평선 근처 등 신뢰 불가 영역).
    """
    if homography is None:
        return None
    H = np.asarray(homography, dtype=np.float64)
    src = np.array([u, v, 1.0], dtype=np.float64)
    dst = H @ src
    w = dst[2]
    if abs(w) < 1e-9:
        return None
    return float(dst[0] / w), float(dst[1] / w)
