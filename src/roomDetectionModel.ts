import { getDocument, VerbosityLevel } from "pdfjs-dist";
import * as ort from "onnxruntime-web/webgpu";

import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import {
  type LetterboxMapping,
  postprocessRoomSegmentation
} from "./roomDetectionPostprocess";
import type {
  RoomDetection,
  RoomDetectionModelManifest,
  RoomDetectionPageInfo,
  RoomDetectionProgressCallback,
  RoomDetectionResult
} from "./roomDetectionTypes";

interface RunRoomDetectionOptions {
  sourceLabel: string;
  pdfBytes: Uint8Array;
  scene: VectorScene;
  maxPages?: number;
  onProgress?: RoomDetectionProgressCallback;
}

interface RenderedPageInput {
  tensor: Float32Array;
  letterbox: LetterboxMapping;
  pageInfo: RoomDetectionPageInfo;
}

interface PdfViewportLike {
  width: number;
  height: number;
  transform?: readonly number[];
}

interface PdfPageLike {
  rotate?: number;
  getViewport: (params: { scale: number; rotation?: number }) => PdfViewportLike;
  render?: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
    intent?: string;
    background?: string;
  }) => { promise: Promise<unknown> };
  getTextContent?: (params?: {
    includeMarkedContent?: boolean;
    disableNormalization?: boolean;
  }) => Promise<{ items?: unknown[] }>;
}

interface RoomNumberCandidate {
  text: string;
  x: number;
  y: number;
}

type PdfDocumentProxy = Awaited<ReturnType<typeof getDocument>["promise"]>;

const MANIFEST_PATH = "models/room-detector/manifest.json";
const PDFJS_VERBOSITY_ERRORS = VerbosityLevel?.ERRORS ?? 0;

let cachedManifest: RoomDetectionModelManifest | null = null;
let cachedSession: ort.InferenceSession | null = null;
let cachedSessionModelUrl = "";
let cachedSessionBackend = "";

export async function loadRoomDetectionManifest(): Promise<RoomDetectionModelManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }

  const manifestUrl = resolveAppAssetUrl(MANIFEST_PATH);
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Room detector manifest is missing (${response.status}).`);
  }

  const manifest = normalizeManifest(await response.json());
  cachedManifest = manifest;
  return manifest;
}

export async function runRoomDetectionOnPdf(options: RunRoomDetectionOptions): Promise<{
  manifest: RoomDetectionModelManifest;
  result: RoomDetectionResult;
}> {
  options.onProgress?.({ pageIndex: 0, pageCount: 0, stage: "loading-model" });
  const manifest = await loadRoomDetectionManifest();
  const session = await loadRoomDetectionSession(manifest);
  const standardFontDataUrl = resolveStandardFontDataUrl();
  const loadingTask = getDocument({
    data: options.pdfBytes.slice(),
    disableFontFace: true,
    fontExtraProperties: true,
    verbosity: PDFJS_VERBOSITY_ERRORS,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {})
  });

  const pages: RoomDetectionPageInfo[] = [];
  const detections: RoomDetection[] = [];

  try {
    const pdf = await loadingTask.promise;
    const availablePageCount = Math.min(readPdfPageCount(pdf), Math.max(1, Math.floor(options.scene.pageRects.length / 4)));
    const requestedPageCount = Number.isFinite(options.maxPages) ? Math.max(1, Math.trunc(Number(options.maxPages))) : availablePageCount;
    const pageCount = Math.min(availablePageCount, requestedPageCount);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) {
      throw new Error("Room detector ONNX model does not expose an input and output tensor.");
    }

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      options.onProgress?.({ pageIndex, pageCount, stage: "rendering-page" });
      const page = await pdf.getPage(pageIndex + 1);
      const pageRect = readPageRect(options.scene, pageIndex);
      const rendered = await renderPageToModelInput(page, manifest, pageRect, pageIndex);
      pages.push(rendered.pageInfo);

      options.onProgress?.({ pageIndex, pageCount, stage: "running-model" });
      const inputTensor = new ort.Tensor("float32", rendered.tensor, [
        1,
        3,
        manifest.inputSize.height,
        manifest.inputSize.width
      ]);
      const output = await session.run({ [inputName]: inputTensor });
      const outputTensor = output[outputName] ?? Object.values(output)[0];
      if (!outputTensor || !(outputTensor.data instanceof Float32Array)) {
        throw new Error("Room detector output tensor must be float32 logits.");
      }

      options.onProgress?.({ pageIndex, pageCount, stage: "postprocessing" });
      const pageDetections = postprocessRoomSegmentation(
        {
          data: outputTensor.data,
          dims: outputTensor.dims
        },
        manifest,
        rendered.letterbox,
        pageRect,
        pageIndex
      );
      await attachRoomNumbersFromPageText(page, pageRect, pageDetections);
      detections.push(...pageDetections);
    }

    options.onProgress?.({ pageIndex: pageCount, pageCount, stage: "complete" });
  } finally {
    await loadingTask.destroy();
  }

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

async function loadRoomDetectionSession(manifest: RoomDetectionModelManifest): Promise<ort.InferenceSession> {
  const modelUrl = resolveAppAssetUrl(manifest.onnxPath);
  const preferredBackend = hasWebGpuSupport() ? "webgpu" : "wasm";
  if (cachedSession && cachedSessionModelUrl === modelUrl && cachedSessionBackend === preferredBackend) {
    return cachedSession;
  }

  await assertModelFileExists(modelUrl);
  ort.env.wasm.wasmPaths = resolveAppAssetUrl("ort/");

  try {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: preferredBackend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
      graphOptimizationLevel: "all"
    });
    cachedSession = session;
    cachedSessionModelUrl = modelUrl;
    cachedSessionBackend = preferredBackend;
    return session;
  } catch (error) {
    if (preferredBackend !== "webgpu") {
      throw error;
    }
    console.warn("[Room detection] WebGPU session failed; retrying with WASM.", error);
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
    cachedSession = session;
    cachedSessionModelUrl = modelUrl;
    cachedSessionBackend = "wasm";
    return session;
  }
}

async function assertModelFileExists(modelUrl: string): Promise<void> {
  const response = await fetch(modelUrl, { method: "HEAD", cache: "no-store" });
  if (response.ok) {
    return;
  }

  throw new Error(
    `Room detector model is not installed at ${modelUrl}. Export a trained ONNX file to public/models/room-detector/model.onnx.`
  );
}

async function renderPageToModelInput(
  page: unknown,
  manifest: RoomDetectionModelManifest,
  pageRect: Bounds,
  pageIndex: number
): Promise<RenderedPageInput> {
  const pageLike = page as PdfPageLike;

  if (typeof pageLike.getViewport !== "function" || typeof pageLike.render !== "function") {
    throw new Error("PDF.js page cannot be rasterized for room detection.");
  }

  const inputWidth = manifest.inputSize.width;
  const inputHeight = manifest.inputSize.height;
  const baseViewport = pageLike.getViewport({
    scale: 1,
    rotation: normalizeRotationDegrees(Number(pageLike.rotate) || 0)
  });
  const baseWidth = Math.max(1, Number(baseViewport.width) || 1);
  const baseHeight = Math.max(1, Number(baseViewport.height) || 1);
  const scale = Math.min(inputWidth / baseWidth, inputHeight / baseHeight);
  const viewport = pageLike.getViewport({
    scale,
    rotation: normalizeRotationDegrees(Number(pageLike.rotate) || 0)
  });
  const renderWidth = Math.max(1, Math.round(Number(viewport.width) || baseWidth * scale));
  const renderHeight = Math.max(1, Math.round(Number(viewport.height) || baseHeight * scale));
  const offsetX = Math.floor((inputWidth - renderWidth) * 0.5);
  const offsetY = Math.floor((inputHeight - renderHeight) * 0.5);
  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = renderWidth;
  renderCanvas.height = renderHeight;
  const renderContext = renderCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!renderContext) {
    throw new Error("Unable to create a PDF page raster canvas.");
  }
  renderContext.fillStyle = "#ffffff";
  renderContext.fillRect(0, 0, renderWidth, renderHeight);
  await pageLike.render({
    canvasContext: renderContext,
    viewport,
    intent: "display",
    background: "#ffffff"
  }).promise;

  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = inputWidth;
  inputCanvas.height = inputHeight;
  const inputContext = inputCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!inputContext) {
    throw new Error("Unable to create a room detection input canvas.");
  }
  inputContext.fillStyle = "#ffffff";
  inputContext.fillRect(0, 0, inputWidth, inputHeight);
  inputContext.drawImage(renderCanvas, offsetX, offsetY);

  const imageData = inputContext.getImageData(0, 0, inputWidth, inputHeight).data;
  const tensor = new Float32Array(3 * inputWidth * inputHeight);
  const planeSize = inputWidth * inputHeight;
  const mean = manifest.mean;
  const std = manifest.std;
  for (let i = 0; i < planeSize; i += 1) {
    const source = i * 4;
    tensor[i] = ((imageData[source] / 255) - mean[0]) / std[0];
    tensor[planeSize + i] = ((imageData[source + 1] / 255) - mean[1]) / std[1];
    tensor[planeSize * 2 + i] = ((imageData[source + 2] / 255) - mean[2]) / std[2];
  }

  renderCanvas.width = 0;
  renderCanvas.height = 0;
  inputCanvas.width = 0;
  inputCanvas.height = 0;

  return {
    tensor,
    letterbox: {
      inputWidth,
      inputHeight,
      sourceWidth: renderWidth,
      sourceHeight: renderHeight,
      scaledWidth: renderWidth,
      scaledHeight: renderHeight,
      offsetX,
      offsetY
    },
    pageInfo: {
      pageIndex,
      width: renderWidth,
      height: renderHeight,
      pageRect
    }
  };
}

async function attachRoomNumbersFromPageText(
  page: unknown,
  pageRect: Bounds,
  detections: RoomDetection[]
): Promise<void> {
  if (detections.length === 0) {
    return;
  }

  const pageLike = page as PdfPageLike;
  if (typeof pageLike.getViewport !== "function" || typeof pageLike.getTextContent !== "function") {
    return;
  }

  let candidates: RoomNumberCandidate[];
  try {
    candidates = await extractRoomNumberCandidates(pageLike, pageRect);
  } catch (error) {
    console.warn("[Room detection] Failed to extract PDF room-number text.", error);
    return;
  }

  if (candidates.length === 0) {
    return;
  }

  const usedCandidateIndexes = new Set<number>();
  const detectionOrder = detections
    .map((detection, index) => ({ index, area: boundsArea(detection.bbox) }))
    .sort((a, b) => a.area - b.area);

  for (const { index } of detectionOrder) {
    const detection = detections[index];
    const match = findBestRoomNumberCandidate(detection, candidates, usedCandidateIndexes);
    if (match === null) {
      continue;
    }
    detection.roomNumber = candidates[match].text;
    usedCandidateIndexes.add(match);
  }
}

async function extractRoomNumberCandidates(
  page: PdfPageLike,
  pageRect: Bounds
): Promise<RoomNumberCandidate[]> {
  const rotation = normalizeRotationDegrees(Number(page.rotate) || 0);
  const viewport = page.getViewport({ scale: 1, rotation });
  const viewportWidth = Math.max(1, Number(viewport.width) || 1);
  const viewportHeight = Math.max(1, Number(viewport.height) || 1);
  const viewportTransform = normalizePdfMatrix(viewport.transform);
  if (!viewportTransform) {
    return [];
  }

  const textContent = await page.getTextContent?.({
    includeMarkedContent: false,
    disableNormalization: false
  });
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  const candidates: RoomNumberCandidate[] = [];

  for (const item of items) {
    const textItem = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    const text = normalizeRoomNumberText(String(textItem.str ?? ""));
    if (!text) {
      continue;
    }

    const textTransform = normalizePdfMatrix(textItem.transform);
    if (!textTransform) {
      continue;
    }

    const viewportTextTransform = multiplyPdfMatrices(viewportTransform, textTransform);
    const textWidth = Math.max(0, Number(textItem.width) || 0);
    const textHeight = Math.max(0, Number(textItem.height) || 0);
    const viewportX = viewportTextTransform[4] + textWidth * 0.5;
    const viewportY = viewportTextTransform[5] - textHeight * 0.5;
    const worldPoint = viewportPointToWorld(viewportX, viewportY, viewportWidth, viewportHeight, pageRect);
    candidates.push({ text, x: worldPoint[0], y: worldPoint[1] });
  }

  return candidates;
}

function normalizeRoomNumberText(value: string): string | null {
  const text = value
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^[#:/-]+|[#:/-]+$/g, "");
  if (text.length < 3 || text.length > 14) {
    return null;
  }
  if ((/[,'"\u00b0]/).test(text)) {
    return null;
  }
  if (!/[0-9]/.test(text)) {
    return null;
  }
  if (/^\d{2,5}[A-Z]?(?:[-.]\d{1,4}[A-Z]?)?$/i.test(text)) {
    return text;
  }
  if (/^[A-Z]{1,4}\d{2,5}[A-Z]?(?:[-.]\d{1,4}[A-Z]?)?$/i.test(text)) {
    return text;
  }
  if (/^\d{1,3}[A-Z]{1,4}$/i.test(text)) {
    return text;
  }
  return null;
}

function findBestRoomNumberCandidate(
  detection: RoomDetection,
  candidates: RoomNumberCandidate[],
  usedCandidateIndexes: Set<number>
): number | null {
  const bboxDiagonal = Math.hypot(
    detection.bbox.maxX - detection.bbox.minX,
    detection.bbox.maxY - detection.bbox.minY
  );
  const maxNearbyDistance = Math.max(20, Math.min(180, bboxDiagonal * 0.3));
  let bestIndex: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < candidates.length; i += 1) {
    if (usedCandidateIndexes.has(i)) {
      continue;
    }

    const candidate = candidates[i];
    const inside = pointInPolygon(candidate.x, candidate.y, detection.polygon);
    const distance = inside ? 0 : distancePointToBounds(candidate.x, candidate.y, detection.bbox);
    if (!inside && distance > maxNearbyDistance) {
      continue;
    }

    const centerDistance = distancePointToBoundsCenter(candidate.x, candidate.y, detection.bbox);
    const score = (inside ? -maxNearbyDistance : distance) + centerDistance * 0.02;
    if (score < bestScore) {
      bestIndex = i;
      bestScore = score;
    }
  }

  return bestIndex;
}

function viewportPointToWorld(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  pageRect: Bounds
): [number, number] {
  const minX = Math.min(pageRect.minX, pageRect.maxX);
  const maxX = Math.max(pageRect.minX, pageRect.maxX);
  const minY = Math.min(pageRect.minY, pageRect.maxY);
  const maxY = Math.max(pageRect.minY, pageRect.maxY);
  const nx = x / viewportWidth;
  const ny = y / viewportHeight;
  return [
    minX + nx * (maxX - minX),
    maxY - ny * (maxY - minY)
  ];
}

function normalizePdfMatrix(value: unknown): [number, number, number, number, number, number] | null {
  if (!Array.isArray(value) && !(ArrayBuffer.isView(value) && "length" in value)) {
    return null;
  }
  const matrix = Array.from(value as ArrayLike<unknown>).slice(0, 6).map(Number);
  if (matrix.length !== 6 || matrix.some((entry) => !Number.isFinite(entry))) {
    return null;
  }
  return [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]];
}

function multiplyPdfMatrices(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number]
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / Math.max(1e-9, yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distancePointToBounds(x: number, y: number, bounds: Bounds): number {
  const minX = Math.min(bounds.minX, bounds.maxX);
  const maxX = Math.max(bounds.minX, bounds.maxX);
  const minY = Math.min(bounds.minY, bounds.maxY);
  const maxY = Math.max(bounds.minY, bounds.maxY);
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return Math.hypot(dx, dy);
}

function distancePointToBoundsCenter(x: number, y: number, bounds: Bounds): number {
  return Math.hypot(x - (bounds.minX + bounds.maxX) * 0.5, y - (bounds.minY + bounds.maxY) * 0.5);
}

function boundsArea(bounds: Bounds): number {
  return Math.abs((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
}

function normalizeManifest(input: unknown): RoomDetectionModelManifest {
  const manifest = input as RoomDetectionModelManifest;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Room detector manifest is invalid.");
  }

  const width = Math.max(1, Math.trunc(Number(manifest.inputSize?.width) || 1024));
  const height = Math.max(1, Math.trunc(Number(manifest.inputSize?.height) || width));
  return {
    ...manifest,
    inputSize: { width, height },
    mean: normalizeTriplet(manifest.mean, [0.485, 0.456, 0.406]),
    std: normalizeTriplet(manifest.std, [0.229, 0.224, 0.225]),
    thresholds: {
      minConfidence: readFiniteNumber(manifest.thresholds?.minConfidence, 0.5),
      minAreaPixels: readFiniteNumber(manifest.thresholds?.minAreaPixels, 128),
      simplifyTolerancePixels: readFiniteNumber(manifest.thresholds?.simplifyTolerancePixels, 2),
      maxDetectionsPerPage: readFiniteNumber(manifest.thresholds?.maxDetectionsPerPage, 512),
      foregroundIouExperimentalThreshold: readFiniteNumber(manifest.thresholds?.foregroundIouExperimentalThreshold, 0.6),
      separatorBarrierProbability: readFiniteNumber(manifest.thresholds?.separatorBarrierProbability, 0.2),
      separatorBarrierPixels: readFiniteNumber(manifest.thresholds?.separatorBarrierPixels, 1),
      contourExpansionPixels: readFiniteNumber(manifest.thresholds?.contourExpansionPixels, 4),
      roomSplitErosionPixels: readFiniteNumber(manifest.thresholds?.roomSplitErosionPixels, 2),
      doorArcStraightenMaxChordPixels: readFiniteNumber(manifest.thresholds?.doorArcStraightenMaxChordPixels, 0),
      doorArcStraightenMaxDepthPixels: readFiniteNumber(manifest.thresholds?.doorArcStraightenMaxDepthPixels, 0),
      doorArcStraightenMinDepthPixels: readFiniteNumber(manifest.thresholds?.doorArcStraightenMinDepthPixels, 0),
      orthogonalizePolygons: readBoolean(manifest.thresholds?.orthogonalizePolygons, false),
      orthogonalSnapAngleDegrees: readFiniteNumber(manifest.thresholds?.orthogonalSnapAngleDegrees, 12),
      orthogonalMinEdgePixels: readFiniteNumber(manifest.thresholds?.orthogonalMinEdgePixels, 8),
      notchRemovalMaxDepthPixels: readFiniteNumber(manifest.thresholds?.notchRemovalMaxDepthPixels, 18),
      notchRemovalMaxWidthPixels: readFiniteNumber(manifest.thresholds?.notchRemovalMaxWidthPixels, 80),
      polygonCleanupMaxPasses: readFiniteNumber(manifest.thresholds?.polygonCleanupMaxPasses, 2)
    }
  };
}

function readFiniteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeTriplet(value: readonly number[] | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) {
    return fallback;
  }
  const a = Number(value[0]);
  const b = Number(value[1]);
  const c = Number(value[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
    return fallback;
  }
  return [a, b, c];
}

function readPdfPageCount(pdf: PdfDocumentProxy): number {
  const count = Number((pdf as { numPages?: unknown }).numPages);
  return Math.max(1, Math.trunc(Number.isFinite(count) ? count : 1));
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

function resolveAppAssetUrl(inputPath: string): string {
  const path = inputPath.replace(/^\/+/, "");
  return new URL(path, window.location.href).toString();
}

function resolveStandardFontDataUrl(): string | undefined {
  if (typeof window === "undefined" || !window.location) {
    return undefined;
  }
  return new URL("pdfjs-standard-fonts/", window.location.href).toString();
}

function normalizeRotationDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function hasWebGpuSupport(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}
