import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";

import {
  pdfObjectGenerator,
  type HeprRendererType,
  type HeprThreePdfObject,
  type VectorLodMode,
  type PDFLoadProgress
} from "./index";
import type { DrawStats } from "./webGlFloorplanRenderer";
import {
  normalizeExampleManifestEntries,
  resolveAppAssetUrl,
  type ExampleAssetManifest,
  type NormalizedExampleEntry
} from "./exampleManifest";
import { formatLoadProgressStage } from "./loadProgress";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const sourceInput = document.querySelector<HTMLInputElement>("#source-input");
const loadSourceButton = document.querySelector<HTMLButtonElement>("#load-source");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const exampleSelect = document.querySelector<HTMLSelectElement>("#example-select");
const backendSelect = document.querySelector<HTMLSelectElement>("#backend-select");
const vectorLodSelect = document.querySelector<HTMLSelectElement>("#vector-lod-select");
const panOptimizationCheckbox = document.querySelector<HTMLInputElement>("#pan-optimization-checkbox");
const panOptimizationRow = document.querySelector<HTMLElement>("#pan-optimization-row");
const statusElement = document.querySelector<HTMLDivElement>("#status");
const parseLoader = document.querySelector<HTMLDivElement>("#parse-loader");
const parseLoaderText = document.querySelector<HTMLSpanElement>("#parse-loader-text");
const fpsValue = document.querySelector<HTMLSpanElement>("#fps-value");
const drawStatsValue = document.querySelector<HTMLSpanElement>("#draw-stats-value");
const lodStatsValue = document.querySelector<HTMLSpanElement>("#lod-stats-value");

if (
  !canvas ||
  !sourceInput ||
  !loadSourceButton ||
  !fileInput ||
  !exampleSelect ||
  !backendSelect ||
  !vectorLodSelect ||
  !panOptimizationCheckbox ||
  !panOptimizationRow ||
  !statusElement ||
  !parseLoader ||
  !parseLoaderText ||
  !fpsValue ||
  !drawStatsValue ||
  !lodStatsValue
) {
  throw new Error("Three example UI is missing required DOM elements.");
}

const canvasElement = canvas;
const sourceInputElement = sourceInput;
const loadSourceButtonElement = loadSourceButton;
const fileInputElement = fileInput;
const exampleSelectElement = exampleSelect;
const backendSelectElement = backendSelect;
const vectorLodSelectElement = vectorLodSelect;
const panOptimizationCheckboxElement = panOptimizationCheckbox;
const panOptimizationRowElement = panOptimizationRow;
const statusElementNode = statusElement;
const parseLoaderElement = parseLoader;
const parseLoaderTextElement = parseLoaderText;
const fpsValueElement = fpsValue;
const drawStatsValueElement = drawStatsValue;
const lodStatsValueElement = lodStatsValue;
const lifetimeAbortController = new AbortController();
const lifetimeSignal = lifetimeAbortController.signal;
let loadToken = 0;
const searchParams = new URLSearchParams(window.location.search);
const threeCameraDebugLogs =
  searchParams.get("heprThreeCameraDebug") === "1" ||
  searchParams.get("heprPerspectiveDebug") === "1";
const CAMERA_FIT_PADDING = 1.06;
const MIN_OBJECT_EXTENT = 1e-3;
const DEFAULT_PERSPECTIVE_FOV_DEGREES = 45;
const CAMERA_CLIP_NEAR_MIN = 0.01;
const CAMERA_CLIP_MARGIN_MULTIPLIER = 3.5;
const CAMERA_CLIP_UPDATE_EPSILON = 1e-3;
const tempObjectBounds = new THREE.Box3();
const tempObjectSize = new THREE.Vector3();
const tempObjectCenter = new THREE.Vector3();
const tempViewDirection = new THREE.Vector3();
const tempClipDelta = new THREE.Vector3();
const currentContentCenter = new THREE.Vector3();
let currentContentRadius = 10;

const renderer = new THREE.WebGLRenderer({
  canvas: canvasElement,
  antialias: false,
  alpha: false,
  depth: true,
  stencil: false,
  premultipliedAlpha: false,
  powerPreference: "high-performance"
});
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
renderer.setClearColor(new THREE.Color(160 / 255, 169 / 255, 175 / 255), 1);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  DEFAULT_PERSPECTIVE_FOV_DEGREES,
  resolveCanvasAspect(),
  CAMERA_CLIP_NEAR_MIN,
  2000
);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
updatePerspectiveCameraProjection();

const controls = new MapControls(camera, renderer.domElement);
controls.enableRotate = true;
controls.enableDamping = false;
controls.screenSpacePanning = true;
if (threeCameraDebugLogs) {
  console.info(
    "[HEPR:three-example] three-camera debug logs enabled."
  );
}

let currentPdfObject: HeprThreePdfObject | null = null;
let lastLoadedSource: File | string | null = null;
let animationFrameId = 0;
let needsRender = false;
let fpsLastSampleTime = 0;
let fpsSmoothed = 0;
let lastNativeDrawStats: DrawStats | null = null;
let drawStatsLastText = "";
let lodStatsLastText = "";
const exampleSelectionMap = new Map<string, ExampleSelection>();

function renderFrame(now: number = performance.now()): void {
  animationFrameId = 0;
  if (!needsRender) {
    return;
  }
  needsRender = false;
  updateFpsMeter(now);
  const controlsChanged = controls.update();
  updateCameraClipping();
  renderer.clear(true, true, true);
  currentPdfObject?.prepareFrameForThreeRenderer(renderer, camera);
  renderer.clearDepth();
  renderer.render(scene, camera);
  updateDrawStatsMeter();
  updateLodStatsMeter();
  if (controlsChanged) {
    requestRender();
  }
}

function requestRender(): void {
  needsRender = true;
  if (animationFrameId === 0) {
    animationFrameId = requestAnimationFrame(renderFrame);
  }
}

controls.addEventListener("change", () => {
  requestRender();
});

requestRender();
syncPanOptimizationVisibility();

window.addEventListener("resize", () => {
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
  updatePerspectiveCameraProjection();
  updateCameraClipping();
  requestRender();
}, { signal: lifetimeSignal });

loadSourceButtonElement.addEventListener("click", () => {
  const raw = sourceInputElement.value.trim();
  if (!raw) {
    setStatus("Please enter a PDF or ZIP path/base64 source.");
    return;
  }
  void loadSource(raw);
}, { signal: lifetimeSignal });

sourceInputElement.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  loadSourceButtonElement.click();
}, { signal: lifetimeSignal });

exampleSelectElement.addEventListener("change", () => {
  const selectionKey = exampleSelectElement.value;
  if (!selectionKey) {
    return;
  }
  void loadExampleSelection(selectionKey);
}, { signal: lifetimeSignal });

fileInputElement.addEventListener("change", () => {
  const file = fileInputElement.files?.[0];
  if (!file) {
    return;
  }
  void loadSource(file);
  fileInputElement.value = "";
}, { signal: lifetimeSignal });

backendSelectElement.addEventListener("change", () => {
  if (!lastLoadedSource) {
    const backend = backendSelectElement.value === "webgpu" ? "WebGPU" : "WebGL";
    setStatus(`Backend switched to ${backend}. Load a source to render.`);
    return;
  }
  void loadSource(lastLoadedSource);
}, { signal: lifetimeSignal });

vectorLodSelectElement.addEventListener("change", () => {
  const vectorLod = readVectorLodMode();
  syncPanOptimizationVisibility();
  if (!lastLoadedSource) {
    setStatus(`Vector LOD mode set to ${formatVectorLodMode(vectorLod)}. Load a source to render.`);
    return;
  }
  currentPdfObject?.setVectorLodMode(vectorLod);
  setStatus(`Vector LOD mode set to ${formatVectorLodMode(vectorLod)}.`);
  updateDrawStatsMeter();
  updateLodStatsMeter();
  requestRender();
}, { signal: lifetimeSignal });

panOptimizationCheckboxElement.addEventListener("change", () => {
  const enabled = readPanOptimizationEnabled();
  currentPdfObject?.setPanOptimizationEnabled(enabled);
  setStatus(`Pan optimization ${enabled ? "enabled" : "disabled"}.`);
  updateDrawStatsMeter();
  requestRender();
}, { signal: lifetimeSignal });

void loadExampleManifest();

window.addEventListener("beforeunload", () => {
  disposeExample();
}, { signal: lifetimeSignal });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeExample();
  });
}

function disposeExample(): void {
  if (lifetimeSignal.aborted) {
    return;
  }
  lifetimeAbortController.abort();
  if (animationFrameId !== 0) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
  controls.dispose();
  disposeCurrentObject();
  renderer.dispose();
}

async function loadSource(source: File | string): Promise<void> {
  const activeLoadToken = ++loadToken;
  const backend = backendSelectElement.value === "webgpu" ? "webgpu" : "webgl";
  const useWebGpuMaterialPipeline = backend === "webgpu";
  const sourceLabel = typeof source === "string" ? source : source.name;
  const vectorLod = readVectorLodMode();
  const panOptimization = readPanOptimizationEnabled();
  setStatus(`Loading ${sourceLabel} with ${backend.toUpperCase()}...`);
  setLoadingProgress(true, "Parsing / loading 0.00%");
  loadSourceButtonElement.disabled = true;
  backendSelectElement.disabled = true;
  vectorLodSelectElement.disabled = true;
  panOptimizationCheckboxElement.disabled = true;

  try {
    const nextObject = await pdfObjectGenerator(
      source,
      {
        threeCameraDriven: true,
        threeCameraDebugLogs,
        segmentMerge: true,
        invisibleCull: true,
        curveStrokes: true,
        panOptimization,
        vectorLod,
        experimentalMaterialRasters: useWebGpuMaterialPipeline,
        experimentalMaterialFills: useWebGpuMaterialPipeline,
        experimentalMaterialStrokes: useWebGpuMaterialPipeline,
        experimentalMaterialTexts: useWebGpuMaterialPipeline,
        pageBackground: 0xffffff,
        onProgress: (progress) => {
          updateLoadingProgress(activeLoadToken, progress);
        }
      },
      backend as HeprRendererType
    );

    if (activeLoadToken !== loadToken) {
      nextObject.dispose();
      return;
    }
    replacePdfObject(nextObject);
    lastLoadedSource = source;
    setStatus(
      `Loaded ${nextObject.sourceLabel} (${nextObject.sourceKind}) via ${backend.toUpperCase()} | Vector LOD: ${formatVectorLodMode(vectorLod)}.`
    );
    requestRender();
  } catch (error) {
    if (activeLoadToken !== loadToken) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load source: ${message}`);
  } finally {
    if (activeLoadToken === loadToken) {
      setLoadingProgress(false);
      loadSourceButtonElement.disabled = false;
      backendSelectElement.disabled = false;
      vectorLodSelectElement.disabled = false;
      panOptimizationCheckboxElement.disabled = false;
      syncPanOptimizationVisibility();
    }
  }
}

function replacePdfObject(nextObject: HeprThreePdfObject): void {
  disposeCurrentObject();
  nextObject.prepareHostRendering(renderer.domElement);
  nextObject.renderer.setInteractionViewportProvider(() => renderer.domElement.getBoundingClientRect());
  lastNativeDrawStats = null;
  nextObject.setFrameListener((stats) => {
    lastNativeDrawStats = stats;
  });
  currentPdfObject = nextObject;
  scene.add(nextObject);
  fitCameraToPdfObject(nextObject);
  updateCameraClipping(true);
  updateDrawStatsMeter();
  requestRender();
}

function disposeCurrentObject(): void {
  if (!currentPdfObject) {
    return;
  }
  currentPdfObject.setFrameListener(null);
  currentPdfObject.renderer.setInteractionViewportProvider(null);
  scene.remove(currentPdfObject);
  currentPdfObject.dispose();
  currentPdfObject = null;
  lastNativeDrawStats = null;
  setDrawStatsText("-");
  setLodStatsText("-");
  requestRender();
}

function setStatus(text: string): void {
  statusElementNode.textContent = text;
}

function updateLoadingProgress(token: number, progress: PDFLoadProgress): void {
  if (token !== loadToken) {
    return;
  }
  const stageLabel = formatLoadProgressStage(progress.stage);
  const value = Math.max(0, Math.min(1, Number(progress.value) || 0));
  setLoadingProgress(true, `${stageLabel} ${(value * 100).toFixed(2)}%`);
}

function setLoadingProgress(visible: boolean, text = ""): void {
  parseLoaderElement.hidden = !visible;
  parseLoaderTextElement.textContent = visible ? text : "";
}

function updateFpsMeter(now: number): void {
  if (fpsLastSampleTime > 0) {
    const deltaMs = now - fpsLastSampleTime;
    if (deltaMs > 0 && deltaMs < 1000) {
      const fpsNow = 1000 / deltaMs;
      fpsSmoothed = fpsSmoothed === 0 ? fpsNow : fpsSmoothed * 0.85 + fpsNow * 0.15;
      fpsValueElement.textContent = `${fpsSmoothed.toFixed(0)} FPS`;
    }
  }
  fpsLastSampleTime = now;
}

function updateDrawStatsMeter(): void {
  if (!currentPdfObject) {
    setDrawStatsText("-");
    return;
  }

  const materialRenderedSegments = currentPdfObject.getRenderedStrokeSegmentCount();
  const nativeDrawStats = lastNativeDrawStats ?? currentPdfObject.getNativeDrawStats();
  const renderedSegments = materialRenderedSegments ?? nativeDrawStats?.renderedSegments ?? 0;
  const totalSegments = currentPdfObject.sceneData.segmentCount;
  const mode = materialRenderedSegments !== null
    ? "material"
    : nativeDrawStats?.usedCulling
      ? "culled"
      : "full";
  setDrawStatsText(
    `${renderedSegments.toLocaleString()}/${totalSegments.toLocaleString()} segments | mode: ${mode}`
  );
}

function setDrawStatsText(text: string): void {
  if (text === drawStatsLastText) {
    return;
  }
  drawStatsLastText = text;
  drawStatsValueElement.textContent = text;
}

function updateLodStatsMeter(): void {
  const stats = currentPdfObject?.getVectorStrokeLodStats() ?? null;
  if (!stats || stats.totalLevels <= 1) {
    setLodStatsText("-");
    return;
  }

  const activeLevels = stats.activeLevels.length > 0
    ? stats.activeLevels
      .map((level) => `${formatLodTolerance(level.tolerance)}:${formatCompactCount(level.renderedSegments)}`)
      .join(" ")
    : "none";
  setLodStatsText(
    `${formatCompactCount(stats.renderedSegments)} seg | ` +
    `${stats.visibleTileCount.toLocaleString()} tiles | ` +
    `target ${formatCompactCount(stats.targetSegmentsPerTile)}/tile | ` +
    `zoom ${formatLodTolerance(stats.baselineTolerance)} | ` +
    `active ${activeLevels} | ` +
    `dense exact ${stats.maxBaselineTileSegments.toLocaleString()} -> ` +
    `${stats.maxBaselineTileSelectedSegments.toLocaleString()} @${formatLodTolerance(stats.maxBaselineTileSelectedTolerance)} | ` +
    `peak ${stats.maxSelectedTileSegments.toLocaleString()} @${formatLodTolerance(stats.maxSelectedTileTolerance)}`
  );
}

function setLodStatsText(text: string): void {
  if (text === lodStatsLastText) {
    return;
  }
  lodStatsLastText = text;
  lodStatsValueElement.textContent = text;
}

async function loadExampleManifest(): Promise<void> {
  exampleSelectionMap.clear();
  exampleSelectElement.innerHTML = "";
  exampleSelectElement.append(new Option("Examples (loading...)", ""));
  exampleSelectElement.value = "";
  exampleSelectElement.disabled = true;

  try {
    const manifestUrl = resolveAppAssetUrl("examples/manifest.json");
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const manifest = (await response.json()) as ExampleAssetManifest;
    const entries = normalizeExampleManifestEntries(manifest);
    if (entries.length === 0) {
      throw new Error("Manifest does not contain valid examples.");
    }

    populateExampleSelect(entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Three Example] Failed to load manifest: ${message}`);
    exampleSelectElement.innerHTML = "";
    exampleSelectElement.append(new Option("Examples unavailable", ""));
    exampleSelectElement.value = "";
    exampleSelectElement.disabled = true;
  }
}

function populateExampleSelect(entries: NormalizedExampleEntry[]): void {
  exampleSelectionMap.clear();
  exampleSelectElement.innerHTML = "";
  exampleSelectElement.append(new Option("Load example...", ""));

  for (const entry of entries) {
    const group = document.createElement("optgroup");
    group.label = entry.name;

    const pdfKey = `${entry.id}:pdf`;
    const zipKey = `${entry.id}:zip`;
    const pdfLabel = `Parse PDF (${formatKilobytes(entry.pdfSizeBytes)} kB)`;
    const zipLabel = `Load Parsed ZIP (${formatKilobytes(entry.zipSizeBytes)} kB)`;

    exampleSelectionMap.set(pdfKey, {
      id: entry.id,
      sourceName: entry.name,
      kind: "pdf",
      path: entry.pdfPath
    });
    exampleSelectionMap.set(zipKey, {
      id: entry.id,
      sourceName: entry.name,
      kind: "zip",
      path: entry.zipPath
    });

    group.append(new Option(pdfLabel, pdfKey));
    group.append(new Option(zipLabel, zipKey));
    exampleSelectElement.append(group);
  }

  exampleSelectElement.value = "";
  exampleSelectElement.disabled = exampleSelectionMap.size === 0;
}

async function loadExampleSelection(selectionKey: string): Promise<void> {
  const selection = exampleSelectionMap.get(selectionKey);
  if (!selection) {
    exampleSelectElement.value = "";
    return;
  }

  exampleSelectElement.disabled = true;
  try {
    const modeLabel = selection.kind === "pdf" ? "PDF" : "parsed ZIP";
    setStatus(`Loading example ${selection.sourceName} (${modeLabel})...`);
    await loadSource(selection.path);
  } finally {
    exampleSelectElement.value = "";
    exampleSelectElement.disabled = exampleSelectionMap.size === 0;
  }
}

function formatKilobytes(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function formatCompactCount(value: number): string {
  const count = Math.max(0, Math.round(value));
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1_000)}k`;
  }
  return count.toLocaleString();
}

function formatLodTolerance(tolerance: number): string {
  return tolerance <= 0 ? "exact" : `tol${tolerance}`;
}

function readVectorLodMode(): VectorLodMode {
  const value = vectorLodSelectElement.value;
  return value === "off" || value === "force" ? value : "auto";
}

function readPanOptimizationEnabled(): boolean {
  return panOptimizationCheckboxElement.checked;
}

function syncPanOptimizationVisibility(): void {
  panOptimizationRowElement.hidden = readVectorLodMode() !== "off";
}

function formatVectorLodMode(mode: VectorLodMode): string {
  return mode === "off" ? "Off" : mode === "force" ? "Force" : "Auto";
}

type ExampleSelectionKind = "pdf" | "zip";

interface ExampleSelection {
  id: string;
  sourceName: string;
  kind: ExampleSelectionKind;
  path: string;
}

function resolveCanvasAspect(): number {
  const viewportWidth = Math.max(1, canvasElement.clientWidth);
  const viewportHeight = Math.max(1, canvasElement.clientHeight);
  return viewportWidth / viewportHeight;
}

function updatePerspectiveCameraProjection(): void {
  camera.aspect = resolveCanvasAspect();
  camera.updateProjectionMatrix();
}

function fitCameraToPdfObject(pdfObject: HeprThreePdfObject): void {
  fitCameraToObject(pdfObject, true);
}

function fitCameraToObject(targetObject: THREE.Object3D, updateClipForTarget: boolean): void {
  scene.updateMatrixWorld(true);
  if (tempObjectBounds.setFromObject(targetObject).isEmpty()) {
    return;
  }

  tempObjectBounds.getSize(tempObjectSize);
  tempObjectBounds.getCenter(tempObjectCenter);

  const objectWidth = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.x);
  const objectHeight = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.y);
  const objectDepth = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.z);
  const paddedWidth = objectWidth * CAMERA_FIT_PADDING;
  const paddedHeight = objectHeight * CAMERA_FIT_PADDING;

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
  controls.target.set(tempObjectCenter.x, tempObjectCenter.y, tempObjectCenter.z);
  if (updateClipForTarget || !currentPdfObject) {
    updateClipAnchor(tempObjectCenter, Math.max(MIN_OBJECT_EXTENT, tempObjectSize.length() * 0.5));
  }
  updateCameraClipping(true);
  controls.update();
  requestRender();
}

function updateClipAnchor(center: THREE.Vector3, radius: number): void {
  currentContentCenter.copy(center);
  currentContentRadius = Math.max(MIN_OBJECT_EXTENT, radius);
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
  const nextFar = Math.max(nextNear + 10, distanceToTarget + margin);

  if (
    !force &&
    Math.abs(camera.near - nextNear) <= CAMERA_CLIP_UPDATE_EPSILON &&
    Math.abs(camera.far - nextFar) <= CAMERA_CLIP_UPDATE_EPSILON
  ) {
    return;
  }

  camera.near = nextNear;
  camera.far = nextFar;
  camera.updateProjectionMatrix();
}
