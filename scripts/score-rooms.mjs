#!/usr/bin/env node

// Noise-aware room detector evaluation against the human-authored PDF/TSV corpus.
//
// TSV polygons are treated as positive, potentially incomplete labels. Predictions
// that do not match a TSV polygon are therefore reported by evidence category rather
// than all being counted as false positives. The optional conventional precision is
// explicitly named a closed-world lower bound.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createGunzip } from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const DEFAULT_PDF_TSV_ROOT = path.join(repoRootDir, "pdf-tsv");
const DEFAULT_SEGMENTS_ROOT = path.join(repoRootDir, "ml", "room-detection", "data", "vector-segments");
const DEFAULT_RESOLUTION = 512;
const DEFAULT_IOU_THRESHOLD = 0.5;
const MAX_RESOLUTION = 2048;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_POLYGON_POINTS = 100_000;
const MAX_PAIR_COMPARISONS = 4_000_000;

function usage() {
  return `Noise-aware floorplan room evaluator (dependency-free)

Usage:
  node scripts/score-rooms.mjs --predictions DIR [options]
  node scripts/score-rooms.mjs DIR [options]

Required:
  --predictions DIR       Directory containing prediction JSON files

Options:
  --pdf-tsv-root DIR      PDF/TSV corpus root (default: pdf-tsv)
  --segments-root DIR     Segment-dump root used for sceneMatrix/pageBounds
                          (default: ml/room-detection/data/vector-segments)
  --resolution N          Raster pixels on the longest page side
                          (default: ${DEFAULT_RESOLUTION}, range: 64-${MAX_RESOLUTION})
  --iou N                 One-to-one match IoU threshold (default: ${DEFAULT_IOU_THRESHOLD})
  --filter TEXT           Score only folder/stem keys containing TEXT
  --max-pages N           Score at most N prediction files after filtering
  --output FILE           Also write the full aggregate + per-page JSON report
  --json                  Print JSON to stdout instead of the text report
  -h, --help              Show this help

Interpretation:
  Positive-label recall and mean best IoU evaluate known TSV rooms. Unmatched
  predictions are split into numbered and unnumbered groups because the TSV is
  incomplete. closedWorldPrecisionLowerBound assumes every unmatched prediction
  is false and should only be used as a pessimistic compatibility metric.
`;
}

function parseArgs(argv) {
  const args = {
    predictions: null,
    pdfTsvRoot: DEFAULT_PDF_TSV_ROOT,
    segmentsRoot: DEFAULT_SEGMENTS_ROOT,
    resolution: DEFAULT_RESOLUTION,
    iouThreshold: DEFAULT_IOU_THRESHOLD,
    filter: null,
    maxPages: null,
    output: null,
    json: false,
    help: false
  };

  function nextValue(index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  }

  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "-h" || value === "--help") {
      args.help = true;
    } else if (value === "--predictions" || value === "--predictions-dir") {
      args.predictions = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--pdf-tsv-root" || value === "--pdf-tsv") {
      args.pdfTsvRoot = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--segments-root" || value === "--segments") {
      args.segmentsRoot = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--resolution") {
      args.resolution = Number(nextValue(i, value));
      i += 1;
    } else if (value === "--iou" || value === "--iou-threshold") {
      args.iouThreshold = Number(nextValue(i, value));
      i += 1;
    } else if (value === "--filter") {
      args.filter = nextValue(i, value);
      i += 1;
    } else if (value === "--max-pages") {
      args.maxPages = Number(nextValue(i, value));
      i += 1;
    } else if (value === "--output") {
      args.output = path.resolve(nextValue(i, value));
      i += 1;
    } else if (value === "--json") {
      args.json = true;
    } else if (!value.startsWith("-") && args.predictions === null) {
      args.predictions = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (args.help) {
    return args;
  }
  if (!args.predictions) {
    throw new Error("--predictions DIR is required.");
  }
  if (!Number.isInteger(args.resolution) || args.resolution < 64 || args.resolution > MAX_RESOLUTION) {
    throw new Error(`--resolution must be an integer from 64 to ${MAX_RESOLUTION}.`);
  }
  if (!Number.isFinite(args.iouThreshold) || args.iouThreshold < 0 || args.iouThreshold > 1) {
    throw new Error("--iou must be between 0 and 1.");
  }
  if (args.maxPages !== null && (!Number.isInteger(args.maxPages) || args.maxPages < 1)) {
    throw new Error("--max-pages must be a positive integer.");
  }
  return args;
}

async function readBoundedText(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  if (stat.size > MAX_INPUT_BYTES) {
    throw new Error(`Input exceeds ${MAX_INPUT_BYTES} bytes: ${filePath}`);
  }
  return fs.readFile(filePath, "utf8");
}

function parseNumericArray(prefix, key, expectedLength) {
  const expression = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`);
  const match = expression.exec(prefix);
  if (!match) {
    return null;
  }
  const values = match[1].split(",").map((part) => Number(part.trim()));
  if (values.length !== expectedLength || values.some((number) => !Number.isFinite(number))) {
    return null;
  }
  return values;
}

/** Read only the small metadata prefix; the large stroke arrays are never inflated. */
async function readSegmentMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    const gunzip = createGunzip();
    let prefix = "";
    let settled = false;

    function stop() {
      input.destroy();
      gunzip.destroy();
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      stop();
      reject(error);
    }

    function finish() {
      const sceneMatrix = parseNumericArray(prefix, "sceneMatrix", 6);
      const pageBounds = parseNumericArray(prefix, "pageBounds", 4);
      if (!sceneMatrix || !pageBounds) {
        fail(new Error(`Segment dump metadata is missing sceneMatrix/pageBounds: ${filePath}`));
        return;
      }
      settled = true;
      stop();
      resolve({ sceneMatrix, pageBounds });
    }

    input.on("error", fail);
    gunzip.on("error", fail);
    gunzip.setEncoding("utf8");
    gunzip.on("data", (chunk) => {
      if (settled) {
        return;
      }
      prefix += chunk;
      if (prefix.includes('"strokes":')) {
        finish();
      } else if (prefix.length > MAX_METADATA_BYTES) {
        fail(new Error(`Segment metadata prefix exceeds ${MAX_METADATA_BYTES} bytes: ${filePath}`));
      }
    });
    gunzip.on("end", () => {
      if (!settled) {
        finish();
      }
    });
    input.pipe(gunzip);
  });
}

/** Minimal RFC-4180-style TSV reader. Quotes are special only at field start. */
function parseTsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;

  function endField() {
    row.push(field);
    field = "";
    quotedField = false;
  }

  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0 && !quotedField) {
      inQuotes = true;
      quotedField = true;
    } else if (char === "\t") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      if (text[i + 1] !== "\n") {
        endRow();
      }
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error("Unterminated quoted TSV field.");
  }
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

function applyMatrix(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function samePoint(left, right) {
  return Math.abs(left[0] - right[0]) <= 1e-9 && Math.abs(left[1] - right[1]) <= 1e-9;
}

function polygonSignedArea(points) {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = (i + 1) % points.length;
    twiceArea += points[i][0] * points[next][1] - points[next][0] * points[i][1];
  }
  return twiceArea * 0.5;
}

function cleanPolygon(points) {
  if (!Array.isArray(points) || points.length > MAX_POLYGON_POINTS) {
    return null;
  }
  const cleaned = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) {
      return null;
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    const next = [x, y];
    if (cleaned.length === 0 || !samePoint(cleaned[cleaned.length - 1], next)) {
      cleaned.push(next);
    }
  }
  if (cleaned.length >= 2 && samePoint(cleaned[0], cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  if (cleaned.length < 3 || Math.abs(polygonSignedArea(cleaned)) <= 1e-12) {
    return null;
  }
  return cleaned;
}

function pointsFromGeometryData(value) {
  if (!Array.isArray(value) || value.length > MAX_POLYGON_POINTS) {
    return null;
  }
  const points = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }
    points.push([item.x, item.y]);
  }
  return cleanPolygon(points);
}

function pointsFromPrediction(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.length > 0 && typeof value[0] === "number") {
    if (value.length % 2 !== 0 || value.length / 2 > MAX_POLYGON_POINTS) {
      return null;
    }
    const points = [];
    for (let i = 0; i < value.length; i += 2) {
      points.push([value[i], value[i + 1]]);
    }
    return cleanPolygon(points);
  }
  if (value.length > 0 && !Array.isArray(value[0]) && typeof value[0] === "object") {
    return pointsFromGeometryData(value);
  }
  return cleanPolygon(value);
}

function parseGeometryJson(raw) {
  let value;
  try {
    value = JSON.parse(raw);
    if (typeof value === "string") {
      value = JSON.parse(value);
    }
  } catch {
    return null;
  }
  return pointsFromGeometryData(value);
}

function findColumn(headers, target) {
  const normalizedTarget = target.toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === normalizedTarget);
}

function rowIsEmpty(row) {
  return row.every((cell) => cell.trim().length === 0);
}

function parseTsvRooms(text, sceneMatrix) {
  const rows = parseTsv(text);
  if (rows.length === 0) {
    throw new Error("TSV has no header row.");
  }
  rows[0][0] = (rows[0][0] ?? "").replace(/^\uFEFF/, "");
  const geometryColumn = findColumn(rows[0], "geometryData");
  const roomNumberColumn = findColumn(rows[0], "roomNumber");
  if (geometryColumn < 0) {
    throw new Error("TSV is missing a geometryData column.");
  }

  const rooms = [];
  let sourceRows = 0;
  let invalidGeometry = 0;
  for (const row of rows.slice(1)) {
    if (rowIsEmpty(row)) {
      continue;
    }
    sourceRows += 1;
    const points = parseGeometryJson(row[geometryColumn] ?? "");
    if (!points) {
      invalidGeometry += 1;
      continue;
    }
    const transformed = cleanPolygon(points.map(([x, y]) => applyMatrix(sceneMatrix, x, y)));
    if (!transformed) {
      invalidGeometry += 1;
      continue;
    }
    rooms.push({
      polygon: transformed,
      roomNumber: roomNumberColumn >= 0 ? (row[roomNumberColumn] ?? "").trim() : ""
    });
  }
  return { rooms, sourceRows, invalidGeometry };
}

function parsePredictionRooms(payload) {
  const source = Array.isArray(payload.rooms) ? payload.rooms : [];
  const rooms = [];
  let invalidGeometry = 0;
  for (const room of source) {
    const polygon = pointsFromPrediction(room?.polygon);
    if (!polygon) {
      invalidGeometry += 1;
      continue;
    }
    rooms.push({ polygon, roomNumber: String(room?.roomNumber ?? "").trim() });
  }
  return { rooms, sourceRows: source.length, invalidGeometry };
}

function extendBounds(bounds, rooms) {
  let [minX, minY, maxX, maxY] = bounds;
  for (const room of rooms) {
    for (const [x, y] of room.polygon) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX, maxY];
}

function buildRasterFrame(pageBounds, roomSets, resolution) {
  let bounds = pageBounds.slice();
  for (const rooms of roomSets) {
    bounds = extendBounds(bounds, rooms);
  }
  const [minX, minY, maxX, maxY] = bounds;
  const worldWidth = Math.max(1e-9, maxX - minX);
  const worldHeight = Math.max(1e-9, maxY - minY);
  const scale = resolution / Math.max(worldWidth, worldHeight);
  return {
    minX,
    maxY,
    scale,
    width: Math.max(1, Math.round(worldWidth * scale)),
    height: Math.max(1, Math.round(worldHeight * scale))
  };
}

function rasterizePolygon(points, frame) {
  const pixels = points.map(([x, y]) => [(x - frame.minX) * frame.scale, (frame.maxY - y) * frame.scale]);
  const minY = Math.min(...pixels.map((point) => point[1]));
  const maxY = Math.max(...pixels.map((point) => point[1]));
  const firstRow = Math.max(0, Math.ceil(minY - 0.5));
  const endRow = Math.min(frame.height, Math.ceil(maxY - 0.5));
  const spans = [];
  let area = 0;
  let boundMinX = frame.width;
  let boundMaxX = 0;
  let boundMinY = frame.height;
  let boundMaxY = 0;

  for (let y = firstRow; y < endRow; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let i = 0; i < pixels.length; i += 1) {
      const left = pixels[i];
      const right = pixels[(i + 1) % pixels.length];
      if ((left[1] <= scanY && right[1] > scanY) || (right[1] <= scanY && left[1] > scanY)) {
        const ratio = (scanY - left[1]) / (right[1] - left[1]);
        intersections.push(left[0] + ratio * (right[0] - left[0]));
      }
    }
    intersections.sort((left, right) => left - right);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = Math.max(0, Math.ceil(intersections[i] - 0.5));
      const end = Math.min(frame.width, Math.ceil(intersections[i + 1] - 0.5));
      if (end <= start) {
        continue;
      }
      spans.push(y, start, end);
      area += end - start;
      boundMinX = Math.min(boundMinX, start);
      boundMaxX = Math.max(boundMaxX, end);
      boundMinY = Math.min(boundMinY, y);
      boundMaxY = Math.max(boundMaxY, y + 1);
    }
  }

  return {
    spans: Int32Array.from(spans),
    area,
    bounds: area > 0 ? [boundMinX, boundMinY, boundMaxX, boundMaxY] : [0, 0, 0, 0]
  };
}

function boundsOverlap(left, right) {
  return left[0] < right[2] && right[0] < left[2] && left[1] < right[3] && right[1] < left[3];
}

function spanIntersectionArea(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  let area = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftY = left[leftIndex];
    const rightY = right[rightIndex];
    if (leftY < rightY) {
      leftIndex += 3;
      continue;
    }
    if (rightY < leftY) {
      rightIndex += 3;
      continue;
    }
    const start = Math.max(left[leftIndex + 1], right[rightIndex + 1]);
    const end = Math.min(left[leftIndex + 2], right[rightIndex + 2]);
    if (end > start) {
      area += end - start;
    }
    if (left[leftIndex + 2] <= right[rightIndex + 2]) {
      leftIndex += 3;
    } else {
      rightIndex += 3;
    }
  }
  return area;
}

function normalizeRoomNumber(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchRasterRooms(targets, predictions, threshold) {
  if (targets.length * predictions.length > MAX_PAIR_COMPARISONS) {
    throw new Error(
      `Refusing ${targets.length * predictions.length} target/prediction comparisons; ` +
        `limit is ${MAX_PAIR_COMPARISONS}.`
    );
  }
  const bestByTarget = new Float64Array(targets.length);
  const pairs = [];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    if (target.raster.area === 0) {
      continue;
    }
    for (let predictionIndex = 0; predictionIndex < predictions.length; predictionIndex += 1) {
      const prediction = predictions[predictionIndex];
      if (prediction.raster.area === 0 || !boundsOverlap(target.raster.bounds, prediction.raster.bounds)) {
        continue;
      }
      const intersection = spanIntersectionArea(target.raster.spans, prediction.raster.spans);
      if (intersection === 0) {
        continue;
      }
      const union = target.raster.area + prediction.raster.area - intersection;
      const iou = intersection / Math.max(1, union);
      bestByTarget[targetIndex] = Math.max(bestByTarget[targetIndex], iou);
      if (iou >= threshold) {
        pairs.push({ targetIndex, predictionIndex, iou });
      }
    }
  }

  pairs.sort((left, right) => right.iou - left.iou || left.targetIndex - right.targetIndex || left.predictionIndex - right.predictionIndex);
  const matchedTargets = new Set();
  const matchedPredictions = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (matchedTargets.has(pair.targetIndex) || matchedPredictions.has(pair.predictionIndex)) {
      continue;
    }
    matchedTargets.add(pair.targetIndex);
    matchedPredictions.add(pair.predictionIndex);
    matches.push(pair);
  }
  return { bestByTarget, matchedTargets, matchedPredictions, matches };
}

function safeJoinedPath(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const result = path.resolve(resolvedRoot, ...parts);
  if (result !== resolvedRoot && !result.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes configured root: ${parts.join("/")}`);
  }
  return result;
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function sourcePath(root, folder, filename) {
  return folder === "." || folder === "" ? safeJoinedPath(root, filename) : safeJoinedPath(root, folder, filename);
}

function finiteRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

async function scorePredictionFile(predictionPath, args) {
  const payload = JSON.parse(await readBoundedText(predictionPath));
  const folder = String(payload.folder ?? "").trim();
  const stem = String(payload.stem ?? "").trim();
  if (!folder || !stem || stem.includes("/") || stem.includes("\\")) {
    throw new Error("Prediction JSON must contain safe, non-empty folder and stem strings.");
  }
  const key = folder === "." ? stem : `${folder}/${stem}`;
  const parsedPredictions = parsePredictionRooms(payload);
  const base = {
    page: key,
    folder,
    stem,
    status: "ok",
    predictionRows: parsedPredictions.sourceRows,
    predictionValidGeometry: parsedPredictions.rooms.length,
    predictionInvalidGeometry: parsedPredictions.invalidGeometry
  };

  const tsvPath = sourcePath(args.pdfTsvRoot, folder, `${stem}.tsv`);
  if (!(await fileExists(tsvPath))) {
    return {
      ...base,
      status: "no_tsv",
      unscoredPredictions: parsedPredictions.rooms.length,
      note: "No TSV exists; predictions are intentionally not counted as false positives."
    };
  }

  const dumpPath = sourcePath(args.segmentsRoot, folder, `${stem}.segments.json.gz`);
  if (!(await fileExists(dumpPath))) {
    return {
      ...base,
      status: "missing_segment_dump",
      unscoredPredictions: parsedPredictions.rooms.length,
      error: `Missing segment dump: ${dumpPath}`
    };
  }

  const metadata = await readSegmentMetadata(dumpPath);
  const parsedTargets = parseTsvRooms(await readBoundedText(tsvPath), metadata.sceneMatrix);
  const frame = buildRasterFrame(metadata.pageBounds, [parsedTargets.rooms, parsedPredictions.rooms], args.resolution);
  const targets = parsedTargets.rooms.map((room) => ({ ...room, raster: rasterizePolygon(room.polygon, frame) }));
  const predictions = parsedPredictions.rooms.map((room) => ({ ...room, raster: rasterizePolygon(room.polygon, frame) }));
  const targetEmptyAtResolution = targets.filter((room) => room.raster.area === 0).length;
  const predictionEmptyAtResolution = predictions.filter((room) => room.raster.area === 0).length;
  const evaluableTargetCount = targets.length - targetEmptyAtResolution;
  const matching = matchRasterRooms(targets, predictions, args.iouThreshold);
  const matchedIouSum = matching.matches.reduce((sum, match) => sum + match.iou, 0);
  let bestIouSum = 0;
  for (let index = 0; index < targets.length; index += 1) {
    if (targets[index].raster.area > 0) {
      bestIouSum += matching.bestByTarget[index];
    }
  }

  const tsvNumbers = new Set(targets.map((room) => normalizeRoomNumber(room.roomNumber)).filter(Boolean));
  let unmatchedNumbered = 0;
  let unmatchedNumberedAbsentFromTsv = 0;
  let unmatchedNumberedPresentInTsv = 0;
  let unmatchedUnnumbered = 0;
  for (let index = 0; index < predictions.length; index += 1) {
    if (matching.matchedPredictions.has(index)) {
      continue;
    }
    const roomNumber = normalizeRoomNumber(predictions[index].roomNumber);
    if (roomNumber) {
      unmatchedNumbered += 1;
      if (tsvNumbers.has(roomNumber)) {
        unmatchedNumberedPresentInTsv += 1;
      } else {
        unmatchedNumberedAbsentFromTsv += 1;
      }
    } else {
      unmatchedUnnumbered += 1;
    }
  }

  return {
    ...base,
    tsvRows: parsedTargets.sourceRows,
    tsvValidGeometry: targets.length,
    tsvInvalidGeometry: parsedTargets.invalidGeometry,
    tsvEmptyAtResolution: targetEmptyAtResolution,
    tsvEvaluablePositiveLabels: evaluableTargetCount,
    predictionEmptyAtResolution,
    matched: matching.matches.length,
    positiveLabelRecallAtThreshold: finiteRatio(matching.matches.length, evaluableTargetCount),
    positiveLabelMeanBestIou: finiteRatio(bestIouSum, evaluableTargetCount),
    matchedMeanIou: finiteRatio(matchedIouSum, matching.matches.length),
    unmatchedNumberedLikelyOmissionOrBoundaryMismatch: unmatchedNumbered,
    unmatchedNumberedAbsentFromTsv: unmatchedNumberedAbsentFromTsv,
    unmatchedNumberedPresentInTsv: unmatchedNumberedPresentInTsv,
    unmatchedUnnumbered,
    closedWorldPrecisionLowerBound: finiteRatio(matching.matches.length, predictions.length),
    matchedIouSum,
    positiveLabelBestIouSum: bestIouSum,
    raster: { width: frame.width, height: frame.height, scale: frame.scale }
  };
}

function aggregatePages(pages, args) {
  const scored = pages.filter((page) => page.status === "ok");
  const withPositiveLabels = scored.filter((page) => page.tsvEvaluablePositiveLabels > 0);
  const sumScored = (key) => scored.reduce((total, page) => total + (Number(page[key]) || 0), 0);
  const sumAll = (key) => pages.reduce((total, page) => total + (Number(page[key]) || 0), 0);
  const targetCount = sumScored("tsvEvaluablePositiveLabels");
  const scoredPredictionCount = sumScored("predictionValidGeometry");
  const matched = sumScored("matched");
  const matchedIouSum = sumScored("matchedIouSum");
  const bestIouSum = sumScored("positiveLabelBestIouSum");

  return {
    predictionFiles: pages.length,
    scoredPages: scored.length,
    pagesWithPositiveLabels: withPositiveLabels.length,
    pagesWithoutTsv: pages.filter((page) => page.status === "no_tsv").length,
    pagesMissingSegmentDump: pages.filter((page) => page.status === "missing_segment_dump").length,
    failedPages: pages.filter((page) => page.status === "error").length,
    tsvRows: sumScored("tsvRows"),
    tsvValidGeometry: sumScored("tsvValidGeometry"),
    tsvInvalidGeometry: sumScored("tsvInvalidGeometry"),
    tsvEmptyAtResolution: sumScored("tsvEmptyAtResolution"),
    tsvEvaluablePositiveLabels: targetCount,
    predictionRows: sumAll("predictionRows"),
    predictionValidGeometry: sumAll("predictionValidGeometry"),
    predictionInvalidGeometry: sumAll("predictionInvalidGeometry"),
    scoredPredictionValidGeometry: scoredPredictionCount,
    predictionEmptyAtResolution: sumScored("predictionEmptyAtResolution"),
    unscoredPredictions: sumAll("unscoredPredictions"),
    matched,
    positiveLabelRecallAtThreshold: finiteRatio(matched, targetCount),
    positiveLabelMeanBestIou: finiteRatio(bestIouSum, targetCount),
    matchedMeanIou: finiteRatio(matchedIouSum, matched),
    macroPositiveLabelRecallAtThreshold:
      withPositiveLabels.length > 0
        ? withPositiveLabels.reduce((total, page) => total + page.positiveLabelRecallAtThreshold, 0) / withPositiveLabels.length
        : null,
    macroPositiveLabelMeanBestIou:
      withPositiveLabels.length > 0
        ? withPositiveLabels.reduce((total, page) => total + page.positiveLabelMeanBestIou, 0) / withPositiveLabels.length
        : null,
    unmatchedNumberedLikelyOmissionOrBoundaryMismatch: sumScored("unmatchedNumberedLikelyOmissionOrBoundaryMismatch"),
    unmatchedNumberedAbsentFromTsv: sumScored("unmatchedNumberedAbsentFromTsv"),
    unmatchedNumberedPresentInTsv: sumScored("unmatchedNumberedPresentInTsv"),
    unmatchedUnnumbered: sumScored("unmatchedUnnumbered"),
    closedWorldPrecisionLowerBound: finiteRatio(matched, scoredPredictionCount),
    iouThreshold: args.iouThreshold,
    resolution: args.resolution
  };
}

function formatMetric(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? "  n/a" : value.toFixed(digits).padStart(6);
}

function truncate(value, length) {
  return value.length <= length ? value.padEnd(length) : `${value.slice(0, Math.max(0, length - 1))}…`;
}

function formatTextReport(report) {
  const lines = [];
  lines.push(
    `Noise-aware room score: resolution=${report.config.resolution}, IoU threshold=${report.config.iouThreshold.toFixed(2)}`
  );
  lines.push(
    `${"page".padEnd(54)} ${"#tsv".padStart(5)} ${"#pred".padStart(5)} ${"match".padStart(5)} ${"recall".padStart(6)} ${"mIoU".padStart(6)} ${"un#".padStart(5)} ${"unplain".padStart(7)} ${"badGT".padStart(5)}`
  );
  lines.push("-".repeat(105));
  for (const page of report.pages) {
    if (page.status !== "ok") {
      lines.push(`${truncate(page.page, 54)}  ${page.status}${page.error ? `: ${page.error}` : ""}`);
      continue;
    }
    lines.push(
      `${truncate(page.page, 54)} ${String(page.tsvEvaluablePositiveLabels).padStart(5)} ` +
        `${String(page.predictionValidGeometry).padStart(5)} ${String(page.matched).padStart(5)} ` +
        `${formatMetric(page.positiveLabelRecallAtThreshold)} ${formatMetric(page.positiveLabelMeanBestIou)} ` +
        `${String(page.unmatchedNumberedLikelyOmissionOrBoundaryMismatch).padStart(5)} ` +
        `${String(page.unmatchedUnnumbered).padStart(7)} ${String(page.tsvInvalidGeometry).padStart(5)}`
    );
  }

  const aggregate = report.aggregate;
  lines.push("");
  lines.push(`Aggregate: ${aggregate.scoredPages}/${aggregate.predictionFiles} pages scored`);
  lines.push(
    `Known TSV positives: ${aggregate.matched}/${aggregate.tsvEvaluablePositiveLabels} matched; ` +
      `recall@${report.config.iouThreshold.toFixed(2)}=${formatMetric(aggregate.positiveLabelRecallAtThreshold).trim()}; ` +
      `mean best IoU=${formatMetric(aggregate.positiveLabelMeanBestIou).trim()}; ` +
      `matched mean IoU=${formatMetric(aggregate.matchedMeanIou).trim()}`
  );
  lines.push(
    `Unmatched predictions: numbered=${aggregate.unmatchedNumberedLikelyOmissionOrBoundaryMismatch} ` +
      `(number absent from TSV=${aggregate.unmatchedNumberedAbsentFromTsv}, present but boundary unmatched=${aggregate.unmatchedNumberedPresentInTsv}), ` +
      `unnumbered=${aggregate.unmatchedUnnumbered}`
  );
  lines.push(
    `TSV quality: invalid geometry=${aggregate.tsvInvalidGeometry}, empty at this resolution=${aggregate.tsvEmptyAtResolution}; ` +
      `prediction invalid geometry=${aggregate.predictionInvalidGeometry}`
  );
  lines.push(
    `Closed-world precision lower bound=${formatMetric(aggregate.closedWorldPrecisionLowerBound).trim()} ` +
      `(pessimistic: assumes every unmatched prediction is false)`
  );
  if (aggregate.pagesWithoutTsv > 0 || aggregate.pagesMissingSegmentDump > 0 || aggregate.failedPages > 0) {
    lines.push(
      `Unscored: no TSV pages=${aggregate.pagesWithoutTsv}, missing dumps=${aggregate.pagesMissingSegmentDump}, ` +
        `failed pages=${aggregate.failedPages}, predictions on no-TSV pages=${aggregate.unscoredPredictions}`
    );
  }
  return `${lines.join("\n")}\n`;
}

async function listPredictionFiles(args) {
  const entries = await fs.readdir(args.predictions, { withFileTypes: true });
  let files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(args.predictions, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (args.filter) {
    const needle = args.filter.toLowerCase();
    const filtered = [];
    for (const filePath of files) {
      try {
        const payload = JSON.parse(await readBoundedText(filePath));
        const key = `${payload.folder ?? ""}/${payload.stem ?? ""}`.toLowerCase();
        if (key.includes(needle)) {
          filtered.push(filePath);
        }
      } catch {
        if (path.basename(filePath).toLowerCase().includes(needle)) {
          filtered.push(filePath);
        }
      }
    }
    files = filtered;
  }
  if (args.maxPages !== null) {
    files = files.slice(0, args.maxPages);
  }
  return files;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(`error: ${error.message}\n`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const predictionFiles = await listPredictionFiles(args);
  if (predictionFiles.length === 0) {
    throw new Error(`No prediction JSON files matched in ${args.predictions}`);
  }

  const pages = [];
  for (const predictionPath of predictionFiles) {
    try {
      pages.push(await scorePredictionFile(predictionPath, args));
    } catch (error) {
      pages.push({
        page: path.basename(predictionPath, path.extname(predictionPath)),
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  pages.sort((left, right) => left.page.localeCompare(right.page));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    interpretation: {
      tsv: "positive, potentially incomplete annotations",
      unmatchedNumbered: "likely annotation omission or boundary mismatch; review rather than automatic false positive",
      closedWorldPrecisionLowerBound: "pessimistic metric that assumes every unmatched prediction is false"
    },
    config: {
      predictions: args.predictions,
      pdfTsvRoot: args.pdfTsvRoot,
      segmentsRoot: args.segmentsRoot,
      resolution: args.resolution,
      iouThreshold: args.iouThreshold,
      filter: args.filter,
      maxPages: args.maxPages
    },
    aggregate: null,
    pages
  };
  report.aggregate = aggregatePages(pages, args);

  if (args.output) {
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatTextReport(report));
  }
  if (args.output) {
    console.error(`wrote ${args.output}`);
  }
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
