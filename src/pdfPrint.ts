import type { PdfDownloadSource } from "./downloadUtils";
import type { VectorScene } from "./pdfVectorExtractor";
import { createLoadProgressReporter, type LoadProgressCallback } from "./loadProgress";
import { waitForLoad } from "./loadCancellation";
import { assertPdfBytes, PDF_HEADER_SCAN_BYTES } from "./pdfSignature";

export interface PdfPrintOptions {
  readonly filename?: string;
  readonly title?: string;
}

/** Open a PDF in the browser's print viewer, downloading it if printing is unavailable. */
export function printPdfBlob(blob: Blob, document: Document, options: PdfPrintOptions = {}): void {
  const owner = document.defaultView;
  if (!owner) throw new Error("PDF printing requires a document with a browser window.");
  const url = owner.URL.createObjectURL(blob), frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0";
  frame.setAttribute("title", options.title ?? "Print PDF");
  let cleaned = false, downloaded = false, target: Window | null = null;
  const cleanup = (): void => {
    if (cleaned) return; cleaned = true;
    frame.removeEventListener("load", loaded); frame.removeEventListener("error", fallback);
    owner.removeEventListener("afterprint", cleanup); target?.removeEventListener("afterprint", cleanup);
    frame.remove(); owner.URL.revokeObjectURL(url);
  };
  const fallback = (): void => {
    if (cleaned || downloaded) return; downloaded = true;
    try {
      const downloadUrl = owner.URL.createObjectURL(blob), link = document.createElement("a");
      link.href = downloadUrl; link.download = options.filename ?? "print.pdf"; link.style.display = "none";
      try { document.body.append(link); link.click(); }
      finally { link.remove(); owner.setTimeout(() => owner.URL.revokeObjectURL(downloadUrl), 0); }
    } finally { cleanup(); }
  };
  const loaded = (): void => {
    if (cleaned) return;
    try {
      target = frame.contentWindow;
      if (!target || typeof target.print !== "function") { fallback(); return; }
      target.addEventListener("afterprint", cleanup, { once: true }); target.focus(); target.print();
    } catch { fallback(); }
  };
  frame.addEventListener("load", loaded, { once: true }); frame.addEventListener("error", fallback, { once: true });
  owner.addEventListener("afterprint", cleanup, { once: true });
  frame.src = url;
  try { document.body.append(frame); } catch (error) { cleanup(); throw error; }
}

export interface PreparePrintPdfInput {
  readonly sourcePdf?: PdfDownloadSource;
  readonly password?: string;
  /** One-based pages/ranges, matching PDF loading's pages option. */
  readonly pages?: string;
  readonly scene?: VectorScene;
}

export interface PreparePrintPdfOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: LoadProgressCallback;
  readonly onWarning?: (message: string) => void;
}

/** Prepare original PDF objects or a vector scene for printing without opening an editor. */
export async function preparePrintPdf(input: PreparePrintPdfInput, options: PreparePrintPdfOptions = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  const { sourcePdf, password, pages, scene } = input;
  if (!sourcePdf) {
    if (!scene) throw new Error("No PDF or scene is available to print.");
    const { writeScenePdf } = await import("./editorPdfWriter");
    options.signal?.throwIfAborted();
    return writeScenePdf(scene, options);
  }
  const source = { ...sourcePdf }, signal = options.signal, progress = createLoadProgressReporter(options.onProgress);
  progress.report(0, { stage: "source", sourceType: "pdf" });
  let blob: Blob;
  if (source.blob) blob = source.blob;
  else if (source.bytes?.length) blob = new Blob([source.bytes.slice().buffer], { type: "application/pdf" });
  else if (source.url) {
    const response = await waitForLoad(fetch(source.url, { cache: "no-store", signal }), signal);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await waitForLoad(response.blob(), signal);
  } else throw new Error("No PDF source is available.");
  const bytes = new Uint8Array(await waitForLoad(blob.arrayBuffer(), signal));
  signal?.throwIfAborted();
  assertPdfBytes(bytes.subarray(0, PDF_HEADER_SCAN_BYTES), { label: source.label, contentType: blob.type });
  progress.report(.15, { stage: "source", sourceType: "pdf", unit: "bytes", processed: bytes.length, total: bytes.length });
  const [{ NativePdfDocument }, { resolvePdfPageNumbers }] = await Promise.all([
    import("./pdf/nativeDocument"), import("./pdfVectorExtractor")
  ]);
  signal?.throwIfAborted();
  const document = await NativePdfDocument.open({ kind: "bytes", bytes }, { password, signal,
    onDiagnostic: value => { if (value.severity === "warning") options.onWarning?.(value.message); } });
  let printableBytes: Uint8Array = bytes, removed: number[];
  try {
    const selected = new Set(resolvePdfPageNumbers(document.pages.length, pages).map(page => page - 1));
    removed = document.pages.flatMap((_, index) => selected.has(index) ? [] : [index]);
    progress.report(.3, { stage: "compile", sourceType: "pdf", unit: "pages", total: selected.size, pageCount: selected.size });
    if (document.getWriterState().protection) {
      const { NativePdfWriter } = await import("./pdf/nativeWriter");
      printableBytes = await new NativePdfWriter(document).save(signal, { protection: { mode: "remove" } });
    }
    signal?.throwIfAborted();
  } finally { await document.close(); }
  if (removed.length) {
    const { manipulatePdfPages } = await import("./editorPdfPages");
    const child = progress.child(.4, .98);
    blob = await manipulatePdfPages(printableBytes, { kind: "remove", pages: removed }, { signal,
      onProgress: value => child.report(value.value, { ...value, stage: value.stage === "complete" ? "compile" : value.stage }),
      onDiagnostic: value => { if (value.severity === "warning") options.onWarning?.(value.message); } });
  } else if (printableBytes !== bytes || blob.type !== "application/pdf") {
    blob = new Blob([printableBytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  }
  signal?.throwIfAborted(); progress.complete({ sourceType: "pdf" });
  return blob;
}
