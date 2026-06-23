import { useState, useEffect, useCallback } from "react";
import type { Cam } from "../pages/CamerasPage";
import { apiBase } from "../hooks/useApi";
import WhepPlayer from "./WhepPlayer";
import MeasureFocusModal from "./MeasureFocusModal";
import type { Poly } from "../utils/pixelToWorld";

type Calib = { homography: number[][] | null; poly: Poly | null };

// 사용자 오버라이드(게이트2) — 1줄 최대 4칸, 4 채워지면 다음 줄로 wrap.
function getGridColumns(count: number): number {
  return Math.min(Math.max(count, 1), 4);
}

interface Props {
  cams: Cam[];
  onFps?: (streamKey: string, fps: number) => void;
}

// 셀 = WhepPlayer(WebRTC) + 거리측정 토글(calibration 완료 카메라만 enable).
function GridCell({
  cam,
  onFps,
  homography,
  onMeasure,
}: {
  cam: Cam;
  onFps?: (streamKey: string, fps: number) => void;
  homography: number[][] | null;
  onMeasure: () => void;
}) {
  const calibrated = homography != null;
  return (
    <div className="grid-cell">
      <WhepPlayer streamKey={cam.stream_key} onFps={(fps) => onFps?.(cam.stream_key, fps)} />
      {/* 거리측정 토글 — calibration 없으면 disabled. ON 시 focus 확대 모달. */}
      <button
        className="grid-measure-toggle"
        disabled={!calibrated}
        title={calibrated ? "거리측정 모드 (확대)" : "calibration 먼저 설정하세요"}
        onClick={onMeasure}
      >
        📏 거리측정
      </button>
    </div>
  );
}

export default function CameraGrid({ cams, onFps }: Props) {
  // 카메라별 calibration — GET. homography(토글 gate) + poly(어안 보정 측정). null=미설정.
  const [calibs, setCalibs] = useState<Record<string, Calib>>({});
  // 거리측정 focus 대상 카메라(null=닫힘).
  const [focusCam, setFocusCam] = useState<Cam | null>(null);

  // 각 카메라 calibration 1회 로딩 — homography 로 토글 gate, poly(있으면) 로 측정.
  const loadCalibrations = useCallback(async () => {
    const entries = await Promise.all(
      cams.map(async (c) => {
        try {
          const resp = await fetch(`${apiBase()}/api/ipcams/${c.stream_key}/calibration`);
          if (!resp.ok) return [c.stream_key, { homography: null, poly: null }] as const;
          const state = await resp.json();
          const poly: Poly | null =
            state.poly_x && state.poly_y && state.poly_norm
              ? { x: state.poly_x, y: state.poly_y, norm: state.poly_norm }
              : null;
          const calib: Calib = {
            homography: (state.homography as number[][] | null) ?? null,
            poly,
          };
          return [c.stream_key, calib] as const;
        } catch {
          return [c.stream_key, { homography: null, poly: null }] as const;
        }
      }),
    );
    setCalibs(Object.fromEntries(entries));
  }, [cams]);

  useEffect(() => {
    loadCalibrations();
  }, [loadCalibrations]);

  if (cams.length === 0) {
    return <p className="grid-empty">등록된 카메라가 없습니다.</p>;
  }

  const columns = getGridColumns(cams.length);
  const focusCalib = focusCam ? calibs[focusCam.stream_key] : null;

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {cams.map((cam) => (
          <GridCell
            key={`${cam.id}:${cam.rtsp_url}`}
            cam={cam}
            onFps={onFps}
            homography={calibs[cam.stream_key]?.homography ?? null}
            onMeasure={() => setFocusCam(cam)}
          />
        ))}
      </div>

      {/* focus 확대 모달 — calibration 완료(H 있음) 카메라만 열림. poly 있으면 어안 보정 측정. */}
      {focusCam && focusCalib?.homography && (
        <MeasureFocusModal
          cam={focusCam}
          homography={focusCalib.homography}
          poly={focusCalib.poly}
          onClose={() => setFocusCam(null)}
        />
      )}
    </>
  );
}
