import { useState, useEffect, useCallback } from "react";
import { apiBase } from "../hooks/useApi";
import type { AutoMeasurement, SelectedYoloClass, YoloClass } from "../types/detection";
import {
  minimumClassConfidence,
  normalizeClassConfidence,
} from "../utils/detectionPairs";
import CameraFormModal from "../components/CameraFormModal";
import CameraGrid from "../components/CameraGrid";
import MeasurementClassModal from "../components/MeasurementClassModal";

export interface Cam {
  id: number;
  name: string;
  rtsp_url: string;
  stream_key: string;
  created_at: string;
}

interface Stat {
  active: boolean;
  readers: number;
}

const MAX_IPCAMS_FALLBACK = 16; // spec F4 — /api/config 로딩 전 기본값. 실제 cap 은 백엔드 env.
const MEASURE_MODEL = "yolo26x.pt";
const MEASURE_STORAGE_KEY = "cam-distance:auto-measure:v1";
const EMPTY_CLASSES: SelectedYoloClass[] = [];

function loadStoredMeasurements(): Record<string, AutoMeasurement> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MEASURE_STORAGE_KEY) ?? "{}") as Record<
      string,
      Partial<AutoMeasurement>
    >;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([streamKey, value]) => {
        const classes = Array.isArray(value.classes)
          ? value.classes.flatMap((item) =>
              typeof item?.id === "number" && typeof item?.name === "string"
                ? [{ id: item.id, name: item.name, conf: normalizeClassConfidence(item.conf) }]
                : [],
            ).slice(0, 2)
          : [];
        if (classes.length < 1) return [];
        return [[streamKey, { enabled: value.enabled === true, classes }]];
      }),
    );
  } catch {
    return {};
  }
}

interface Props {
  // calibration 버튼 → App 이 풀페이지 CalibrationPage 로 전환.
  onCalibrate: (cam: Cam) => void;
}

export default function CamerasPage({ onCalibrate }: Props) {
  const [cams, setCams] = useState<Cam[]>([]);
  const [stats, setStats] = useState<Record<string, Stat>>({});
  // 실측 FPS — 그리드의 WhepPlayer 가 WebRTC getStats 로 올려주는 카메라별 디코딩 프레임레이트.
  const [fps, setFps] = useState<Record<string, number>>({});
  // 등록 cap — 백엔드 /api/config(MAX_IPCAMS env)에서 받음. 프론트 하드코딩 제거(P2-1).
  const [maxIpcams, setMaxIpcams] = useState(MAX_IPCAMS_FALLBACK);
  const [formOpen, setFormOpen] = useState(false);
  const [editCam, setEditCam] = useState<Cam | null>(null);
  const [error, setError] = useState("");
  const [autoMeasurements, setAutoMeasurements] = useState<Record<string, AutoMeasurement>>(
    loadStoredMeasurements,
  );
  const [measureTarget, setMeasureTarget] = useState<Cam | null>(null);
  const [measureCanEnable, setMeasureCanEnable] = useState(false);
  const [yoloClasses, setYoloClasses] = useState<YoloClass[]>([]);
  const [measureBusyKey, setMeasureBusyKey] = useState<string | null>(null);
  const [measureSaving, setMeasureSaving] = useState(false);

  const fetchCams = useCallback(async () => {
    const resp = await fetch(`${apiBase()}/api/ipcams`);
    if (!resp.ok) return;
    setCams(await resp.json());
  }, []);

  useEffect(() => {
    fetchCams();
  }, [fetchCams]);

  useEffect(() => {
    window.localStorage.setItem(MEASURE_STORAGE_KEY, JSON.stringify(autoMeasurements));
  }, [autoMeasurements]);

  // 등록 cap 을 백엔드에서 1회 로딩 (없으면 fallback 유지).
  useEffect(() => {
    fetch(`${apiBase()}/api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.max_ipcams) setMaxIpcams(cfg.max_ipcams);
      })
      .catch(() => {});
  }, []);

  // stats 1초 polling — 등록 카메라별 {active, readers} (mediamtx path 상태).
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const entries = await Promise.all(
        cams.map(async (c) => {
          try {
            const resp = await fetch(`${apiBase()}/api/ipcams/${c.stream_key}/stats`);
            if (!resp.ok) return [c.stream_key, { active: false, readers: 0 }] as const;
            return [c.stream_key, (await resp.json()) as Stat] as const;
          } catch {
            return [c.stream_key, { active: false, readers: 0 }] as const;
          }
        })
      );
      if (!cancelled) setStats(Object.fromEntries(entries));
    }
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cams]);

  const online = cams.filter((c) => stats[c.stream_key]?.active).length;
  const atCap = cams.length >= maxIpcams;

  const handleFps = useCallback((key: string, f: number) => {
    setFps((prev) => ({ ...prev, [key]: f }));
  }, []);

  // onSave 계약: 성공이면 null, 실패면 에러메시지(모달이 표시·열린 채 유지). POST 가
  // register-time ffprobe 로 수 초 걸릴 수 있어, 호출측(모달)이 await 하며 로딩상태를 보인다.
  async function handleSave(name: string, rtspUrl: string): Promise<string | null> {
    if (editCam) {
      const resp = await fetch(`${apiBase()}/api/ipcams/${editCam.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rtsp_url: rtspUrl }),
      });
      if (!resp.ok) return "카메라 수정에 실패했습니다.";
    } else {
      const resp = await fetch(`${apiBase()}/api/ipcams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rtsp_url: rtspUrl }),
      });
      if (resp.status === 409) {
        const body = await resp.json().catch(() => ({}));
        return body.detail ?? `최대 ${maxIpcams}대까지 등록할 수 있습니다`;
      }
      if (!resp.ok) return "카메라 등록에 실패했습니다.";
    }
    await fetchCams();
    return null;
  }

  async function deleteCam(cam: Cam) {
    if (!window.confirm(`${cam.name} 삭제?`)) return;
    const resp = await fetch(`${apiBase()}/api/ipcams/${cam.id}`, { method: "DELETE" });
    if (!resp.ok) {
      setError("카메라 삭제에 실패했습니다.");
      return;
    }
    setAutoMeasurements((current) => {
      const next = { ...current };
      delete next[cam.stream_key];
      return next;
    });
    await fetchCams();
  }

  async function openAutoMeasurementSettings(cam: Cam) {
    setError("");
    setMeasureBusyKey(cam.stream_key);
    try {
      const calibrationResp = await fetch(`${apiBase()}/api/ipcams/${cam.stream_key}/calibration`);
      if (!calibrationResp.ok) throw new Error("기준점 정보를 불러오지 못했습니다.");
      const calibration = await calibrationResp.json();
      setMeasureCanEnable(Boolean(calibration.enabled && calibration.homography));

      let availableClasses = yoloClasses;
      if (availableClasses.length === 0) {
        const classesResp = await fetch(
          `${apiBase()}/api/inference/models/${encodeURIComponent(MEASURE_MODEL)}/classes`,
        );
        if (!classesResp.ok) throw new Error("YOLO 클래스 목록을 불러오지 못했습니다.");
        availableClasses = (await classesResp.json()) as YoloClass[];
        setYoloClasses(availableClasses);
      }
      setMeasureTarget(cam);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "자동 측정 설정에 실패했습니다.");
    } finally {
      setMeasureBusyKey(null);
    }
  }

  async function applyAutoMeasurement(enabled: boolean, classes: SelectedYoloClass[]) {
    if (!measureTarget) return;
    setMeasureSaving(true);
    setError("");
    try {
      const resp = await fetch(`${apiBase()}/api/ipcams/${measureTarget.stream_key}/inference`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          enabled
            ? {
                enabled: true,
                models: [MEASURE_MODEL],
                conf_threshold: minimumClassConfidence(classes),
              }
            : { enabled: false },
        ),
      });
      if (!resp.ok) throw new Error("자동 측정 설정을 저장하지 못했습니다.");
      setAutoMeasurements((current) => ({
        ...current,
        [measureTarget.stream_key]: { enabled, classes },
      }));
      setMeasureTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "자동 측정 설정을 저장하지 못했습니다.");
    } finally {
      setMeasureSaving(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-title">
          <h1>실시간 모니터</h1>
          <span className="hint">카메라 연결 상태와 거리 측정 화면을 관리합니다.</span>
        </div>
        <div className="topbar-right">
          <div className="sysbar" role="status">
            <span className={online === cams.length && cams.length > 0 ? "sysbar-state ok" : "sysbar-state warn"}>
              <i className="sysbar-dot" />{online === cams.length && cams.length > 0 ? "시스템 정상" : "상태 확인"}
            </span>
            <span className="sysbar-sep">·</span>
            <span className="sysbar-item mono">온라인 {online}/{cams.length}</span>
          </div>
          <button
            className="btn primary"
            disabled={atCap}
            onClick={() => {
              setEditCam(null);
              setFormOpen(true);
            }}
          >
            ＋ 카메라 등록
          </button>
        </div>
      </header>

      <div className="content cameras-content">
        {error && <p className="form-error">{error}</p>}

        <section className="kpis" aria-label="카메라 현황">
          <div className="panel kpi">
            <div className="kpi-label">전체 카메라</div>
            <div className="kpi-value">{cams.length}<span className="kpi-sub"> 대</span></div>
            <div className="hint">등록된 스트림</div>
          </div>
          <div className="panel kpi kpi-ok">
            <div className="kpi-label">온라인</div>
            <div className="kpi-value">{online}<span className="kpi-sub"> 대</span></div>
            <div className="hint">영상 수신 가능</div>
          </div>
          <div className="panel kpi kpi-muted">
            <div className="kpi-label">오프라인</div>
            <div className="kpi-value">{cams.length - online}<span className="kpi-sub"> 대</span></div>
            <div className="hint">연결 확인 필요</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">등록 용량</div>
            <div className="kpi-value">{cams.length}<span className="kpi-sub"> / {maxIpcams}</span></div>
            <div className="hint">최대 카메라 수</div>
          </div>
        </section>

        <section className="panel table-panel camera-table-panel">
          <div className="panel-head row-between">
            <strong>카메라 목록</strong>
            <span className="hint">상태는 1초마다 자동 갱신</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>카메라</th>
                  <th>RTSP URL</th>
                  <th style={{ width: 110 }}>상태</th>
                  <th style={{ width: 80 }}>FPS</th>
                  <th style={{ width: 330, textAlign: "right" }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {cams.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-cell">등록된 카메라가 없습니다.</td>
                  </tr>
                )}
                {cams.map((cam) => {
                  const st = stats[cam.stream_key];
                  const active = st?.active ?? false;
                  return (
                    <tr key={cam.id}>
                      <td>
                        <div className="cam-id">CAM-{String(cam.id).padStart(2, "0")}</div>
                        <div className="cam-name">{cam.name}</div>
                      </td>
                      <td className="url-cell" title={cam.rtsp_url}>{cam.rtsp_url}</td>
                      <td>
                        <span className={active ? "status status-on" : "status status-off"}>
                          <i className="dot" />{active ? "온라인" : "오프라인"}
                        </span>
                      </td>
                      <td className="mono">{active && fps[cam.stream_key] != null ? fps[cam.stream_key].toFixed(1) : "—"}</td>
                      <td className="table-actions">
                        <button className="btn sm" onClick={() => onCalibrate(cam)}>기준점</button>
                        <button
                          className="btn sm measure-toggle"
                          disabled={measureBusyKey === cam.stream_key}
                          title="자동 거리측정 설정"
                          onClick={() => openAutoMeasurementSettings(cam)}
                        >
                          측정
                        </button>
                        <button
                          className="btn sm"
                          onClick={() => {
                            setEditCam(cam);
                            setFormOpen(true);
                          }}
                        >
                          RTSP 수정
                        </button>
                        <button className="btn sm danger" onClick={() => deleteCam(cam)}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel live-grid-panel">
          <div className="panel-head row-between">
            <div>
              <h2>실시간 카메라</h2>
              <p className="hint">캘리브레이션이 완료된 영상은 바로 확대 측정할 수 있습니다.</p>
            </div>
            <span className="badge none">{cams.length} CH</span>
          </div>
          <div className="live-grid-body">
            <CameraGrid cams={cams} onFps={handleFps} autoMeasurements={autoMeasurements} />
          </div>
        </section>
      </div>

      <CameraFormModal
        open={formOpen}
        editCam={editCam}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
      />
      <MeasurementClassModal
        open={measureTarget != null}
        cameraName={measureTarget?.name ?? ""}
        classes={yoloClasses}
        initialEnabled={
          measureTarget ? autoMeasurements[measureTarget.stream_key]?.enabled ?? false : false
        }
        initialSelection={
          measureTarget
            ? autoMeasurements[measureTarget.stream_key]?.classes ?? EMPTY_CLASSES
            : EMPTY_CLASSES
        }
        canEnable={measureCanEnable}
        saving={measureSaving}
        onClose={() => setMeasureTarget(null)}
        onConfirm={applyAutoMeasurement}
      />
    </>
  );
}
