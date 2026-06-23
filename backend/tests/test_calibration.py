"""calibration core characterization 테스트.

calibration.py 는 prime 에서 extract 한 supplied 코드(near-verbatim) → 동작을 고정
(characterization). 검증·homography·pixel_to_world 의 기존 출력을 핀고정한다.

검증 실패(공선/길이불일치/중복)는 core 레벨에선 pydantic ValidationError 로 난다 —
이것이 API 레벨에서 400 으로 매핑되는 건 test_calibration_api.py(ckpt3) 에서 확인.
"""

import math

import pytest
from pydantic import ValidationError

from app.calibration import (
    CalibrationUpdate,
    _compute_homography,
    _default_calibration_state,
    pixel_to_world,
)


def test_four_point_exact_fit_reprojection_near_zero():
    # 단위 정사각형(픽셀) → 동일 정사각형(월드). 4점 exact fit → reproj ≈ 0.
    pixel = [[0, 0], [100, 0], [100, 100], [0, 100]]
    world = [[0, 0], [1, 0], [1, 1], [0, 1]]
    result = _compute_homography(pixel, world)

    assert result.mean_reprojection_error < 1e-6
    assert all(e < 1e-6 for e in result.reprojection_errors)
    assert result.inlier_mask == [1, 1, 1, 1]  # 전부 "사용된 점"
    assert len(result.H) == 3 and len(result.H[0]) == 3


def test_compute_homography_then_pixel_to_world_roundtrip():
    # H fit 후 pixel_to_world 가 calibration 점을 월드로 정확히 보낸다.
    pixel = [[0, 0], [100, 0], [100, 100], [0, 100]]
    world = [[0, 0], [1, 0], [1, 1], [0, 1]]
    H = _compute_homography(pixel, world).H

    for (u, v), (wx, wy) in zip(pixel, world):
        out = pixel_to_world(H, u, v)
        assert out is not None
        assert math.isclose(out[0], wx, abs_tol=1e-6)
        assert math.isclose(out[1], wy, abs_tol=1e-6)


def test_pixel_to_world_none_homography_returns_none():
    assert pixel_to_world(None, 5, 5) is None


def test_collinear_points_rejected():
    # 모든 픽셀 점이 한 직선 위 → ValidationError(_check_collinearity).
    with pytest.raises(ValidationError, match="직선"):
        CalibrationUpdate(
            pixel_points=[[0, 0], [1, 1], [2, 2], [3, 3]],
            world_points=[[0, 0], [1, 0], [2, 0], [0, 1]],
        )


def test_length_mismatch_rejected():
    with pytest.raises(ValidationError, match="길이"):
        CalibrationUpdate(
            pixel_points=[[0, 0], [1, 0], [1, 1], [0, 1]],
            world_points=[[0, 0], [1, 0], [1, 1]],
        )


def test_duplicate_points_rejected():
    with pytest.raises(ValidationError, match="중복"):
        CalibrationUpdate(
            pixel_points=[[0, 0], [1, 0], [1, 0], [0, 1]],
            world_points=[[0, 0], [1, 0], [1, 1], [0, 1]],
        )


def test_too_few_points_rejected():
    with pytest.raises(ValidationError, match="점 개수"):
        CalibrationUpdate(
            pixel_points=[[0, 0], [1, 0], [1, 1]],
            world_points=[[0, 0], [1, 0], [1, 1]],
        )


def test_default_calibration_state_shape():
    s = _default_calibration_state()
    assert s["enabled"] is False
    assert s["homography"] is None
    assert "threshold_m" not in s  # strip 확인
