import type { HepArchive } from "./hepContainer";

interface HepSizeManifest {
  sourceFile?: string;
  lod?: unknown;
}

export function validateSourcePdfByteLength(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError("sourcePdfByteLength must be a positive safe integer.");
  }
}

/** Remove only regenerable caches; the complete canonical document stays intact. */
export function omitHepLodForSizeBudget(
  archive: HepArchive,
  manifest: HepSizeManifest,
  candidateByteLength: number,
  sourcePdfByteLength: number
): boolean {
  if (candidateByteLength < sourcePdfByteLength) return false;
  const files = Object.keys(archive.files).filter(name =>
    name.startsWith("lod-vector/") || name.startsWith("lod-text/"));
  if (!manifest.lod && files.length === 0) return false;
  for (const name of files) archive.remove(name);
  delete manifest.lod;
  archive.file("manifest.json", JSON.stringify(manifest));
  console.warn(
    `[HEP] Omitted stored LOD caches for ${manifest.sourceFile ?? "document.pdf"}: the complete HEP ` +
    `(${candidateByteLength} bytes) must be smaller than the original PDF (${sourcePdfByteLength} bytes). ` +
    "LOD caches will be built when needed."
  );
  return true;
}

export function assertHepSizeBelowPdf(
  candidateByteLength: number,
  sourcePdfByteLength: number | undefined,
  label: string
): void {
  if (sourcePdfByteLength !== undefined && candidateByteLength >= sourcePdfByteLength) {
    throw new RangeError(
      `Cannot export ${label}: the HEP without stored LOD caches (${candidateByteLength} bytes) ` +
      `is not smaller than the original PDF (${sourcePdfByteLength} bytes). ` +
      "Keep the original PDF; no document content was discarded."
    );
  }
}
