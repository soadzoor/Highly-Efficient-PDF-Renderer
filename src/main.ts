import "./style.css";

import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { GpuFloorplanRenderer } from "./gpuFloorplanRenderer";
import { extractFirstPageVectors, type VectorScene } from "./pdfVectorExtractor";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const openButton = document.querySelector<HTMLButtonElement>("#open-file");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const statusElement = document.querySelector<HTMLDivElement>("#status");
const runtimeElement = document.querySelector<HTMLDivElement>("#runtime");
const dropIndicator = document.querySelector<HTMLDivElement>("#drop-indicator");

if (!canvas || !openButton || !fileInput || !statusElement || !runtimeElement || !dropIndicator) {
  throw new Error("Required UI elements are missing from index.html.");
}

const canvasElement = canvas;
const openButtonElement = openButton;
const fileInputElement = fileInput;
const statusTextElement = statusElement;
const runtimeTextElement = runtimeElement;
const dropIndicatorElement = dropIndicator;

const renderer = new GpuFloorplanRenderer(canvasElement);
renderer.resize();

let baseStatus = "Waiting for PDF file...";

renderer.setFrameListener((stats) => {
  const rendered = stats.renderedSegments.toLocaleString();
  const total = stats.totalSegments.toLocaleString();
  const mode = stats.usedCulling ? "culled" : "full";
  runtimeTextElement.textContent = `Draw ${rendered}/${total} segments | mode: ${mode} | zoom: ${stats.zoom.toFixed(2)}x`;
});

openButtonElement.addEventListener("click", () => {
  fileInputElement.click();
});

fileInputElement.addEventListener("change", async () => {
  const [file] = Array.from(fileInputElement.files || []);
  if (!file) {
    return;
  }
  await loadPdfFile(file);
  fileInputElement.value = "";
});

let isPanning = false;
let previousX = 0;
let previousY = 0;

canvasElement.addEventListener("pointerdown", (event) => {
  isPanning = true;
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
  canvasElement.releasePointerCapture(event.pointerId);
});

canvasElement.addEventListener("pointercancel", (event) => {
  isPanning = false;
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
  await loadPdfBuffer(buffer, file.name);
}

async function loadPdfBuffer(buffer: ArrayBuffer, label: string): Promise<void> {
  try {
    const parseStart = performance.now();
    setStatus(`Parsing ${label} with PDF.js...`);
    const scene = await extractFirstPageVectors(buffer);
    const parseEnd = performance.now();

    if (scene.segmentCount === 0) {
      setStatus(`No stroke segments were extracted from ${label}.`);
      runtimeTextElement.textContent = "";
      return;
    }

    setStatus(`Uploading ${scene.segmentCount.toLocaleString()} segments to GPU...`);
    const uploadStart = performance.now();
    const sceneStats = renderer.setScene(scene);
    renderer.fitToBounds(scene.bounds, 64);
    const uploadEnd = performance.now();

    logTextureSizeStats(label, scene.segmentCount, sceneStats);

    baseStatus = formatSceneStatus(label, scene, parseEnd - parseStart, uploadEnd - uploadStart, sceneStats.maxCellPopulation);
    statusTextElement.textContent = baseStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to render PDF: ${message}`);
    runtimeTextElement.textContent = "";
  }
}

function formatSceneStatus(
  label: string,
  scene: VectorScene,
  parseMs: number,
  uploadMs: number,
  maxCellPopulation: number
): string {
  const segmentCount = scene.segmentCount.toLocaleString();
  const operatorCount = scene.operatorCount.toLocaleString();
  const parseTime = parseMs.toFixed(0);
  const uploadTime = uploadMs.toFixed(0);

  return `${label} | ${segmentCount} segments from ${operatorCount} operators | parse ${parseTime} ms, GPU upload ${uploadTime} ms | max cell load ${maxCellPopulation}`;
}

function setStatus(message: string): void {
  baseStatus = message;
  statusTextElement.textContent = baseStatus;
}

function logTextureSizeStats(
  label: string,
  segmentCount: number,
  sceneStats: { textureWidth: number; textureHeight: number; maxTextureSize: number }
): void {
  const utilization = (Math.max(sceneStats.textureWidth, sceneStats.textureHeight) / sceneStats.maxTextureSize) * 100;
  console.log(
    `[GPU texture size] ${label}: ${sceneStats.textureWidth}x${sceneStats.textureHeight} (segments=${segmentCount.toLocaleString()}, maxTextureSize=${sceneStats.maxTextureSize}, max-dim utilization=${utilization.toFixed(1)}%)`
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
    await loadPdfBuffer(buffer, "SimiValleyBehavioralHealth_SR_20180403.pdf");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not load default sample: ${message}`);
    runtimeTextElement.textContent = "Drag and drop one of the PDFs from ./floorplans.";
  }
}

void loadDefaultSample();
