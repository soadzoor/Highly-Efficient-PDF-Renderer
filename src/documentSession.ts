import type { PdfObjectSource, PdfObjectSourceKind } from "./pdfObjectGenerator";
import type { OpenPdfOptions } from "./pdfSession";
import type { BuildHepFromPdfOptions, HepBuildResult } from "./hepBuilder";
import type { PdfThumbnailOptions, PdfThumbnailResult } from "./pdfThumbnail";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { waitForLoad } from "./loadCancellation";

export interface DocumentSessionOpenOptions extends OpenPdfOptions {
  sourceLabel?: string;
  sourceKind?: PdfObjectSourceKind | "auto";
}

export type DocumentSessionHepOptions = Omit<BuildHepFromPdfOptions,
  "password" | "imageCodecResolver" | "iccTransformResolver" | "iccEngine" | "embeddedFontPaint">;

export interface DocumentSessionInfo {
  readonly sourceKind: PdfObjectSourceKind;
  readonly pageCount: number;
  readonly pages: readonly { readonly width: number; readonly height: number }[];
}

export interface DocumentSession {
  readonly info: DocumentSessionInfo;
  renderThumbnail(options?: PdfThumbnailOptions): Promise<PdfThumbnailResult>;
  /** Canonical conversion; thumbnail approximations never enter HEP output. */
  buildHep(options?: DocumentSessionHepOptions): Promise<Blob>;
  /** Canonical HEP plus a reusable scene that remains usable after close(). */
  buildHepWithScene(options?: DocumentSessionHepOptions): Promise<HepBuildResult>;
  getDiagnostics(): readonly PdfDiagnostic[];
  close(): Promise<void>;
}

/** Open one reusable PDF parser or HEP scene; the caller owns close(). */
export async function openDocumentSession(source: PdfObjectSource, options: DocumentSessionOpenOptions = {}): Promise<DocumentSession> {
  options.signal?.throwIfAborted();
  const runtime = await waitForLoad(import("./documentSessionRuntime"), options.signal);
  options.signal?.throwIfAborted();
  return runtime.openDocumentSessionRuntime(source, options);
}
