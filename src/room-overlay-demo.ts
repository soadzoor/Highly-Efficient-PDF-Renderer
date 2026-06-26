import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { pdfObjectGenerator, type HeprThreePdfObject, type PDFLoadProgress } from "./index";
import { formatLoadProgressStage } from "./loadProgress";
import { runRoomDetectionOnPdf } from "./roomDetectionModel";
import type { RoomDetection, RoomDetectionResult } from "./roomDetectionTypes";

const CAMERA_FIT_PADDING_PIXELS = 64;
const CAMERA_CLIP_NEAR_MIN = 0.01;
const CAMERA_CLIP_MARGIN_MULTIPLIER = 3.5;
const MIN_OBJECT_EXTENT = 1e-3;
const DEFAULT_CAMERA_FOV_DEGREES = 45;
const OVERLAY_Z = 0.02;
const OVERLAY_FILL_OPACITY = 0.34;
const OVERLAY_RENDER_ORDER = 1_000_000;

type Mat2D = [number, number, number, number, number, number];

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RoomPoint {
  x: number;
  y: number;
}

interface RoomPolygon {
  id: string;
  roomType: string;
  roomNumber: string;
  points: RoomPoint[];
}

interface ParsedRoomTsv {
  fileName: string;
  rooms: RoomPolygon[];
  skippedRows: number;
}

interface RoomOverlay {
  group: THREE.Group;
  fillGeometry: THREE.BufferGeometry | null;
  fillMaterial: THREE.MeshBasicMaterial | null;
  lineGeometry: THREE.BufferGeometry | null;
  lineMaterial: THREE.LineBasicMaterial | null;
  labelElements: RoomLabelElement[];
  roomCount: number;
  labelCount: number;
  skippedRows: number;
  triangleCount: number;
  edgeCount: number;
  fileName: string;
}

interface RoomLabelElement {
  element: HTMLDivElement;
  anchor: THREE.Vector3;
}

interface PdfCoordinateTransform {
  matrix: Mat2D;
}

interface GeneratedRoomTsv {
  fileName: string;
  text: string;
  rowCount: number;
}

interface ClassifiedRoomDemoFiles {
  pdfFile: File | null;
  tsvFile: File | null;
  error: string | null;
}

if (!GlobalWorkerOptions.workerSrc) {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const canvas = requireElement<HTMLCanvasElement>("#viewport");
const loadFilesButton = requireElement<HTMLButtonElement>("#load-files");
const detectRoomsButton = requireElement<HTMLButtonElement>("#detect-rooms");
const downloadGeneratedTsvButton = requireElement<HTMLButtonElement>("#download-generated-tsv");
const clearTsvButton = requireElement<HTMLButtonElement>("#clear-tsv");
const showRoomLabelsCheckbox = requireElement<HTMLInputElement>("#show-room-labels");
const fileInput = requireElement<HTMLInputElement>("#file-input");
const roomLabelLayer = requireElement<HTMLDivElement>("#room-label-layer");
const statusElement = requireElement<HTMLDivElement>("#status");
const pdfValue = requireElement<HTMLSpanElement>("#pdf-value");
const tsvValue = requireElement<HTMLSpanElement>("#tsv-value");
const roomsValue = requireElement<HTMLSpanElement>("#rooms-value");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  depth: true,
  stencil: false,
  premultipliedAlpha: false,
  powerPreference: "high-performance"
});
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
renderer.setClearColor(new THREE.Color().setRGB(160 / 255, 169 / 255, 175 / 255, THREE.SRGBColorSpace), 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  DEFAULT_CAMERA_FOV_DEGREES,
  resolveCanvasAspect(),
  CAMERA_CLIP_NEAR_MIN,
  2000
);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

const controls = new MapControls(camera, canvas);
controls.enableDamping = false;
controls.enableRotate = true;
controls.screenSpacePanning = true;
controls.addEventListener("change", requestRender);

const tempObjectBounds = new THREE.Box3();
const tempObjectSize = new THREE.Vector3();
const tempObjectCenter = new THREE.Vector3();
const tempViewDirection = new THREE.Vector3();
const tempClipDelta = new THREE.Vector3();
const tempRoomLabelWorldPosition = new THREE.Vector3();
const currentContentCenter = new THREE.Vector3();
let currentContentRadius = 10;
let currentPdfObject: HeprThreePdfObject | null = null;
let currentPdfFile: File | null = null;
let currentRoomOverlay: RoomOverlay | null = null;
let currentParsedTsv: ParsedRoomTsv | null = null;
let currentGeneratedTsv: GeneratedRoomTsv | null = null;
let currentPdfCoordinateTransform: PdfCoordinateTransform = createIdentityPdfCoordinateTransform();
let loadToken = 0;
let roomDetectionToken = 0;
let animationFrameId = 0;
let needsRender = false;
let isDisposed = false;
let isBusy = false;

resizeRenderer();
requestRender();
syncControlsEnabled();

loadFilesButton.addEventListener("click", () => {
  fileInput.click();
});

clearTsvButton.addEventListener("click", () => {
  clearRoomOverlay();
  setStatus(currentPdfObject ? "TSV overlay cleared." : "Load a PDF to begin.");
});

detectRoomsButton.addEventListener("click", () => {
  void detectRoomsForCurrentPdf();
});

downloadGeneratedTsvButton.addEventListener("click", () => {
  downloadGeneratedTsv();
});

showRoomLabelsCheckbox.addEventListener("change", () => {
  updateRoomLabelVisibility();
  requestRender();
});

fileInput.addEventListener("change", () => {
  void loadFiles(fileInput.files ?? [], "picker");
  fileInput.value = "";
});

window.addEventListener("resize", () => {
  resizeRenderer();
  requestRender();
});

window.addEventListener("dragenter", handleWindowFileDrag);
window.addEventListener("dragover", handleWindowFileDrag);
window.addEventListener("dragleave", handleWindowFileDrag);
window.addEventListener("drop", (event) => {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  void loadFiles(event.dataTransfer?.files ?? [], "drop");
});

window.addEventListener("beforeunload", disposeDemo);

if (import.meta.hot) {
  import.meta.hot.dispose(disposeDemo);
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

async function loadFiles(files: FileList | File[], _source: "picker" | "drop"): Promise<void> {
  if (isBusy) {
    setStatus("A file load is already in progress.");
    return;
  }

  const classified = classifyRoomDemoFiles(files);
  if (classified.error) {
    setStatus(classified.error);
    return;
  }

  const { pdfFile, tsvFile } = classified;
  if (!pdfFile && !tsvFile) {
    setStatus("Select or drop a PDF, a TSV, or one of each.");
    return;
  }

  if (!pdfFile && tsvFile && !currentPdfObject) {
    setStatus("Load or drop a PDF with this TSV first.");
    return;
  }

  if (pdfFile) {
    const pdfLoaded = await loadPdf(pdfFile);
    if (!pdfLoaded || !tsvFile) {
      return;
    }
  }

  if (tsvFile) {
    await loadTsv(tsvFile);
  }
}

function classifyRoomDemoFiles(files: FileList | File[]): ClassifiedRoomDemoFiles {
  const supportedPdfFiles: File[] = [];
  const supportedTsvFiles: File[] = [];

  for (const file of Array.from(files)) {
    if (isPdfFile(file)) {
      supportedPdfFiles.push(file);
      continue;
    }

    if (isTsvFile(file)) {
      supportedTsvFiles.push(file);
    }
  }

  if (supportedPdfFiles.length > 1) {
    return {
      pdfFile: null,
      tsvFile: null,
      error: "Select or drop only one PDF at a time."
    };
  }

  if (supportedTsvFiles.length > 1) {
    return {
      pdfFile: null,
      tsvFile: null,
      error: "Select or drop only one TSV at a time."
    };
  }

  if (supportedPdfFiles.length === 0 && supportedTsvFiles.length === 0) {
    return {
      pdfFile: null,
      tsvFile: null,
      error: "Select or drop a PDF, a TSV, or one of each."
    };
  }

  return {
    pdfFile: supportedPdfFiles[0] ?? null,
    tsvFile: supportedTsvFiles[0] ?? null,
    error: null
  };
}

function isPdfFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return file.type === "application/pdf" || lowerName.endsWith(".pdf");
}

function isTsvFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return file.type === "text/tab-separated-values" || lowerName.endsWith(".tsv");
}

function handleWindowFileDrag(event: DragEvent): void {
  if (!isFileDrag(event)) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

async function loadPdf(file: File): Promise<boolean> {
  const activeToken = ++loadToken;
  setBusy(true);
  setStatus(`Loading ${file.name}...`);
  clearCurrentPdfObject();
  setBusy(true);

  try {
    const pdfObject = await pdfObjectGenerator(
      file,
      {
        vectorLod: "auto",
        pageBackground: "#ffffff",
        pageBackgroundOpacity: 1,
        onProgress: (progress) => updatePdfLoadProgress(activeToken, file.name, progress)
      },
      "webgl"
    );

    if (activeToken !== loadToken) {
      pdfObject.dispose();
      return false;
    }

    currentPdfCoordinateTransform = await readFirstPageCoordinateTransform(file);
    if (activeToken !== loadToken) {
      pdfObject.dispose();
      return false;
    }

    currentPdfObject = pdfObject;
    currentPdfFile = file;
    currentGeneratedTsv = null;
    pdfObject.renderer.setInteractionViewportProvider(() => renderer.domElement.getBoundingClientRect());
    scene.add(pdfObject);
    pdfValue.textContent = pdfObject.sourceLabel;
    fitCameraToObject(pdfObject);
    setStatus(`${file.name} loaded. Add a TSV overlay.`);
    return true;
  } catch (error) {
    if (activeToken !== loadToken) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load PDF: ${message}`);
    return false;
  } finally {
    if (activeToken === loadToken) {
      setBusy(false);
      syncControlsEnabled();
      requestRender();
    }
  }
}

async function loadTsv(file: File): Promise<boolean> {
  if (!currentPdfObject) {
    setStatus("Load a PDF before adding a TSV overlay.");
    return false;
  }

  setBusy(true);
  setStatus(`Loading ${file.name}...`);

  try {
    const text = await file.text();
    currentGeneratedTsv = null;
    currentParsedTsv = parseRoomTsv(text, file.name);
    rebuildCurrentRoomOverlay();
    setStatus(formatOverlayStatus(currentRoomOverlay));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load TSV: ${message}`);
    return false;
  } finally {
    setBusy(false);
    syncControlsEnabled();
    requestRender();
  }
}

async function detectRoomsForCurrentPdf(): Promise<void> {
  if (isBusy) {
    setStatus("A file load or detection is already in progress.");
    return;
  }

  const pdfObject = currentPdfObject;
  const pdfFile = currentPdfFile;
  if (!pdfObject || !pdfFile) {
    setStatus("Load a PDF before running room detection.");
    return;
  }

  const activeToken = ++roomDetectionToken;
  setBusy(true);
  setStatus("Preparing room detection...");

  try {
    const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
    if (activeToken !== roomDetectionToken) {
      return;
    }

    const { manifest, result } = await runRoomDetectionOnPdf({
      sourceLabel: pdfObject.sourceLabel,
      pdfBytes,
      scene: pdfObject.sceneData,
      maxPages: 1,
      onProgress: (progress) => {
        if (activeToken !== roomDetectionToken) {
          return;
        }
        if (progress.stage === "loading-model") {
          setStatus("Loading room detector model...");
          return;
        }
        if (progress.stage === "complete") {
          setStatus("Generating TSV from room detections...");
          return;
        }
        setStatus(
          `Room detection ${progress.stage.replace(/-/g, " ")}: page ${progress.pageIndex + 1}/${Math.max(1, progress.pageCount)}`
        );
      }
    });
    if (activeToken !== roomDetectionToken) {
      return;
    }

    const generated = createGeneratedRoomTsv(result, currentPdfCoordinateTransform, pdfObject.sourceLabel);
    if (generated.rowCount <= 0) {
      clearRoomOverlay();
      setStatus(`Room detector ${manifest.version} did not return any first-page room polygons.`);
      return;
    }

    const parsedTsv = parseRoomTsv(generated.text, generated.fileName);
    disposeRoomOverlay();
    currentGeneratedTsv = generated;
    currentParsedTsv = parsedTsv;
    rebuildCurrentRoomOverlay();
    setStatus(
      `Detected ${generated.rowCount.toLocaleString()} room${generated.rowCount === 1 ? "" : "s"} with ${manifest.version}; generated ${generated.fileName}.`
    );
  } catch (error) {
    if (activeToken !== roomDetectionToken) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Room detection failed: ${message}`);
  } finally {
    if (activeToken === roomDetectionToken) {
      setBusy(false);
      syncControlsEnabled();
      requestRender();
    }
  }
}

function createGeneratedRoomTsv(
  result: RoomDetectionResult,
  pdfCoordinateTransform: PdfCoordinateTransform,
  sourceLabel: string
): GeneratedRoomTsv {
  const inverseMatrix = invertMatrix(pdfCoordinateTransform.matrix);
  if (!inverseMatrix) {
    throw new Error("Unable to invert the PDF coordinate transform for TSV generation.");
  }

  const rows = ["boundaryID\tboundaryType\troomType\troomNumber\tgeometryData"];
  let rowCount = 0;
  for (const detection of result.detections) {
    if (detection.pageIndex !== 0) {
      continue;
    }
    const geometryData = roomDetectionPolygonToGeometryData(detection, inverseMatrix);
    if (!geometryData) {
      continue;
    }
    rowCount += 1;
    rows.push([
      formatTsvCell(`det-${String(rowCount).padStart(4, "0")}`),
      "Room",
      formatTsvCell(String(detection.label)),
      formatTsvCell(detection.roomNumber ?? ""),
      formatTsvCell(geometryData)
    ].join("\t"));
  }

  return {
    fileName: `${sanitizeDownloadName(sourceLabel.replace(/\.pdf$/i, ""))}-detected-rooms.tsv`,
    text: `${rows.join("\n")}\n`,
    rowCount
  };
}

function roomDetectionPolygonToGeometryData(detection: RoomDetection, inverseMatrix: Mat2D): string | null {
  if (detection.polygon.length < 3) {
    return null;
  }
  const points = detection.polygon
    .map(([x, y]) => applyMatrix(inverseMatrix, x, y))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: roundTsvCoordinate(point.x),
      y: roundTsvCoordinate(point.y)
    }));
  return points.length >= 3 ? JSON.stringify(points) : null;
}

function downloadGeneratedTsv(): void {
  if (!currentGeneratedTsv) {
    setStatus("No generated TSV is available to download.");
    return;
  }
  const blob = new Blob([currentGeneratedTsv.text], {
    type: "text/tab-separated-values;charset=utf-8"
  });
  triggerBrowserDownload(blob, currentGeneratedTsv.fileName);
}

function rebuildCurrentRoomOverlay(): void {
  if (!currentPdfObject || !currentParsedTsv) {
    return;
  }

  disposeRoomOverlay();
  currentRoomOverlay = createRoomOverlay(currentParsedTsv, currentPdfObject, currentPdfCoordinateTransform);
  currentPdfObject.add(currentRoomOverlay.group);
  updateRoomMetrics();
  syncControlsEnabled();
  requestRender();
}

function parseRoomTsv(text: string, fileName: string): ParsedRoomTsv {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("The TSV has no room rows.");
  }

  const headers = lines[0].split("\t").map((header) => header.trim());
  const geometryIndex = findHeaderIndex(headers, "geometryData");
  if (geometryIndex < 0) {
    throw new Error("The TSV is missing a geometryData column.");
  }

  const boundaryIdIndex = findHeaderIndex(headers, "boundaryID");
  const roomTypeIndex = findHeaderIndex(headers, "roomType");
  const roomNumberIndex = findHeaderIndex(headers, "roomNumber");
  const rooms: RoomPolygon[] = [];
  let skippedRows = 0;

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cells = lines[rowIndex].split("\t");
    const rawGeometry = normalizeTsvCell(cells[geometryIndex] ?? "");
    const points = parseGeometryPoints(rawGeometry);
    if (points.length < 3) {
      skippedRows += 1;
      continue;
    }

    const boundaryId = boundaryIdIndex >= 0 ? cells[boundaryIdIndex]?.trim() : "";
    rooms.push({
      id: boundaryId || `row-${rowIndex + 1}`,
      roomType: roomTypeIndex >= 0 ? normalizeTsvCell(cells[roomTypeIndex] ?? "") : "",
      roomNumber: roomNumberIndex >= 0 ? normalizeTsvCell(cells[roomNumberIndex] ?? "") : "",
      points
    });
  }

  if (rooms.length === 0) {
    throw new Error("No room polygons were found in geometryData.");
  }

  return {
    fileName,
    rooms,
    skippedRows
  };
}

function parseGeometryPoints(rawGeometry: string): RoomPoint[] {
  if (!rawGeometry) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawGeometry);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const points: RoomPoint[] = [];
  for (const item of parsed) {
    const record = item as { x?: unknown; y?: unknown };
    const x = Number(record.x);
    const y = Number(record.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const previous = points[points.length - 1];
    if (previous && Math.abs(previous.x - x) <= 1e-9 && Math.abs(previous.y - y) <= 1e-9) {
      continue;
    }
    points.push({ x, y });
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && Math.abs(first.x - last.x) <= 1e-9 && Math.abs(first.y - last.y) <= 1e-9) {
    points.pop();
  }

  return points;
}

function createRoomOverlay(
  parsedTsv: ParsedRoomTsv,
  pdfObject: HeprThreePdfObject,
  pdfCoordinateTransform: PdfCoordinateTransform
): RoomOverlay {
  const fitBounds = normalizeBounds(resolveSceneFitBounds(pdfObject.sceneData));
  const centerX = (fitBounds.minX + fitBounds.maxX) * 0.5;
  const centerY = (fitBounds.minY + fitBounds.maxY) * 0.5;
  const fillPositions: number[] = [];
  const fillColors: number[] = [];
  const linePositions: number[] = [];
  const lineColors: number[] = [];
  const labelElements: RoomLabelElement[] = [];
  let triangleCount = 0;
  let edgeCount = 0;
  let labelCount = 0;

  for (let roomIndex = 0; roomIndex < parsedTsv.rooms.length; roomIndex += 1) {
    const room = parsedTsv.rooms[roomIndex];
    const fillColor = createRoomColor(room.id, roomIndex);
    const lineColor = fillColor.clone().offsetHSL(0, 0.08, -0.18);
    const localPoints = room.points.map((point) => toLocalPoint(
      point,
      centerX,
      centerY,
      pdfCoordinateTransform.matrix
    ));
    const triangles = THREE.ShapeUtils.triangulateShape(localPoints, []);

    for (const triangle of triangles) {
      if (triangle.length !== 3) {
        continue;
      }
      for (const pointIndex of triangle) {
        const point = localPoints[pointIndex];
        if (!point) {
          continue;
        }
        fillPositions.push(point.x, point.y, OVERLAY_Z);
        fillColors.push(fillColor.r, fillColor.g, fillColor.b);
      }
      triangleCount += 1;
    }

    for (let i = 0; i < localPoints.length; i += 1) {
      const start = localPoints[i];
      const end = localPoints[(i + 1) % localPoints.length];
      linePositions.push(start.x, start.y, OVERLAY_Z, end.x, end.y, OVERLAY_Z);
      lineColors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.r, lineColor.g, lineColor.b);
      edgeCount += 1;
    }

    const labelLines = formatRoomLabelLines(room);
    if (labelLines.length > 0 && localPoints.length >= 3) {
      const labelElement = createRoomLabelElement(labelLines, lineColor, localPoints);
      labelElements.push(labelElement);
      roomLabelLayer.append(labelElement.element);
      labelCount += 1;
    }
  }

  const group = new THREE.Group();
  group.name = "TSV room overlay";

  let fillGeometry: THREE.BufferGeometry | null = null;
  let fillMaterial: THREE.MeshBasicMaterial | null = null;
  if (fillPositions.length > 0) {
    fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
    fillGeometry.setAttribute("color", new THREE.Float32BufferAttribute(fillColors, 3));
    fillGeometry.computeBoundingSphere();
    fillMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: OVERLAY_FILL_OPACITY,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.name = "TSV room fills";
    fillMesh.renderOrder = OVERLAY_RENDER_ORDER;
    group.add(fillMesh);
  }

  let lineGeometry: THREE.BufferGeometry | null = null;
  let lineMaterial: THREE.LineBasicMaterial | null = null;
  if (linePositions.length > 0) {
    lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    lineGeometry.computeBoundingSphere();
    lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 1,
      transparent: false,
      depthTest: false,
      depthWrite: false
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.name = "TSV room outlines";
    lines.renderOrder = OVERLAY_RENDER_ORDER + 1;
    group.add(lines);
  }

  return {
    group,
    fillGeometry,
    fillMaterial,
    lineGeometry,
    lineMaterial,
    labelElements,
    roomCount: parsedTsv.rooms.length,
    labelCount,
    skippedRows: parsedTsv.skippedRows,
    triangleCount,
    edgeCount,
    fileName: parsedTsv.fileName
  };
}

function toLocalPoint(
  point: RoomPoint,
  centerX: number,
  centerY: number,
  pdfCoordinateMatrix: Mat2D
): THREE.Vector2 {
  const transformed = applyMatrix(pdfCoordinateMatrix, point.x, point.y);
  return new THREE.Vector2(transformed.x - centerX, transformed.y - centerY);
}

function formatRoomLabelLines(room: RoomPolygon): string[] {
  const roomNumber = room.roomNumber.trim();
  const roomType = room.roomType.trim();
  if (roomNumber && roomType) {
    return [roomNumber, roomType];
  }
  if (roomNumber) {
    return [roomNumber];
  }
  if (roomType) {
    return [roomType];
  }
  return [];
}

function createRoomLabelElement(
  lines: string[],
  color: THREE.Color,
  localPoints: THREE.Vector2[]
): RoomLabelElement {
  const centroid = computeLocalPolygonCentroid(localPoints);
  const element = document.createElement("div");
  element.className = "room-label-pill";
  element.style.setProperty("--room-label-color", `#${color.getHexString(THREE.SRGBColorSpace)}`);
  for (const line of lines) {
    const span = document.createElement("span");
    span.textContent = line;
    element.append(span);
  }
  return {
    element,
    anchor: new THREE.Vector3(centroid.x, centroid.y, OVERLAY_Z)
  };
}

function computeLocalPointBounds(points: THREE.Vector2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function computeLocalPolygonCentroid(points: THREE.Vector2[]): THREE.Vector2 {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) <= 1e-9) {
    const bounds = computeLocalPointBounds(points);
    return new THREE.Vector2((bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5);
  }
  return new THREE.Vector2(x / (3 * twiceArea), y / (3 * twiceArea));
}

async function readFirstPageCoordinateTransform(file: File): Promise<PdfCoordinateTransform> {
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer())
  });

  try {
    const pdfDocument = await loadingTask.promise;
    const firstPage = await pdfDocument.getPage(1);
    const pageLike = firstPage as {
      rotate: number;
      getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => {
        transform: unknown;
        height: number;
      };
    };
    return {
      matrix: buildPageMatrix(pageLike)
    };
  } finally {
    await loadingTask.destroy();
  }
}

function buildPageMatrix(page: {
  rotate: number;
  getViewport: (params: { scale: number; rotation?: number; dontFlip?: boolean }) => {
    transform: unknown;
    height: number;
  };
}): Mat2D {
  const rotation = normalizeRotationDegrees(page.rotate);
  const viewport = page.getViewport({ scale: 1, rotation, dontFlip: false });
  const transform = viewport.transform;

  if (!Array.isArray(transform) || transform.length < 6) {
    return createIdentityMatrix();
  }

  const pageMatrix: Mat2D = [
    Number(transform[0]),
    Number(transform[1]),
    Number(transform[2]),
    Number(transform[3]),
    Number(transform[4]),
    Number(transform[5])
  ];

  if (!pageMatrix.every(Number.isFinite)) {
    return createIdentityMatrix();
  }

  const viewportHeight = Number(viewport.height);
  if (!Number.isFinite(viewportHeight)) {
    return pageMatrix;
  }

  return multiplyMatrices([1, 0, 0, -1, 0, viewportHeight], pageMatrix);
}

function normalizeRotationDegrees(rotation: number): number {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

function multiplyMatrices(left: Mat2D, right: Mat2D): Mat2D {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function applyMatrix(matrix: Mat2D, x: number, y: number): RoomPoint {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5]
  };
}

function invertMatrix(matrix: Mat2D): Mat2D | null {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    return null;
  }
  const invDet = 1 / determinant;
  const a = matrix[3] * invDet;
  const b = -matrix[1] * invDet;
  const c = -matrix[2] * invDet;
  const d = matrix[0] * invDet;
  return [
    a,
    b,
    c,
    d,
    -(a * matrix[4] + c * matrix[5]),
    -(b * matrix[4] + d * matrix[5])
  ];
}

function createIdentityPdfCoordinateTransform(): PdfCoordinateTransform {
  return {
    matrix: createIdentityMatrix()
  };
}

function createIdentityMatrix(): Mat2D {
  return [1, 0, 0, 1, 0, 0];
}

function createRoomColor(roomId: string, roomIndex: number): THREE.Color {
  const hash = hashString(`${roomId}:${roomIndex}`);
  const hue = ((hash % 360) + 360) % 360;
  const saturation = 0.62 + (((hash >>> 9) % 24) / 100);
  const lightness = 0.48 + (((hash >>> 17) % 16) / 100);
  return new THREE.Color().setHSL(hue / 360, saturation, lightness, THREE.SRGBColorSpace);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function roundTsvCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatTsvCell(value: string): string {
  if (!/[\t\r\n"]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function sanitizeDownloadName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "rooms";
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function resolveSceneFitBounds(sceneData: HeprThreePdfObject["sceneData"]): Bounds {
  if (sceneData.pageRects instanceof Float32Array && sceneData.pageRects.length >= 4) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i + 3 < sceneData.pageRects.length; i += 4) {
      const x0 = sceneData.pageRects[i];
      const y0 = sceneData.pageRects[i + 1];
      const x1 = sceneData.pageRects[i + 2];
      const y1 = sceneData.pageRects[i + 3];
      if (![x0, y0, x1, y1].every(Number.isFinite)) {
        continue;
      }
      minX = Math.min(minX, x0, x1);
      minY = Math.min(minY, y0, y1);
      maxX = Math.max(maxX, x0, x1);
      maxY = Math.max(maxY, y0, y1);
    }

    if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
      return { minX, minY, maxX, maxY };
    }
  }

  if (sceneData.pageBounds && isFiniteBounds(sceneData.pageBounds)) {
    return sceneData.pageBounds;
  }

  return sceneData.bounds;
}

function normalizeBounds(bounds: Bounds): Bounds {
  return {
    minX: Math.min(bounds.minX, bounds.maxX),
    minY: Math.min(bounds.minY, bounds.maxY),
    maxX: Math.max(bounds.minX, bounds.maxX),
    maxY: Math.max(bounds.minY, bounds.maxY)
  };
}

function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  );
}

function clearCurrentPdfObject(): void {
  clearRoomOverlay({ silent: true });
  currentParsedTsv = null;
  currentGeneratedTsv = null;
  currentPdfFile = null;
  currentPdfCoordinateTransform = createIdentityPdfCoordinateTransform();
  if (!currentPdfObject) {
    pdfValue.textContent = "-";
    return;
  }

  currentPdfObject.renderer.setInteractionViewportProvider(null);
  scene.remove(currentPdfObject);
  currentPdfObject.dispose();
  currentPdfObject = null;
  pdfValue.textContent = "-";
  requestRender();
}

function clearRoomOverlay(options: { silent?: boolean } = {}): void {
  disposeRoomOverlay();
  currentParsedTsv = null;
  currentGeneratedTsv = null;
  updateRoomMetrics();
  syncControlsEnabled();
  if (!options.silent) {
    requestRender();
  }
}

function disposeRoomOverlay(): void {
  if (!currentRoomOverlay) {
    return;
  }

  currentRoomOverlay.group.parent?.remove(currentRoomOverlay.group);
  currentRoomOverlay.fillGeometry?.dispose();
  currentRoomOverlay.fillMaterial?.dispose();
  currentRoomOverlay.lineGeometry?.dispose();
  currentRoomOverlay.lineMaterial?.dispose();
  for (const label of currentRoomOverlay.labelElements) {
    label.element.remove();
  }
  currentRoomOverlay = null;
}

function updateRoomMetrics(): void {
  if (!currentRoomOverlay) {
    tsvValue.textContent = "-";
    roomsValue.textContent = "-";
    return;
  }

  tsvValue.textContent = currentRoomOverlay.fileName;
  const skippedSuffix = currentRoomOverlay.skippedRows > 0
    ? `, skipped ${currentRoomOverlay.skippedRows.toLocaleString()}`
    : "";
  roomsValue.textContent =
    `${currentRoomOverlay.roomCount.toLocaleString()} rooms, ` +
    `${currentRoomOverlay.triangleCount.toLocaleString()} triangles, ` +
    `${currentRoomOverlay.edgeCount.toLocaleString()} edges, ` +
    `${currentRoomOverlay.labelCount.toLocaleString()} labels${skippedSuffix}`;
}

function updatePdfLoadProgress(activeToken: number, fileName: string, progress: PDFLoadProgress): void {
  if (activeToken !== loadToken) {
    return;
  }
  const value = Math.max(0, Math.min(1, Number(progress.value) || 0));
  setStatus(`Loading ${fileName}: ${formatLoadProgressStage(progress.stage)} ${(value * 100).toFixed(1)}%`);
}

function fitCameraToObject(targetObject: THREE.Object3D): void {
  scene.updateMatrixWorld(true);
  if (tempObjectBounds.setFromObject(targetObject).isEmpty()) {
    return;
  }

  tempObjectBounds.getSize(tempObjectSize);
  tempObjectBounds.getCenter(tempObjectCenter);
  const objectWidth = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.x);
  const objectHeight = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.y);
  const objectDepth = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.z);
  const viewport = resolveRendererViewportPixels();
  const widthPaddingFactor = viewport.width / Math.max(1, viewport.width - CAMERA_FIT_PADDING_PIXELS * 2);
  const heightPaddingFactor = viewport.height / Math.max(1, viewport.height - CAMERA_FIT_PADDING_PIXELS * 2);
  const paddedWidth = objectWidth * widthPaddingFactor;
  const paddedHeight = objectHeight * heightPaddingFactor;
  const verticalFovRadians = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFovRadians = 2 * Math.atan(Math.tan(verticalFovRadians * 0.5) * Math.max(1e-6, camera.aspect));
  const distanceForHeight = (paddedHeight * 0.5) / Math.tan(verticalFovRadians * 0.5);
  const distanceForWidth = (paddedWidth * 0.5) / Math.tan(horizontalFovRadians * 0.5);
  const distance = Math.max(1e-3, distanceForHeight, distanceForWidth);

  tempViewDirection.subVectors(camera.position, controls.target);
  if (tempViewDirection.lengthSq() <= 1e-12) {
    tempViewDirection.set(0, 0, 1);
  } else {
    tempViewDirection.normalize();
  }

  camera.position.copy(tempObjectCenter).addScaledVector(tempViewDirection, distance);
  controls.target.copy(tempObjectCenter);
  currentContentCenter.copy(tempObjectCenter);
  currentContentRadius = Math.max(MIN_OBJECT_EXTENT, Math.sqrt(objectWidth * objectWidth + objectHeight * objectHeight + objectDepth * objectDepth) * 0.5);
  updateCameraClipping(true);
  controls.update();
  requestRender();
}

function updateCameraClipping(force = false): void {
  const distanceToTarget = camera.position.distanceTo(controls.target);
  const targetOffset = tempClipDelta.subVectors(currentContentCenter, controls.target).length();
  const span = Math.max(MIN_OBJECT_EXTENT, currentContentRadius + targetOffset);
  const margin = span * CAMERA_CLIP_MARGIN_MULTIPLIER;
  const nextNear = Math.max(
    CAMERA_CLIP_NEAR_MIN,
    Math.min(distanceToTarget * 0.5, distanceToTarget - margin)
  );
  const nextFar = Math.max(nextNear + MIN_OBJECT_EXTENT, distanceToTarget + margin);

  if (force || Math.abs(camera.near - nextNear) > 1e-3 || Math.abs(camera.far - nextFar) > 1e-3) {
    camera.near = nextNear;
    camera.far = nextFar;
    camera.updateProjectionMatrix();
  }
}

function renderFrame(): void {
  animationFrameId = 0;
  if (!needsRender) {
    return;
  }

  needsRender = false;
  const controlsChanged = controls.update();
  updateCameraClipping();
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  updateRoomDomLabels();
  if (controlsChanged) {
    requestRender();
  }
}

function requestRender(): void {
  if (isDisposed) {
    return;
  }
  needsRender = true;
  if (animationFrameId === 0) {
    animationFrameId = requestAnimationFrame(renderFrame);
  }
}

function resizeRenderer(): void {
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = resolveCanvasAspect();
  camera.updateProjectionMatrix();
  updateCameraClipping(true);
  updateRoomDomLabels();
}

function resolveCanvasAspect(): number {
  return Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
}

function resolveRendererViewportPixels(): { width: number; height: number } {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  return {
    width: Math.max(1, Math.round(size.x)),
    height: Math.max(1, Math.round(size.y))
  };
}

function setBusy(busy: boolean): void {
  isBusy = busy;
  loadFilesButton.disabled = busy;
  detectRoomsButton.disabled = busy || !currentPdfObject || !currentPdfFile;
  detectRoomsButton.textContent = busy ? "Working..." : "Detect Rooms";
  downloadGeneratedTsvButton.disabled = busy || !currentGeneratedTsv;
  showRoomLabelsCheckbox.disabled = busy || !currentRoomOverlay;
  clearTsvButton.disabled = busy || !currentRoomOverlay;
}

function syncControlsEnabled(): void {
  loadFilesButton.disabled = isBusy;
  detectRoomsButton.disabled = isBusy || !currentPdfObject || !currentPdfFile;
  detectRoomsButton.textContent = isBusy ? "Working..." : "Detect Rooms";
  downloadGeneratedTsvButton.disabled = isBusy || !currentGeneratedTsv;
  showRoomLabelsCheckbox.disabled = isBusy || !currentRoomOverlay;
  updateRoomLabelVisibility();
  clearTsvButton.disabled = isBusy || !currentRoomOverlay;
}

function updateRoomLabelVisibility(): void {
  if (currentRoomOverlay) {
    updateRoomDomLabels();
  }
}

function updateRoomDomLabels(): void {
  const overlay = currentRoomOverlay;
  const pdfObject = currentPdfObject;
  const labelsVisible = Boolean(overlay && pdfObject && showRoomLabelsCheckbox.checked);
  if (!overlay || !pdfObject) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  pdfObject.updateMatrixWorld(true);

  for (const label of overlay.labelElements) {
    if (!labelsVisible) {
      label.element.style.display = "none";
      continue;
    }

    tempRoomLabelWorldPosition.copy(label.anchor);
    pdfObject.localToWorld(tempRoomLabelWorldPosition);
    tempRoomLabelWorldPosition.project(camera);
    const ndcX = tempRoomLabelWorldPosition.x;
    const ndcY = tempRoomLabelWorldPosition.y;
    const ndcZ = tempRoomLabelWorldPosition.z;
    if (
      !Number.isFinite(ndcX) ||
      !Number.isFinite(ndcY) ||
      !Number.isFinite(ndcZ) ||
      ndcZ < -1 ||
      ndcZ > 1 ||
      ndcX < -1.15 ||
      ndcX > 1.15 ||
      ndcY < -1.15 ||
      ndcY > 1.15
    ) {
      label.element.style.display = "none";
      continue;
    }

    const screenX = rect.left + (ndcX * 0.5 + 0.5) * width;
    const screenY = rect.top + (-ndcY * 0.5 + 0.5) * height;
    label.element.style.display = "";
    label.element.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -50%)`;
  }
}

function setStatus(text: string): void {
  statusElement.textContent = text;
}

function formatOverlayStatus(overlay: RoomOverlay | null): string {
  if (!overlay) {
    return "No TSV overlay loaded.";
  }
  const skippedSuffix = overlay.skippedRows > 0 ? ` (${overlay.skippedRows.toLocaleString()} skipped)` : "";
  return `Loaded ${overlay.roomCount.toLocaleString()} rooms from ${overlay.fileName}${skippedSuffix}.`;
}

function findHeaderIndex(headers: string[], headerName: string): number {
  const normalizedName = headerName.toLowerCase();
  return headers.findIndex((header) => header.toLowerCase() === normalizedName);
}

function normalizeTsvCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/""/g, "\"");
  }
  return trimmed;
}

function disposeDemo(): void {
  if (isDisposed) {
    return;
  }
  isDisposed = true;
  if (animationFrameId !== 0) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
  controls.dispose();
  clearCurrentPdfObject();
  renderer.dispose();
}
