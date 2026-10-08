import {
  composeVectorScenesInGrid,
  extractPdfPageScenes,
  type VectorExtractOptions,
  type VectorScene
} from "./pdfVectorExtractor";
import { loadSceneFromHep } from "./hepReader";
import { prepareSceneForHepRendering } from "./hepShared";
import { hasHepSignature, hasLegacyZipSignature } from "./hepContainer";
import { createLoadProgressReporter, type LoadProgressCallback, type LoadProgressReporter } from "./loadProgress";
import { hasPdfHeader } from "./pdfSignature";
import { waitForLoad } from "./loadCancellation";
import type { PdfIccOptions } from "./pdf/nativeIcc";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { NativeImageCodecResolver } from "./pdf/nativeImage";
import { validateAnnotationAppearanceMode, type AnnotationAppearanceMode } from "./annotationData";
import { openPdfPageDemand, type PdfPageDemandLoader } from "./pdfPageDemand";

/**
 * Source input accepted by HEPR loaders.
 *
 * String sources may be URLs/paths, base64 payloads, or base64 data URLs.
 * Binary sources may contain either a PDF or a HEP parsed-data file.
 */
export type PdfObjectSource = ArrayBuffer | Uint8Array | Blob | File | string;

/** Detected or declared source format. */
export type PdfObjectSourceKind = "pdf" | "hep";

/**
 * Options used while loading and parsing a source into HEPR scene data.
 */
export interface PdfObjectGeneratorOptions extends PdfIccOptions {
  /** Override the human-readable source label (for example, when reopening retained bytes). */
  sourceLabel?: string;
  /** Optional raw-sample image decoder; omitted uses the bundled codecs. */
  imageCodecResolver?: NativeImageCodecResolver;
  /** Receives PDF diagnostics, including warnings when ICC fallback is used. */
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;

  /** Cancel source reading, parsing, LOD preparation, and object creation. */
  signal?: AbortSignal;

  /**
   * User or owner password for a PDF that requires one to open. Encrypted
   * PDFs that open without a password need none. A missing or wrong password
   * rejects with an error that {@link isPdfPasswordError} recognizes.
   *
   * PDF sources only; HEP sources ignore this option.
   */
  password?: string;

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
   * PDF sources only; HEP sources ignore this option.
   *
   * @example "1-5, 8, 11-13"
   */
  pages?: string;

  /**
   * Maximum pages per row when a multi-page PDF is composed into one scene.
   * Omit to let HEPR choose a compact grid.
   */
  maxPagesPerRow?: number;

  /** Default all prepares every viewing page before display. Auto streams large PDFs; eager also decodes original scan pixels. */
  pageLoading?: "all" | "auto" | "eager";

  /** Decode all selected PDF pages and prepare bounded scan textures during parsing: compact monochrome or eligible lossy color/grayscale. */
  compressScans?: boolean;

  /** PDF viewing approximation: draw stored text with bundled fonts and skip scan decoding. */
  ocrTextOnly?: boolean;

  /**
   * Progress callback for source loading, PDF parsing, HEP loading, vector/text
   * LOD building, and upload preparation.
   */
  onProgress?: LoadProgressCallback;

  /**
   * Also extract text strings with scene-space bounding boxes into
   * `VectorScene.textContent` (used for example by `detectRooms` to seed room
   * detection from room labels). Only PDF sources support this option;
   * HEP sources ignore it — their searchable text index serves as the
   * room-detection seed source instead.
   *
   * @default false
   */
  extractText?: boolean;

  /**
   * Which PDF annotation appearances are compiled into page content:
   * `"render"` draws them all, `"forms"` keeps only form-field (Widget)
   * appearances and `"none"` draws none. Annotation metadata in
   * `VectorScene.annotations` is extracted in every mode, so hosts can draw
   * their own markers without a duplicate appearance underneath.
   *
   * PDF sources only; a HEP file keeps the mode it was converted with.
   *
   * @default "render"
   */
  annotationAppearances?: AnnotationAppearanceMode;

  /**
   * Force source interpretation. Use this when bytes or URLs do not make the
   * format obvious.
   *
   * @default "auto"
   */
  sourceKind?: PdfObjectSourceKind | "auto";
}

/** Why a password-protected PDF could not be opened. */
export type PdfPasswordErrorReason = "password-required" | "password-incorrect";

/** A load error caused by a missing or wrong PDF password. */
export interface PdfPasswordError extends Error {
  readonly code: "encrypted";
  readonly details: Readonly<{ reason: PdfPasswordErrorReason }>;
}

/**
 * True when a PDF could not be opened because it needs a password
 * (`details.reason === "password-required"`) or the supplied one is wrong
 * (`"password-incorrect"`). Ask for the password and load again with the
 * `password` option.
 */
export function isPdfPasswordError(error: unknown): error is PdfPasswordError {
  if (!(error instanceof Error)) return false;
  const { code, details } = error as { code?: unknown; details?: { reason?: unknown } };
  return code === "encrypted" &&
    (details?.reason === "password-required" || details?.reason === "password-incorrect");
}

/**
 * Internal parsed HEPR scene plus source metadata.
 */
export interface LoadedPdfScene {
  /** Parsed vector/raster/text scene data. */
  scene: VectorScene;

  /** Human-readable source label, usually a file name or URL basename. */
  sourceLabel: string;

  /** Whether the source was loaded as a PDF or HEP parsed-data file. */
  sourceKind: PdfObjectSourceKind;

  /** Original source bytes. */
  sourceBytes: Uint8Array;
  /** Viewing-only worker/cache; complete extraction and HEP export remain eager. */
  pageDemand?: PdfPageDemandLoader;
  sourceOptions?: PdfObjectGeneratorOptions;
}

/**
 * Internal source-loading step used by `pdfObjectGenerator`.
 */
export async function loadPdfSceneFromSource(
  source: PdfObjectSource,
  options: PdfObjectGeneratorOptions = {},
  /** @internal Used by HEP export to cancel source loading and parsing. */
  signal: AbortSignal | undefined = options.signal,
  /** @internal Only the Three viewer factory requests a partial viewing scene. */
  demandLoading = false
): Promise<LoadedPdfScene> {
  signal?.throwIfAborted();
  const pending = loadPdfSceneFromSourceInternal(source, options, signal, demandLoading);
  try { return await waitForLoad(pending, signal); }
  catch (error) {
    // A metadata session can finish just after its caller cancels. Drain and close that unclaimed worker.
    void pending.then(loaded => loaded.pageDemand?.close()).catch(() => {});
    throw error;
  }
}

async function loadPdfSceneFromSourceInternal(
  source: PdfObjectSource,
  options: PdfObjectGeneratorOptions,
  signal?: AbortSignal,
  demandLoading = false
): Promise<LoadedPdfScene> {
  signal?.throwIfAborted();
  const progress = createLoadProgressReporter(options.onProgress);
  const sourceBytes = await readPdfObjectSourceBytes(
    source,
    progress.child(0, 0.16),
    signal
  );
  signal?.throwIfAborted();
  const sourceKind = resolveSourceKind(source, sourceBytes, options.sourceKind);
  const sourceLabel = options.sourceLabel ?? resolveSourceLabel(source, sourceKind);

  if (sourceKind === "pdf") {
    validateAnnotationAppearanceMode(options.annotationAppearances);
    const extractOptions: VectorExtractOptions = {
      compressScans: options.compressScans,
      ocrTextOnly: options.ocrTextOnly,
      password: options.password,
      imageCodecResolver: options.imageCodecResolver,
      iccTransformResolver: options.iccTransformResolver,
      iccEngine: options.iccEngine,
      annotationAppearances: options.annotationAppearances,
      onDiagnostic: options.onDiagnostic,
      enableSegmentMerge: options.segmentMerge !== false,
      enableInvisibleCull: options.invisibleCull !== false,
      pages: options.pages,
      extractTextContent: options.extractText === true,
      onProgress: progress.child(0.16, 0.9, { sourceType: "pdf" }).toCallback()
    };
    if (demandLoading && options.pageLoading !== "eager" && !options.compressScans) {
      const loader = await openPdfPageDemand(createParseBuffer(sourceBytes), extractOptions, () => {}, signal);
      try {
        signal?.throwIfAborted();
        const streaming = options.pageLoading === "auto";
        if (!streaming || loader.pageCount <= 16) await loader.loadInitialOverviews(signal, !streaming);
        if ((streaming && loader.pageCount > 16) || loader.requiresPageDemand) {
          const pagesPerRow = normalizePagesPerRow(options.maxPagesPerRow, loader.pageCount);
          const scene = prepareSceneForHepRendering(composeVectorScenesInGrid(loader.displayPageScenes, pagesPerRow, options.onDiagnostic));
          scene.sourcePdfByteLength = sourceBytes.byteLength;
          loader.bindDisplayScene(scene);
          progress.complete({ sourceType: "pdf" });
          signal?.throwIfAborted();
          return { scene, sourceLabel, sourceKind, sourceBytes, pageDemand: loader, sourceOptions: options };
        }
        const pagesPerRow = normalizePagesPerRow(options.maxPagesPerRow, loader.pageCount);
        const scene = prepareSceneForHepRendering(composeVectorScenesInGrid(loader.pageScenes, pagesPerRow, options.onDiagnostic));
        scene.sourcePdfByteLength = sourceBytes.byteLength;
        await loader.close();
        progress.complete({ sourceType: "pdf" });
        signal?.throwIfAborted();
        return { scene, sourceLabel, sourceKind, sourceBytes, sourceOptions: options };
      } catch (error) { await loader.close(); throw error; }
    }
    const pageScenes = await extractPdfPageScenes(
      createParseBuffer(sourceBytes),
      extractOptions,
      signal,
      "transfer"
    );
    signal?.throwIfAborted();
    const pagesPerRow = normalizePagesPerRow(options.maxPagesPerRow, pageScenes.length);
    const scene = prepareSceneForHepRendering(composeVectorScenesInGrid(pageScenes, pagesPerRow, options.onDiagnostic));
    scene.sourcePdfByteLength = sourceBytes.byteLength;
    signal?.throwIfAborted();
    progress.report(0.93, { stage: "compile", sourceType: "pdf" });
    signal?.throwIfAborted();
    progress.complete({ sourceType: "pdf" });
    signal?.throwIfAborted();
    return {
      scene,
      sourceLabel,
      sourceKind,
      sourceBytes,
      sourceOptions: options
    };
  }

  const scene = await waitForPromiseWithAbort(
    loadSceneFromHep(createParseBuffer(sourceBytes), {
      signal,
      onProgress: progress.child(0.16, 0.95, { sourceType: "hep" }).toCallback()
    }),
    signal
  );
  signal?.throwIfAborted();
  progress.complete({ sourceType: "hep" });
  signal?.throwIfAborted();
  return {
    scene,
    sourceLabel,
    sourceKind,
    sourceBytes
  };
}

/** @internal Read an accepted HEPR source without parsing it. */
export async function readPdfObjectSourceBytes(
  source: PdfObjectSource,
  progress?: LoadProgressReporter,
  /** @internal Used by HEP export to cancel source reads. */
  signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  progress?.report(0, { stage: "source", unit: "bytes" });
  signal?.throwIfAborted();
  if (source instanceof Uint8Array) {
    const bytes = new Uint8Array(source);
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    signal?.throwIfAborted();
    return bytes;
  }
  if (source instanceof ArrayBuffer) {
    const bytes = new Uint8Array(source).slice();
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    signal?.throwIfAborted();
    return bytes;
  }
  if (isBlobLike(source)) {
    const buffer = await waitForPromiseWithAbort(source.arrayBuffer(), signal);
    signal?.throwIfAborted();
    const bytes = new Uint8Array(buffer);
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    signal?.throwIfAborted();
    return bytes;
  }
  if (typeof source === "string") {
    const bytes = await readStringSourceBytes(source, progress, signal);
    signal?.throwIfAborted();
    progress?.complete({ stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    signal?.throwIfAborted();
    return bytes;
  }

  throw new Error("Unsupported source type. Expected File, Blob, Uint8Array, ArrayBuffer, or string.");
}

async function readStringSourceBytes(
  source: string,
  progress?: LoadProgressReporter,
  signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    throw new Error("Source string is empty.");
  }

  if (looksLikeDataUrl(trimmed)) {
    const bytes = decodeDataUrlBytes(trimmed);
    signal?.throwIfAborted();
    progress?.report(1, { stage: "source", unit: "bytes", processed: bytes.length, total: bytes.length });
    return bytes;
  }

  const decodedBase64 = tryDecodeBase64Bytes(trimmed);
  if (decodedBase64 && (
    hasPdfHeader(decodedBase64) || hasHepSignature(decodedBase64) || hasLegacyZipSignature(decodedBase64)
  )) {
    signal?.throwIfAborted();
    progress?.report(1, { stage: "source", unit: "bytes", processed: decodedBase64.length, total: decodedBase64.length });
    return decodedBase64;
  }

  const response = await waitForPromiseWithAbort(
    fetch(trimmed, { cache: "no-store", signal }),
    signal
  );
  signal?.throwIfAborted();
  if (!response.ok) {
    throw new Error(`Failed to load source path/URL (${response.status} ${response.statusText}).`);
  }
  return readResponseBytesWithProgress(response, progress, signal);
}

async function readResponseBytesWithProgress(
  response: Response,
  progress?: LoadProgressReporter,
  signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const totalHeader = Number(response.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? Math.trunc(totalHeader) : undefined;
  if (!response.body || !progress?.enabled) {
    const buffer = await waitForPromiseWithAbort(response.arrayBuffer(), signal);
    signal?.throwIfAborted();
    const bytes = new Uint8Array(buffer);
    progress?.report(1, {
      stage: "source",
      unit: "bytes",
      processed: bytes.length,
      total: total ?? bytes.length
    });
    signal?.throwIfAborted();
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  progress.report(0, { stage: "source", unit: "bytes", processed: 0, total });

  const cancelReader = (): void => {
    void reader.cancel(readAbortReason(signal)).catch(() => {
      // The fetch signal may already have errored the stream.
    });
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
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
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    reader.releaseLock();
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
  signal?.throwIfAborted();
  return bytes;
}

function readAbortReason(signal: AbortSignal | undefined): unknown {
  if (signal?.aborted) {
    try {
      signal.throwIfAborted();
    } catch (error) {
      return error;
    }
  }
  return new DOMException("The PDF source load was aborted.", "AbortError");
}

async function waitForPromiseWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) {
    return promise;
  }
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      finish(() => reject(readAbortReason(signal)));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

function resolveSourceKind(
  source: PdfObjectSource,
  sourceBytes: Uint8Array,
  sourceKindOption: PdfObjectGeneratorOptions["sourceKind"]
): PdfObjectSourceKind {
  if (sourceKindOption === "pdf" || sourceKindOption === "hep") {
    return sourceKindOption;
  }
  if (sourceKindOption !== undefined && sourceKindOption !== "auto") {
    throw new Error('sourceKind must be "pdf", "hep", or "auto".');
  }

  const sourceName = readSourceName(source);
  if (sourceName) {
    const lowered = sourceName.toLowerCase();
    if (lowered.endsWith(".pdf")) {
      return "pdf";
    }
    if (lowered.endsWith(".hep") || lowered.endsWith(".zip")) {
      return "hep";
    }
  }

  // Recognize old archives so the HEP reader can report how to migrate them.
  if (hasHepSignature(sourceBytes) || hasLegacyZipSignature(sourceBytes)) {
    return "hep";
  }
  if (hasPdfHeader(sourceBytes)) {
    return "pdf";
  }

  throw new Error(
    "Unable to detect source kind. Pass options.sourceKind as \"pdf\" or \"hep\"."
  );
}

function resolveSourceLabel(source: PdfObjectSource, sourceKind: PdfObjectSourceKind): string {
  const sourceName = readSourceName(source);
  if (sourceName) {
    return sourceName;
  }
  return sourceKind === "pdf" ? "document.pdf" : "parsed-data.hep";
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
    if (mime === "application/x-hep" || mime === "application/zip" || mime === "application/x-zip-compressed") {
      return "inline.hep";
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
