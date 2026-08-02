import { useState } from "react";
import CamerasPage, { type Cam } from "./pages/CamerasPage";
import CalibrationPage from "./pages/CalibrationPage";
import MeasurePage from "./pages/MeasurePage";

// 단순 데모 — 라우터 없이 view-state 전환(카메라 목록 ↔ calibration 풀페이지 ↔ 측정 뷰).
// calibration 버튼 → 큰 화면에서 기준점 picking. 측정 버튼 → 단일 카메라 측정 뷰(F5).
type View =
  | { name: "cameras" }
  | { name: "calibration"; cam: Cam }
  | { name: "measure"; cam: Cam };

export default function App() {
  const [view, setView] = useState<View>({ name: "cameras" });

  const content = view.name === "calibration"
    ? <CalibrationPage cam={view.cam} onBack={() => setView({ name: "cameras" })} />
    : view.name === "measure"
      ? <MeasurePage cam={view.cam} onClose={() => setView({ name: "cameras" })} />
      : (
        <CamerasPage
          onCalibrate={(cam) => setView({ name: "calibration", cam })}
          onMeasure={(cam) => setView({ name: "measure", cam })}
        />
      );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo"><span aria-hidden="true">◈</span> cam-distance</div>
        <nav className="sidebar-nav" aria-label="현재 화면">
          <div className={view.name === "cameras" ? "sidebar-link active" : "sidebar-link"}>
            실시간 모니터
          </div>
          <div className={view.name === "calibration" ? "sidebar-link active" : "sidebar-link"}>
            기준점 설정
          </div>
          <div className={view.name === "measure" ? "sidebar-link active" : "sidebar-link"}>
            거리 측정
          </div>
        </nav>
        <div className="sidebar-foot">
          <span className="sidebar-foot-label">MEASUREMENT MODULE</span>
          <span>평면 기준 실세계 거리 측정</span>
        </div>
      </aside>
      <div className="main">{content}</div>
    </div>
  );
}
