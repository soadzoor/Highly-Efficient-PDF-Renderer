import type { RoomDetectionClassSpec } from "./roomDetectionTypes";
import type { VectorFaceConfig, VectorPrepConfig } from "./vectorRoomPipeline";

// Manifest written by ml/room-detection/export_vector_onnx.py.

export interface VectorRoomModelIo {
  onnxPath: string;
  inputs: Record<string, Array<string | number>>;
  outputs: Record<string, Array<string | number>>;
  classIds?: number[];
}

export interface VectorRoomEncoderConfig {
  featureDim: number;
  edgeDim: number;
  width: number;
  layers: number;
  heads: number;
  knn: number;
}

export interface VectorRoomManifest {
  version: string;
  kind: string;
  featureVersion: number;
  models: {
    encoder: VectorRoomModelIo;
    bridger?: VectorRoomModelIo;
    typeHead?: VectorRoomModelIo;
  };
  encoderConfig: VectorRoomEncoderConfig;
  thresholds: {
    boundaryProbability: number;
    bridgeProbability?: number;
  };
  prep: VectorPrepConfig & Record<string, number>;
  faceExtraction: VectorFaceConfig;
  classes: RoomDetectionClassSpec[];
  license: string;
}
