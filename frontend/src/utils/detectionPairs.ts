import type { Detection, SelectedYoloClass } from "../types/detection";

export type DetectionPair = readonly [Detection, Detection];
export type DetectionPairDistance = (from: Detection, to: Detection) => number | null;

export const DEFAULT_CLASS_CONFIDENCE = 0.5;
export const MIN_CLASS_CONFIDENCE = 0.05;
export const MAX_CLASS_CONFIDENCE = 0.95;
export const PERSON_CLASS_ID = 0;

export function canApplyMeasurementSettings(
  enabled: boolean,
  selectedClassCount: number,
  canEnable: boolean,
  hasPersonAnchor: boolean,
): boolean {
  const validSelection = selectedClassCount === 1
    || (selectedClassCount === 2 && hasPersonAnchor);
  return !enabled || (canEnable && validSelection);
}

export function normalizeClassConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CLASS_CONFIDENCE;
  return Math.min(MAX_CLASS_CONFIDENCE, Math.max(MIN_CLASS_CONFIDENCE, parsed));
}

/** 선택 클래스마다 지정된 confidence를 독립적으로 적용한다. */
export function filterDetectionsByClassConfidence(
  detections: readonly Detection[],
  selectedClasses: readonly SelectedYoloClass[],
): Detection[] {
  const confByClassId = new Map(
    selectedClasses.map((item) => [item.id, normalizeClassConfidence(item.conf)]),
  );
  return detections.filter((det) => {
    const threshold = confByClassId.get(det.class_id);
    return threshold != null && det.conf >= threshold;
  });
}

/** 백엔드는 단일 threshold만 받으므로 선택값 중 최솟값으로 필요한 bbox를 모두 수신한다. */
export function minimumClassConfidence(selectedClasses: readonly SelectedYoloClass[]): number {
  return selectedClasses.length > 0
    ? Math.min(...selectedClasses.map((item) => normalizeClassConfidence(item.conf)))
    : DEFAULT_CLASS_CONFIDENCE;
}

/**
 * 자동 거리측정용 bbox 쌍을 만든다.
 *
 * - 클래스 1개: 해당 클래스 detection의 모든 고유 쌍(i < j)
 * - 클래스 2개: person을 anchor로 삼아 각 person의 가장 가까운 상대 1개
 *   (상대 bbox 재사용 허용, person 없는 조합은 빈 배열)
 * - 그 외: UI 계약 밖의 입력이므로 빈 배열
 */
export function buildDetectionPairs(
  detections: readonly Detection[],
  selectedClassIds: readonly number[],
  distanceBetween: DetectionPairDistance = (from, to) => {
    const fromX = (from.xyxy[0] + from.xyxy[2]) / 2;
    const fromY = from.xyxy[3];
    const toX = (to.xyxy[0] + to.xyxy[2]) / 2;
    const toY = to.xyxy[3];
    return Math.hypot(toX - fromX, toY - fromY);
  },
): DetectionPair[] {
  const uniqueIds = [...new Set(selectedClassIds)];
  if (uniqueIds.length === 1) {
    const sameClass = detections.filter((det) => det.class_id === uniqueIds[0]);
    const pairs: DetectionPair[] = [];
    for (let i = 0; i < sameClass.length; i += 1) {
      for (let j = i + 1; j < sameClass.length; j += 1) {
        pairs.push([sameClass[i], sameClass[j]]);
      }
    }
    return pairs;
  }

  if (uniqueIds.length === 2) {
    if (!uniqueIds.includes(PERSON_CLASS_ID)) return [];
    const targetClassId = uniqueIds.find((id) => id !== PERSON_CLASS_ID);
    if (targetClassId == null) return [];
    const anchors = detections.filter((det) => det.class_id === PERSON_CLASS_ID);
    const candidates = detections.filter((det) => det.class_id === targetClassId);
    if (anchors.length === 0 || candidates.length === 0) return [];

    return anchors.flatMap((anchor): DetectionPair[] => {
      let nearest: Detection | null = null;
      let shortest = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const distance = distanceBetween(anchor, candidate);
        if (distance == null || !Number.isFinite(distance) || distance >= shortest) continue;
        shortest = distance;
        nearest = candidate;
      }
      return nearest ? [[anchor, nearest]] : [];
    });
  }

  return [];
}
