import { assertPdfBytes, PDF_HEADER_SCAN_BYTES } from "./pdfSignature";

export interface PdfDownloadSource {
  label: string;
  bytes?: Uint8Array;
  blob?: Blob;
  url?: string;
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

export async function readPdfDownloadBlob(source: PdfDownloadSource): Promise<Blob> {
  if (source.blob) {
    await assertPdfBlob(source.blob, source.label, source.blob.type);
    return source.blob.type === "application/pdf"
      ? source.blob
      : new Blob([source.blob], { type: "application/pdf" });
  }

  if (source.bytes && source.bytes.length > 0) {
    assertPdfBytes(source.bytes.subarray(0, PDF_HEADER_SCAN_BYTES), { label: source.label });
    return new Blob([copyBytesToArrayBuffer(source.bytes)], { type: "application/pdf" });
  }

  if (source.url) {
    const response = await fetch(source.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    await assertPdfBlob(blob, source.label || source.url, response.headers.get("content-type"));
    return blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
  }

  throw new Error("No PDF source is available.");
}

async function assertPdfBlob(blob: Blob, label: string, contentType?: string | null): Promise<void> {
  const headerBytes = new Uint8Array(await blob.slice(0, PDF_HEADER_SCAN_BYTES).arrayBuffer());
  assertPdfBytes(headerBytes, { label, contentType });
}

export async function readPdfDownloadBytes(source: PdfDownloadSource): Promise<Uint8Array> {
  const blob = await readPdfDownloadBlob(source);
  return new Uint8Array(await blob.arrayBuffer());
}

export function formatPdfDownloadFilename(label: string): string {
  const trimmed = label.trim();
  const withoutFormatLabel = trimmed.replace(/\s*\((?:hep|parsed zip)\)\s*$/i, "");
  const isParsedDataFile = /\.(?:hep|zip)$/i.test(withoutFormatLabel);
  const withoutExtension = withoutFormatLabel.replace(/\.(?:pdf|hep|zip)$/i, "");
  const withoutParsedDataSuffix = isParsedDataFile
    ? withoutExtension.replace(/[._-]?parsed[._-]?data$/i, "")
    : withoutExtension;
  const normalized = withoutParsedDataSuffix.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${normalized.length > 0 ? normalized : "document"}.pdf`;
}

export function filenameFromUrl(inputUrl: string, fallback: string): string {
  try {
    const parsed = new URL(inputUrl, window.location.href);
    const pathName = decodeURIComponent(parsed.pathname);
    const fileName = pathName.split("/").filter(Boolean).pop();
    return fileName && fileName.trim().length > 0 ? fileName : fallback;
  } catch {
    return fallback;
  }
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
