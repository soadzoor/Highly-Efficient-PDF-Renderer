import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import { encodeExampleAssetPathSegment } from "./example-asset-path.ts";

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
const outputHepDir = path.resolve(outputRootDir, "heps");
const outputManifestPath = path.resolve(outputRootDir, "manifest.json");

async function main(): Promise<void> {
  const pdfFiles = await readFilesWithExtensions(outputPdfDir, [".pdf"]);
  const hepFiles = await readFilesWithExtensions(outputHepDir, [".hep"]);

  if (pdfFiles.length === 0) {
    throw new Error(`No PDFs found in ${outputPdfDir}`);
  }
  if (hepFiles.length === 0) {
    throw new Error(`No HEP files found in ${outputHepDir}`);
  }

  const hepBuckets = buildHepBuckets(hepFiles);
  const usedIds = new Set<string>();
  const manifestEntries: ExampleOptionManifestEntry[] = [];
  const missingHepPdfs: string[] = [];

  for (const pdf of pdfFiles) {
    const pdfStem = path.parse(pdf.name).name;
    const comparableKey = normalizeComparableStem(pdfStem);
    const hepList = hepBuckets.get(comparableKey);
    const matchedHep = hepList && hepList.length > 0 ? hepList.shift() : undefined;

    if (!matchedHep) {
      missingHepPdfs.push(pdf.name);
      continue;
    }

    const id = makeUniqueId(pdfStem, usedIds, manifestEntries.length + 1);
    manifestEntries.push({
      id,
      name: pdf.name,
      pdf: {
        path: `examples/pdfs/${encodeExampleAssetPathSegment(pdf.name)}`,
        sizeBytes: pdf.sizeBytes
      },
      parsedZip: {
        path: `examples/heps/${encodeExampleAssetPathSegment(matchedHep.name)}`,
        sizeBytes: matchedHep.sizeBytes
      }
    });
  }

  manifestEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const unusedHepNames = collectUnusedHepNames(hepBuckets);
  const manifest: ExampleManifest = {
    generatedAt: new Date().toISOString(),
    examples: manifestEntries
  };

  await fs.writeFile(outputManifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[examples] manifest written: ${outputManifestPath}`);
  console.log(`[examples] matched ${manifestEntries.length} PDF/HEP pair(s).`);

  if (missingHepPdfs.length > 0) {
    console.warn(`[examples] PDFs without matching HEP (${missingHepPdfs.length}): ${missingHepPdfs.join(", ")}`);
  }
  if (unusedHepNames.length > 0) {
    console.warn(`[examples] HEP files without matching PDF (${unusedHepNames.length}): ${unusedHepNames.join(", ")}`);
  }
}

async function readFilesWithExtensions(dirPath: string, extensions: readonly string[]): Promise<NamedFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const out: NamedFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const lowerName = entry.name.toLowerCase();
    if (!extensions.some((extension) => lowerName.endsWith(extension))) {
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

function buildHepBuckets(hepFiles: NamedFile[]): Map<string, NamedFile[]> {
  const buckets = new Map<string, NamedFile[]>();

  for (const hep of hepFiles) {
    const hepStem = path.parse(hep.name).name;
    const comparable = normalizeComparableStem(stripParsedDataSuffix(hepStem));
    if (!comparable) {
      continue;
    }

    const bucket = buckets.get(comparable) ?? [];
    bucket.push(hep);
    buckets.set(comparable, bucket);
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => scoreHepName(a.name) - scoreHepName(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  return buckets;
}

function stripParsedDataSuffix(stem: string): string {
  return stem.replace(/[._-]?parsed[._-]?data$/i, "");
}

function scoreHepName(name: string): number {
  const lower = name.toLowerCase();
  const stem = lower.replace(/\.hep$/i, "");
  if (stem.endsWith("-parsed-data")) {
    return 0;
  }
  if (stem.endsWith(".parsed-data")) {
    return 1;
  }
  if (stem.endsWith("_parsed_data")) {
    return 2;
  }
  return 3;
}

function collectUnusedHepNames(hepBuckets: Map<string, NamedFile[]>): string[] {
  const names: string[] = [];
  for (const bucket of hepBuckets.values()) {
    for (const hep of bucket) {
      names.push(hep.name);
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
