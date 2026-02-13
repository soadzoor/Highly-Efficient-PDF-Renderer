import "./style.css";

import JSZip from "jszip";
import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { GpuFloorplanRenderer, type SceneStats } from "./gpuFloorplanRenderer";
import { extractFirstPageVectors, type VectorExtractOptions, type VectorScene } from "./pdfVectorExtractor";

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
  !invisibleCullToggle
) {
  throw new Error("Required UI elements are missing from index.html.");
}

const canvasElement = canvas;
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

const renderer = new GpuFloorplanRenderer(canvasElement);
renderer.resize();
renderer.setPanOptimizationEnabled(panOptimizationToggleElement.checked);

let baseStatus = "Waiting for PDF file...";
let lastLoadedPdfBytes: Uint8Array | null = null;
let lastLoadedPdfLabel: string | null = null;
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

let fpsLastSampleTime = 0;
let fpsSmoothed = 0;

setMetricPlaceholder();
setHudCollapsed(false);
setDownloadDataButtonState(false);

renderer.setFrameListener((stats) => {
  updateFpsMetric();

  const rendered = stats.renderedSegments.toLocaleString();
  const total = stats.totalSegments.toLocaleString();
  const mode = stats.usedCulling ? "culled" : "full";
  runtimeTextElement.textContent = `Draw ${rendered}/${total} segments | mode: ${mode} | zoom: ${stats.zoom.toFixed(2)}x`;
});

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
  await loadPdfFile(file);
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

let isPanning = false;
let previousX = 0;
let previousY = 0;

canvasElement.addEventListener("pointerdown", (event) => {
  isPanning = true;
  renderer.beginPanInteraction();
  previousX = event.clientX;
  previousY = event.clientY;
  canvasElement.setPointerCapture(event.pointerId);
});

canvasElement.addEventListener("pointermove", (event) => {
  if (!isPanning) {
    return;
  }

  const deltaX = event.clientX - previousX;
  const deltaY = event.clientY - previousY;

  previousX = event.clientX;
  previousY = event.clientY;

  renderer.panByPixels(deltaX, deltaY);
});

canvasElement.addEventListener("pointerup", (event) => {
  isPanning = false;
  renderer.endPanInteraction();
  canvasElement.releasePointerCapture(event.pointerId);
});

canvasElement.addEventListener("pointercancel", (event) => {
  isPanning = false;
  renderer.endPanInteraction();
  canvasElement.releasePointerCapture(event.pointerId);
});

canvasElement.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.0013);
    renderer.zoomAtClientPoint(event.clientX, event.clientY, zoomFactor);
  },
  { passive: false }
);

window.addEventListener("resize", () => {
  renderer.resize();
});

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
  const pdf = files.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

  if (!pdf) {
    setStatus("Dropped file is not a PDF.");
    return;
  }

  await loadPdfFile(pdf);
});

async function loadPdfFile(file: File): Promise<void> {
  setStatus(`Reading ${file.name}...`);
  const buffer = await file.arrayBuffer();
  lastLoadedPdfBytes = clonePdfBytes(buffer);
  lastLoadedPdfLabel = file.name;
  await loadPdfBuffer(createParseBuffer(lastLoadedPdfBytes), file.name, { preserveView: false });
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
  if (!lastLoadedPdfBytes || !lastLoadedPdfLabel) {
    return;
  }
  await loadPdfBuffer(createParseBuffer(lastLoadedPdfBytes), lastLoadedPdfLabel, { preserveView: true });
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
  downloadDataButtonElement.textContent = isBusy ? "preparing zip..." : "download parsed data";
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
    createTextureExportEntry("fill-segments", scene.fillSegments, sceneStats.fillSegmentTextureWidth, sceneStats.fillSegmentTextureHeight, scene.fillSegmentCount),
    createTextureExportEntry("stroke-endpoints", scene.endpoints, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount),
    createTextureExportEntry("stroke-styles", scene.styles, sceneStats.textureWidth, sceneStats.textureHeight, scene.segmentCount),
    createTextureExportEntry("text-instance-a", scene.textInstanceA, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount),
    createTextureExportEntry("text-instance-b", scene.textInstanceB, sceneStats.textInstanceTextureWidth, sceneStats.textInstanceTextureHeight, scene.textInstanceCount),
    createTextureExportEntry("text-glyph-meta-a", scene.textGlyphMetaA, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount),
    createTextureExportEntry("text-glyph-meta-b", scene.textGlyphMetaB, sceneStats.textGlyphTextureWidth, sceneStats.textGlyphTextureHeight, scene.textGlyphCount),
    createTextureExportEntry("text-glyph-primitives-a", scene.textGlyphSegmentsA, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount),
    createTextureExportEntry("text-glyph-primitives-b", scene.textGlyphSegmentsB, sceneStats.textSegmentTextureWidth, sceneStats.textSegmentTextureHeight, scene.textGlyphSegmentCount)
  ];
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
    lastLoadedPdfBytes = clonePdfBytes(buffer);
    lastLoadedPdfLabel = "SimiValleyBehavioralHealth_SR_20180403.pdf";
    await loadPdfBuffer(createParseBuffer(lastLoadedPdfBytes), "SimiValleyBehavioralHealth_SR_20180403.pdf", { preserveView: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not load default sample: ${message}`);
    runtimeTextElement.textContent = "Drag and drop one of the PDFs from ./floorplans.";
  }
}

function clonePdfBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer).slice();
}

function createParseBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

void loadDefaultSample();
