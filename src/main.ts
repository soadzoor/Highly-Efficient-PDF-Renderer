import { promptForHepLod } from "./hepLodPrompt";
import { createViewerLinkNavigation } from "./viewerLinkNavigation";
import { createAnnotationOverlay } from "./annotationOverlay";
import { createAnnotationInteractionController, type AnnotationInteractionController } from "./annotationInteraction";
import { createNativeAnnotationInteractionAdapter } from "./nativeAnnotationInteraction";
import "./style.css";
import "./drawingSelectionControls.css";
import "./pdfLayerControls.css";
import "./pdfPasswordPrompt.css";
import { promptForPdfPassword } from "./pdfPasswordPrompt";
import { isPdfPasswordError } from "./pdfObjectGenerator";
import { createLayerVisibilityController } from "./layerVisibility";
import { createPdfLayerControls } from "./pdfLayerControls";
import { createPdfAnnotationControls } from "./pdfAnnotationControls";
import { waitForLoad, yieldAfterPaint } from "./loadCancellation";

import { WebGlFloorplanRenderer, type DrawStats, type SceneStats } from "./webGlFloorplanRenderer";
import {
  composeVectorScenesInGrid,
  type Bounds,
  type VectorExtractOptions,
  type VectorScene
} from "./pdfVectorExtractor";
import { createCanvasInteractionController } from "./canvasInteractions";
import { createBackendSwitcher } from "./backendSwitcher";
import { buildHep } from "./hepBuilder";
import { loadSceneFromHep } from "./hepReader";
import { openPdfPageDemand, type PdfPageDemandLoader } from "./pdfPageDemand";
import { listSceneRasterLayers, prepareSceneForHepRendering } from "./hepShared";
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
  hasStoredVectorStrokeLod,
  prebuildVectorStrokeLodRuntime,
  resetVectorStrokeLodBuildTiming,
  type VectorLodMode,
  type VectorStrokeLodBuildTiming
} from "./vectorStrokeLodCore";
import { formatVectorStrokeLodStats } from "./vectorStrokeLodStatsFormat";
import { formatTextLodStats } from "./textLodStatsFormat";
import { prebuildTextLod, type TextLodMode } from "./textLodCore";
import {
  createSearchHighlightSet,
  createTextSearchController,
  type TextSearchController,
  type TextSearchMatch
} from "./textSearch";
import { createTextSearchWidget } from "./textSearchWidget";
import { createTextSelectionController } from "./textSelection";
import { createPrimitiveInteractionController } from "./primitiveInteraction";
import { createDrawingSelectionControls } from "./drawingSelectionControls";
import type { RenderPerformanceOptions, RenderPerformanceProfiler } from "./renderPerformance";
import {
  formatSceneSegmentAccounting,
  getSceneSegmentAccounting
} from "./sceneStatistics";
import type { SearchHighlightSet } from "./rendererTypes";
import { createDrawCallMeter } from "./drawCallMetrics";

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
const metricSourceSegmentsElement = document.querySelector<HTMLSpanElement>("#metric-source-segments");
const metricMergedSegmentsElement = document.querySelector<HTMLSpanElement>("#metric-merged-segments");
const metricVisibleSegmentsElement = document.querySelector<HTMLSpanElement>("#metric-visible-segments");
const metricReductionsElement = document.querySelector<HTMLSpanElement>("#metric-reductions");
const metricCullDiscardsElement = document.querySelector<HTMLSpanElement>("#metric-cull-discards");
const metricTimesElement = document.querySelector<HTMLSpanElement>("#metric-times");
const metricFpsElement = document.querySelector<HTMLSpanElement>("#metric-fps");
const metricDrawCallsElement = document.querySelector<HTMLSpanElement>("#metric-draw-calls");
const metricTextureElement = document.querySelector<HTMLSpanElement>("#metric-texture");
const metricGridMaxCellElement = document.querySelector<HTMLSpanElement>("#metric-grid-max-cell");
const dropIndicator = document.querySelector<HTMLDivElement>("#drop-indicator");
const backendSelect = document.querySelector<HTMLSelectElement>("#backend-select");
const vectorLodSelect = document.querySelector<HTMLSelectElement>("#vector-lod-mode");
const textLodSelect = document.querySelector<HTMLSelectElement>("#text-lod-mode");
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
const ocrTextCheckbox = document.querySelector<HTMLInputElement>("#ocr-text-checkbox");
const pageStreamingCheckbox = document.querySelector<HTMLInputElement>("#page-streaming-checkbox");
const drawingSelectionContainer = document.querySelector<HTMLDivElement>("#drawing-selection");

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
  !metricSourceSegmentsElement ||
  !metricMergedSegmentsElement ||
  !metricVisibleSegmentsElement ||
  !metricReductionsElement ||
  !metricCullDiscardsElement ||
  !metricTimesElement ||
  !metricFpsElement ||
  !metricDrawCallsElement ||
  !metricTextureElement ||
  !metricGridMaxCellElement ||
  !dropIndicator ||
  !backendSelect ||
  !vectorLodSelect ||
  !textLodSelect ||
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
  !textSelectionCheckbox ||
  !ocrTextCheckbox ||
  !pageStreamingCheckbox ||
  !drawingSelectionContainer
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
const metricSourceSegmentsTextElement = metricSourceSegmentsElement;
const metricMergedSegmentsTextElement = metricMergedSegmentsElement;
const metricVisibleSegmentsTextElement = metricVisibleSegmentsElement;
const metricReductionsTextElement = metricReductionsElement;
const metricCullDiscardsTextElement = metricCullDiscardsElement;
const metricTimesTextElement = metricTimesElement;
const metricFpsTextElement = metricFpsElement;
const drawCallMeter = createDrawCallMeter(metricDrawCallsElement);
const metricTextureTextElement = metricTextureElement;
const metricGridMaxCellTextElement = metricGridMaxCellElement;
const dropIndicatorElement = dropIndicator;
const backendSelectElement = backendSelect;
const vectorLodSelectElement = vectorLodSelect;
const textLodSelectElement = textLodSelect;
const pageBackgroundColorInputElement = pageBackgroundColorInput;
const pageBackgroundOpacitySliderElement = pageBackgroundOpacitySlider;
const pageBackgroundOpacityInputElement = pageBackgroundOpacityInput;
const vectorColorInputElement = vectorColorInput;
const vectorOpacitySliderElement = vectorOpacitySlider;
const vectorOpacityInputElement = vectorOpacityInput;
let renderer: RendererApi;
let webGpuRendererClass: typeof import("./webGpuFloorplanRenderer").WebGpuFloorplanRenderer | null = null;
let lastParsedScene: VectorScene | null = null;
let activePdfPageLoader: PdfPageDemandLoader | null = null;
let demandPdfUpdateTimer: number | null = null;
let demandPdfUpdateRunning = false;
let demandPdfUpdatePending = false;
let backendSwitcher: ReturnType<typeof createBackendSwitcher> | null = null;

const uiControlManager = createUiControlManager(
  {
    vectorLodSelect: vectorLodSelectElement,
    textLodSelect: textLodSelectElement,
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
  lastSearchHighlights = createSearchHighlightSet(all, current ? all.indexOf(current) : -1);
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
    onQueryInput: (query) => {
      if (query.trim()) activePdfPageLoader?.requestAllPreviews();
      textSearchController.setQuery(query);
    },
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
  layerVisibility.sceneChanged();
  pdfLayerControls.refresh();
  annotationControls.sceneChanged();
  drawingSelection.sceneChanged();
  annotationOverlay.sceneChanged();
  annotationInteraction?.sceneChanged();
  annotationInteraction?.refresh();
  textSearchController.setScene(scene);
  const hasText = scene.textIndex?.pages.some((page) => page.text.length > 0) ?? false;
  textSearchWidget.setAvailability(hasText ? "ready" : "no-text-index");
}

const textSelection = createTextSelectionController({
  getCanvas: () => canvasElement,
  enabled: textSelectionCheckbox.checked,
  adapter: {
    getScene: () => lastParsedScene,
    getOptionalContentVisibility: () => renderer.getOptionalContentVisibility?.() ?? null,
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
  if (textSelectionCheckbox.checked && !drawingSelection.isEnabled()) {
    textSelection.enable();
  } else {
    textSelection.disable();
  }
});

textSelectionCheckbox.disabled = false;
ocrTextCheckbox.addEventListener("change", () => { void reloadPdfViewingOptions(); });
pageStreamingCheckbox.addEventListener("change", () => { void reloadPdfViewingOptions(); });
let annotationInteraction: AnnotationInteractionController | undefined;
const drawingSelection = createDrawingSelectionControls({
  container: drawingSelectionContainer,
  getLayerName: id => lastParsedScene?.optionalContent?.groups.find(group => group.id === id)?.name,
  createController: callbacks => createPrimitiveInteractionController({
    ...callbacks,
    getCanvas: () => canvasElement,
    getRenderer: () => renderer,
    getScene: () => lastParsedScene,
    onError: error => { setStatus(`Drawing selection failed: ${error instanceof Error ? error.message : String(error)}`); }
  }),
  onEnabledChange: enabled => {
    annotationInteraction?.setInteractionEnabled(!enabled);
    textSelectionCheckbox.disabled = enabled;
    if (enabled) {
      textSelection.disable();
      canvasInteractionController.cancelActiveGesture();
    } else if (textSelectionCheckbox.checked) textSelection.enable();
  }
});

const annotationBubblesCheckbox = document.querySelector<HTMLInputElement>("#annotation-bubbles-checkbox")!;
const linkNavigation = createViewerLinkNavigation({
  getCanvas: () => canvasElement,
  getScene: () => lastParsedScene,
  getIdentity: () => renderer,
  getSourceUrl: () => lastDownloadablePdf?.url,
  beforeNavigate: () => canvasInteractionController.cancelActiveGesture(),
  getView: () => {
    if (!renderer) return null;
    const view = renderer.getViewState();
    const ratio = canvasElement.width / Math.max(1, canvasElement.getBoundingClientRect().width);
    return { centerX: view.cameraCenterX, centerY: view.cameraCenterY, zoom: view.zoom / ratio };
  },
  setView: view => {
    const ratio = canvasElement.width / Math.max(1, canvasElement.getBoundingClientRect().width);
    renderer.setViewState({ cameraCenterX: view.centerX, cameraCenterY: view.centerY, zoom: view.zoom * ratio });
  }
});
const annotationOverlay = createAnnotationOverlay({
  pointerInteraction: false,
  getCanvas: () => canvasElement,
  adapter: {
    getScene: () => lastParsedScene,
    getOptionalContentVisibility: () => renderer.getOptionalContentVisibility?.() ?? null,
    clientToScenePoint: (x, y) => renderer.clientToScenePoint?.(x, y) ?? null,
    sceneToClientPoint: (x, y) => renderer.sceneToClientPoint?.(x, y) ?? null,
    isInteractionSuppressed: () => drawingSelection.isEnabled() || textSelection.getSelectedText().length > 0,
    isAnnotationEnabled: annotation => annotationControls.isAnnotationEnabled(annotation)
  },
  onActivate: annotation => linkNavigation.activate(annotation),
  getActivationLabel: annotation => linkNavigation.getActivationLabel(annotation),
  enabled: annotationBubblesCheckbox.checked
});
annotationBubblesCheckbox.addEventListener("change", () => {
  if (annotationBubblesCheckbox.checked) {
    annotationOverlay.enable();
    annotationInteraction?.select(annotationInteraction.getSelection());
  } else annotationOverlay.disable();
});

const layerVisibility = createLayerVisibilityController({
  getScene: () => lastParsedScene,
  getRenderer: () => renderer,
  onProgress: percentage => pdfLayerControls.setProgress(percentage),
  onChange: () => {
    textSearchController.refreshVisibility();
    textSelection.clearSelection();
    drawingSelection.onFrame();
    annotationInteraction?.onFrame();
    annotationOverlay.onFrame();
  }
});
const pdfLayerControls = createPdfLayerControls({
  container: document.querySelector<HTMLDivElement>("#pdf-layers")!, controller: layerVisibility
});
const annotationControls = createPdfAnnotationControls({
  container: document.querySelector<HTMLDivElement>("#pdf-annotations")!,
  controller: {
    getScene: () => lastParsedScene,
    getAnnotationLayers: () => layerVisibility.getAnnotationLayers(),
    setAnnotationVisibility: (ids, visible) => layerVisibility.setAnnotationVisibility(ids, visible)
  },
  onSelect: annotation => {
    drawingSelection.disable();
    textSelection.clearSelection();
    annotationInteraction?.select(annotation?.id ?? null);
  },
  onHover: annotation => {
    if (!drawingSelection.isEnabled()) annotationInteraction?.hover(annotation?.id ?? null);
  },
  onChange: () => {
    annotationInteraction?.refresh();
    annotationOverlay.onFrame();
  }
});
annotationInteraction = createAnnotationInteractionController({
  adapter: createNativeAnnotationInteractionAdapter({
    getCanvas: () => canvasElement, getScene: () => lastParsedScene, getRenderer: () => renderer
  }),
  isInteractionSuppressed: () => drawingSelection.isEnabled() || textSelection.getSelectedText().length > 0,
  onSelectionChange: (annotation, source, point) => {
    annotationControls.selectAnnotation(annotation?.id ?? null, { reveal: source === "canvas" });
    if (source === "canvas" && annotation && annotationControls.isAnnotationEnabled(annotation) && linkNavigation.activate(annotation)) {
      annotationOverlay.hide();
    } else if (annotation && annotationBubblesCheckbox.checked && annotationControls.isAnnotationEnabled(annotation)) {
      annotationOverlay.show(annotation, point);
    } else annotationOverlay.hide();
  },
  onHoverChange: (annotation, point) => {
    if (annotationInteraction?.getSelection()) return;
    if (annotation && annotationBubblesCheckbox.checked && annotationControls.isAnnotationEnabled(annotation)) annotationOverlay.show(annotation, point);
    else annotationOverlay.hide();
  },
  onError: error => setStatus(`Annotation selection failed: ${error instanceof Error ? error.message : String(error)}`)
});

let lastRuntimeTextUpdate = -Infinity;
function onRendererFrame(stats: DrawStats): void {
  const now = performance.now();
  if (activePdfPageLoader && lastParsedScene && activeSceneLoadToken === null &&
      pendingSourceLoadCount === 0 && activeHepExportController === null) {
    // Demand follows every presented frame, including the final frame of a short zoom.
    // Scene uploads remain coalesced separately by scheduleDemandPdfUpdate.
    activePdfPageLoader.update({ ...renderer.getPresentedViewState(), width: canvasElement.width, height: canvasElement.height }, lastParsedScene.pageRects);
  }
  updateFpsMetric(now);
  drawCallMeter.update(stats.drawCalls);
  textSelection.updateOverlay();
  drawingSelection.onFrame();
  annotationInteraction?.onFrame();
  annotationOverlay.onFrame();

  // Camera/interaction work stays per frame; formatting and replacing the HUD
  // text hundreds of times per second adds unnecessary browser work.
  if (now - lastRuntimeTextUpdate < 100) return;
  lastRuntimeTextUpdate = now;
  metricFpsTextElement.textContent = `${fpsSmoothed.toFixed(0)} FPS`;
  const rendered = stats.renderedSegments.toLocaleString();
  const total = stats.totalSegments.toLocaleString();
  const mode = stats.usedCulling ? "culled" : "full";
  const activeBackendLabel = (backendSwitcher?.getActiveBackend() ?? "webgl").toUpperCase();
  const vectorLodStats = formatVectorStrokeLodStats(renderer.getVectorStrokeLodStats?.() ?? null);
  const vectorLodSuffix = vectorLodStats ? ` | ${vectorLodStats}` : "";
  const textLodStats = formatTextLodStats(renderer.getTextLodStats?.() ?? null);
  const textLodSuffix = textLodStats ? ` | text: ${textLodStats}` : "";
  const redundancySuffix = stats.redundantSegments
    ? ` | redundant strokes omitted: ${stats.redundantSegments.toLocaleString()}` : "";
  // Minified pages hold the paint scheduler's coverage margin, which bounds the
  // draw count by letting sub-pixel neighbours swap order.
  const paintOrderSuffix = stats.paintOrderApproximated ? " | paint order: held" : "";
  runtimeTextElement.textContent =
    `Draw ${rendered}/${total} segments | mode: ${mode} | zoom: ${stats.zoom.toFixed(2)}x | backend: ${activeBackendLabel}${vectorLodSuffix}${textLodSuffix}${redundancySuffix}${paintOrderSuffix}`;
}

/** Coalesce worker completions, preserving navigation while replacing the bounded page window. */
function scheduleDemandPdfUpdate(): void {
  demandPdfUpdatePending = true;
  if (demandPdfUpdateTimer !== null || demandPdfUpdateRunning) return;
  demandPdfUpdateTimer = window.setTimeout(() => {
    demandPdfUpdateTimer = null;
    const loader = activePdfPageLoader;
    if (!loader || activePdfPageLoader !== loader || activeSceneLoadToken !== null ||
        pendingSourceLoadCount > 0 || activeHepExportController !== null) return;
    demandPdfUpdatePending = false;
    demandPdfUpdateRunning = true;
    void backendSwitcher!.runWhenIdle(async () => {
      if (activePdfPageLoader !== loader || activeSceneLoadToken !== null || pendingSourceLoadCount > 0 || activeHepExportController !== null) {
        demandPdfUpdatePending = true; return;
      }
      const transitionStarted = performance.now();
      const update = lastParsedScene ? loader.getDisplayUpdate(lastParsedScene) : null;
      if (update && renderer.prepareRasterLayerUpdates) {
        const staged = renderer.prepareRasterLayerUpdatesAsync
          ? await renderer.prepareRasterLayerUpdatesAsync(update.layers) : renderer.prepareRasterLayerUpdates(update.layers);
        try {
          if (activePdfPageLoader !== loader || activeSceneLoadToken !== null || pendingSourceLoadCount > 0) return;
          if (!lastParsedScene || !loader.isDisplayUpdateCurrent(lastParsedScene, update)) {
            demandPdfUpdatePending = true; return;
          }
          staged.commit();
          renderer.setPageRasterVisibility?.(update.rasterPages);
          renderer.recordPerformanceTransition?.("pageSwap.total", performance.now() - transitionStarted);
        } finally { staged.dispose(); }
        return;
      }
      const composeStarted = performance.now();
      const pageScenes = loader.displayPageScenes;
      const composed = composeVectorScenesInGrid(pageScenes, computeAutoPagesPerRow(loader.pageCount));
      renderer.recordPerformanceTransition?.("pageSwap.compose", performance.now() - composeStarted);
      const prepareStarted = performance.now();
      const scene = prepareSceneForHepRendering(composed);
      renderer.recordPerformanceTransition?.("pageSwap.prepareScene", performance.now() - prepareStarted);
      await prebuildTextLod(scene);
      if (activePdfPageLoader !== loader || activeSceneLoadToken !== null || pendingSourceLoadCount > 0) return;
      const started = performance.now();
      const stats = uploadSceneWithRollback(renderer, scene, true, true);
      lastParsedScene = scene;
      loader.bindDisplayScene(scene, pageScenes);
      await layerVisibility.sceneChanged(true);
      if (activePdfPageLoader !== loader || lastParsedScene !== scene) return;
      applyTextSearchScene(scene);
      const initialUpdate = loader.getDisplayUpdate(scene);
      if (initialUpdate && renderer.prepareRasterLayerUpdates) {
        const staged = renderer.prepareRasterLayerUpdatesAsync
          ? await renderer.prepareRasterLayerUpdatesAsync(initialUpdate.layers) : renderer.prepareRasterLayerUpdates(initialUpdate.layers);
        try {
          if (activePdfPageLoader !== loader || lastParsedScene !== scene || activeSceneLoadToken !== null || pendingSourceLoadCount > 0) return;
          if (!loader.isDisplayUpdateCurrent(scene, initialUpdate)) { demandPdfUpdatePending = true; return; }
          staged.commit(); renderer.setPageRasterVisibility?.(initialUpdate.rasterPages);
        } finally { staged.dispose(); }
      }
      renderer.recordPerformanceTransition?.("pageSwap.total", performance.now() - transitionStarted);
      textSearchWidget.setAvailability("ready");
      updateMetricsPanel(lastParsedSceneLabel ?? "PDF", scene, stats, 0, performance.now() - started, null, null);
      setStatus(`${loader.previewCount.toLocaleString()}/${loader.pageCount.toLocaleString()} page previews; ${loader.detailedCount} detailed pages cached. Pages load as you navigate.`);
    }).catch(error => {
      if (activePdfPageLoader === loader) setStatus(`Page display update failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      demandPdfUpdateRunning = false;
      if (demandPdfUpdatePending && activePdfPageLoader && activeSceneLoadToken === null &&
          pendingSourceLoadCount === 0 && activeHepExportController === null) scheduleDemandPdfUpdate();
    });
  }, 100);
}

function initializeRendererCommon(rendererApi: RendererApi): void {
  lastRuntimeTextUpdate = -Infinity;
  drawCallMeter.reset();
  rendererApi.resize();
  rendererApi.setVectorLodMode?.(uiControlManager.readVectorLodModeInput());
  rendererApi.setTextLodMode?.(uiControlManager.readTextLodModeInput());
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
  const { WebGpuFloorplanRenderer } = await import("./webGpuFloorplanRenderer");
  webGpuRendererClass = WebGpuFloorplanRenderer;
  const next = await WebGpuFloorplanRenderer.create(targetCanvas);
  initializeRendererCommon(next);
  return next;
}

renderer = createWebGlRenderer(canvasElement);

let baseStatus = "Waiting for PDF or HEP file...";
type LoadedSourceKind = "pdf" | "hep";

interface LoadedSource {
  kind: LoadedSourceKind;
  bytes: Uint8Array;
  label: string;
}

let lastLoadedSource: LoadedSource | null = null;
let lastLoadedPdfPassword: string | undefined;
let loadedOcrTextOnly = false;
let loadedPageStreaming = false;
let lastParsedSceneLabel: string | null = null;
let captureProfiler: RenderPerformanceProfiler | null = null;
let captureContext: Record<string, unknown> | null = null;
const performanceCapture = {
  start(options: RenderPerformanceOptions = {}): string {
    if (!(renderer instanceof WebGlFloorplanRenderer) && !(webGpuRendererClass && renderer instanceof webGpuRendererClass)) {
      throw new Error("This performance capture supports the native WebGL and WebGPU renderers.");
    }
    captureProfiler?.stop();
    captureProfiler = renderer.getPerformanceProfiler();
    captureContext = {
      document: lastParsedSceneLabel, backend: renderer instanceof WebGlFloorplanRenderer ? "webgl" : "webgpu",
      canvasPixels: [canvasElement.width, canvasElement.height], dpr: window.devicePixelRatio,
      viewAtStart: renderer.getViewState(),
      vectorLod: uiControlManager.readVectorLodModeInput(), textLod: uiControlManager.readTextLodModeInput(),
      drawingSelection: drawingSelection.isEnabled(),
      sourceSegments: lastParsedScene?.segmentCount ?? 0, sourcePaints: lastParsedScene?.drawRuns?.length ?? 0,
      visibleLayers: layerVisibility.getLayers().filter(layer => layer.visible).map(layer => layer.id)
    };
    captureProfiler.start(options);
    renderer.requestFrame();
    return `Capturing up to ${options.maxFrames ?? 600} rendered frames. Pan or zoom, then run heprPerf.stop().`;
  },
  report() {
    if (!captureProfiler) throw new Error("Start a capture with heprPerf.start() first.");
    return { context: captureContext, ...captureProfiler.getReport() };
  },
  stop() {
    captureProfiler?.stop();
    const report = performanceCapture.report();
    console.table({ frameCpu: report.frameCpuMs, frameInterval: report.frameIntervalMs,
      ...report.cpuSections, gpuCommandSpan: report.gpu.frameMs });
    console.table(report.counters);
    console.table(report.transitionSections);
    return report;
  },
  json(): string { return JSON.stringify(performanceCapture.report(), null, 2); }
};
// Temporary, opt-in console diagnostics. Nothing is captured until start().
Object.assign(window, { heprPerf: performanceCapture });
let loadToken = 0;
let activeSceneLoadToken: number | null = null;
let pendingSourceLoadCount = 0;
let sourceLoadSerial = 0;
let sourceLoadController: AbortController | null = null;
let isDropDragActive = false;
let isBatchExampleExportRunning = false;
let activeHepExportController: AbortController | null = null;

const pageQuery = new URLSearchParams(window.location.search);
const bulkHepExportEnabled =
  pageQuery.get("bulkHep") === "1" ||
  pageQuery.get("downloadAllHeps") === "1";

interface ParsedPdfPageCache {
  sourceBytes: Uint8Array;
  sourceLabel: string;
  optionsKey: string;
  pageScenes: VectorScene[];
}

let parsedPdfPageCache: ParsedPdfPageCache | null = null;

interface LoadPdfOptions {
  source: LoadedSource;
  downloadablePdf: PdfDownloadSource | null;
  signal: AbortSignal;
  preserveView?: boolean;
  /** Password for a PDF that requires one; used only while parsing. */
  password?: string;
}

const LOAD_PROGRESS_PARSE_END = 0.34;
const LOAD_PROGRESS_COMPILE = 0.36;
const LOAD_PROGRESS_VECTOR_LOD_START = 0.38;
const LOAD_PROGRESS_VECTOR_LOD_END = 0.66;
const LOAD_PROGRESS_TEXT_LOD_START = LOAD_PROGRESS_VECTOR_LOD_END;
const LOAD_PROGRESS_TEXT_LOD_END = 0.96;
const LOAD_PROGRESS_UPLOAD = 0.98;

type ExampleSelectionKind = "pdf" | "hep";

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
    layerVisibility.rendererChanged();
    // Highlights live in renderer-owned GPU buffers; re-apply after a switch.
    renderer.setSearchHighlights?.(lastSearchHighlights);
    textSelection.refreshHighlights();
    drawingSelection.rendererChanged();
    annotationControls.sceneChanged();
    annotationInteraction?.refresh();
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
    activeHepExportController !== null,
  getSceneSnapshot: () => ({
    scene: lastParsedScene,
    label: lastParsedSceneLabel,
    loadedSourceKind: lastLoadedSource?.kind ?? null
  }),
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
  void downloadHep();
});

downloadPdfButtonElement.addEventListener("click", () => {
  void downloadSourcePdf();
});

downloadAllDataButtonElement.addEventListener("click", () => {
  void downloadAllExampleHeps();
});

window.addEventListener("beforeunload", () => {
  drawCallMeter.dispose();
  annotationInteraction?.dispose();
  drawingSelection.dispose();
  annotationOverlay.dispose();
  linkNavigation.dispose();
  pdfLayerControls.dispose();
  annotationControls.dispose();
  layerVisibility.dispose();
  activeHepExportController?.abort();
  sourceLoadController?.abort();
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
  } else if (isHepFile(file)) {
    await loadHepFile(file);
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
  },
  onTextLodModeChange: (mode) => {
    applyTextLodMode(mode);
  }
});

function applyVectorLodMode(mode: VectorLodMode): void {
  renderer.setVectorLodMode?.(mode);
}

function applyTextLodMode(mode: TextLodMode): void {
  renderer.setTextLodMode?.(mode);
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
  const supported = files.find((file) => isPdfFile(file) || isHepFile(file));

  if (!supported) {
    setStatus("Dropped file is not a supported PDF or HEP file.");
    return;
  }

  if (isPdfFile(supported)) {
    await loadPdfFile(supported);
  } else {
    await loadHepFile(supported);
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
    const hepKey = `${entry.id}:hep`;

    exampleSelectionMap.set(pdfKey, {
      id: entry.id,
      sourceName: entry.name,
      kind: "pdf",
      path: entry.pdfPath,
      pdfPath: entry.pdfPath
    });
    exampleSelectionMap.set(hepKey, {
      id: entry.id,
      sourceName: entry.name,
      kind: "hep",
      path: entry.hepPath,
      pdfPath: entry.pdfPath
    });

    const lodKey = `${entry.id}:hep-lod`;
    if (entry.hepLodPath) exampleSelectionMap.set(lodKey, {
      id: entry.id, sourceName: entry.name, kind: "hep", path: entry.hepLodPath, pdfPath: entry.pdfPath
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
          key: hepKey,
          label: "HEP",
          sizeLabel: formatFileSize(entry.hepSizeBytes),
          title: `Load precomputed HEP data for ${entry.name}`
        },
        ...(entry.hepLodPath ? [{ key: lodKey, label: "HEP+LOD",
          sizeLabel: formatFileSize(entry.hepLodSizeBytes ?? 0),
          title: `Load ${entry.name} with stored vector and text LODs` }] : [])
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

  cancelActiveHepExport();
  const sourceLoadToken = beginSourceLoad();
  const signal = sourceLoadController!.signal;
  exampleDropdown.setDisabled(true);
  try {
    const modeLabel = selection.kind === "pdf" ? "PDF" : "HEP";
    setStatus(`Loading example ${selection.sourceName} (${modeLabel})...`);
    const response = await fetch(selection.path, { cache: "no-store", signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const fileBuffer = await waitForLoad(response.arrayBuffer(), signal);
    if (!isCurrentSourceLoad(sourceLoadToken)) {
      return;
    }
    const bytes = cloneSourceBytes(fileBuffer);
    if (selection.kind === "pdf") {
      await loadPdfBuffer(createParseBuffer(bytes), selection.sourceName, {
        source: { kind: "pdf", bytes, label: selection.sourceName },
        downloadablePdf: { label: selection.sourceName, bytes, url: selection.pdfPath },
        signal,
        preserveView: false
      });
    } else {
      const hepLabel = `${selection.sourceName} (HEP)`;
      await loadHepBuffer(createParseBuffer(bytes), hepLabel, {
        source: { kind: "hep", bytes, label: hepLabel },
        downloadablePdf: { label: selection.sourceName, url: selection.pdfPath },
        signal,
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
    finishSourceLoad(sourceLoadToken);
    if (isCurrentSourceLoad(sourceLoadToken)) exampleDropdown.setDisabled(false);
  }
}

function isPdfFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return file.type === "application/pdf" || lowerName.endsWith(".pdf");
}

function isHepFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith(".hep") ||
    file.type === "application/x-hep" ||
    lowerName.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

async function loadPdfFile(file: File): Promise<void> {
  cancelActiveHepExport();
  const sourceLoadToken = beginSourceLoad();
  const signal = sourceLoadController!.signal;
  try {
    setStatus(`Reading ${file.name}...`);
    const buffer = await waitForLoad(file.arrayBuffer(), signal);
    if (!isCurrentSourceLoad(sourceLoadToken)) {
      return;
    }
    const bytes = cloneSourceBytes(buffer);
    let password: string | undefined;
    for (;;) {
      try {
        await loadPdfBuffer(createParseBuffer(bytes), file.name, {
          source: { kind: "pdf", bytes, label: file.name },
          downloadablePdf: { label: file.name, bytes },
          signal,
          preserveView: false,
          password
        });
        break;
      } catch (error) {
        if (!isPdfPasswordError(error) || signal.aborted || !isCurrentSourceLoad(sourceLoadToken)) throw error;
        setStatus(`${file.name} is password protected.`);
        const answer = await promptForPdfPassword({
          label: file.name,
          retry: error.details.reason === "password-incorrect",
          signal
        });
        if (answer === null) {
          if (isCurrentSourceLoad(sourceLoadToken)) setStatus(`${file.name} was not opened: it needs a password.`);
          return;
        }
        password = answer;
      }
    }
  } catch (error) {
    if (!signal.aborted && isCurrentSourceLoad(sourceLoadToken)) {
      setStatus(`Failed to read PDF: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    finishSourceLoad(sourceLoadToken);
  }
}

async function loadHepFile(file: File): Promise<void> {
  cancelActiveHepExport();
  const sourceLoadToken = beginSourceLoad();
  const signal = sourceLoadController!.signal;
  try {
    setStatus(`Reading ${file.name}...`);
    const buffer = await waitForLoad(file.arrayBuffer(), signal);
    if (!isCurrentSourceLoad(sourceLoadToken)) {
      return;
    }
    const bytes = cloneSourceBytes(buffer);
    await loadHepBuffer(createParseBuffer(bytes), file.name, {
      source: { kind: "hep", bytes, label: file.name },
      downloadablePdf: null,
      signal,
      preserveView: false
    });
  } catch (error) {
    if (!signal.aborted && isCurrentSourceLoad(sourceLoadToken)) {
      setStatus(`Failed to read HEP file: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    finishSourceLoad(sourceLoadToken);
  }
}

async function loadPdfBuffer(buffer: ArrayBuffer, label: string, options: LoadPdfOptions): Promise<void> {
  const activeLoadToken = await backendSwitcher!.runWhenIdle(() => {
    options.signal.throwIfAborted();
    const nextLoadToken = ++loadToken;
    beginSceneLoad(nextLoadToken);
    return nextLoadToken;
  });
  if (activeLoadToken !== loadToken || options.signal.aborted) {
    return;
  }
  const loadStart = performance.now();
  const extractionOptions = getExtractionOptions();
  const streaming = pageStreamingCheckbox!.checked;
  const pageSceneOptionsKey = buildPdfPageCacheKey();
  const cachedPageScenes = getCachedPdfPageScenes(options.source, pageSceneOptionsKey);
  const progress = createLoadProgressReporter((payload) => {
    if (activeLoadToken === loadToken) {
      updateParsingLoaderProgress(payload);
    }
  });
  let demandLoader: PdfPageDemandLoader | null = null;

  try {
    let scene: VectorScene;
    let parsedPages: VectorScene[] | null = null;
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
        `Parsing ${label}... (merge ${extractionOptions.enableSegmentMerge ? "on" : "off"}, cull ${extractionOptions.enableInvisibleCull ? "on" : "off"})`
      );
      const candidate = await openPdfPageDemand(buffer, { ...extractionOptions, password: options.password,
        onProgress: progress.child(0, LOAD_PROGRESS_PARSE_END, { sourceType: "pdf" }).toCallback() },
        scheduleDemandPdfUpdate, options.signal);
      let pageScenes: VectorScene[];
      if (streaming && candidate.pageCount > 16) {
        demandLoader = candidate;
        pageScenes = candidate.displayPageScenes;
      } else {
        try {
          await candidate.loadInitialOverviews(options.signal, !streaming);
          pageScenes = candidate.displayPageScenes;
          if (candidate.requiresPageDemand) demandLoader = candidate;
          else await candidate.close();
        } catch (error) { await candidate.close(); throw error; }
      }
      parseMs = performance.now() - parseStart;

      if (activeLoadToken === loadToken) {
        progress.report(LOAD_PROGRESS_COMPILE, { stage: "compile", sourceType: "pdf" });
      }

      if (activeLoadToken !== loadToken) {
        return;
      }

      const pagesPerRow = computeAutoPagesPerRow(pageScenes.length);
      scene = composeVectorScenesInGrid(pageScenes, pagesPerRow);
      parsedPages = demandLoader ? null : pageScenes;
      console.log(
        `[Page grid] ${label}: parsed ${pageScenes.length.toLocaleString()} pages in ${parseMs.toFixed(1)} ms, arranged ${pagesPerRow.toLocaleString()}/row`
      );
    }

    if (activeLoadToken !== loadToken) {
      return;
    }

    scene = prepareSceneForHepRendering(scene);
    demandLoader?.bindDisplayScene(scene);
    const rasterLayerCount = listSceneRasterLayers(scene).length;
    const hasRasterLayer = rasterLayerCount > 0;
    if (scene.segmentCount === 0 && scene.textInstanceCount === 0 && scene.fillPathCount === 0 && !hasRasterLayer && !demandLoader && !extractionOptions.ocrTextOnly) {
      setParsingLoader(false);
      setStatus(`No visible geometry was extracted from ${label}.`);
      return;
    }

    setStatus(
      `Building LOD / GPU data for ${scene.segmentCount.toLocaleString()} segments, ${scene.textInstanceCount.toLocaleString()} text instances${hasRasterLayer ? `, ${rasterLayerCount.toLocaleString()} raster layer${rasterLayerCount === 1 ? "" : "s"}` : ""}...`
    );
    const prebuildLodTiming = await prebuildVectorLodForScene(scene, progress, "pdf", activeLoadToken, options.signal);
    await prebuildTextLodForScene(scene, progress, "pdf", activeLoadToken, options.signal);
    if (activeLoadToken !== loadToken) {
      return;
    }
    progress.report(LOAD_PROGRESS_UPLOAD, { stage: "upload", sourceType: "pdf" });
    // The scene upload below runs synchronously. Paint its stage first, so a
    // slow device does not appear stuck at the end of Vector LOD.
    await yieldAfterPaint(options.signal);
    if (activeLoadToken !== loadToken) {
      return;
    }
    const uploadStart = performance.now();
    const targetRenderer = renderer;
    options.signal.throwIfAborted();
    const sceneStats = uploadSceneWithRollback(targetRenderer, scene, options.preserveView);
    const fallbackLodTiming = consumeVectorStrokeLodBuildTiming();
    const lodTiming = combineVectorLodTimings(prebuildLodTiming, fallbackLodTiming);
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
    lastParsedSceneLabel = label;
    commitLoadedSource(options, extractionOptions.ocrTextOnly === true, streaming);
    const previousPageLoader = activePdfPageLoader;
    activePdfPageLoader = demandLoader;
    activePdfPageLoader?.setPerformanceListener((name, ms) => renderer.recordPerformanceTransition?.(name, ms));
    demandLoader = null;
    void previousPageLoader?.close();
    if (activePdfPageLoader) parsedPdfPageCache = null;
    if (parsedPages) storeCachedPdfPageScenes(options.source, pageSceneOptionsKey, parsedPages);
    applyTextSearchScene(scene);
    if (activePdfPageLoader) textSearchWidget.setAvailability("ready");
    refreshDropIndicator();
    setDownloadDataButtonState(true);

    updateMetricsPanel(label, scene, sceneStats, parseMs, uploadMs, lodTiming, performance.now() - loadStart);
    if (extractionOptions.ocrTextOnly) setStatus("Text-only view: pictures and diagrams are omitted. Pages without stored text are blank.");
    else clearLoadedStatus();
  } catch (error) {
    if (activeLoadToken !== loadToken || options.signal.aborted) {
      return;
    }

    setParsingLoader(false);
    // The caller owns the password prompt and loads again.
    if (isPdfPasswordError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to render PDF: ${message}`);
  } finally {
    await demandLoader?.close();
    finishSceneLoad(activeLoadToken);
  }
}

async function loadHepBuffer(buffer: ArrayBuffer, label: string, options: LoadPdfOptions): Promise<void> {
  const activeLoadToken = await backendSwitcher!.runWhenIdle(() => {
    options.signal.throwIfAborted();
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
    const scene = await loadSceneFromHep(buffer, {
      signal: options.signal,
      onProgress: progress.child(0, LOAD_PROGRESS_PARSE_END, { sourceType: "hep" }).toCallback()
    });
    const parseEnd = performance.now();

    if (activeLoadToken === loadToken) {
      progress.report(LOAD_PROGRESS_VECTOR_LOD_START, {
        stage: hasStoredVectorStrokeLod(scene) ? "vector-lod-restore" : "vector-lod", sourceType: "hep"
      });
    }

    if (activeLoadToken !== loadToken) {
      return;
    }

    const rasterLayerCount = listSceneRasterLayers(scene).length;
    const hasRasterLayer = rasterLayerCount > 0;
    if (scene.segmentCount === 0 && scene.textInstanceCount === 0 && scene.fillPathCount === 0 && !hasRasterLayer) {
      setParsingLoader(false);
      setStatus(`No visible geometry was found in ${label}.`);
      return;
    }

    setStatus(
      `Preparing LOD / GPU data for ${scene.segmentCount.toLocaleString()} segments, ${scene.textInstanceCount.toLocaleString()} text instances${hasRasterLayer ? `, ${rasterLayerCount.toLocaleString()} raster layer${rasterLayerCount === 1 ? "" : "s"}` : ""}...`
    );
    const prebuildLodTiming = await prebuildVectorLodForScene(scene, progress, "hep", activeLoadToken, options.signal);
    await prebuildTextLodForScene(scene, progress, "hep", activeLoadToken, options.signal);
    if (activeLoadToken !== loadToken) {
      return;
    }
    progress.report(LOAD_PROGRESS_UPLOAD, { stage: "upload", sourceType: "hep" });
    // The scene upload below runs synchronously. Paint its stage first, so a
    // slow device does not appear stuck at the end of Vector LOD.
    await yieldAfterPaint(options.signal);
    if (activeLoadToken !== loadToken) {
      return;
    }
    const uploadStart = performance.now();
    const targetRenderer = renderer;
    options.signal.throwIfAborted();
    const sceneStats = uploadSceneWithRollback(targetRenderer, scene, options.preserveView);
    const fallbackLodTiming = consumeVectorStrokeLodBuildTiming();
    const lodTiming = combineVectorLodTimings(prebuildLodTiming, fallbackLodTiming);
    const uploadEnd = performance.now();
    const uploadMs = Math.max(0, uploadEnd - uploadStart - fallbackLodTiming.elapsedMs);
    progress.complete({ sourceType: "hep" });
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
    lastParsedSceneLabel = label;
    commitLoadedSource(options);
    const previousPageLoader = activePdfPageLoader;
    activePdfPageLoader = null;
    void previousPageLoader?.close();
    parsedPdfPageCache = null;
    applyTextSearchScene(scene);
    refreshDropIndicator();
    setDownloadDataButtonState(true);

    updateMetricsPanel(label, scene, sceneStats, parseEnd - parseStart, uploadMs, lodTiming, performance.now() - loadStart);
    clearLoadedStatus();
  } catch (error) {
    if (activeLoadToken !== loadToken || options.signal.aborted) {
      return;
    }

    setParsingLoader(false);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load HEP file: ${message}`);
  } finally {
    finishSceneLoad(activeLoadToken);
  }
}

function commitLoadedSource(options: LoadPdfOptions, ocrTextOnly = false, streaming = false): void {
  lastLoadedSource = options.source;
  lastLoadedPdfPassword = options.source.kind === "pdf" ? options.password : undefined;
  loadedOcrTextOnly = options.source.kind === "pdf" && ocrTextOnly;
  ocrTextCheckbox!.checked = loadedOcrTextOnly;
  ocrTextCheckbox!.disabled = options.source.kind !== "pdf";
  loadedPageStreaming = options.source.kind === "pdf" && streaming;
  pageStreamingCheckbox!.checked = loadedPageStreaming;
  pageStreamingCheckbox!.disabled = options.source.kind !== "pdf";
  lastDownloadablePdf = options.downloadablePdf;
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
}

function uploadSceneWithRollback(target: RendererApi, scene: VectorScene, preserveView?: boolean,
  preserveRasterResolution = false): SceneStats {
  lastRuntimeTextUpdate = -Infinity;
  const previousScene = lastParsedScene;
  const previousView = target.getViewState();
  try {
    const stats = target.setScene(scene, { preserveRasterResolution });
    if (!preserveView) target.fitToBounds(resolveSceneFitBounds(scene), 64);
    return stats;
  } catch (error) {
    try {
      if (previousScene) target.setScene(previousScene, { preserveRasterResolution: true });
      target.setViewState(previousView);
      if (target === renderer) {
        drawingSelection.rendererChanged();
        annotationInteraction?.refresh();
      }
    } catch (restoreError) {
      console.warn("[HEPR] Failed to restore the previous scene after an upload error.", restoreError);
    }
    throw error;
  }
}

function getExtractionOptions(): VectorExtractOptions {
  return {
    ocrTextOnly: ocrTextCheckbox!.checked,
    enableSegmentMerge: true,
    enableInvisibleCull: true
  };
}

function buildPdfPageCacheKey(): string {
  return `merge:1|cull:1|ocr:${ocrTextCheckbox!.checked ? 1 : 0}|stream:${pageStreamingCheckbox!.checked ? 1 : 0}`;
}

async function reloadPdfViewingOptions(): Promise<void> {
  const source = lastLoadedSource;
  if (source?.kind !== "pdf") return;
  cancelActiveHepExport();
  const sourceLoadToken = beginSourceLoad();
  ocrTextCheckbox!.disabled = true;
  pageStreamingCheckbox!.disabled = true;
  try {
    await loadPdfBuffer(createParseBuffer(source.bytes), source.label, {
      source, downloadablePdf: lastDownloadablePdf, signal: sourceLoadController!.signal,
      preserveView: true, password: lastLoadedPdfPassword
    });
  } catch (error) {
    if (isCurrentSourceLoad(sourceLoadToken) && !sourceLoadController?.signal.aborted) {
      setStatus(`Failed to change PDF view: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    finishSourceLoad(sourceLoadToken);
    if (isCurrentSourceLoad(sourceLoadToken)) {
      ocrTextCheckbox!.checked = loadedOcrTextOnly;
      ocrTextCheckbox!.disabled = lastLoadedSource?.kind !== "pdf";
      pageStreamingCheckbox!.checked = loadedPageStreaming;
      pageStreamingCheckbox!.disabled = lastLoadedSource?.kind !== "pdf";
    }
  }
}

function getCachedPdfPageScenes(source: LoadedSource, optionsKey: string): VectorScene[] | null {
  if (source.kind !== "pdf" || !parsedPdfPageCache) {
    return null;
  }
  if (parsedPdfPageCache.sourceBytes !== source.bytes) {
    return null;
  }
  if (parsedPdfPageCache.sourceLabel !== source.label) {
    return null;
  }
  if (parsedPdfPageCache.optionsKey !== optionsKey) {
    return null;
  }
  return parsedPdfPageCache.pageScenes;
}

function storeCachedPdfPageScenes(source: LoadedSource, optionsKey: string, pageScenes: VectorScene[]): void {
  parsedPdfPageCache = {
    sourceBytes: source.bytes,
    sourceLabel: source.label,
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
  sourceLoadController?.abort();
  sourceLoadController = new AbortController();
  // Invalidate parsing/LOD immediately, even while the next source is reading.
  loadToken += 1;
  pendingSourceLoadCount += 1;
  sourceLoadSerial += 1;
  updateBackendSelectDisabledState();
  return sourceLoadSerial;
}

function isCurrentSourceLoad(token: number): boolean {
  return token === sourceLoadSerial;
}

function finishSourceLoad(token: number): void {
  pendingSourceLoadCount = Math.max(0, pendingSourceLoadCount - 1);
  if (isCurrentSourceLoad(token)) {
    sourceLoadController = null;
    setParsingLoader(false);
    exampleDropdown.setDisabled(false);
    setDownloadDataButtonState(Boolean(lastParsedScene && lastParsedSceneLabel));
    setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
  }
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
  ocrTextCheckbox!.disabled = pendingSourceLoadCount > 0 || activeSceneLoadToken !== null ||
    activeHepExportController !== null || lastLoadedSource?.kind === "hep";
  pageStreamingCheckbox!.disabled = ocrTextCheckbox!.disabled;
  backendSelectElement.disabled =
    pendingSourceLoadCount > 0 ||
    activeSceneLoadToken !== null ||
    activeHepExportController !== null;
  if (activePdfPageLoader) {
    if (pendingSourceLoadCount > 0 || activeSceneLoadToken !== null || activeHepExportController !== null) activePdfPageLoader.pause();
    else {
      activePdfPageLoader.resume();
      if (demandPdfUpdatePending) scheduleDemandPdfUpdate();
    }
  }
}

function updateParsingLoaderProgress(progress: PDFLoadProgress): void {
  const stageLabel = formatLoadProgressStage(progress.stage);
  const value = Math.max(0, Math.min(1, Number(progress.value) || 0));
  setParsingLoader(true, `${(value * 100).toFixed(2)}% ${stageLabel}`);
}

async function prebuildVectorLodForScene(
  scene: VectorScene,
  progress: ReturnType<typeof createLoadProgressReporter>,
  sourceType: "pdf" | "hep",
  activeLoadToken: number,
  signal?: AbortSignal
): Promise<VectorStrokeLodBuildTiming> {
  resetVectorStrokeLodBuildTiming();
  const vectorLodStage = hasStoredVectorStrokeLod(scene) ? "vector-lod-restore" : "vector-lod";
  progress.report(LOAD_PROGRESS_VECTOR_LOD_START, { stage: vectorLodStage, sourceType });
  await prebuildVectorStrokeLodRuntime(
    scene,
    uiControlManager.readVectorLodModeInput(),
    backendSwitcher?.getActiveBackend() ?? "webgl",
    {
      yieldIntervalMs: 50,
      signal,
      shouldCancel: () => activeLoadToken !== loadToken || signal?.aborted === true,
      onProgress: (lodProgress) => {
        if (activeLoadToken !== loadToken) {
          return;
        }
        const value =
          LOAD_PROGRESS_VECTOR_LOD_START +
          lodProgress.value * (LOAD_PROGRESS_VECTOR_LOD_END - LOAD_PROGRESS_VECTOR_LOD_START);
        progress.report(value, { stage: vectorLodStage, sourceType });
      }
    }
  );
  return consumeVectorStrokeLodBuildTiming();
}

async function prebuildTextLodForScene(
  scene: VectorScene,
  progress: ReturnType<typeof createLoadProgressReporter>,
  sourceType: "pdf" | "hep",
  activeLoadToken: number,
  signal?: AbortSignal
): Promise<void> {
  progress.report(LOAD_PROGRESS_TEXT_LOD_START, { stage: "text-lod", sourceType });
  if (uiControlManager.readTextLodModeInput() === "off") {
    progress.report(LOAD_PROGRESS_TEXT_LOD_END, { stage: "text-lod", sourceType });
    return;
  }
  await prebuildTextLod(scene, {
    yieldIntervalMs: 50,
    signal,
    shouldCancel: () => activeLoadToken !== loadToken,
    onProgress: (lodProgress) => {
      if (activeLoadToken !== loadToken) {
        return;
      }
      const value =
        LOAD_PROGRESS_TEXT_LOD_START +
        lodProgress.value * (LOAD_PROGRESS_TEXT_LOD_END - LOAD_PROGRESS_TEXT_LOD_START);
      progress.report(value, { stage: "text-lod", sourceType });
    }
  });
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
  downloadDataButtonElement.textContent = isBusy ? "Preparing HEP..." : "Download HEP";
}

function setDownloadPdfButtonState(hasPdf: boolean, isBusy = false): void {
  downloadPdfButtonElement.hidden = !hasPdf;
  downloadPdfButtonElement.disabled =
    !hasPdf ||
    pendingSourceLoadCount > 0 ||
    isBusy ||
    isBatchExampleExportRunning ||
    activeHepExportController !== null;
  downloadPdfButtonElement.textContent = isBusy ? "Preparing PDF..." : "Download PDF";
}

function setDownloadAllDataButtonState(hasExamples: boolean, isBusy = false, progressText?: string): void {
  downloadAllDataButtonElement.hidden = !bulkHepExportEnabled;
  downloadAllDataButtonElement.disabled = !bulkHepExportEnabled || !hasExamples || isBusy;
  downloadAllDataButtonElement.textContent = isBusy
    ? progressText ?? "Exporting Example HEP Files..."
    : "Download All Example HEP Files";
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

async function downloadAllExampleHeps(): Promise<void> {
  if (
    !bulkHepExportEnabled ||
    isBatchExampleExportRunning ||
    activeHepExportController !== null ||
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
  activeHepExportController = exportController;
  setPrimaryLoadControlsEnabled(false);
  updateBackendSelectDisabledState();
  setDownloadDataButtonState(Boolean(lastParsedScene && lastParsedSceneLabel), false);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
  setDownloadAllDataButtonState(true, true, `Exporting 0/${pdfEntries.length}...`);
  setParsingLoader(true, "0.00% Preparing HEP export...");

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
      const hepBlob = await buildHep(bytes, {
        sourceLabel: entry.name,
        signal: exportController.signal,
        onProgress: (progress) => {
          if (activeHepExportController !== exportController) {
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
      const hepFileName = `${sanitizeDownloadName(entry.name)}-parsed-data.hep`;
      setStatus(`Batch ${step}/${pdfEntries.length}: downloading ${entry.name} HEP file...`);
      triggerBrowserDownload(hepBlob, hepFileName);
      await delayMilliseconds(200);
    }

    if (activeHepExportController === exportController) {
      setStatus(`Batch export complete: ${pdfEntries.length.toLocaleString()} HEP files downloaded.`);
    }
  } catch (error) {
    if (activeHepExportController === exportController) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Batch export failed: ${message}`);
    }
  } finally {
    const ownsExportUi = activeHepExportController === exportController;
    if (ownsExportUi) {
      activeHepExportController = null;
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

async function downloadHep(): Promise<boolean> {
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
  if (activeHepExportController !== null) {
    return false;
  }

  const scene = lastParsedScene;
  const label = lastParsedSceneLabel;

  const previousStatusText = statusTextElement.textContent;

  const exportController = new AbortController();
  activeHepExportController = exportController;
  setDownloadDataButtonState(true, true);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
  setDownloadAllDataButtonState(exampleManifestEntries.length > 0, true, "Export in progress...");
  setPrimaryLoadControlsEnabled(false);
  updateBackendSelectDisabledState();
  statusTextElement.hidden = false;
  statusTextElement.textContent = "Preparing HEP data...";
  setParsingLoader(true, "0.00% Preparing HEP export...");

  try {
    const lodOptions = await promptForHepLod(scene, exportController.signal);
    if (!lodOptions) {
      if (activeHepExportController === exportController) {
        statusTextElement.textContent = previousStatusText;
        statusTextElement.hidden = !previousStatusText?.trim();
      }
      return false;
    }
    await yieldToBrowserPaint();
    const buildOptions = {
      ...lodOptions,
      sourceLabel: label,
      sourcePdfByteLength: lastLoadedSource?.kind === "pdf" ? lastLoadedSource.bytes.byteLength : undefined,
      signal: exportController.signal,
      onProgress: (progress: import("./loadProgress").PDFLoadProgress) => {
        if (activeHepExportController === exportController) {
          updateParsingLoaderProgress(progress);
        }
      }
    };
    // Page windows and text-only views are approximations; export the complete original PDF.
    const hepBlob = (activePdfPageLoader || loadedOcrTextOnly) && lastLoadedSource?.kind === "pdf"
      ? await buildHep(lastLoadedSource.bytes, { ...buildOptions, password: lastLoadedPdfPassword,
        maxPagesPerRow: scene.pagesPerRow })
      : await buildHep(scene, buildOptions);

    if (activeHepExportController !== exportController) {
      return false;
    }

    const hepFileName = `${sanitizeDownloadName(label)}-parsed-data${lodOptions.withVectorLod || lodOptions.withTextLod ? "-lod" : ""}.hep`;
    triggerBrowserDownload(hepBlob, hepFileName);
    console.log(
      `[Parsed data export] ${label}: wrote ${hepFileName} (${formatFileSize(hepBlob.size)})`
    );
    const restoredStatus = previousStatusText || baseStatus;
    statusTextElement.textContent = restoredStatus;
    statusTextElement.hidden = restoredStatus.trim().length === 0;
    return true;
  } catch (error) {
    if (activeHepExportController === exportController) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to download parsed data: ${message}`);
    }
    return false;
  } finally {
    if (activeHepExportController === exportController) {
      activeHepExportController = null;
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
  const withoutFormatLabel = label.replace(/\s*\((?:hep|parsed zip)\)\s*$/i, "");
  const isParsedDataFile = /\.(?:hep|zip)$/i.test(withoutFormatLabel);
  const withoutExtension = withoutFormatLabel.replace(/\.(?:pdf|hep|zip)$/i, "");
  const withoutParsedDataSuffix = isParsedDataFile
    ? withoutExtension.replace(/[._-]?parsed[._-]?data$/i, "")
    : withoutExtension;
  const normalized = withoutParsedDataSuffix.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
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

function cancelActiveHepExport(): void {
  const controller = activeHepExportController;
  if (!controller) {
    return;
  }
  activeHepExportController = null;
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
  const textureUtilization = computeTextureAreaUtilizationPercent(
    sceneStats.textureWidth,
    sceneStats.textureHeight,
    sceneStats.maxTextureSize
  );
  const rasterSummary = formatRasterLayerSummary(scene);

  metricFileTextElement.textContent = label;
  metricSourceSegmentsTextElement.textContent = sourceSegments.toLocaleString();
  metricMergedSegmentsTextElement.textContent = `${mergedSegments.toLocaleString()} (${formatPercent(mergeReduction)} reduction)`;
  metricVisibleSegmentsTextElement.textContent =
    `${visibleSegments.toLocaleString()}, fills ${fillPaths.toLocaleString()}, text ${scene.textInstanceCount.toLocaleString()} instances (${scene.textGlyphCount.toLocaleString()} glyphs / ${scene.textGlyphSegmentCount.toLocaleString()} glyph segments), pages ${scene.pageCount.toLocaleString()} (${scene.pagesPerRow.toLocaleString()}/row)`;
  metricReductionsTextElement.textContent = formatSceneSegmentAccounting(scene);
  metricCullDiscardsTextElement.textContent = getSceneSegmentAccounting(scene).culled === null
    ? "Unavailable in this scene / HEP metadata"
    : `transparent ${scene.discardedTransparentCount.toLocaleString()}, degenerate ${scene.discardedDegenerateCount.toLocaleString()}, duplicates ${scene.discardedDuplicateCount.toLocaleString()}, contained ${scene.discardedContainedCount.toLocaleString()}`;
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


function updateFpsMetric(now: number): void {
  if (fpsLastSampleTime > 0) {
    const deltaMs = now - fpsLastSampleTime;
    if (deltaMs > 0) {
      const fpsNow = 1000 / deltaMs;
      fpsSmoothed = fpsSmoothed === 0 ? fpsNow : fpsSmoothed * 0.85 + fpsNow * 0.15;
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

  console.log(
    `[Stroke accounting] ${label}: ${formatSceneSegmentAccounting(scene)}; ` +
    `${scene.segmentCount.toLocaleString()} emitted vector segments`
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
