import "./style.css";

import JSZip from "jszip";
import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { GpuFloorplanRenderer, type DrawStats, type SceneStats, type ViewState } from "./gpuFloorplanRenderer";
import { WebGpuFloorplanRenderer } from "./webGpuFloorplanRenderer";
import { extractFirstPageVectors, type Bounds, type VectorExtractOptions, type VectorScene } from "./pdfVectorExtractor";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const hudElement = document.querySelector<HTMLDivElement>("#hud");
const toggleHudButton = document.querySelector<HTMLButtonElement>("#toggle-hud");
const toggleHudIcon = document.querySelector<HTMLSpanElement>("#toggle-hud-icon");
const openButton = document.querySelector<HTMLButtonElement>("#open-file");
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
const webGpuToggle = document.querySelector<HTMLInputElement>("#toggle-webgpu");

if (
  !canvas ||
  !hudElement ||
  !toggleHudButton ||
  !toggleHudIcon ||
  !openButton ||
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
  !webGpuToggle
) {
  throw new Error("Required UI elements are missing from index.html.");
}

let canvasElement = canvas;
const hudPanelElement = hudElement;
const toggleHudButtonElement = toggleHudButton;
const toggleHudIconElement = toggleHudIcon;
const openButtonElement = openButton;
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
const webGpuToggleElement = webGpuToggle;

type RendererBackend = "webgl" | "webgpu";
const webGpuSupported = isWebGpuSupported();
let activeRendererBackend: RendererBackend = "webgl";
let backendSwitchInFlight = false;

interface RendererApi {
  setFrameListener(listener: ((stats: DrawStats) => void) | null): void;
  setPanOptimizationEnabled(enabled: boolean): void;
  setStrokeCurveEnabled(enabled: boolean): void;
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
  rendererApi.setFrameListener(onRendererFrame);
}

function createWebGlRenderer(targetCanvas: HTMLCanvasElement): RendererApi {
  const next = new GpuFloorplanRenderer(targetCanvas);
  initializeRendererCommon(next);
  return next;
}

async function createWebGpuRenderer(targetCanvas: HTMLCanvasElement): Promise<RendererApi> {
  const next = await WebGpuFloorplanRenderer.create(targetCanvas);
  initializeRendererCommon(next);
  return next;
}

let renderer: RendererApi = createWebGlRenderer(canvasElement);

let baseStatus = "Waiting for PDF or parsed zip...";
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

interface LoadPdfOptions {
  preserveView?: boolean;
}

interface ExportTextureEntry {
  name: string;
  width: number;
  height: number;
  logicalItemCount: number;
  logicalFloatCount: number;
  data: Float32Array;
}

interface ParsedDataTextureEntry {
  name?: unknown;
  file?: unknown;
  logicalItemCount?: unknown;
  logicalFloatCount?: unknown;
}

interface ParsedDataSceneEntry {
  bounds?: unknown;
  pageBounds?: unknown;
  maxHalfWidth?: unknown;
  operatorCount?: unknown;
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
}

interface ParsedDataManifest {
  formatVersion?: unknown;
  sourceFile?: unknown;
  scene?: ParsedDataSceneEntry;
  textures?: ParsedDataTextureEntry[];
}

let fpsLastSampleTime = 0;
let fpsSmoothed = 0;

initializeBackendToggleState();
setMetricPlaceholder();
setHudCollapsed(false);
setDownloadDataButtonState(false);

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

webGpuToggleElement.addEventListener("change", () => {
  void applyBackendPreference(webGpuToggleElement.checked);
});

let isPanning = false;
let previousX = 0;
let previousY = 0;

attachCanvasInteractionListeners(canvasElement);

window.addEventListener("resize", () => {
  renderer.resize();
});

function attachCanvasInteractionListeners(targetCanvas: HTMLCanvasElement): void {
  targetCanvas.addEventListener("pointerdown", (event) => {
    isPanning = true;
    renderer.beginPanInteraction();
    previousX = event.clientX;
    previousY = event.clientY;
    targetCanvas.setPointerCapture(event.pointerId);
  });

  targetCanvas.addEventListener("pointermove", (event) => {
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
    isPanning = false;
    renderer.endPanInteraction();
    targetCanvas.releasePointerCapture(event.pointerId);
  });

  targetCanvas.addEventListener("pointercancel", (event) => {
    isPanning = false;
    renderer.endPanInteraction();
    targetCanvas.releasePointerCapture(event.pointerId);
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
  dropIndicatorElement.classList.add("active");
});

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("dragleave", (event) => {
  if (event.target === document.documentElement || event.target === document.body) {
    dropIndicatorElement.classList.remove("active");
  }
});

window.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropIndicatorElement.classList.remove("active");

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
    isPanning = false;

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
      isPanning = false;
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
  await loadPdfBuffer(createParseBuffer(bytes), file.name, { preserveView: false });
}

async function loadParsedDataZipFile(file: File): Promise<void> {
  setStatus(`Reading ${file.name}...`);
  const buffer = await file.arrayBuffer();
  const bytes = cloneSourceBytes(buffer);
  lastLoadedSource = { kind: "parsed-zip", bytes, label: file.name };
  await loadParsedDataZipBuffer(createParseBuffer(bytes), file.name, { preserveView: false });
}

async function loadPdfBuffer(buffer: ArrayBuffer, label: string, options: LoadPdfOptions = {}): Promise<void> {
  const activeLoadToken = ++loadToken;
  const extractionOptions = getExtractionOptions();

  try {
    const parseStart = performance.now();
    setParsingLoader(true);
    setStatus(
      `Parsing ${label} with PDF.js... (merge ${extractionOptions.enableSegmentMerge ? "on" : "off"}, cull ${extractionOptions.enableInvisibleCull ? "on" : "off"})`
    );
    const scene = await extractFirstPageVectors(buffer, extractionOptions);
    const parseEnd = performance.now();

    if (activeLoadToken === loadToken) {
      setParsingLoader(false);
    }

    if (activeLoadToken !== loadToken) {
      return;
    }

    if (scene.segmentCount === 0 && scene.textInstanceCount === 0) {
      setStatus(`No visible vector geometry was extracted from ${label}.`);
      runtimeTextElement.textContent = "";
      setMetricPlaceholder(label);
      setDownloadDataButtonState(false);
      return;
    }

    setStatus(
      `Uploading ${scene.segmentCount.toLocaleString()} segments and ${scene.textInstanceCount.toLocaleString()} text instances to GPU...`
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
    setDownloadDataButtonState(true);

    updateMetricsPanel(label, scene, sceneStats, parseEnd - parseStart, uploadEnd - uploadStart);
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

    if (scene.segmentCount === 0 && scene.textInstanceCount === 0) {
      setStatus(`No visible vector geometry was found in ${label}.`);
      runtimeTextElement.textContent = "";
      setMetricPlaceholder(label);
      setDownloadDataButtonState(false);
      return;
    }

    setStatus(
      `Uploading ${scene.segmentCount.toLocaleString()} segments and ${scene.textInstanceCount.toLocaleString()} text instances to GPU...`
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

function formatSceneStatus(
  label: string,
  scene: VectorScene
): string {
  const fillPathCount = scene.fillPathCount.toLocaleString();
  const sourceSegmentCount = scene.sourceSegmentCount.toLocaleString();
  const visibleSegmentCount = scene.segmentCount.toLocaleString();
  const textInstanceCount = scene.textInstanceCount.toLocaleString();
  return `${label} loaded | fills ${fillPathCount}, ${visibleSegmentCount} visible from ${sourceSegmentCount} source segments, ${textInstanceCount} text instances`;
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
  downloadDataButtonElement.textContent = isBusy ? "Preparing Zip..." : "Download Parsed Data";
}

function setHudCollapsed(collapsed: boolean): void {
  hudPanelElement.classList.toggle("collapsed", collapsed);
  toggleHudButtonElement.setAttribute("aria-expanded", String(!collapsed));
  toggleHudButtonElement.title = collapsed ? "Expand panel" : "Collapse panel";
  toggleHudIconElement.textContent = collapsed ? "▸" : "▾";
}

async function downloadParsedDataZip(): Promise<void> {
  if (!lastParsedScene || !lastParsedSceneStats || !lastParsedSceneLabel) {
    setStatus("No parsed floorplan data available to export.");
    return;
  }

  const scene = lastParsedScene;
  const sceneStats = lastParsedSceneStats;
  const label = lastParsedSceneLabel;
  const previousStatusText = statusTextElement.textContent;

  setDownloadDataButtonState(true, true);
  statusTextElement.textContent = "Preparing parsed texture data zip...";

  try {
    const zip = new JSZip();
    const textureEntries = buildTextureExportEntries(scene, sceneStats);

    for (const entry of textureEntries) {
      const path = `textures/${entry.name}.f32`;
      zip.file(path, new Uint8Array(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength));
    }

    const manifest = {
      formatVersion: 1,
      sourceFile: label,
      generatedAt: new Date().toISOString(),
      scene: {
        bounds: scene.bounds,
        pageBounds: scene.pageBounds,
        maxHalfWidth: scene.maxHalfWidth,
        operatorCount: scene.operatorCount,
        pathCount: scene.pathCount,
        sourceSegmentCount: scene.sourceSegmentCount,
        mergedSegmentCount: scene.mergedSegmentCount,
        segmentCount: scene.segmentCount,
        fillPathCount: scene.fillPathCount,
        fillSegmentCount: scene.fillSegmentCount,
        textInstanceCount: scene.textInstanceCount,
        textGlyphCount: scene.textGlyphCount,
        textGlyphPrimitiveCount: scene.textGlyphSegmentCount
      },
      textures: textureEntries.map((entry) => ({
        name: entry.name,
        file: `textures/${entry.name}.f32`,
        width: entry.width,
        height: entry.height,
        channels: 4,
        componentType: "float32",
        logicalItemCount: entry.logicalItemCount,
        logicalFloatCount: entry.logicalFloatCount,
        paddedFloatCount: entry.data.length
      }))
    };

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    const zipFileName = `${sanitizeDownloadName(label)}-parsed-data.zip`;
    triggerBlobDownload(zipBlob, zipFileName);
    console.log(`[Parsed data export] ${label}: wrote ${textureEntries.length} textures to ${zipFileName}`);
    statusTextElement.textContent = previousStatusText || baseStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to download parsed data: ${message}`);
  } finally {
    setDownloadDataButtonState(true, false);
  }
}

function buildTextureExportEntries(scene: VectorScene, sceneStats: SceneStats): ExportTextureEntry[] {
  return [
    createTextureExportEntry("fill-path-meta-a", scene.fillPathMetaA, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount),
    createTextureExportEntry("fill-path-meta-b", scene.fillPathMetaB, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount),
    createTextureExportEntry("fill-path-meta-c", scene.fillPathMetaC, sceneStats.fillPathTextureWidth, sceneStats.fillPathTextureHeight, scene.fillPathCount),
    createTextureExportEntry("fill-primitives-a", scene.fillSegmentsA, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount),
    createTextureExportEntry("fill-primitives-b", scene.fillSegmentsB, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount),
    createTextureExportEntry("stroke-primitives-a", scene.endpoints, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount),
    createTextureExportEntry("stroke-primitives-b", scene.primitiveMeta, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount),
    createTextureExportEntry("stroke-styles", scene.styles, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount),
    createTextureExportEntry("stroke-primitive-bounds", scene.primitiveBounds, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount),
    createTextureExportEntry("text-instance-a", scene.textInstanceA, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount),
    createTextureExportEntry("text-instance-b", scene.textInstanceB, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount),
    createTextureExportEntry("text-instance-c", scene.textInstanceC, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount),
    createTextureExportEntry("text-glyph-meta-a", scene.textGlyphMetaA, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount),
    createTextureExportEntry("text-glyph-meta-b", scene.textGlyphMetaB, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount),
    createTextureExportEntry("text-glyph-primitives-a", scene.textGlyphSegmentsA, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount),
    createTextureExportEntry("text-glyph-primitives-b", scene.textGlyphSegmentsB, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount)
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

      const path = typeof entry.file === "string" ? entry.file : `textures/${candidate}.f32`;
      const zipEntry = zip.file(path);
      if (!zipEntry) {
        continue;
      }

      const fileBuffer = await zipEntry.async("arraybuffer");
      if (fileBuffer.byteLength % 4 !== 0) {
        throw new Error(`Texture ${candidate} has invalid byte length (${fileBuffer.byteLength}).`);
      }

      const raw = new Float32Array(fileBuffer);
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

  return {
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
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    bounds,
    pageBounds,
    maxHalfWidth,
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

function createTextureExportEntry(
  name: string,
  source: Float32Array,
  width: number,
  height: number,
  logicalItemCount: number
): ExportTextureEntry {
  return {
    name,
    width,
    height,
    logicalItemCount,
    logicalFloatCount: source.length,
    data: createPaddedFloatTextureData(source, width, height)
  };
}

function createPaddedFloatTextureData(source: Float32Array, width: number, height: number): Float32Array {
  const expectedLength = Math.max(1, width) * Math.max(1, height) * 4;
  if (source.length > expectedLength) {
    throw new Error(`Texture source data exceeds texture size (${source.length} > ${expectedLength}).`);
  }

  const padded = new Float32Array(expectedLength);
  padded.set(source);
  return padded;
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
  const textureUtilization = (Math.max(sceneStats.textureWidth, sceneStats.textureHeight) / sceneStats.maxTextureSize) * 100;

  metricFileTextElement.textContent = label;
  metricOperatorsTextElement.textContent = scene.operatorCount.toLocaleString();
  metricSourceSegmentsTextElement.textContent = sourceSegments.toLocaleString();
  metricMergedSegmentsTextElement.textContent = `${mergedSegments.toLocaleString()} (${formatPercent(mergeReduction)} reduction)`;
  metricVisibleSegmentsTextElement.textContent =
    `${visibleSegments.toLocaleString()} (${formatPercent(totalReduction)} total reduction), fills ${fillPaths.toLocaleString()}, text ${scene.textInstanceCount.toLocaleString()} instances`;
  metricReductionsTextElement.textContent =
    `merge ${formatPercent(mergeReduction)}, invisible-cull ${formatPercent(cullReduction)}, total ${formatPercent(totalReduction)}`;
  metricCullDiscardsTextElement.textContent =
    `transparent ${scene.discardedTransparentCount.toLocaleString()}, degenerate ${scene.discardedDegenerateCount.toLocaleString()}, duplicates ${scene.discardedDuplicateCount.toLocaleString()}, contained ${scene.discardedContainedCount.toLocaleString()}, glyphs ${scene.textGlyphCount.toLocaleString()} / glyph segments ${scene.textGlyphSegmentCount.toLocaleString()}`;
  metricTimesTextElement.textContent = `parse ${parseMs.toFixed(0)} ms, upload ${uploadMs.toFixed(0)} ms`;
  metricTextureTextElement.textContent =
    `fill paths ${sceneStats.fillPathTextureWidth}x${sceneStats.fillPathTextureHeight}, fill seg ${sceneStats.fillSegmentTextureWidth}x${sceneStats.fillSegmentTextureHeight}, segments ${sceneStats.textureWidth}x${sceneStats.textureHeight} (${textureUtilization.toFixed(1)}% of max ${sceneStats.maxTextureSize}), text inst ${sceneStats.textInstanceTextureWidth}x${sceneStats.textInstanceTextureHeight}, glyph ${sceneStats.textGlyphTextureWidth}x${sceneStats.textGlyphTextureHeight}, glyph-seg ${sceneStats.textSegmentTextureWidth}x${sceneStats.textSegmentTextureHeight}`;
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
  const utilization = (Math.max(sceneStats.textureWidth, sceneStats.textureHeight) / sceneStats.maxTextureSize) * 100;
  console.log(
    `[GPU texture size] ${label}: fills=${sceneStats.fillPathTextureWidth}x${sceneStats.fillPathTextureHeight} (paths=${scene.fillPathCount.toLocaleString()}), fill-segments=${sceneStats.fillSegmentTextureWidth}x${sceneStats.fillSegmentTextureHeight} (count=${scene.fillSegmentCount.toLocaleString()}), segments=${sceneStats.textureWidth}x${sceneStats.textureHeight} (count=${scene.segmentCount.toLocaleString()}, max=${sceneStats.maxTextureSize}, util=${utilization.toFixed(1)}%), text instances=${sceneStats.textInstanceTextureWidth}x${sceneStats.textInstanceTextureHeight} (count=${scene.textInstanceCount.toLocaleString()}), glyphs=${sceneStats.textGlyphTextureWidth}x${sceneStats.textGlyphTextureHeight} (count=${scene.textGlyphCount.toLocaleString()}), glyph-segments=${sceneStats.textSegmentTextureWidth}x${sceneStats.textSegmentTextureHeight} (count=${scene.textGlyphSegmentCount.toLocaleString()})`
  );
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

async function loadDefaultSample(): Promise<void> {
  const defaultUrl = "/floorplans/SimiValleyBehavioralHealth_SR_20180403.pdf";

  try {
    setStatus("Loading sample floorplan from /floorplans...");
    const response = await fetch(defaultUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const bytes = cloneSourceBytes(buffer);
    lastLoadedSource = { kind: "pdf", bytes, label: "SimiValleyBehavioralHealth_SR_20180403.pdf" };
    await loadPdfBuffer(createParseBuffer(bytes), "SimiValleyBehavioralHealth_SR_20180403.pdf", { preserveView: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not load default sample: ${message}`);
    runtimeTextElement.textContent = "Drag and drop a PDF or parsed zip from ./floorplans.";
  }
}

function cloneSourceBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer).slice();
}

function createParseBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

void loadDefaultSample();
