#!/usr/bin/env node

// Dependency-free topology validation for room-detector prediction JSON.
// Shared boundaries are valid; positive-area overlap, containment, duplicate
// geometry, and non-simple/invalid polygons are not. This tool deliberately
// reads detector predictions only and never consults TSV annotations.

import path from "node:path";
import { promises as fs } from "node:fs";

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_ROOMS_PER_PAGE = 10_000;
const MAX_VERTICES_PER_POLYGON = 25_000;
const MAX_VERTICES_PER_PAGE = 2_000_000;
const MAX_ROOM_PAIR_COMPARISONS = 4_000_000;
const MAX_SEGMENT_PAIR_COMPARISONS = 250_000_000;
const MAX_POINT_EDGE_CHECKS = 250_000_000;
const MAX_SCANLINE_PROBES = 1_000_000;
const MAX_SCANLINE_LEVELS_PER_PAIR = 50_000;
const MAX_REPORTED_VIOLATIONS = 200;
const MAX_ABSOLUTE_COORDINATE = 1e12;

class AuditLimitError extends Error {}

function usage() {
  return `Room prediction topology auditor (dependency-free)

Usage:
  node scripts/audit-room-topology.mjs INPUT [--json]
  node scripts/audit-room-topology.mjs --input INPUT [--json]

INPUT may be one prediction JSON file, a directory containing prediction JSON
files, or an evaluation directory containing a predictions/ subdirectory.

Options:
  --input, --predictions PATH  Prediction JSON or directory to audit
  --json                      Print a machine-readable report
  -h, --help                  Show this help

Checks:
  - malformed, non-finite, degenerate, or zero-length polygon geometry
  - clockwise polygons (detector output is required to use CCW winding)
  - proper self-crossings and non-adjacent self-touches/collinear overlaps
  - duplicate room polygons, containment, and partial positive-area overlap

Shared room boundaries and point contacts are allowed. The command exits 0 only
when every page passes, 1 for topology violations, and 2 for input/limit errors.
TSV files and other annotations are never read.

Safety limits:
  ${MAX_FILES} files, ${MAX_FILE_BYTES} bytes/file, ${MAX_ROOMS_PER_PAGE} rooms/page,
  ${MAX_VERTICES_PER_POLYGON} vertices/polygon, ${MAX_VERTICES_PER_PAGE} vertices/page,
  ${MAX_ROOM_PAIR_COMPARISONS} room pairs and ${MAX_SEGMENT_PAIR_COMPARISONS} segment pairs/page.
`;
}

function parseArgs(argv) {
  const args = { input: null, json: false, help: false };
  function nextValue(index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  }

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-h" || value === "--help") {
      args.help = true;
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--input" || value === "--predictions") {
      args.input = path.resolve(nextValue(index, value));
      index += 1;
    } else if (!value.startsWith("-") && args.input === null) {
      args.input = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!args.help && !args.input) {
    throw new Error("A prediction JSON file or directory is required.");
  }
  return args;
}

async function isDirectory(filePath) {
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolvePredictionFiles(inputPath) {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    if (path.extname(inputPath).toLowerCase() !== ".json") {
      throw new Error(`Prediction input must be JSON: ${inputPath}`);
    }
    return { predictionDirectory: path.dirname(inputPath), files: [inputPath] };
  }
  if (!stat.isDirectory()) {
    throw new Error(`Input is neither a file nor a directory: ${inputPath}`);
  }

  const nestedPredictions = path.join(inputPath, "predictions");
  const predictionDirectory = await isDirectory(nestedPredictions) ? nestedPredictions : inputPath;
  const entries = await fs.readdir(predictionDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
    .map((entry) => path.join(predictionDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new Error(`No prediction JSON files found in ${predictionDirectory}`);
  }
  if (files.length > MAX_FILES) {
    throw new AuditLimitError(`Input has ${files.length} JSON files; limit is ${MAX_FILES}.`);
  }
  return { predictionDirectory, files };
}

async function readPrediction(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new AuditLimitError(`${filePath} is ${stat.size} bytes; limit is ${MAX_FILE_BYTES}.`);
  }
  let value;
  try {
    value = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.rooms)) {
    throw new Error(`Expected a prediction object with a rooms array: ${filePath}`);
  }
  return value;
}

function createBudget() {
  return {
    roomPairs: 0,
    segmentPairs: 0,
    pointEdgeChecks: 0,
    scanlineProbes: 0
  };
}

function consumeBudget(budget, key, limit, count = 1) {
  budget[key] += count;
  if (budget[key] > limit) {
    throw new AuditLimitError(`Page exceeded the ${limit} ${key} safety limit.`);
  }
}

function polygonBounds(points) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  return bounds;
}

function polygonSignedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    twiceArea += points[index].x * points[next].y - points[next].x * points[index].y;
  }
  return twiceArea * 0.5;
}

function boundsHaveInteriorIntersection(left, right, epsilon) {
  return (
    Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX) > epsilon &&
    Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY) > epsilon
  );
}

function boundsEqual(left, right, epsilon) {
  return (
    Math.abs(left.minX - right.minX) <= epsilon &&
    Math.abs(left.minY - right.minY) <= epsilon &&
    Math.abs(left.maxX - right.maxX) <= epsilon &&
    Math.abs(left.maxY - right.maxY) <= epsilon
  );
}

function cross(left, right, point) {
  return (right.x - left.x) * (point.y - left.y) - (right.y - left.y) * (point.x - left.x);
}

function pointOnSegment(point, left, right, epsilon, budget = null) {
  if (
    point.x < Math.min(left.x, right.x) - epsilon ||
    point.x > Math.max(left.x, right.x) + epsilon ||
    point.y < Math.min(left.y, right.y) - epsilon ||
    point.y > Math.max(left.y, right.y) + epsilon
  ) {
    return false;
  }
  if (budget) {
    consumeBudget(budget, "pointEdgeChecks", MAX_POINT_EDGE_CHECKS);
  }
  const tolerance = epsilon * Math.max(1, Math.hypot(right.x - left.x, right.y - left.y));
  return Math.abs(cross(left, right, point)) <= tolerance;
}

// Returns null, "proper", "touch", or "collinear-overlap".
function segmentIntersectionKind(leftA, leftB, rightA, rightB, epsilon) {
  if (
    Math.max(leftA.x, leftB.x) + epsilon < Math.min(rightA.x, rightB.x) ||
    Math.max(rightA.x, rightB.x) + epsilon < Math.min(leftA.x, leftB.x) ||
    Math.max(leftA.y, leftB.y) + epsilon < Math.min(rightA.y, rightB.y) ||
    Math.max(rightA.y, rightB.y) + epsilon < Math.min(leftA.y, leftB.y)
  ) {
    return null;
  }

  const leftRightA = cross(leftA, leftB, rightA);
  const leftRightB = cross(leftA, leftB, rightB);
  const rightLeftA = cross(rightA, rightB, leftA);
  const rightLeftB = cross(rightA, rightB, leftB);
  const tolerance = epsilon * Math.max(
    1,
    Math.hypot(leftB.x - leftA.x, leftB.y - leftA.y),
    Math.hypot(rightB.x - rightA.x, rightB.y - rightA.y)
  );
  const opposite = (first, second) =>
    (first > tolerance && second < -tolerance) || (first < -tolerance && second > tolerance);
  if (opposite(leftRightA, leftRightB) && opposite(rightLeftA, rightLeftB)) {
    return "proper";
  }

  const collinear =
    Math.abs(leftRightA) <= tolerance &&
    Math.abs(leftRightB) <= tolerance &&
    Math.abs(rightLeftA) <= tolerance &&
    Math.abs(rightLeftB) <= tolerance;
  if (collinear) {
    const useX = Math.max(
      Math.abs(leftB.x - leftA.x),
      Math.abs(rightB.x - rightA.x)
    ) >= Math.max(
      Math.abs(leftB.y - leftA.y),
      Math.abs(rightB.y - rightA.y)
    );
    const leftMin = Math.min(useX ? leftA.x : leftA.y, useX ? leftB.x : leftB.y);
    const leftMax = Math.max(useX ? leftA.x : leftA.y, useX ? leftB.x : leftB.y);
    const rightMin = Math.min(useX ? rightA.x : rightA.y, useX ? rightB.x : rightB.y);
    const rightMax = Math.max(useX ? rightA.x : rightA.y, useX ? rightB.x : rightB.y);
    return Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > epsilon
      ? "collinear-overlap"
      : "touch";
  }

  if (
    pointOnSegment(rightA, leftA, leftB, epsilon) ||
    pointOnSegment(rightB, leftA, leftB, epsilon) ||
    pointOnSegment(leftA, rightA, rightB, epsilon) ||
    pointOnSegment(leftB, rightA, rightB, epsilon)
  ) {
    return "touch";
  }
  return null;
}

// 1 = strictly inside, 0 = on the boundary, -1 = outside.
function pointInPolygonState(point, polygon, epsilon, budget, bounds = null) {
  if (
    bounds &&
    (point.x < bounds.minX - epsilon || point.x > bounds.maxX + epsilon ||
      point.y < bounds.minY - epsilon || point.y > bounds.maxY + epsilon)
  ) {
    return -1;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const left = polygon[previous];
    const right = polygon[index];
    if (pointOnSegment(point, left, right, epsilon, budget)) {
      return 0;
    }
    const crossesRay = (left.y > point.y) !== (right.y > point.y);
    if (crossesRay) {
      const crossingX = ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x;
      if (crossingX > point.x) {
        inside = !inside;
      }
    }
  }
  return inside ? 1 : -1;
}

function polygonSampleStates(source, target, targetBounds, epsilon, budget) {
  let inside = false;
  let outside = false;
  for (let index = 0; index < source.length; index += 1) {
    const next = (index + 1) % source.length;
    const samples = [
      source[index],
      {
        x: (source[index].x + source[next].x) * 0.5,
        y: (source[index].y + source[next].y) * 0.5
      }
    ];
    for (const sample of samples) {
      const state = pointInPolygonState(sample, target, epsilon, budget, targetBounds);
      inside ||= state === 1;
      outside ||= state === -1;
    }
    if (inside && outside) {
      break;
    }
  }
  return { inside, outside };
}

function everyVertexOnBoundary(source, target, targetBounds, epsilon, budget) {
  for (const point of source) {
    if (pointInPolygonState(point, target, epsilon, budget, targetBounds) !== 0) {
      return false;
    }
  }
  return true;
}

function polygonIntervalsAtY(polygon, y, budget) {
  const crossings = [];
  for (let index = 0; index < polygon.length; index += 1) {
    consumeBudget(budget, "pointEdgeChecks", MAX_POINT_EDGE_CHECKS);
    const next = (index + 1) % polygon.length;
    const left = polygon[index];
    const right = polygon[next];
    if ((left.y > y) !== (right.y > y)) {
      crossings.push(left.x + ((right.x - left.x) * (y - left.y)) / (right.y - left.y));
    }
  }
  crossings.sort((left, right) => left - right);
  const intervals = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    intervals.push([crossings[index], crossings[index + 1]]);
  }
  return intervals;
}

function intervalsHaveInteriorIntersection(left, right, epsilon) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const width = Math.min(left[leftIndex][1], right[rightIndex][1]) -
      Math.max(left[leftIndex][0], right[rightIndex][0]);
    if (width > epsilon) {
      return true;
    }
    if (left[leftIndex][1] < right[rightIndex][1]) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return false;
}

// A deterministic fallback for collinear/coincident boundaries. Between consecutive
// vertex Y levels, polygon scanline topology is constant unless edges cross; proper
// edge crossings have already been handled before this function is called.
function scanlinesHavePositiveAreaOverlap(left, right, intersectionBounds, epsilon, budget) {
  const levels = [intersectionBounds.minY, intersectionBounds.maxY];
  for (const point of left) {
    if (point.y > intersectionBounds.minY + epsilon && point.y < intersectionBounds.maxY - epsilon) {
      levels.push(point.y);
    }
  }
  for (const point of right) {
    if (point.y > intersectionBounds.minY + epsilon && point.y < intersectionBounds.maxY - epsilon) {
      levels.push(point.y);
    }
  }
  if (levels.length > MAX_SCANLINE_LEVELS_PER_PAIR) {
    throw new AuditLimitError(
      `A polygon pair requires ${levels.length} scanline levels; limit is ${MAX_SCANLINE_LEVELS_PER_PAIR}.`
    );
  }
  levels.sort((leftValue, rightValue) => leftValue - rightValue);
  const unique = [];
  for (const value of levels) {
    if (unique.length === 0 || value - unique[unique.length - 1] > epsilon) {
      unique.push(value);
    }
  }
  for (let index = 0; index + 1 < unique.length; index += 1) {
    if (unique[index + 1] - unique[index] <= 2 * epsilon) {
      continue;
    }
    consumeBudget(budget, "scanlineProbes", MAX_SCANLINE_PROBES);
    const y = (unique[index] + unique[index + 1]) * 0.5;
    if (intervalsHaveInteriorIntersection(
      polygonIntervalsAtY(left, y, budget),
      polygonIntervalsAtY(right, y, budget),
      epsilon
    )) {
      return true;
    }
  }
  return false;
}

function polygonRelationship(leftRecord, rightRecord, epsilon, budget) {
  const left = leftRecord.points;
  const right = rightRecord.points;
  if (!boundsHaveInteriorIntersection(leftRecord.bounds, rightRecord.bounds, epsilon)) {
    return null;
  }

  let hasBoundaryContact = false;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftNext = (leftIndex + 1) % left.length;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      consumeBudget(budget, "segmentPairs", MAX_SEGMENT_PAIR_COMPARISONS);
      const rightNext = (rightIndex + 1) % right.length;
      const kind = segmentIntersectionKind(
        left[leftIndex],
        left[leftNext],
        right[rightIndex],
        right[rightNext],
        epsilon
      );
      if (kind === "proper") {
        return "overlap";
      }
      hasBoundaryContact ||= kind !== null;
    }
  }

  const areaScale = Math.max(1, leftRecord.area, rightRecord.area);
  const duplicateAreaTolerance = Math.max(epsilon * epsilon, areaScale * 1e-9);
  if (
    boundsEqual(leftRecord.bounds, rightRecord.bounds, epsilon) &&
    Math.abs(leftRecord.area - rightRecord.area) <= duplicateAreaTolerance &&
    everyVertexOnBoundary(left, right, rightRecord.bounds, epsilon, budget) &&
    everyVertexOnBoundary(right, left, leftRecord.bounds, epsilon, budget)
  ) {
    return "duplicate";
  }

  const leftStates = polygonSampleStates(left, right, rightRecord.bounds, epsilon, budget);
  const rightStates = polygonSampleStates(right, left, leftRecord.bounds, epsilon, budget);
  if (
    (leftStates.inside && leftStates.outside) ||
    (rightStates.inside && rightStates.outside) ||
    (leftStates.inside && rightStates.inside)
  ) {
    return "overlap";
  }
  if (leftStates.inside) {
    return "left-contained-by-right";
  }
  if (rightStates.inside) {
    return "right-contained-by-left";
  }

  if (hasBoundaryContact) {
    const intersectionBounds = {
      minX: Math.max(leftRecord.bounds.minX, rightRecord.bounds.minX),
      minY: Math.max(leftRecord.bounds.minY, rightRecord.bounds.minY),
      maxX: Math.min(leftRecord.bounds.maxX, rightRecord.bounds.maxX),
      maxY: Math.min(leftRecord.bounds.maxY, rightRecord.bounds.maxY)
    };
    if (scanlinesHavePositiveAreaOverlap(left, right, intersectionBounds, epsilon, budget)) {
      return "overlap";
    }
  }
  return null;
}

function auditSelfIntersections(record, epsilon, budget) {
  let properPairs = 0;
  let nonAdjacentPairs = 0;
  const properExamples = [];
  const nonAdjacentExamples = [];
  const points = record.points;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    const leftNext = (leftIndex + 1) % points.length;
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const rightNext = (rightIndex + 1) % points.length;
      if (leftNext === rightIndex || rightNext === leftIndex) {
        continue;
      }
      consumeBudget(budget, "segmentPairs", MAX_SEGMENT_PAIR_COMPARISONS);
      const kind = segmentIntersectionKind(
        points[leftIndex],
        points[leftNext],
        points[rightIndex],
        points[rightNext],
        epsilon
      );
      if (kind === "proper") {
        properPairs += 1;
        if (properExamples.length < 5) {
          properExamples.push([leftIndex, rightIndex]);
        }
      } else if (kind === "touch" || kind === "collinear-overlap") {
        nonAdjacentPairs += 1;
        if (nonAdjacentExamples.length < 5) {
          nonAdjacentExamples.push({ edges: [leftIndex, rightIndex], kind });
        }
      }
    }
  }
  return { properPairs, nonAdjacentPairs, properExamples, nonAdjacentExamples };
}

function parsePolygon(room, roomIndex) {
  const reasons = [];
  if (!room || typeof room !== "object" || Array.isArray(room)) {
    return { roomIndex, points: [], parseable: false, reasons: ["room is not an object"] };
  }
  const flat = room.polygon;
  if (!Array.isArray(flat)) {
    return { roomIndex, points: [], parseable: false, reasons: ["polygon is not an array"] };
  }
  if (flat.length % 2 !== 0) {
    reasons.push("polygon has an odd coordinate count");
  }
  if (flat.length < 6) {
    reasons.push("polygon has fewer than three vertices");
  }
  const vertexCount = Math.floor(flat.length / 2);
  if (vertexCount > MAX_VERTICES_PER_POLYGON) {
    throw new AuditLimitError(
      `Room ${roomIndex} has ${vertexCount} vertices; limit is ${MAX_VERTICES_PER_POLYGON}.`
    );
  }
  const points = [];
  let finite = true;
  for (let index = 0; index + 1 < flat.length; index += 2) {
    const x = flat[index];
    const y = flat[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      finite = false;
      continue;
    }
    if (Math.abs(x) > MAX_ABSOLUTE_COORDINATE || Math.abs(y) > MAX_ABSOLUTE_COORDINATE) {
      reasons.push(`coordinate magnitude exceeds ${MAX_ABSOLUTE_COORDINATE}`);
    }
    points.push({ x, y });
  }
  if (!finite) {
    reasons.push("polygon has a non-finite coordinate");
  }
  return {
    roomIndex,
    points,
    parseable: flat.length % 2 === 0 && flat.length >= 6 && finite,
    reasons
  };
}

function auditPage(prediction, filePath, displayPath) {
  if (prediction.rooms.length > MAX_ROOMS_PER_PAGE) {
    throw new AuditLimitError(
      `${displayPath} has ${prediction.rooms.length} rooms; limit is ${MAX_ROOMS_PER_PAGE}.`
    );
  }
  const possibleRoomPairs = (prediction.rooms.length * (prediction.rooms.length - 1)) / 2;
  if (possibleRoomPairs > MAX_ROOM_PAIR_COMPARISONS) {
    throw new AuditLimitError(
      `${displayPath} has ${possibleRoomPairs} possible room pairs; limit is ${MAX_ROOM_PAIR_COMPARISONS}.`
    );
  }

  const records = prediction.rooms.map(parsePolygon);
  const totalVertices = records.reduce((sum, record) => sum + record.points.length, 0);
  if (totalVertices > MAX_VERTICES_PER_PAGE) {
    throw new AuditLimitError(
      `${displayPath} has ${totalVertices} polygon vertices; limit is ${MAX_VERTICES_PER_PAGE}.`
    );
  }

  const finitePoints = records.flatMap((record) => record.points);
  const pageBounds = finitePoints.length > 0
    ? polygonBounds(finitePoints)
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pageDiagonal = Math.hypot(pageBounds.maxX - pageBounds.minX, pageBounds.maxY - pageBounds.minY);
  const epsilon = Math.max(1e-9, pageDiagonal * 1e-10);
  const areaEpsilon = epsilon * epsilon;
  const budget = createBudget();
  const violations = [];
  let truncatedViolationCount = 0;
  function addViolation(violation) {
    if (violations.length < MAX_REPORTED_VIOLATIONS) {
      violations.push(violation);
    } else {
      truncatedViolationCount += 1;
    }
  }

  let invalidPolygons = 0;
  for (const record of records) {
    if (record.parseable) {
      record.bounds = polygonBounds(record.points);
      record.signedArea = polygonSignedArea(record.points);
      record.area = Math.abs(record.signedArea);
      const distinct = new Set(record.points.map((point) => `${point.x},${point.y}`));
      if (distinct.size < 3) {
        record.reasons.push("polygon has fewer than three distinct vertices");
      }
      if (!Number.isFinite(record.area) || record.area <= areaEpsilon) {
        record.reasons.push("polygon has zero or non-finite signed area");
      } else if (record.signedArea < 0) {
        record.reasons.push("polygon has clockwise winding; expected CCW");
      }
      for (let index = 0; index < record.points.length; index += 1) {
        const next = (index + 1) % record.points.length;
        if (Math.hypot(
          record.points[next].x - record.points[index].x,
          record.points[next].y - record.points[index].y
        ) <= epsilon) {
          record.reasons.push(`polygon has a zero-length edge at index ${index}`);
          break;
        }
      }
    }
    record.valid = record.parseable && record.reasons.length === 0;
    if (!record.valid) {
      invalidPolygons += 1;
      addViolation({
        type: "invalid-polygon",
        roomIndex: record.roomIndex,
        reasons: [...new Set(record.reasons)]
      });
    }
  }

  let selfIntersectingPolygons = 0;
  let properSelfIntersectionPairs = 0;
  let nonAdjacentSelfIntersectionPairs = 0;
  for (const record of records) {
    if (!record.parseable) {
      continue;
    }
    const self = auditSelfIntersections(record, epsilon, budget);
    properSelfIntersectionPairs += self.properPairs;
    nonAdjacentSelfIntersectionPairs += self.nonAdjacentPairs;
    if (self.properPairs > 0 || self.nonAdjacentPairs > 0) {
      selfIntersectingPolygons += 1;
      addViolation({
        type: "self-intersection",
        roomIndex: record.roomIndex,
        properPairs: self.properPairs,
        nonAdjacentPairs: self.nonAdjacentPairs,
        properExamples: self.properExamples,
        nonAdjacentExamples: self.nonAdjacentExamples
      });
    }
  }

  let containmentPairs = 0;
  let duplicatePairs = 0;
  let partialOverlapPairs = 0;
  const comparable = records.filter((record) => record.valid);
  for (let leftIndex = 0; leftIndex < comparable.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < comparable.length; rightIndex += 1) {
      consumeBudget(budget, "roomPairs", MAX_ROOM_PAIR_COMPARISONS);
      const left = comparable[leftIndex];
      const right = comparable[rightIndex];
      const relationship = polygonRelationship(left, right, epsilon, budget);
      if (!relationship) {
        continue;
      }
      if (relationship === "duplicate") {
        duplicatePairs += 1;
        addViolation({
          type: "duplicate",
          roomIndices: [left.roomIndex, right.roomIndex]
        });
      } else if (relationship === "left-contained-by-right") {
        containmentPairs += 1;
        addViolation({
          type: "containment",
          outerRoomIndex: right.roomIndex,
          innerRoomIndex: left.roomIndex
        });
      } else if (relationship === "right-contained-by-left") {
        containmentPairs += 1;
        addViolation({
          type: "containment",
          outerRoomIndex: left.roomIndex,
          innerRoomIndex: right.roomIndex
        });
      } else {
        partialOverlapPairs += 1;
        addViolation({
          type: "overlap",
          roomIndices: [left.roomIndex, right.roomIndex]
        });
      }
    }
  }

  const positiveAreaOverlapPairs = containmentPairs + duplicatePairs + partialOverlapPairs;
  const violationCount = invalidPolygons + selfIntersectingPolygons + positiveAreaOverlapPairs;
  return {
    file: displayPath,
    folder: typeof prediction.folder === "string" ? prediction.folder : null,
    stem: typeof prediction.stem === "string" ? prediction.stem : path.basename(filePath, ".json"),
    ok: violationCount === 0,
    roomCount: prediction.rooms.length,
    polygonCount: records.length,
    vertexCount: totalVertices,
    epsilon,
    counts: {
      invalidPolygons,
      selfIntersectingPolygons,
      properSelfIntersectionPairs,
      nonAdjacentSelfIntersectionPairs,
      containmentPairs,
      duplicatePairs,
      partialOverlapPairs,
      positiveAreaOverlapPairs,
      violationCount
    },
    comparisons: { ...budget },
    violations,
    truncatedViolationCount
  };
}

function addPageTotals(totals, page) {
  totals.pages += 1;
  totals.rooms += page.roomCount;
  totals.polygons += page.polygonCount;
  totals.vertices += page.vertexCount;
  for (const key of Object.keys(page.counts)) {
    totals[key] += page.counts[key];
  }
  for (const key of Object.keys(page.comparisons)) {
    totals.comparisons[key] += page.comparisons[key];
  }
}

async function auditInput(args) {
  const resolved = await resolvePredictionFiles(args.input);
  const baseDirectory = resolved.files.length === 1
    ? path.dirname(resolved.files[0])
    : resolved.predictionDirectory;
  const totals = {
    pages: 0,
    rooms: 0,
    polygons: 0,
    vertices: 0,
    invalidPolygons: 0,
    selfIntersectingPolygons: 0,
    properSelfIntersectionPairs: 0,
    nonAdjacentSelfIntersectionPairs: 0,
    containmentPairs: 0,
    duplicatePairs: 0,
    partialOverlapPairs: 0,
    positiveAreaOverlapPairs: 0,
    violationCount: 0,
    comparisons: createBudget()
  };
  const pages = [];
  for (const filePath of resolved.files) {
    const prediction = await readPrediction(filePath);
    const displayPath = path.relative(process.cwd(), filePath) || path.basename(filePath);
    const hasPageIndexes = prediction.rooms.some((room) => Number.isInteger(room?.pageIndex) && room.pageIndex >= 0);
    const groups = new Map();
    if (hasPageIndexes) {
      for (const room of prediction.rooms) {
        const pageIndex = Number.isInteger(room?.pageIndex) && room.pageIndex >= 0 ? room.pageIndex : null;
        const key = pageIndex === null ? "unspecified" : String(pageIndex);
        let group = groups.get(key);
        if (!group) {
          group = { pageIndex, rooms: [] };
          groups.set(key, group);
        }
        group.rooms.push(room);
      }
    } else {
      groups.set("single", { pageIndex: null, rooms: prediction.rooms });
    }
    for (const group of groups.values()) {
      const groupDisplayPath = hasPageIndexes
        ? `${displayPath}#page=${group.pageIndex ?? "unspecified"}`
        : displayPath;
      const page = auditPage({ ...prediction, rooms: group.rooms }, filePath, groupDisplayPath);
      page.pageIndex = group.pageIndex;
      pages.push(page);
      addPageTotals(totals, page);
    }
  }
  return {
    ok: totals.violationCount === 0,
    input: args.input,
    predictionDirectory: resolved.predictionDirectory,
    filesAudited: resolved.files.length,
    limits: {
      maxFiles: MAX_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      maxRoomsPerPage: MAX_ROOMS_PER_PAGE,
      maxVerticesPerPolygon: MAX_VERTICES_PER_POLYGON,
      maxVerticesPerPage: MAX_VERTICES_PER_PAGE,
      maxRoomPairComparisonsPerPage: MAX_ROOM_PAIR_COMPARISONS,
      maxSegmentPairComparisonsPerPage: MAX_SEGMENT_PAIR_COMPARISONS,
      maxPointEdgeChecksPerPage: MAX_POINT_EDGE_CHECKS,
      maxScanlineProbesPerPage: MAX_SCANLINE_PROBES
    },
    totals,
    pages
  };
}

function formatCount(value) {
  return value.toLocaleString("en-US");
}

function renderText(report) {
  const lines = [
    `Room topology audit: ${report.ok ? "PASS" : "FAIL"}`,
    `Input: ${report.input}`,
    `Pages: ${formatCount(report.totals.pages)}  Rooms: ${formatCount(report.totals.rooms)}  Vertices: ${formatCount(report.totals.vertices)}`,
    `Invalid polygons: ${formatCount(report.totals.invalidPolygons)}`,
    `Self-intersecting polygons: ${formatCount(report.totals.selfIntersectingPolygons)} ` +
      `(proper edge pairs ${formatCount(report.totals.properSelfIntersectionPairs)}, ` +
      `non-adjacent edge pairs ${formatCount(report.totals.nonAdjacentSelfIntersectionPairs)})`,
    `Positive-area pair violations: ${formatCount(report.totals.positiveAreaOverlapPairs)} ` +
      `(containment ${formatCount(report.totals.containmentPairs)}, ` +
      `duplicates ${formatCount(report.totals.duplicatePairs)}, ` +
      `partial overlap ${formatCount(report.totals.partialOverlapPairs)})`,
    "",
    "Per page:"
  ];
  for (const page of report.pages) {
    const counts = page.counts;
    lines.push(
      `  ${page.ok ? "PASS" : "FAIL"} ${page.file} ` +
      `(rooms=${page.roomCount}, invalid=${counts.invalidPolygons}, self=${counts.selfIntersectingPolygons}, ` +
      `containment=${counts.containmentPairs}, duplicate=${counts.duplicatePairs}, overlap=${counts.partialOverlapPairs})`
    );
    if (!page.ok) {
      for (const violation of page.violations.slice(0, 8)) {
        if (violation.type === "invalid-polygon") {
          lines.push(`    - invalid room ${violation.roomIndex}: ${violation.reasons.join("; ")}`);
        } else if (violation.type === "self-intersection") {
          lines.push(
            `    - self-intersection room ${violation.roomIndex}: ` +
            `${violation.properPairs} proper, ${violation.nonAdjacentPairs} non-adjacent`
          );
        } else if (violation.type === "containment") {
          lines.push(`    - containment: room ${violation.outerRoomIndex} contains room ${violation.innerRoomIndex}`);
        } else {
          lines.push(`    - ${violation.type}: rooms ${violation.roomIndices.join(" and ")}`);
        }
      }
      const hidden = Math.max(0, page.violations.length - 8) + page.truncatedViolationCount;
      if (hidden > 0) {
        lines.push(`    - ... ${hidden} more violation detail(s)`);
      }
    }
  }
  return lines.join("\n");
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    const report = await auditInput(args);
    console.log(args.json ? JSON.stringify(report, null, 2) : renderText(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const jsonRequested = args?.json ?? process.argv.includes("--json");
    const message = error instanceof Error ? error.message : String(error);
    if (jsonRequested) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`Error: ${message}`);
      console.error("Run with --help for usage.");
    }
    process.exitCode = 2;
  }
}

await main();
