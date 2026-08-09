const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // %PDF-
export const PDF_HEADER_SCAN_BYTES = 1024;

export interface PdfSignatureErrorContext {
  label?: string;
  contentType?: string | null;
}

/** Match PDF.js by accepting a PDF header anywhere in the first 1 KiB. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const scanLength = Math.min(bytes.length, PDF_HEADER_SCAN_BYTES);
  const lastStart = scanLength - PDF_HEADER.length;
  for (let offset = 0; offset <= lastStart; offset += 1) {
    let matches = true;
    for (let index = 0; index < PDF_HEADER.length; index += 1) {
      if (bytes[offset + index] !== PDF_HEADER[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
}

export function assertPdfBytes(bytes: Uint8Array, context: PdfSignatureErrorContext = {}): void {
  if (hasPdfHeader(bytes)) {
    return;
  }

  const label = context.label?.trim() || "PDF source";
  const contentType = normalizeContentType(context.contentType);
  const receivedHtml = contentType === "text/html" || looksLikeHtml(bytes);
  if (receivedHtml) {
    throw new Error(
      `Expected PDF data for ${label}, but received HTML instead. ` +
        "The asset URL may have resolved to an application fallback page."
    );
  }

  const contentTypeSuffix = contentType ? ` (content type ${contentType})` : "";
  throw new Error(
    `Expected PDF data for ${label}, but no %PDF- header was found in the first ` +
      `${PDF_HEADER_SCAN_BYTES.toLocaleString("en-US")} bytes${contentTypeSuffix}.`
  );
}

function normalizeContentType(value: string | null | undefined): string | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefixLength = Math.min(bytes.length, 128);
  let prefix = "";
  for (let index = 0; index < prefixLength; index += 1) {
    prefix += String.fromCharCode(bytes[index]);
  }
  const normalized = prefix.replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}
