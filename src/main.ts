import "./style.css";

import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { WebGlFloorplanRenderer, type DrawStats, type SceneStats } from "./webGlFloorplanRenderer";
import { WebGpuFloorplanRenderer } from "./webGpuFloorplanRenderer";
import {
  composeVectorScenesInGrid,
  extractPdfPageScenes,
  type Bounds,
  type VectorExtractOptions,
  type VectorScene
} from "./pdfVectorExtractor";
import { createCanvasInteractionController } from "./canvasInteractions";
import { createBackendSwitcher } from "./backendSwitcher";
import {
  buildParsedDataZipBlobForLayout,
  listSceneRasterLayers,
  loadSceneFromParsedDataZip,
  tryReadSourcePdfBytesFromExistingParsedZip,
  type TextureLayout
} from "./parsedDataZip";
import type { RendererApi } from "./rendererTypes";
import { createUiControlManager } from "./uiControls";
import {
  normalizeExampleManifestEntries,
  resolveAppAssetUrl,
  type ExampleAssetManifest,
  type NormalizedExampleEntry
} from "./exampleManifest";

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
let renderer: RendererApi;
let backendSwitcher: ReturnType<typeof createBackendSwitcher> | null = null;

const uiControlManager = createUiControlManager(
  {
    panOptimizationToggle: panOptimizationToggleElement,
    segmentMergeToggle: segmentMergeToggleElement,
    invisibleCullToggle: invisibleCullToggleElement,
    strokeCurveToggle: strokeCurveToggleElement,
    vectorTextOnlyToggle: vectorTextOnlyToggleElement,
    webGpuToggle: webGpuToggleElement,
    maxPagesPerRowInput: maxPagesPerRowInputElement,
    pageBackgroundColorInput: pageBackgroundColorInputElement,
    pageBackgroundOpacitySlider: pageBackgroundOpacitySliderElement,
    pageBackgroundOpacityInput: pageBackgroundOpacityInputElement,
    vectorColorInput: vectorColorInputElement,
    vectorOpacitySlider: vectorOpacitySliderElement,
    vectorOpacityInput: vectorOpacityInputElement
  },
  () => renderer
);

const canvasInteractionController = createCanvasInteractionController(() => renderer);

function onRendererFrame(stats: DrawStats): void {
  updateFpsMetric();

  const rendered = stats.renderedSegments.toLocaleString();
  const total = stats.totalSegments.toLocaleString();
  const mode = stats.usedCulling ? "culled" : "full";
  const activeBackendLabel = (backendSwitcher?.getActiveBackend() ?? "webgl").toUpperCase();
  runtimeTextElement.textContent =
    `Draw ${rendered}/${total} segments | mode: ${mode} | zoom: ${stats.zoom.toFixed(2)}x | backend: ${activeBackendLabel}`;
}

function initializeRendererCommon(rendererApi: RendererApi): void {
  rendererApi.resize();
  rendererApi.setPanOptimizationEnabled(panOptimizationToggleElement.checked);
  rendererApi.setStrokeCurveEnabled(strokeCurveToggleElement.checked);
  rendererApi.setTextVectorOnly(vectorTextOnlyToggleElement.checked);
  const pageBackgroundColor = uiControlManager.readPageBackgroundColorInput();
  rendererApi.setPageBackgroundColor(
    pageBackgroundColor[0],
    pageBackgroundColor[1],
    pageBackgroundColor[2],
    pageBackgroundColor[3]
  );
  const vectorColorOverride = uiControlManager.readVectorColorOverrideInput();
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

renderer = createWebGlRenderer(canvasElement);

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

const EXPORT_TEXTURE_LAYOUT: TextureLayout = "interleaved";
const EXPORT_ZIP_COMPRESSION: "STORE" | "DEFLATE" = "DEFLATE";
const EXPORT_ZIP_DEFLATE_LEVEL = 9;
const EXPORT_ENCODE_RASTER_IMAGES = true;

type ExampleSelectionKind = "pdf" | "zip";

interface ExampleSelection {
  id: string;
  sourceName: string;
  kind: ExampleSelectionKind;
  path: string;
}

const exampleSelectionMap = new Map<string, ExampleSelection>();

let fpsLastSampleTime = 0;
let fpsSmoothed = 0;

backendSwitcher = createBackendSwitcher({
  webGpuToggleElement,
  getRenderer: () => renderer,
  setRenderer: (nextRenderer) => {
    renderer = nextRenderer;
  },
  getCanvasElement: () => canvasElement,
  setCanvasElement: (nextCanvas) => {
    canvasElement = nextCanvas;
  },
  createWebGlRenderer,
  createWebGpuRenderer,
  attachCanvasInteractionListeners: (targetCanvas) => {
    canvasInteractionController.attach(targetCanvas);
  },
  resetPointerInteractionState: () => {
    canvasInteractionController.resetState();
  },
  getSceneSnapshot: () => ({
    scene: lastParsedScene,
    label: lastParsedSceneLabel,
    loadedSourceKind: lastLoadedSource?.kind ?? null
  }),
  setSceneStats: (stats) => {
    lastParsedSceneStats = stats;
  },
  updateMetricsAfterSwitch: (label, scene, sceneStats) => {
    updateMetricsPanel(label, scene, sceneStats, 0, 0);
  },
  setMetricTimesText: (text) => {
    metricTimesTextElement.textContent = text;
  },
  formatSceneStatus,
  setBaseStatus: (status) => {
    baseStatus = status;
  },
  setStatus,
  setStatusText: (status) => {
    statusTextElement.textContent = status;
  }
});

backendSwitcher.initializeToggleState();
setMetricPlaceholder();
setHudCollapsed(false);
setDownloadDataButtonState(false);
uiControlManager.syncMaxPagesPerRowInputValue();
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

uiControlManager.bindEventListeners({
  onPanOptimizationChange: (enabled) => {
    renderer.setPanOptimizationEnabled(enabled);
  },
  onSegmentMergeChange: () => reloadLastPdfWithCurrentOptions(),
  onInvisibleCullChange: () => reloadLastPdfWithCurrentOptions(),
  onStrokeCurveChange: (enabled) => {
    renderer.setStrokeCurveEnabled(enabled);
  },
  onVectorTextOnlyChange: (enabled) => {
    renderer.setTextVectorOnly(enabled);
  },
  onMaxPagesPerRowChange: async () => {
    if (!lastLoadedSource || lastLoadedSource.kind !== "pdf") {
      return;
    }
    await loadPdfBuffer(createParseBuffer(lastLoadedSource.bytes), lastLoadedSource.label, { preserveView: false });
  },
  onWebGpuToggleChange: (enabled) => backendSwitcher?.applyPreference(enabled) ?? Promise.resolve()
});

canvasInteractionController.attach(canvasElement);

window.addEventListener("resize", () => {
  renderer.resize();
});

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

function refreshDropIndicator(): void {
  const shouldShow = isDropDragActive || !lastParsedScene;
  dropIndicatorElement.classList.toggle("active", shouldShow);
  dropIndicatorElement.classList.toggle("dragging", isDropDragActive);
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
    let pagesPerRow = uiControlManager.readMaxPagesPerRowInput();

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
      renderer.fitToBounds(resolveSceneFitBounds(scene), 64);
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
      renderer.fitToBounds(resolveSceneFitBounds(scene), 64);
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

function resolveSceneFitBounds(scene: VectorScene): Bounds {
  if (scene.pageRects instanceof Float32Array && scene.pageRects.length >= 4) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i + 3 < scene.pageRects.length; i += 4) {
      const x0 = scene.pageRects[i];
      const y0 = scene.pageRects[i + 1];
      const x1 = scene.pageRects[i + 2];
      const y1 = scene.pageRects[i + 3];
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
        continue;
      }

      minX = Math.min(minX, x0, x1);
      minY = Math.min(minY, y0, y1);
      maxX = Math.max(maxX, x0, x1);
      maxY = Math.max(maxY, y0, y1);
    }

    if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
      return { minX, minY, maxX, maxY };
    }
  }

  if (
    Number.isFinite(scene.pageBounds.minX) &&
    Number.isFinite(scene.pageBounds.minY) &&
    Number.isFinite(scene.pageBounds.maxX) &&
    Number.isFinite(scene.pageBounds.maxY)
  ) {
    return {
      minX: scene.pageBounds.minX,
      minY: scene.pageBounds.minY,
      maxX: scene.pageBounds.maxX,
      maxY: scene.pageBounds.maxY
    };
  }

  return {
    minX: scene.bounds.minX,
    minY: scene.bounds.minY,
    maxX: scene.bounds.maxX,
    maxY: scene.bounds.maxY
  };
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
  statusTextElement.textContent = "Preparing parsed texture data zip (fast export)...";

  try {
    const sceneRasterLayers = listSceneRasterLayers(scene);
    const selectedZip = await buildParsedDataZipBlobForLayout(
      scene,
      sceneStats,
      label,
      sourcePdfBytes,
      EXPORT_TEXTURE_LAYOUT,
      sceneRasterLayers,
      {
        encodeRasterImages: EXPORT_ENCODE_RASTER_IMAGES,
        zipCompression: EXPORT_ZIP_COMPRESSION,
        zipDeflateLevel: EXPORT_ZIP_DEFLATE_LEVEL
      }
    );

    const zipFileName = `${sanitizeDownloadName(label)}-parsed-data.zip`;
    triggerBlobDownload(selectedZip.blob, zipFileName);
    console.log(
      `[Parsed data export] ${label}: wrote ${selectedZip.textureCount.toLocaleString()} vector textures + ${selectedZip.rasterLayerCount.toLocaleString()} raster layers to ${zipFileName} using ${selectedZip.layout} layout (${formatKilobytes(selectedZip.byteLength)} kB, compression=${EXPORT_ZIP_COMPRESSION.toLowerCase()}, raster=${EXPORT_ENCODE_RASTER_IMAGES ? "encoded" : "raw-rgba"})`
    );
    statusTextElement.textContent = previousStatusText || baseStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to download parsed data: ${message}`);
  } finally {
    setDownloadDataButtonState(true, false);
  }
}

function formatKilobytes(sizeBytes: number): string {
  const safeBytes = Math.max(0, Number(sizeBytes) || 0);
  return (safeBytes / 1024).toFixed(1);
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
