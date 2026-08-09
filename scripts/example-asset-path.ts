const UNSUPPORTED_PUBLIC_ASSET_FILENAME = /[\\/?#\u0000-\u001f\u007f]/u;

/** Encode one public asset filename so Vite's decodeURI-based lookup can find it. */
export function encodeExampleAssetPathSegment(fileName: string): string {
  if (
    fileName.length === 0 ||
    fileName === "." ||
    fileName === ".." ||
    UNSUPPORTED_PUBLIC_ASSET_FILENAME.test(fileName)
  ) {
    throw new Error(`Unsupported public asset filename: ${JSON.stringify(fileName)}`);
  }
  return encodeURI(fileName);
}
