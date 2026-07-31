import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { MapControls } from "three/addons/controls/MapControls.js";

import {
  createTextSelectionController,
  pdfObjectGenerator,
  consumeVectorStrokeLodBuildTiming,
  resetVectorStrokeLodBuildTiming,
  type HeprRendererType,
  type HeprTextSearchMatch,
  type HeprThreeObjectOptions,
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
import { createExampleDropdown, type ExampleDropdownItem } from "./exampleDropdown";
import { formatLoadProgressStage } from "./loadProgress";
import { formatVectorStrokeLodStats } from "./vectorStrokeLodStatsFormat";
import {
  buildParsedDataZipBlobForLayout,
  listSceneRasterLayers,
  tryReadSourcePdfBytesFromExistingParsedZip,
  type TextureLayout
} from "./parsedDataZip";
import {
  filenameFromUrl,
  formatPdfDownloadFilename,
  readPdfDownloadBlob,
  readPdfDownloadBytes,
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
const touchRotateCheckbox = document.querySelector<HTMLInputElement>("#touch-rotate-checkbox");
const textSelectionCheckbox = document.querySelector<HTMLInputElement>("#text-selection-checkbox");
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
const drawStatsValue = document.querySelector<HTMLSpanElement>("#draw-stats-value");
const lodStatsValue = document.querySelector<HTMLSpanElement>("#lod-stats-value");
const dropIndicator = document.querySelector<HTMLDivElement>("#drop-indicator");
const textSearchInput = document.querySelector<HTMLInputElement>("#text-search-input");
const textSearchCount = document.querySelector<HTMLSpanElement>("#text-search-count");
const textSearchPrevButton = document.querySelector<HTMLButtonElement>("#text-search-prev");
const textSearchNextButton = document.querySelector<HTMLButtonElement>("#text-search-next");
const textSearchCaseButton = document.querySelector<HTMLButtonElement>("#text-search-case");

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
  !touchRotateCheckbox ||
  !textSelectionCheckbox ||
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
  !drawStatsValue ||
  !lodStatsValue ||
  !dropIndicator ||
  !textSearchInput ||
  !textSearchCount ||
  !textSearchPrevButton ||
  !textSearchNextButton ||
  !textSearchCaseButton
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
const touchRotateCheckboxElement = touchRotateCheckbox;
const textSelectionCheckboxElement = textSelectionCheckbox;
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
const drawStatsValueElement = drawStatsValue;
const lodStatsValueElement = lodStatsValue;
const dropIndicatorElement = dropIndicator;
const textSearchInputElement = textSearchInput;
const textSearchCountElement = textSearchCount;
const textSearchPrevButtonElement = textSearchPrevButton;
const textSearchNextButtonElement = textSearchNextButton;
const textSearchCaseButtonElement = textSearchCaseButton;
const lifetimeAbortController = new AbortController();
const lifetimeSignal = lifetimeAbortController.signal;
let loadToken = 0;
const CAMERA_FIT_PADDING_PIXELS = 64;
const MIN_OBJECT_EXTENT = 1e-3;
const DEFAULT_PERSPECTIVE_FOV_DEGREES = 45;
const CAMERA_CLIP_NEAR_MIN = 0.01;
const CAMERA_CLIP_MARGIN_MULTIPLIER = 3.5;
const CAMERA_CLIP_UPDATE_EPSILON = 1e-3;
const NATIVE_CLEAR_COLOR_R = 160 / 255;
const NATIVE_CLEAR_COLOR_G = 169 / 255;
const NATIVE_CLEAR_COLOR_B = 175 / 255;
const EXPORT_TEXTURE_LAYOUT: TextureLayout = "interleaved";
const EXPORT_ZIP_COMPRESSION: "STORE" | "DEFLATE" = "DEFLATE";
const EXPORT_ZIP_DEFLATE_LEVEL = 9;
const EXPORT_ENCODE_RASTER_IMAGES = true;
const tempObjectBounds = new THREE.Box3();
const tempObjectSize = new THREE.Vector3();
const tempObjectCenter = new THREE.Vector3();
const tempViewDirection = new THREE.Vector3();
const tempClipDelta = new THREE.Vector3();
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
type WebGpuRendererParametersWithCanvas = ConstructorParameters<typeof WebGPURenderer>[0] & {
  canvas: HTMLCanvasElement;
};

let activeThreeRendererBackend: HeprRendererType = "webgl";
let renderer: ThreeExampleRenderer = createWebGlThreeRenderer(canvasElement);

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

const textSelection = createTextSelectionController({
  getCanvas: () => canvasElement,
  enabled: textSelectionCheckboxElement.checked,
  adapter: {
    getScene: () => currentPdfObject?.sceneData ?? null,
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
let lodStatsLastText = "";
let lastLoadTimingText = "-";
let renderedFrameSerial = 0;
let touchControlsAvailable = hasTouchCapability();
let isDropDragActive = false;
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

initializeBackendSelect();
setPanelCollapsed(false);
setDownloadDataButtonState(false);
setDownloadPdfButtonState(false);
refreshDropIndicator();

function createWebGlThreeRenderer(targetCanvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const nextRenderer = new THREE.WebGLRenderer({
    canvas: targetCanvas,
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance"
  });
  configureThreeRenderer(nextRenderer);
  return nextRenderer;
}

async function createWebGpuThreeRenderer(targetCanvas: HTMLCanvasElement): Promise<WebGPURenderer> {
  const nextRenderer = new WebGPURenderer({
    canvas: targetCanvas,
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false
  } as WebGpuRendererParametersWithCanvas);
  configureThreeRenderer(nextRenderer);
  await nextRenderer.init();
  return nextRenderer;
}

function configureThreeRenderer(nextRenderer: ThreeExampleRenderer): void {
  nextRenderer.toneMapping = THREE.NoToneMapping;
  nextRenderer.outputColorSpace = THREE.SRGBColorSpace;
  nextRenderer.autoClear = false;
  nextRenderer.setClearColor(createNativeClearColor(), 1);
  nextRenderer.setPixelRatio(window.devicePixelRatio || 1);
  nextRenderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
}

function createNativeClearColor(): THREE.Color {
  return new THREE.Color().setRGB(
    NATIVE_CLEAR_COLOR_R,
    NATIVE_CLEAR_COLOR_G,
    NATIVE_CLEAR_COLOR_B,
    THREE.SRGBColorSpace
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
  nextCanvas.width = Math.max(1, canvasElement.width);
  nextCanvas.height = Math.max(1, canvasElement.height);
  return nextCanvas;
}

async function ensureThreeRendererBackend(
  backend: HeprRendererType,
  options: { disposeCurrentPdfObject?: boolean } = {}
): Promise<void> {
  if (backend === activeThreeRendererBackend) {
    return;
  }

  const disposeCurrentPdfObject = options.disposeCurrentPdfObject !== false;
  const previousControlsTarget = controls.target.clone();
  const previousCanvas = canvasElement;
  const nextCanvas = createReplacementViewportCanvas();
  const nextRenderer = backend === "webgpu"
    ? await createWebGpuThreeRenderer(nextCanvas)
    : createWebGlThreeRenderer(nextCanvas);

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

  previousCanvas.replaceWith(nextCanvas);
  canvasElement = nextCanvas;
  canvasResizeObserver.disconnect();
  canvasResizeObserver.observe(nextCanvas);
  renderer = nextRenderer;
  activeThreeRendererBackend = backend;
  controls = createMapControls();
  controls.target.copy(previousControlsTarget);
  updatePerspectiveCameraProjection();
  updateCameraClipping();
  requestRender();
}

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
  renderer.clearDepth();
  renderer.render(scene, camera);
  textSelection.updateOverlay();
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
  void downloadParsedDataZip();
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

touchRotateCheckboxElement.addEventListener("change", () => {
  applyTouchGestureMode(controls);
  setStatus(`Touch rotate ${readTouchRotateEnabled() ? "enabled" : "disabled"}.`);
  requestRender();
}, { signal: lifetimeSignal });

textSelectionCheckboxElement.addEventListener("change", () => {
  if (textSelectionCheckboxElement.checked) {
    textSelection.enable();
  } else {
    textSelection.disable();
  }
  setStatus(`Text selection ${textSelectionCheckboxElement.checked ? "enabled" : "disabled"}.`);
}, { signal: lifetimeSignal });

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
  const supported = files.find((file) => isPdfFile(file) || isParsedDataZipFile(file));

  if (!supported) {
    setStatus("Dropped file is not a supported PDF or parsed zip.");
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
      : "No text data in this ZIP - re-export to enable search";
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

  const localBounds = match.localBounds;
  const center = pdfObject.localToWorld(
    new THREE.Vector3((localBounds.minX + localBounds.maxX) * 0.5, (localBounds.minY + localBounds.maxY) * 0.5, 0)
  );
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

  tempViewDirection.subVectors(camera.position, controls.target);
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

function readThreeObjectOptions(): Omit<HeprThreeObjectOptions, "rendererType"> {
  const pageBackground = readPageBackgroundColor();
  const vectorOverride = readVectorOverrideColor();
  return {
    vectorLod: readVectorLodMode(),
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
  const activeLoadToken = ++loadToken;
  const backend = readBackendMode();
  const sourceLabel = typeof source === "string" ? source : source.name;
  const objectOptions = readThreeObjectOptions();
  const previousPdfObject = currentPdfObject;
  const previousDownloadablePdf = lastDownloadablePdf;
  setStatus(`Loading ${sourceLabel} with ${backend.toUpperCase()}...`);
  setLoadingProgress(true, "Parsing / loading 0.00%");
  setLoadControlsEnabled(false);
  setDownloadDataButtonState(false);
  setDownloadPdfButtonState(false);
  backendSelectElement.disabled = true;
  vectorLodSelectElement.disabled = true;

  try {
    const loadStart = performance.now();
    await ensureThreeRendererBackend(backend);
    if (activeLoadToken !== loadToken) {
      return;
    }
    resetVectorStrokeLodBuildTiming();
    const nextObject = await pdfObjectGenerator(
      source,
      {
        ...objectOptions,
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
    lastDownloadablePdf = await resolveDownloadablePdfSource(source, nextObject, options.pdfDownloadHint ?? null);
    setDownloadDataButtonState(true);
    setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
    updateLoadingProgress(activeLoadToken, {
      value: 1,
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
    if (currentPdfObject === previousPdfObject) {
      lastDownloadablePdf = previousDownloadablePdf;
      setDownloadDataButtonState(Boolean(currentPdfObject), false);
      setDownloadPdfButtonState(Boolean(lastDownloadablePdf), false);
    }
    setStatus(`Failed to load source: ${message}`);
  } finally {
    if (activeLoadToken === loadToken) {
      setLoadingProgress(false);
      setLoadControlsEnabled(true);
      backendSelectElement.disabled = false;
      vectorLodSelectElement.disabled = false;
    }
  }
}

async function reloadSourceWithBackend(backend: HeprRendererType): Promise<void> {
  const previousObject = currentPdfObject;
  const source = lastLoadedSource;
  if (!previousObject || !source || backend === activeThreeRendererBackend) {
    return;
  }

  const activeLoadToken = ++loadToken;
  const previousBackend = activeThreeRendererBackend;
  const cameraSnapshot = captureCameraSnapshot();
  const objectOptions = readThreeObjectOptions();
  let nextObject: HeprThreePdfObject | null = null;
  let targetInstalled = false;

  setStatus(`Reloading ${previousObject.sourceLabel} with ${formatBackendLabel(backend)}...`);
  setLoadingProgress(true, "Parsing / loading 0.00%");
  setLoadControlsEnabled(false);
  setDownloadDataButtonState(true, true);
  setDownloadPdfButtonState(Boolean(lastDownloadablePdf), true);
  backendSelectElement.disabled = true;
  vectorLodSelectElement.disabled = true;

  try {
    const loadStart = performance.now();
    resetVectorStrokeLodBuildTiming();
    nextObject = await pdfObjectGenerator(
      source,
      {
        ...objectOptions,
        onProgress: (progress) => {
          updateLoadingProgress(activeLoadToken, progress);
        }
      },
      backend
    );
    const objectReadyMs = performance.now() - loadStart;
    const lodTiming = consumeVectorStrokeLodBuildTiming();
    if (activeLoadToken !== loadToken) {
      nextObject.dispose();
      nextObject = null;
      return;
    }

    await ensureThreeRendererBackend(backend, { disposeCurrentPdfObject: false });
    if (activeLoadToken !== loadToken) {
      nextObject.dispose();
      nextObject = null;
      return;
    }

    replacePdfObject(nextObject, { fitCamera: false });
    targetInstalled = true;
    const installedObject = nextObject;
    nextObject = null;
    restoreCameraSnapshot(cameraSnapshot);
    updateLoadingProgress(activeLoadToken, {
      value: 1,
      stage: "first-render",
      sourceType: installedObject.sourceKind === "pdf" ? "pdf" : "zip"
    });
    const firstRenderStart = performance.now();
    requestRender();
    await waitForNextRenderedFrame(activeLoadToken);
    const firstRenderMs = performance.now() - firstRenderStart;
    const totalLoadMs = performance.now() - loadStart;
    lastLoadTimingText = formatLoadTiming(
      totalLoadMs,
      lodTiming.elapsedMs,
      lodTiming.buildCount,
      firstRenderMs,
      objectReadyMs
    );
    updateSceneMetrics(installedObject);
    setDownloadDataButtonState(true);
    setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
    clearLoadedStatus();
  } catch (error) {
    if (nextObject && currentPdfObject === nextObject) {
      targetInstalled = true;
      nextObject = null;
    }
    nextObject?.dispose();
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
    if (activeLoadToken === loadToken) {
      setLoadingProgress(false);
      setLoadControlsEnabled(true);
      setDownloadDataButtonState(Boolean(currentPdfObject));
      setDownloadPdfButtonState(Boolean(lastDownloadablePdf));
      backendSelectElement.disabled = false;
      vectorLodSelectElement.disabled = false;
      updateDrawStatsMeter();
      updateLodStatsMeter();
      requestRender();
    }
  }
}

function replacePdfObject(nextObject: HeprThreePdfObject, options: { fitCamera?: boolean } = {}): void {
  nextObject.renderer.setInteractionViewportProvider(() => renderer.domElement.getBoundingClientRect());
  lastNativeDrawStats = null;
  nextObject.setFrameListener((stats) => {
    lastNativeDrawStats = stats;
  });
  disposeCurrentObject({ clearMetrics: options.fitCamera !== false });
  currentPdfObject = nextObject;
  scene.add(nextObject);
  refreshDropIndicator();
  if (options.fitCamera !== false) {
    fitCameraToPdfObject(nextObject);
  }
  updateCameraClipping(true);
  updateDrawStatsMeter();
  setDownloadDataButtonState(true);
  refreshSearchAvailability();
  if (textSearchInputElement.value.trim().length > 0 && nextObject.hasSearchableText) {
    // Restore the active query on the new object without yanking the camera.
    runSearch(textSearchInputElement.value, false);
  }
  requestRender();
}

function disposeCurrentObject(options: { clearMetrics?: boolean } = {}): void {
  if (!currentPdfObject) {
    return;
  }
  const clearMetrics = options.clearMetrics !== false;
  currentPdfObject.setFrameListener(null);
  currentPdfObject.renderer.setInteractionViewportProvider(null);
  scene.remove(currentPdfObject);
  currentPdfObject.dispose();
  currentPdfObject = null;
  lastNativeDrawStats = null;
  if (clearMetrics) {
    lastDownloadablePdf = null;
    fileValueElement.textContent = "-";
    sourceSegmentsValueElement.textContent = "-";
    visibleSegmentsValueElement.textContent = "-";
    timesValueElement.textContent = "-";
    setDrawStatsText("-");
    setLodStatsText("-");
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
  openButtonElement.disabled = !enabled;
  fileInputElement.disabled = !enabled;
  exampleDropdown.setDisabled(!enabled);
}

function setDownloadDataButtonState(hasParsedData: boolean, isBusy = false): void {
  downloadDataButtonElement.hidden = !hasParsedData;
  downloadDataButtonElement.disabled = !hasParsedData || isBusy;
  downloadDataButtonElement.textContent = isBusy ? "Preparing ZIP..." : "Download Parsed Data";
}

function setDownloadPdfButtonState(hasPdf: boolean, isBusy = false): void {
  downloadPdfButtonElement.hidden = !hasPdf;
  downloadPdfButtonElement.disabled = !hasPdf || isBusy;
  downloadPdfButtonElement.textContent = isBusy ? "Preparing PDF..." : "Download PDF";
}

function refreshDropIndicator(): void {
  const shouldShow = isDropDragActive || !currentPdfObject;
  dropIndicatorElement.classList.toggle("active", shouldShow);
  dropIndicatorElement.classList.toggle("dragging", isDropDragActive);
}

async function loadSupportedFile(file: File): Promise<void> {
  if (!isPdfFile(file) && !isParsedDataZipFile(file)) {
    setStatus(`Unsupported file type: ${file.name}`);
    return;
  }
  await loadSource(file);
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
  fileValueElement.textContent = `${pdfObject.sourceLabel} (${pdfObject.sourceKind})`;
  sourceSegmentsValueElement.textContent = sourceSegments.toLocaleString();
  visibleSegmentsValueElement.textContent =
    `${visibleSegments.toLocaleString()} (${Math.max(0, totalReduction).toFixed(1)}% total reduction), fills ${sceneData.fillPathCount.toLocaleString()}, text ${sceneData.textInstanceCount.toLocaleString()} instances, pages ${sceneData.pageCount.toLocaleString()} (${sceneData.pagesPerRow.toLocaleString()}/row)`;
  timesValueElement.textContent = lastLoadTimingText;
}

async function downloadParsedDataZip(): Promise<boolean> {
  const pdfObject = currentPdfObject;
  const sceneStats = pdfObject?.renderer.getSceneStats() ?? null;
  if (!pdfObject || !sceneStats) {
    setStatus("No parsed floorplan data available to export.");
    return false;
  }

  setDownloadDataButtonState(true, true);
  try {
    const sceneData = pdfObject.sceneData;
    const sourcePdfBytes = sceneData.imagePaintOpCount > 0 && lastDownloadablePdf
      ? await readPdfDownloadBytes(lastDownloadablePdf)
      : null;
    const sceneRasterLayers = listSceneRasterLayers(sceneData);
    const selectedZip = await buildParsedDataZipBlobForLayout(
      sceneData,
      sceneStats,
      pdfObject.sourceLabel,
      sourcePdfBytes,
      EXPORT_TEXTURE_LAYOUT,
      sceneRasterLayers,
      {
        encodeRasterImages: EXPORT_ENCODE_RASTER_IMAGES,
        zipCompression: EXPORT_ZIP_COMPRESSION,
        zipDeflateLevel: EXPORT_ZIP_DEFLATE_LEVEL
      }
    );

    const zipFileName = `${sanitizeDownloadName(pdfObject.sourceLabel)}-parsed-data.zip`;
    triggerBrowserDownload(selectedZip.blob, zipFileName);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to download parsed data: ${message}`);
    return false;
  } finally {
    setDownloadDataButtonState(Boolean(currentPdfObject), false);
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

async function resolveDownloadablePdfSource(
  source: File | string,
  pdfObject: HeprThreePdfObject,
  hint: PdfDownloadSource | null
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

  const zipBytes = await readParsedZipBytesForSource(source);
  if (!zipBytes) {
    return null;
  }
  const sourcePdfBytes = await tryReadSourcePdfBytesFromExistingParsedZip(zipBytes);
  return sourcePdfBytes && sourcePdfBytes.length > 0
    ? { label: pdfObject.sourceLabel, bytes: sourcePdfBytes }
    : null;
}

async function readParsedZipBytesForSource(source: File | string): Promise<Uint8Array | null> {
  try {
    if (source instanceof File) {
      return new Uint8Array(await source.arrayBuffer());
    }

    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
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
  setLodStatsText(formatVectorStrokeLodStats(stats) || "-");
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
}

async function loadExampleSelection(selectionKey: string): Promise<void> {
  const selection = exampleSelectionMap.get(selectionKey);
  if (!selection) {
    return;
  }

  exampleDropdown.setDisabled(true);
  try {
    const modeLabel = selection.kind === "pdf" ? "PDF" : "parsed ZIP";
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
  const withoutExtension = label.replace(/\.pdf$/i, "");
  const normalized = withoutExtension.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized.length > 0 ? normalized : "floorplan";
}

function readVectorLodMode(): VectorLodMode {
  const value = vectorLodSelectElement.value;
  return value === "off" || value === "force" ? value : "auto";
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

type ExampleSelectionKind = "pdf" | "zip";

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
