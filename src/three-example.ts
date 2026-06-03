import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";

import {
  pdfObjectGenerator,
  consumeVectorStrokeLodBuildTiming,
  resetVectorStrokeLodBuildTiming,
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
import type { Bounds, DetectedRoom, RoomPolygonPoint } from "./pdfVectorExtractor";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const panel = document.querySelector<HTMLDivElement>("#panel");
const togglePanelButton = document.querySelector<HTMLButtonElement>("#toggle-panel");
const togglePanelIcon = document.querySelector<HTMLSpanElement>("#toggle-panel-icon");
const openButton = document.querySelector<HTMLButtonElement>("#open-file");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const exampleSelect = document.querySelector<HTMLSelectElement>("#example-select");
const backendSelect = document.querySelector<HTMLSelectElement>("#backend-select");
const vectorLodSelect = document.querySelector<HTMLSelectElement>("#vector-lod-select");
const panOptimizationCheckbox = document.querySelector<HTMLInputElement>("#pan-optimization-checkbox");
const panOptimizationRow = document.querySelector<HTMLElement>("#pan-optimization-row");
const pageBackgroundColorInput = document.querySelector<HTMLInputElement>("#page-bg-color");
const pageBackgroundOpacitySlider = document.querySelector<HTMLInputElement>("#page-bg-opacity-slider");
const pageBackgroundOpacityInput = document.querySelector<HTMLInputElement>("#page-bg-opacity");
const vectorColorInput = document.querySelector<HTMLInputElement>("#vector-color");
const vectorOpacitySlider = document.querySelector<HTMLInputElement>("#vector-opacity-slider");
const vectorOpacityInput = document.querySelector<HTMLInputElement>("#vector-opacity");
const statusElement = document.querySelector<HTMLDivElement>("#status");
const parseLoader = document.querySelector<HTMLDivElement>("#parse-loader");
const parseLoaderText = document.querySelector<HTMLSpanElement>("#parse-loader-text");
const fileValue = document.querySelector<HTMLSpanElement>("#file-value");
const sourceSegmentsValue = document.querySelector<HTMLSpanElement>("#source-segments-value");
const visibleSegmentsValue = document.querySelector<HTMLSpanElement>("#visible-segments-value");
const timesValue = document.querySelector<HTMLSpanElement>("#times-value");
const fpsValue = document.querySelector<HTMLSpanElement>("#fps-value");
const drawStatsValue = document.querySelector<HTMLSpanElement>("#draw-stats-value");
const lodStatsValue = document.querySelector<HTMLSpanElement>("#lod-stats-value");
const roomsPanel = document.querySelector<HTMLDivElement>("#rooms-panel");
const roomsCount = document.querySelector<HTMLSpanElement>("#rooms-count");
const roomsList = document.querySelector<HTMLDivElement>("#rooms-list");

if (
  !canvas ||
  !panel ||
  !togglePanelButton ||
  !togglePanelIcon ||
  !openButton ||
  !fileInput ||
  !exampleSelect ||
  !backendSelect ||
  !vectorLodSelect ||
  !panOptimizationCheckbox ||
  !panOptimizationRow ||
  !pageBackgroundColorInput ||
  !pageBackgroundOpacitySlider ||
  !pageBackgroundOpacityInput ||
  !vectorColorInput ||
  !vectorOpacitySlider ||
  !vectorOpacityInput ||
  !statusElement ||
  !parseLoader ||
  !parseLoaderText ||
  !fileValue ||
  !sourceSegmentsValue ||
  !visibleSegmentsValue ||
  !timesValue ||
  !fpsValue ||
  !drawStatsValue ||
  !lodStatsValue ||
  !roomsPanel ||
  !roomsCount ||
  !roomsList
) {
  throw new Error("Three example UI is missing required DOM elements.");
}

const canvasElement = canvas;
const panelElement = panel;
const togglePanelButtonElement = togglePanelButton;
const togglePanelIconElement = togglePanelIcon;
const openButtonElement = openButton;
const fileInputElement = fileInput;
const exampleSelectElement = exampleSelect;
const backendSelectElement = backendSelect;
const vectorLodSelectElement = vectorLodSelect;
const panOptimizationCheckboxElement = panOptimizationCheckbox;
const panOptimizationRowElement = panOptimizationRow;
const pageBackgroundColorInputElement = pageBackgroundColorInput;
const pageBackgroundOpacitySliderElement = pageBackgroundOpacitySlider;
const pageBackgroundOpacityInputElement = pageBackgroundOpacityInput;
const vectorColorInputElement = vectorColorInput;
const vectorOpacitySliderElement = vectorOpacitySlider;
const vectorOpacityInputElement = vectorOpacityInput;
const statusElementNode = statusElement;
const parseLoaderElement = parseLoader;
const parseLoaderTextElement = parseLoaderText;
const fileValueElement = fileValue;
const sourceSegmentsValueElement = sourceSegmentsValue;
const visibleSegmentsValueElement = visibleSegmentsValue;
const timesValueElement = timesValue;
const fpsValueElement = fpsValue;
const drawStatsValueElement = drawStatsValue;
const lodStatsValueElement = lodStatsValue;
const roomsPanelElement = roomsPanel;
const roomsCountElement = roomsCount;
const roomsListElement = roomsList;
const lifetimeAbortController = new AbortController();
const lifetimeSignal = lifetimeAbortController.signal;
let loadToken = 0;
const searchParams = new URLSearchParams(window.location.search);
const threeCameraDebugLogs =
  searchParams.get("heprThreeCameraDebug") === "1" ||
  searchParams.get("heprPerspectiveDebug") === "1";
const CAMERA_FIT_PADDING_PIXELS = 64;
const MIN_OBJECT_EXTENT = 1e-3;
const DEFAULT_PERSPECTIVE_FOV_DEGREES = 45;
const CAMERA_CLIP_NEAR_MIN = 0.01;
const CAMERA_CLIP_MARGIN_MULTIPLIER = 3.5;
const CAMERA_CLIP_UPDATE_EPSILON = 1e-3;
const ROOM_HIGHLIGHT_DURATION_MS = 3_600;
const ROOM_HIGHLIGHT_FADE_MS = 700;
const ROOM_HIGHLIGHT_PULSE_HZ = 1.35;
const ROOM_HIGHLIGHT_LOCAL_Z = 0.08;
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
let lastLoadTimingText = "-";
let renderedFrameSerial = 0;
let roomHighlightMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
let roomHighlightAnimationFrame = 0;
let roomHighlightStartedAt = 0;
const pendingRenderedFrameResolvers: Array<() => void> = [];
const exampleSelectionMap = new Map<string, ExampleSelection>();

initializeBackendSelect();
setPanelCollapsed(false);

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
  renderedFrameSerial += 1;
  resolveRenderedFrameWaiters();
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

function waitForNextRenderedFrame(token: number): Promise<void> {
  if (token !== loadToken) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    pendingRenderedFrameResolvers.push(resolve);
    requestRender();
  });
}

function resolveRenderedFrameWaiters(): void {
  if (pendingRenderedFrameResolvers.length <= 0) {
    return;
  }
  const resolvers = pendingRenderedFrameResolvers.splice(0, pendingRenderedFrameResolvers.length);
  for (const resolve of resolvers) {
    resolve();
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

openButtonElement.addEventListener("click", () => {
  fileInputElement.click();
}, { signal: lifetimeSignal });

togglePanelButtonElement.addEventListener("click", () => {
  const currentlyCollapsed = panelElement.classList.contains("collapsed");
  setPanelCollapsed(!currentlyCollapsed);
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

pageBackgroundColorInputElement.addEventListener("input", applyPageBackgroundFromControls, { signal: lifetimeSignal });
pageBackgroundOpacitySliderElement.addEventListener("input", () => {
  syncPercentInputs(pageBackgroundOpacitySliderElement, pageBackgroundOpacityInputElement, 100);
  applyPageBackgroundFromControls();
}, { signal: lifetimeSignal });
pageBackgroundOpacityInputElement.addEventListener("input", () => {
  syncPercentInputs(pageBackgroundOpacityInputElement, pageBackgroundOpacitySliderElement, 100);
  applyPageBackgroundFromControls();
}, { signal: lifetimeSignal });

vectorColorInputElement.addEventListener("input", applyVectorOverrideFromControls, { signal: lifetimeSignal });
vectorOpacitySliderElement.addEventListener("input", () => {
  syncPercentInputs(vectorOpacitySliderElement, vectorOpacityInputElement, 0);
  applyVectorOverrideFromControls();
}, { signal: lifetimeSignal });
vectorOpacityInputElement.addEventListener("input", () => {
  syncPercentInputs(vectorOpacityInputElement, vectorOpacitySliderElement, 0);
  applyVectorOverrideFromControls();
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
  const pageBackground = readPageBackgroundColor();
  const vectorOverride = readVectorOverrideColor();
  disposeRoomHighlight();
  setStatus(`Loading ${sourceLabel} with ${backend.toUpperCase()}...`);
  setLoadingProgress(true, "Parsing / loading 0.00%");
  setLoadControlsEnabled(false);
  backendSelectElement.disabled = true;
  vectorLodSelectElement.disabled = true;
  panOptimizationCheckboxElement.disabled = true;

  try {
    const loadStart = performance.now();
    resetVectorStrokeLodBuildTiming();
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
        pageBackground: [pageBackground[0], pageBackground[1], pageBackground[2]],
        pageBackgroundOpacity: pageBackground[3],
        vectorOverrideColor: [vectorOverride[0], vectorOverride[1], vectorOverride[2]],
        vectorOverrideOpacity: vectorOverride[3],
        onProgress: (progress) => {
          updateLoadingProgress(activeLoadToken, progress);
        }
      },
      backend as HeprRendererType
    );
    const objectReadyMs = performance.now() - loadStart;
    const lodTiming = consumeVectorStrokeLodBuildTiming();

    if (activeLoadToken !== loadToken) {
      nextObject.dispose();
      return;
    }
    replacePdfObject(nextObject);
    lastLoadedSource = source;
    updateLoadingProgress(activeLoadToken, {
      value: 0.99,
      stage: "first-render",
      sourceType: nextObject.sourceKind === "pdf" ? "pdf" : "zip"
    });
    const firstRenderStart = performance.now();
    requestRender();
    await waitForNextRenderedFrame(activeLoadToken);
    const firstRenderMs = performance.now() - firstRenderStart;
    const totalLoadMs = performance.now() - loadStart;
    lastLoadTimingText = formatLoadTiming(totalLoadMs, lodTiming.elapsedMs, lodTiming.buildCount, firstRenderMs, objectReadyMs);
    clearLoadedStatus();
    updateSceneMetrics(nextObject);
  } catch (error) {
    if (activeLoadToken !== loadToken) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load source: ${message}`);
  } finally {
    if (activeLoadToken === loadToken) {
      setLoadingProgress(false);
      setLoadControlsEnabled(true);
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
  disposeRoomHighlight();
  if (!currentPdfObject) {
    return;
  }
  currentPdfObject.setFrameListener(null);
  currentPdfObject.renderer.setInteractionViewportProvider(null);
  scene.remove(currentPdfObject);
  currentPdfObject.dispose();
  currentPdfObject = null;
  lastNativeDrawStats = null;
  fileValueElement.textContent = "-";
  sourceSegmentsValueElement.textContent = "-";
  visibleSegmentsValueElement.textContent = "-";
  timesValueElement.textContent = "-";
  setDrawStatsText("-");
  setLodStatsText("-");
  updateRoomsPanel(null);
  requestRender();
}

function setStatus(text: string): void {
  statusElementNode.textContent = text;
  statusElementNode.hidden = text.trim().length === 0;
}

function clearLoadedStatus(): void {
  statusElementNode.textContent = "";
  statusElementNode.hidden = true;
}

function setPanelCollapsed(collapsed: boolean): void {
  panelElement.classList.toggle("collapsed", collapsed);
  togglePanelButtonElement.setAttribute("aria-expanded", String(!collapsed));
  togglePanelButtonElement.title = collapsed ? "Expand panel" : "Collapse panel";
  togglePanelIconElement.textContent = collapsed ? "▸" : "▾";
}

function setLoadControlsEnabled(enabled: boolean): void {
  openButtonElement.disabled = !enabled;
  fileInputElement.disabled = !enabled;
  exampleSelectElement.disabled = !enabled || exampleSelectionMap.size === 0;
}

function initializeBackendSelect(): void {
  const webGpuOption = Array.from(backendSelectElement.options).find((option) => option.value === "webgpu");
  const webGpuSupported = typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";
  if (!webGpuSupported && webGpuOption) {
    webGpuOption.disabled = true;
    backendSelectElement.title = "WebGPU is not available in this browser/GPU.";
  } else {
    backendSelectElement.title = "Experimental WebGPU backend available.";
  }
}

function updateSceneMetrics(pdfObject: HeprThreePdfObject): void {
  const sceneData = pdfObject.sceneData;
  const sourceSegments = sceneData.sourceSegmentCount;
  const visibleSegments = sceneData.segmentCount;
  const totalReduction = sourceSegments > 0 ? (1 - visibleSegments / sourceSegments) * 100 : 0;
  fileValueElement.textContent = `${pdfObject.sourceLabel} (${pdfObject.sourceKind})`;
  sourceSegmentsValueElement.textContent = sourceSegments.toLocaleString();
  visibleSegmentsValueElement.textContent =
    `${visibleSegments.toLocaleString()} (${Math.max(0, totalReduction).toFixed(1)}% total reduction), fills ${sceneData.fillPathCount.toLocaleString()}, text ${sceneData.textInstanceCount.toLocaleString()} instances, pages ${sceneData.pageCount.toLocaleString()} (${sceneData.pagesPerRow.toLocaleString()}/row)`;
  timesValueElement.textContent = lastLoadTimingText;
  updateRoomsPanel(pdfObject);
}

function updateRoomsPanel(pdfObject: HeprThreePdfObject | null): void {
  const rooms = pdfObject?.sceneData.detectedRooms ?? [];
  roomsListElement.innerHTML = "";
  roomsCountElement.textContent = rooms.length.toLocaleString();
  roomsPanelElement.hidden = rooms.length === 0;
  for (const room of rooms) {
    roomsListElement.append(createRoomButton(room));
  }
}

function createRoomButton(room: DetectedRoom): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "room-button";
  button.title = `Room ${room.label}`;
  const label = document.createElement("span");
  label.className = "room-label";
  label.textContent = room.label;
  const confidence = document.createElement("span");
  confidence.className = "room-confidence";
  confidence.textContent = `${Math.round(room.confidence * 100)}%`;
  button.append(label, confidence);
  button.addEventListener("click", () => {
    if (!currentPdfObject) {
      return;
    }
    fitCameraToPdfSceneBounds(currentPdfObject, room.bounds);
    startRoomHighlight(currentPdfObject, room);
  });
  return button;
}

function startRoomHighlight(pdfObject: HeprThreePdfObject, room: DetectedRoom): void {
  const polygon = readRoomHighlightPolygon(room);
  if (!polygon) {
    return;
  }
  const localPoints = polygon.map((point) => pdfObject.getLocalPointForScenePoint(point));
  const center = polygonCentroid(localPoints);
  const relativePoints = localPoints.map((point) => new THREE.Vector2(point.x - center.x, point.y - center.y));
  if (relativePoints.length < 3 || Math.abs(THREE.ShapeUtils.area(relativePoints)) <= 1e-6) {
    return;
  }

  const mesh = ensureRoomHighlightMesh(pdfObject);
  const nextGeometry = new THREE.ShapeGeometry(new THREE.Shape(relativePoints));
  mesh.geometry.dispose();
  mesh.geometry = nextGeometry;
  mesh.position.set(center.x, center.y, ROOM_HIGHLIGHT_LOCAL_Z);
  mesh.scale.setScalar(1);
  mesh.visible = true;
  roomHighlightStartedAt = performance.now();
  updateRoomHighlight(roomHighlightStartedAt);
  scheduleRoomHighlightFrame();
  requestRender();
}

function ensureRoomHighlightMesh(pdfObject: HeprThreePdfObject): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  if (!roomHighlightMesh) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(20 / 255, 184 / 255, 166 / 255),
      transparent: true,
      opacity: 0.22,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    roomHighlightMesh = new THREE.Mesh(geometry, material);
    roomHighlightMesh.name = "HEPR room highlight";
    roomHighlightMesh.renderOrder = 10_000;
  }
  if (roomHighlightMesh.parent !== pdfObject) {
    roomHighlightMesh.parent?.remove(roomHighlightMesh);
    pdfObject.add(roomHighlightMesh);
  }
  return roomHighlightMesh;
}

function disposeRoomHighlight(): void {
  if (roomHighlightAnimationFrame !== 0) {
    cancelAnimationFrame(roomHighlightAnimationFrame);
    roomHighlightAnimationFrame = 0;
  }
  if (!roomHighlightMesh) {
    return;
  }
  roomHighlightMesh.parent?.remove(roomHighlightMesh);
  roomHighlightMesh.geometry.dispose();
  roomHighlightMesh.material.dispose();
  roomHighlightMesh = null;
}

function scheduleRoomHighlightFrame(): void {
  if (roomHighlightAnimationFrame !== 0) {
    return;
  }
  roomHighlightAnimationFrame = requestAnimationFrame((timestamp) => {
    roomHighlightAnimationFrame = 0;
    updateRoomHighlight(timestamp);
    if (roomHighlightMesh?.visible) {
      requestRender();
      scheduleRoomHighlightFrame();
    }
  });
}

function updateRoomHighlight(timestamp: number): void {
  if (!roomHighlightMesh) {
    return;
  }
  const elapsed = timestamp - roomHighlightStartedAt;
  if (elapsed >= ROOM_HIGHLIGHT_DURATION_MS) {
    roomHighlightMesh.visible = false;
    requestRender();
    return;
  }

  const pulse = 0.5 + Math.sin(elapsed * 0.001 * ROOM_HIGHLIGHT_PULSE_HZ * Math.PI * 2) * 0.5;
  const remaining = ROOM_HIGHLIGHT_DURATION_MS - elapsed;
  const fade = Math.max(0, Math.min(1, remaining / ROOM_HIGHLIGHT_FADE_MS));
  roomHighlightMesh.scale.setScalar(1);
  roomHighlightMesh.material.opacity = (0.16 + pulse * 0.18) * fade;
}

function readRoomHighlightPolygon(room: DetectedRoom): RoomPolygonPoint[] | null {
  const source = room.polygon && room.polygon.length >= 3 ? room.polygon : boundsToPolygon(room.bounds);
  const polygon = source.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return polygon.length >= 3 ? polygon : null;
}

function boundsToPolygon(bounds: Bounds): RoomPolygonPoint[] {
  const normalized = normalizeBounds(bounds);
  if (!normalized) {
    return [];
  }
  return [
    { x: normalized.minX, y: normalized.minY },
    { x: normalized.minX, y: normalized.maxY },
    { x: normalized.maxX, y: normalized.maxY },
    { x: normalized.maxX, y: normalized.minY }
  ];
}

function normalizeBounds(bounds: Bounds): Bounds | null {
  const minX = Math.min(bounds.minX, bounds.maxX);
  const minY = Math.min(bounds.minY, bounds.maxY);
  const maxX = Math.max(bounds.minX, bounds.maxX);
  const maxY = Math.max(bounds.minY, bounds.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function polygonCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  const count = Math.max(1, points.length);
  return { x: x / count, y: y / count };
}

function formatLoadTiming(
  totalLoadMs: number,
  lodMs: number,
  lodBuildCount: number,
  firstRenderMs: number,
  objectReadyMs: number
): string {
  const otherMs = Math.max(0, objectReadyMs - Math.max(0, lodMs));
  const lodText = lodBuildCount > 0 ? `${lodMs.toFixed(0)} ms` : "-";
  return `total ${totalLoadMs.toFixed(0)} ms, parse/upload ${otherMs.toFixed(0)} ms, vector lod ${lodText}, first render ${firstRenderMs.toFixed(0)} ms`;
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

function readPageBackgroundColor(): [number, number, number, number] {
  const color = readHexColor(pageBackgroundColorInputElement.value, [1, 1, 1]);
  const opacity = readPercentInput(pageBackgroundOpacityInputElement, 100) / 100;
  syncPercentInputs(pageBackgroundOpacityInputElement, pageBackgroundOpacitySliderElement, 100);
  return [color[0], color[1], color[2], opacity];
}

function readVectorOverrideColor(): [number, number, number, number] {
  const color = readHexColor(vectorColorInputElement.value, [0, 0, 0]);
  const opacity = readPercentInput(vectorOpacityInputElement, 0) / 100;
  syncPercentInputs(vectorOpacityInputElement, vectorOpacitySliderElement, 0);
  return [color[0], color[1], color[2], opacity];
}

function applyPageBackgroundFromControls(): void {
  const color = readPageBackgroundColor();
  currentPdfObject?.setPageBackgroundColor(color[0], color[1], color[2], color[3]);
  requestRender();
}

function applyVectorOverrideFromControls(): void {
  const color = readVectorOverrideColor();
  currentPdfObject?.setVectorColorOverride(color[0], color[1], color[2], color[3]);
  requestRender();
}

function syncPercentInputs(source: HTMLInputElement, target: HTMLInputElement, fallback: number): void {
  const percent = readPercentInput(source, fallback);
  source.value = String(percent);
  target.value = String(percent);
}

function readPercentInput(input: HTMLInputElement, fallback: number): number {
  const parsed = Math.trunc(Number(input.value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return THREE.MathUtils.clamp(parsed, 0, 100);
}

function readHexColor(value: string, fallback: [number, number, number]): [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!match) {
    return fallback;
  }
  const packed = Number.parseInt(match[1], 16);
  if (!Number.isFinite(packed)) {
    return fallback;
  }
  return [
    ((packed >> 16) & 0xff) / 255,
    ((packed >> 8) & 0xff) / 255,
    (packed & 0xff) / 255
  ];
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

function resolveRendererViewportPixels(): { width: number; height: number } {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  return {
    width: Math.max(1, Math.round(size.x)),
    height: Math.max(1, Math.round(size.y))
  };
}

function updatePerspectiveCameraProjection(): void {
  camera.aspect = resolveCanvasAspect();
  camera.updateProjectionMatrix();
}

function fitCameraToPdfObject(pdfObject: HeprThreePdfObject): void {
  fitCameraToObject(pdfObject, true);
}

function fitCameraToPdfSceneBounds(pdfObject: HeprThreePdfObject, bounds: Bounds): void {
  scene.updateMatrixWorld(true);
  const localBox = pdfObject.getLocalBoxForSceneBounds(bounds);
  tempObjectBounds.copy(localBox).applyMatrix4(pdfObject.matrixWorld);
  if (tempObjectBounds.isEmpty()) {
    return;
  }
  fitCameraToBox(tempObjectBounds, true);
}

function fitCameraToObject(targetObject: THREE.Object3D, updateClipForTarget: boolean): void {
  scene.updateMatrixWorld(true);
  if (tempObjectBounds.setFromObject(targetObject).isEmpty()) {
    return;
  }
  fitCameraToBox(tempObjectBounds, updateClipForTarget);
}

function fitCameraToBox(bounds: THREE.Box3, updateClipForTarget: boolean): void {
  bounds.getSize(tempObjectSize);
  bounds.getCenter(tempObjectCenter);

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
