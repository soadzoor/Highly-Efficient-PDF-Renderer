import * as THREE from "three";

import { createCanvasInteractionController, pdfObjectGenerator, type HeprRendererType, type HeprThreePdfObject } from "./index";
import {
  normalizeExampleManifestEntries,
  resolveAppAssetUrl,
  type ExampleAssetManifest,
  type NormalizedExampleEntry
} from "./exampleManifest";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const sourceInput = document.querySelector<HTMLInputElement>("#source-input");
const loadSourceButton = document.querySelector<HTMLButtonElement>("#load-source");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const exampleSelect = document.querySelector<HTMLSelectElement>("#example-select");
const backendSelect = document.querySelector<HTMLSelectElement>("#backend-select");
const statusElement = document.querySelector<HTMLDivElement>("#status");

if (!canvas || !sourceInput || !loadSourceButton || !fileInput || !exampleSelect || !backendSelect || !statusElement) {
  throw new Error("Three example UI is missing required DOM elements.");
}

const canvasElement = canvas;
const sourceInputElement = sourceInput;
const loadSourceButtonElement = loadSourceButton;
const fileInputElement = fileInput;
const exampleSelectElement = exampleSelect;
const backendSelectElement = backendSelect;
const statusElementNode = statusElement;
const lifetimeAbortController = new AbortController();
const lifetimeSignal = lifetimeAbortController.signal;

const renderer = new THREE.WebGLRenderer({
  canvas: canvasElement,
  antialias: false,
  alpha: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  powerPreference: "high-performance"
});
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(new THREE.Color(160 / 255, 169 / 255, 175 / 255), 1);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

let currentPdfObject: HeprThreePdfObject | null = null;
let lastLoadedSource: File | string | null = null;
let animationFrameId = 0;
const exampleSelectionMap = new Map<string, ExampleSelection>();

const interactionController = createCanvasInteractionController(() => {
  if (!currentPdfObject) {
    return {
      beginPanInteraction: () => {},
      endPanInteraction: () => {},
      panByPixels: () => {},
      zoomAtClientPoint: () => {}
    };
  }
  return currentPdfObject.renderer;
});
interactionController.attach(renderer.domElement);

function renderFrame(): void {
  animationFrameId = requestAnimationFrame(renderFrame);
  renderer.render(scene, camera);
}
renderFrame();

window.addEventListener("resize", () => {
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
}, { signal: lifetimeSignal });

loadSourceButtonElement.addEventListener("click", () => {
  const raw = sourceInputElement.value.trim();
  if (!raw) {
    setStatus("Please enter a PDF or ZIP path/base64 source.");
    return;
  }
  void loadSource(raw);
}, { signal: lifetimeSignal });

sourceInputElement.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  loadSourceButtonElement.click();
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
  interactionController.detach();
  disposeCurrentObject();
  renderer.dispose();
}

async function loadSource(source: File | string): Promise<void> {
  const backend = backendSelectElement.value === "webgpu" ? "webgpu" : "webgl";
  const useWebGpuMaterialPipeline = backend === "webgpu";
  const sourceLabel = typeof source === "string" ? source : source.name;
  setStatus(`Loading ${sourceLabel} with ${backend.toUpperCase()}...`);
  loadSourceButtonElement.disabled = true;
  backendSelectElement.disabled = true;

  try {
    const nextObject = await pdfObjectGenerator(
      source,
      {
        segmentMerge: true,
        invisibleCull: true,
        curveStrokes: true,
        experimentalMaterialRasters: useWebGpuMaterialPipeline,
        experimentalMaterialFills: useWebGpuMaterialPipeline,
        experimentalMaterialStrokes: useWebGpuMaterialPipeline,
        experimentalMaterialTexts: useWebGpuMaterialPipeline,
        pageBackground: 0xffffff
      },
      backend as HeprRendererType
    );

    replacePdfObject(nextObject);
    lastLoadedSource = source;
    setStatus(`Loaded ${nextObject.sourceLabel} (${nextObject.sourceKind}) via ${backend.toUpperCase()}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load source: ${message}`);
  } finally {
    loadSourceButtonElement.disabled = false;
    backendSelectElement.disabled = false;
  }
}

function replacePdfObject(nextObject: HeprThreePdfObject): void {
  disposeCurrentObject();
  nextObject.renderer.setInteractionViewportProvider(() => renderer.domElement.getBoundingClientRect());
  nextObject.renderer.setFrameListener(null);
  currentPdfObject = nextObject;
  scene.add(nextObject);
}

function disposeCurrentObject(): void {
  if (!currentPdfObject) {
    return;
  }
  currentPdfObject.renderer.setFrameListener(null);
  currentPdfObject.renderer.setInteractionViewportProvider(null);
  scene.remove(currentPdfObject);
  currentPdfObject.dispose();
  currentPdfObject = null;
}

function setStatus(text: string): void {
  statusElementNode.textContent = text;
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

type ExampleSelectionKind = "pdf" | "zip";

interface ExampleSelection {
  id: string;
  sourceName: string;
  kind: ExampleSelectionKind;
  path: string;
}
