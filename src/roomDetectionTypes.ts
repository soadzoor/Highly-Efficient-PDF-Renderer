import type { Bounds } from "./pdfVectorExtractor";

export const ROOM_CLASSES = [
  "office",
  "toilet",
  "shower",
  "patient_room",
  "exam_treatment",
  "corridor",
  "storage_supply",
  "vertical_transport",
  "building_services",
  "public_waiting",
  "staff_support",
  "other"
] as const;

export type RoomClass = (typeof ROOM_CLASSES)[number] | string;

export interface RoomDetectionClassSpec {
  id: number;
  label: string;
  color: string;
  kind: "room" | "background" | "separator";
}

export interface RoomDetectionThresholds {
  minConfidence: number;
  minAreaPixels: number;
  simplifyTolerancePixels: number;
  maxDetectionsPerPage?: number;
  foregroundIouExperimentalThreshold?: number;
  separatorBarrierProbability?: number;
  separatorBarrierPixels?: number;
  contourExpansionPixels?: number;
  roomSplitErosionPixels?: number;
  doorArcStraightenMaxChordPixels?: number;
  doorArcStraightenMaxDepthPixels?: number;
  doorArcStraightenMinDepthPixels?: number;
  orthogonalizePolygons?: boolean;
  orthogonalSnapAngleDegrees?: number;
  orthogonalMinEdgePixels?: number;
  notchRemovalMaxDepthPixels?: number;
  notchRemovalMaxWidthPixels?: number;
  polygonCleanupMaxPasses?: number;
}

export interface RoomDetectionMetrics {
  status?: string;
  foregroundIou?: number | null;
  meanClassIou?: number | null;
  validationSamples?: number | null;
}

export interface RoomDetectionModelManifest {
  version: string;
  onnxPath: string;
  inputSize: {
    width: number;
    height: number;
  };
  classes: RoomDetectionClassSpec[];
  mean: [number, number, number];
  std: [number, number, number];
  thresholds: RoomDetectionThresholds;
  license: string;
  metrics?: RoomDetectionMetrics;
}

export interface RoomDetectionPageInfo {
  pageIndex: number;
  width: number;
  height: number;
  pageRect: Bounds;
}

export interface RoomDetection {
  id: string;
  pageIndex: number;
  label: RoomClass;
  confidence: number;
  roomNumber?: string;
  polygon: Array<[number, number]>;
  bbox: Bounds;
}

export interface RoomDetectionResult {
  sourceLabel: string;
  modelVersion: string;
  pages: RoomDetectionPageInfo[];
  detections: RoomDetection[];
}

export interface RoomDetectionProgress {
  pageIndex: number;
  pageCount: number;
  stage: "loading-model" | "rendering-page" | "running-model" | "postprocessing" | "complete";
}

export type RoomDetectionProgressCallback = (progress: RoomDetectionProgress) => void;
