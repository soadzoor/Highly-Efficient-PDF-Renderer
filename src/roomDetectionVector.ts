import * as ort from "onnxruntime-web/webgpu";

import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { attachRoomNumbersFromPdfBytes } from "./roomDetectionModel";
import type {
  RoomDetection,
  RoomDetectionProgressCallback,
  RoomDetectionResult
} from "./roomDetectionTypes";
import type { VectorRoomManifest } from "./roomDetectionVectorTypes";
import {
  DEFAULT_VECTOR_FACE_CONFIG,
  DEFAULT_VECTOR_PREP_CONFIG,
  type EncodeChunkResult,
  type VectorRoomFace,
  buildBridgeCandidates,
  buildBridgeFeatures,
  buildPageInputs,
  collectPageSegments,
  encodePageTiled,
  extractRoomFaces,
  faceShapeFeatures,
  pooledFaceEmbedding
} from "./vectorRoomPipeline";

const MANIFEST_PATH = "models/room-detector-vector/manifest.json";

// Below this many stroke + fill-outline segments a page is effectively a scan
// (or blank) and the raster CNN fallback is the right tool.
const MIN_SEGMENTS_FOR_VECTOR_DETECTION = 512;

interface RunVectorRoomDetectionOptions {
  sourceLabel: string;
  scene: VectorScene;
  pdfBytes?: Uint8Array;
  maxPages?: number;
  onProgress?: RoomDetectionProgressCallback;
}

interface VectorSessions {
  encoder: ort.InferenceSession;
  bridger: ort.InferenceSession | null;
  typeHead: ort.InferenceSession | null;
}

let cachedManifest: VectorRoomManifest | null = null;
let cachedSessions: VectorSessions | null = null;
let cachedSessionsBackend = "";

export function vectorSceneSupportsRoomDetection(scene: VectorScene): boolean {
  return scene.segmentCount + scene.fillSegmentCount >= MIN_SEGMENTS_FOR_VECTOR_DETECTION;
}

export async function loadVectorRoomManifest(): Promise<VectorRoomManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }
  const response = await fetch(resolveAppAssetUrl(MANIFEST_PATH), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Vector room detector manifest is missing (${response.status}).`);
  }
  const manifest = (await response.json()) as VectorRoomManifest;
  if (!manifest?.models?.encoder?.onnxPath || !manifest.encoderConfig || !manifest.thresholds) {
    throw new Error("Vector room detector manifest is invalid.");
  }
  cachedManifest = manifest;
  return manifest;
}

export async function runVectorRoomDetection(options: RunVectorRoomDetectionOptions): Promise<{
  manifest: VectorRoomManifest;
  result: RoomDetectionResult;
}> {
  options.onProgress?.({ pageIndex: 0, pageCount: 0, stage: "loading-model" });
  const manifest = await loadVectorRoomManifest();
  const sessions = await loadVectorSessions(manifest);
  const scene = options.scene;

  const availablePageCount = Math.max(1, Math.floor(scene.pageRects.length / 4));
  const requestedPageCount = Number.isFinite(options.maxPages)
    ? Math.max(1, Math.trunc(Number(options.maxPages)))
    : availablePageCount;
  const pageCount = Math.min(availablePageCount, requestedPageCount);

  const prepConfig = { ...DEFAULT_VECTOR_PREP_CONFIG, ...manifest.prep };
  const faceConfig = {
    ...DEFAULT_VECTOR_FACE_CONFIG,
    ...manifest.faceExtraction,
    threshold: manifest.thresholds.boundaryProbability
  };
  const classById = new Map(manifest.classes.map((spec) => [spec.id, spec]));
  const detections: RoomDetection[] = [];
  const pages = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageRect = readPageRect(scene, pageIndex);
    pages.push({
      pageIndex,
      width: Math.abs(pageRect.maxX - pageRect.minX),
      height: Math.abs(pageRect.maxY - pageRect.minY),
      pageRect
    });
    options.onProgress?.({ pageIndex, pageCount, stage: "running-model" });

    // Single-page scenes mirror the training dumps exactly (no spatial filter);
    // multi-page scenes assign segments to pages by midpoint.
    const segments = collectPageSegments(scene, availablePageCount > 1 ? pageRect : undefined);
    if (segments.count < 3) {
      continue;
    }

    const inputs = buildPageInputs(segments, pageRect, manifest.encoderConfig.knn);
    const { embedding, probs } = await encodePageTiled(
      inputs,
      { layers: manifest.encoderConfig.layers, width: manifest.encoderConfig.width },
      (features, knnIdx, edge, count) => runEncoderChunk(sessions.encoder, features, knnIdx, edge, count, manifest)
    );

    options.onProgress?.({ pageIndex, pageCount, stage: "postprocessing" });
    const threshold = manifest.thresholds.boundaryProbability;
    let bridgeCoords: Float32Array | null = null;
    if (sessions.bridger && manifest.thresholds.bridgeProbability !== undefined) {
      const boundaryMask = new Uint8Array(segments.count);
      for (let i = 0; i < segments.count; i += 1) {
        boundaryMask[i] = probs[i] >= threshold ? 1 : 0;
      }
      const candidates = buildBridgeCandidates(segments, boundaryMask, prepConfig, pageRect);
      const candidateCount = candidates.segA.length;
      if (candidateCount > 0) {
        const pair = buildBridgeFeatures(segments, candidates, inputs.normalizers);
        const width = manifest.encoderConfig.width;
        const embeddingA = new Float32Array(candidateCount * width);
        const embeddingB = new Float32Array(candidateCount * width);
        for (let c = 0; c < candidateCount; c += 1) {
          embeddingA.set(embedding.subarray(candidates.segA[c] * width, (candidates.segA[c] + 1) * width), c * width);
          embeddingB.set(embedding.subarray(candidates.segB[c] * width, (candidates.segB[c] + 1) * width), c * width);
        }
        const output = await sessions.bridger.run({
          embedding_a: new ort.Tensor("float32", embeddingA, [candidateCount, width]),
          embedding_b: new ort.Tensor("float32", embeddingB, [candidateCount, width]),
          pair_features: new ort.Tensor("float32", pair, [candidateCount, pair.length / candidateCount])
        });
        const scores = output.bridge_prob.data as Float32Array;
        const acceptedCoords: number[] = [];
        for (let c = 0; c < candidateCount; c += 1) {
          if (scores[c] >= manifest.thresholds.bridgeProbability) {
            acceptedCoords.push(
              candidates.coords[c * 4],
              candidates.coords[c * 4 + 1],
              candidates.coords[c * 4 + 2],
              candidates.coords[c * 4 + 3]
            );
          }
        }
        if (acceptedCoords.length > 0) {
          bridgeCoords = Float32Array.from(acceptedCoords);
        }
      }
    }

    const faces = extractRoomFaces(segments, probs, {
      faceConfig,
      prepConfig,
      pageBounds: pageRect,
      bridgeCoords
    });
    if (faces.length > 0 && sessions.typeHead && manifest.models.typeHead?.classIds?.length) {
      await assignFaceClasses(sessions.typeHead, manifest, faces, embedding, pageRect);
    }

    for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
      const face = faces[faceIndex];
      const spec = face.classId !== null ? classById.get(face.classId) : undefined;
      detections.push({
        id: `vector-p${pageIndex}-${faceIndex}`,
        pageIndex,
        label: spec?.label ?? "other",
        confidence: face.meanProbability,
        polygon: face.polygon,
        bbox: polygonBounds(face.polygon)
      });
    }
  }

  if (options.pdfBytes && detections.length > 0) {
    try {
      await attachRoomNumbersFromPdfBytes(options.pdfBytes, scene, detections, pageCount);
    } catch (error) {
      console.warn("[Vector room detection] Failed to attach room numbers.", error);
    }
  }
  options.onProgress?.({ pageIndex: pageCount, pageCount, stage: "complete" });

  return {
    manifest,
    result: {
      sourceLabel: options.sourceLabel,
      modelVersion: manifest.version,
      pages,
      detections
    }
  };
}

async function runEncoderChunk(
  session: ort.InferenceSession,
  features: Float32Array,
  knnIdx: Int32Array,
  edge: Float32Array,
  count: number,
  manifest: VectorRoomManifest
): Promise<EncodeChunkResult> {
  const { knn, featureDim, edgeDim } = manifest.encoderConfig;
  const output = await session.run({
    features: new ort.Tensor("float32", features, [count, featureDim]),
    knn_idx: new ort.Tensor("int32", knnIdx, [count, knn]),
    edge: new ort.Tensor("float32", edge, [count, knn, edgeDim])
  });
  return {
    embedding: output.embedding.data as Float32Array,
    probs: output.boundary_prob.data as Float32Array
  };
}

async function assignFaceClasses(
  session: ort.InferenceSession,
  manifest: VectorRoomManifest,
  faces: VectorRoomFace[],
  embedding: Float32Array,
  pageBounds: Bounds
): Promise<void> {
  const classIds = manifest.models.typeHead?.classIds ?? [];
  const width = manifest.encoderConfig.width;
  const pooled = new Float32Array(faces.length * width);
  const shapes = new Float32Array(faces.length * 6);
  for (let f = 0; f < faces.length; f += 1) {
    pooled.set(pooledFaceEmbedding(embedding, width, faces[f].memberSegments), f * width);
    shapes.set(faceShapeFeatures(faces[f].polygon, pageBounds), f * 6);
  }
  const output = await session.run({
    pooled_embedding: new ort.Tensor("float32", pooled, [faces.length, width]),
    shape_features: new ort.Tensor("float32", shapes, [faces.length, 6])
  });
  const logits = output.type_logits.data as Float32Array;
  const classCount = classIds.length;
  for (let f = 0; f < faces.length; f += 1) {
    let best = 0;
    for (let c = 1; c < classCount; c += 1) {
      if (logits[f * classCount + c] > logits[f * classCount + best]) {
        best = c;
      }
    }
    faces[f].classId = classIds[best];
  }
}

async function loadVectorSessions(manifest: VectorRoomManifest): Promise<VectorSessions> {
  const preferredBackend = hasWebGpuSupport() ? "webgpu" : "wasm";
  if (cachedSessions && cachedSessionsBackend === preferredBackend) {
    return cachedSessions;
  }

  ort.env.wasm.wasmPaths = resolveAppAssetUrl("ort/");
  const create = async (backend: string): Promise<VectorSessions> => {
    const providers: string[] = backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];
    const load = (path: string): Promise<ort.InferenceSession> =>
      ort.InferenceSession.create(resolveAppAssetUrl(path), {
        executionProviders: providers,
        graphOptimizationLevel: "all"
      });
    return {
      encoder: await load(manifest.models.encoder.onnxPath),
      bridger: manifest.models.bridger ? await load(manifest.models.bridger.onnxPath) : null,
      typeHead: manifest.models.typeHead ? await load(manifest.models.typeHead.onnxPath) : null
    };
  };

  try {
    cachedSessions = await create(preferredBackend);
    cachedSessionsBackend = preferredBackend;
  } catch (error) {
    if (preferredBackend !== "webgpu") {
      throw error;
    }
    console.warn("[Vector room detection] WebGPU session failed; retrying with WASM.", error);
    cachedSessions = await create("wasm");
    cachedSessionsBackend = "wasm";
  }
  return cachedSessions;
}

function readPageRect(scene: VectorScene, pageIndex: number): Bounds {
  const offset = pageIndex * 4;
  if (scene.pageRects.length >= offset + 4) {
    const minX = Number(scene.pageRects[offset]);
    const minY = Number(scene.pageRects[offset + 1]);
    const maxX = Number(scene.pageRects[offset + 2]);
    const maxY = Number(scene.pageRects[offset + 3]);
    if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
      return { minX, minY, maxX, maxY };
    }
  }
  return scene.pageBounds;
}

function polygonBounds(polygon: Array<[number, number]>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function resolveAppAssetUrl(inputPath: string): string {
  const path = inputPath.replace(/^\/+/, "");
  return new URL(path, window.location.href).toString();
}

function hasWebGpuSupport(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}
