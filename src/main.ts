import "./style.css";

import JSZip from "jszip";
import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { WebGlFloorplanRenderer, type DrawStats, type SceneStats, type ViewState } from "./webGlFloorplanRenderer";
import { WebGpuFloorplanRenderer } from "./webGpuFloorplanRenderer";
import {
  composeVectorScenesInGrid,
  extractPdfPageScenes,
  extractPdfRasterScene,
  type Bounds,
  type RasterLayer,
  type VectorExtractOptions,
  type VectorScene
} from "./pdfVectorExtractor";
import {
  decodeByteShuffledFloat32,
  decodeChannelMajorFloat32,
  decodeXorDeltaByteShuffledFloat32,
  encodeChannelMajorFloat32
} from "./parsedDataEncoding";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const hudElement = document.querySelector<HTMLDivElement>("#hud");
const toggleHudButton = document.querySelector<HTMLButtonElement>("#toggle-hud");
const toggleHudIcon = document.querySelector<HTMLSpanElement>("#toggle-hud-icon");
const openButton = document.querySelector<HTMLButtonElement>("#open-file");
const exampleSelect = document.querySelector<HTMLSelectElement>("#example-select");
const downloadDataButton = document.querySelector<HTMLButtonElement>("#download-data");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const statusElement = document.querySelector<HTMLDivElement>("#status");
const parseLoaderElement = document.querySelector<HTMLDivElement>("#parse-loader");
const runtimeElement = document.querySelector<HTMLDivElement>("#runtime");
const metricsElement = document.querySelector<HTMLDivElement>("#metrics");
const metricFileElement = document.querySelector<HTMLSpanElement>("#metric-file");
const metricOperatorsElement = document.querySelector<HTMLSpanElement>("#metric-operators");
const metricSourceSegmentsElement = document.querySelector<HTMLSpanElement>("#metric-source-segments");
const metricMergedSegmentsElement = document.querySelector<HTMLSpanElement>("#metric-merged-segments");
const metricVisibleSegmentsElement = document.querySelector<HTMLSpanElement>("#metric-visible-segments");
const metricReductionsElement = document.querySelector<HTMLSpanElement>("#metric-reductions");
const metricCullDiscardsElement = document.querySelector<HTMLSpanElement>("#metric-cull-discards");
const metricTimesElement = document.querySelector<HTMLSpanElement>("#metric-times");
const metricFpsElement = document.querySelector<HTMLSpanElement>("#metric-fps");
const metricTextureElement = document.querySelector<HTMLSpanElement>("#metric-texture");
const metricGridMaxCellElement = document.querySelector<HTMLSpanElement>("#metric-grid-max-cell");
const dropIndicator = document.querySelector<HTMLDivElement>("#drop-indicator");
const panOptimizationToggle = document.querySelector<HTMLInputElement>("#toggle-pan-opt");
const segmentMergeToggle = document.querySelector<HTMLInputElement>("#toggle-segment-merge");
const invisibleCullToggle = document.querySelector<HTMLInputElement>("#toggle-invisible-cull");
const strokeCurveToggle = document.querySelector<HTMLInputElement>("#toggle-stroke-curves");
const vectorTextOnlyToggle = document.querySelector<HTMLInputElement>("#toggle-vector-text-only");
const webGpuToggle = document.querySelector<HTMLInputElement>("#toggle-webgpu");
const maxPagesPerRowInput = document.querySelector<HTMLInputElement>("#max-pages-per-row");
const pageBackgroundColorInput = document.querySelector<HTMLInputElement>("#page-bg-color");
const pageBackgroundOpacitySlider = document.querySelector<HTMLInputElement>("#page-bg-opacity-slider");
const pageBackgroundOpacityInput = document.querySelector<HTMLInputElement>("#page-bg-opacity");
const vectorColorInput = document.querySelector<HTMLInputElement>("#vector-color");
const vectorOpacitySlider = document.querySelector<HTMLInputElement>("#vector-opacity-slider");
const vectorOpacityInput = document.querySelector<HTMLInputElement>("#vector-opacity");

if (
  !canvas ||
  !hudElement ||
  !toggleHudButton ||
  !toggleHudIcon ||
  !openButton ||
  !exampleSelect ||
  !downloadDataButton ||
  !fileInput ||
  !statusElement ||
  !parseLoaderElement ||
  !runtimeElement ||
  !metricsElement ||
  !metricFileElement ||
  !metricOperatorsElement ||
  !metricSourceSegmentsElement ||
  !metricMergedSegmentsElement ||
  !metricVisibleSegmentsElement ||
  !metricReductionsElement ||
  !metricCullDiscardsElement ||
  !metricTimesElement ||
  !metricFpsElement ||
  !metricTextureElement ||
  !metricGridMaxCellElement ||
  !dropIndicator ||
  !panOptimizationToggle ||
  !segmentMergeToggle ||
  !invisibleCullToggle ||
  !strokeCurveToggle ||
  !vectorTextOnlyToggle ||
  !webGpuToggle ||
  !maxPagesPerRowInput ||
  !pageBackgroundColorInput ||
  !pageBackgroundOpacitySlider ||
  !pageBackgroundOpacityInput ||
  !vectorColorInput ||
  !vectorOpacitySlider ||
  !vectorOpacityInput
) {
  throw new Error("Required UI elements are missing from index.html.");
}

let canvasElement = canvas;
const hudPanelElement = hudElement;
const toggleHudButtonElement = toggleHudButton;
const toggleHudIconElement = toggleHudIcon;
const openButtonElement = openButton;
const exampleSelectElement = exampleSelect;
const downloadDataButtonElement = downloadDataButton;
const fileInputElement = fileInput;
const statusTextElement = statusElement;
const parsingLoaderElement = parseLoaderElement;
const runtimeTextElement = runtimeElement;
const metricsPanelElement = metricsElement;
const metricFileTextElement = metricFileElement;
const metricOperatorsTextElement = metricOperatorsElement;
const metricSourceSegmentsTextElement = metricSourceSegmentsElement;
const metricMergedSegmentsTextElement = metricMergedSegmentsElement;
const metricVisibleSegmentsTextElement = metricVisibleSegmentsElement;
const metricReductionsTextElement = metricReductionsElement;
const metricCullDiscardsTextElement = metricCullDiscardsElement;
const metricTimesTextElement = metricTimesElement;
const metricFpsTextElement = metricFpsElement;
const metricTextureTextElement = metricTextureElement;
const metricGridMaxCellTextElement = metricGridMaxCellElement;
const dropIndicatorElement = dropIndicator;
const panOptimizationToggleElement = panOptimizationToggle;
const segmentMergeToggleElement = segmentMergeToggle;
const invisibleCullToggleElement = invisibleCullToggle;
const strokeCurveToggleElement = strokeCurveToggle;
const vectorTextOnlyToggleElement = vectorTextOnlyToggle;
const webGpuToggleElement = webGpuToggle;
const maxPagesPerRowInputElement = maxPagesPerRowInput;
const pageBackgroundColorInputElement = pageBackgroundColorInput;
const pageBackgroundOpacitySliderElement = pageBackgroundOpacitySlider;
const pageBackgroundOpacityInputElement = pageBackgroundOpacityInput;
const vectorColorInputElement = vectorColorInput;
const vectorOpacitySliderElement = vectorOpacitySlider;
const vectorOpacityInputElement = vectorOpacityInput;

type RendererBackend = "webgl" | "webgpu";
const webGpuSupported = isWebGpuSupported();
let activeRendererBackend: RendererBackend = "webgl";
let backendSwitchInFlight = false;

interface RendererApi {
  setFrameListener(listener: ((stats: DrawStats) => void) | null): void;
  setPanOptimizationEnabled(enabled: boolean): void;
  setStrokeCurveEnabled(enabled: boolean): void;
  setTextVectorOnly(enabled: boolean): void;
  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void;
  setVectorColorOverride(red: number, green: number, blue: number, opacity: number): void;
  beginPanInteraction(): void;
  endPanInteraction(): void;
  resize(): void;
  setScene(scene: VectorScene): SceneStats;
  getSceneStats(): SceneStats | null;
  fitToBounds(bounds: Bounds, paddingPixels?: number): void;
  panByPixels(deltaX: number, deltaY: number): void;
  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void;
  getViewState(): ViewState;
  setViewState(viewState: ViewState): void;
  dispose(): void;
}

function onRendererFrame(stats: DrawStats): void {
  updateFpsMetric();

  const rendered = stats.renderedSegments.toLocaleString();
  const total = stats.totalSegments.toLocaleString();
  const mode = stats.usedCulling ? "culled" : "full";
  runtimeTextElement.textContent =
    `Draw ${rendered}/${total} segments | mode: ${mode} | zoom: ${stats.zoom.toFixed(2)}x | backend: ${activeRendererBackend.toUpperCase()}`;
}

function initializeRendererCommon(rendererApi: RendererApi): void {
  rendererApi.resize();
  rendererApi.setPanOptimizationEnabled(panOptimizationToggleElement.checked);
  rendererApi.setStrokeCurveEnabled(strokeCurveToggleElement.checked);
  rendererApi.setTextVectorOnly(vectorTextOnlyToggleElement.checked);
  const pageBackgroundColor = readPageBackgroundColorInput();
  rendererApi.setPageBackgroundColor(
    pageBackgroundColor[0],
    pageBackgroundColor[1],
    pageBackgroundColor[2],
    pageBackgroundColor[3]
  );
  const vectorColorOverride = readVectorColorOverrideInput();
  rendererApi.setVectorColorOverride(
    vectorColorOverride[0],
    vectorColorOverride[1],
    vectorColorOverride[2],
    vectorColorOverride[3]
  );
  rendererApi.setFrameListener(onRendererFrame);
}

function createWebGlRenderer(targetCanvas: HTMLCanvasElement): RendererApi {
  const next = new WebGlFloorplanRenderer(targetCanvas);
  initializeRendererCommon(next);
  return next;
}

async function createWebGpuRenderer(targetCanvas: HTMLCanvasElement): Promise<RendererApi> {
  const next = await WebGpuFloorplanRenderer.create(targetCanvas);
  initializeRendererCommon(next);
  return next;
}

let renderer: RendererApi = createWebGlRenderer(canvasElement);

let baseStatus = "Waiting for PDF or parsed ZIP...";
type LoadedSourceKind = "pdf" | "parsed-zip";

interface LoadedSource {
  kind: LoadedSourceKind;
  bytes: Uint8Array;
  label: string;
}

let lastLoadedSource: LoadedSource | null = null;
let lastParsedScene: VectorScene | null = null;
let lastParsedSceneStats: SceneStats | null = null;
let lastParsedSceneLabel: string | null = null;
let loadToken = 0;
let isDropDragActive = false;

interface ParsedPdfPageCache {
  sourceBytes: Uint8Array;
  sourceLabel: string;
  optionsKey: string;
  pageScenes: VectorScene[];
}

let parsedPdfPageCache: ParsedPdfPageCache | null = null;

interface LoadPdfOptions {
  preserveView?: boolean;
  autoMaxPagesPerRow?: boolean;
}

interface ExportTextureEntry {
  name: string;
  filePath: string;
  width: number;
  height: number;
  logicalItemCount: number;
  logicalFloatCount: number;
  data: Float32Array;
  layout: "interleaved" | "channel-major";
}

type TextureLayout = "interleaved" | "channel-major";

interface ParsedDataTextureEntry {
  name?: unknown;
  file?: unknown;
  componentType?: unknown;
  layout?: unknown;
  byteShuffle?: unknown;
  predictor?: unknown;
  logicalItemCount?: unknown;
  logicalFloatCount?: unknown;
}

interface ParsedDataRasterLayerEntry {
  width?: unknown;
  height?: unknown;
  matrix?: unknown;
  file?: unknown;
  encoding?: unknown;
}

interface ParsedDataSceneEntry {
  bounds?: unknown;
  pageBounds?: unknown;
  pageRects?: unknown;
  pageCount?: unknown;
  pagesPerRow?: unknown;
  maxHalfWidth?: unknown;
  operatorCount?: unknown;
  imagePaintOpCount?: unknown;
  pathCount?: unknown;
  sourceSegmentCount?: unknown;
  mergedSegmentCount?: unknown;
  segmentCount?: unknown;
  fillPathCount?: unknown;
  fillSegmentCount?: unknown;
  sourceTextCount?: unknown;
  textInstanceCount?: unknown;
  textGlyphCount?: unknown;
  textGlyphPrimitiveCount?: unknown;
  textGlyphSegmentCount?: unknown;
  textInPageCount?: unknown;
  textOutOfPageCount?: unknown;
  discardedTransparentCount?: unknown;
  discardedDegenerateCount?: unknown;
  discardedDuplicateCount?: unknown;
  discardedContainedCount?: unknown;
  rasterLayers?: unknown;
  rasterLayerWidth?: unknown;
  rasterLayerHeight?: unknown;
  rasterLayerMatrix?: unknown;
  rasterLayerFile?: unknown;
}

interface ParsedDataManifest {
  formatVersion?: unknown;
  sourceFile?: unknown;
  sourcePdfFile?: unknown;
  sourcePdfUrl?: unknown;
  sourcePdfSizeBytes?: unknown;
  scene?: ParsedDataSceneEntry;
  textures?: ParsedDataTextureEntry[];
}

interface ExampleAssetManifestEntry {
  id?: unknown;
  name?: unknown;
  pdf?: {
    path?: unknown;
    sizeBytes?: unknown;
  };
  parsedZip?: {
    path?: unknown;
    sizeBytes?: unknown;
  };
}

interface ExampleAssetManifest {
  generatedAt?: unknown;
  examples?: unknown;
}

type ExampleSelectionKind = "pdf" | "zip";

interface ExampleSelection {
  id: string;
  sourceName: string;
  kind: ExampleSelectionKind;
  path: string;
}

interface NormalizedExampleEntry {
  id: string;
  name: string;
  pdfPath: string;
  pdfSizeBytes: number;
  zipPath: string;
  zipSizeBytes: number;
}

const exampleSelectionMap = new Map<string, ExampleSelection>();
const absoluteUrlPattern = /^[a-z][a-z\d+.-]*:/i;
const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);

function resolveAppAssetUrl(inputPath: string): string {
  const trimmedPath = inputPath.trim();
  if (absoluteUrlPattern.test(trimmedPath)) {
    return trimmedPath;
  }

  const normalizedPath = trimmedPath.replace(/^\/+/, "");
  return new URL(normalizedPath, appBaseUrl).toString();
}

let fpsLastSampleTime = 0;
let fpsSmoothed = 0;

initializeBackendToggleState();
setMetricPlaceholder();
setHudCollapsed(false);
setDownloadDataButtonState(false);
maxPagesPerRowInputElement.value = String(readMaxPagesPerRowInput());
setStatus(baseStatus);
refreshDropIndicator();
void loadExampleManifest();

openButtonElement.addEventListener("click", () => {
  fileInputElement.click();
});

downloadDataButtonElement.addEventListener("click", () => {
  void downloadParsedDataZip();
});

toggleHudButtonElement.addEventListener("click", () => {
  const currentlyCollapsed = hudPanelElement.classList.contains("collapsed");
  setHudCollapsed(!currentlyCollapsed);
});

fileInputElement.addEventListener("change", async () => {
  const [file] = Array.from(fileInputElement.files || []);
  if (!file) {
    return;
  }
  if (isPdfFile(file)) {
    await loadPdfFile(file);
  } else if (isParsedDataZipFile(file)) {
    await loadParsedDataZipFile(file);
  } else {
    setStatus(`Unsupported file type: ${file.name}`);
  }
  fileInputElement.value = "";
});

exampleSelectElement.addEventListener("change", () => {
  const selectedKey = exampleSelectElement.value;
  if (!selectedKey) {
    return;
  }
  void loadExampleSelection(selectedKey);
});

panOptimizationToggleElement.addEventListener("change", () => {
  renderer.setPanOptimizationEnabled(panOptimizationToggleElement.checked);
});

segmentMergeToggleElement.addEventListener("change", () => {
  void reloadLastPdfWithCurrentOptions();
});

invisibleCullToggleElement.addEventListener("change", () => {
  void reloadLastPdfWithCurrentOptions();
});

strokeCurveToggleElement.addEventListener("change", () => {
  renderer.setStrokeCurveEnabled(strokeCurveToggleElement.checked);
});

vectorTextOnlyToggleElement.addEventListener("change", () => {
  renderer.setTextVectorOnly(vectorTextOnlyToggleElement.checked);
});

pageBackgroundColorInputElement.addEventListener("input", () => {
  applyPageBackgroundColorFromControls();
});

pageBackgroundOpacitySliderElement.addEventListener("input", () => {
  const opacityPercent = readPageBackgroundOpacityPercent(pageBackgroundOpacitySliderElement.value);
  setPageBackgroundOpacityControls(opacityPercent);
  applyPageBackgroundColorFromControls();
});

pageBackgroundOpacityInputElement.addEventListener("input", () => {
  const opacityPercent = readPageBackgroundOpacityPercent(pageBackgroundOpacityInputElement.value);
  setPageBackgroundOpacityControls(opacityPercent);
  applyPageBackgroundColorFromControls();
});

vectorColorInputElement.addEventListener("input", () => {
  applyVectorColorOverrideFromControls();
});

vectorOpacitySliderElement.addEventListener("input", () => {
  const opacityPercent = readVectorOpacityPercent(vectorOpacitySliderElement.value);
  setVectorOpacityControls(opacityPercent);
  applyVectorColorOverrideFromControls();
});

vectorOpacityInputElement.addEventListener("input", () => {
  const opacityPercent = readVectorOpacityPercent(vectorOpacityInputElement.value);
  setVectorOpacityControls(opacityPercent);
  applyVectorColorOverrideFromControls();
});

maxPagesPerRowInputElement.addEventListener("change", () => {
  const maxPagesPerRow = readMaxPagesPerRowInput();
  maxPagesPerRowInputElement.value = String(maxPagesPerRow);
  if (!lastLoadedSource || lastLoadedSource.kind !== "pdf") {
    return;
  }
  void loadPdfBuffer(createParseBuffer(lastLoadedSource.bytes), lastLoadedSource.label, { preserveView: false });
});

webGpuToggleElement.addEventListener("change", () => {
  void applyBackendPreference(webGpuToggleElement.checked);
});

let isPanning = false;
let previousX = 0;
let previousY = 0;
const activeTouchPointers = new Map<number, { x: number; y: number }>();
let touchPanPointerId: number | null = null;
let touchPinchActive = false;
let touchPreviousDistance = 0;
let touchPreviousCenterX = 0;
let touchPreviousCenterY = 0;

function resetGlobalPointerInteractionState(): void {
  isPanning = false;
  previousX = 0;
  previousY = 0;
  activeTouchPointers.clear();
  touchPanPointerId = null;
  touchPinchActive = false;
  touchPreviousDistance = 0;
  touchPreviousCenterX = 0;
  touchPreviousCenterY = 0;
}

attachCanvasInteractionListeners(canvasElement);

window.addEventListener("resize", () => {
  renderer.resize();
});

function attachCanvasInteractionListeners(targetCanvas: HTMLCanvasElement): void {
  function resetTouchGestureState(): void {
    activeTouchPointers.clear();
    touchPanPointerId = null;
    touchPinchActive = false;
    touchPreviousDistance = 0;
    touchPreviousCenterX = 0;
    touchPreviousCenterY = 0;
  }

  function resetPointerGestureState(endPan: boolean): void {
    if (endPan && isPanning) {
      renderer.endPanInteraction();
    }
    resetTouchGestureState();
    resetGlobalPointerInteractionState();
  }

  function getTouchPinchInfo(): { distance: number; centerX: number; centerY: number } | null {
    if (activeTouchPointers.size < 2) {
      return null;
    }
    const iter = activeTouchPointers.values();
    const first = iter.next().value as { x: number; y: number } | undefined;
    const second = iter.next().value as { x: number; y: number } | undefined;
    if (!first || !second) {
      return null;
    }

    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return {
      distance: Math.hypot(dx, dy),
      centerX: (first.x + second.x) * 0.5,
      centerY: (first.y + second.y) * 0.5
    };
  }

  function releasePointerCaptureIfHeld(pointerId: number): void {
    if (!targetCanvas.hasPointerCapture(pointerId)) {
      return;
    }
    try {
      targetCanvas.releasePointerCapture(pointerId);
    } catch {
      // Ignore release failures when pointer capture is already gone.
    }
  }

  function handleTouchPointerMove(event: PointerEvent): void {
    if (!activeTouchPointers.has(event.pointerId) || !isPanning) {
      return;
    }

    activeTouchPointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    if (activeTouchPointers.size >= 2) {
      const pinchInfo = getTouchPinchInfo();
      if (!pinchInfo) {
        return;
      }

      if (!touchPinchActive) {
        touchPinchActive = true;
        touchPanPointerId = null;
        touchPreviousDistance = Math.max(pinchInfo.distance, 1e-3);
        touchPreviousCenterX = pinchInfo.centerX;
        touchPreviousCenterY = pinchInfo.centerY;
        return;
      }

      const previousDistance = Math.max(touchPreviousDistance, 1e-3);
      const nextDistance = Math.max(pinchInfo.distance, 1e-3);
      const zoomFactor = nextDistance / previousDistance;

      const centerDeltaX = pinchInfo.centerX - touchPreviousCenterX;
      const centerDeltaY = pinchInfo.centerY - touchPreviousCenterY;
      if (centerDeltaX !== 0 || centerDeltaY !== 0) {
        renderer.panByPixels(centerDeltaX, centerDeltaY);
      }

      if (Number.isFinite(zoomFactor) && Math.abs(zoomFactor - 1) > 1e-4) {
        renderer.zoomAtClientPoint(pinchInfo.centerX, pinchInfo.centerY, zoomFactor);
      }

      touchPreviousDistance = nextDistance;
      touchPreviousCenterX = pinchInfo.centerX;
      touchPreviousCenterY = pinchInfo.centerY;
      return;
    }

    if (touchPanPointerId === null) {
      touchPanPointerId = event.pointerId;
      previousX = event.clientX;
      previousY = event.clientY;
      touchPinchActive = false;
      touchPreviousDistance = 0;
      return;
    }

    if (event.pointerId !== touchPanPointerId) {
      return;
    }

    const deltaX = event.clientX - previousX;
    const deltaY = event.clientY - previousY;

    previousX = event.clientX;
    previousY = event.clientY;

    renderer.panByPixels(deltaX, deltaY);
  }

  function handleTouchPointerEnd(event: PointerEvent): void {
    activeTouchPointers.delete(event.pointerId);
    releasePointerCaptureIfHeld(event.pointerId);

    if (activeTouchPointers.size >= 2) {
      const pinchInfo = getTouchPinchInfo();
      if (pinchInfo) {
        touchPinchActive = true;
        touchPanPointerId = null;
        touchPreviousDistance = Math.max(pinchInfo.distance, 1e-3);
        touchPreviousCenterX = pinchInfo.centerX;
        touchPreviousCenterY = pinchInfo.centerY;
      }
      return;
    }

    if (activeTouchPointers.size === 1) {
      const remaining = activeTouchPointers.entries().next().value as [number, { x: number; y: number }] | undefined;
      if (remaining) {
        touchPanPointerId = remaining[0];
        previousX = remaining[1].x;
        previousY = remaining[1].y;
      } else {
        touchPanPointerId = null;
      }
      touchPinchActive = false;
      touchPreviousDistance = 0;
      touchPreviousCenterX = 0;
      touchPreviousCenterY = 0;
      return;
    }

    resetPointerGestureState(true);
  }

  targetCanvas.addEventListener("pointerdown", (event) => {
    if (!isPanning) {
      isPanning = true;
      renderer.beginPanInteraction();
    }

    if (event.pointerType === "touch") {
      activeTouchPointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });

      if (activeTouchPointers.size === 1) {
        touchPanPointerId = event.pointerId;
        touchPinchActive = false;
        touchPreviousDistance = 0;
        touchPreviousCenterX = event.clientX;
        touchPreviousCenterY = event.clientY;
        previousX = event.clientX;
        previousY = event.clientY;
      } else {
        const pinchInfo = getTouchPinchInfo();
        if (pinchInfo) {
          touchPinchActive = true;
          touchPanPointerId = null;
          touchPreviousDistance = Math.max(pinchInfo.distance, 1e-3);
          touchPreviousCenterX = pinchInfo.centerX;
          touchPreviousCenterY = pinchInfo.centerY;
        }
      }
    } else {
      previousX = event.clientX;
      previousY = event.clientY;
    }

    targetCanvas.setPointerCapture(event.pointerId);
  });

  targetCanvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") {
      handleTouchPointerMove(event);
      return;
    }

    if (!isPanning) {
      return;
    }

    const deltaX = event.clientX - previousX;
    const deltaY = event.clientY - previousY;

    previousX = event.clientX;
    previousY = event.clientY;

    renderer.panByPixels(deltaX, deltaY);
  });

  targetCanvas.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") {
      handleTouchPointerEnd(event);
      return;
    }

    resetPointerGestureState(true);
    releasePointerCaptureIfHeld(event.pointerId);
  });

  targetCanvas.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "touch") {
      handleTouchPointerEnd(event);
      return;
    }

    resetPointerGestureState(true);
    releasePointerCaptureIfHeld(event.pointerId);
  });

  targetCanvas.addEventListener("lostpointercapture", (event) => {
    if (event.pointerType === "touch") {
      if (activeTouchPointers.has(event.pointerId)) {
        activeTouchPointers.delete(event.pointerId);
      }
      if (activeTouchPointers.size === 0) {
        resetPointerGestureState(true);
      }
      return;
    }

    if (isPanning) {
      resetPointerGestureState(true);
    }
  });

  targetCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.0013);
      renderer.zoomAtClientPoint(event.clientX, event.clientY, zoomFactor);
    },
    { passive: false }
  );
}

window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  isDropDragActive = true;
  refreshDropIndicator();
});

window.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!isDropDragActive) {
    isDropDragActive = true;
    refreshDropIndicator();
  }
});

window.addEventListener("dragleave", (event) => {
  if (event.target === document.documentElement || event.target === document.body) {
    isDropDragActive = false;
    refreshDropIndicator();
  }
});

window.addEventListener("drop", async (event) => {
  event.preventDefault();
  isDropDragActive = false;
  refreshDropIndicator();

  const files = Array.from(event.dataTransfer?.files || []);
  const supported = files.find((file) => isPdfFile(file) || isParsedDataZipFile(file));

  if (!supported) {
    setStatus("Dropped file is not a supported PDF or parsed zip.");
    return;
  }

  if (isPdfFile(supported)) {
    await loadPdfFile(supported);
  } else {
    await loadParsedDataZipFile(supported);
  }
});

function isWebGpuSupported(): boolean {
  const nav = navigator as Navigator & { gpu?: unknown };
  return typeof nav.gpu !== "undefined";
}

function refreshDropIndicator(): void {
  const shouldShow = isDropDragActive || !lastParsedScene;
  dropIndicatorElement.classList.toggle("active", shouldShow);
  dropIndicatorElement.classList.toggle("dragging", isDropDragActive);
}

function initializeBackendToggleState(): void {
  if (!webGpuSupported) {
    webGpuToggleElement.checked = false;
    webGpuToggleElement.disabled = true;
    webGpuToggleElement.title = "WebGPU is not available in this browser/GPU.";
    return;
  }

  webGpuToggleElement.disabled = false;
  webGpuToggleElement.title = "Experimental WebGPU backend.";
}

async function applyBackendPreference(useWebGpu: boolean): Promise<void> {
  const targetBackend: RendererBackend = useWebGpu ? "webgpu" : "webgl";
  if (targetBackend === activeRendererBackend || backendSwitchInFlight) {
    return;
  }

  if (targetBackend === "webgpu" && !webGpuSupported) {
    webGpuToggleElement.checked = false;
    setStatus("WebGPU is not supported in this browser/GPU. Using WebGL.");
    return;
  }

  backendSwitchInFlight = true;
  const previousRenderer = renderer;
  const previousViewState = previousRenderer.getViewState();
  const currentScene = lastParsedScene;
  const currentLabel = lastParsedSceneLabel;
  const previousCanvas = canvasElement;
  const replacementCanvas = cloneViewportCanvas(previousCanvas);

  setStatus(`Switching renderer backend to ${targetBackend.toUpperCase()}...`);

  try {
    previousCanvas.replaceWith(replacementCanvas);
    canvasElement = replacementCanvas;
    attachCanvasInteractionListeners(canvasElement);

    const nextRenderer =
      targetBackend === "webgpu"
        ? await createWebGpuRenderer(canvasElement)
        : createWebGlRenderer(canvasElement);

    renderer = nextRenderer;
    activeRendererBackend = targetBackend;
    webGpuToggleElement.checked = targetBackend === "webgpu";
    resetGlobalPointerInteractionState();

    previousRenderer.setFrameListener(null);
    previousRenderer.dispose();

    if (currentScene && currentLabel) {
      const nextSceneStats = renderer.setScene(currentScene);
      lastParsedSceneStats = nextSceneStats;
      renderer.setViewState(previousViewState);
      updateMetricsPanel(currentLabel, currentScene, nextSceneStats, 0, 0);
      metricTimesTextElement.textContent = "parse -, upload - (backend switch)";

      const sourceSuffix = lastLoadedSource?.kind === "parsed-zip" ? " | source: parsed data zip" : "";
      baseStatus = `${formatSceneStatus(currentLabel, currentScene)}${sourceSuffix}`;
      statusTextElement.textContent =
        targetBackend === "webgpu"
          ? `${baseStatus} | backend: WebGPU (preview)`
          : `${baseStatus} | backend: WebGL`;
    } else {
      renderer.setViewState(previousViewState);
      setStatus(`Switched to ${targetBackend.toUpperCase()} backend.`);
    }
  } catch (error) {
    if (canvasElement === replacementCanvas) {
      replacementCanvas.replaceWith(previousCanvas);
      canvasElement = previousCanvas;
      resetGlobalPointerInteractionState();
    }

    const message = error instanceof Error ? error.message : String(error);
    webGpuToggleElement.checked = activeRendererBackend === "webgpu";
    setStatus(`Failed to switch backend: ${message}`);
  } finally {
    backendSwitchInFlight = false;
  }
}

function cloneViewportCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const clone = source.cloneNode(false) as HTMLCanvasElement;
  clone.width = source.width;
  clone.height = source.height;
  return clone;
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
    console.warn(`[Examples] Failed to load manifest: ${message}`);
    exampleSelectElement.innerHTML = "";
    exampleSelectElement.append(new Option("Examples unavailable", ""));
    exampleSelectElement.value = "";
    exampleSelectElement.disabled = true;
  }
}

function normalizeExampleManifestEntries(manifest: ExampleAssetManifest): NormalizedExampleEntry[] {
  const rawEntries = Array.isArray(manifest.examples)
    ? (manifest.examples as ExampleAssetManifestEntry[])
    : [];
  const out: NormalizedExampleEntry[] = [];

  for (let i = 0; i < rawEntries.length; i += 1) {
    const raw = rawEntries[i];
    const name = readNonEmptyString(raw?.name);
    if (!name) {
      continue;
    }

    const idCandidate = readNonEmptyString(raw?.id) ?? `example-${i + 1}`;
    const rawPdfPath = readNonEmptyString(raw?.pdf?.path);
    const rawZipPath = readNonEmptyString(raw?.parsedZip?.path);
    const pdfPath = rawPdfPath ? resolveAppAssetUrl(rawPdfPath) : null;
    const zipPath = rawZipPath ? resolveAppAssetUrl(rawZipPath) : null;
    if (!pdfPath || !zipPath) {
      continue;
    }

    out.push({
      id: idCandidate,
      name,
      pdfPath,
      pdfSizeBytes: readNonNegativeInt(raw?.pdf?.sizeBytes, 0),
      zipPath,
      zipSizeBytes: readNonNegativeInt(raw?.parsedZip?.sizeBytes, 0)
    });
  }

  return out;
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
    const response = await fetch(selection.path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const fileBuffer = await response.arrayBuffer();
    const bytes = cloneSourceBytes(fileBuffer);
    parsedPdfPageCache = null;

    if (selection.kind === "pdf") {
      lastLoadedSource = {
        kind: "pdf",
        bytes,
        label: selection.sourceName
      };
      await loadPdfBuffer(createParseBuffer(bytes), selection.sourceName, {
        preserveView: false,
        autoMaxPagesPerRow: true
      });
    } else {
      const zipLabel = `${selection.sourceName} (parsed zip)`;
      lastLoadedSource = {
        kind: "parsed-zip",
        bytes,
        label: zipLabel
      };
      await loadParsedDataZipBuffer(createParseBuffer(bytes), zipLabel, {
        preserveView: false
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load example: ${message}`);
  } finally {
    exampleSelectElement.value = "";
    exampleSelectElement.disabled = exampleSelectionMap.size === 0;
  }
}

function isPdfFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return file.type === "application/pdf" || lowerName.endsWith(".pdf");
}

function isParsedDataZipFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

async function loadPdfFile(file: File): Promise<void> {
  setStatus(`Reading ${file.name}...`);
  const buffer = await file.arrayBuffer();
  const bytes = cloneSourceBytes(buffer);
  lastLoadedSource = { kind: "pdf", bytes, label: file.name };
  parsedPdfPageCache = null;
  await loadPdfBuffer(createParseBuffer(bytes), file.name, { preserveView: false, autoMaxPagesPerRow: true });
}

async function loadParsedDataZipFile(file: File): Promise<void> {
  setStatus(`Reading ${file.name}...`);
  const buffer = await file.arrayBuffer();
  const bytes = cloneSourceBytes(buffer);
  lastLoadedSource = { kind: "parsed-zip", bytes, label: file.name };
  parsedPdfPageCache = null;
  await loadParsedDataZipBuffer(createParseBuffer(bytes), file.name, { preserveView: false });
}

async function loadPdfBuffer(buffer: ArrayBuffer, label: string, options: LoadPdfOptions = {}): Promise<void> {
  const activeLoadToken = ++loadToken;
  const extractionOptions = getExtractionOptions();
  const pageSceneOptionsKey = buildPdfPageCacheKey(extractionOptions);
  const cachedPageScenes = getCachedPdfPageScenes(label, pageSceneOptionsKey);

  try {
    let scene: VectorScene;
    let parseMs = 0;
    let pagesPerRow = readMaxPagesPerRowInput();

    if (cachedPageScenes) {
      if (options.autoMaxPagesPerRow) {
        pagesPerRow = computeAutoPagesPerRow(cachedPageScenes.length);
        maxPagesPerRowInputElement.value = String(pagesPerRow);
      }
      const composeStart = performance.now();
      setParsingLoader(false);
      setStatus(
        `Rearranging ${label}... (pages/row ${pagesPerRow}, using cached parsed pages)`
      );
      scene = composeVectorScenesInGrid(cachedPageScenes, pagesPerRow);
      parseMs = performance.now() - composeStart;
      console.log(
        `[Page grid] ${label}: recomposed ${cachedPageScenes.length.toLocaleString()} cached page scenes at ${pagesPerRow.toLocaleString()} pages/row in ${parseMs.toFixed(1)} ms`
      );
    } else {
      const parseStart = performance.now();
      setParsingLoader(true);
      setStatus(
        `Parsing ${label} with PDF.js... (merge ${extractionOptions.enableSegmentMerge ? "on" : "off"}, cull ${extractionOptions.enableInvisibleCull ? "on" : "off"})`
      );
      const pageScenes = await extractPdfPageScenes(buffer, extractionOptions);
      parseMs = performance.now() - parseStart;

      if (activeLoadToken === loadToken) {
        setParsingLoader(false);
      }

      if (activeLoadToken !== loadToken) {
        return;
      }

      if (options.autoMaxPagesPerRow) {
        pagesPerRow = computeAutoPagesPerRow(pageScenes.length);
        maxPagesPerRowInputElement.value = String(pagesPerRow);
      }

      scene = composeVectorScenesInGrid(pageScenes, pagesPerRow);
      storeCachedPdfPageScenes(label, pageSceneOptionsKey, pageScenes);
      console.log(
        `[Page grid] ${label}: parsed ${pageScenes.length.toLocaleString()} pages in ${parseMs.toFixed(1)} ms, arranged ${pagesPerRow.toLocaleString()}/row`
      );
    }

    if (activeLoadToken !== loadToken) {
      return;
    }

    const rasterLayerCount = listSceneRasterLayers(scene).length;
    const hasRasterLayer = rasterLayerCount > 0;
    if (scene.segmentCount === 0 && scene.textInstanceCount === 0 && scene.fillPathCount === 0 && !hasRasterLayer) {
      setStatus(`No visible geometry was extracted from ${label}.`);
      runtimeTextElement.textContent = "";
      setMetricPlaceholder(label);
      setDownloadDataButtonState(false);
      return;
    }

    setStatus(
      `Uploading ${scene.segmentCount.toLocaleString()} segments, ${scene.textInstanceCount.toLocaleString()} text instances${hasRasterLayer ? `, ${rasterLayerCount.toLocaleString()} raster layer${rasterLayerCount === 1 ? "" : "s"}` : ""} to GPU...`
    );
    const uploadStart = performance.now();
    const sceneStats = renderer.setScene(scene);
    if (!options.preserveView) {
      renderer.fitToBounds(scene.bounds, 64);
    }
    const uploadEnd = performance.now();

    if (activeLoadToken !== loadToken) {
      return;
    }

    logSegmentMergeStats(label, scene);
    logInvisibleCullStats(label, scene);
    logTextVectorStats(label, scene);
    logTextureSizeStats(label, scene, sceneStats);

    lastParsedScene = scene;
    lastParsedSceneStats = sceneStats;
    lastParsedSceneLabel = label;
    refreshDropIndicator();
    setDownloadDataButtonState(true);

    updateMetricsPanel(label, scene, sceneStats, parseMs, uploadEnd - uploadStart);
    baseStatus = formatSceneStatus(label, scene);
    statusTextElement.textContent = baseStatus;
  } catch (error) {
    if (activeLoadToken !== loadToken) {
      return;
    }

    setParsingLoader(false);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to render PDF: ${message}`);
    runtimeTextElement.textContent = "";
    setMetricPlaceholder(label);
  }
}

async function reloadLastPdfWithCurrentOptions(): Promise<void> {
  if (!lastLoadedSource || lastLoadedSource.kind !== "pdf") {
    return;
  }
  await loadPdfBuffer(createParseBuffer(lastLoadedSource.bytes), lastLoadedSource.label, { preserveView: true });
}

async function loadParsedDataZipBuffer(buffer: ArrayBuffer, label: string, options: LoadPdfOptions = {}): Promise<void> {
  const activeLoadToken = ++loadToken;

  try {
    const parseStart = performance.now();
    setParsingLoader(true);
    setStatus(`Loading parsed data from ${label}...`);
    const scene = await loadSceneFromParsedDataZip(buffer);
    const parseEnd = performance.now();

    if (activeLoadToken === loadToken) {
      setParsingLoader(false);
    }

    if (activeLoadToken !== loadToken) {
      return;
    }

    const rasterLayerCount = listSceneRasterLayers(scene).length;
    const hasRasterLayer = rasterLayerCount > 0;
    if (scene.segmentCount === 0 && scene.textInstanceCount === 0 && scene.fillPathCount === 0 && !hasRasterLayer) {
      setStatus(`No visible geometry was found in ${label}.`);
      runtimeTextElement.textContent = "";
      setMetricPlaceholder(label);
      setDownloadDataButtonState(false);
      return;
    }

    setStatus(
      `Uploading ${scene.segmentCount.toLocaleString()} segments, ${scene.textInstanceCount.toLocaleString()} text instances${hasRasterLayer ? `, ${rasterLayerCount.toLocaleString()} raster layer${rasterLayerCount === 1 ? "" : "s"}` : ""} to GPU...`
    );
    const uploadStart = performance.now();
    const sceneStats = renderer.setScene(scene);
    if (!options.preserveView) {
      renderer.fitToBounds(scene.bounds, 64);
    }
    const uploadEnd = performance.now();

    if (activeLoadToken !== loadToken) {
      return;
    }

    logSegmentMergeStats(label, scene);
    logInvisibleCullStats(label, scene);
    logTextVectorStats(label, scene);
    logTextureSizeStats(label, scene, sceneStats);

    lastParsedScene = scene;
    lastParsedSceneStats = sceneStats;
    lastParsedSceneLabel = label;
    refreshDropIndicator();
    setDownloadDataButtonState(true);

    updateMetricsPanel(label, scene, sceneStats, parseEnd - parseStart, uploadEnd - uploadStart);
    baseStatus = `${formatSceneStatus(label, scene)} | source: parsed data zip`;
    statusTextElement.textContent = baseStatus;
  } catch (error) {
    if (activeLoadToken !== loadToken) {
      return;
    }

    setParsingLoader(false);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load parsed data zip: ${message}`);
    runtimeTextElement.textContent = "";
    setMetricPlaceholder(label);
  }
}

function getExtractionOptions(): VectorExtractOptions {
  return {
    enableSegmentMerge: segmentMergeToggleElement.checked,
    enableInvisibleCull: invisibleCullToggleElement.checked
  };
}

function buildPdfPageCacheKey(options: VectorExtractOptions): string {
  const mergeEnabled = options.enableSegmentMerge !== false;
  const invisibleCullEnabled = options.enableInvisibleCull !== false;
  return `merge:${mergeEnabled ? 1 : 0}|cull:${invisibleCullEnabled ? 1 : 0}`;
}

function getCachedPdfPageScenes(label: string, optionsKey: string): VectorScene[] | null {
  if (!lastLoadedSource || lastLoadedSource.kind !== "pdf" || !parsedPdfPageCache) {
    return null;
  }
  if (parsedPdfPageCache.sourceBytes !== lastLoadedSource.bytes) {
    return null;
  }
  if (parsedPdfPageCache.sourceLabel !== label) {
    return null;
  }
  if (parsedPdfPageCache.optionsKey !== optionsKey) {
    return null;
  }
  return parsedPdfPageCache.pageScenes;
}

function storeCachedPdfPageScenes(label: string, optionsKey: string, pageScenes: VectorScene[]): void {
  if (!lastLoadedSource || lastLoadedSource.kind !== "pdf") {
    return;
  }
  parsedPdfPageCache = {
    sourceBytes: lastLoadedSource.bytes,
    sourceLabel: label,
    optionsKey,
    pageScenes
  };
}

function listSceneRasterLayers(scene: VectorScene): RasterLayer[] {
  const out: RasterLayer[] = [];
  if (Array.isArray(scene.rasterLayers)) {
    for (const layer of scene.rasterLayers) {
      const width = Math.max(0, Math.trunc(layer?.width ?? 0));
      const height = Math.max(0, Math.trunc(layer?.height ?? 0));
      if (width <= 0 || height <= 0 || !(layer.data instanceof Uint8Array) || layer.data.length < width * height * 4) {
        continue;
      }

      const matrix = layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix);
      out.push({
        width,
        height,
        data: layer.data,
        matrix
      });
    }
  }

  if (out.length > 0) {
    return out;
  }

  const legacyWidth = Math.max(0, Math.trunc(scene.rasterLayerWidth));
  const legacyHeight = Math.max(0, Math.trunc(scene.rasterLayerHeight));
  if (legacyWidth <= 0 || legacyHeight <= 0 || scene.rasterLayerData.length < legacyWidth * legacyHeight * 4) {
    return out;
  }

  out.push({
    width: legacyWidth,
    height: legacyHeight,
    data: scene.rasterLayerData,
    matrix: scene.rasterLayerMatrix
  });
  return out;
}

function formatRasterLayerSummary(scene: VectorScene): string {
  const rasterLayers = listSceneRasterLayers(scene);
  if (rasterLayers.length === 0) {
    return "";
  }
  if (rasterLayers.length === 1) {
    return `${rasterLayers[0].width}x${rasterLayers[0].height}`;
  }

  const totalPixels = rasterLayers.reduce((sum, layer) => sum + layer.width * layer.height, 0);
  const megaPixels = totalPixels / 1_000_000;
  return `${rasterLayers.length.toLocaleString()} layers (${megaPixels.toFixed(1)} MP total)`;
}

function formatSceneStatus(
  label: string,
  scene: VectorScene
): string {
  const pagePrefix =
    scene.pageCount > 1
      ? `${scene.pageCount.toLocaleString()} pages (${scene.pagesPerRow.toLocaleString()}/row) | `
      : "";
  const fillPathCount = scene.fillPathCount.toLocaleString();
  const sourceSegmentCount = scene.sourceSegmentCount.toLocaleString();
  const visibleSegmentCount = scene.segmentCount.toLocaleString();
  const textInstanceCount = scene.textInstanceCount.toLocaleString();
  const rasterSummary = formatRasterLayerSummary(scene);
  const rasterSuffix = rasterSummary ? `, raster ${rasterSummary}` : "";
  return `${label} loaded | ${pagePrefix}fills ${fillPathCount}, ${visibleSegmentCount} visible from ${sourceSegmentCount} source segments, ${textInstanceCount} text instances${rasterSuffix}`;
}

function setStatus(message: string): void {
  baseStatus = message;
  statusTextElement.textContent = baseStatus;
}

function setParsingLoader(isVisible: boolean): void {
  parsingLoaderElement.hidden = !isVisible;
}

function setDownloadDataButtonState(hasParsedData: boolean, isBusy = false): void {
  downloadDataButtonElement.hidden = !hasParsedData;
  downloadDataButtonElement.disabled = !hasParsedData || isBusy;
  downloadDataButtonElement.textContent = isBusy ? "Preparing ZIP..." : "Download Parsed Data";
}

function setHudCollapsed(collapsed: boolean): void {
  hudPanelElement.classList.toggle("collapsed", collapsed);
  toggleHudButtonElement.setAttribute("aria-expanded", String(!collapsed));
  toggleHudButtonElement.title = collapsed ? "Expand panel" : "Collapse panel";
  toggleHudIconElement.textContent = collapsed ? "▸" : "▾";
}

function readMaxPagesPerRowInput(): number {
  const parsed = Math.trunc(Number(maxPagesPerRowInputElement.value));
  if (!Number.isFinite(parsed)) {
    return 10;
  }
  return clamp(parsed, 1, 100);
}

function readPageBackgroundColorInput(): [number, number, number, number] {
  const hex = pageBackgroundColorInputElement.value || "#ffffff";
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const opacityPercent = readPageBackgroundOpacityPercent(pageBackgroundOpacityInputElement.value);
  setPageBackgroundOpacityControls(opacityPercent);
  const alpha = opacityPercent / 100;
  if (!match) {
    return [1, 1, 1, alpha];
  }
  const packed = Number.parseInt(match[1], 16);
  if (!Number.isFinite(packed)) {
    return [1, 1, 1, alpha];
  }
  const red = ((packed >> 16) & 0xff) / 255;
  const green = ((packed >> 8) & 0xff) / 255;
  const blue = (packed & 0xff) / 255;
  return [red, green, blue, alpha];
}

function readPageBackgroundOpacityPercent(value: string): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) {
    return 100;
  }
  return clamp(parsed, 0, 100);
}

function readVectorColorOverrideInput(): [number, number, number, number] {
  const hex = vectorColorInputElement.value || "#000000";
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const opacityPercent = readVectorOpacityPercent(vectorOpacityInputElement.value);
  setVectorOpacityControls(opacityPercent);
  const opacity = opacityPercent / 100;
  if (!match) {
    return [0, 0, 0, opacity];
  }
  const packed = Number.parseInt(match[1], 16);
  if (!Number.isFinite(packed)) {
    return [0, 0, 0, opacity];
  }
  const red = ((packed >> 16) & 0xff) / 255;
  const green = ((packed >> 8) & 0xff) / 255;
  const blue = (packed & 0xff) / 255;
  return [red, green, blue, opacity];
}

function readVectorOpacityPercent(value: string): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clamp(parsed, 0, 100);
}

function setPageBackgroundOpacityControls(opacityPercent: number): void {
  const normalized = clamp(Math.trunc(opacityPercent), 0, 100);
  pageBackgroundOpacityInputElement.value = String(normalized);
  pageBackgroundOpacitySliderElement.value = String(normalized);
}

function setVectorOpacityControls(opacityPercent: number): void {
  const normalized = clamp(Math.trunc(opacityPercent), 0, 100);
  vectorOpacityInputElement.value = String(normalized);
  vectorOpacitySliderElement.value = String(normalized);
}

function applyPageBackgroundColorFromControls(): void {
  const pageBackgroundColor = readPageBackgroundColorInput();
  renderer.setPageBackgroundColor(
    pageBackgroundColor[0],
    pageBackgroundColor[1],
    pageBackgroundColor[2],
    pageBackgroundColor[3]
  );
}

function applyVectorColorOverrideFromControls(): void {
  const vectorColorOverride = readVectorColorOverrideInput();
  renderer.setVectorColorOverride(
    vectorColorOverride[0],
    vectorColorOverride[1],
    vectorColorOverride[2],
    vectorColorOverride[3]
  );
}

async function downloadParsedDataZip(): Promise<void> {
  if (!lastParsedScene || !lastParsedSceneStats || !lastParsedSceneLabel) {
    setStatus("No parsed floorplan data available to export.");
    return;
  }

  const scene = lastParsedScene;
  const sceneStats = lastParsedSceneStats;
  const label = lastParsedSceneLabel;
  let sourcePdfBytes = lastLoadedSource?.kind === "pdf" ? lastLoadedSource.bytes : null;
  if (scene.imagePaintOpCount <= 0) {
    sourcePdfBytes = null;
  }
  if (!sourcePdfBytes && lastLoadedSource?.kind === "parsed-zip") {
    sourcePdfBytes = await tryReadSourcePdfBytesFromExistingParsedZip(lastLoadedSource.bytes);
  }
  const previousStatusText = statusTextElement.textContent;

  setDownloadDataButtonState(true, true);
  statusTextElement.textContent = "Preparing parsed texture data zip...";

  try {
    const interleavedZip = await buildParsedDataZipBlobForLayout(scene, sceneStats, label, sourcePdfBytes, "interleaved");
    const channelMajorZip = await buildParsedDataZipBlobForLayout(scene, sceneStats, label, sourcePdfBytes, "channel-major");
    const selectedZip = channelMajorZip.byteLength < interleavedZip.byteLength ? channelMajorZip : interleavedZip;

    const zipFileName = `${sanitizeDownloadName(label)}-parsed-data.zip`;
    triggerBlobDownload(selectedZip.blob, zipFileName);
    console.log(
      `[Parsed data export] ${label}: wrote ${selectedZip.textureCount.toLocaleString()} vector textures + ${selectedZip.rasterLayerCount.toLocaleString()} raster layers to ${zipFileName} using ${selectedZip.layout} layout (${formatKilobytes(selectedZip.byteLength)} kB, interleaved ${formatKilobytes(interleavedZip.byteLength)} kB, channel-major ${formatKilobytes(channelMajorZip.byteLength)} kB)`
    );
    statusTextElement.textContent = previousStatusText || baseStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to download parsed data: ${message}`);
  } finally {
    setDownloadDataButtonState(true, false);
  }
}

interface ParsedDataZipBlobResult {
  blob: Blob;
  byteLength: number;
  textureCount: number;
  rasterLayerCount: number;
  layout: TextureLayout;
}

interface SerializedRasterLayerEntry {
  width: number;
  height: number;
  matrix: number[];
  file: string;
  encoding: "webp" | "png" | "rgba";
}

async function buildParsedDataZipBlobForLayout(
  scene: VectorScene,
  sceneStats: SceneStats,
  label: string,
  sourcePdfBytes: Uint8Array | null,
  textureLayout: TextureLayout
): Promise<ParsedDataZipBlobResult> {
  const zip = new JSZip();
  const textureEntries = buildTextureExportEntries(scene, sceneStats, textureLayout);
  const includeSourcePdf = !!sourcePdfBytes && sourcePdfBytes.length > 0 && scene.imagePaintOpCount > 0;
  const sceneRasterLayers = listSceneRasterLayers(scene);
  const useSourcePdfFallback = includeSourcePdf && sceneRasterLayers.length === 0;
  const rasterLayers = useSourcePdfFallback ? [] : sceneRasterLayers;
  const primaryRasterLayer = rasterLayers[0] ?? null;
  const sourcePdfFile = useSourcePdfFallback ? "source/source.pdf" : undefined;

  for (const entry of textureEntries) {
    const bytes = entry.layout === "channel-major"
      ? encodeChannelMajorFloat32(entry.data)
      : new Uint8Array(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    zip.file(entry.filePath, bytes);
  }

  if (sourcePdfFile && sourcePdfBytes) {
    zip.file(sourcePdfFile, sourcePdfBytes);
  }

  const serializedRasterLayers: SerializedRasterLayerEntry[] = [];
  for (let i = 0; i < rasterLayers.length; i += 1) {
    const layer = rasterLayers[i];
    const expectedBytes = layer.width * layer.height * 4;
    const rasterBytes = layer.data.subarray(0, expectedBytes);
    let filePath = `raster/layer-${i}.rgba`;
    let encoding: "webp" | "png" | "rgba" = "rgba";
    let layerBytes: Uint8Array = rasterBytes;
    const encodedImage = await encodeRasterLayerAsBestImage(layer.width, layer.height, rasterBytes);
    if (encodedImage) {
      filePath = `raster/layer-${i}.${encodedImage.extension}`;
      encoding = encodedImage.encoding;
      layerBytes = encodedImage.bytes;
    }
    zip.file(filePath, layerBytes, encoding === "rgba" ? undefined : { compression: "STORE" });
    serializedRasterLayers.push({
      width: layer.width,
      height: layer.height,
      matrix: Array.from(layer.matrix),
      file: filePath,
      encoding
    });
  }

  const manifest = {
    formatVersion: 3,
    sourceFile: label,
    sourcePdfFile,
    sourcePdfSizeBytes: useSourcePdfFallback ? sourcePdfBytes?.length ?? 0 : 0,
    generatedAt: new Date().toISOString(),
    scene: {
      bounds: scene.bounds,
      pageBounds: scene.pageBounds,
      pageRects: Array.from(scene.pageRects),
      pageCount: scene.pageCount,
      pagesPerRow: scene.pagesPerRow,
      maxHalfWidth: scene.maxHalfWidth,
      operatorCount: scene.operatorCount,
      imagePaintOpCount: scene.imagePaintOpCount,
      pathCount: scene.pathCount,
      sourceSegmentCount: scene.sourceSegmentCount,
      mergedSegmentCount: scene.mergedSegmentCount,
      segmentCount: scene.segmentCount,
      fillPathCount: scene.fillPathCount,
      fillSegmentCount: scene.fillSegmentCount,
      textInstanceCount: scene.textInstanceCount,
      textGlyphCount: scene.textGlyphCount,
      textGlyphPrimitiveCount: scene.textGlyphSegmentCount,
      rasterLayers: serializedRasterLayers,
      rasterLayerWidth: primaryRasterLayer?.width ?? 0,
      rasterLayerHeight: primaryRasterLayer?.height ?? 0,
      rasterLayerMatrix: primaryRasterLayer ? Array.from(primaryRasterLayer.matrix) : undefined,
      rasterLayerFile: serializedRasterLayers[0]?.file
    },
    textures: textureEntries.map((entry) => ({
      name: entry.name,
      file: entry.filePath,
      width: entry.width,
      height: entry.height,
      channels: 4,
      componentType: "float32",
      layout: entry.layout,
      byteShuffle: false,
      predictor: "none",
      logicalItemCount: entry.logicalItemCount,
      logicalFloatCount: entry.logicalFloatCount,
      paddedFloatCount: entry.data.length
    }))
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });

  return {
    blob: zipBlob,
    byteLength: zipBlob.size,
    textureCount: textureEntries.length,
    rasterLayerCount: rasterLayers.length,
    layout: textureLayout
  };
}

function buildTextureExportEntries(scene: VectorScene, sceneStats: SceneStats, textureLayout: TextureLayout): ExportTextureEntry[] {
  return [
    createTextureExportEntry("fill-path-meta-a", scene.fillPathMetaA, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-path-meta-b", scene.fillPathMetaB, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-path-meta-c", scene.fillPathMetaC, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount, textureLayout),
    createTextureExportEntry("fill-primitives-a", scene.fillSegmentsA, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount, textureLayout),
    createTextureExportEntry("fill-primitives-b", scene.fillSegmentsB, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount, textureLayout),
    createTextureExportEntry("stroke-primitives-a", scene.endpoints, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("stroke-primitives-b", scene.primitiveMeta, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("stroke-styles", scene.styles, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("stroke-primitive-bounds", scene.primitiveBounds, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount, textureLayout),
    createTextureExportEntry("text-instance-a", scene.textInstanceA, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-instance-b", scene.textInstanceB, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-instance-c", scene.textInstanceC, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-a", scene.textGlyphMetaA, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    createTextureExportEntry("text-glyph-meta-b", scene.textGlyphMetaB, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount, textureLayout),
    createTextureExportEntry("text-glyph-primitives-a", scene.textGlyphSegmentsA, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount, textureLayout),
    createTextureExportEntry("text-glyph-primitives-b", scene.textGlyphSegmentsB, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount, textureLayout)
  ];
}

async function loadSceneFromParsedDataZip(buffer: ArrayBuffer): Promise<VectorScene> {
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("Parsed data zip is missing manifest.json.");
  }

  const manifestJson = await manifestFile.async("string");
  let manifest: ParsedDataManifest;
  try {
    manifest = JSON.parse(manifestJson) as ParsedDataManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid manifest.json: ${message}`);
  }

  const sceneMeta = typeof manifest.scene === "object" && manifest.scene ? manifest.scene : {};
  const manifestTextures = Array.isArray(manifest.textures) ? manifest.textures : [];

  const textureByName = new Map<string, ParsedDataTextureEntry>();
  for (const entry of manifestTextures) {
    const name = typeof entry.name === "string" ? entry.name : null;
    if (!name) {
      continue;
    }
    textureByName.set(name, entry);
  }

  const readTexture = async (
    candidateNames: string[],
    required: boolean
  ): Promise<{ data: Float32Array; logicalItemCount: number } | null> => {
    for (const candidate of candidateNames) {
      const entry = textureByName.get(candidate);
      if (!entry) {
        continue;
      }

      const inferredSuffix =
        typeof entry.layout === "string" && entry.layout === "channel-major"
          ? ".f32cm"
          : entry.byteShuffle === true
            ? ".f32bs"
            : ".f32";
      const path = typeof entry.file === "string" ? entry.file : `textures/${candidate}${inferredSuffix}`;
      const zipEntry = zip.file(path);
      if (!zipEntry) {
        continue;
      }

      const fileBuffer = await zipEntry.async("arraybuffer");
      const raw = readTexturePayloadAsFloat32(fileBuffer, entry, candidate);
      const logicalFloatCount = readNonNegativeInt(entry.logicalFloatCount, raw.length);
      if (logicalFloatCount > raw.length) {
        throw new Error(`Texture ${candidate} logical float count exceeds file length.`);
      }

      const logicalItemCount = readNonNegativeInt(entry.logicalItemCount, Math.floor(logicalFloatCount / 4));
      return {
        data: raw.slice(0, logicalFloatCount),
        logicalItemCount
      };
    }

    if (required) {
      throw new Error(`Parsed data zip is missing required texture: ${candidateNames[0]}.`);
    }

    return null;
  };

  const fillPathMetaAEntry = await readTexture(["fill-path-meta-a"], false);
  const fillPathMetaBEntry = await readTexture(["fill-path-meta-b"], false);
  const fillPathMetaCEntry = await readTexture(["fill-path-meta-c"], false);
  const fillPrimitiveAEntry = await readTexture(["fill-primitives-a", "fill-segments"], false);
  const fillPrimitiveBEntry = await readTexture(["fill-primitives-b"], false);
  const strokePrimitiveAEntry = await readTexture(["stroke-primitives-a", "stroke-endpoints"], false);
  const strokePrimitiveBEntry = await readTexture(["stroke-primitives-b"], false);
  const strokeStylesEntry = await readTexture(["stroke-styles"], false);
  const strokePrimitiveBoundsEntry = await readTexture(["stroke-primitive-bounds"], false);
  const textInstanceAEntry = await readTexture(["text-instance-a"], false);
  const textInstanceBEntry = await readTexture(["text-instance-b"], false);
  const textInstanceCEntry = await readTexture(["text-instance-c"], false);
  const textGlyphMetaAEntry = await readTexture(["text-glyph-meta-a"], false);
  const textGlyphMetaBEntry = await readTexture(["text-glyph-meta-b"], false);
  const textGlyphPrimitiveAEntry = await readTexture(["text-glyph-primitives-a"], false);
  const textGlyphPrimitiveBEntry = await readTexture(["text-glyph-primitives-b"], false);

  const fillPathCount = readNonNegativeInt(sceneMeta.fillPathCount, fillPathMetaAEntry?.logicalItemCount ?? 0);
  const fillSegmentCount = readNonNegativeInt(sceneMeta.fillSegmentCount, fillPrimitiveAEntry?.logicalItemCount ?? 0);
  const segmentCount = readNonNegativeInt(
    sceneMeta.segmentCount,
    strokeStylesEntry?.logicalItemCount ?? strokePrimitiveAEntry?.logicalItemCount ?? 0
  );
  const textInstanceCount = readNonNegativeInt(sceneMeta.textInstanceCount, textInstanceAEntry?.logicalItemCount ?? 0);
  const textGlyphCount = readNonNegativeInt(sceneMeta.textGlyphCount, textGlyphMetaAEntry?.logicalItemCount ?? 0);
  const textGlyphSegmentCount = readNonNegativeInt(
    sceneMeta.textGlyphPrimitiveCount,
    readNonNegativeInt(sceneMeta.textGlyphSegmentCount, textGlyphPrimitiveAEntry?.logicalItemCount ?? 0)
  );

  if (segmentCount > 0 && (!strokePrimitiveAEntry || !strokeStylesEntry)) {
    throw new Error("Parsed data zip is missing stroke geometry textures.");
  }

  const fillPathMetaA = trimTextureForItemCount(fillPathMetaAEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-a");
  const fillPathMetaB = trimTextureForItemCount(fillPathMetaBEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-b");
  const fillPathMetaC = trimTextureForItemCount(fillPathMetaCEntry?.data ?? new Float32Array(0), fillPathCount, "fill-path-meta-c");
  const fillSegmentsA = trimTextureForItemCount(fillPrimitiveAEntry?.data ?? new Float32Array(0), fillSegmentCount, "fill-primitives-a");
  const fillSegmentsB = fillPrimitiveBEntry
    ? trimTextureForItemCount(fillPrimitiveBEntry.data, fillSegmentCount, "fill-primitives-b")
    : deriveLinePrimitiveB(fillSegmentsA, fillSegmentCount);

  const endpoints = trimTextureForItemCount(strokePrimitiveAEntry?.data ?? new Float32Array(0), segmentCount, "stroke-primitives-a");
  const styles = trimTextureForItemCount(strokeStylesEntry?.data ?? new Float32Array(0), segmentCount, "stroke-styles");
  const primitiveMeta = strokePrimitiveBEntry
    ? trimTextureForItemCount(strokePrimitiveBEntry.data, segmentCount, "stroke-primitives-b")
    : deriveLinePrimitiveB(endpoints, segmentCount);
  const primitiveBounds = strokePrimitiveBoundsEntry
    ? trimTextureForItemCount(strokePrimitiveBoundsEntry.data, segmentCount, "stroke-primitive-bounds")
    : derivePrimitiveBounds(endpoints, primitiveMeta, segmentCount);

  const textInstanceA = trimTextureForItemCount(textInstanceAEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-a");
  const textInstanceB = trimTextureForItemCount(textInstanceBEntry?.data ?? new Float32Array(0), textInstanceCount, "text-instance-b");
  const textInstanceC = textInstanceCEntry
    ? trimTextureForItemCount(textInstanceCEntry.data, textInstanceCount, "text-instance-c")
    : deriveLegacyTextInstanceColors(textInstanceB, textInstanceCount);
  const textGlyphMetaA = trimTextureForItemCount(textGlyphMetaAEntry?.data ?? new Float32Array(0), textGlyphCount, "text-glyph-meta-a");
  const textGlyphMetaB = trimTextureForItemCount(textGlyphMetaBEntry?.data ?? new Float32Array(0), textGlyphCount, "text-glyph-meta-b");
  const textGlyphSegmentsA = trimTextureForItemCount(
    textGlyphPrimitiveAEntry?.data ?? new Float32Array(0),
    textGlyphSegmentCount,
    "text-glyph-primitives-a"
  );
  const textGlyphSegmentsB = trimTextureForItemCount(
    textGlyphPrimitiveBEntry?.data ?? new Float32Array(0),
    textGlyphSegmentCount,
    "text-glyph-primitives-b"
  );

  migrateLegacyStrokeLayout(primitiveMeta, styles, segmentCount);
  migrateLegacyFillLayout(fillPathMetaB, fillPathMetaC, fillPathCount);

  const sourceSegmentCount = readNonNegativeInt(sceneMeta.sourceSegmentCount, segmentCount);
  const mergedSegmentCount = readNonNegativeInt(sceneMeta.mergedSegmentCount, segmentCount);
  const sourceTextCount = readNonNegativeInt(sceneMeta.sourceTextCount, textInstanceCount);
  const textInPageCount = readNonNegativeInt(sceneMeta.textInPageCount, textInstanceCount);
  const textOutOfPageCount = readNonNegativeInt(sceneMeta.textOutOfPageCount, Math.max(0, sourceTextCount - textInPageCount));
  const pageCount = Math.max(1, readNonNegativeInt(sceneMeta.pageCount, 1));
  const pagesPerRow = Math.max(1, readNonNegativeInt(sceneMeta.pagesPerRow, 1));
  let rasterLayers = await readRasterLayersFromParsedData(zip, sceneMeta);
  if (rasterLayers.length === 0) {
    const sourcePdfBytes = await readSourcePdfBytesFromParsedData(zip, manifest);
    if (sourcePdfBytes) {
      try {
        const rasterScene = await extractPdfRasterScene(createParseBuffer(sourcePdfBytes), {
          maxPages: pageCount,
          maxPagesPerRow: pagesPerRow
        });
        rasterLayers = listSceneRasterLayers(rasterScene);
        if (rasterLayers.length > 0) {
          console.log(
            `[Parsed data load] Restored ${rasterLayers.length.toLocaleString()} raster layer(s) from embedded source PDF.`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Parsed data load] Failed to restore raster layers from source PDF: ${message}`);
      }
    }
  }
  const primaryRasterLayer = rasterLayers[0] ?? null;
  const maxHalfWidth =
    readFiniteNumber(sceneMeta.maxHalfWidth, Number.NaN) ||
    computeMaxHalfWidth(styles, segmentCount);

  const parsedBounds = parseBounds(sceneMeta.bounds);
  const parsedPageBounds = parseBounds(sceneMeta.pageBounds);
  const fallbackBounds =
    mergeBounds(
      boundsFromPrimitiveBounds(primitiveBounds, segmentCount),
      boundsFromFillPathMeta(fillPathMetaA, fillPathMetaB, fillPathCount)
    ) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const bounds = parsedBounds ?? fallbackBounds;
  const pageBounds = parsedPageBounds ?? bounds;
  const pageRects = parsePageRects(sceneMeta.pageRects, pageBounds);

  return {
    pageRects,
    fillPathCount,
    fillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    segmentCount,
    sourceSegmentCount,
    mergedSegmentCount,
    sourceTextCount,
    textInstanceCount,
    textGlyphCount,
    textGlyphSegmentCount,
    textInPageCount,
    textOutOfPageCount,
    textInstanceA,
    textInstanceB,
    textInstanceC,
    textGlyphMetaA,
    textGlyphMetaB,
    textGlyphSegmentsA,
    textGlyphSegmentsB,
    rasterLayers,
    rasterLayerWidth: primaryRasterLayer?.width ?? 0,
    rasterLayerHeight: primaryRasterLayer?.height ?? 0,
    rasterLayerData: primaryRasterLayer?.data ?? new Uint8Array(0),
    rasterLayerMatrix: primaryRasterLayer?.matrix ?? new Float32Array([1, 0, 0, 1, 0, 0]),
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    bounds,
    pageBounds,
    pageCount,
    pagesPerRow,
    maxHalfWidth,
    imagePaintOpCount: readNonNegativeInt(sceneMeta.imagePaintOpCount, 0),
    operatorCount: readNonNegativeInt(sceneMeta.operatorCount, 0),
    pathCount: readNonNegativeInt(sceneMeta.pathCount, 0),
    discardedTransparentCount: readNonNegativeInt(sceneMeta.discardedTransparentCount, 0),
    discardedDegenerateCount: readNonNegativeInt(sceneMeta.discardedDegenerateCount, 0),
    discardedDuplicateCount: readNonNegativeInt(sceneMeta.discardedDuplicateCount, 0),
    discardedContainedCount: readNonNegativeInt(sceneMeta.discardedContainedCount, 0)
  };
}

function trimTextureForItemCount(source: Float32Array, itemCount: number, label: string): Float32Array {
  const expectedLength = itemCount * 4;
  if (expectedLength === 0) {
    return new Float32Array(0);
  }
  if (source.length < expectedLength) {
    throw new Error(`Texture ${label} has insufficient data (${source.length} < ${expectedLength}).`);
  }
  if (source.length === expectedLength) {
    return source;
  }
  return source.slice(0, expectedLength);
}

function deriveLinePrimitiveB(primitivesA: Float32Array, primitiveCount: number): Float32Array {
  const out = new Float32Array(primitiveCount * 4);
  for (let i = 0; i < primitiveCount; i += 1) {
    const offset = i * 4;
    out[offset] = primitivesA[offset + 2];
    out[offset + 1] = primitivesA[offset + 3];
    out[offset + 2] = 0;
    out[offset + 3] = 0;
  }
  return out;
}

function deriveLegacyTextInstanceColors(textInstanceB: Float32Array, textInstanceCount: number): Float32Array {
  const out = new Float32Array(textInstanceCount * 4);
  for (let i = 0; i < textInstanceCount; i += 1) {
    const offset = i * 4;
    const luma = clamp01(textInstanceB[offset + 3]);
    out[offset] = luma;
    out[offset + 1] = luma;
    out[offset + 2] = luma;
    out[offset + 3] = 1;
  }
  return out;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function migrateLegacyStrokeLayout(primitiveMeta: Float32Array, styles: Float32Array, segmentCount: number): void {
  if (segmentCount <= 0) {
    return;
  }

  let hasPackedStyleMeta = false;
  for (let i = 0; i < segmentCount; i += 1) {
    if (Math.abs(primitiveMeta[i * 4 + 3]) > 1e-6) {
      hasPackedStyleMeta = true;
      break;
    }
  }
  if (hasPackedStyleMeta) {
    return;
  }

  for (let i = 0; i < segmentCount; i += 1) {
    const offset = i * 4;
    const luma = clamp01(styles[offset + 1]);
    const alpha = clamp01(styles[offset + 2]);
    const styleFlags = styles[offset + 3] >= 0.5 ? 1 : 0;
    styles[offset + 1] = luma;
    styles[offset + 2] = luma;
    styles[offset + 3] = luma;
    primitiveMeta[offset + 3] = alpha + styleFlags * 2;
  }
}

function migrateLegacyFillLayout(fillPathMetaB: Float32Array, fillPathMetaC: Float32Array, fillPathCount: number): void {
  if (fillPathCount <= 0) {
    return;
  }

  let hasPackedFillAlpha = false;
  for (let i = 0; i < fillPathCount; i += 1) {
    if (Math.abs(fillPathMetaC[i * 4 + 3]) > 1e-6) {
      hasPackedFillAlpha = true;
      break;
    }
  }
  if (hasPackedFillAlpha) {
    return;
  }

  for (let i = 0; i < fillPathCount; i += 1) {
    const offset = i * 4;
    const luma = clamp01(fillPathMetaB[offset + 2]);
    const alpha = clamp01(fillPathMetaB[offset + 3]);
    fillPathMetaB[offset + 2] = luma;
    fillPathMetaB[offset + 3] = luma;
    fillPathMetaC[offset + 2] = luma;
    fillPathMetaC[offset + 3] = alpha;
  }
}

function derivePrimitiveBounds(primitivesA: Float32Array, primitivesB: Float32Array, primitiveCount: number): Float32Array {
  const out = new Float32Array(primitiveCount * 4);
  for (let i = 0; i < primitiveCount; i += 1) {
    const offset = i * 4;
    const x0 = primitivesA[offset];
    const y0 = primitivesA[offset + 1];
    const x1 = primitivesA[offset + 2];
    const y1 = primitivesA[offset + 3];
    const x2 = primitivesB[offset];
    const y2 = primitivesB[offset + 1];

    out[offset] = Math.min(x0, x1, x2);
    out[offset + 1] = Math.min(y0, y1, y2);
    out[offset + 2] = Math.max(x0, x1, x2);
    out[offset + 3] = Math.max(y0, y1, y2);
  }
  return out;
}

function boundsFromPrimitiveBounds(primitiveBounds: Float32Array, primitiveCount: number): Bounds | null {
  if (primitiveCount <= 0 || primitiveBounds.length < primitiveCount * 4) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < primitiveCount; i += 1) {
    const offset = i * 4;
    minX = Math.min(minX, primitiveBounds[offset]);
    minY = Math.min(minY, primitiveBounds[offset + 1]);
    maxX = Math.max(maxX, primitiveBounds[offset + 2]);
    maxY = Math.max(maxY, primitiveBounds[offset + 3]);
  }

  return { minX, minY, maxX, maxY };
}

function boundsFromFillPathMeta(metaA: Float32Array, metaB: Float32Array, fillPathCount: number): Bounds | null {
  if (fillPathCount <= 0 || metaA.length < fillPathCount * 4 || metaB.length < fillPathCount * 4) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < fillPathCount; i += 1) {
    const offset = i * 4;
    minX = Math.min(minX, metaA[offset + 2]);
    minY = Math.min(minY, metaA[offset + 3]);
    maxX = Math.max(maxX, metaB[offset]);
    maxY = Math.max(maxY, metaB[offset + 1]);
  }

  return { minX, minY, maxX, maxY };
}

function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a && !b) {
    return null;
  }
  if (!a) {
    return b ? { ...b } : null;
  }
  if (!b) {
    return { ...a };
  }
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function parseBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybe = value as Record<string, unknown>;
  const minX = readFiniteNumber(maybe.minX, Number.NaN);
  const minY = readFiniteNumber(maybe.minY, Number.NaN);
  const maxX = readFiniteNumber(maybe.maxX, Number.NaN);
  const maxY = readFiniteNumber(maybe.maxY, Number.NaN);

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function parsePageRects(value: unknown, fallbackBounds: Bounds): Float32Array {
  if (Array.isArray(value)) {
    const quadCount = Math.floor(value.length / 4);
    if (quadCount > 0) {
      const out = new Float32Array(quadCount * 4);
      let writeOffset = 0;
      for (let i = 0; i < quadCount; i += 1) {
        const readOffset = i * 4;
        const minX = Number(value[readOffset]);
        const minY = Number(value[readOffset + 1]);
        const maxX = Number(value[readOffset + 2]);
        const maxY = Number(value[readOffset + 3]);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
          continue;
        }
        out[writeOffset] = minX;
        out[writeOffset + 1] = minY;
        out[writeOffset + 2] = maxX;
        out[writeOffset + 3] = maxY;
        writeOffset += 4;
      }
      if (writeOffset > 0) {
        return out.slice(0, writeOffset);
      }
    }
  }
  return new Float32Array([fallbackBounds.minX, fallbackBounds.minY, fallbackBounds.maxX, fallbackBounds.maxY]);
}

function parseMat2D(value: unknown): Float32Array | null {
  if (!Array.isArray(value) || value.length < 6) {
    return null;
  }

  const out = new Float32Array(6);
  for (let i = 0; i < 6; i += 1) {
    const component = Number(value[i]);
    if (!Number.isFinite(component)) {
      return null;
    }
    out[i] = component;
  }
  return out;
}

async function readSourcePdfBytesFromParsedData(zip: JSZip, manifest: ParsedDataManifest): Promise<Uint8Array | null> {
  const manifestPath = readNonEmptyString(manifest.sourcePdfFile);
  const manifestUrl = readNonEmptyString(manifest.sourcePdfUrl);
  const candidatePaths = [
    manifestPath,
    "source/source.pdf",
    "source.pdf"
  ];

  for (const candidatePath of candidatePaths) {
    if (!candidatePath) {
      continue;
    }
    const zipEntry = zip.file(candidatePath);
    if (!zipEntry) {
      continue;
    }

    const fileBuffer = await zipEntry.async("arraybuffer");
    if (fileBuffer.byteLength <= 0) {
      continue;
    }
    return new Uint8Array(fileBuffer);
  }

  if (manifestUrl) {
    try {
      const response = await fetch(resolveAppAssetUrl(manifestUrl));
      if (response.ok) {
        const fileBuffer = await response.arrayBuffer();
        if (fileBuffer.byteLength > 0) {
          return new Uint8Array(fileBuffer);
        }
      }
    } catch {
      // Best-effort fallback only.
    }
  }

  return null;
}

interface EncodedRasterImage {
  bytes: Uint8Array;
  encoding: "webp" | "png";
  extension: "webp" | "png";
}

async function encodeRasterLayerAsBestImage(width: number, height: number, rgba: Uint8Array): Promise<EncodedRasterImage | null> {
  const [webp, png] = await Promise.all([
    encodeRasterLayerAsImage(width, height, rgba, "image/webp"),
    encodeRasterLayerAsImage(width, height, rgba, "image/png")
  ]);

  if (!webp && !png) {
    return null;
  }
  if (webp && !png) {
    return { bytes: webp, encoding: "webp", extension: "webp" };
  }
  if (png && !webp) {
    return { bytes: png, encoding: "png", extension: "png" };
  }

  if (!webp || !png) {
    return null;
  }
  return webp.byteLength < png.byteLength
    ? { bytes: webp, encoding: "webp", extension: "webp" }
    : { bytes: png, encoding: "png", extension: "png" };
}

async function encodeRasterLayerAsImage(
  width: number,
  height: number,
  rgba: Uint8Array,
  mimeType: "image/png" | "image/webp"
): Promise<Uint8Array | null> {
  if (typeof document === "undefined") {
    return null;
  }

  const expectedBytes = width * height * 4;
  if (width <= 0 || height <= 0 || rgba.length < expectedBytes) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }

  const clamped = new Uint8ClampedArray(expectedBytes);
  clamped.set(rgba.subarray(0, expectedBytes));
  const imageData = new ImageData(clamped, width, height);
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType);
  });
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) {
    return null;
  }

  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function getMimeTypeForRasterPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return null;
}

async function decodeRasterImageToRgba(path: string, encoded: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  if (typeof document === "undefined") {
    return null;
  }
  const mimeType = getMimeTypeForRasterPath(path);
  if (!mimeType) {
    return null;
  }

  const encodedCopy = new Uint8Array(encoded.length);
  encodedCopy.set(encoded);
  const blob = new Blob([encodedCopy], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width <= 0 || height <= 0) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }

    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    const rgba = new Uint8Array(imageData.data);
    canvas.width = 0;
    canvas.height = 0;
    return { width, height, data: rgba };
  } finally {
    bitmap.close();
  }
}

async function tryReadSourcePdfBytesFromExistingParsedZip(zipBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const zip = await JSZip.loadAsync(zipBytes);
    const manifestFile = zip.file("manifest.json");
    let sourcePdfFile: string | null = null;
    if (manifestFile) {
      const manifestJson = await manifestFile.async("string");
      try {
        const manifest = JSON.parse(manifestJson) as ParsedDataManifest;
        sourcePdfFile = readNonEmptyString(manifest.sourcePdfFile);
      } catch {
        sourcePdfFile = null;
      }
    }

    const candidatePaths = [sourcePdfFile, "source/source.pdf", "source.pdf"];
    for (const candidatePath of candidatePaths) {
      if (!candidatePath) {
        continue;
      }
      const entry = zip.file(candidatePath);
      if (!entry) {
        continue;
      }
      const fileBuffer = await entry.async("arraybuffer");
      if (fileBuffer.byteLength <= 0) {
        continue;
      }
      return new Uint8Array(fileBuffer);
    }
  } catch {
    // Best-effort only.
  }

  return null;
}

async function readRasterLayersFromParsedData(zip: JSZip, sceneMeta: ParsedDataSceneEntry): Promise<RasterLayer[]> {
  const layers: RasterLayer[] = [];

  const sceneRasterLayers = Array.isArray(sceneMeta.rasterLayers)
    ? sceneMeta.rasterLayers
    : [];
  for (let i = 0; i < sceneRasterLayers.length; i += 1) {
    const entry = sceneRasterLayers[i];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const layerMeta = entry as ParsedDataRasterLayerEntry;
    const width = readNonNegativeInt(layerMeta.width, 0);
    const height = readNonNegativeInt(layerMeta.height, 0);
    const path = typeof layerMeta.file === "string" ? layerMeta.file : `raster/layer-${i}.rgba`;
    const matrix = parseMat2D(layerMeta.matrix) ?? new Float32Array([1, 0, 0, 1, 0, 0]);
    const decoded = await readRasterLayerFromZip(zip, path, width, height);
    if (!decoded || decoded.width <= 0 || decoded.height <= 0 || decoded.data.length < decoded.width * decoded.height * 4) {
      continue;
    }

    layers.push({ width: decoded.width, height: decoded.height, matrix, data: decoded.data });
  }

  if (layers.length > 0) {
    return layers;
  }

  const rasterLayerWidth = readNonNegativeInt(sceneMeta.rasterLayerWidth, 0);
  const rasterLayerHeight = readNonNegativeInt(sceneMeta.rasterLayerHeight, 0);
  const rasterLayerMatrix = parseMat2D(sceneMeta.rasterLayerMatrix) ?? new Float32Array([1, 0, 0, 1, 0, 0]);
  const defaultLegacyPath = zip.file("raster/layer-0.webp")
    ? "raster/layer-0.webp"
    : zip.file("raster/layer-0.png")
      ? "raster/layer-0.png"
      : zip.file("raster/layer-0.rgba")
        ? "raster/layer-0.rgba"
        : zip.file("raster/layer.webp")
          ? "raster/layer.webp"
          : zip.file("raster/layer.png")
            ? "raster/layer.png"
            : "raster/layer.rgba";
  const legacyLayer = await readRasterLayerFromZip(
    zip,
    typeof sceneMeta.rasterLayerFile === "string" ? sceneMeta.rasterLayerFile : defaultLegacyPath,
    rasterLayerWidth,
    rasterLayerHeight
  );
  if (
    legacyLayer &&
    legacyLayer.width > 0 &&
    legacyLayer.height > 0 &&
    legacyLayer.data.length >= legacyLayer.width * legacyLayer.height * 4
  ) {
    layers.push({
      width: legacyLayer.width,
      height: legacyLayer.height,
      data: legacyLayer.data,
      matrix: rasterLayerMatrix
    });
  }
  return layers;
}

async function readRasterLayerFromZip(
  zip: JSZip,
  path: string,
  widthHint: number,
  heightHint: number
): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const zipEntry = zip.file(path);
  if (!zipEntry) {
    return null;
  }

  const buffer = await zipEntry.async("arraybuffer");
  const bytes = new Uint8Array(buffer);

  const decodedImage = await decodeRasterImageToRgba(path, bytes);
  if (decodedImage) {
    return decodedImage;
  }

  if (widthHint <= 0 || heightHint <= 0) {
    return null;
  }

  const expectedLength = widthHint * heightHint * 4;
  if (bytes.length < expectedLength) {
    throw new Error(`Raster layer data is truncated (${bytes.length} < ${expectedLength}).`);
  }
  return {
    width: widthHint,
    height: heightHint,
    data: bytes.length === expectedLength ? bytes : bytes.slice(0, expectedLength)
  };
}

function computeMaxHalfWidth(styles: Float32Array, segmentCount: number): number {
  let maxHalfWidth = 0;
  for (let i = 0; i < segmentCount; i += 1) {
    maxHalfWidth = Math.max(maxHalfWidth, styles[i * 4]);
  }
  return maxHalfWidth;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readNonNegativeInt(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Math.max(0, Math.trunc(fallback));
  }
  return Math.max(0, Math.trunc(number));
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatKilobytes(sizeBytes: number): string {
  const safeBytes = Math.max(0, Number(sizeBytes) || 0);
  return (safeBytes / 1024).toFixed(1);
}

function createTextureExportEntry(
  name: string,
  source: Float32Array,
  width: number,
  height: number,
  logicalItemCount: number,
  textureLayout: TextureLayout
): ExportTextureEntry {
  const logicalFloatCount = logicalItemCount * 4;
  if (source.length < logicalFloatCount) {
    throw new Error(`Texture ${name} has insufficient data (${source.length} < ${logicalFloatCount}).`);
  }
  const suffix = textureLayout === "channel-major" ? ".f32cm" : ".f32";

  return {
    name,
    filePath: `textures/${name}${suffix}`,
    width,
    height,
    logicalItemCount,
    logicalFloatCount,
    data: source.slice(0, logicalFloatCount),
    layout: textureLayout
  };
}

function readTexturePayloadAsFloat32(
  fileBuffer: ArrayBuffer,
  entry: ParsedDataTextureEntry,
  textureName: string
): Float32Array {
  const componentType = typeof entry.componentType === "string" ? entry.componentType : "float32";
  if (componentType !== "float32") {
    throw new Error(`Texture ${textureName} has unsupported componentType ${String(componentType)}.`);
  }

  const layout = typeof entry.layout === "string" ? entry.layout : "interleaved";
  if (layout !== "interleaved" && layout !== "channel-major") {
    throw new Error(`Texture ${textureName} has unsupported layout ${String(layout)}.`);
  }

  if (layout === "channel-major") {
    return decodeChannelMajorFloat32(new Uint8Array(fileBuffer));
  }

  const byteShuffle = entry.byteShuffle === true;
  const predictor = typeof entry.predictor === "string" ? entry.predictor : "none";
  if (predictor !== "none" && predictor !== "xor-delta-u32") {
    throw new Error(`Texture ${textureName} has unsupported predictor ${String(predictor)}.`);
  }

  if (byteShuffle) {
    if (predictor === "xor-delta-u32") {
      return decodeXorDeltaByteShuffledFloat32(new Uint8Array(fileBuffer));
    }
    return decodeByteShuffledFloat32(new Uint8Array(fileBuffer));
  }

  if (predictor !== "none") {
    throw new Error(`Texture ${textureName} declares predictor ${predictor} without byteShuffle.`);
  }

  if (fileBuffer.byteLength % 4 !== 0) {
    throw new Error(`Texture ${textureName} has invalid byte length (${fileBuffer.byteLength}).`);
  }

  return new Float32Array(fileBuffer);
}

function sanitizeDownloadName(label: string): string {
  const withoutExtension = label.replace(/\.pdf$/i, "");
  const normalized = withoutExtension.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized.length > 0 ? normalized : "floorplan";
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

function setMetricPlaceholder(label: string = "-"): void {
  metricFileTextElement.textContent = label;
  metricOperatorsTextElement.textContent = "-";
  metricSourceSegmentsTextElement.textContent = "-";
  metricMergedSegmentsTextElement.textContent = "-";
  metricVisibleSegmentsTextElement.textContent = "-";
  metricReductionsTextElement.textContent = "-";
  metricCullDiscardsTextElement.textContent = "-";
  metricTimesTextElement.textContent = "-";
  metricFpsTextElement.textContent = "-";
  metricTextureTextElement.textContent = "-";
  metricGridMaxCellTextElement.textContent = "-";
  metricsPanelElement.dataset.ready = "false";
}

function updateMetricsPanel(
  label: string,
  scene: VectorScene,
  sceneStats: {
    fillPathTextureWidth: number;
    fillPathTextureHeight: number;
    fillSegmentTextureWidth: number;
    fillSegmentTextureHeight: number;
    textureWidth: number;
    textureHeight: number;
    maxTextureSize: number;
    maxCellPopulation: number;
    textInstanceTextureWidth: number;
    textInstanceTextureHeight: number;
    textGlyphTextureWidth: number;
    textGlyphTextureHeight: number;
    textSegmentTextureWidth: number;
    textSegmentTextureHeight: number;
  },
  parseMs: number,
  uploadMs: number
): void {
  const sourceSegments = scene.sourceSegmentCount;
  const mergedSegments = scene.mergedSegmentCount;
  const visibleSegments = scene.segmentCount;
  const fillPaths = scene.fillPathCount;

  const mergeReduction = sourceSegments > 0 ? (1 - mergedSegments / sourceSegments) * 100 : 0;
  const cullReduction = mergedSegments > 0 ? (1 - visibleSegments / mergedSegments) * 100 : 0;
  const totalReduction = sourceSegments > 0 ? (1 - visibleSegments / sourceSegments) * 100 : 0;
  const textureUtilization = computeTextureAreaUtilizationPercent(
    sceneStats.textureWidth,
    sceneStats.textureHeight,
    sceneStats.maxTextureSize
  );
  const rasterSummary = formatRasterLayerSummary(scene);

  metricFileTextElement.textContent = label;
  metricOperatorsTextElement.textContent = scene.operatorCount.toLocaleString();
  metricSourceSegmentsTextElement.textContent = sourceSegments.toLocaleString();
  metricMergedSegmentsTextElement.textContent = `${mergedSegments.toLocaleString()} (${formatPercent(mergeReduction)} reduction)`;
  metricVisibleSegmentsTextElement.textContent =
    `${visibleSegments.toLocaleString()} (${formatPercent(totalReduction)} total reduction), fills ${fillPaths.toLocaleString()}, text ${scene.textInstanceCount.toLocaleString()} instances, pages ${scene.pageCount.toLocaleString()} (${scene.pagesPerRow.toLocaleString()}/row)`;
  metricReductionsTextElement.textContent =
    `merge ${formatPercent(mergeReduction)}, invisible-cull ${formatPercent(cullReduction)}, total ${formatPercent(totalReduction)}`;
  metricCullDiscardsTextElement.textContent =
    `transparent ${scene.discardedTransparentCount.toLocaleString()}, degenerate ${scene.discardedDegenerateCount.toLocaleString()}, duplicates ${scene.discardedDuplicateCount.toLocaleString()}, contained ${scene.discardedContainedCount.toLocaleString()}, glyphs ${scene.textGlyphCount.toLocaleString()} / glyph segments ${scene.textGlyphSegmentCount.toLocaleString()}`;
  metricTimesTextElement.textContent = `parse ${parseMs.toFixed(0)} ms, upload ${uploadMs.toFixed(0)} ms`;
  metricTextureTextElement.textContent =
    `fill paths ${sceneStats.fillPathTextureWidth}x${sceneStats.fillPathTextureHeight}, fill seg ${sceneStats.fillSegmentTextureWidth}x${sceneStats.fillSegmentTextureHeight}, segments ${sceneStats.textureWidth}x${sceneStats.textureHeight} (${textureUtilization.toFixed(1)}% of max area ${sceneStats.maxTextureSize}x${sceneStats.maxTextureSize}), text inst ${sceneStats.textInstanceTextureWidth}x${sceneStats.textInstanceTextureHeight}, glyph ${sceneStats.textGlyphTextureWidth}x${sceneStats.textGlyphTextureHeight}, glyph-seg ${sceneStats.textSegmentTextureWidth}x${sceneStats.textSegmentTextureHeight}${rasterSummary ? `, raster ${rasterSummary}` : ""}`;
  metricGridMaxCellTextElement.textContent = sceneStats.maxCellPopulation.toLocaleString();
  metricsPanelElement.dataset.ready = "true";
}

function formatPercent(value: number): string {
  return `${Math.max(0, value).toFixed(1)}%`;
}

function updateFpsMetric(): void {
  const now = performance.now();
  if (fpsLastSampleTime > 0) {
    const deltaMs = now - fpsLastSampleTime;
    if (deltaMs > 0) {
      const fpsNow = 1000 / deltaMs;
      fpsSmoothed = fpsSmoothed === 0 ? fpsNow : fpsSmoothed * 0.85 + fpsNow * 0.15;
      metricFpsTextElement.textContent = `${fpsSmoothed.toFixed(0)} FPS`;
    }
  }
  fpsLastSampleTime = now;
}

function logTextureSizeStats(
  label: string,
  scene: VectorScene,
  sceneStats: {
    fillPathTextureWidth: number;
    fillPathTextureHeight: number;
    fillSegmentTextureWidth: number;
    fillSegmentTextureHeight: number;
    textureWidth: number;
    textureHeight: number;
    maxTextureSize: number;
    textInstanceTextureWidth: number;
    textInstanceTextureHeight: number;
    textGlyphTextureWidth: number;
    textGlyphTextureHeight: number;
    textSegmentTextureWidth: number;
    textSegmentTextureHeight: number;
  }
): void {
  const utilization = computeTextureAreaUtilizationPercent(
    sceneStats.textureWidth,
    sceneStats.textureHeight,
    sceneStats.maxTextureSize
  );
  const rasterSummary = formatRasterLayerSummary(scene);
  console.log(
    `[GPU texture size] ${label}: fills=${sceneStats.fillPathTextureWidth}x${sceneStats.fillPathTextureHeight} (paths=${scene.fillPathCount.toLocaleString()}), fill-segments=${sceneStats.fillSegmentTextureWidth}x${sceneStats.fillSegmentTextureHeight} (count=${scene.fillSegmentCount.toLocaleString()}), segments=${sceneStats.textureWidth}x${sceneStats.textureHeight} (count=${scene.segmentCount.toLocaleString()}, max=${sceneStats.maxTextureSize}, util=${utilization.toFixed(1)}%), text instances=${sceneStats.textInstanceTextureWidth}x${sceneStats.textInstanceTextureHeight} (count=${scene.textInstanceCount.toLocaleString()}), glyphs=${sceneStats.textGlyphTextureWidth}x${sceneStats.textGlyphTextureHeight} (count=${scene.textGlyphCount.toLocaleString()}), glyph-segments=${sceneStats.textSegmentTextureWidth}x${sceneStats.textSegmentTextureHeight} (count=${scene.textGlyphSegmentCount.toLocaleString()})${rasterSummary ? `, raster=${rasterSummary}` : ""}`
  );
}

function computeTextureAreaUtilizationPercent(width: number, height: number, maxTextureSize: number): number {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const safeMax = Math.max(1, Math.floor(maxTextureSize));
  const usedArea = safeWidth * safeHeight;
  const maxArea = safeMax * safeMax;
  return (usedArea / maxArea) * 100;
}

function logSegmentMergeStats(label: string, scene: VectorScene): void {
  if (scene.sourceSegmentCount <= 0) {
    return;
  }

  const merged = scene.mergedSegmentCount;
  const source = scene.sourceSegmentCount;
  const reduction = source > 0 ? (1 - merged / source) * 100 : 0;

  console.log(
    `[Segment merge] ${label}: ${merged.toLocaleString()} merged / ${source.toLocaleString()} source (${reduction.toFixed(1)}% reduction)`
  );
}

function logInvisibleCullStats(label: string, scene: VectorScene): void {
  if (scene.mergedSegmentCount <= 0) {
    return;
  }

  const visible = scene.segmentCount;
  const merged = scene.mergedSegmentCount;
  const reduction = merged > 0 ? (1 - visible / merged) * 100 : 0;

  console.log(
    `[Invisible cull] ${label}: ${visible.toLocaleString()} visible / ${merged.toLocaleString()} merged (${reduction.toFixed(1)}% reduction, transparent=${scene.discardedTransparentCount.toLocaleString()}, degenerate=${scene.discardedDegenerateCount.toLocaleString()}, duplicates=${scene.discardedDuplicateCount.toLocaleString()}, contained=${scene.discardedContainedCount.toLocaleString()})`
  );
}

function logTextVectorStats(label: string, scene: VectorScene): void {
  console.log(
    `[Text vectors] ${label}: instances=${scene.textInstanceCount.toLocaleString()}, sourceText=${scene.sourceTextCount.toLocaleString()}, glyphs=${scene.textGlyphCount.toLocaleString()}, glyphSegments=${scene.textGlyphSegmentCount.toLocaleString()}, inPage=${scene.textInPageCount.toLocaleString()}, outOfPage=${scene.textOutOfPageCount.toLocaleString()}, fillPaths=${scene.fillPathCount.toLocaleString()}, fillSegments=${scene.fillSegmentCount.toLocaleString()}`
  );
}

function cloneSourceBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer).slice();
}

function createParseBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function computeAutoPagesPerRow(pageCount: number): number {
  const safePageCount = Math.max(1, Math.trunc(pageCount));
  return clamp(Math.ceil(Math.sqrt(safePageCount)), 1, 100);
}
