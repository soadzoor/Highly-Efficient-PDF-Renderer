import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

interface ExampleOptionManifestEntry {
  id: string;
  name: string;
  pdf: {
    path: string;
    sizeBytes: number;
  };
  parsedZip: {
    path: string;
    sizeBytes: number;
  };
}

interface ExampleManifest {
  generatedAt: string;
  examples: ExampleOptionManifestEntry[];
}

interface NamedFile {
  name: string;
  sizeBytes: number;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const outputRootDir = path.resolve(repoRootDir, "public", "examples");
const outputPdfDir = path.resolve(outputRootDir, "pdfs");
const outputZipDir = path.resolve(outputRootDir, "zips");
const outputManifestPath = path.resolve(outputRootDir, "manifest.json");

async function main(): Promise<void> {
  const pdfFiles = await readFilesWithExtension(outputPdfDir, ".pdf");
  const zipFiles = await readFilesWithExtension(outputZipDir, ".zip");

  if (pdfFiles.length === 0) {
    throw new Error(`No PDFs found in ${outputPdfDir}`);
  }
  if (zipFiles.length === 0) {
    throw new Error(`No ZIPs found in ${outputZipDir}`);
  }

  const zipBuckets = buildZipBuckets(zipFiles);
  const usedIds = new Set<string>();
  const manifestEntries: ExampleOptionManifestEntry[] = [];
  const missingZipPdfs: string[] = [];

  for (const pdf of pdfFiles) {
    const pdfStem = path.parse(pdf.name).name;
    const comparableKey = normalizeComparableStem(pdfStem);
    const zipList = zipBuckets.get(comparableKey);
    const matchedZip = zipList && zipList.length > 0 ? zipList.shift() : undefined;

    if (!matchedZip) {
      missingZipPdfs.push(pdf.name);
      continue;
    }

    const id = makeUniqueId(pdfStem, usedIds, manifestEntries.length + 1);
    manifestEntries.push({
      id,
      name: pdf.name,
      pdf: {
        path: `/examples/pdfs/${encodeURIComponent(pdf.name)}`,
        sizeBytes: pdf.sizeBytes
      },
      parsedZip: {
        path: `/examples/zips/${encodeURIComponent(matchedZip.name)}`,
        sizeBytes: matchedZip.sizeBytes
      }
    });
  }

  manifestEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const unusedZipNames = collectUnusedZipNames(zipBuckets);
  const manifest: ExampleManifest = {
    generatedAt: new Date().toISOString(),
    examples: manifestEntries
  };

  await fs.writeFile(outputManifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[examples] manifest written: ${outputManifestPath}`);
  console.log(`[examples] matched ${manifestEntries.length} PDF/ZIP pair(s).`);

  if (missingZipPdfs.length > 0) {
    console.warn(`[examples] PDFs without matching ZIP (${missingZipPdfs.length}): ${missingZipPdfs.join(", ")}`);
  }
  if (unusedZipNames.length > 0) {
    console.warn(`[examples] ZIPs without matching PDF (${unusedZipNames.length}): ${unusedZipNames.join(", ")}`);
  }
}

async function readFilesWithExtension(dirPath: string, extension: string): Promise<NamedFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const out: NamedFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.toLowerCase().endsWith(extension)) {
      continue;
    }

    const absolutePath = path.resolve(dirPath, entry.name);
    const stat = await fs.stat(absolutePath);
    out.push({
      name: entry.name,
      sizeBytes: stat.size
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return out;
}

function buildZipBuckets(zipFiles: NamedFile[]): Map<string, NamedFile[]> {
  const buckets = new Map<string, NamedFile[]>();

  for (const zip of zipFiles) {
    const zipStem = path.parse(zip.name).name;
    const comparable = normalizeComparableStem(stripParsedDataSuffix(zipStem));
    if (!comparable) {
      continue;
    }

    const bucket = buckets.get(comparable) ?? [];
    bucket.push(zip);
    buckets.set(comparable, bucket);
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => scoreZipName(a.name) - scoreZipName(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  return buckets;
}

function stripParsedDataSuffix(stem: string): string {
  return stem.replace(/[._-]?parsed[._-]?data$/i, "");
}

function scoreZipName(name: string): number {
  const lower = name.toLowerCase();
  if (lower.endsWith("-parsed-data.zip")) {
    return 0;
  }
  if (lower.endsWith(".parsed-data.zip")) {
    return 1;
  }
  if (lower.endsWith("_parsed_data.zip")) {
    return 2;
  }
  return 3;
}

function collectUnusedZipNames(zipBuckets: Map<string, NamedFile[]>): string[] {
  const names: string[] = [];
  for (const bucket of zipBuckets.values()) {
    for (const zip of bucket) {
      names.push(zip.name);
    }
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return names;
}

function makeUniqueId(baseName: string, used: Set<string>, index: number): string {
  const stem = normalizeIdStem(baseName) || `example-${index}`;
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeIdStem(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function normalizeComparableStem(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

await main();
