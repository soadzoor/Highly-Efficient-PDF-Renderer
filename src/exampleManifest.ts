export interface ExampleAssetManifestEntry {
  id?: unknown;
  name?: unknown;
  pdf?: {
    path?: unknown;
    sizeBytes?: unknown;
  };
  parsedZip?: {
    path?: unknown;
    sizeBytes?: unknown;
  };
}

export interface ExampleAssetManifest {
  generatedAt?: unknown;
  examples?: unknown;
}

export interface NormalizedExampleEntry {
  id: string;
  name: string;
  pdfPath: string;
  pdfSizeBytes: number;
  zipPath: string;
  zipSizeBytes: number;
}

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/i;

export function resolveAppAssetUrl(inputPath: string): string {
  const trimmedPath = inputPath.trim();
  if (ABSOLUTE_URL_PATTERN.test(trimmedPath)) {
    return trimmedPath;
  }

  const normalizedPath = trimmedPath.replace(/^\/+/, "");
  const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  return new URL(normalizedPath, appBaseUrl).toString();
}

export function normalizeExampleManifestEntries(manifest: ExampleAssetManifest): NormalizedExampleEntry[] {
  const rawEntries = Array.isArray(manifest.examples)
    ? (manifest.examples as ExampleAssetManifestEntry[])
    : [];
  const out: NormalizedExampleEntry[] = [];

  for (let i = 0; i < rawEntries.length; i += 1) {
    const raw = rawEntries[i];
    const name = readNonEmptyString(raw?.name);
    if (!name) {
      continue;
    }

    const idCandidate = readNonEmptyString(raw?.id) ?? `example-${i + 1}`;
    const rawPdfPath = readNonEmptyString(raw?.pdf?.path);
    const rawZipPath = readNonEmptyString(raw?.parsedZip?.path);
    const pdfPath = rawPdfPath ? resolveAppAssetUrl(rawPdfPath) : null;
    const zipPath = rawZipPath ? resolveAppAssetUrl(rawZipPath) : null;
    if (!pdfPath || !zipPath) {
      continue;
    }

    out.push({
      id: idCandidate,
      name,
      pdfPath,
      pdfSizeBytes: readNonNegativeInt(raw?.pdf?.sizeBytes, 0),
      zipPath,
      zipSizeBytes: readNonNegativeInt(raw?.parsedZip?.sizeBytes, 0)
    });
  }

  return out;
}

function readNonNegativeInt(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Math.max(0, Math.trunc(fallback));
  }
  return Math.max(0, Math.trunc(number));
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
