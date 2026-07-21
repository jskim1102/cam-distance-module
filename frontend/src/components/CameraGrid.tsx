import { useState, useEffect, useCallback } from "react";
import type { Cam } from "../pages/CamerasPage";
import { apiBase } from "../hooks/useApi";
import { measurableHomography } from "../utils/calibrationGate";
import WhepPlayer from "./WhepPlayer";
import MeasureFocusModal from "./MeasureFocusModal";

type Calib = { homography: number[][] | null; enabled: boolean; k1: number };

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
  // 카메라별 calibration — GET. homography + enabled(측정 표시 on/off gate). null=미설정.
  const [calibs, setCalibs] = useState<Record<string, Calib>>({});
  // 거리측정 focus 대상 카메라(null=닫힘).
  const [focusCam, setFocusCam] = useState<Cam | null>(null);

  // 각 카메라 calibration 1회 로딩 — homography + enabled 로 측정 gate(finding #4).
  const loadCalibrations = useCallback(async () => {
    const entries = await Promise.all(
      cams.map(async (c) => {
        try {
          const resp = await fetch(`${apiBase()}/api/ipcams/${c.stream_key}/calibration`);
          if (!resp.ok) return [c.stream_key, { homography: null, enabled: false, k1: 0 }] as const;
          const state = await resp.json();
          const calib: Calib = {
            homography: (state.homography as number[][] | null) ?? null,
            enabled: state.enabled ?? false,
            k1: state.k1 ?? 0,
          };
          return [c.stream_key, calib] as const;
        } catch {
          return [c.stream_key, { homography: null, enabled: false, k1: 0 }] as const;
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
  // enabled=false 면 homography 가 있어도 측정 불가 — measurableHomography 로 gate(finding #4).
  const focusH = focusCalib
    ? measurableHomography(focusCalib.enabled, focusCalib.homography)
    : null;

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {cams.map((cam) => {
          const calib = calibs[cam.stream_key];
          return (
            <GridCell
              key={`${cam.id}:${cam.rtsp_url}`}
              cam={cam}
              onFps={onFps}
              homography={calib ? measurableHomography(calib.enabled, calib.homography) : null}
              onMeasure={() => setFocusCam(cam)}
            />
          );
        })}
      </div>

      {/* focus 확대 모달 — calibration 완료(H 있음) + enabled 카메라만 열림. */}
      {focusCam && focusH && (
        <MeasureFocusModal
          cam={focusCam}
          homography={focusH}
          k1={focusCalib?.k1 ?? 0}
          onClose={() => setFocusCam(null)}
        />
      )}
    </>
  );
}
