import { describe, expect, it } from "vitest";
import type { Detection } from "../types/detection";
import {
  buildDetectionPairs,
  canApplyMeasurementSettings,
  filterDetectionsByClassConfidence,
  minimumClassConfidence,
} from "./detectionPairs";

function det(classId: number, name: string, x: number, conf = 0.9): Detection {
  return {
    class_id: classId,
    name,
    conf,
    xyxy: [x, 0, x + 10, 10],
    model: "yolo26x.pt",
  };
}

describe("buildDetectionPairs", () => {
  it("선택 클래스가 하나면 그 클래스 bbox끼리만 모든 고유 쌍을 만든다", () => {
    const p1 = det(0, "person", 0);
    const p2 = det(0, "person", 20);
    const p3 = det(0, "person", 40);
    const car = det(2, "car", 60);

    expect(buildDetectionPairs([p1, p2, car, p3], [0])).toEqual([
      [p1, p2],
      [p1, p3],
      [p2, p3],
    ]);
  });

  it("2클래스에서는 각 person마다 상대 클래스의 최단거리 1개만 만든다", () => {
    const p1 = det(0, "person", 0);
    const p2 = det(0, "person", 100);
    const c1 = det(2, "car", 10);
    const c2 = det(2, "car", 80);

    expect(
      buildDetectionPairs(
        [p1, c1, p2, c2],
        [0, 2],
        (from, to) => Math.abs(from.xyxy[0] - to.xyxy[0]),
      ),
    ).toEqual([[p1, c1], [p2, c2]]);
  });

  it("2개 대 1개면 상대 bbox를 재사용해 최단거리 2개를 만든다", () => {
    const p1 = det(0, "person", 0);
    const p2 = det(0, "person", 100);
    const chair = det(56, "chair", 40);

    expect(
      buildDetectionPairs(
        [p1, chair, p2],
        [56, 0],
        (from, to) => Math.abs(from.xyxy[0] - to.xyxy[0]),
      ),
    ).toEqual([[p1, chair], [p2, chair]]);
  });

  it("person 1개와 상대 bbox 2개면 가장 가까운 거리 1개만 만든다", () => {
    const person = det(0, "person", 50);
    const nearChair = det(56, "chair", 60);
    const farChair = det(56, "chair", 150);

    expect(
      buildDetectionPairs(
        [farChair, person, nearChair],
        [56, 0],
        (from, to) => Math.abs(from.xyxy[0] - to.xyxy[0]),
      ),
    ).toEqual([[person, nearChair]]);
  });

  it("2클래스 선택에 person이 없으면 거리 쌍을 만들지 않는다", () => {
    const car = det(2, "car", 0);
    const bicycle = det(1, "bicycle", 20);
    expect(buildDetectionPairs([car, bicycle], [2, 1])).toEqual([]);
  });

  it("중복 클래스 ID는 하나로 정규화하고 1~2개 밖의 선택은 거부한다", () => {
    const p1 = det(0, "person", 0);
    const p2 = det(0, "person", 20);
    expect(buildDetectionPairs([p1, p2], [0, 0])).toEqual([[p1, p2]]);
    expect(buildDetectionPairs([p1, p2], [])).toEqual([]);
    expect(buildDetectionPairs([p1, p2], [0, 1, 2])).toEqual([]);
  });
});

describe("filterDetectionsByClassConfidence", () => {
  it("선택한 클래스마다 서로 다른 confidence 임계값을 적용한다", () => {
    const personLow = det(0, "person", 0, 0.49);
    const personAtThreshold = det(0, "person", 20, 0.5);
    const carLow = det(2, "car", 40, 0.79);
    const carHigh = det(2, "car", 60, 0.81);
    const unselected = det(5, "bus", 80, 0.99);

    expect(
      filterDetectionsByClassConfidence(
        [personLow, personAtThreshold, carLow, carHigh, unselected],
        [
          { id: 0, name: "person", conf: 0.5 },
          { id: 2, name: "car", conf: 0.8 },
        ],
      ),
    ).toEqual([personAtThreshold, carHigh]);
  });

  it("백엔드 수집 임계값은 선택 클래스 confidence 중 최솟값을 사용한다", () => {
    expect(
      minimumClassConfidence([
        { id: 0, name: "person", conf: 0.7 },
        { id: 2, name: "car", conf: 0.35 },
      ]),
    ).toBe(0.35);
  });
});

describe("canApplyMeasurementSettings", () => {
  it("OFF는 클래스 선택 없이 적용할 수 있다", () => {
    expect(canApplyMeasurementSettings(false, 0, false, false)).toBe(true);
  });

  it("ON의 2클래스 선택은 활성 기준점과 person anchor가 필요하다", () => {
    expect(canApplyMeasurementSettings(true, 1, false, false)).toBe(false);
    expect(canApplyMeasurementSettings(true, 0, true, false)).toBe(false);
    expect(canApplyMeasurementSettings(true, 1, true, false)).toBe(true);
    expect(canApplyMeasurementSettings(true, 2, true, false)).toBe(false);
    expect(canApplyMeasurementSettings(true, 2, true, true)).toBe(true);
    expect(canApplyMeasurementSettings(true, 3, true, true)).toBe(false);
  });
});
