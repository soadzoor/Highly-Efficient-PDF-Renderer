import type { NodeDocumentSource, NodeDocumentSession, NodeDocumentSessionOpenOptions } from "./nodeDocumentSession";
import type { NativeVectorPdfSession } from "./pdfSession";
import { PdfError, type PdfDiagnostic, type PdfSource } from "./pdf/nativeTypes";
import { ProcessingSession } from "./documentSessionRuntime";
import { createNodeFilePdfSource, createNodeBundledStandardFontResolver, openPdfInNodeWorker } from "./nodePdfResources";
import { waitForLoad } from "./loadCancellation";
import { hasPdfHeader, PDF_HEADER_SCAN_BYTES } from "./pdfSignature";

export async function openNodeDocumentSessionRuntime(source: NodeDocumentSource,
  options: NodeDocumentSessionOpenOptions): Promise<NodeDocumentSession> {
  options.signal?.throwIfAborted();
  if (options.sourceKind !== undefined && options.sourceKind !== "pdf" && options.sourceKind !== "auto") {
    throw new RangeError("Node document sessions support PDF sources; source-free HEP thumbnails require a browser rendering backend.");
  }
  let input: PdfSource | undefined;
  let pdf: NativeVectorPdfSession | undefined;
  const diagnostics: PdfDiagnostic[] = [];
  const onDiagnostic = (diagnostic: PdfDiagnostic): void => { diagnostics.push(diagnostic); options.onDiagnostic?.(diagnostic); };
  try {
    input = await nodePdfSource(source, options.sourceLabel);
    options.signal?.throwIfAborted();
    const label = options.sourceLabel ?? input.label ?? "document.pdf";
    if (options.sourceKind !== "pdf") await assertPdfSource(input, options.signal);
    options.signal?.throwIfAborted();
    pdf = await openPdfInNodeWorker(input, { ...options, repair: options.repair ?? "safe", onDiagnostic,
      missingFontResolver: options.missingFontResolver ?? createNodeBundledStandardFontResolver() }) as NativeVectorPdfSession;
    options.signal?.throwIfAborted();
    return new ProcessingSession("pdf", pdf.info.byteLength, label, options, diagnostics, pdf, undefined, {
      canvas2dOnly: true,
      prewarmEncoder: true,
      createEncoder: async () => {
        const { NodeThumbnailEncoder } = await import("./nodeThumbnailEncoder");
        return new NodeThumbnailEncoder({ workerUrl: options.encoderWorkerUrl });
      }
    });
  } catch (error) {
    if (pdf) await (pdf.terminate?.() ?? pdf.close()).catch(() => undefined);
    else if (input?.kind === "range") await Promise.resolve(input.close?.()).catch(() => undefined);
    options.signal?.throwIfAborted();
    throw error;
  }
}

async function nodePdfSource(source: NodeDocumentSource, label?: string): Promise<PdfSource> {
  let input: PdfSource;
  if (source instanceof Uint8Array) input = { kind: "bytes", bytes: source, label };
  else if (source instanceof ArrayBuffer) input = { kind: "bytes", bytes: new Uint8Array(source), label };
  else if (source instanceof Blob) input = { kind: "blob", blob: source, label };
  else if (typeof source === "string" || source instanceof URL) {
    const url = source instanceof URL ? source : /^file:/i.test(source) ? new URL(source) : undefined;
    if (url?.protocol === "file:" || (typeof source === "string" && (!/^[a-z][a-z\d+.-]*:/i.test(source) || /^[a-z]:[\\/]/i.test(source)))) {
      input = await createNodeFilePdfSource(url ?? source as string, { label });
    } else input = { kind: "url", url: source, label: label ?? String(source) };
  } else if (source && typeof source === "object" && "kind" in source && ["bytes", "blob", "url", "range"].includes(source.kind)) {
    input = source;
  } else throw new TypeError("Expected a PDF path, file URL, Uint8Array, ArrayBuffer, Blob, or PdfSource.");
  if (input.kind !== "range") return input;
  // The worker and failed-open cleanup can both release a source. Own the
  // descriptor exactly once, including when worker creation itself fails.
  const range = input;
  let closing: Promise<void> | undefined;
  return { ...range, read: (offset, length, signal) => range.read(offset, length, signal),
    close: () => closing ??= Promise.resolve().then(() => range.close?.()) };
}

async function assertPdfSource(source: PdfSource, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let head: Uint8Array | undefined;
  if (source.kind === "bytes") head = source.bytes.subarray(0, PDF_HEADER_SCAN_BYTES);
  else if (source.kind === "blob") head = new Uint8Array(await waitForLoad(source.blob.slice(0, PDF_HEADER_SCAN_BYTES).arrayBuffer(), signal));
  else if (source.kind === "range") head = await waitForLoad(source.read(0, Math.min(PDF_HEADER_SCAN_BYTES, source.byteLength), signal ?? new AbortController().signal), signal);
  signal?.throwIfAborted();
  const signature = head && new TextDecoder().decode(head);
  if (head && hasPdfHeader(head)) return;
  const name = source.label ?? (source.kind === "url" ? String(source.url).split(/[?#]/, 1)[0] : "");
  if (signature?.startsWith("HEP") || signature?.startsWith("PK\u0003\u0004") || /\.(hep|zip)$/i.test(name)) {
    throw new PdfError("unsupported-content", "Source-free HEP thumbnails require a browser rendering backend; Node thumbnails accept PDFs.");
  }
}
