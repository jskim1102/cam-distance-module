import { useEffect, useMemo, useState } from "react";
import type { SelectedYoloClass, YoloClass } from "../types/detection";
import {
  canApplyMeasurementSettings,
  DEFAULT_CLASS_CONFIDENCE,
  MAX_CLASS_CONFIDENCE,
  MIN_CLASS_CONFIDENCE,
  normalizeClassConfidence,
  PERSON_CLASS_ID,
} from "../utils/detectionPairs";
import Modal from "./Modal";

interface Props {
  open: boolean;
  cameraName: string;
  classes: YoloClass[];
  initialEnabled: boolean;
  initialSelection: SelectedYoloClass[];
  canEnable: boolean;
  saving: boolean;
  onClose: () => void;
  onConfirm: (enabled: boolean, classes: SelectedYoloClass[]) => void;
}

export default function MeasurementClassModal({
  open,
  cameraName,
  classes,
  initialEnabled,
  initialSelection,
  canEnable,
  saving,
  onClose,
  onConfirm,
}: Props) {
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confidenceById, setConfidenceById] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setEnabled(initialEnabled);
    setSelectedIds(initialSelection.slice(0, 2).map((item) => item.id));
    setConfidenceById(
      Object.fromEntries(
        initialSelection.slice(0, 2).map((item) => [item.id, normalizeClassConfidence(item.conf)]),
      ),
    );
  }, [initialEnabled, initialSelection, open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? classes.filter((item) => item.name.toLowerCase().includes(needle)) : classes;
  }, [classes, query]);

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds((current) => current.filter((value) => value !== id));
      return;
    }
    if (selectedIds.length >= 2) return;
    setSelectedIds((current) => [...current, id]);
    setConfidenceById((values) => (
      values[id] == null ? { ...values, [id]: DEFAULT_CLASS_CONFIDENCE } : values
    ));
  };

  const updateConfidence = (id: number, value: number) => {
    setConfidenceById((current) => ({
      ...current,
      [id]: normalizeClassConfidence(value),
    }));
  };

  const confirm = () => {
    const selected = selectedIds
      .map((id) => classes.find((item) => item.id === id))
      .filter((item): item is YoloClass => item != null)
      .map((item) => ({
        ...item,
        conf: normalizeClassConfidence(confidenceById[item.id]),
      }));
    const hasPersonAnchor = selected.some((item) => item.id === PERSON_CLASS_ID);
    if (canApplyMeasurementSettings(enabled, selected.length, canEnable, hasPersonAnchor)) {
      onConfirm(enabled, selected);
    }
  };

  return (
    <Modal open={open} onClose={saving ? () => {} : onClose} title={`${cameraName} · 자동 측정 설정`} maxWidth={620}>
      <div className="measure-state-control">
        <div>
          <strong>자동 거리측정</strong>
          <span className={`measure-state-label ${enabled ? "on" : "off"}`}>
            {enabled ? "ON" : "OFF"}
          </span>
        </div>
        <div className="measure-state-buttons" role="group" aria-label="자동 거리측정 상태">
          <button
            type="button"
            className={`btn sm${!enabled ? " selected" : ""}`}
            disabled={saving}
            aria-pressed={!enabled}
            onClick={() => setEnabled(false)}
          >
            OFF
          </button>
          <button
            type="button"
            className={`btn sm${enabled ? " selected on" : ""}`}
            disabled={saving || !canEnable}
            aria-pressed={enabled}
            onClick={() => setEnabled(true)}
          >
            ON
          </button>
        </div>
      </div>
      {!canEnable && (
        <p className="measure-state-warning">ON으로 설정하려면 기준점을 저장하고 측정을 활성화하세요.</p>
      )}
      <p className="measure-class-help">
        YOLO 탐지 클래스 1~2개와 클래스별 confidence를 설정하세요. 한 개면 같은 클래스 객체의 모든 쌍을 표시합니다. 두 개면 person을 반드시 포함하며, person마다 상대 클래스의 가장 가까운 객체까지 거리 하나만 표시합니다.
      </p>
      <div className="field">
        <label htmlFor="measure-class-search">클래스 검색</label>
        <input
          id="measure-class-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="person, car ..."
          autoFocus
        />
      </div>
      <div className="measure-class-summary" role="status">
        <span>선택 {selectedIds.length}/2</span>
        {selectedIds.map((id) => {
          const item = classes.find((candidate) => candidate.id === id);
          return item ? <span className="measure-class-chip" key={id}>{item.name}</span> : null;
        })}
      </div>
      {enabled && selectedIds.length === 2 && !selectedIds.includes(PERSON_CLASS_ID) && (
        <p className="measure-state-warning">두 클래스를 사용할 때는 person을 반드시 포함하세요.</p>
      )}
      {selectedIds.length > 0 && (
        <div className="measure-confidence-list" aria-label="클래스별 confidence 설정">
          {selectedIds.map((id) => {
            const item = classes.find((candidate) => candidate.id === id);
            if (!item) return null;
            const confidence = normalizeClassConfidence(confidenceById[id]);
            return (
              <label className="measure-confidence-row" key={id}>
                <span className="measure-confidence-name">{item.name}</span>
                <input
                  type="range"
                  min={MIN_CLASS_CONFIDENCE}
                  max={MAX_CLASS_CONFIDENCE}
                  step="0.05"
                  value={confidence}
                  disabled={saving}
                  onChange={(event) => updateConfidence(id, Number(event.target.value))}
                  aria-label={`${item.name} confidence`}
                />
                <output>{confidence.toFixed(2)}</output>
              </label>
            );
          })}
        </div>
      )}
      <div className="measure-class-grid" aria-label="YOLO 클래스 목록">
        {visible.map((item) => {
          const checked = selectedIds.includes(item.id);
          const secondNonPerson = selectedIds.length === 1
            && selectedIds[0] !== PERSON_CLASS_ID
            && item.id !== PERSON_CLASS_ID;
          const disabled = !checked && (selectedIds.length >= 2 || secondNonPerson);
          return (
            <label className={`measure-class-option${checked ? " selected" : ""}`} key={item.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || saving}
                onChange={() => toggle(item.id)}
              />
              <span>{item.name}</span>
            </label>
          );
        })}
        {visible.length === 0 && <p className="measure-class-empty">일치하는 클래스가 없습니다.</p>}
      </div>
      <div className="modal-actions">
        <button className="btn" disabled={saving} onClick={onClose}>취소</button>
        <button
          className="btn primary"
          disabled={
            saving
            || !canApplyMeasurementSettings(
              enabled,
              selectedIds.length,
              canEnable,
              selectedIds.includes(PERSON_CLASS_ID),
            )
          }
          onClick={confirm}
        >
          {saving ? "저장 중…" : "적용"}
        </button>
      </div>
    </Modal>
  );
}
