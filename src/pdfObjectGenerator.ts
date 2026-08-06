import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const pdfJsModule = (
  typeof window === "undefined"
    ? await import("pdfjs-dist/legacy/build/pdf.mjs")
    : await import("pdfjs-dist")
) as {
  GlobalWorkerOptions: typeof import("pdfjs-dist").GlobalWorkerOptions;
};

const { GlobalWorkerOptions } = pdfJsModule;

import {
  composeVectorScenesInGrid,
  extractPdfPageScenes,
  type VectorExtractOptions,
  type VectorScene
} from "./pdfVectorExtractor";
import { loadSceneFromParsedDataZip } from "./parsedDataZip";
import { createLoadProgressReporter, type LoadProgressCallback, type LoadProgressReporter } from "./loadProgress";

/**
 * Source input accepted by HEPR loaders.
 *
 * String sources may be URLs/paths, base64 payloads, or base64 data URLs.
 * Binary sources may contain either a PDF or a HEPR parsed-data ZIP.
 */
export type PdfObjectSource = ArrayBuffer | Uint8Array | Blob | File | string;

/** Detected or declared source format. */
export type PdfObjectSourceKind = "pdf" | "parsed-zip";

/**
 * Options used while loading and parsing a source into HEPR scene data.
 */
export interface PdfObjectGeneratorOptions {
  /**
   * Merge compatible adjacent vector stroke segments during parse.
   *
   * @default true
   */
  segmentMerge?: boolean;

  /**
   * Drop vector content that is known to be invisible.
   *
   * @default true
   */
  invisibleCull?: boolean;

  /**
   * One-based PDF pages to parse, using Chrome-style ASCII print syntax.
   * Separate individual page numbers or inclusive ranges with commas.
   * Open ranges such as `"5-"` and `"-3"` are also supported.
   *
   * Omit or pass a blank string to parse all pages. Overlaps and duplicates
   * are ignored, and pages are composed in ascending document order. Invalid
   * string selections reject with a `RangeError`.
   *
   * PDF sources only; parsed-data ZIP sources ignore this option.
   *
   * @example "1-5, 8, 11-13"
   */
  pages?: string;

  /**
   * Maximum pages per row when a multi-page PDF is composed into one scene.
   * Omit to let HEPR choose a compact grid.
   */
  maxPagesPerRow?: number;

  /**
   * Progress callback for source loading, PDF parsing, ZIP loading, Vector LOD
   * building, and upload preparation.
   */
  onProgress?: LoadProgressCallback;

  /**
   * Also extract text strings with scene-space bounding boxes into
   * `VectorScene.textContent` (used for example by `detectRooms` to seed room
   * detection from room labels). Only PDF sources support this option;
   * parsed-zip sources ignore it — their searchable text index serves as the
   * room-detection seed source instead.
   *
   * @default false
   */
  extractText?: boolean;

  /**
   * Force source interpretation. Use this when bytes or URLs do not make the
   * format obvious.
   *
   * @default "auto"
   */
  sourceKind?: PdfObjectSourceKind | "auto";
}

/**
 * Internal parsed HEPR scene plus source metadata.
 */
export interface LoadedPdfScene {
  /** Parsed vector/raster/text scene data. */
  scene: VectorScene;

  /** Human-readable source label, usually a file name or URL basename. */
  sourceLabel: string;

  /** Whether the source was loaded as a PDF or parsed-data ZIP. */
  sourceKind: PdfObjectSourceKind;

  /** Original source bytes. */
  sourceBytes: Uint8Array;
}

let isPdfWorkerConfigured = false;

/**
 * Internal source-loading step used by `pdfObjectGenerator`.
 */
export async function loadPdfSceneFromSource(
  source: PdfObjectSource,
  options: PdfObjectGeneratorOptions = {}
): Promise<LoadedPdfScene> {
  const progress = createLoadProgressReporter(options.onProgress);
  const sourceBytes = await readPdfObjectSourceBytes(source, progress.child(0, 0.16));
  const sourceKind = resolveSourceKind(source, sourceBytes, options.sourceKind);
  const sourceLabel = resolveSourceLabel(source, sourceKind);

  if (sourceKind === "pdf") {
    ensurePdfWorkerConfigured();
    const extractOptions: VectorExtractOptions = {
      enableSegmentMerge: options.segmentMerge !== false,
      enableInvisibleCull: options.invisibleCull !== false,
      pages: options.pages,
      extractTextContent: options.extractText === true,
      onProgress: progress.child(0.16, 0.9, { sourceType: "pdf" }).toCallback()
    };
    const pageScenes = await extractPdfPageScenes(createParseBuffer(sourceBytes), extractOptions);
    const pagesPerRow = normalizePagesPerRow(options.maxPagesPerRow, pageScenes.length);
    const scene = composeVectorScenesInGrid(pageScenes, pagesPerRow);
    progress.report(0.93, { stage: "compile", sourceType: "pdf" });
    progress.complete({ sourceType: "pdf" });
    return {
      scene,
      sourceLabel,
      sourceKind,
      sourceBytes
    };
  }

  const scene = await loadSceneFromParsedDataZip(createParseBuffer(sourceBytes), {
    onProgress: progress.child(0.16, 0.95, { sourceType: "zip" }).toCallback()
  });
  progress.complete({ sourceType: "zip" });
  return {
    scene,
    sourceLabel,
    sourceKind,
    sourceBytes
  };
}

function ensurePdfWorkerConfigured(): void {
  if (isPdfWorkerConfigured) {
    return;
  }
  // Vite inlines this URL in the published library. In source-level Node/SSR
  // execution it may instead be a browser-only root path, so retain the
  // legacy PDF.js module's own worker path there.
  const currentWorkerSrc = GlobalWorkerOptions.workerSrc;
  const usesPdfJsDefault = !currentWorkerSrc || currentWorkerSrc === "./pdf.worker.mjs";
  if (usesPdfJsDefault && (typeof window !== "undefined" || pdfWorkerUrl.startsWith("data:"))) {
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  isPdfWorkerConfigured = true;
}

/** @internal Read an accepted HEPR source without parsing it. */
export async function readPdfObjectSourceBytes(
  source: PdfObjectSource,
  progress?: LoadProgressReporter
): Promise<Uint8Array> {
  progress?.report(0, { stage: "source", unit: "bytes" });
  if (source instanceof Uint8Array) {
    const bytes = new Uint8Array(source);
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    return bytes;
  }
  if (source instanceof ArrayBuffer) {
    const bytes = new Uint8Array(source).slice();
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    return bytes;
  }
  if (isBlobLike(source)) {
    const bytes = new Uint8Array(await source.arrayBuffer()).slice();
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    return bytes;
  }
  if (typeof source === "string") {
    const bytes = await readStringSourceBytes(source, progress);
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    return bytes;
  }

  throw new Error("Unsupported source type. Expected File, Blob, Uint8Array, ArrayBuffer, or string.");
}

async function readStringSourceBytes(source: string, progress?: LoadProgressReporter): Promise<Uint8Array> {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    throw new Error("Source string is empty.");
  }

  if (looksLikeDataUrl(trimmed)) {
    const bytes = decodeDataUrlBytes(trimmed);
    progress?.report(1, { stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    return bytes;
  }

  const decodedBase64 = tryDecodeBase64Bytes(trimmed);
  if (decodedBase64 && (looksLikePdfBytes(decodedBase64) || looksLikeZipBytes(decodedBase64))) {
    progress?.report(1, { stage: "source", unit: "bytes", processed: decodedBase64.length, total: decodedBase64.length });
    return decodedBase64;
  }

  const response = await fetch(trimmed, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load source path/URL (${response.status} ${response.statusText}).`);
  }
  return readResponseBytesWithProgress(response, progress);
}

async function readResponseBytesWithProgress(response: Response, progress?: LoadProgressReporter): Promise<Uint8Array> {
  const totalHeader = Number(response.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? Math.trunc(totalHeader) : undefined;
  if (!response.body || !progress?.enabled) {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    progress?.report(1, {
      stage: "source",
      unit: "bytes",
      processed: bytes.length,
      total: total ?? bytes.length
    });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  progress.report(0, { stage: "source", unit: "bytes", processed: 0, total });

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    chunks.push(value);
    received += value.length;
    if (total) {
      progress.report(received / total, {
        stage: "source",
        unit: "bytes",
        processed: received,
        total
      });
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  progress.report(1, {
    stage: "source",
    unit: "bytes",
    processed: received,
    total: total ?? received
  });
  return bytes;
}

function resolveSourceKind(
  source: PdfObjectSource,
  sourceBytes: Uint8Array,
  sourceKindOption: PdfObjectGeneratorOptions["sourceKind"]
): PdfObjectSourceKind {
  if (sourceKindOption === "pdf" || sourceKindOption === "parsed-zip") {
    return sourceKindOption;
  }

  const sourceName = readSourceName(source);
  if (sourceName) {
    const lowered = sourceName.toLowerCase();
    if (lowered.endsWith(".pdf")) {
      return "pdf";
    }
    if (lowered.endsWith(".zip")) {
      return "parsed-zip";
    }
  }

  if (looksLikePdfBytes(sourceBytes)) {
    return "pdf";
  }
  if (looksLikeZipBytes(sourceBytes)) {
    return "parsed-zip";
  }

  throw new Error(
    "Unable to detect source kind. Pass options.sourceKind as \"pdf\" or \"parsed-zip\"."
  );
}

function resolveSourceLabel(source: PdfObjectSource, sourceKind: PdfObjectSourceKind): string {
  const sourceName = readSourceName(source);
  if (sourceName) {
    return sourceName;
  }
  return sourceKind === "pdf" ? "document.pdf" : "parsed-data.zip";
}

function readSourceName(source: PdfObjectSource): string | null {
  if (typeof source === "string") {
    return readSourceNameFromString(source);
  }
  if (isFileLike(source)) {
    const trimmed = source.name.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function readSourceNameFromString(source: string): string | null {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (looksLikeDataUrl(trimmed)) {
    const mime = readMimeTypeFromDataUrl(trimmed)?.toLowerCase();
    if (mime === "application/pdf") {
      return "inline.pdf";
    }
    if (mime === "application/zip" || mime === "application/x-zip-compressed") {
      return "inline.zip";
    }
    return "inline-data.bin";
  }

  if (looksLikeRawBase64Source(trimmed)) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const pathname = new URL(trimmed).pathname;
      const name = pathname.split("/").filter(Boolean).pop();
      return name ?? trimmed;
    } catch {
      return trimmed;
    }
  }

  const withoutQuery = trimmed.split(/[?#]/, 1)[0];
  const normalized = withoutQuery.replace(/\\/g, "/");
  const name = normalized.split("/").filter(Boolean).pop();
  return name ?? trimmed;
}

function normalizePagesPerRow(value: number | undefined, pageCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return clamp(Math.ceil(Math.sqrt(Math.max(1, Math.trunc(pageCount)))), 1, 100);
  }
  return clamp(Math.trunc(value), 1, 100);
}

function createParseBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function looksLikeRawBase64Source(value: string): boolean {
  const normalized = value.replace(/\s+/g, "");
  return (
    normalized.length >= 64 &&
    normalized.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  );
}

function looksLikePdfBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}

function looksLikeZipBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }
  return (
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}

function looksLikeDataUrl(value: string): boolean {
  return /^data:[^,]*;base64,/i.test(value);
}

function decodeDataUrlBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Malformed base64 data URL.");
  }
  const base64Payload = dataUrl.slice(commaIndex + 1);
  const decoded = tryDecodeBase64Bytes(base64Payload);
  if (!decoded) {
    throw new Error("Failed to decode base64 data URL.");
  }
  return decoded;
}

function tryDecodeBase64Bytes(value: string): Uint8Array | null {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length === 0 || normalized.length % 4 !== 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }

  try {
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function readMimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,/i.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mime = match[1]?.trim();
  return mime && mime.length > 0 ? mime : null;
}

function isBlobLike(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isFileLike(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}
