export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedObject {
  class: string;
  score: number;
  bbox: BoundingBox;
}
