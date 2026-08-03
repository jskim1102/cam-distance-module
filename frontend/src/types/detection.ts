export interface Detection {
  class_id: number;
  name: string;
  conf: number;
  xyxy: [number, number, number, number];
  model: string;
}

export interface YoloClass {
  id: number;
  name: string;
}

export interface SelectedYoloClass extends YoloClass {
  conf: number;
}

export interface AutoMeasurement {
  enabled: boolean;
  classes: SelectedYoloClass[];
}
