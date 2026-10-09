import { hasSelectedHepLod, promptForHepLod } from "./hepLodPrompt";
import { resolveHepLodOptions } from "./hepLodOptions";
import { createThreeLinkNavigation } from "./threeLinkNavigation";
import { createAnnotationOverlay } from "./annotationOverlay";
import { createAnnotationInteractionController, type AnnotationInteractionController } from "./annotationInteraction";
import { createThreeAnnotationInteractionAdapter } from "./threeAnnotationInteraction";
import * as THREE from "three";
import { waitForLoad } from "./loadCancellation";
import { warmViewerRendering } from "./viewerRenderWarmup";
import { WebGPURenderer } from "three/webgpu";
import { MapControls } from "three/addons/controls/MapControls.js";

import {
  buildHep,
  isPdfPasswordError,
  createPdfAnnotationControls,
  createThreePrimitiveInteractionController,
  createThreePdfLayerControls,
  createTextSelectionController,
  pdfObjectGenerator,
  prebuildTextLod,
  consumeVectorStrokeLodBuildTiming,
  resetVectorStrokeLodBuildTiming,
  type HeprRendererType,
  type HeprTextSearchMatch,
  type HeprThreeObjectOptions,
  type HeprThreePdfObject,
  type TextLodMode,
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
import { createExampleDropdown, type ExampleDropdownItem } from "./exampleDropdown";
import { createDrawingSelectionControls } from "./drawingSelectionControls";
import { promptForPdfPassword } from "./pdfPasswordPrompt";
import {
  applyExamplePageLayout,
  computeExamplePageLayout,
  interpolateExamplePageLayout,
  ExamplePageLayoutAnimator,
  type ExamplePageLayout,
  type ExamplePageLayoutPage,
  type ExamplePageLayoutTarget
} from "./examplePageLayouts";
import { createThreePdfObject } from "./threePdfObject";
import { hasStoredVectorStrokeLod, reserveVectorStrokeLodRuntime, type VectorStrokeLodRuntimeReservation } from "./vectorStrokeLodCore";
import { formatLoadProgressStage } from "./loadProgress";
import { formatVectorStrokeLodStats } from "./vectorStrokeLodStatsFormat";
import { formatTextLodStats } from "./textLodStatsFormat";
import { createDrawCallMeter, createThreeDrawCallCounter } from "./drawCallMetrics";
import { RenderPerformanceProfiler, type RenderPerformanceOptions } from "./renderPerformance";
import { ThreeWebGpuFrameTimer } from "./threeWebGpuFrameTimer";
import { describeThreePerformanceCamera, describeThreePerformanceScene, instrumentThreeWebGlCalls, withThreeRenderPerformance } from "./threeRenderPerformance";
import {
  filenameFromUrl,
  formatPdfDownloadFilename,
  readPdfDownloadBlob,
  triggerBrowserDownload,
  type PdfDownloadSource
} from "./downloadUtils";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const panel = document.querySelector<HTMLDivElement>("#panel");
const togglePanelButton = document.querySelector<HTMLButtonElement>("#toggle-panel");
const togglePanelIcon = document.querySelector<HTMLSpanElement>("#toggle-panel-icon");
const openButton = document.querySelector<HTMLButtonElement>("#open-file");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const exampleDropdownContainer = document.querySelector<HTMLDivElement>("#example-dropdown");
const exampleSelect = document.querySelector<HTMLButtonElement>("#example-select");
const exampleSelectLabel = document.querySelector<HTMLSpanElement>("#example-select-label");
const exampleMenu = document.querySelector<HTMLDivElement>("#example-menu");
const downloadDataButton = document.querySelector<HTMLButtonElement>("#download-data");
const downloadPdfButton = document.querySelector<HTMLButtonElement>("#download-pdf");
const backendSelect = document.querySelector<HTMLSelectElement>("#backend-select");
const vectorLodSelect = document.querySelector<HTMLSelectElement>("#vector-lod-select");
const textLodSelect = document.querySelector<HTMLSelectElement>("#text-lod-select");
const touchRotateCheckbox = document.querySelector<HTMLInputElement>("#touch-rotate-checkbox");
const textSelectionCheckbox = document.querySelector<HTMLInputElement>("#text-selection-checkbox");
const ocrTextCheckbox = document.querySelector<HTMLInputElement>("#ocr-text-checkbox");
const pageStreamingCheckbox = document.querySelector<HTMLInputElement>("#page-streaming-checkbox");
const compressScansCheckbox = document.querySelector<HTMLInputElement>("#compress-scans-checkbox");
const drawingSelectionContainer = document.querySelector<HTMLDivElement>("#drawing-selection");
const pdfLayersContainer = document.querySelector<HTMLDivElement>("#pdf-layers");
const pdfAnnotationsContainer = document.querySelector<HTMLDivElement>("#pdf-annotations");
const touchRotateRow = document.querySelector<HTMLElement>("#touch-rotate-row");
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
const zoomValue = document.querySelector<HTMLSpanElement>("#zoom-value");
const drawCallsValue = document.querySelector<HTMLSpanElement>("#draw-calls-value");
const drawStatsValue = document.querySelector<HTMLSpanElement>("#draw-stats-value");
const lodStatsValue = document.querySelector<HTMLSpanElement>("#lod-stats-value");
const textLodStatsValue = document.querySelector<HTMLSpanElement>("#text-lod-stats-value");
const dropIndicator = document.querySelector<HTMLDivElement>("#drop-indicator");
const textSearchInput = document.querySelector<HTMLInputElement>("#text-search-input");
const textSearchCount = document.querySelector<HTMLSpanElement>("#text-search-count");
const textSearchPrevButton = document.querySelector<HTMLButtonElement>("#text-search-prev");
const textSearchNextButton = document.querySelector<HTMLButtonElement>("#text-search-next");
const textSearchCaseButton = document.querySelector<HTMLButtonElement>("#text-search-case");
const pageLayoutRow = document.querySelector<HTMLDivElement>("#page-layout-row");
const pageLayoutProgress = document.querySelector<HTMLSpanElement>("#page-layout-progress");
const pageLayoutProgressBar = document.querySelector<HTMLProgressElement>("#page-layout-progress-bar");
const pageLayoutProgressText = document.querySelector<HTMLSpanElement>("#page-layout-progress-text");
const pageLayoutButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#page-layout-row button[data-page-layout]"));

if (
  !canvas ||
  !panel ||
  !togglePanelButton ||
  !togglePanelIcon ||
  !openButton ||
  !fileInput ||
  !exampleDropdownContainer ||
  !exampleSelect ||
  !exampleSelectLabel ||
  !exampleMenu ||
  !downloadDataButton ||
  !downloadPdfButton ||
  !backendSelect ||
  !vectorLodSelect ||
  !textLodSelect ||
  !touchRotateCheckbox ||
  !textSelectionCheckbox ||
  !ocrTextCheckbox ||
  !pageStreamingCheckbox ||
  !compressScansCheckbox ||
  !drawingSelectionContainer ||
  !pdfLayersContainer ||
  !pdfAnnotationsContainer ||
  !touchRotateRow ||
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
  !zoomValue ||
  !drawCallsValue ||
  !drawStatsValue ||
  !lodStatsValue ||
  !textLodStatsValue ||
  !dropIndicator ||
  !textSearchInput ||
  !textSearchCount ||
  !textSearchPrevButton ||
  !textSearchNextButton ||
  !textSearchCaseButton ||
  !pageLayoutRow ||
  !pageLayoutProgress ||
  !pageLayoutProgressBar ||
  !pageLayoutProgressText
) {
  throw new Error("Three example UI is missing required DOM elements.");
}

let canvasElement = canvas;
const panelElement = panel;
const togglePanelButtonElement = togglePanelButton;
const togglePanelIconElement = togglePanelIcon;
const openButtonElement = openButton;
const fileInputElement = fileInput;
const downloadDataButtonElement = downloadDataButton;
const downloadPdfButtonElement = downloadPdfButton;
const backendSelectElement = backendSelect;
const vectorLodSelectElement = vectorLodSelect;
const textLodSelectElement = textLodSelect;
const touchRotateCheckboxElement = touchRotateCheckbox;
const textSelectionCheckboxElement = textSelectionCheckbox;
const ocrTextCheckboxElement = ocrTextCheckbox;
const pageStreamingCheckboxElement = pageStreamingCheckbox;
const compressScansCheckboxElement = compressScansCheckbox;
let loadedCompressScansPreference = compressScansCheckboxElement.checked;
const touchRotateRowElement = touchRotateRow;
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
const zoomValueElement = zoomValue;
const drawStatsValueElement = drawStatsValue;
const lodStatsValueElement = lodStatsValue;
const textLodStatsValueElement = textLodStatsValue;
const dropIndicatorElement = dropIndicator;
const textSearchInputElement = textSearchInput;
const textSearchCountElement = textSearchCount;
const textSearchPrevButtonElement = textSearchPrevButton;
const textSearchNextButtonElement = textSearchNextButton;
const textSearchCaseButtonElement = textSearchCaseButton;
const pageLayoutRowElement = pageLayoutRow;
const pageLayoutProgressElement = pageLayoutProgress;
const pageLayoutProgressBarElement = pageLayoutProgressBar;
const pageLayoutProgressTextElement = pageLayoutProgressText;
const lifetimeAbortController = new AbortController();
const lifetimeSignal = lifetimeAbortController.signal;
const drawCallMeter = createDrawCallMeter(drawCallsValue, { signal: lifetimeSignal });
const drawCallCounter = createThreeDrawCallCounter();
let loadToken = 0;
let sourceLoadController: AbortController | null = null;
const CAMERA_FIT_PADDING_PIXELS = 64;
const MIN_OBJECT_EXTENT = 1e-3;
const DEFAULT_PERSPECTIVE_FOV_DEGREES = 45;
const CAMERA_CLIP_NEAR_MIN = 0.01;
const CAMERA_CLIP_MARGIN_MULTIPLIER = 3.5;
const CAMERA_CLIP_UPDATE_EPSILON = 1e-3;
const PAGE_LAYOUT_DURATION_MS = 2000;
/** Sub-pixel first step of a transition, rendered once to warm page batches. */
const PAGE_LAYOUT_WARM_UP_PROGRESS = 1e-3;
const NATIVE_CLEAR_COLOR_R = 160 / 255;
const NATIVE_CLEAR_COLOR_G = 169 / 255;
const NATIVE_CLEAR_COLOR_B = 175 / 255;
const tempObjectBounds = new THREE.Box3();
const tempObjectSize = new THREE.Vector3();
const tempObjectCenter = new THREE.Vector3();
const tempViewDirection = new THREE.Vector3();
const tempClipDelta = new THREE.Vector3();
const tempClipForward = new THREE.Vector3();
const tempPageMatrix = new THREE.Matrix4();
const unitScale = new THREE.Vector3(1, 1, 1);
const currentContentCenter = new THREE.Vector3();
let currentContentRadius = 10;

interface CameraSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  up: THREE.Vector3;
  target: THREE.Vector3;
  clipCenter: THREE.Vector3;
  clipRadius: number;
}

type ThreeExampleRenderer = THREE.WebGLRenderer | WebGPURenderer;
interface PreparedThreeRendererBackend {
  backend: HeprRendererType;
  canvas: HTMLCanvasElement;
  renderer: ThreeExampleRenderer;
}
type WebGpuRendererParametersWithCanvas = ConstructorParameters<typeof WebGPURenderer>[0] & {
  canvas: HTMLCanvasElement;
};

let activeThreeRendererBackend: HeprRendererType = "webgl";
let renderer: ThreeExampleRenderer = createWebGlThreeRenderer(canvasElement);
const manuallyDrivenThreeRenderers = new WeakSet<ThreeExampleRenderer>();

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

let controls = createMapControls();

let currentPdfObject: HeprThreePdfObject | null = null;

/** Page views of the current document, prepared once it first leaves the grid. */
interface PageLayoutView {
  object: HeprThreePdfObject;
  pages: readonly HeprThreePdfObject[];
  layoutPages: ExamplePageLayoutPage[];
  layout: ExamplePageLayout;
  targets: ExamplePageLayoutTarget[];
}

let activePageLayout: ExamplePageLayout = "grid";
let pageLayoutView: PageLayoutView | null = null;
let pageLayoutRequest = 0;
let pageLayoutWarmingUp = false;
const pageLayoutAnimator = new ExamplePageLayoutAnimator();

// Drawing selection always starts off, even if the browser restores form state.
textSelectionCheckboxElement.disabled = false;
const textSelection = createTextSelectionController({
  getCanvas: () => canvasElement,
  enabled: textSelectionCheckboxElement.checked,
  adapter: {
    getScene: () => currentPdfObject?.sceneData ?? null,
    getOptionalContentVisibility: () => currentPdfObject?.getOptionalContentVisibility() ?? null,
    clientToScenePoint: (clientX, clientY) =>
      currentPdfObject?.clientToScenePoint(camera, clientX, clientY, canvasElement) ?? null,
    sceneToClientPoint: (sceneX, sceneY) =>
      currentPdfObject?.sceneToClientPoint(camera, sceneX, sceneY, canvasElement) ?? null,
    setSelectionHighlights: (rects) => {
      currentPdfObject?.setTextSelectionHighlights(rects);
      requestRender();
    },
    setCameraInteractionEnabled: (interactionEnabled) => {
      controls.enabled = interactionEnabled;
    }
  }
});

let lastLoadedSource: File | string | null = null;
let lastDownloadablePdf: PdfDownloadSource | null = null;
let animationFrameId = 0;
let needsRender = false;
let fpsLastSampleTime = 0;
let fpsSmoothed = 0;
let lastNativeDrawStats: DrawStats | null = null;
let drawStatsLastText = "";
const HUD_TEXT_UPDATE_INTERVAL_MS = 100;
let hudTextLastUpdateTime = 0;
let fpsTextLastUpdateTime = 0;
let lodStatsLastText = "";
let textLodStatsLastText = "";
let lastLoadTimingText = "-";
let renderedFrameSerial = 0;
let touchControlsAvailable = hasTouchCapability();
let isDropDragActive = false;
let activeHepExportController: AbortController | null = null;
const pendingRenderedFrameResolvers: Array<() => void> = [];
const exampleSelectionMap = new Map<string, ExampleSelection>();
const exampleDropdown = createExampleDropdown({
  containerElement: exampleDropdownContainer,
  triggerElement: exampleSelect,
  labelElement: exampleSelectLabel,
  menuElement: exampleMenu,
  onSelect: (selectionKey) => {
    void loadExampleSelection(selectionKey);
  },
  signal: lifetimeSignal
});
let annotationInteraction: AnnotationInteractionController | undefined;
const drawingSelection = createDrawingSelectionControls({
  container: drawingSelectionContainer,
  getLayerName: id => currentPdfObject?.sceneData.optionalContent?.groups.find(group => group.id === id)?.name,
  createController: callbacks => createThreePrimitiveInteractionController({
    ...callbacks,
    getCanvas: () => canvasElement,
    getCamera: () => camera,
    getPdfObject: () => currentPdfObject,
    requestRender,
    onError: error => setStatus(`Drawing selection failed: ${error instanceof Error ? error.message : String(error)}`)
  }),
  onEnabledChange: enabled => {
    annotationInteraction?.setInteractionEnabled(!enabled);
    textSelectionCheckboxElement.disabled = enabled;
    if (enabled || !textSelectionCheckboxElement.checked) textSelection.disable();
    else textSelection.enable();
  }
});
const annotationBubblesCheckbox = document.querySelector<HTMLInputElement>("#annotation-bubbles-checkbox")!;
const linkNavigation = createThreeLinkNavigation({
  getCanvas: () => canvasElement,
  getPdfObject: () => currentPdfObject,
  camera,
  getControls: () => controls,
  getSourceUrl: () => lastDownloadablePdf?.url,
  onCameraChange: () => { updateCameraClipping(true); requestRender(); }
});
const annotationOverlay = createAnnotationOverlay({
  pointerInteraction: false,
  getCanvas: () => canvasElement,
  adapter: {
    getScene: () => currentPdfObject?.sceneData ?? null,
    getOptionalContentVisibility: () => currentPdfObject?.getOptionalContentVisibility() ?? null,
    clientToScenePoint: (x, y) => currentPdfObject?.clientToScenePoint(camera, x, y, canvasElement) ?? null,
    sceneToClientPoint: (x, y) => currentPdfObject?.sceneToClientPoint(camera, x, y, canvasElement) ?? null,
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

const layerControls = createThreePdfLayerControls({
  container: pdfLayersContainer,
  getPdfObject: () => currentPdfObject,
  requestRender,
  onVisibilityChange: () => {
    textSelection.clearSelection();
    refreshSearchAvailability();
    runSearch(textSearchInputElement.value, false);
    drawingSelection.onFrame();
    annotationInteraction?.onFrame();
    annotationOverlay.onFrame();
  }
});
const annotationControls = createPdfAnnotationControls({
  container: pdfAnnotationsContainer,
  controller: {
    getScene: () => currentPdfObject?.sceneData ?? null,
    getAnnotationLayers: () => currentPdfObject?.getAnnotationLayers() ?? [],
    setAnnotationVisibility: (ids, visible) =>
      currentPdfObject?.setAnnotationVisibility(ids, visible) ?? Promise.reject(new Error("No PDF is loaded."))
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
  adapter: createThreeAnnotationInteractionAdapter({
    getCanvas: () => canvasElement, getCamera: () => camera, getPdfObject: () => currentPdfObject, requestRender
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

initializeBackendSelect();
setPanelCollapsed(false);
setDownloadDataButtonState(false);
setDownloadPdfButtonState(false);
refreshDropIndicator();

function createWebGlThreeRenderer(targetCanvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const nextRenderer = new THREE.WebGLRenderer({
    canvas: targetCanvas,
    // HEPR already applies analytic AA; stay single-sample like the native renderers.
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance"
  });
  configureThreeRenderer(nextRenderer, THREE.SRGBColorSpace);
  return nextRenderer;
}

async function createWebGpuThreeRenderer(targetCanvas: HTMLCanvasElement): Promise<WebGPURenderer> {
  const nextRenderer = new WebGPURenderer({
    canvas: targetCanvas,
    // HEPR already applies analytic AA; stay single-sample like the native renderers.
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    // Keep the comparison on the same GPU class as WebGL on dual-GPU systems.
    powerPreference: "high-performance",
    // Match WebGL's 8-bit presentation precision instead of paying twice the
    // bandwidth and memory for Three's default half-float intermediate target.
    outputBufferType: THREE.UnsignedByteType
  } as WebGpuRendererParametersWithCanvas);
  // HEPR's native renderers and Three/WebGL composite extracted PDF display
  // values directly. Disable Three's linear intermediate/output transform for
  // this dedicated comparison renderer so Three/WebGPU does the same.
  configureThreeRenderer(nextRenderer, THREE.LinearSRGBColorSpace);
  try {
    await nextRenderer.init();
    stopThreeInternalAnimationLoop(nextRenderer);
    return nextRenderer;
  } catch (error) {
    const failedRenderer = nextRenderer as WebGPURenderer & {
      _initialized?: boolean;
      backend: WebGPURenderer["backend"] & { device?: { destroy?: () => void } };
    };
    if (failedRenderer._initialized === false) {
      // In r186 dispose() calls setAnimationLoop(), which retries the rejected
      // init promise and leaves an unhandled rejection. No renderer managers
      // exist yet; releasing its owned device also frees partial GPU resources.
      failedRenderer.backend.device?.destroy?.();
    } else nextRenderer.dispose();
    throw error;
  }
}

/**
 * Stop the renderer's own animation loop.
 *
 * `WebGPURenderer.init()` starts a self-perpetuating requestAnimationFrame chain
 * whether or not the application ever calls `setAnimationLoop`, and
 * `setAnimationLoop(null)` only clears the callback without stopping the chain.
 * This example renders on demand, so leaving it running keeps the page awake at
 * the display refresh rate for no benefit. `prepareThreeRendererFrame()` keeps
 * the per-frame node state in sync only when the application actually renders.
 */
function stopThreeInternalAnimationLoop(nextRenderer: ThreeExampleRenderer): void {
  const commonRenderer = nextRenderer as ThreeExampleRenderer & {
    _animation?: { stop?: () => void };
    _nodes?: { nodeFrame?: { update?: () => void } };
  };
  // These are private Three fields, so only take over the loop when both sides
  // of the installed r185 contract are available. A future Three release then
  // falls back safely to its own RAF instead of losing node-frame updates.
  if (
    typeof commonRenderer._animation?.stop === "function" &&
    typeof commonRenderer._nodes?.nodeFrame?.update === "function"
  ) {
    commonRenderer._animation.stop();
    manuallyDrivenThreeRenderers.add(nextRenderer);
  }
}

function configureThreeRenderer(
  nextRenderer: ThreeExampleRenderer,
  outputColorSpace: string
): void {
  nextRenderer.toneMapping = THREE.NoToneMapping;
  nextRenderer.outputColorSpace = outputColorSpace;
  // Fold the clear into the render pass load operation on both backends.
  nextRenderer.autoClear = true;
  nextRenderer.setClearColor(createNativeClearColor(outputColorSpace), 1);
  nextRenderer.setPixelRatio(window.devicePixelRatio || 1);
  nextRenderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
}

function createNativeClearColor(outputColorSpace: string): THREE.Color {
  return new THREE.Color().setRGB(
    NATIVE_CLEAR_COLOR_R,
    NATIVE_CLEAR_COLOR_G,
    NATIVE_CLEAR_COLOR_B,
    outputColorSpace
  );
}

function createMapControls(): MapControls {
  const nextControls = new MapControls(camera, canvasElement);
  nextControls.enableRotate = true;
  nextControls.enableDamping = false;
  nextControls.screenSpacePanning = true;
  applyTouchGestureMode(nextControls);
  nextControls.addEventListener("change", () => {
    requestRender();
  });
  return nextControls;
}

function createReplacementViewportCanvas(): HTMLCanvasElement {
  const nextCanvas = canvasElement.cloneNode(false) as HTMLCanvasElement;
  nextCanvas.classList.remove("drawing-selection-hover");
  nextCanvas.width = Math.max(1, canvasElement.width);
  nextCanvas.height = Math.max(1, canvasElement.height);
  return nextCanvas;
}

/** Create the next context without clearing the document still on screen. */
async function prepareThreeRendererBackend(
  backend: HeprRendererType,
  signal?: AbortSignal
): Promise<PreparedThreeRendererBackend | null> {
  signal?.throwIfAborted();
  if (backend === activeThreeRendererBackend) {
    return null;
  }
  const nextCanvas = createReplacementViewportCanvas();
  const nextRenderer = backend === "webgpu"
    ? await createWebGpuThreeRenderer(nextCanvas)
    : createWebGlThreeRenderer(nextCanvas);
  try {
    signal?.throwIfAborted();
    return { backend, canvas: nextCanvas, renderer: nextRenderer };
  } catch (error) {
    nextRenderer.dispose();
    throw error;
  }
}

/** Install a prepared context synchronously with its replacement PDF object. */
function installThreeRendererBackend(
  prepared: PreparedThreeRendererBackend,
  options: { disposeCurrentPdfObject?: boolean } = {}
): void {
  const disposeCurrentPdfObject = options.disposeCurrentPdfObject !== false;
  const previousControlsTarget = controls.target.clone();
  const previousCanvas = canvasElement;

  if (animationFrameId !== 0) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
  needsRender = false;

  controls.dispose();
  if (disposeCurrentPdfObject) {
    disposeCurrentObject();
  }
  renderer.dispose();

  previousCanvas.replaceWith(prepared.canvas);
  canvasElement = prepared.canvas;
  canvasResizeObserver.disconnect();
  canvasResizeObserver.observe(prepared.canvas);
  renderer = prepared.renderer;
  activeThreeRendererBackend = prepared.backend;
  resetFpsMeter();
  // The capture's GPU timer queries belong to the context being replaced.
  captureGlCalls?.dispose(); captureGlCalls = null;
  captureProfiler?.dispose();
  captureProfiler = null;
  drawCallMeter.reset();
  controls = createMapControls();
  controls.target.copy(previousControlsTarget);
  camera.coordinateSystem = prepared.renderer.coordinateSystem;
  updatePerspectiveCameraProjection();
  updateCameraClipping();
  drawingSelection.rendererChanged();
  annotationInteraction?.refresh();
}

async function ensureThreeRendererBackend(
  backend: HeprRendererType,
  options: { disposeCurrentPdfObject?: boolean } = {}
): Promise<void> {
  const prepared = await prepareThreeRendererBackend(backend, lifetimeSignal);
  if (!prepared) return;
  installThreeRendererBackend(prepared, options);
  requestRender();
}

function renderFrame(now: number = performance.now()): void {
  animationFrameId = 0;
  if (!needsRender) {
    return;
  }
  needsRender = false;
  updateFpsMeter(now);
  const profile = captureProfiler?.enabled ? captureProfiler : null;
  profile?.beginFrame(now);
  const pageLayoutAnimating = pageLayoutAnimator.update(now);
  // Crossing pages keep shared batches while moving; the settled layout is exact.
  pageLayoutView?.object.setPageOverlapMode(pageLayoutAnimating || pageLayoutWarmingUp ? "fast" : "exact");
  profile?.beginSection("controls");
  const controlsChanged = controls.update();
  updateCameraClipping();
  profile?.endSection("controls");
  prepareThreeRendererFrame(renderer);
  profile?.beginSection("render");
  const drawCalls = withThreeRenderPerformance(profile, () =>
    drawCallCounter.measure(renderer.info, () => renderer.render(scene, camera)));
  profile?.endSection("render");
  drawCallMeter.update(drawCalls);
  const zoomText = currentPdfObject ? `${currentPdfObject.getViewState().zoom.toFixed(2)}x` : "-";
  if (zoomValueElement.textContent !== zoomText) zoomValueElement.textContent = zoomText;
  if (profile) recordCaptureCounters(profile, drawCalls, controlsChanged);
  profile?.beginSection("overlays");
  drawingSelection.onFrame();
  annotationInteraction?.onFrame();
  annotationOverlay.onFrame();
  textSelection.updateOverlay();
  profile?.endSection("overlays");
  // Writing the readouts every frame costs a style recalc, layout and paint per
  // frame, which at high refresh rates dwarfs the numbers being reported. The
  // panels stay legible at ~10Hz; anything that changes them outside the render
  // loop still updates them directly.
  if (now - hudTextLastUpdateTime >= HUD_TEXT_UPDATE_INTERVAL_MS) {
    hudTextLastUpdateTime = now;
    updateDrawStatsMeter();
    updateLodStatsMeter();
  }
  renderedFrameSerial += 1;
  resolveRenderedFrameWaiters();
  profile?.endFrame();
  if (profile && !profile.enabled) { captureGlCalls?.dispose(); captureGlCalls = null; }
  if (controlsChanged || pageLayoutAnimating) {
    requestRender();
  }
}

/** Mirror the useful bookkeeping from Three's stopped WebGPU animation loop. */
function prepareThreeRendererFrame(nextRenderer: ThreeExampleRenderer): void {
  if (!manuallyDrivenThreeRenderers.has(nextRenderer)) {
    return;
  }

  const commonRenderer = nextRenderer as ThreeExampleRenderer & {
    _nodes?: { nodeFrame?: { frameId: number; update: () => void } };
    info: ThreeExampleRenderer["info"] & { frame: number };
  };
  // The shared draw-call counter resets frame statistics around the render.
  commonRenderer._nodes?.nodeFrame?.update();
  const frameId = commonRenderer._nodes?.nodeFrame?.frameId;
  if (typeof frameId === "number") {
    commonRenderer.info.frame = frameId;
  }
}

function requestRender(): void {
  if (lifetimeSignal.aborted) return;
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

async function warmThreeRenderer(token: number, signal: AbortSignal): Promise<void> {
  const target = renderer;
  const queue = (target as ThreeExampleRenderer & {
    backend?: { device?: { queue?: { onSubmittedWorkDone?(): Promise<void> } } }
  }).backend?.device?.queue;
  await warmViewerRendering({ signal,
    renderFrame: warmupSignal => {
      if (token !== loadToken || target !== renderer) return;
      return waitForLoad(waitForNextRenderedFrame(token), warmupSignal);
    },
    waitForGpu: queue?.onSubmittedWorkDone ? () => {
      if (token !== loadToken || target !== renderer) return;
      return queue.onSubmittedWorkDone!();
    } : undefined
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

requestRender();
syncTouchRotateVisibility();

function handleViewportResize(): void {
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
  updatePerspectiveCameraProjection();
  updateCameraClipping();
  requestRender();
}

window.addEventListener("resize", handleViewportResize, { signal: lifetimeSignal });

// Mobile browsers can fire the window "resize" event before an orientation
// change has re-laid-out the page, so clientWidth/clientHeight are stale and
// the drawing buffer keeps the previous orientation's aspect ratio.
// ResizeObserver callbacks are delivered after layout with final geometry.
const canvasResizeObserver = new ResizeObserver(handleViewportResize);
canvasResizeObserver.observe(canvasElement);
lifetimeSignal.addEventListener("abort", () => {
  canvasResizeObserver.disconnect();
}, { once: true });

openButtonElement.addEventListener("click", () => {
  fileInputElement.click();
}, { signal: lifetimeSignal });

togglePanelButtonElement.addEventListener("click", () => {
  const currentlyCollapsed = panelElement.classList.contains("collapsed");
  setPanelCollapsed(!currentlyCollapsed);
}, { signal: lifetimeSignal });

downloadDataButtonElement.addEventListener("click", () => {
  void downloadHep();
}, { signal: lifetimeSignal });

downloadPdfButtonElement.addEventListener("click", () => {
  void downloadSourcePdf();
}, { signal: lifetimeSignal });

fileInputElement.addEventListener("change", () => {
  const file = fileInputElement.files?.[0];
  if (!file) {
    return;
  }
  void loadSupportedFile(file);
  fileInputElement.value = "";
}, { signal: lifetimeSignal });

backendSelectElement.addEventListener("change", () => {
  const backend = readBackendMode();
  if (!currentPdfObject || !lastLoadedSource) {
    void ensureThreeRendererBackend(backend)
      .then(() => {
        setStatus(`Backend switched to ${formatBackendLabel(backend)}. Load a source to render.`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        backendSelectElement.value = activeThreeRendererBackend;
        setStatus(`Failed to switch backend: ${message}`);
      });
    return;
  }
  void reloadSourceWithBackend(backend);
}, { signal: lifetimeSignal });

vectorLodSelectElement.addEventListener("change", () => {
  const vectorLod = readVectorLodMode();
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

textLodSelectElement.addEventListener("change", () => {
  const textLod = readTextLodMode();
  if (!lastLoadedSource) {
    setStatus(`Text LOD mode set to ${formatTextLodMode(textLod)}. Load a source to render.`);
    return;
  }
  currentPdfObject?.setTextLodMode(textLod);
  setStatus(`Text LOD mode set to ${formatTextLodMode(textLod)}.`);
  updateDrawStatsMeter();
  updateLodStatsMeter();
  requestRender();
}, { signal: lifetimeSignal });

touchRotateCheckboxElement.addEventListener("change", () => {
  applyTouchGestureMode(controls);
  setStatus(`Touch rotate ${readTouchRotateEnabled() ? "enabled" : "disabled"}.`);
  requestRender();
}, { signal: lifetimeSignal });

textSelectionCheckboxElement.addEventListener("change", () => {
  if (textSelectionCheckboxElement.checked && !drawingSelection.isEnabled()) {
    textSelection.enable();
  } else {
    textSelection.disable();
  }
  setStatus(`Text selection ${textSelectionCheckboxElement.checked ? "enabled" : "disabled"}.`);
}, { signal: lifetimeSignal });

function handleOcrTextChange(): void {
  if (ocrTextCheckboxElement.checked) compressScansCheckboxElement.checked = false;
  if (currentPdfObject?.sourceKind === "pdf") void reloadSourceWithBackend(readBackendMode(), true);
}

ocrTextCheckboxElement.addEventListener("change", handleOcrTextChange, { signal: lifetimeSignal });

function handlePageStreamingChange(): void {
  if (pageStreamingCheckboxElement.checked) compressScansCheckboxElement.checked = false;
  if (currentPdfObject?.sourceKind === "pdf") void reloadSourceWithBackend(readBackendMode(), true);
}

pageStreamingCheckboxElement.addEventListener("change", handlePageStreamingChange, { signal: lifetimeSignal });

function handleCompressScansChange(): void {
  if (compressScansCheckboxElement.checked) {
    ocrTextCheckboxElement.checked = false;
    pageStreamingCheckboxElement.checked = false;
  }
  if (currentPdfObject?.sourceKind === "pdf") void reloadSourceWithBackend(readBackendMode(), true);
}

compressScansCheckboxElement.addEventListener("change", handleCompressScansChange, { signal: lifetimeSignal });

for (const button of pageLayoutButtons) {
  button.addEventListener("click", () => {
    void setPageLayout(readPageLayout(button.dataset.pageLayout));
  }, { signal: lifetimeSignal });
}

// --- Page layouts: demo of the public per-page transform API. ---
// `getPages()` returns one THREE.Group per page, centered on the page and
// positioned in the loaded layout. The example tweens their ordinary
// position/quaternion from the render loop, like three.js' css3d periodic table.
async function setPageLayout(layout: ExamplePageLayout): Promise<void> {
  const pdfObject = currentPdfObject;
  if (!pdfObject || pdfObject.pageCount <= 1) {
    return;
  }
  const request = ++pageLayoutRequest;
  activePageLayout = layout;
  syncPageLayoutControls();
  // Grid is the loaded layout. A document that never left it keeps its
  // ordinary document rendering path instead of preparing page views.
  if (!pageLayoutView && layout === "grid") {
    setStatus("Page layout set to Grid.");
    return;
  }
  try {
    let warmUp = false;
    if (!pageLayoutView) {
      setStatus(`Preparing ${pdfObject.pageCount.toLocaleString()} pages...`);
      // Preparation is shared by overlapping requests and reports until it settles.
      const stopProgress = pdfObject.subscribePagePreparationProgress(setPageLayoutProgress);
      let pages: readonly HeprThreePdfObject[];
      try {
        pages = await pdfObject.getPages({ signal: lifetimeSignal });
      } finally {
        stopProgress();
      }
      if (request !== pageLayoutRequest || pdfObject !== currentPdfObject) {
        return;
      }
      pageLayoutView = createPageLayoutView(pdfObject, pages);
      warmUp = true;
    }
    const view = pageLayoutView;
    const loaded = view.targets;
    view.layout = layout;
    view.targets = computeExamplePageLayout(layout, view.layoutPages);
    includePageLayoutInClipRange(view);
    if (warmUp) {
      // Pages in the loaded layout draw as the document itself. Leaving it
      // switches to shared page batches, whose first frame compiles shaders
      // and uploads data. Take that frame a hair into the transition, so the
      // transition itself then plays in full.
      applyExamplePageLayout(view.pages, interpolateExamplePageLayout(loaded, view.targets, PAGE_LAYOUT_WARM_UP_PROGRESS));
      pageLayoutWarmingUp = true;
      setPageLayoutProgress(100);
      try {
        await waitForNextRenderedFrame(loadToken);
      } finally {
        pageLayoutWarmingUp = false;
        setPageLayoutProgress(null);
      }
      if (request !== pageLayoutRequest || pdfObject !== currentPdfObject) {
        return;
      }
    }
    pageLayoutAnimator.animate(view.pages, view.targets, PAGE_LAYOUT_DURATION_MS);
    setStatus(`Page layout set to ${formatPageLayout(layout)}.`);
    requestRender();
  } catch (error) {
    if (request !== pageLayoutRequest || pdfObject !== currentPdfObject) {
      return;
    }
    // Page views are only missing here, so the document is still on its grid.
    activePageLayout = "grid";
    syncPageLayoutControls();
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to prepare pages: ${message}`);
  }
}

function createPageLayoutView(object: HeprThreePdfObject, pages: readonly HeprThreePdfObject[]): PageLayoutView {
  const rects = object.sceneData.pageRects;
  // Fresh page views still hold the loaded layout.
  const layoutPages = pages.map((page, index) => ({
    gridPosition: page.position.clone(),
    width: readPageExtent(rects[index * 4 + 2] - rects[index * 4]),
    height: readPageExtent(rects[index * 4 + 3] - rects[index * 4 + 1])
  }));
  return { object, pages, layoutPages, layout: "grid", targets: computeExamplePageLayout("grid", layoutPages) };
}

/**
 * Keep every page inside the clipping sphere. Transitions interpolate between
 * two arrangements that are both inside it, so they stay inside too.
 */
function includePageLayoutInClipRange(view: PageLayoutView): void {
  let radius = currentContentRadius;
  view.targets.forEach((target, index) => {
    const page = view.layoutPages[index];
    const center = view.object.localToWorld(tempClipDelta.copy(target.position));
    radius = Math.max(radius, center.distanceTo(currentContentCenter) + Math.hypot(page.width, page.height) / 2);
  });
  updateClipAnchor(currentContentCenter, radius);
  updateCameraClipping(true);
}

/** Give a backend replacement the current arrangement before it is shown. */
async function preparePageLayoutReplacement(
  nextObject: HeprThreePdfObject,
  signal: AbortSignal
): Promise<PageLayoutView | null> {
  if (activePageLayout === "grid" || nextObject.pageCount <= 1) {
    return null;
  }
  const stopProgress = nextObject.subscribePagePreparationProgress(setPageLayoutProgress);
  try {
    const view = createPageLayoutView(nextObject, await nextObject.getPages({ signal }));
    view.layout = activePageLayout;
    view.targets = computeExamplePageLayout(activePageLayout, view.layoutPages);
    applyExamplePageLayout(view.pages, view.targets);
    return view;
  } catch (error) {
    signal.throwIfAborted();
    // Switching the renderer matters more than the arrangement; use the grid.
    console.warn("[Three Example] Failed to restore page layout:", error);
    return null;
  } finally {
    stopProgress();
    setPageLayoutProgress(null);
  }
}

/** Page views belong to one object: a replacement brings its own or starts on the grid. */
function resetPageLayout(view: PageLayoutView | null = null): void {
  pageLayoutAnimator.cancel();
  pageLayoutRequest += 1;
  pageLayoutView = view;
  activePageLayout = view?.layout ?? "grid";
  syncPageLayoutControls();
}

function setPageLayoutProgress(percentage: number | null): void {
  pageLayoutProgressElement.hidden = percentage === null;
  if (percentage === null) return;
  pageLayoutProgressBarElement.value = percentage;
  pageLayoutProgressTextElement.textContent = `${percentage}%`;
}

function syncPageLayoutControls(): void {
  pageLayoutRowElement.hidden = (currentPdfObject?.pageCount ?? 0) <= 1;
  for (const button of pageLayoutButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.pageLayout === activePageLayout));
  }
}

function readPageLayout(value: string | undefined): ExamplePageLayout {
  return value === "sphere" || value === "helix" ? value : "grid";
}

function formatPageLayout(layout: ExamplePageLayout): string {
  return layout === "sphere" ? "Sphere" : layout === "helix" ? "Helix" : "Grid";
}

function readPageExtent(value: number): number {
  return Number.isFinite(value) ? Math.max(MIN_OBJECT_EXTENT, Math.abs(value)) : MIN_OBJECT_EXTENT;
}

window.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || touchControlsAvailable) {
    return;
  }
  touchControlsAvailable = true;
  syncTouchRotateVisibility();
}, { signal: lifetimeSignal });

window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  isDropDragActive = true;
  refreshDropIndicator();
}, { signal: lifetimeSignal });

window.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!isDropDragActive) {
    isDropDragActive = true;
    refreshDropIndicator();
  }
}, { signal: lifetimeSignal });

window.addEventListener("dragleave", (event) => {
  if (event.target === document.documentElement || event.target === document.body) {
    isDropDragActive = false;
    refreshDropIndicator();
  }
}, { signal: lifetimeSignal });

window.addEventListener("drop", (event) => {
  event.preventDefault();
  isDropDragActive = false;
  refreshDropIndicator();

  const files = Array.from(event.dataTransfer?.files || []);
  const supported = files.find((file) => isPdfFile(file) || isHepFile(file));

  if (!supported) {
    setStatus("Dropped file is not a supported PDF or HEP file.");
    return;
  }

  void loadSupportedFile(supported);
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

// --- Find in text: demo of the public HeprThreePdfObject search API. ---
// `searchText` returns matches with `localBounds` in the object's local space
// (frame your camera on them) and `setSearchHighlights` shows browser-find
// style rectangles that stay in sync with the camera automatically.
const searchState = {
  matches: [] as HeprTextSearchMatch[],
  currentIndex: -1,
  caseSensitive: false,
  lastQuery: ""
};
let searchDebounceHandle = 0;

function refreshSearchAvailability(): void {
  const pdfObject = currentPdfObject;
  const searchable = pdfObject?.hasSearchableText === true;
  textSearchInputElement.disabled = !searchable;
  textSearchCaseButtonElement.disabled = !searchable;
  textSearchInputElement.placeholder = !pdfObject
    ? "Load a document to search"
    : searchable
      ? "Find in document..."
      : "No searchable text in this document";
  if (!searchable) {
    searchState.matches = [];
    searchState.currentIndex = -1;
    searchState.lastQuery = "";
    updateSearchCounter();
  }
}

function runSearch(query: string, flyToFirstMatch = true): void {
  const pdfObject = currentPdfObject;
  searchState.lastQuery = query;
  if (!pdfObject || query.trim().length === 0) {
    searchState.matches = [];
    searchState.currentIndex = -1;
    pdfObject?.setSearchHighlights(null);
    updateSearchCounter();
    requestRender();
    return;
  }

  searchState.matches = pdfObject.searchText(query, { caseSensitive: searchState.caseSensitive });
  searchState.currentIndex = searchState.matches.length > 0 ? 0 : -1;
  applySearchHighlights();
  if (flyToFirstMatch && searchState.currentIndex >= 0) {
    flyToMatch(searchState.matches[searchState.currentIndex]);
  }
  updateSearchCounter();
}

function applySearchHighlights(): void {
  currentPdfObject?.setSearchHighlights(searchState.matches, { currentIndex: searchState.currentIndex });
  requestRender();
}

function stepSearch(direction: 1 | -1): void {
  const count = searchState.matches.length;
  if (count === 0) {
    return;
  }
  searchState.currentIndex = (searchState.currentIndex + direction + count) % count;
  applySearchHighlights();
  flyToMatch(searchState.matches[searchState.currentIndex]);
  updateSearchCounter();
}

function updateSearchCounter(): void {
  const showCount = searchState.lastQuery.trim().length > 0 && currentPdfObject !== null;
  textSearchCountElement.hidden = !showCount;
  if (showCount) {
    textSearchCountElement.textContent =
      searchState.matches.length > 0
        ? `${searchState.currentIndex + 1}/${searchState.matches.length}`
        : "0/0";
  }
  const hasMatches = searchState.matches.length > 0;
  textSearchPrevButtonElement.disabled = !hasMatches;
  textSearchNextButtonElement.disabled = !hasMatches;
}

function clearSearch(): void {
  window.clearTimeout(searchDebounceHandle);
  textSearchInputElement.value = "";
  searchState.matches = [];
  searchState.currentIndex = -1;
  searchState.lastQuery = "";
  currentPdfObject?.setSearchHighlights(null);
  updateSearchCounter();
  requestRender();
}

function flyToMatch(match: HeprTextSearchMatch): void {
  const pdfObject = currentPdfObject;
  if (!pdfObject) {
    return;
  }
  scene.updateMatrixWorld(true);

  const view = pageLayoutView?.object === pdfObject && pageLayoutView.layout !== "grid" ? pageLayoutView : null;
  // localBounds flatten transformed pages onto the document plane. In a page
  // layout, frame the match where its page is heading and face the page.
  const localBounds = view ? match.bounds : match.localBounds;
  let center: THREE.Vector3;
  if (view) {
    const target = view.targets[match.pageIndex];
    const rects = pdfObject.sceneData.pageRects, rect = match.pageIndex * 4;
    tempPageMatrix.compose(target.position, target.quaternion, unitScale).premultiply(pdfObject.matrixWorld);
    // Each page's local origin is the center of its page rectangle.
    center = new THREE.Vector3(
      (localBounds.minX + localBounds.maxX - rects[rect] - rects[rect + 2]) * 0.5,
      (localBounds.minY + localBounds.maxY - rects[rect + 1] - rects[rect + 3]) * 0.5,
      0
    ).applyMatrix4(tempPageMatrix);
  } else {
    center = pdfObject.localToWorld(
      new THREE.Vector3((localBounds.minX + localBounds.maxX) * 0.5, (localBounds.minY + localBounds.maxY) * 0.5, 0)
    );
  }
  const matchWidth = Math.max(localBounds.maxX - localBounds.minX, MIN_OBJECT_EXTENT);
  const matchHeight = Math.max(localBounds.maxY - localBounds.minY, MIN_OBJECT_EXTENT);

  // Frame the match at roughly 1/8 of the viewport height with some context.
  const verticalFovRadians = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFovRadians = 2 * Math.atan(Math.tan(verticalFovRadians * 0.5) * Math.max(1e-6, camera.aspect));
  const framedDistance = Math.max(
    MIN_OBJECT_EXTENT,
    (matchHeight * 8 * 0.5) / Math.tan(verticalFovRadians * 0.5),
    (matchWidth * 1.6 * 0.5) / Math.tan(horizontalFovRadians * 0.5)
  );

  // Keep the current distance while cycling nearby matches; re-frame only
  // when the camera is far out (unreadable) or too close (match off-screen).
  const currentDistance = camera.position.distanceTo(controls.target);
  const distance =
    currentDistance >= framedDistance * 0.8 && currentDistance <= framedDistance * 6 ? currentDistance : framedDistance;

  if (view) {
    tempViewDirection.set(0, 0, 1).transformDirection(tempPageMatrix);
  } else {
    tempViewDirection.subVectors(camera.position, controls.target);
  }
  if (tempViewDirection.lengthSq() <= 1e-12) {
    tempViewDirection.set(0, 0, 1);
  } else {
    tempViewDirection.normalize();
  }
  camera.position.copy(center).addScaledVector(tempViewDirection, distance);
  controls.target.copy(center);
  updateCameraClipping(true);
  controls.update();
  requestRender();
}

textSearchInputElement.addEventListener("input", () => {
  window.clearTimeout(searchDebounceHandle);
  searchDebounceHandle = window.setTimeout(() => {
    runSearch(textSearchInputElement.value);
  }, 150);
}, { signal: lifetimeSignal });

textSearchInputElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    window.clearTimeout(searchDebounceHandle);
    if (textSearchInputElement.value !== searchState.lastQuery) {
      runSearch(textSearchInputElement.value);
    } else {
      stepSearch(event.shiftKey ? -1 : 1);
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    clearSearch();
    textSearchInputElement.blur();
  }
}, { signal: lifetimeSignal });

textSearchPrevButtonElement.addEventListener("click", () => {
  stepSearch(-1);
}, { signal: lifetimeSignal });

textSearchNextButtonElement.addEventListener("click", () => {
  stepSearch(1);
}, { signal: lifetimeSignal });

textSearchCaseButtonElement.addEventListener("click", () => {
  searchState.caseSensitive = !searchState.caseSensitive;
  textSearchCaseButtonElement.setAttribute("aria-pressed", searchState.caseSensitive ? "true" : "false");
  window.clearTimeout(searchDebounceHandle);
  runSearch(textSearchInputElement.value);
}, { signal: lifetimeSignal });

/**
 * Opt-in render capture, mirroring `heprPerf` in the native viewer so the two
 * backends can be compared with the same report shape.
 *
 * Start it from the console with `heprPerf.start()`, or with `?perf=1` in the
 * URL to capture from the first frame, then read it back with `heprPerf.stop()`.
 * GPU timings use the WebGL backend's timer-query extension, or on WebGPU the
 * renderer's own timestamp queries.
 */
let captureProfiler: RenderPerformanceProfiler | null = null;
let captureGlCalls: ReturnType<typeof instrumentThreeWebGlCalls> | null = null;
let captureContext: Record<string, unknown> | null = null;
const performanceCapture = {
  start(options: RenderPerformanceOptions & { webglCalls?: boolean } = {}): string {
    if (options.webglCalls !== undefined && typeof options.webglCalls !== "boolean") throw new TypeError("webglCalls must be a boolean.");
    captureGlCalls?.dispose(); captureGlCalls = null;
    captureProfiler?.dispose();
    const gl = activeThreeRendererBackend === "webgl"
      ? (renderer as THREE.WebGLRenderer).getContext() : undefined;
    captureProfiler = new RenderPerformanceProfiler({
      gl: gl instanceof WebGL2RenderingContext ? gl : undefined,
      // WebGPU has no timer-query context; Three times its render passes instead.
      gpuTimer: activeThreeRendererBackend === "webgpu" ? new ThreeWebGpuFrameTimer(renderer as never) : undefined
    });
    captureContext = {
      diagnosticsVersion: 3, threeRevision: THREE.REVISION, browser: navigator.userAgent,
      shaderErrorChecks: activeThreeRendererBackend === "webgl" ? (renderer as THREE.WebGLRenderer).debug.checkShaderErrors : null,
      initialCamera: describeThreePerformanceCamera(camera, controls.target),
      initialTextLod: currentPdfObject?.getTextLodStats() ? { ...currentPdfObject.getTextLodStats() } : null,
      document: currentPdfObject?.sourceLabel ?? null, sourceKind: currentPdfObject?.sourceKind ?? null,
      scene: currentPdfObject ? describeThreePerformanceScene(currentPdfObject.sceneData) : null,
      backend: `three-${activeThreeRendererBackend}`,
      canvasPixels: [canvasElement.width, canvasElement.height], dpr: window.devicePixelRatio,
      vectorLod: vectorLodSelectElement.value, textLod: textLodSelectElement.value,
      drawingSelection: drawingSelection.isEnabled(),
      sourceSegments: currentPdfObject?.sceneData.segmentCount ?? 0,
      sourcePaints: currentPdfObject?.sceneData.drawRuns?.length ?? 0
    };
    captureProfiler.start(options);
    if (gl instanceof WebGL2RenderingContext && options.webglCalls !== false) {
      captureGlCalls = instrumentThreeWebGlCalls(gl, captureProfiler);
    }
    captureContext.webglCalls = captureGlCalls ? {
      installedMethods: [...captureGlCalls.installedMethods], unavailableMethods: [...captureGlCalls.unavailableMethods]
    } : null;
    requestRender();
    return `Capturing up to ${options.maxFrames ?? 600} rendered frames. Pan or zoom, then run heprPerf.stop().`;
  },
  report() {
    if (!captureProfiler) throw new Error("Start a capture with heprPerf.start() first.");
    // `?perf=1` starts before any document exists, so name it once one is open.
    if (captureContext && captureContext.document === null) {
      captureContext.document = currentPdfObject?.sourceLabel ?? null;
      captureContext.sourceKind = currentPdfObject?.sourceKind ?? null;
      captureContext.scene = currentPdfObject ? describeThreePerformanceScene(currentPdfObject.sceneData) : null;
      captureContext.sourceSegments = currentPdfObject?.sceneData.segmentCount ?? 0;
      captureContext.sourcePaints = currentPdfObject?.sceneData.drawRuns?.length ?? 0;
    }
    return { context: captureContext, ...captureProfiler.getReport() };
  },
  stop() {
    captureProfiler?.stop();
    captureGlCalls?.dispose(); captureGlCalls = null;
    const report = performanceCapture.report();
    console.table({ frameCpu: report.frameCpuMs, frameInterval: report.frameIntervalMs,
      ...report.cpuSections, gpuCommandSpan: report.gpu.frameMs });
    console.table(report.counters);
    return report;
  },
  json(): string { return JSON.stringify(performanceCapture.report(), null, 2); }
};
// Temporary, opt-in console diagnostics. Nothing is captured until start().
Object.assign(window, { heprPerf: performanceCapture });
// `?perf=1` starts the capture before the first frame, so the first
// interactions with a freshly loaded document are already in the report.
if (new URLSearchParams(window.location.search).get("perf") === "1") {
  console.info(performanceCapture.start());
}

function recordCaptureCounters(profile: RenderPerformanceProfiler, drawCalls: number | null, controlsChanged: boolean): void {
  if (drawCalls !== null) profile.add("drawCalls", drawCalls);
  profile.add("three.geometries", renderer.info.memory.geometries);
  profile.add("three.textures", renderer.info.memory.textures);
  const programs = (renderer.info as THREE.WebGLRenderer["info"]).programs;
  if (programs) profile.add("three.programs", programs.length);
  profile.setFrameContext({ ...describeThreePerformanceCamera(camera, controls.target), controlsChanged: controlsChanged ? 1 : 0,
    viewportWidth: canvasElement.width, viewportHeight: canvasElement.height });
}

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
  loadToken += 1;
  sourceLoadController?.abort();
  activeHepExportController?.abort();
  activeHepExportController = null;
  if (animationFrameId !== 0) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
  captureGlCalls?.dispose(); captureGlCalls = null;
  captureProfiler?.dispose();
  captureProfiler = null;
  layerControls.dispose();
  annotationControls.dispose();
  annotationInteraction?.dispose();
  drawingSelection.dispose();
  annotationOverlay.dispose();
  linkNavigation.dispose();
  textSelection.dispose();
  controls.dispose();
  disposeCurrentObject();
  renderer.dispose();
}

function readThreeObjectOptions(): Omit<HeprThreeObjectOptions, "rendererType"> & { ocrTextOnly: boolean; compressScans: boolean; pageLoading: "all" | "auto" | "eager" } {
  const pageBackground = readPageBackgroundColor();
  const vectorOverride = readVectorOverrideColor();
  return {
    ocrTextOnly: ocrTextCheckboxElement.checked,
    compressScans: compressScansCheckboxElement.checked && !ocrTextCheckboxElement.checked,
    pageLoading: compressScansCheckboxElement.checked && !ocrTextCheckboxElement.checked ? "eager"
      : pageStreamingCheckboxElement.checked ? "auto" : "all",
    threeColorCompositing: "display",
    vectorLod: readVectorLodMode(),
    textLod: readTextLodMode(),
    pageBackground: [pageBackground[0], pageBackground[1], pageBackground[2]],
    pageBackgroundOpacity: pageBackground[3],
    vectorOverrideColor: [vectorOverride[0], vectorOverride[1], vectorOverride[2]],
    vectorOverrideOpacity: vectorOverride[3]
  };
}

async function loadSource(
  source: File | string,
  options: { pdfDownloadHint?: PdfDownloadSource | null } = {}
): Promise<void> {
  cancelActiveHepExport();
  const activeLoadToken = ++loadToken;
  sourceLoadController?.abort();
  const controller = new AbortController();
  sourceLoadController = controller;
  const backend = readBackendMode();
  const sourceLabel = typeof source === "string" ? source : source.name;
  const objectOptions = readThreeObjectOptions();
  const previousPdfObject = currentPdfObject;
  const previousDownloadablePdf = lastDownloadablePdf;
  let pendingObject: HeprThreePdfObject | null = null;
  let preparedBackend: PreparedThreeRendererBackend | null = null;
  setStatus(`Loading ${sourceLabel} with ${backend.toUpperCase()}...`);
  setLoadingProgress(true, "0.00% Parsing / loading");
  setLoadControlsEnabled(false);
  setDownloadDataButtonState(false);
  setDownloadPdfButtonState(false);
  backendSelectElement.disabled = true;
  vectorLodSelectElement.disabled = true;
  textLodSelectElement.disabled = true;

  try {
    const loadStart = performance.now();
    resetVectorStrokeLodBuildTiming();
    let password: string | undefined;
    let nextObject: HeprThreePdfObject;
    for (;;) {
      try {
        nextObject = await pdfObjectGenerator(
          source,
          {
            ...objectOptions,
            password,
            signal: controller.signal,
            onProgress: (progress) => {
              updateLoadingProgress(activeLoadToken, progress);
            }
          },
          backend as HeprRendererType
        );
        break;
      } catch (error) {
        if (!isPdfPasswordError(error) || activeLoadToken !== loadToken) throw error;
        setLoadingProgress(false);
        setStatus(`${sourceLabel} is password protected.`);
        const answer = await promptForPdfPassword({
          label: sourceLabel,
          retry: error.details.reason === "password-incorrect",
          signal: controller.signal
        });
        if (answer === null || activeLoadToken !== loadToken) throw error;
        password = answer;
        setStatus(`Loading ${sourceLabel} with ${backend.toUpperCase()}...`);
        setLoadingProgress(true, "0.00% Parsing / loading");
      }
    }
    pendingObject = nextObject;
    const objectReadyMs = performance.now() - loadStart;
    const lodTiming = consumeVectorStrokeLodBuildTiming();

    if (activeLoadToken !== loadToken) {
      nextObject.dispose();
      pendingObject = null;
      return;
    }
    const downloadablePdf = await resolveDownloadablePdfSource(
      source, nextObject, options.pdfDownloadHint ?? null, controller.signal
    );
    controller.signal.throwIfAborted();
    if (activeLoadToken !== loadToken) return;
    updateLoadingProgress(activeLoadToken, {
      value: 1,
      stage: "first-render",
      sourceType: nextObject.sourceKind === "pdf" ? "pdf" : "hep"
    });
    const firstSubmitStart = performance.now();
    preparedBackend = await prepareThreeRendererBackend(backend, controller.signal);
    const submitRenderer = preparedBackend?.renderer ?? renderer;
    const submitCamera = camera.clone();
    submitCamera.coordinateSystem = backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
    submitCamera.updateProjectionMatrix();
    // Compile the clip/LOD variants selected by the view that will be shown,
    // while leaving the old document's camera and controls alone.
    fitCameraToObject(nextObject, true, submitCamera);
    await nextObject.compileForThreeRenderer(submitRenderer, submitCamera, controller.signal);
    controller.signal.throwIfAborted();
    if (activeLoadToken !== loadToken) return;
    if (preparedBackend) {
      const previewScene = new THREE.Scene();
      previewScene.add(nextObject);
      try {
        prepareThreeRendererFrame(submitRenderer);
        submitRenderer.render(previewScene, submitCamera);
      } finally { previewScene.remove(nextObject); }
      installThreeRendererBackend(preparedBackend, { disposeCurrentPdfObject: false });
      preparedBackend = null;
    }
    replacePdfObject(nextObject);
    pendingObject = null;
    lastLoadedSource = source;
    lastDownloadablePdf = downloadablePdf;
    setDownloadDataButtonState(true);
    setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
    requestRender();
    await waitForLoad(waitForNextRenderedFrame(activeLoadToken), controller.signal);
    if (activeLoadToken !== loadToken) return;
    const firstSubmitMs = performance.now() - firstSubmitStart;
    await warmThreeRenderer(activeLoadToken, controller.signal);
    if (activeLoadToken !== loadToken) return;
    const totalLoadMs = performance.now() - loadStart;
    lastLoadTimingText = formatLoadTiming(totalLoadMs, lodTiming.elapsedMs, lodTiming.buildCount, firstSubmitMs, objectReadyMs);
    if (nextObject.sourceOptions?.ocrTextOnly) setStatus("Text-only view: pictures and diagrams are omitted. Pages without stored text are blank.");
    else clearLoadedStatus();
    updateSceneMetrics(nextObject);
  } catch (error) {
    if (activeLoadToken !== loadToken) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (currentPdfObject === previousPdfObject) {
      lastDownloadablePdf = previousDownloadablePdf;
      setDownloadDataButtonState(Boolean(currentPdfObject), false);
      setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
    }
    setStatus(`Failed to load source: ${message}`);
  } finally {
    if (pendingObject && pendingObject !== currentPdfObject) pendingObject.dispose();
    preparedBackend?.renderer.dispose();
    if (activeLoadToken === loadToken) {
      sourceLoadController = null;
      setLoadingProgress(false);
      setLoadControlsEnabled(true);
      backendSelectElement.disabled = false;
      vectorLodSelectElement.disabled = false;
      textLodSelectElement.disabled = false;
    }
  }
}

async function reloadSourceWithBackend(backend: HeprRendererType, reparseSource = false): Promise<void> {
  const previousObject = currentPdfObject;
  const source = lastLoadedSource;
  if (!previousObject || !source || (!reparseSource && backend === activeThreeRendererBackend)) {
    return;
  }

  const activeLoadToken = ++loadToken;
  sourceLoadController?.abort();
  const controller = new AbortController();
  sourceLoadController = controller;
  const previousBackend = activeThreeRendererBackend;
  const cameraSnapshot = captureCameraSnapshot();
  const objectOptions = readThreeObjectOptions();
  let nextObject: HeprThreePdfObject | null = null;
  let preparedBackend: PreparedThreeRendererBackend | null = null;
  let targetInstalled = false;
  let vectorLodReservation: VectorStrokeLodRuntimeReservation | null = null;

  setStatus(reparseSource ? `Changing PDF view for ${previousObject.sourceLabel}...`
    : `Switching ${previousObject.sourceLabel} to ${formatBackendLabel(backend)}...`);
  setLoadingProgress(true, "Preparing renderer...");
  setLoadControlsEnabled(false);
  setDownloadDataButtonState(true, true);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), true);
  backendSelectElement.disabled = true;
  vectorLodSelectElement.disabled = true;
  textLodSelectElement.disabled = true;

  try {
    const loadStart = performance.now();
    resetVectorStrokeLodBuildTiming();
    if (!reparseSource) {
      const vectorLodStage = hasStoredVectorStrokeLod(previousObject.sceneData) ? "vector-lod-restore" : "vector-lod";
      vectorLodReservation = await reserveVectorStrokeLodRuntime(previousObject.sceneData, objectOptions.vectorLod ?? "auto", backend, {
        yieldIntervalMs: 50,
        signal: controller.signal,
        shouldCancel: () => controller.signal.aborted,
        onProgress: progress => updateLoadingProgress(activeLoadToken, { value: progress.value * 0.7, stage: vectorLodStage })
      });
      controller.signal.throwIfAborted();
      if (objectOptions.textLod !== "off") {
        await prebuildTextLod(previousObject.sceneData, {
          yieldIntervalMs: 50,
          signal: controller.signal,
          onProgress: progress => updateLoadingProgress(activeLoadToken, { value: 0.7 + progress.value * 0.26, stage: "text-lod" })
        });
      }
    }
    updateLoadingProgress(activeLoadToken, { value: 0.98, stage: "upload" });
    // Keep canonical references attached to the exact same scene when
    // replacing the renderer; do not parse the source again.
    nextObject = (previousObject.isPageDemandLoaded || reparseSource) && previousObject.sourceBytes
      ? await pdfObjectGenerator(previousObject.sourceBytes, { ...previousObject.sourceOptions, ...objectOptions,
        sourceLabel: previousObject.sourceLabel,
        signal: controller.signal, onProgress: progress => updateLoadingProgress(activeLoadToken, progress) }, backend)
      : await createThreePdfObject(
      {
        scene: previousObject.sceneData,
        sourceLabel: previousObject.sourceLabel,
        sourceKind: previousObject.sourceKind,
        sourceBytes: previousObject.sourceBytes,
        sourceOptions: previousObject.sourceOptions
      },
      { ...objectOptions, rendererType: backend },
      controller.signal,
      vectorLodReservation
    );
    const objectReadyMs = performance.now() - loadStart;
    const lodTiming = consumeVectorStrokeLodBuildTiming();
    if (activeLoadToken !== loadToken) {
      nextObject.dispose();
      nextObject = null;
      return;
    }

    await layerControls.prepareReplacement(nextObject, controller.signal);
    controller.signal.throwIfAborted();
    const pageLayoutReplacement = await preparePageLayoutReplacement(nextObject, controller.signal);
    controller.signal.throwIfAborted();
    updateLoadingProgress(activeLoadToken, {
      value: 1,
      stage: "first-render",
      sourceType: nextObject.sourceKind === "pdf" ? "pdf" : "hep"
    });
    // Include shader preparation and the detached first submit in the upload
    // timing. Keep the old canvas displayed until its successor has a frame.
    const firstSubmitStart = performance.now();
    preparedBackend = await prepareThreeRendererBackend(backend, controller.signal);
    controller.signal.throwIfAborted();
    const submitRenderer = preparedBackend?.renderer ?? renderer;
    // WebGPU updates camera clip conventions. A detached camera lets the old
    // renderer continue drawing while asynchronous compilation is pending.
    const submitCamera = camera.clone();
    submitCamera.position.copy(cameraSnapshot.position);
    submitCamera.quaternion.copy(cameraSnapshot.quaternion);
    submitCamera.up.copy(cameraSnapshot.up);
    submitCamera.coordinateSystem = submitRenderer.coordinateSystem;
    submitCamera.updateProjectionMatrix();
    submitCamera.updateMatrixWorld(true);
    const previewScene = new THREE.Scene();
    previewScene.add(nextObject);
    try {
      await nextObject.compileForThreeRenderer(submitRenderer, submitCamera, controller.signal);
      controller.signal.throwIfAborted();
      if (preparedBackend) {
        prepareThreeRendererFrame(submitRenderer);
        submitRenderer.render(previewScene, submitCamera);
      }
    } finally {
      previewScene.remove(nextObject);
    }
    controller.signal.throwIfAborted();
    if (activeLoadToken !== loadToken) return;
    if (preparedBackend) {
      installThreeRendererBackend(preparedBackend, { disposeCurrentPdfObject: false });
      preparedBackend = null;
    }
    replacePdfObject(nextObject, { fitCamera: false, pageLayoutView: pageLayoutReplacement });
    targetInstalled = true;
    const installedObject = nextObject;
    nextObject = null;
    restoreCameraSnapshot(cameraSnapshot);
    requestRender();
    await waitForLoad(waitForNextRenderedFrame(activeLoadToken), controller.signal);
    if (activeLoadToken !== loadToken) return;
    const firstSubmitMs = performance.now() - firstSubmitStart;
    await warmThreeRenderer(activeLoadToken, controller.signal);
    if (activeLoadToken !== loadToken) return;
    const totalLoadMs = performance.now() - loadStart;
    lastLoadTimingText = formatLoadTiming(
      totalLoadMs,
      lodTiming.elapsedMs,
      lodTiming.buildCount,
      firstSubmitMs,
      objectReadyMs
    );
    updateSceneMetrics(installedObject);
    setDownloadDataButtonState(true);
    setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
    if (installedObject.sourceOptions?.ocrTextOnly) setStatus("Text-only view: pictures and diagrams are omitted. Pages without stored text are blank.");
    else clearLoadedStatus();
  } catch (error) {
    if (nextObject && currentPdfObject === nextObject) {
      targetInstalled = true;
      nextObject = null;
    }
    nextObject?.dispose();
    nextObject = null;
    preparedBackend?.renderer.dispose();
    preparedBackend = null;
    const message = error instanceof Error ? error.message : String(error);
    if (activeLoadToken !== loadToken) {
      return;
    }
    backendSelectElement.value = targetInstalled ? backend : previousBackend;
    try {
      if (!targetInstalled && activeThreeRendererBackend !== previousBackend) {
        await ensureThreeRendererBackend(previousBackend, { disposeCurrentPdfObject: false });
      }
      restoreCameraSnapshot(cameraSnapshot);
    } catch {
      // Leave the original error visible; the user action needs attention.
    }
    setStatus(
      targetInstalled
        ? `Renderer switched, but finalization failed: ${message}`
        : `Failed to switch renderer: ${message}`
    );
  } finally {
    nextObject?.dispose();
    preparedBackend?.renderer.dispose();
    vectorLodReservation?.release();
    if (activeLoadToken === loadToken) {
      sourceLoadController = null;
      setLoadingProgress(false);
      setLoadControlsEnabled(true);
      setDownloadDataButtonState(Boolean(currentPdfObject));
      setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
      backendSelectElement.disabled = false;
      vectorLodSelectElement.disabled = false;
      textLodSelectElement.disabled = false;
      updateDrawStatsMeter();
      updateLodStatsMeter();
      requestRender();
    }
  }
}

function replacePdfObject(
  nextObject: HeprThreePdfObject,
  options: { fitCamera?: boolean; pageLayoutView?: PageLayoutView | null } = {}
): void {
  const previousObject = currentPdfObject;
  const sameScene = previousObject?.sceneData === nextObject.sceneData;
  nextObject.renderer.setInteractionViewportProvider(() => renderer.domElement.getBoundingClientRect());
  lastNativeDrawStats = null;
  nextObject.setFrameListener((stats) => {
    lastNativeDrawStats = stats;
    drawCallCounter.recordNativeFrame(stats.drawCalls);
  });
  if (!sameScene) disposeCurrentObject({ clearMetrics: options.fitCamera !== false });
  currentPdfObject = nextObject;
  if (nextObject.sourceKind === "pdf") {
    loadedCompressScansPreference = compressScansCheckboxElement.checked && !nextObject.sourceOptions?.ocrTextOnly;
  }
  nextObject.addEventListener("change", event => {
    if (currentPdfObject !== nextObject) return;
    if (event.reason === "pages-loaded") {
      updateSceneMetrics(nextObject);
      drawingSelection.sceneChanged();
      annotationOverlay.sceneChanged(); annotationControls.sceneChanged(); annotationInteraction?.refresh();
      refreshSearchAvailability();
      if (textSearchInputElement.value.trim()) runSearch(textSearchInputElement.value, false);
    }
    requestRender();
  });
  resetPageLayout(options.pageLayoutView);
  layerControls.objectChanged();
  scene.add(nextObject);
  resetFpsMeter();
  drawCallMeter.reset();
  refreshDropIndicator();
  if (options.fitCamera !== false) {
    fitCameraToPdfObject(nextObject);
  }
  updateCameraClipping(true);
  if (sameScene) {
    // The controller releases the old object's interaction resources and
    // reapplies selection/colors before that object's renderer is disposed.
    try { drawingSelection.rendererChanged(); }
    finally { releasePdfObject(previousObject!); }
  } else drawingSelection.sceneChanged();
  annotationOverlay.sceneChanged();
  annotationControls.sceneChanged();
  annotationInteraction?.refresh();
  updateDrawStatsMeter();
  setDownloadDataButtonState(true);
  refreshSearchAvailability();
  if (textSearchInputElement.value.trim().length > 0 && nextObject.hasSearchableText) {
    // Restore the active query on the new object without yanking the camera.
    runSearch(textSearchInputElement.value, false);
  }
  requestRender();
}

function releasePdfObject(object: HeprThreePdfObject): void {
  object.setFrameListener(null);
  object.renderer.setInteractionViewportProvider(null);
  scene.remove(object);
  object.dispose();
}

function disposeCurrentObject(options: { clearMetrics?: boolean } = {}): void {
  if (!currentPdfObject) {
    return;
  }
  const clearMetrics = options.clearMetrics !== false;
  const previousObject = currentPdfObject;
  currentPdfObject = null;
  resetPageLayout();
  layerControls.objectChanged();
  drawingSelection.sceneChanged();
  annotationOverlay.sceneChanged();
  annotationControls.sceneChanged();
  annotationInteraction?.sceneChanged();
  releasePdfObject(previousObject);
  lastNativeDrawStats = null;
  if (clearMetrics) {
    drawCallMeter.reset();
    lastDownloadablePdf = null;
    fileValueElement.textContent = "-";
    sourceSegmentsValueElement.textContent = "-";
    visibleSegmentsValueElement.textContent = "-";
    timesValueElement.textContent = "-";
    setDrawStatsText("-");
    setLodStatsText("-");
    setTextLodStatsText("-");
    setDownloadDataButtonState(false);
    setDownloadPdfButtonState(false);
  }
  refreshSearchAvailability();
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
  ocrTextCheckboxElement.disabled = !enabled || currentPdfObject?.sourceKind === "hep";
  if (enabled && currentPdfObject) ocrTextCheckboxElement.checked = currentPdfObject.sourceOptions?.ocrTextOnly === true;
  compressScansCheckboxElement.disabled = !enabled || currentPdfObject?.sourceKind === "hep";
  if (enabled && currentPdfObject) {
    compressScansCheckboxElement.checked = loadedCompressScansPreference && !ocrTextCheckboxElement.checked;
  }
  pageStreamingCheckboxElement.disabled = !enabled || currentPdfObject?.sourceKind === "hep";
  if (enabled && currentPdfObject) {
    pageStreamingCheckboxElement.checked = currentPdfObject.sourceOptions?.pageLoading === "auto" && !compressScansCheckboxElement.checked;
  }
  openButtonElement.disabled = !enabled;
  fileInputElement.disabled = !enabled;
  exampleDropdown.setDisabled(!enabled);
  for (const button of pageLayoutButtons) {
    button.disabled = !enabled;
  }
}

function setDownloadDataButtonState(hasParsedData: boolean, isBusy = false): void {
  downloadDataButtonElement.hidden = !hasParsedData;
  downloadDataButtonElement.disabled = !hasParsedData || isBusy;
  downloadDataButtonElement.textContent = isBusy ? "Preparing HEP..." : "Download HEP";
}

function setDownloadPdfButtonState(hasPdf: boolean, isBusy = false): void {
  downloadPdfButtonElement.hidden = !hasPdf;
  downloadPdfButtonElement.disabled =
    !hasPdf || isBusy || activeHepExportController !== null;
  downloadPdfButtonElement.textContent = isBusy ? "Preparing PDF..." : "Download PDF";
}

function refreshDropIndicator(): void {
  const shouldShow = isDropDragActive || !currentPdfObject;
  dropIndicatorElement.classList.toggle("active", shouldShow);
  dropIndicatorElement.classList.toggle("dragging", isDropDragActive);
}

async function loadSupportedFile(file: File): Promise<void> {
  if (!isPdfFile(file) && !isHepFile(file)) {
    setStatus(`Unsupported file type: ${file.name}`);
    return;
  }
  await loadSource(file);
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

function initializeBackendSelect(): void {
  const webGpuOption = Array.from(backendSelectElement.options).find((option) => option.value === "webgpu");
  const webGpuSupported = typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";
  if (!webGpuSupported && webGpuOption) {
    webGpuOption.disabled = true;
    if (backendSelectElement.value === "webgpu") {
      backendSelectElement.value = "webgl";
    }
    backendSelectElement.title = "WebGPU is not available in this browser/GPU.";
    return;
  }
  if (webGpuOption) {
    webGpuOption.disabled = false;
  }
  backendSelectElement.title = "WebGPU backend available.";
}

function updateSceneMetrics(pdfObject: HeprThreePdfObject): void {
  const sceneData = pdfObject.sceneData;
  const sourceSegments = sceneData.sourceSegmentCount;
  const visibleSegments = sceneData.segmentCount;
  const totalReduction = sourceSegments > 0 ? (1 - visibleSegments / sourceSegments) * 100 : 0;
  const sourceKindLabel = pdfObject.sourceKind === "pdf" ? "PDF" : "HEP";
  fileValueElement.textContent = `${pdfObject.sourceLabel} (${sourceKindLabel})`;
  sourceSegmentsValueElement.textContent = sourceSegments.toLocaleString();
  visibleSegmentsValueElement.textContent =
    `${visibleSegments.toLocaleString()} (${Math.max(0, totalReduction).toFixed(1)}% total reduction), fills ${sceneData.fillPathCount.toLocaleString()}, text ${sceneData.textInstanceCount.toLocaleString()} instances, pages ${sceneData.pageCount.toLocaleString()} (${sceneData.pagesPerRow.toLocaleString()}/row)`;
  timesValueElement.textContent = lastLoadTimingText;
}

async function downloadHep(): Promise<boolean> {
  const pdfObject = currentPdfObject;
  if (!pdfObject) {
    setStatus("No parsed floorplan data available to export.");
    return false;
  }
  if (activeHepExportController !== null) {
    return false;
  }



  const exportController = new AbortController();
  pdfObject.pausePageLoading();
  activeHepExportController = exportController;
  setDownloadDataButtonState(true, true);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
  setLoadControlsEnabled(false);
  backendSelectElement.disabled = true;
  vectorLodSelectElement.disabled = true;
  textLodSelectElement.disabled = true;
  setLoadingProgress(true, "0.00% Preparing HEP export...");
  try {
    const needsCompleteScene = pdfObject.isPageDemandLoaded || Boolean(pdfObject.sourceOptions?.ocrTextOnly);
    const selectedLodOptions = await promptForHepLod(pdfObject.sceneData, exportController.signal);
    if (!selectedLodOptions) return false;
    const lodOptions = resolveHepLodOptions(selectedLodOptions);
    const exportWarnings: string[] = [];
    const scenePhaseEnd = needsCompleteScene ? 0.8 : 0;
    const updateExportProgress = (progress: PDFLoadProgress, start: number, end: number): void => {
      if (activeHepExportController !== exportController || currentPdfObject !== pdfObject) return;
      const stageLabel = formatLoadProgressStage(progress.stage);
      const value = start + Math.max(0, Math.min(1, Number(progress.value) || 0)) * (end - start);
      setLoadingProgress(true, `${(value * 100).toFixed(2)}% ${stageLabel}`);
    };
    await yieldToBrowserPaint();
    exportController.signal.throwIfAborted();
    if (activeHepExportController !== exportController || currentPdfObject !== pdfObject) return false;
    const exportScene = needsCompleteScene
      ? await pdfObject.loadCompleteScene({
        signal: exportController.signal,
        onProgress: (progress) => updateExportProgress(progress, 0, scenePhaseEnd)
      })
      : pdfObject.sceneData;
    exportController.signal.throwIfAborted();
    if (activeHepExportController !== exportController || currentPdfObject !== pdfObject) return false;
    const hepOptions = {
      ...lodOptions,
      sourceLabel: pdfObject.sourceLabel,
      sourcePdfByteLength: pdfObject.sourceKind === "pdf" ? pdfObject.sourceBytes?.byteLength : undefined,
      signal: exportController.signal,
      onWarning: (message: string) => {
        if (activeHepExportController === exportController) exportWarnings.push(message);
      },
      onProgress: (progress: PDFLoadProgress) => {
        updateExportProgress(progress, scenePhaseEnd, 1);
      }
    };
    const hepBlob = await buildHep(exportScene, hepOptions);

    if (activeHepExportController !== exportController || currentPdfObject !== pdfObject) return false;
    exportController.signal.throwIfAborted();
    const hepFileName = `${sanitizeDownloadName(pdfObject.sourceLabel)}-parsed-data${hasSelectedHepLod(exportScene, lodOptions) ? "-lod" : ""}.hep`;
    triggerBrowserDownload(hepBlob, hepFileName);
    if (activeHepExportController !== exportController || currentPdfObject !== pdfObject) return false;
    exportController.signal.throwIfAborted();
    if (exportWarnings.length > 0) setStatus(`HEP downloaded. Warning: ${exportWarnings.join(" ")}`);
    return true;
  } catch (error) {
    if (activeHepExportController === exportController) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to download parsed data: ${message}`);
    }
    return false;
  } finally {
    if (currentPdfObject === pdfObject &&
      (activeHepExportController === exportController || activeHepExportController === null)) {
      pdfObject.resumePageLoading();
    }
    if (activeHepExportController === exportController) {
      activeHepExportController = null;
      setLoadingProgress(false);
      setLoadControlsEnabled(true);
      backendSelectElement.disabled = false;
      vectorLodSelectElement.disabled = false;
      textLodSelectElement.disabled = false;
      setDownloadDataButtonState(Boolean(currentPdfObject), false);
      setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
    }
  }
}

function cancelActiveHepExport(): void {
  const controller = activeHepExportController;
  if (!controller) {
    return;
  }
  activeHepExportController = null;
  controller.abort();
  setLoadingProgress(false);
  setLoadControlsEnabled(true);
  backendSelectElement.disabled = false;
  vectorLodSelectElement.disabled = false;
  textLodSelectElement.disabled = false;
  setDownloadDataButtonState(Boolean(currentPdfObject), false);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
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

async function resolveDownloadablePdfSource(
  source: File | string,
  pdfObject: HeprThreePdfObject,
  hint: PdfDownloadSource | null,
  signal?: AbortSignal
): Promise<PdfDownloadSource | null> {
  if (pdfObject.sourceKind === "pdf") {
    if (source instanceof File) {
      return { label: source.name, blob: source };
    }
    return {
      label: filenameFromUrl(source, pdfObject.sourceLabel),
      url: source
    };
  }

  if (hint) {
    return hint;
  }

  signal?.throwIfAborted();
  return null;
}

function formatLoadTiming(
  totalLoadMs: number,
  lodMs: number,
  lodBuildCount: number,
  firstSubmitMs: number,
  objectReadyMs: number
): string {
  const prepareMs = Math.max(0, objectReadyMs - Math.max(0, lodMs));
  const lodText = lodBuildCount > 0 ? `${lodMs.toFixed(0)} ms` : "-";
  // renderer.render() submits work but does not wait for WebGPU completion, so
  // describing this as GPU render time would make the backend comparison
  // misleading. It is the CPU-side latency until the first frame is submitted.
  return `total ${totalLoadMs.toFixed(0)} ms, parse/prepare ${prepareMs.toFixed(0)} ms, vector lod ${lodText}, first submit ${firstSubmitMs.toFixed(0)} ms`;
}

function updateLoadingProgress(token: number, progress: PDFLoadProgress): void {
  if (token !== loadToken) {
    return;
  }
  const stageLabel = formatLoadProgressStage(progress.stage);
  const value = Math.max(0, Math.min(1, Number(progress.value) || 0));
  setLoadingProgress(true, `${(value * 100).toFixed(2)}% ${stageLabel}`);
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
      // Sample every frame so the average stays honest, but write the DOM at a
      // readable rate: the text assignment forces layout and paint, which at
      // 240Hz costs more than the frame it is measuring.
      fpsSmoothed = fpsSmoothed === 0 ? fpsNow : fpsSmoothed * 0.85 + fpsNow * 0.15;
      if (now - fpsTextLastUpdateTime >= HUD_TEXT_UPDATE_INTERVAL_MS) {
        fpsTextLastUpdateTime = now;
        fpsValueElement.textContent = `${fpsSmoothed.toFixed(0)} FPS`;
      }
    }
  }
  fpsLastSampleTime = now;
}

function resetFpsMeter(): void {
  fpsLastSampleTime = 0;
  fpsSmoothed = 0;
  fpsTextLastUpdateTime = 0;
  fpsValueElement.textContent = "-";
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
  const textStats = currentPdfObject.getTextInstanceStats();
  const textPart = textStats && textStats.total > 0
    ? ` | ${textStats.rendered.toLocaleString()}/${textStats.total.toLocaleString()} text (${textStats.mode})`
    : "";
  // Minified pages hold the paint scheduler's coverage margin, which bounds the
  // draw count by letting sub-pixel neighbours swap order.
  const paintOrderPart = currentPdfObject.isPaintOrderApproximated() ? " | paint order: held" : "";
  setDrawStatsText(
    `${renderedSegments.toLocaleString()}/${totalSegments.toLocaleString()} segments${textPart} | mode: ${mode}${paintOrderPart}`
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
  setLodStatsText(formatVectorStrokeLodStats(stats) || "-");
  const textStats = currentPdfObject?.getTextLodStats() ?? null;
  setTextLodStatsText(formatTextLodStats(textStats) || "-");
}

function setLodStatsText(text: string): void {
  if (text === lodStatsLastText) {
    return;
  }
  lodStatsLastText = text;
  lodStatsValueElement.textContent = text;
}

function setTextLodStatsText(text: string): void {
  if (text === textLodStatsLastText) {
    return;
  }
  textLodStatsLastText = text;
  textLodStatsValueElement.textContent = text;
}

async function loadExampleManifest(): Promise<void> {
  exampleSelectionMap.clear();
  exampleDropdown.setPlaceholder("Examples (loading...)");

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
    console.warn(`[Three Example] Failed to load manifest: ${message}`);
    exampleDropdown.setPlaceholder("Examples unavailable");
  }
}

function populateExampleDropdown(entries: NormalizedExampleEntry[]): void {
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
    if (entry.hepLodPath) {
      exampleSelectionMap.set(hepKey, {
        id: entry.id,
        sourceName: entry.name,
        kind: "hep",
        path: entry.hepLodPath,
        pdfPath: entry.pdfPath
      });
    }

    items.push({
      name: entry.name,
      actions: [
        {
          key: pdfKey,
          label: "PDF",
          sizeLabel: formatFileSize(entry.pdfSizeBytes),
          title: `Parse ${entry.name} from the original PDF`
        },
        ...(entry.hepLodPath ? [{
          key: hepKey,
          label: "HEP",
          sizeLabel: formatFileSize(entry.hepLodSizeBytes ?? 0),
          title: `Load precomputed HEP data for ${entry.name}`
        }] : [])
      ]
    });
  }

  exampleDropdown.setItems(items);
}

async function loadExampleSelection(selectionKey: string): Promise<void> {
  const selection = exampleSelectionMap.get(selectionKey);
  if (!selection) {
    return;
  }

  exampleDropdown.setDisabled(true);
  try {
    const modeLabel = selection.kind === "pdf" ? "PDF" : "HEP";
    setStatus(`Loading example ${selection.sourceName} (${modeLabel})...`);
    await loadSource(selection.path, {
      pdfDownloadHint: {
        label: selection.sourceName,
        url: selection.pdfPath
      }
    });
  } finally {
    exampleDropdown.setDisabled(false);
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

function readVectorLodMode(): VectorLodMode {
  const value = vectorLodSelectElement.value;
  return value === "off" || value === "force" ? value : "auto";
}

function readTextLodMode(): TextLodMode {
  return textLodSelectElement.value === "off" ? "off" : "auto";
}

function readBackendMode(): HeprRendererType {
  return backendSelectElement.value === "webgpu" ? "webgpu" : "webgl";
}

function formatBackendLabel(backend: HeprRendererType): string {
  return backend === "webgpu" ? "WebGPU" : "WebGL";
}

function readTouchRotateEnabled(): boolean {
  return touchRotateCheckboxElement.checked;
}

function syncTouchRotateVisibility(): void {
  touchRotateRowElement.hidden = !touchControlsAvailable;
}

function applyTouchGestureMode(targetControls: MapControls): void {
  targetControls.touches.ONE = THREE.TOUCH.PAN;
  targetControls.touches.TWO = readTouchRotateEnabled()
    ? THREE.TOUCH.DOLLY_ROTATE
    : THREE.TOUCH.DOLLY_PAN;
}

function hasTouchCapability(): boolean {
  const touchNavigator = navigator as Navigator & {
    maxTouchPoints?: number;
    msMaxTouchPoints?: number;
  };
  if ((touchNavigator.maxTouchPoints ?? 0) > 0 || (touchNavigator.msMaxTouchPoints ?? 0) > 0) {
    return true;
  }
  return window.matchMedia?.("(any-pointer: coarse)").matches === true;
}

function formatVectorLodMode(mode: VectorLodMode): string {
  return mode === "off" ? "Off" : mode === "force" ? "Force" : "Auto";
}

function formatTextLodMode(mode: TextLodMode): string {
  return mode === "off" ? "Off" : "Auto";
}

type ExampleSelectionKind = "pdf" | "hep";

interface ExampleSelection {
  id: string;
  sourceName: string;
  kind: ExampleSelectionKind;
  path: string;
  pdfPath: string;
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

function captureCameraSnapshot(): CameraSnapshot {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    up: camera.up.clone(),
    target: controls.target.clone(),
    clipCenter: currentContentCenter.clone(),
    clipRadius: currentContentRadius
  };
}

function restoreCameraSnapshot(snapshot: CameraSnapshot): void {
  camera.position.copy(snapshot.position);
  camera.quaternion.copy(snapshot.quaternion);
  camera.up.copy(snapshot.up);
  controls.target.copy(snapshot.target);
  currentContentCenter.copy(snapshot.clipCenter);
  currentContentRadius = snapshot.clipRadius;
  updatePerspectiveCameraProjection();
  updateCameraClipping(true);
  controls.update();
}

function fitCameraToObject(targetObject: THREE.Object3D, updateClipForTarget: boolean, previewCamera?: THREE.PerspectiveCamera): void {
  if (previewCamera) targetObject.updateWorldMatrix(true, true);
  else scene.updateMatrixWorld(true);
  const fitCamera = previewCamera ?? camera;
  const fitTarget = previewCamera ? controls.target.clone() : controls.target;
  if (tempObjectBounds.setFromObject(targetObject).isEmpty()) {
    return;
  }

  tempObjectBounds.getSize(tempObjectSize);
  tempObjectBounds.getCenter(tempObjectCenter);

  const objectWidth = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.x);
  const objectHeight = Math.max(MIN_OBJECT_EXTENT, tempObjectSize.y);
  const viewport = resolveRendererViewportPixels();
  const widthPaddingFactor = viewport.width / Math.max(1, viewport.width - CAMERA_FIT_PADDING_PIXELS * 2);
  const heightPaddingFactor = viewport.height / Math.max(1, viewport.height - CAMERA_FIT_PADDING_PIXELS * 2);
  const paddedWidth = objectWidth * widthPaddingFactor;
  const paddedHeight = objectHeight * heightPaddingFactor;

  const verticalFovRadians = THREE.MathUtils.degToRad(fitCamera.fov);
  const horizontalFovRadians = 2 * Math.atan(Math.tan(verticalFovRadians * 0.5) * Math.max(1e-6, fitCamera.aspect));
  const distanceForHeight = (paddedHeight * 0.5) / Math.tan(verticalFovRadians * 0.5);
  const distanceForWidth = (paddedWidth * 0.5) / Math.tan(horizontalFovRadians * 0.5);
  const distance = Math.max(1e-3, distanceForHeight, distanceForWidth);

  tempViewDirection.subVectors(fitCamera.position, fitTarget);
  if (tempViewDirection.lengthSq() <= 1e-12) {
    tempViewDirection.set(0, 0, 1);
  } else {
    tempViewDirection.normalize();
  }

  fitCamera.position.copy(tempObjectCenter).addScaledVector(tempViewDirection, distance);
  fitTarget.set(tempObjectCenter.x, tempObjectCenter.y, tempObjectCenter.z);
  if (previewCamera) {
    updateCameraClipping(true, fitCamera, fitTarget, tempObjectCenter, Math.max(MIN_OBJECT_EXTENT, tempObjectSize.length() * 0.5));
    return;
  }
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

function updateCameraClipping(force = false, targetCamera = camera, target = controls.target,
  contentCenter = currentContentCenter, contentRadius = currentContentRadius): void {
  const distanceToTarget = targetCamera.position.distanceTo(target);
  const targetOffset = tempClipDelta.subVectors(contentCenter, target).length();
  const span = Math.max(MIN_OBJECT_EXTENT, contentRadius + targetOffset);
  const margin = span * CAMERA_CLIP_MARGIN_MULTIPLIER;
  // No content is nearer than the clip sphere's closest view depth. Keeping the
  // near plane just in front of it preserves depth precision for 3D page layouts.
  const contentDepth = distanceToTarget > 0
    ? tempClipDelta.subVectors(contentCenter, targetCamera.position)
      .dot(tempClipForward.subVectors(target, targetCamera.position)) / distanceToTarget - contentRadius
    : 0;

  const nextNear = Math.max(
    CAMERA_CLIP_NEAR_MIN,
    Math.min(distanceToTarget * 0.5, Math.max(distanceToTarget - margin, contentDepth * 0.9))
  );
  const nextFar = Math.max(nextNear + 10, distanceToTarget + margin);

  if (
    !force &&
    Math.abs(targetCamera.near - nextNear) <= CAMERA_CLIP_UPDATE_EPSILON &&
    Math.abs(targetCamera.far - nextFar) <= CAMERA_CLIP_UPDATE_EPSILON
  ) {
    return;
  }

  targetCamera.near = nextNear;
  targetCamera.far = nextFar;
  targetCamera.updateProjectionMatrix();
}
