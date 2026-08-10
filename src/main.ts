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
import { buildParsedDataZip } from "./index";
import {
  listSceneRasterLayers,
  loadSceneFromParsedDataZip,
  tryReadSourcePdfBytesFromExistingParsedZip
} from "./parsedDataZip";
import type { RendererApi } from "./rendererTypes";
import { createUiControlManager } from "./uiControls";
import {
  normalizeExampleManifestEntries,
  resolveAppAssetUrl,
  type ExampleAssetManifest,
  type NormalizedExampleEntry
} from "./exampleManifest";
import { createExampleDropdown, type ExampleDropdownItem } from "./exampleDropdown";
import {
  formatPdfDownloadFilename,
  readPdfDownloadBlob,
  triggerBrowserDownload,
  type PdfDownloadSource
} from "./downloadUtils";
import {
  createLoadProgressReporter,
  formatLoadProgressStage,
  type PDFLoadProgress
} from "./loadProgress";
import {
  consumeVectorStrokeLodBuildTiming,
  prebuildVectorStrokeLodRuntime,
  resetVectorStrokeLodBuildTiming,
  type VectorLodMode,
  type VectorStrokeLodBuildTiming
} from "./vectorStrokeLodCore";
import { formatVectorStrokeLodStats } from "./vectorStrokeLodStatsFormat";
import { createTextSearchController, type TextSearchController, type TextSearchMatch } from "./textSearch";
import { createTextSearchWidget } from "./textSearchWidget";
import { createTextSelectionController } from "./textSelection";
import type { SearchHighlightSet } from "./rendererTypes";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const hudElement = document.querySelector<HTMLDivElement>("#hud");
const toggleHudButton = document.querySelector<HTMLButtonElement>("#toggle-hud");
const toggleHudIcon = document.querySelector<HTMLSpanElement>("#toggle-hud-icon");
const openButton = document.querySelector<HTMLButtonElement>("#open-file");
const exampleDropdownContainer = document.querySelector<HTMLDivElement>("#example-dropdown");
const exampleSelect = document.querySelector<HTMLButtonElement>("#example-select");
const exampleSelectLabel = document.querySelector<HTMLSpanElement>("#example-select-label");
const exampleMenu = document.querySelector<HTMLDivElement>("#example-menu");
const downloadDataButton = document.querySelector<HTMLButtonElement>("#download-data");
const downloadPdfButton = document.querySelector<HTMLButtonElement>("#download-pdf");
const downloadAllDataButton = document.querySelector<HTMLButtonElement>("#download-all-data");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const statusElement = document.querySelector<HTMLDivElement>("#status");
const parseLoaderElement = document.querySelector<HTMLDivElement>("#parse-loader");
const parseLoaderText = document.querySelector<HTMLSpanElement>("#parse-loader-text");
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
const backendSelect = document.querySelector<HTMLSelectElement>("#backend-select");
const vectorLodSelect = document.querySelector<HTMLSelectElement>("#vector-lod-mode");
const pageBackgroundColorInput = document.querySelector<HTMLInputElement>("#page-bg-color");
const pageBackgroundOpacitySlider = document.querySelector<HTMLInputElement>("#page-bg-opacity-slider");
const pageBackgroundOpacityInput = document.querySelector<HTMLInputElement>("#page-bg-opacity");
const vectorColorInput = document.querySelector<HTMLInputElement>("#vector-color");
const vectorOpacitySlider = document.querySelector<HTMLInputElement>("#vector-opacity-slider");
const vectorOpacityInput = document.querySelector<HTMLInputElement>("#vector-opacity");
const textSearchInput = document.querySelector<HTMLInputElement>("#text-search-input");
const textSearchCount = document.querySelector<HTMLSpanElement>("#text-search-count");
const textSearchPrevButton = document.querySelector<HTMLButtonElement>("#text-search-prev");
const textSearchNextButton = document.querySelector<HTMLButtonElement>("#text-search-next");
const textSearchCaseButton = document.querySelector<HTMLButtonElement>("#text-search-case");
const textSelectionCheckbox = document.querySelector<HTMLInputElement>("#text-selection-checkbox");

if (
  !canvas ||
  !hudElement ||
  !toggleHudButton ||
  !toggleHudIcon ||
  !openButton ||
  !exampleDropdownContainer ||
  !exampleSelect ||
  !exampleSelectLabel ||
  !exampleMenu ||
  !downloadDataButton ||
  !downloadPdfButton ||
  !downloadAllDataButton ||
  !fileInput ||
  !statusElement ||
  !parseLoaderElement ||
  !parseLoaderText ||
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
  !backendSelect ||
  !vectorLodSelect ||
  !pageBackgroundColorInput ||
  !pageBackgroundOpacitySlider ||
  !pageBackgroundOpacityInput ||
  !vectorColorInput ||
  !vectorOpacitySlider ||
  !vectorOpacityInput ||
  !textSearchInput ||
  !textSearchCount ||
  !textSearchPrevButton ||
  !textSearchNextButton ||
  !textSearchCaseButton ||
  !textSelectionCheckbox
) {
  throw new Error("Required UI elements are missing from index.html.");
}

let canvasElement = canvas;
const hudPanelElement = hudElement;
const toggleHudButtonElement = toggleHudButton;
const toggleHudIconElement = toggleHudIcon;
const openButtonElement = openButton;
const exampleDropdown = createExampleDropdown({
  containerElement: exampleDropdownContainer,
  triggerElement: exampleSelect,
  labelElement: exampleSelectLabel,
  menuElement: exampleMenu,
  onSelect: (selectionKey) => {
    void loadExampleSelection(selectionKey);
  }
});
const downloadDataButtonElement = downloadDataButton;
const downloadPdfButtonElement = downloadPdfButton;
const downloadAllDataButtonElement = downloadAllDataButton;
const fileInputElement = fileInput;
const statusTextElement = statusElement;
const parsingLoaderElement = parseLoaderElement;
const parsingLoaderTextElement = parseLoaderText;
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
const backendSelectElement = backendSelect;
const vectorLodSelectElement = vectorLodSelect;
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
    vectorLodSelect: vectorLodSelectElement,
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

let textSearchController: TextSearchController;
let lastSearchHighlights: SearchHighlightSet | null = null;

function applySearchHighlights(current: TextSearchMatch | null, all: TextSearchMatch[]): void {
  if (all.length === 0) {
    lastSearchHighlights = null;
  } else {
    const rects = new Float32Array(all.length * 4);
    let currentIndex = -1;
    for (let i = 0; i < all.length; i += 1) {
      const bounds = all[i].bounds;
      rects[i * 4] = bounds.minX;
      rects[i * 4 + 1] = bounds.minY;
      rects[i * 4 + 2] = bounds.maxX;
      rects[i * 4 + 3] = bounds.maxY;
      if (all[i] === current) {
        currentIndex = i;
      }
    }
    lastSearchHighlights = { rects, count: all.length, currentIndex };
  }
  renderer.setSearchHighlights?.(lastSearchHighlights);
}

const textSearchWidget = createTextSearchWidget(
  {
    input: textSearchInput,
    prevButton: textSearchPrevButton,
    nextButton: textSearchNextButton,
    caseButton: textSearchCaseButton,
    countLabel: textSearchCount
  },
  {
    onQueryInput: (query) => textSearchController.setQuery(query),
    onNext: () => textSearchController.next(),
    onPrev: () => textSearchController.prev(),
    onCaseToggle: (enabled) => textSearchController.setCaseSensitive(enabled),
    onClose: () => textSearchController.clear()
  }
);
textSearchController = createTextSearchController({
  getRenderer: () => renderer,
  getCanvas: () => canvasElement,
  onStateChange: (state) => textSearchWidget.applyState(state),
  onMatchesChange: applySearchHighlights
});

function applyTextSearchScene(scene: VectorScene): void {
  textSearchController.setScene(scene);
  const hasText = scene.textIndex?.pages.some((page) => page.text.length > 0) ?? false;
  textSearchWidget.setAvailability(hasText ? "ready" : "no-text-index");
}

const textSelection = createTextSelectionController({
  getCanvas: () => canvasElement,
  enabled: textSelectionCheckbox.checked,
  adapter: {
    getScene: () => lastParsedScene,
    clientToScenePoint: (clientX, clientY) => renderer.clientToScenePoint?.(clientX, clientY) ?? null,
    sceneToClientPoint: (sceneX, sceneY) => renderer.sceneToClientPoint?.(sceneX, sceneY) ?? null,
    setSelectionHighlights: (rects) => renderer.setTextSelectionHighlights?.(rects),
    setCameraInteractionEnabled: (interactionEnabled) => {
      if (!interactionEnabled) {
        canvasInteractionController.cancelActiveGesture();
      }
    }
  }
});

textSelectionCheckbox.addEventListener("change", () => {
  if (textSelectionCheckbox.checked) {
    textSelection.enable();
  } else {
    textSelection.disable();
  }
});

function onRendererFrame(stats: DrawStats): void {
  updateFpsMetric();
  textSelection.updateOverlay();

  const rendered = stats.renderedSegments.toLocaleString();
  const total = stats.totalSegments.toLocaleString();
  const mode = stats.usedCulling ? "culled" : "full";
  const activeBackendLabel = (backendSwitcher?.getActiveBackend() ?? "webgl").toUpperCase();
  const vectorLodStats = formatVectorStrokeLodStats(renderer.getVectorStrokeLodStats?.() ?? null);
  const vectorLodSuffix = vectorLodStats ? ` | ${vectorLodStats}` : "";
  runtimeTextElement.textContent =
    `Draw ${rendered}/${total} segments | mode: ${mode} | zoom: ${stats.zoom.toFixed(2)}x | backend: ${activeBackendLabel}${vectorLodSuffix}`;
}

function initializeRendererCommon(rendererApi: RendererApi): void {
  rendererApi.resize();
  rendererApi.setVectorLodMode?.(uiControlManager.readVectorLodModeInput());
  rendererApi.setStrokeCurveEnabled(true);
  rendererApi.setTextVectorOnly(false);
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
let activeSceneLoadToken: number | null = null;
let pendingSourceLoadCount = 0;
let sourceLoadSerial = 0;
let isDropDragActive = false;
let isBatchExampleExportRunning = false;
let activeParsedZipExportController: AbortController | null = null;

const pageQuery = new URLSearchParams(window.location.search);
const bulkZipExportEnabled = pageQuery.get("bulkZip") === "1" || pageQuery.get("downloadAllZips") === "1";

interface ParsedPdfPageCache {
  sourceBytes: Uint8Array;
  sourceLabel: string;
  optionsKey: string;
  pageScenes: VectorScene[];
}

let parsedPdfPageCache: ParsedPdfPageCache | null = null;

interface LoadPdfOptions {
  preserveView?: boolean;
}

const LOAD_PROGRESS_PARSE_END = 0.34;
const LOAD_PROGRESS_COMPILE = 0.36;
const LOAD_PROGRESS_VECTOR_LOD_START = 0.38;
const LOAD_PROGRESS_VECTOR_LOD_END = 0.96;
const LOAD_PROGRESS_UPLOAD = 0.98;

type ExampleSelectionKind = "pdf" | "zip";

interface ExampleSelection {
  id: string;
  sourceName: string;
  kind: ExampleSelectionKind;
  path: string;
  pdfPath: string;
}

const exampleSelectionMap = new Map<string, ExampleSelection>();
let exampleManifestEntries: NormalizedExampleEntry[] = [];
let lastDownloadablePdf: PdfDownloadSource | null = null;

let fpsLastSampleTime = 0;
let fpsSmoothed = 0;

backendSwitcher = createBackendSwitcher({
  backendSelectElement,
  getRenderer: () => renderer,
  setRenderer: (nextRenderer) => {
    renderer = nextRenderer;
    // Highlights live in renderer-owned GPU buffers; re-apply after a switch.
    renderer.setSearchHighlights?.(lastSearchHighlights);
    textSelection.refreshHighlights();
  },
  getCanvasElement: () => canvasElement,
  setCanvasElement: (nextCanvas) => {
    canvasElement = nextCanvas;
    canvasResizeObserver.disconnect();
    canvasResizeObserver.observe(nextCanvas);
  },
  createWebGlRenderer,
  createWebGpuRenderer,
  attachCanvasInteractionListeners: (targetCanvas) => {
    canvasInteractionController.attach(targetCanvas);
  },
  resetPointerInteractionState: () => {
    canvasInteractionController.resetState();
  },
  isOperationActive: () =>
    pendingSourceLoadCount > 0 ||
    activeSceneLoadToken !== null ||
    activeParsedZipExportController !== null,
  getSceneSnapshot: () => ({
    scene: lastParsedScene,
    label: lastParsedSceneLabel,
    loadedSourceKind: lastLoadedSource?.kind ?? null
  }),
  setSceneStats: (stats) => {
    lastParsedSceneStats = stats;
  },
  updateMetricsAfterSwitch: (label, scene, sceneStats) => {
    updateMetricsPanel(label, scene, sceneStats, 0, 0, null, null);
  },
  setMetricTimesText: (text) => {
    metricTimesTextElement.textContent = text;
  },
  setBaseStatus: (status) => {
    baseStatus = status;
  },
  setStatus,
  setStatusText: (status) => {
    statusTextElement.textContent = status;
    statusTextElement.hidden = status.trim().length === 0;
  }
});

backendSwitcher.initializeToggleState();
setMetricPlaceholder();
setHudCollapsed(false);
setDownloadDataButtonState(false);
setDownloadPdfButtonState(false);
setDownloadAllDataButtonState(false);
setStatus(baseStatus);
refreshDropIndicator();
void loadExampleManifest();

openButtonElement.addEventListener("click", () => {
  fileInputElement.click();
});

downloadDataButtonElement.addEventListener("click", () => {
  void downloadParsedDataZip();
});

downloadPdfButtonElement.addEventListener("click", () => {
  void downloadSourcePdf();
});

downloadAllDataButtonElement.addEventListener("click", () => {
  void downloadAllExampleParsedZips();
});

window.addEventListener("beforeunload", () => {
  activeParsedZipExportController?.abort();
}, { once: true });

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

backendSelectElement.addEventListener("change", () => {
  const targetBackend = backendSelectElement.value === "webgpu" ? "webgpu" : "webgl";
  void backendSwitcher?.applyPreference(targetBackend);
});

uiControlManager.bindEventListeners({
  onVectorLodModeChange: (mode) => {
    applyVectorLodMode(mode);
  }
});

function applyVectorLodMode(mode: VectorLodMode): void {
  renderer.setVectorLodMode?.(mode);
}

canvasInteractionController.attach(canvasElement);

window.addEventListener("resize", () => {
  renderer.resize();
});

// Mobile browsers can fire the window "resize" event before an orientation
// change has re-laid-out the page, so clientWidth/clientHeight are stale and
// the drawing buffer keeps the previous orientation's aspect ratio.
// ResizeObserver callbacks are delivered after layout with final geometry.
const canvasResizeObserver = new ResizeObserver(() => {
  renderer.resize();
});
canvasResizeObserver.observe(canvasElement);

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
    // Without a searchable document, let the browser's native find run.
    if (!textSearchWidget.isAvailable()) {
      return;
    }
    event.preventDefault();
    setHudCollapsed(false);
    textSearchWidget.focusInput();
  }
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
  exampleManifestEntries = [];
  exampleDropdown.setPlaceholder("Examples (loading...)");
  setDownloadAllDataButtonState(false);

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

    populateExampleDropdown(entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Examples] Failed to load manifest: ${message}`);
    exampleManifestEntries = [];
    exampleDropdown.setPlaceholder("Examples unavailable");
    setDownloadAllDataButtonState(false);
  }
}

function populateExampleDropdown(entries: NormalizedExampleEntry[]): void {
  exampleManifestEntries = [...entries];
  exampleSelectionMap.clear();
  const items: ExampleDropdownItem[] = [];

  for (const entry of entries) {
    const pdfKey = `${entry.id}:pdf`;
    const zipKey = `${entry.id}:zip`;

    exampleSelectionMap.set(pdfKey, {
      id: entry.id,
      sourceName: entry.name,
      kind: "pdf",
      path: entry.pdfPath,
      pdfPath: entry.pdfPath
    });
    exampleSelectionMap.set(zipKey, {
      id: entry.id,
      sourceName: entry.name,
      kind: "zip",
      path: entry.zipPath,
      pdfPath: entry.pdfPath
    });

    items.push({
      name: entry.name,
      actions: [
        {
          key: pdfKey,
          label: "PDF",
          sizeLabel: formatFileSize(entry.pdfSizeBytes),
          title: `Parse ${entry.name} from the original PDF`
        },
        {
          key: zipKey,
          label: "ZIP",
          sizeLabel: formatFileSize(entry.zipSizeBytes),
          title: `Load precomputed parsed data for ${entry.name}`
        }
      ]
    });
  }

  exampleDropdown.setItems(items);
  setDownloadAllDataButtonState(exampleManifestEntries.length > 0);
}

async function loadExampleSelection(selectionKey: string): Promise<void> {
  const selection = exampleSelectionMap.get(selectionKey);
  if (!selection) {
    return;
  }

  cancelActiveParsedZipExport();
  const sourceLoadToken = beginSourceLoad();
  exampleDropdown.setDisabled(true);
  try {
    const modeLabel = selection.kind === "pdf" ? "PDF" : "parsed ZIP";
    setStatus(`Loading example ${selection.sourceName} (${modeLabel})...`);
    const response = await fetch(selection.path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const fileBuffer = await response.arrayBuffer();
    if (!isCurrentSourceLoad(sourceLoadToken)) {
      return;
    }
    const bytes = cloneSourceBytes(fileBuffer);
    parsedPdfPageCache = null;

    if (selection.kind === "pdf") {
      lastLoadedSource = {
        kind: "pdf",
        bytes,
        label: selection.sourceName
      };
      lastDownloadablePdf = {
        label: selection.sourceName,
        bytes
      };
      setDownloadPdfButtonState(true);
      await loadPdfBuffer(createParseBuffer(bytes), selection.sourceName, {
        preserveView: false
      });
    } else {
      const zipLabel = `${selection.sourceName} (parsed zip)`;
      lastLoadedSource = {
        kind: "parsed-zip",
        bytes,
        label: zipLabel
      };
      lastDownloadablePdf = {
        label: selection.sourceName,
        url: selection.pdfPath
      };
      setDownloadPdfButtonState(true);
      await loadParsedDataZipBuffer(createParseBuffer(bytes), zipLabel, {
        preserveView: false
      });
    }
  } catch (error) {
    if (!isCurrentSourceLoad(sourceLoadToken)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load example: ${message}`);
  } finally {
    finishSourceLoad();
    exampleDropdown.setDisabled(false);
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
  cancelActiveParsedZipExport();
  const sourceLoadToken = beginSourceLoad();
  try {
    setStatus(`Reading ${file.name}...`);
    setDownloadPdfButtonState(false);
    const buffer = await file.arrayBuffer();
    if (!isCurrentSourceLoad(sourceLoadToken)) {
      return;
    }
    const bytes = cloneSourceBytes(buffer);
    lastLoadedSource = { kind: "pdf", bytes, label: file.name };
    lastDownloadablePdf = { label: file.name, bytes };
    setDownloadPdfButtonState(true);
    parsedPdfPageCache = null;
    await loadPdfBuffer(createParseBuffer(bytes), file.name, { preserveView: false });
  } finally {
    finishSourceLoad();
  }
}

async function loadParsedDataZipFile(file: File): Promise<void> {
  cancelActiveParsedZipExport();
  const sourceLoadToken = beginSourceLoad();
  try {
    setStatus(`Reading ${file.name}...`);
    lastDownloadablePdf = null;
    setDownloadPdfButtonState(false);
    const buffer = await file.arrayBuffer();
    if (!isCurrentSourceLoad(sourceLoadToken)) {
      return;
    }
    const bytes = cloneSourceBytes(buffer);
    lastLoadedSource = { kind: "parsed-zip", bytes, label: file.name };
    parsedPdfPageCache = null;
    await loadParsedDataZipBuffer(createParseBuffer(bytes), file.name, { preserveView: false });
    if (isCurrentSourceLoad(sourceLoadToken) && lastLoadedSource?.bytes === bytes) {
      const sourcePdfBytes = await tryReadSourcePdfBytesFromExistingParsedZip(bytes);
      if (sourcePdfBytes && sourcePdfBytes.length > 0) {
        lastDownloadablePdf = { label: file.name, bytes: sourcePdfBytes };
        setDownloadPdfButtonState(true);
      }
    }
  } finally {
    finishSourceLoad();
  }
}

async function loadPdfBuffer(buffer: ArrayBuffer, label: string, options: LoadPdfOptions = {}): Promise<void> {
  const activeLoadToken = await backendSwitcher!.runWhenIdle(() => {
    const nextLoadToken = ++loadToken;
    beginSceneLoad(nextLoadToken);
    return nextLoadToken;
  });
  if (activeLoadToken !== loadToken) {
    return;
  }
  const loadStart = performance.now();
  const extractionOptions = getExtractionOptions();
  const pageSceneOptionsKey = buildPdfPageCacheKey();
  const cachedPageScenes = getCachedPdfPageScenes(label, pageSceneOptionsKey);
  const progress = createLoadProgressReporter((payload) => {
    if (activeLoadToken === loadToken) {
      updateParsingLoaderProgress(payload);
    }
  });

  try {
    let scene: VectorScene;
    let parseMs = 0;

    if (cachedPageScenes) {
      const pagesPerRow = computeAutoPagesPerRow(cachedPageScenes.length);
      const composeStart = performance.now();
      progress.report(LOAD_PROGRESS_COMPILE, { stage: "compile", sourceType: "pdf" });
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
      setParsingLoader(true, "0.00% Parsing / loading");
      setStatus(
        `Parsing ${label} with PDF.js... (merge ${extractionOptions.enableSegmentMerge ? "on" : "off"}, cull ${extractionOptions.enableInvisibleCull ? "on" : "off"})`
      );
      const pageScenes = await extractPdfPageScenes(buffer, {
        ...extractionOptions,
        onProgress: progress.child(0, LOAD_PROGRESS_PARSE_END, { sourceType: "pdf" }).toCallback()
      });
      parseMs = performance.now() - parseStart;

      if (activeLoadToken === loadToken) {
        progress.report(LOAD_PROGRESS_COMPILE, { stage: "compile", sourceType: "pdf" });
      }

      if (activeLoadToken !== loadToken) {
        return;
      }

      const pagesPerRow = computeAutoPagesPerRow(pageScenes.length);
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
      setParsingLoader(false);
      setStatus(`No visible geometry was extracted from ${label}.`);
      runtimeTextElement.textContent = "";
      setMetricPlaceholder(label);
      setDownloadDataButtonState(false);
      return;
    }

    setStatus(
      `Building Vector LOD / GPU data for ${scene.segmentCount.toLocaleString()} segments, ${scene.textInstanceCount.toLocaleString()} text instances${hasRasterLayer ? `, ${rasterLayerCount.toLocaleString()} raster layer${rasterLayerCount === 1 ? "" : "s"}` : ""}...`
    );
    const prebuildLodTiming = await prebuildVectorLodForScene(scene, progress, "pdf", activeLoadToken);
    if (activeLoadToken !== loadToken) {
      return;
    }
    progress.report(LOAD_PROGRESS_UPLOAD, { stage: "upload", sourceType: "pdf" });
    const uploadStart = performance.now();
    const targetRenderer = renderer;
    const sceneStats = targetRenderer.setScene(scene);
    const fallbackLodTiming = consumeVectorStrokeLodBuildTiming();
    const lodTiming = combineVectorLodTimings(prebuildLodTiming, fallbackLodTiming);
    if (!options.preserveView) {
      targetRenderer.fitToBounds(resolveSceneFitBounds(scene), 64);
    }
    const uploadEnd = performance.now();
    const uploadMs = Math.max(0, uploadEnd - uploadStart - fallbackLodTiming.elapsedMs);
    progress.complete({ sourceType: "pdf" });
    if (activeLoadToken === loadToken) {
      setParsingLoader(false);
    }

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
    applyTextSearchScene(scene);
    refreshDropIndicator();
    setDownloadDataButtonState(true);

    updateMetricsPanel(label, scene, sceneStats, parseMs, uploadMs, lodTiming, performance.now() - loadStart);
    clearLoadedStatus();
  } catch (error) {
    if (activeLoadToken !== loadToken) {
      return;
    }

    setParsingLoader(false);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to render PDF: ${message}`);
    runtimeTextElement.textContent = "";
    setMetricPlaceholder(label);
  } finally {
    finishSceneLoad(activeLoadToken);
  }
}

async function reloadLastPdfWithCurrentOptions(): Promise<void> {
  if (!lastLoadedSource || lastLoadedSource.kind !== "pdf") {
    return;
  }
  await loadPdfBuffer(createParseBuffer(lastLoadedSource.bytes), lastLoadedSource.label, { preserveView: true });
}

async function loadParsedDataZipBuffer(buffer: ArrayBuffer, label: string, options: LoadPdfOptions = {}): Promise<void> {
  const activeLoadToken = await backendSwitcher!.runWhenIdle(() => {
    const nextLoadToken = ++loadToken;
    beginSceneLoad(nextLoadToken);
    return nextLoadToken;
  });
  if (activeLoadToken !== loadToken) {
    return;
  }
  const loadStart = performance.now();
  const progress = createLoadProgressReporter((payload) => {
    if (activeLoadToken === loadToken) {
      updateParsingLoaderProgress(payload);
    }
  });

  try {
    const parseStart = performance.now();
    setParsingLoader(true, "0.00% Parsing / loading");
    setStatus(`Loading parsed data from ${label}...`);
    const scene = await loadSceneFromParsedDataZip(buffer, {
      onProgress: progress.child(0, LOAD_PROGRESS_PARSE_END, { sourceType: "zip" }).toCallback()
    });
    const parseEnd = performance.now();

    if (activeLoadToken === loadToken) {
      progress.report(LOAD_PROGRESS_VECTOR_LOD_START, { stage: "vector-lod", sourceType: "zip" });
    }

    if (activeLoadToken !== loadToken) {
      return;
    }

    const rasterLayerCount = listSceneRasterLayers(scene).length;
    const hasRasterLayer = rasterLayerCount > 0;
    if (scene.segmentCount === 0 && scene.textInstanceCount === 0 && scene.fillPathCount === 0 && !hasRasterLayer) {
      setParsingLoader(false);
      setStatus(`No visible geometry was found in ${label}.`);
      runtimeTextElement.textContent = "";
      setMetricPlaceholder(label);
      setDownloadDataButtonState(false);
      return;
    }

    setStatus(
      `Building Vector LOD / GPU data for ${scene.segmentCount.toLocaleString()} segments, ${scene.textInstanceCount.toLocaleString()} text instances${hasRasterLayer ? `, ${rasterLayerCount.toLocaleString()} raster layer${rasterLayerCount === 1 ? "" : "s"}` : ""}...`
    );
    const prebuildLodTiming = await prebuildVectorLodForScene(scene, progress, "zip", activeLoadToken);
    if (activeLoadToken !== loadToken) {
      return;
    }
    progress.report(LOAD_PROGRESS_UPLOAD, { stage: "upload", sourceType: "zip" });
    const uploadStart = performance.now();
    const targetRenderer = renderer;
    const sceneStats = targetRenderer.setScene(scene);
    const fallbackLodTiming = consumeVectorStrokeLodBuildTiming();
    const lodTiming = combineVectorLodTimings(prebuildLodTiming, fallbackLodTiming);
    if (!options.preserveView) {
      targetRenderer.fitToBounds(resolveSceneFitBounds(scene), 64);
    }
    const uploadEnd = performance.now();
    const uploadMs = Math.max(0, uploadEnd - uploadStart - fallbackLodTiming.elapsedMs);
    progress.complete({ sourceType: "zip" });
    if (activeLoadToken === loadToken) {
      setParsingLoader(false);
    }

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
    applyTextSearchScene(scene);
    refreshDropIndicator();
    setDownloadDataButtonState(true);

    updateMetricsPanel(label, scene, sceneStats, parseEnd - parseStart, uploadMs, lodTiming, performance.now() - loadStart);
    clearLoadedStatus();
  } catch (error) {
    if (activeLoadToken !== loadToken) {
      return;
    }

    setParsingLoader(false);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load parsed data zip: ${message}`);
    runtimeTextElement.textContent = "";
    setMetricPlaceholder(label);
  } finally {
    finishSceneLoad(activeLoadToken);
  }
}

function getExtractionOptions(): VectorExtractOptions {
  return {
    enableSegmentMerge: true,
    enableInvisibleCull: true
  };
}

function buildPdfPageCacheKey(): string {
  return "merge:1|cull:1";
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
  statusTextElement.hidden = message.trim().length === 0;
}

function clearLoadedStatus(): void {
  baseStatus = "";
  statusTextElement.textContent = "";
  statusTextElement.hidden = true;
}

function setParsingLoader(isVisible: boolean, text = "0.00% Parsing / loading..."): void {
  parsingLoaderElement.hidden = !isVisible;
  parsingLoaderTextElement.textContent = isVisible ? text : "";
}

function beginSceneLoad(token: number): void {
  activeSceneLoadToken = token;
  updateBackendSelectDisabledState();
}

function beginSourceLoad(): number {
  pendingSourceLoadCount += 1;
  sourceLoadSerial += 1;
  updateBackendSelectDisabledState();
  return sourceLoadSerial;
}

function isCurrentSourceLoad(token: number): boolean {
  return token === sourceLoadSerial;
}

function finishSourceLoad(): void {
  pendingSourceLoadCount = Math.max(0, pendingSourceLoadCount - 1);
  updateBackendSelectDisabledState();
}

function finishSceneLoad(token: number): void {
  if (activeSceneLoadToken !== token) {
    return;
  }
  activeSceneLoadToken = null;
  updateBackendSelectDisabledState();
}

function updateBackendSelectDisabledState(): void {
  backendSelectElement.disabled =
    pendingSourceLoadCount > 0 ||
    activeSceneLoadToken !== null ||
    activeParsedZipExportController !== null;
}

function updateParsingLoaderProgress(progress: PDFLoadProgress): void {
  const stageLabel = formatLoadProgressStage(progress.stage);
  const value = Math.max(0, Math.min(1, Number(progress.value) || 0));
  setParsingLoader(true, `${(value * 100).toFixed(2)}% ${stageLabel}`);
}

async function prebuildVectorLodForScene(
  scene: VectorScene,
  progress: ReturnType<typeof createLoadProgressReporter>,
  sourceType: "pdf" | "zip",
  activeLoadToken: number
): Promise<VectorStrokeLodBuildTiming> {
  resetVectorStrokeLodBuildTiming();
  progress.report(LOAD_PROGRESS_VECTOR_LOD_START, { stage: "vector-lod", sourceType });
  await prebuildVectorStrokeLodRuntime(
    scene,
    uiControlManager.readVectorLodModeInput(),
    backendSwitcher?.getActiveBackend() ?? "webgl",
    {
      yieldIntervalMs: 500,
      shouldCancel: () => activeLoadToken !== loadToken,
      onProgress: (lodProgress) => {
        if (activeLoadToken !== loadToken) {
          return;
        }
        const value =
          LOAD_PROGRESS_VECTOR_LOD_START +
          lodProgress.value * (LOAD_PROGRESS_VECTOR_LOD_END - LOAD_PROGRESS_VECTOR_LOD_START);
        progress.report(value, { stage: "vector-lod", sourceType });
      }
    }
  );
  return consumeVectorStrokeLodBuildTiming();
}

function combineVectorLodTimings(
  a: VectorStrokeLodBuildTiming,
  b: VectorStrokeLodBuildTiming
): VectorStrokeLodBuildTiming {
  return {
    elapsedMs: a.elapsedMs + b.elapsedMs,
    buildCount: a.buildCount + b.buildCount,
    sourceSegmentCount: a.sourceSegmentCount + b.sourceSegmentCount,
    levelCount: a.levelCount + b.levelCount
  };
}

function setDownloadDataButtonState(hasParsedData: boolean, isBusy = false): void {
  downloadDataButtonElement.hidden = !hasParsedData;
  downloadDataButtonElement.disabled = !hasParsedData || isBusy || isBatchExampleExportRunning;
  downloadDataButtonElement.textContent = isBusy ? "Preparing ZIP..." : "Download Parsed Data";
}

function setDownloadPdfButtonState(hasPdf: boolean, isBusy = false): void {
  downloadPdfButtonElement.hidden = !hasPdf;
  downloadPdfButtonElement.disabled =
    !hasPdf ||
    isBusy ||
    isBatchExampleExportRunning ||
    activeParsedZipExportController !== null;
  downloadPdfButtonElement.textContent = isBusy ? "Preparing PDF..." : "Download PDF";
}

function setDownloadAllDataButtonState(hasExamples: boolean, isBusy = false, progressText?: string): void {
  downloadAllDataButtonElement.hidden = !bulkZipExportEnabled;
  downloadAllDataButtonElement.disabled = !bulkZipExportEnabled || !hasExamples || isBusy;
  downloadAllDataButtonElement.textContent = isBusy
    ? progressText ?? "Exporting Example ZIPs..."
    : "Download All Example ZIPs";
}

function setPrimaryLoadControlsEnabled(isEnabled: boolean): void {
  openButtonElement.disabled = !isEnabled;
  fileInputElement.disabled = !isEnabled;
  exampleDropdown.setDisabled(!isEnabled);
}

function setHudCollapsed(collapsed: boolean): void {
  hudPanelElement.classList.toggle("collapsed", collapsed);
  toggleHudButtonElement.setAttribute("aria-expanded", String(!collapsed));
  toggleHudButtonElement.title = collapsed ? "Expand panel" : "Collapse panel";
  toggleHudIconElement.textContent = collapsed ? "▸" : "▾";
}

async function downloadAllExampleParsedZips(): Promise<void> {
  if (
    !bulkZipExportEnabled ||
    isBatchExampleExportRunning ||
    activeParsedZipExportController !== null ||
    pendingSourceLoadCount > 0 ||
    activeSceneLoadToken !== null ||
    backendSwitcher?.isSwitchInFlight() === true
  ) {
    return;
  }

  const pdfEntries = exampleManifestEntries;
  if (pdfEntries.length === 0) {
    setStatus("No example PDFs available for batch export.");
    return;
  }

  isBatchExampleExportRunning = true;
  const exportController = new AbortController();
  activeParsedZipExportController = exportController;
  setPrimaryLoadControlsEnabled(false);
  updateBackendSelectDisabledState();
  setDownloadDataButtonState(Boolean(lastParsedScene && lastParsedSceneLabel), false);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
  setDownloadAllDataButtonState(true, true, `Exporting 0/${pdfEntries.length}...`);
  setParsingLoader(true, "0.00% Preparing parsed ZIP export...");

  try {
    await yieldToBrowserPaint();
    for (let index = 0; index < pdfEntries.length; index += 1) {
      exportController.signal.throwIfAborted();
      const entry = pdfEntries[index];
      const step = index + 1;
      setDownloadAllDataButtonState(true, true, `Exporting ${step}/${pdfEntries.length}...`);
      setStatus(`Batch ${step}/${pdfEntries.length}: loading ${entry.name}...`);

      const response = await fetch(entry.pdfPath, {
        cache: "no-store",
        signal: exportController.signal
      });
      if (!response.ok) {
        throw new Error(`${entry.name}: HTTP ${response.status}`);
      }

      const bytes = cloneSourceBytes(await response.arrayBuffer());
      const zipBlob = await buildParsedDataZip(bytes, {
        sourceLabel: entry.name,
        signal: exportController.signal,
        onProgress: (progress) => {
          if (activeParsedZipExportController !== exportController) {
            return;
          }
          const overallValue = (index + progress.value) / pdfEntries.length;
          const stageLabel = formatLoadProgressStage(progress.stage);
          setParsingLoader(
            true,
            `${(overallValue * 100).toFixed(2)}% ${stageLabel} (${step}/${pdfEntries.length})`
          );
        }
      });
      const zipFileName = `${sanitizeDownloadName(entry.name)}-parsed-data.zip`;
      setStatus(`Batch ${step}/${pdfEntries.length}: downloading ${entry.name} parsed ZIP...`);
      triggerBrowserDownload(zipBlob, zipFileName);
      await delayMilliseconds(200);
    }

    if (activeParsedZipExportController === exportController) {
      setStatus(`Batch export complete: ${pdfEntries.length.toLocaleString()} parsed ZIP files downloaded.`);
    }
  } catch (error) {
    if (activeParsedZipExportController === exportController) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Batch export failed: ${message}`);
    }
  } finally {
    const ownsExportUi = activeParsedZipExportController === exportController;
    if (ownsExportUi) {
      activeParsedZipExportController = null;
      setParsingLoader(false);
    }
    if (ownsExportUi) {
      isBatchExampleExportRunning = false;
      setPrimaryLoadControlsEnabled(true);
      updateBackendSelectDisabledState();
      setDownloadDataButtonState(Boolean(lastParsedScene && lastParsedSceneLabel), false);
      setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
      setDownloadAllDataButtonState(exampleManifestEntries.length > 0, false);
    }
  }
}

async function downloadParsedDataZip(): Promise<boolean> {
  if (backendSwitcher?.isSwitchInFlight()) {
    setStatus("Wait for the renderer backend switch to finish before exporting parsed data.");
    return false;
  }
  if (activeSceneLoadToken !== null) {
    setStatus("Wait for the current document load to finish before exporting parsed data.");
    return false;
  }
  if (pendingSourceLoadCount > 0) {
    setStatus("Wait for the current source read to finish before exporting parsed data.");
    return false;
  }
  if (!lastParsedScene || !lastParsedSceneLabel) {
    setStatus("No parsed floorplan data available to export.");
    return false;
  }
  if (activeParsedZipExportController !== null) {
    return false;
  }

  const scene = lastParsedScene;
  const label = lastParsedSceneLabel;
  const sourcePdf =
    lastLoadedSource?.kind === "pdf"
      ? lastLoadedSource.bytes
      : lastDownloadablePdf?.bytes ??
        lastDownloadablePdf?.blob ??
        lastDownloadablePdf?.url;
  const previousStatusText = statusTextElement.textContent;

  const exportController = new AbortController();
  activeParsedZipExportController = exportController;
  setDownloadDataButtonState(true, true);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
  setDownloadAllDataButtonState(exampleManifestEntries.length > 0, true, "Export in progress...");
  setPrimaryLoadControlsEnabled(false);
  updateBackendSelectDisabledState();
  statusTextElement.hidden = false;
  statusTextElement.textContent = "Preparing parsed texture data zip...";
  setParsingLoader(true, "0.00% Preparing parsed ZIP export...");

  try {
    await yieldToBrowserPaint();
    const zipBlob = await buildParsedDataZip(scene, {
      sourceLabel: label,
      signal: exportController.signal,
      onProgress: (progress) => {
        if (activeParsedZipExportController === exportController) {
          updateParsingLoaderProgress(progress);
        }
      },
      sourcePdf
    });

    if (activeParsedZipExportController !== exportController) {
      return false;
    }

    const zipFileName = `${sanitizeDownloadName(label)}-parsed-data.zip`;
    triggerBrowserDownload(zipBlob, zipFileName);
    console.log(
      `[Parsed data export] ${label}: wrote ${zipFileName} (${formatFileSize(zipBlob.size)})`
    );
    const restoredStatus = previousStatusText || baseStatus;
    statusTextElement.textContent = restoredStatus;
    statusTextElement.hidden = restoredStatus.trim().length === 0;
    return true;
  } catch (error) {
    if (activeParsedZipExportController === exportController) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to download parsed data: ${message}`);
    }
    return false;
  } finally {
    if (activeParsedZipExportController === exportController) {
      activeParsedZipExportController = null;
      setParsingLoader(false);
      setPrimaryLoadControlsEnabled(true);
      updateBackendSelectDisabledState();
      setDownloadDataButtonState(Boolean(lastParsedScene && lastParsedSceneLabel), false);
      setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
      setDownloadAllDataButtonState(exampleManifestEntries.length > 0, false);
    }
  }
}

async function downloadSourcePdf(): Promise<boolean> {
  if (!lastDownloadablePdf) {
    setStatus("No source PDF is available for the current file.");
    return false;
  }

  setDownloadPdfButtonState(true, true);
  try {
    const blob = await readPdfDownloadBlob(lastDownloadablePdf);
    triggerBrowserDownload(blob, formatPdfDownloadFilename(lastDownloadablePdf.label));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to download PDF: ${message}`);
    return false;
  } finally {
    setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
  }
}

function formatFileSize(sizeBytes: number): string {
  const safeBytes = Math.max(0, Number(sizeBytes) || 0);
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = safeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? Math.round(value) : Number(value.toFixed(2));
  return `${rounded} ${units[unitIndex]}`;
}

function sanitizeDownloadName(label: string): string {
  const withoutExtension = label.replace(/\.pdf$/i, "");
  const normalized = withoutExtension.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized.length > 0 ? normalized : "floorplan";
}

function delayMilliseconds(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, durationMs));
  });
}

function yieldToBrowserPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let animationFrame = 0;
    let fallbackTimer = 0;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(fallbackTimer);
      resolve();
    };
    animationFrame = window.requestAnimationFrame(finish);
    fallbackTimer = window.setTimeout(finish, 100);
  });
}

function cancelActiveParsedZipExport(): void {
  const controller = activeParsedZipExportController;
  if (!controller) {
    return;
  }
  activeParsedZipExportController = null;
  controller.abort();
  isBatchExampleExportRunning = false;
  setParsingLoader(false);
  setPrimaryLoadControlsEnabled(true);
  updateBackendSelectDisabledState();
  setDownloadDataButtonState(Boolean(lastParsedScene && lastParsedSceneLabel), false);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
  setDownloadAllDataButtonState(exampleManifestEntries.length > 0, false);
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
  uploadMs: number,
  lodTiming: VectorStrokeLodBuildTiming | null,
  totalMs: number | null
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
  const lodMs = lodTiming?.elapsedMs ?? 0;
  const lodSuffix = lodTiming && lodTiming.buildCount > 0
    ? `, vector lod ${lodMs.toFixed(0)} ms (${lodTiming.levelCount.toLocaleString()} levels)`
    : ", vector lod -";
  const totalPrefix = totalMs !== null ? `total ${totalMs.toFixed(0)} ms, ` : "";
  metricTimesTextElement.textContent =
    `${totalPrefix}parse ${parseMs.toFixed(0)} ms${lodSuffix}, upload ${uploadMs.toFixed(0)} ms`;
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
  return new Uint8Array(bytes).buffer;
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
