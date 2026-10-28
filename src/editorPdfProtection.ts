import { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfWriter } from "./pdf/nativeWriter";
import { validatePdfOutputProtection, type PdfOutputProtection } from "./pdf/pdfProtection";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { createLoadProgressReporter, type LoadProgressCallback } from "./loadProgress";

export interface PdfProtectionChangeOptions {
  /** Existing user or owner password, when the source requires one. */
  password?: string;
  signal?: AbortSignal;
  onProgress?: LoadProgressCallback;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}

/** Change PDF encryption directly, preserving its objects without rendering pages. */
export async function changePdfProtection(bytes: Uint8Array, protection: PdfOutputProtection,
  options: PdfProtectionChangeOptions = {}): Promise<Blob> {
  const result = await rewritePdfProtection(bytes, protection, options);
  return new Blob([result as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

/** @internal Apply final output protection after a complete scene/PDF has been compiled. */
export async function rewritePdfProtection(bytes: Uint8Array, protection: PdfOutputProtection | undefined,
  options: PdfProtectionChangeOptions = {}, encryptionSource?: NativePdfDocument): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const policy = validatePdfOutputProtection(protection);
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0, { stage: "source", sourceType: "pdf", unit: "bytes", processed: 0, total: bytes.length });
  const document = await NativePdfDocument.open({ kind: "bytes", bytes: bytes.slice() }, {
    password: options.password, signal: options.signal, onDiagnostic: options.onDiagnostic
  });
  try {
    options.signal?.throwIfAborted();
    progress.report(.2, { stage: "compile", sourceType: "pdf", unit: "bytes", processed: bytes.length, total: bytes.length });
    const output = await new NativePdfWriter(document).save(options.signal, { protection: policy, encryptionSource });
    options.signal?.throwIfAborted();
    progress.complete({ sourceType: "pdf", unit: "bytes", processed: output.length, total: output.length });
    return output;
  } finally { await document.close(); }
}
