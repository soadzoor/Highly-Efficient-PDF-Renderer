import { PDF_DIAGNOSTIC_CODES } from "./heprDocumentData";
import type { PdfDiagnostic } from "./pdf/nativeTypes";

type PdfViewingOptions = Readonly<{
  ocrTextOnly?: boolean;
  compressScans?: boolean;
  pageLoading?: "all" | "auto" | "eager";
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}>;

/** Resolve PDF viewing conflicts before choosing eager or demand loading. */
export function resolvePdfViewingOptions(options: PdfViewingOptions): Pick<PdfViewingOptions, "compressScans" | "pageLoading"> {
  let compressScans = options.compressScans;
  let pageLoading = options.pageLoading;
  if (compressScans && options.ocrTextOnly) {
    reportOptionConflict(options, {
      code: PDF_DIAGNOSTIC_CODES.CompressScansOcrConflict,
      severity: "warning",
      message: "compressScans: true conflicts with ocrTextOnly: true. Scan preparation is disabled because OCR-only viewing skips images; the requested pageLoading mode is retained.",
      details: { ignoredOption: "compressScans", requestedValue: true, effectiveValue: false, overridingOption: "ocrTextOnly" }
    });
    compressScans = false;
  } else if (compressScans && pageLoading === "auto") {
    reportOptionConflict(options, {
      code: PDF_DIAGNOSTIC_CODES.CompressScansStreamingConflict,
      severity: "warning",
      message: 'pageLoading: "auto" conflicts with compressScans: true. Scan preparation loads all selected pages upfront, so page streaming is disabled and pageLoading uses "eager".',
      details: { ignoredOption: "pageLoading", requestedValue: "auto", effectiveValue: "eager", overridingOption: "compressScans" }
    });
    pageLoading = "eager";
  }
  return { compressScans, pageLoading };
}

function reportOptionConflict(options: PdfViewingOptions, diagnostic: PdfDiagnostic): void {
  console.warn(`[HEPR] ${diagnostic.message}`, diagnostic.details);
  options.onDiagnostic?.(diagnostic);
}
