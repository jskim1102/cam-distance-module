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

  if (view.name === "calibration") {
    return (
      <CalibrationPage cam={view.cam} onBack={() => setView({ name: "cameras" })} />
    );
  }
  if (view.name === "measure") {
    return (
      <MeasurePage cam={view.cam} onClose={() => setView({ name: "cameras" })} />
    );
  }
  return (
    <CamerasPage
      onCalibrate={(cam) => setView({ name: "calibration", cam })}
      onMeasure={(cam) => setView({ name: "measure", cam })}
    />
  );
}
