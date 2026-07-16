#!/usr/bin/env node

// Dependency-free tooling for creating and checking a small, manually adjudicated
// floorplan room gold set. Detector outputs are unresolved review candidates; TSV
// agreement is used only to stratify page selection and is never copied as truth.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const DEFAULT_SCORE_REPORT = path.join(repoRootDir, ".eval", "live-final", "scores-iou50.json");
const DEFAULT_PDF_TSV_ROOT = path.join(repoRootDir, "pdf-tsv");
const DEFAULT_COUNT = 12;
const DEFAULT_SEED = 20260710;
const MIN_HIGH_AGREEMENT_POSITIVES = 10;
const MAX_JSON_BYTES = 128 * 1024 * 1024;
const PAGE_COVERAGES = new Set(["complete", "partial", "unknown"]);
const REGION_STATUSES = new Set(["room", "shaft-service", "non-room", "ambiguous"]);
const ACCEPTED_REGION_STATUSES = new Set(["room", "shaft-service"]);
const ORIGIN_KINDS = new Set(["detector", "edited-detector", "manual"]);
const EPSILON = 1e-9;

function usage() {
  return `Floorplan room gold-set adjudication helper (dependency-free)

Usage:
  node scripts/room-gold-set.mjs select [options]
  node scripts/room-gold-set.mjs validate MANIFEST [--json] [--check-files]
  node scripts/room-gold-set.mjs summary MANIFEST [--json]

Commands:
  select      Select a stratified page sample and seed detector candidates as ambiguous
  validate    Validate schema-critical fields, geometry, and no-overlap/no-containment
  summary     Report review coverage and region adjudication progress

select options:
  --score-report FILE    Noise-aware score report used only for sampling strata
                         (default: .eval/live-final/scores-iou50.json)
  --predictions DIR      Prediction JSON directory (default: report config)
  --pdf-tsv-root DIR     PDF corpus root (default: report config or pdf-tsv)
  --png-dir DIR          Optional existing detector-overlay PNG directory
  --output FILE          Gold manifest to create (required)
  --count N              Number of representative pages (default: ${DEFAULT_COUNT})
  --seed N               Deterministic selection seed (default: ${DEFAULT_SEED})

validate options:
  --json                  Print a machine-readable report
  --check-files           Warn when referenced source files do not exist

summary options:
  --json                  Print a machine-readable report

Adjudication labels:
  room | shaft-service | non-room | ambiguous

Page coverage:
  complete | partial | unknown

TSV polygons are not imported into the manifest and are never treated as truth.
See docs/room-gold-set.md for the review protocol.
`;
}

function parseArgs(argv) {
  const command = argv[2];
  if (!command || command === "-h" || command === "--help" || command === "help") {
    return { command: "help" };
  }
  if (!new Set(["select", "validate", "summary"]).has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const args = {
    command,
    manifest: null,
    scoreReport: DEFAULT_SCORE_REPORT,
    predictions: null,
    pdfTsvRoot: null,
    pngDir: null,
    output: null,
    count: DEFAULT_COUNT,
    seed: DEFAULT_SEED,
    json: false,
    checkFiles: false
  };

  function nextValue(index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  }

  for (let i = 3; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "-h" || value === "--help") {
      return { command: "help" };
    }
    if (value === "--score-report") {
      args.scoreReport = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--predictions") {
      args.predictions = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--pdf-tsv-root") {
      args.pdfTsvRoot = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--png-dir") {
      args.pngDir = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--output") {
      args.output = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--count") {
      args.count = Number(nextValue(i, value));
      i += 1;
    } else if (value === "--seed") {
      args.seed = Number(nextValue(i, value));
      i += 1;
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--check-files") {
      args.checkFiles = true;
    } else if (!value.startsWith("-") && command !== "select" && args.manifest === null) {
      args.manifest = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (command === "select") {
    if (!args.output) {
      throw new Error("select requires --output FILE.");
    }
    if (!Number.isInteger(args.count) || args.count < 1) {
      throw new Error("--count must be a positive integer.");
    }
    if (!Number.isSafeInteger(args.seed)) {
      throw new Error("--seed must be a safe integer.");
    }
  } else if (!args.manifest) {
    throw new Error(`${command} requires MANIFEST.`);
  }
  return args;
}

async function readJson(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  if (stat.size > MAX_JSON_BYTES) {
    throw new Error(`JSON input exceeds ${MAX_JSON_BYTES} bytes: ${filePath}`);
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function pathForManifest(filePath) {
  const relative = path.relative(repoRootDir, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : filePath;
}

function resolveManifestPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRootDir, value);
}

function quantile(sortedValues, ratio) {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * ratio)));
  return sortedValues[index];
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function pageKey(page) {
  return `${page.folder}/${page.stem}`;
}

function familyKey(page) {
  const prefix = String(page.stem).split("_")[0].trim().toLowerCase();
  return `${String(page.folder).toLowerCase()}/${prefix}`;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compareNullable(left, right, nullValue = 0) {
  return (left ?? nullValue) - (right ?? nullValue);
}

function buildSelectionQueues(pages, seed) {
  const scored = pages.filter((page) => page.status === "ok");
  const predictionCounts = pages.map((page) => finiteNumber(page.predictionValidGeometry) ?? 0).sort((a, b) => a - b);
  const recalls = scored
    .map((page) => finiteNumber(page.positiveLabelRecallAtThreshold))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const unmatchedRates = scored
    .map((page) => {
      const count = finiteNumber(page.predictionValidGeometry) ?? 0;
      const unmatched = (finiteNumber(page.unmatchedNumberedLikelyOmissionOrBoundaryMismatch) ?? 0) +
        (finiteNumber(page.unmatchedUnnumbered) ?? 0);
      return finiteRatio(unmatched, count);
    })
    .filter((value) => value !== null)
    .sort((a, b) => a - b);

  const thresholds = {
    sparsePredictionCount: quantile(predictionCounts, 0.25),
    densePredictionCount: quantile(predictionCounts, 0.75),
    lowAgreementRecall: quantile(recalls, 0.25),
    highAgreementRecall: quantile(recalls, 0.75),
    highUnmatchedRate: quantile(unmatchedRates, 0.75),
    highAgreementMinimumKnownPositiveCount: MIN_HIGH_AGREEMENT_POSITIVES
  };

  const enriched = pages.map((page) => {
    const predictionCount = finiteNumber(page.predictionValidGeometry) ?? 0;
    const knownPositiveCount = finiteNumber(page.tsvEvaluablePositiveLabels) ?? 0;
    const recall = finiteNumber(page.positiveLabelRecallAtThreshold);
    const meanBestIou = finiteNumber(page.positiveLabelMeanBestIou);
    const unmatched = (finiteNumber(page.unmatchedNumberedLikelyOmissionOrBoundaryMismatch) ?? 0) +
      (finiteNumber(page.unmatchedUnnumbered) ?? 0);
    const unmatchedRate = finiteRatio(unmatched, predictionCount);
    const tags = [];
    if (page.status === "no_tsv") {
      tags.push(page.folder === "not_floorplans" ? "negative-control" : "no-tsv");
    }
    if (recall !== null && thresholds.lowAgreementRecall !== null && recall <= thresholds.lowAgreementRecall) {
      tags.push("low-known-positive-agreement");
    }
    if (knownPositiveCount >= MIN_HIGH_AGREEMENT_POSITIVES && recall !== null &&
        thresholds.highAgreementRecall !== null && recall >= thresholds.highAgreementRecall) {
      tags.push("high-known-positive-agreement-control");
    }
    if (unmatchedRate !== null && thresholds.highUnmatchedRate !== null && unmatchedRate >= thresholds.highUnmatchedRate) {
      tags.push("many-unmatched-predictions");
    }
    if (predictionCount <= (thresholds.sparsePredictionCount ?? 0)) {
      tags.push("sparse");
    }
    if (predictionCount >= (thresholds.densePredictionCount ?? Number.POSITIVE_INFINITY)) {
      tags.push("dense");
    }
    if ((finiteNumber(page.tsvInvalidGeometry) ?? 0) > 0) {
      tags.push("invalid-weak-label-geometry");
    }
    if (tags.length === 0) {
      tags.push("midrange-control");
    }
    return {
      page,
      key: pageKey(page),
      family: familyKey(page),
      predictionCount,
      knownPositiveCount,
      recall,
      meanBestIou,
      unmatchedRate,
      unmatchedChallenge: (unmatchedRate ?? 0) * Math.log2(predictionCount + 1),
      tags,
      tie: stableHash(`${seed}/${pageKey(page)}`)
    };
  });

  function sorted(filter, compare) {
    return enriched
      .filter(filter)
      .sort((left, right) => compare(left, right) || left.tie - right.tie || left.key.localeCompare(right.key));
  }

  const queues = [
    {
      name: "no-tsv-floorplan",
      pages: sorted((item) => item.page.status === "no_tsv" && item.page.folder !== "not_floorplans", (a, b) => b.predictionCount - a.predictionCount)
    },
    {
      name: "negative-control",
      pages: sorted((item) => item.page.folder === "not_floorplans", (a, b) => a.predictionCount - b.predictionCount)
    },
    {
      name: "low-known-positive-agreement",
      pages: sorted((item) => item.page.status === "ok", (a, b) => compareNullable(a.recall, b.recall, 1))
    },
    {
      name: "high-known-positive-agreement-control",
      pages: sorted(
        (item) => item.page.status === "ok" && item.knownPositiveCount >= MIN_HIGH_AGREEMENT_POSITIVES,
        (a, b) => compareNullable(b.recall, a.recall, -1)
      )
    },
    {
      name: "many-unmatched-predictions",
      pages: sorted((item) => item.page.status === "ok", (a, b) => b.unmatchedChallenge - a.unmatchedChallenge)
    },
    {
      name: "dense",
      pages: sorted(() => true, (a, b) => b.predictionCount - a.predictionCount)
    },
    {
      name: "sparse",
      pages: sorted((item) => item.predictionCount > 0, (a, b) => a.predictionCount - b.predictionCount)
    },
    {
      name: "midrange-control",
      pages: sorted(() => true, (a, b) => {
        const median = quantile(predictionCounts, 0.5) ?? 0;
        return Math.abs(a.predictionCount - median) - Math.abs(b.predictionCount - median);
      })
    }
  ];
  return { queues, thresholds };
}

function selectPages(pages, count, seed) {
  const { queues, thresholds } = buildSelectionQueues(pages, seed);
  const selected = [];
  const selectedKeys = new Set();
  const folderCounts = new Map();
  const familyCounts = new Map();

  function chooseFromQueue(queue) {
    let best = null;
    for (let rank = 0; rank < queue.pages.length; rank += 1) {
      const item = queue.pages[rank];
      if (selectedKeys.has(item.key)) {
        continue;
      }
      const folderPenalty = (folderCounts.get(item.page.folder) ?? 0) * 4;
      const familyPenalty = (familyCounts.get(item.family) ?? 0) * 8;
      const score = rank + folderPenalty + familyPenalty;
      if (!best || score < best.score || (score === best.score && item.tie < best.item.tie)) {
        best = { item, score };
      }
    }
    return best?.item ?? null;
  }

  while (selected.length < count && selected.length < pages.length) {
    let added = false;
    for (const queue of queues) {
      if (selected.length >= count) {
        break;
      }
      const item = chooseFromQueue(queue);
      if (!item) {
        continue;
      }
      selected.push({ ...item, primaryStratum: queue.name });
      selectedKeys.add(item.key);
      folderCounts.set(item.page.folder, (folderCounts.get(item.page.folder) ?? 0) + 1);
      familyCounts.set(item.family, (familyCounts.get(item.family) ?? 0) + 1);
      added = true;
    }
    if (!added) {
      break;
    }
  }
  return { selected, thresholds };
}

async function indexPredictionFiles(predictionsDir) {
  const entries = await fs.readdir(predictionsDir, { withFileTypes: true });
  const index = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
      continue;
    }
    const filePath = path.join(predictionsDir, entry.name);
    const payload = await readJson(filePath);
    const folder = String(payload.folder ?? "").trim();
    const stem = String(payload.stem ?? "").trim();
    if (!folder || !stem) {
      continue;
    }
    const key = `${folder}/${stem}`;
    if (index.has(key)) {
      throw new Error(`Duplicate prediction key ${key}: ${filePath}`);
    }
    index.set(key, { filePath, payload });
  }
  return index;
}

function cleanFlatPolygon(value) {
  if (!Array.isArray(value) || value.length < 6 || value.length % 2 !== 0) {
    return null;
  }
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function seedRegions(predictionPayload) {
  const rooms = Array.isArray(predictionPayload.rooms) ? predictionPayload.rooms : [];
  const result = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index] ?? {};
    const polygon = cleanFlatPolygon(room.polygon);
    if (!polygon) {
      continue;
    }
    result.push({
      id: `detector-${String(index + 1).padStart(4, "0")}`,
      status: "ambiguous",
      polygon,
      origin: { kind: "detector", predictionIndices: [index] },
      attributes: {
        roomNumber: String(room.roomNumber ?? ""),
        labelText: String(room.labelText ?? ""),
        confidence: finiteNumber(room.confidence),
        hasDoorEvidence: typeof room.hasDoorEvidence === "boolean" ? room.hasDoorEvidence : null
      },
      notes: ""
    });
  }
  return result;
}

async function optionalSourcePath(filePath) {
  return (await isFile(filePath)) ? pathForManifest(filePath) : null;
}

function weakLabelSignals(page) {
  return {
    comparisonStatus: String(page.status ?? "unknown"),
    knownPositiveCount: finiteNumber(page.tsvEvaluablePositiveLabels),
    knownPositiveRecallAtThreshold: finiteNumber(page.positiveLabelRecallAtThreshold),
    knownPositiveMeanBestIou: finiteNumber(page.positiveLabelMeanBestIou),
    unmatchedPredictionCount:
      (finiteNumber(page.unmatchedNumberedLikelyOmissionOrBoundaryMismatch) ?? 0) +
      (finiteNumber(page.unmatchedUnnumbered) ?? 0),
    invalidGeometryCount: finiteNumber(page.tsvInvalidGeometry) ?? 0,
    isGroundTruth: false
  };
}

async function selectCommand(args) {
  const report = await readJson(args.scoreReport);
  if (!Array.isArray(report.pages) || report.pages.length === 0) {
    throw new Error(`Score report has no pages: ${args.scoreReport}`);
  }
  const predictionsDir = args.predictions ?? (report.config?.predictions ? path.resolve(report.config.predictions) : null);
  if (!predictionsDir) {
    throw new Error("Prediction directory is missing; pass --predictions DIR.");
  }
  const pdfTsvRoot = args.pdfTsvRoot ??
    (report.config?.pdfTsvRoot ? path.resolve(report.config.pdfTsvRoot) : DEFAULT_PDF_TSV_ROOT);
  const predictionIndex = await indexPredictionFiles(predictionsDir);
  const { selected, thresholds } = selectPages(report.pages, args.count, args.seed);
  if (selected.length === 0) {
    throw new Error("No pages could be selected from the report.");
  }

  const pages = [];
  for (const item of selected) {
    const prediction = predictionIndex.get(item.key);
    if (!prediction) {
      throw new Error(`Missing prediction JSON for selected page: ${item.key}`);
    }
    const pdfPath = path.join(pdfTsvRoot, item.page.folder, `${item.page.stem}.pdf`);
    const tsvPath = path.join(pdfTsvRoot, item.page.folder, `${item.page.stem}.tsv`);
    const overlayPath = args.pngDir
      ? path.join(args.pngDir, path.basename(prediction.filePath, ".json") + ".png")
      : null;
    pages.push({
      id: item.key,
      folder: item.page.folder,
      stem: item.page.stem,
      coverage: "unknown",
      selection: {
        primaryStratum: item.primaryStratum,
        challengeTags: item.tags,
        family: item.family,
        detectorCandidateCount: item.predictionCount,
        weakLabelSignals: weakLabelSignals(item.page)
      },
      sources: {
        pdf: await optionalSourcePath(pdfPath),
        detectorPrediction: pathForManifest(prediction.filePath),
        detectorOverlay: overlayPath ? await optionalSourcePath(overlayPath) : null,
        weakLabelTsv: await optionalSourcePath(tsvPath)
      },
      review: {
        reviewer: "",
        reviewedAt: null,
        notes: ""
      },
      regions: seedRegions(prediction.payload)
    });
  }

  const manifest = {
    schemaVersion: 1,
    kind: "floorplan-room-gold-set",
    generatedAt: new Date().toISOString(),
    coordinateSpace: "detector-scene-space",
    annotationPolicy: {
      tsvIsGroundTruth: false,
      acceptedRegionStatuses: ["room", "shaft-service"],
      topology: "Accepted regions must not overlap or contain one another."
    },
    selection: {
      method: "deterministic-stratified-round-robin-v1",
      requestedCount: args.count,
      selectedCount: pages.length,
      seed: args.seed,
      sourceScoreReport: pathForManifest(args.scoreReport),
      thresholds
    },
    pages
  };

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created ${pathForManifest(args.output)} with ${pages.length} pages and ${pages.reduce((sum, page) => sum + page.regions.length, 0)} unresolved detector candidates.`);
  const strata = new Map();
  for (const page of pages) {
    strata.set(page.selection.primaryStratum, (strata.get(page.selection.primaryStratum) ?? 0) + 1);
  }
  for (const [name, count] of strata) {
    console.log(`  ${name}: ${count}`);
  }
  console.log("Selected pages:");
  for (const page of pages) {
    console.log(`  [${page.selection.primaryStratum}] ${page.id}`);
  }
  console.log("TSV geometry was not imported; all detector candidates remain ambiguous until reviewed.");
}

function polygonPoints(flat) {
  const points = [];
  for (let index = 0; index < flat.length; index += 2) {
    points.push([flat[index], flat[index + 1]]);
  }
  return points;
}

function polygonSignedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    twiceArea += points[index][0] * points[next][1] - points[next][0] * points[index][1];
  }
  return twiceArea * 0.5;
}

function polygonBounds(points) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function boundsInteriorOverlap(left, right) {
  return left[0] < right[2] - EPSILON && right[0] < left[2] - EPSILON &&
    left[1] < right[3] - EPSILON && right[1] < left[3] - EPSILON;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point, left, right) {
  if (Math.abs(cross(left, right, point)) > EPSILON) {
    return false;
  }
  return point[0] >= Math.min(left[0], right[0]) - EPSILON &&
    point[0] <= Math.max(left[0], right[0]) + EPSILON &&
    point[1] >= Math.min(left[1], right[1]) - EPSILON &&
    point[1] <= Math.max(left[1], right[1]) + EPSILON;
}

function segmentsProperlyIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
}

// 1 = strictly inside, 0 = on boundary, -1 = outside.
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const left = polygon[previous];
    const right = polygon[index];
    if (pointOnSegment(point, left, right)) {
      return 0;
    }
    const crossesRay = (left[1] > point[1]) !== (right[1] > point[1]);
    if (crossesRay) {
      const x = ((right[0] - left[0]) * (point[1] - left[1])) / (right[1] - left[1]) + left[0];
      if (x > point[0]) {
        inside = !inside;
      }
    }
  }
  return inside ? 1 : -1;
}

function hasProperSelfIntersection(points) {
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    const leftNext = (leftIndex + 1) % points.length;
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const rightNext = (rightIndex + 1) % points.length;
      if (leftIndex === rightIndex || leftNext === rightIndex || rightNext === leftIndex) {
        continue;
      }
      if (segmentsProperlyIntersect(points[leftIndex], points[leftNext], points[rightIndex], points[rightNext])) {
        return true;
      }
    }
  }
  return false;
}

function everyPointOnBoundary(points, polygon) {
  return points.every((point) => polygon.some((left, index) => pointOnSegment(point, left, polygon[(index + 1) % polygon.length])));
}

function polygonSamples(points) {
  const samples = points.slice();
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    samples.push([(points[index][0] + next[0]) * 0.5, (points[index][1] + next[1]) * 0.5]);
  }
  return samples;
}

function polygonRelationship(left, right) {
  const leftBounds = polygonBounds(left);
  const rightBounds = polygonBounds(right);
  if (!boundsInteriorOverlap(leftBounds, rightBounds)) {
    return null;
  }
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (segmentsProperlyIntersect(
        left[leftIndex],
        left[(leftIndex + 1) % left.length],
        right[rightIndex],
        right[(rightIndex + 1) % right.length]
      )) {
        return "overlap";
      }
    }
  }
  const leftStates = polygonSamples(left).map((point) => pointInPolygon(point, right));
  if (leftStates.some((state) => state === 1)) {
    return leftStates.some((state) => state === -1) ? "overlap" : "left-contained-by-right";
  }
  const rightStates = polygonSamples(right).map((point) => pointInPolygon(point, left));
  if (rightStates.some((state) => state === 1)) {
    return rightStates.some((state) => state === -1) ? "overlap" : "right-contained-by-left";
  }

  // Parallel, partially coincident rectangles can share positive area without a
  // proper edge crossing or a strictly interior vertex (all candidate vertices land
  // on a boundary or outside). Deterministic probes in the common bounding box cover
  // that remaining case while shared boundary segments still have zero box thickness.
  const overlapMinX = Math.max(leftBounds[0], rightBounds[0]);
  const overlapMinY = Math.max(leftBounds[1], rightBounds[1]);
  const overlapWidth = Math.min(leftBounds[2], rightBounds[2]) - overlapMinX;
  const overlapHeight = Math.min(leftBounds[3], rightBounds[3]) - overlapMinY;
  for (let row = 0; row < 4; row += 1) {
    const y = overlapMinY + ((row + 0.5) / 4) * overlapHeight;
    for (let column = 0; column < 4; column += 1) {
      const x = overlapMinX + ((column + 0.5) / 4) * overlapWidth;
      if (pointInPolygon([x, y], left) === 1 && pointInPolygon([x, y], right) === 1) {
        return "overlap";
      }
    }
  }
  const leftArea = Math.abs(polygonSignedArea(left));
  const rightArea = Math.abs(polygonSignedArea(right));
  const areaScale = Math.max(1, leftArea, rightArea);
  if (Math.abs(leftArea - rightArea) <= EPSILON * areaScale &&
      everyPointOnBoundary(left, right) && everyPointOnBoundary(right, left)) {
    return "duplicate";
  }
  return null;
}

function validateManifest(manifest) {
  const errors = [];
  const warnings = [];
  const addError = (location, message) => errors.push({ location, message });
  const addWarning = (location, message) => warnings.push({ location, message });

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    addError("$", "Manifest must be a JSON object.");
    return { errors, warnings };
  }
  if (manifest.schemaVersion !== 1) {
    addError("$.schemaVersion", "Expected schemaVersion 1.");
  }
  if (manifest.kind !== "floorplan-room-gold-set") {
    addError("$.kind", 'Expected kind "floorplan-room-gold-set".');
  }
  if (manifest.coordinateSpace !== undefined && manifest.coordinateSpace !== "detector-scene-space") {
    addError("$.coordinateSpace", 'Expected coordinateSpace "detector-scene-space".');
  }
  if (manifest.annotationPolicy?.tsvIsGroundTruth !== false) {
    addError("$.annotationPolicy.tsvIsGroundTruth", "TSV must be explicitly marked as not ground truth.");
  }
  if (!Array.isArray(manifest.pages)) {
    addError("$.pages", "pages must be an array.");
    return { errors, warnings };
  }
  if (manifest.selection?.selectedCount !== undefined && manifest.selection.selectedCount !== manifest.pages.length) {
    addError("$.selection.selectedCount", "selectedCount must equal pages.length.");
  }

  const pageIds = new Set();
  for (let pageIndex = 0; pageIndex < manifest.pages.length; pageIndex += 1) {
    const page = manifest.pages[pageIndex];
    const location = `$.pages[${pageIndex}]`;
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      addError(location, "Page must be an object.");
      continue;
    }
    if (typeof page.id !== "string" || page.id.length === 0) {
      addError(`${location}.id`, "id must be a non-empty string.");
    } else if (pageIds.has(page.id)) {
      addError(`${location}.id`, `Duplicate page id: ${page.id}`);
    } else {
      pageIds.add(page.id);
    }
    if (typeof page.folder !== "string" || page.folder.trim().length === 0) {
      addError(`${location}.folder`, "folder must be a non-empty string.");
    }
    if (typeof page.stem !== "string" || page.stem.trim().length === 0) {
      addError(`${location}.stem`, "stem must be a non-empty string.");
    }
    if (typeof page.folder === "string" && typeof page.stem === "string" && page.id !== `${page.folder}/${page.stem}`) {
      addError(`${location}.id`, "id must equal folder/stem.");
    }
    if (page.selection?.weakLabelSignals?.isGroundTruth !== false) {
      addError(`${location}.selection.weakLabelSignals.isGroundTruth`, "Weak-label signals must be explicitly marked as not ground truth.");
    }
    if (!PAGE_COVERAGES.has(page.coverage)) {
      addError(`${location}.coverage`, `coverage must be one of: ${[...PAGE_COVERAGES].join(", ")}.`);
    }
    if (!page.sources || typeof page.sources.detectorPrediction !== "string" || page.sources.detectorPrediction.length === 0) {
      addError(`${location}.sources.detectorPrediction`, "detectorPrediction must be a non-empty path.");
    }
    if (!page.review || typeof page.review.reviewer !== "string") {
      addError(`${location}.review.reviewer`, "reviewer must be a string.");
    }
    if (page.review?.reviewedAt !== null && page.review?.reviewedAt !== undefined &&
        (typeof page.review.reviewedAt !== "string" || Number.isNaN(Date.parse(page.review.reviewedAt)))) {
      addError(`${location}.review.reviewedAt`, "reviewedAt must be null or an ISO-compatible date-time string.");
    }
    if (!Array.isArray(page.regions)) {
      addError(`${location}.regions`, "regions must be an array.");
      continue;
    }

    const regionIds = new Set();
    const accepted = [];
    let ambiguousCount = 0;
    for (let regionIndex = 0; regionIndex < page.regions.length; regionIndex += 1) {
      const region = page.regions[regionIndex];
      const regionLocation = `${location}.regions[${regionIndex}]`;
      if (!region || typeof region !== "object" || Array.isArray(region)) {
        addError(regionLocation, "Region must be an object.");
        continue;
      }
      if (typeof region.id !== "string" || region.id.length === 0) {
        addError(`${regionLocation}.id`, "id must be a non-empty string.");
      } else if (regionIds.has(region.id)) {
        addError(`${regionLocation}.id`, `Duplicate region id on page: ${region.id}`);
      } else {
        regionIds.add(region.id);
      }
      if (!REGION_STATUSES.has(region.status)) {
        addError(`${regionLocation}.status`, `status must be one of: ${[...REGION_STATUSES].join(", ")}.`);
      }
      if (region.status === "ambiguous") {
        ambiguousCount += 1;
      }
      if (!region.origin || !ORIGIN_KINDS.has(region.origin.kind)) {
        addError(`${regionLocation}.origin.kind`, `origin.kind must be one of: ${[...ORIGIN_KINDS].join(", ")}.`);
      } else if (region.origin.kind !== "manual" &&
          (!Array.isArray(region.origin.predictionIndices) || region.origin.predictionIndices.length === 0 ||
            region.origin.predictionIndices.some((index) => !Number.isInteger(index) || index < 0))) {
        addError(`${regionLocation}.origin.predictionIndices`, "Detector-derived regions need non-negative prediction indices.");
      }
      const flat = cleanFlatPolygon(region.polygon);
      if (!flat) {
        addError(`${regionLocation}.polygon`, "polygon must be a flat array of at least three finite x/y pairs.");
        continue;
      }
      const points = polygonPoints(flat);
      if (ACCEPTED_REGION_STATUSES.has(region.status)) {
        if (Math.abs(polygonSignedArea(points)) <= EPSILON) {
          addError(`${regionLocation}.polygon`, "Accepted polygon has zero area.");
          continue;
        }
        if (hasProperSelfIntersection(points)) {
          addError(`${regionLocation}.polygon`, "Accepted polygon has a self-intersection; edit it before accepting it.");
          continue;
        }
        accepted.push({ id: region.id, points, location: regionLocation });
      }
    }
    if (page.coverage === "complete" && ambiguousCount > 0) {
      addError(`${location}.coverage`, `A complete page cannot retain ${ambiguousCount} ambiguous region(s).`);
    }
    if (page.coverage === "complete" && !page.review?.reviewer?.trim()) {
      addWarning(`${location}.review.reviewer`, "Complete page has no reviewer recorded.");
    }
    if (page.coverage === "complete" && !page.review?.reviewedAt) {
      addWarning(`${location}.review.reviewedAt`, "Complete page has no review timestamp recorded.");
    }
    for (let leftIndex = 0; leftIndex < accepted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < accepted.length; rightIndex += 1) {
        const left = accepted[leftIndex];
        const right = accepted[rightIndex];
        const relationship = polygonRelationship(left.points, right.points);
        if (relationship) {
          addError(
            `${left.location}.polygon`,
            `Accepted regions ${left.id} and ${right.id} violate the no-overlap/no-containment invariant (${relationship}).`
          );
        }
      }
    }
    if (page.coverage === "partial") {
      addWarning(`${location}.coverage`, "Partial pages may support reviewed-region precision checks, but not page-level recall.");
      if (!page.review?.notes?.trim()) {
        addWarning(`${location}.review.notes`, "Partial page should state the reviewed scope.");
      }
    }
  }
  return { errors, warnings };
}

async function addFileWarnings(manifest, validation) {
  for (let pageIndex = 0; pageIndex < (manifest.pages ?? []).length; pageIndex += 1) {
    const sources = manifest.pages[pageIndex]?.sources;
    if (!sources || typeof sources !== "object") {
      continue;
    }
    for (const [name, value] of Object.entries(sources)) {
      if (typeof value !== "string" || value.length === 0) {
        continue;
      }
      if (!(await isFile(resolveManifestPath(value)))) {
        validation.warnings.push({
          location: `$.pages[${pageIndex}].sources.${name}`,
          message: `Referenced file does not exist: ${value}`
        });
      }
    }
  }
}

function summarizeManifest(manifest, validation) {
  const coverages = { complete: 0, partial: 0, unknown: 0, invalid: 0 };
  const statuses = { room: 0, "shaft-service": 0, "non-room": 0, ambiguous: 0, invalid: 0 };
  let completeAcceptedRegions = 0;
  let reviewedRegions = 0;
  let totalRegions = 0;
  for (const page of Array.isArray(manifest.pages) ? manifest.pages : []) {
    if (PAGE_COVERAGES.has(page?.coverage)) {
      coverages[page.coverage] += 1;
    } else {
      coverages.invalid += 1;
    }
    for (const region of Array.isArray(page?.regions) ? page.regions : []) {
      totalRegions += 1;
      if (REGION_STATUSES.has(region?.status)) {
        statuses[region.status] += 1;
      } else {
        statuses.invalid += 1;
      }
      if (region?.status !== "ambiguous") {
        reviewedRegions += 1;
      }
      if (page?.coverage === "complete" && ACCEPTED_REGION_STATUSES.has(region?.status)) {
        completeAcceptedRegions += 1;
      }
    }
  }
  return {
    pages: Array.isArray(manifest.pages) ? manifest.pages.length : 0,
    coverages,
    regions: totalRegions,
    statuses,
    reviewedRegions,
    unresolvedRegions: statuses.ambiguous,
    adjudicationProgress: finiteRatio(reviewedRegions, totalRegions),
    completeAcceptedRegions,
    validationErrors: validation.errors.length,
    validationWarnings: validation.warnings.length
  };
}

function formatSummary(summary) {
  const percentage = summary.adjudicationProgress === null ? "n/a" : `${(summary.adjudicationProgress * 100).toFixed(1)}%`;
  return [
    `Gold set: ${summary.pages} pages, ${summary.regions} regions`,
    `Coverage: complete=${summary.coverages.complete}, partial=${summary.coverages.partial}, unknown=${summary.coverages.unknown}`,
    `Regions: room=${summary.statuses.room}, shaft-service=${summary.statuses["shaft-service"]}, non-room=${summary.statuses["non-room"]}, ambiguous=${summary.statuses.ambiguous}`,
    `Adjudication progress: ${summary.reviewedRegions}/${summary.regions} (${percentage})`,
    `Evaluation-ready accepted regions on complete pages: ${summary.completeAcceptedRegions}`,
    `Validation: errors=${summary.validationErrors}, warnings=${summary.validationWarnings}`
  ].join("\n");
}

async function validateCommand(args) {
  const manifest = await readJson(args.manifest);
  const validation = validateManifest(manifest);
  if (args.checkFiles) {
    await addFileWarnings(manifest, validation);
  }
  const report = { valid: validation.errors.length === 0, ...validation };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const issue of report.errors) {
      console.error(`ERROR ${issue.location}: ${issue.message}`);
    }
    for (const issue of report.warnings) {
      console.warn(`WARN  ${issue.location}: ${issue.message}`);
    }
    console.log(report.valid
      ? `Valid gold manifest (${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}).`
      : `Invalid gold manifest (${report.errors.length} error${report.errors.length === 1 ? "" : "s"}).`);
  }
  if (!report.valid) {
    process.exitCode = 1;
  }
}

async function summaryCommand(args) {
  const manifest = await readJson(args.manifest);
  const validation = validateManifest(manifest);
  const summary = summarizeManifest(manifest, validation);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatSummary(summary));
  }
  if (validation.errors.length > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "help") {
    console.log(usage());
  } else if (args.command === "select") {
    await selectCommand(args);
  } else if (args.command === "validate") {
    await validateCommand(args);
  } else if (args.command === "summary") {
    await summaryCommand(args);
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
