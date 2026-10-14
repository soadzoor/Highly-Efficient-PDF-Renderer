import type { PdfObjectSource } from "./pdfObjectGenerator";
import type { PdfSource } from "./pdf/nativeTypes";
import type { NodePdfWorkerOpenOptions } from "./pdf/workerClient";
import type { DocumentSession, DocumentSessionOpenOptions } from "./documentSession";
import type { PdfThumbnailOptions, PdfThumbnailResult } from "./pdfThumbnail";
import { normalizeThumbnailOptions } from "./thumbnailOptions";
import { waitForLoad } from "./loadCancellation";

/** Strings are local paths or URLs; Buffer is accepted as a Uint8Array. */
export type NodeDocumentSource = PdfObjectSource | URL | PdfSource;

export interface NodeDocumentSessionOpenOptions extends Omit<DocumentSessionOpenOptions, "sourceKind">, NodePdfWorkerOpenOptions {
  /** Source-free HEP thumbnails require a browser rendering backend. */
  sourceKind?: "pdf" | "auto";
  /** Override the emitted Node encoder worker, primarily for custom hosts/tests. */
  encoderWorkerUrl?: string | URL;
}

export interface NodePdfThumbnailOptions extends Omit<PdfThumbnailOptions, "backend"> {
  /** Both use the optional native Canvas2D backend in a parser worker. */
  backend?: "auto" | "canvas2d";
}

export interface NodeDocumentSession extends Omit<DocumentSession, "renderThumbnail"> {
  renderThumbnail(options?: NodePdfThumbnailOptions): Promise<PdfThumbnailResult>;
}

/** Open a reusable Node PDF parser; the caller owns close(). */
export async function openDocumentSession(source: NodeDocumentSource,
  options: NodeDocumentSessionOpenOptions = {}): Promise<NodeDocumentSession> {
  options.signal?.throwIfAborted();
  const runtime = await waitForLoad(import("./nodeDocumentSessionRuntime"), options.signal);
  options.signal?.throwIfAborted();
  return runtime.openNodeDocumentSessionRuntime(source, options);
}

/** Render one PDF overview using Node worker threads, without browser globals. */
export async function renderPdfThumbnail(source: NodeDocumentSource,
  options: NodePdfThumbnailOptions & NodeDocumentSessionOpenOptions = {}): Promise<PdfThumbnailResult> {
  const normalized = normalizeThumbnailOptions(options);
  if (normalized.backend === "webgl") throw new RangeError("Node thumbnails support the auto and canvas2d backends.");
  const started = performance.now();
  const session = await openDocumentSession(source, options);
  let failed = true;
  let result: PdfThumbnailResult;
  try {
    options.signal?.throwIfAborted();
    options.onTiming?.({ stage: "source-open", durationMs: performance.now() - started });
    result = await session.renderThumbnail({ ...options,
      onTiming: options.onTiming ? timing => { if (timing.stage !== "total") options.onTiming!(timing); } : undefined });
    options.signal?.throwIfAborted();
    failed = false;
  } finally {
    if (failed) await session.close().catch(() => undefined);
    else await session.close();
  }
  options.signal?.throwIfAborted();
  options.onTiming?.({ stage: "total", durationMs: performance.now() - started });
  options.signal?.throwIfAborted();
  return result;
}
