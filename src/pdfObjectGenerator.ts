import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import {
  composeVectorScenesInGrid,
  extractPdfPageScenes,
  type VectorExtractOptions,
  type VectorScene
} from "./pdfVectorExtractor";
import { loadSceneFromParsedDataZip } from "./parsedDataZip";

export type PdfObjectSource = ArrayBuffer | Uint8Array | Blob | File | string;
export type PdfObjectSourceKind = "pdf" | "parsed-zip";

export interface PdfObjectGeneratorOptions {
  segmentMerge?: boolean;
  invisibleCull?: boolean;
  maxPages?: number;
  maxPagesPerRow?: number;
  sourceKind?: PdfObjectSourceKind | "auto";
}

export interface LoadedPdfScene {
  scene: VectorScene;
  sourceLabel: string;
  sourceKind: PdfObjectSourceKind;
  sourceBytes: Uint8Array;
}

let isPdfWorkerConfigured = false;

export async function loadPdfSceneFromSource(
  source: PdfObjectSource,
  options: PdfObjectGeneratorOptions = {}
): Promise<LoadedPdfScene> {
  const sourceBytes = await readSourceBytes(source);
  const sourceKind = resolveSourceKind(source, sourceBytes, options.sourceKind);
  const sourceLabel = resolveSourceLabel(source, sourceKind);

  if (sourceKind === "pdf") {
    ensurePdfWorkerConfigured();
    const extractOptions: VectorExtractOptions = {
      enableSegmentMerge: options.segmentMerge !== false,
      enableInvisibleCull: options.invisibleCull !== false,
      maxPages: options.maxPages
    };
    const pageScenes = await extractPdfPageScenes(createParseBuffer(sourceBytes), extractOptions);
    const pagesPerRow = normalizePagesPerRow(options.maxPagesPerRow);
    return {
      scene: composeVectorScenesInGrid(pageScenes, pagesPerRow),
      sourceLabel,
      sourceKind,
      sourceBytes
    };
  }

  return {
    scene: await loadSceneFromParsedDataZip(createParseBuffer(sourceBytes)),
    sourceLabel,
    sourceKind,
    sourceBytes
  };
}

function ensurePdfWorkerConfigured(): void {
  if (isPdfWorkerConfigured) {
    return;
  }
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  isPdfWorkerConfigured = true;
}

async function readSourceBytes(source: PdfObjectSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source.slice();
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source).slice();
  }
  if (isBlobLike(source)) {
    return new Uint8Array(await source.arrayBuffer()).slice();
  }
  if (typeof source === "string") {
    return readStringSourceBytes(source);
  }

  throw new Error("Unsupported source type. Expected File, Blob, Uint8Array, ArrayBuffer, or string.");
}

async function readStringSourceBytes(source: string): Promise<Uint8Array> {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    throw new Error("Source string is empty.");
  }

  if (looksLikeDataUrl(trimmed)) {
    return decodeDataUrlBytes(trimmed);
  }

  const decodedBase64 = tryDecodeBase64Bytes(trimmed);
  if (decodedBase64 && (looksLikePdfBytes(decodedBase64) || looksLikeZipBytes(decodedBase64))) {
    return decodedBase64;
  }

  const response = await fetch(trimmed, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load source path/URL (${response.status} ${response.statusText}).`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
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

function normalizePagesPerRow(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }
  return clamp(Math.trunc(value), 1, 100);
}

function createParseBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
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
