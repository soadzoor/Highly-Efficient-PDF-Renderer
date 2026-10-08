export function validateSourcePdfByteLength(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError("sourcePdfByteLength must be a positive safe integer.");
  }
}

/** File size is advisory; keep the complete document and requested caches. */
export function warnIfHepSizeExceedsPdf(
  candidateByteLength: number,
  sourcePdfByteLength: number | undefined,
  label: string,
  onWarning?: (message: string) => void
): void {
  if (sourcePdfByteLength !== undefined && candidateByteLength >= sourcePdfByteLength) {
    const message = `HEP export for ${label} is ${(candidateByteLength / 1_000_000).toFixed(1)} MB ` +
      `(${candidateByteLength} bytes), compared with the original PDF at ${(sourcePdfByteLength / 1_000_000).toFixed(1)} MB ` +
      `(${sourcePdfByteLength} bytes). The download includes all document content and selected LOD caches.`;
    console.warn(`[HEP] ${message}`);
    onWarning?.(message);
  }
}
