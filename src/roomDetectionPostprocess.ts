import type { Bounds } from "./pdfVectorExtractor";
import {
  type RoomClass,
  type RoomDetection,
  type RoomDetectionClassSpec,
  type RoomDetectionModelManifest
} from "./roomDetectionTypes";

export interface LetterboxMapping {
  inputWidth: number;
  inputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  offsetX: number;
  offsetY: number;
}

export interface SegmentationOutput {
  data: Float32Array;
  dims: readonly number[];
}

interface ParsedOutputShape {
  classCount: number;
  height: number;
  width: number;
  classStride: number;
  offset: number;
}

interface ComponentSummary {
  componentId: number;
  classIndex: number;
  label: RoomClass;
  count: number;
  confidenceSum: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type PixelPoint = [number, number];
type GeometryGroup = "background" | "room" | "separator";

const DEFAULT_ROOM_LABEL: RoomClass = "other";

interface GeometryScores {
  bestGroup: GeometryGroup;
  bestRoomClass: number;
  roomProbability: number;
  separatorProbability: number;
}

interface PolygonCleanupOptions {
  orthogonalize: boolean;
  snapAngleDegrees: number;
  minEdgePixels: number;
  notchMaxDepthPixels: number;
  notchMaxWidthPixels: number;
  maxPasses: number;
}

export function postprocessRoomSegmentation(
  output: SegmentationOutput,
  manifest: RoomDetectionModelManifest,
  letterbox: LetterboxMapping,
  pageRect: Bounds,
  pageIndex: number
): RoomDetection[] {
  const shape = parseOutputShape(output.dims, output.data.length);
  const classSpecs = normalizeClassSpecs(manifest.classes, shape.classCount);
  const roomLabelsByClass = classSpecs.map((spec): RoomClass | null =>
    spec.kind === "room" && spec.label ? spec.label as RoomClass : null
  );
  const roomClassIds = roomLabelsByClass
    .map((label, classIndex) => label ? classIndex : -1)
    .filter((classIndex) => classIndex >= 0);
  const backgroundClassId = findClassId(classSpecs, "background", 0);
  const separatorClassId = findClassId(classSpecs, "separator", shape.classCount - 1);
  const threshold = manifest.thresholds;
  const minConfidence = clampNumber(threshold.minConfidence, 0, 1, 0.5);
  const separatorBarrierProbability = clampNumber(threshold.separatorBarrierProbability ?? 0.2, 0, 1, 0.2);
  const separatorBarrierPixels = Math.max(0, Math.trunc(Number(threshold.separatorBarrierPixels ?? 1) || 0));
  const contourExpansionPixels = Math.max(0, Math.trunc(Number(threshold.contourExpansionPixels ?? 2) || 0));
  const roomSplitErosionPixels = Math.max(0, Math.trunc(Number(threshold.roomSplitErosionPixels ?? 2) || 0));
  const doorArcStraighten = {
    maxChordPixels: Math.max(0, Number(threshold.doorArcStraightenMaxChordPixels ?? 0) || 0),
    maxDepthPixels: Math.max(0, Number(threshold.doorArcStraightenMaxDepthPixels ?? 0) || 0),
    minDepthPixels: Math.max(0, Number(threshold.doorArcStraightenMinDepthPixels ?? 0) || 0)
  };
  const polygonCleanup: PolygonCleanupOptions = {
    orthogonalize: Boolean(threshold.orthogonalizePolygons),
    snapAngleDegrees: clampNumber(Number(threshold.orthogonalSnapAngleDegrees ?? 12) || 12, 0, 45, 12),
    minEdgePixels: Math.max(0, Number(threshold.orthogonalMinEdgePixels ?? 8) || 0),
    notchMaxDepthPixels: Math.max(0, Number(threshold.notchRemovalMaxDepthPixels ?? 0) || 0),
    notchMaxWidthPixels: Math.max(0, Number(threshold.notchRemovalMaxWidthPixels ?? 0) || 0),
    maxPasses: Math.max(1, Math.min(8, Math.trunc(Number(threshold.polygonCleanupMaxPasses ?? 2) || 2)))
  };
  const minAreaPixels = Math.max(1, Math.trunc(threshold.minAreaPixels || 128));
  const simplifyTolerance = Math.max(0, Number(threshold.simplifyTolerancePixels) || 0);
  const maxDetections = Math.max(1, Math.trunc(threshold.maxDetectionsPerPage ?? 512));
  const pixelCount = shape.width * shape.height;
  const classByPixel = new Int16Array(pixelCount);
  const confidenceByPixel = new Float32Array(pixelCount);
  const separatorByPixel = new Uint8Array(pixelCount);
  const expandableContourByPixel = new Uint8Array(pixelCount);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const geometry = computeGeometryScores(
      output.data,
      shape,
      roomClassIds,
      backgroundClassId,
      separatorClassId,
      pixelIndex
    );
    if (geometry.separatorProbability >= separatorBarrierProbability || geometry.bestGroup === "separator") {
      separatorByPixel[pixelIndex] = 1;
      expandableContourByPixel[pixelIndex] = 1;
    }
    if (geometry.bestGroup !== "room" || geometry.roomProbability < minConfidence) {
      classByPixel[pixelIndex] = -1;
      continue;
    }

    const label = roomLabelsByClass[geometry.bestRoomClass];
    if (!label) {
      classByPixel[pixelIndex] = -1;
      continue;
    }

    classByPixel[pixelIndex] = geometry.bestRoomClass;
    confidenceByPixel[pixelIndex] = geometry.roomProbability;
    expandableContourByPixel[pixelIndex] = 1;
  }

  applySeparatorBarriers(classByPixel, separatorByPixel, shape.width, shape.height, separatorBarrierPixels);
  erodeRoomSplitMask(classByPixel, shape.width, shape.height, roomSplitErosionPixels);

  const marks = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: ComponentSummary[] = [];
  let componentId = 1;

  for (let start = 0; start < pixelCount; start += 1) {
    const classIndex = classByPixel[start];
    if (classIndex < 0 || marks[start] !== 0) {
      continue;
    }

    const summary = floodComponent(
      classByPixel,
      confidenceByPixel,
      roomLabelsByClass,
      marks,
      queue,
      shape.width,
      shape.height,
      start,
      componentId
    );
    componentId += 1;

    if (summary.count >= minAreaPixels) {
      components.push(summary);
    }
  }

  components.sort((a, b) => b.count - a.count);
  const expandedContour = expandComponentMarksForContours(
    marks,
    expandableContourByPixel,
    shape.width,
    shape.height,
    contourExpansionPixels,
    components
  );
  const detections: RoomDetection[] = [];

  for (const component of components.slice(0, maxDetections)) {
    const contourComponent = expandedContour.components.get(component.componentId) ?? component;
    const contour = traceComponentContour(expandedContour.marks, shape.width, shape.height, contourComponent);
    const straightened = straightenDoorArcBulges(contour, doorArcStraighten);
    const simplified = simplifyTolerance > 0 ? simplifyPolygon(straightened, simplifyTolerance) : straightened;
    const cleaned = cleanupRoomPolygon(simplified, polygonCleanup);
    const polygon = cleaned
      .map((point) => outputPointToWorld(point, shape, letterbox, pageRect))
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));

    if (polygon.length < 3) {
      continue;
    }

    const bbox = computeWorldBounds(polygon);
    if (!isFiniteBounds(bbox)) {
      continue;
    }

    detections.push({
      id: `p${pageIndex}-r${detections.length + 1}`,
      pageIndex,
      label: component.label,
      confidence: component.confidenceSum / Math.max(1, component.count),
      polygon,
      bbox
    });
  }

  return detections;
}

function parseOutputShape(dims: readonly number[], dataLength: number): ParsedOutputShape {
  if (dims.length === 4) {
    const batch = Math.max(1, Math.trunc(dims[0] || 1));
    const classCount = Math.max(1, Math.trunc(dims[1] || 1));
    const height = Math.max(1, Math.trunc(dims[2] || 1));
    const width = Math.max(1, Math.trunc(dims[3] || 1));
    const classStride = height * width;
    if (batch < 1 || classStride * classCount > dataLength) {
      throw new Error(`Unsupported room model output shape: ${dims.join("x")}.`);
    }
    return { classCount, height, width, classStride, offset: 0 };
  }

  if (dims.length === 3) {
    const classCount = Math.max(1, Math.trunc(dims[0] || 1));
    const height = Math.max(1, Math.trunc(dims[1] || 1));
    const width = Math.max(1, Math.trunc(dims[2] || 1));
    const classStride = height * width;
    if (classStride * classCount > dataLength) {
      throw new Error(`Unsupported room model output shape: ${dims.join("x")}.`);
    }
    return { classCount, height, width, classStride, offset: 0 };
  }

  throw new Error(`Room model output must be CHW or NCHW logits, got ${dims.join("x")}.`);
}

function normalizeClassSpecs(classes: RoomDetectionClassSpec[], classCount: number): RoomDetectionClassSpec[] {
  const fallback: RoomDetectionClassSpec[] = [];
  for (let i = 0; i < classCount; i += 1) {
    fallback.push({
      id: i,
      label: i === 0 ? "background" : "other",
      color: i === 0 ? "#000000" : "#64748b",
      kind: i === 0 ? "background" : "room"
    });
  }

  for (const spec of classes) {
    const id = Math.trunc(Number(spec.id));
    if (!Number.isFinite(id) || id < 0 || id >= classCount) {
      continue;
    }

    fallback[id] = spec;
  }

  return fallback;
}

function findClassId(
  classes: RoomDetectionClassSpec[],
  kind: RoomDetectionClassSpec["kind"],
  fallback: number
): number {
  const match = classes.find((spec) => spec.kind === kind);
  const id = Math.trunc(Number(match?.id));
  if (Number.isFinite(id) && id >= 0 && id < classes.length) {
    return id;
  }
  return Math.max(0, Math.min(classes.length - 1, fallback));
}

function readClassScore(data: Float32Array, shape: ParsedOutputShape, classIndex: number, pixelIndex: number): number {
  return data[shape.offset + classIndex * shape.classStride + pixelIndex] ?? Number.NEGATIVE_INFINITY;
}

function computeGeometryScores(
  data: Float32Array,
  shape: ParsedOutputShape,
  roomClassIds: number[],
  backgroundClassId: number,
  separatorClassId: number,
  pixelIndex: number
): GeometryScores {
  const backgroundScore = readClassScore(data, shape, backgroundClassId, pixelIndex);
  const separatorScore = readClassScore(data, shape, separatorClassId, pixelIndex);
  let bestRoomClass = roomClassIds[0] ?? 0;
  let bestRoomScore = Number.NEGATIVE_INFINITY;
  let roomScoreMax = Number.NEGATIVE_INFINITY;

  for (const classIndex of roomClassIds) {
    const score = readClassScore(data, shape, classIndex, pixelIndex);
    if (score > bestRoomScore) {
      bestRoomScore = score;
      bestRoomClass = classIndex;
    }
    roomScoreMax = Math.max(roomScoreMax, score);
  }

  let roomScoreSum = 0;
  for (const classIndex of roomClassIds) {
    roomScoreSum += Math.exp(readClassScore(data, shape, classIndex, pixelIndex) - roomScoreMax);
  }
  const roomScore = roomClassIds.length > 0 && Number.isFinite(roomScoreSum) && roomScoreSum > 0
    ? roomScoreMax + Math.log(roomScoreSum)
    : Number.NEGATIVE_INFINITY;

  let bestGroup: GeometryGroup = "background";
  let bestScore = backgroundScore;
  if (roomScore > bestScore) {
    bestScore = roomScore;
    bestGroup = "room";
  }
  if (separatorScore > bestScore) {
    bestScore = separatorScore;
    bestGroup = "separator";
  }

  const denominator =
    Math.exp(backgroundScore - bestScore) +
    Math.exp(roomScore - bestScore) +
    Math.exp(separatorScore - bestScore);
  const roomProbability = Number.isFinite(denominator) && denominator > 0
    ? Math.exp(roomScore - bestScore) / denominator
    : 0;
  const separatorProbability = Number.isFinite(denominator) && denominator > 0
    ? Math.exp(separatorScore - bestScore) / denominator
    : 0;

  return {
    bestGroup,
    bestRoomClass,
    roomProbability: Number.isFinite(roomProbability) ? roomProbability : 0,
    separatorProbability: Number.isFinite(separatorProbability) ? separatorProbability : 0
  };
}

function floodComponent(
  classByPixel: Int16Array,
  confidenceByPixel: Float32Array,
  roomLabelsByClass: Array<RoomClass | null>,
  marks: Int32Array,
  queue: Int32Array,
  width: number,
  height: number,
  start: number,
  componentId: number
): ComponentSummary {
  let head = 0;
  let tail = 0;
  queue[tail] = start;
  tail += 1;
  marks[start] = componentId;

  let count = 0;
  let confidenceSum = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const classCounts = new Map<number, number>();

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const classIndex = classByPixel[index];
    const x = index % width;
    const y = Math.trunc(index / width);
    count += 1;
    confidenceSum += confidenceByPixel[index] || 0;
    classCounts.set(classIndex, (classCounts.get(classIndex) ?? 0) + 1);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    const left = index - 1;
    if (x > 0 && marks[left] === 0 && classByPixel[left] >= 0) {
      marks[left] = componentId;
      queue[tail] = left;
      tail += 1;
    }

    const right = index + 1;
    if (x + 1 < width && marks[right] === 0 && classByPixel[right] >= 0) {
      marks[right] = componentId;
      queue[tail] = right;
      tail += 1;
    }

    const up = index - width;
    if (y > 0 && marks[up] === 0 && classByPixel[up] >= 0) {
      marks[up] = componentId;
      queue[tail] = up;
      tail += 1;
    }

    const down = index + width;
    if (y + 1 < height && marks[down] === 0 && classByPixel[down] >= 0) {
      marks[down] = componentId;
      queue[tail] = down;
      tail += 1;
    }
  }

  const classIndex = findMajorityClass(classCounts);
  return {
    componentId,
    classIndex,
    label: roomLabelsByClass[classIndex] ?? DEFAULT_ROOM_LABEL,
    count,
    confidenceSum,
    minX,
    minY,
    maxX,
    maxY
  };
}

function applySeparatorBarriers(
  classByPixel: Int16Array,
  separatorByPixel: Uint8Array,
  width: number,
  height: number,
  radius: number
): void {
  if (radius <= 0) {
    for (let index = 0; index < classByPixel.length; index += 1) {
      if (separatorByPixel[index]) {
        classByPixel[index] = -1;
      }
    }
    return;
  }

  const blocked = new Uint8Array(separatorByPixel.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!separatorByPixel[index]) {
        continue;
      }
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          continue;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) {
            continue;
          }
          blocked[yy * width + xx] = 1;
        }
      }
    }
  }

  for (let index = 0; index < classByPixel.length; index += 1) {
    if (blocked[index]) {
      classByPixel[index] = -1;
    }
  }
}

function erodeRoomSplitMask(classByPixel: Int16Array, width: number, height: number, radius: number): void {
  if (radius <= 0) {
    return;
  }

  const eroded = new Int16Array(classByPixel);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (classByPixel[index] < 0) {
        continue;
      }

      let keep = true;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          keep = false;
          break;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || classByPixel[yy * width + xx] < 0) {
            keep = false;
            break;
          }
        }
      }

      if (!keep) {
        eroded[index] = -1;
      }
    }
  }

  classByPixel.set(eroded);
}

function findMajorityClass(classCounts: Map<number, number>): number {
  let bestClass = 0;
  let bestCount = -1;
  for (const [classIndex, count] of classCounts) {
    if (count > bestCount) {
      bestClass = classIndex;
      bestCount = count;
    }
  }
  return bestClass;
}

function expandComponentMarksForContours(
  marks: Int32Array,
  expandableByPixel: Uint8Array,
  width: number,
  height: number,
  radius: number,
  components: ComponentSummary[]
): { marks: Int32Array; components: Map<number, ComponentSummary> } {
  const expandedMarks = new Int32Array(marks);
  const expandedComponents = new Map<number, ComponentSummary>();
  for (const component of components) {
    expandedComponents.set(component.componentId, { ...component });
  }

  if (radius <= 0) {
    return { marks: expandedMarks, components: expandedComponents };
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const componentId = marks[index];
      if (componentId <= 0) {
        continue;
      }

      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          continue;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) {
            continue;
          }
          const target = yy * width + xx;
          if (!expandableByPixel[target] || expandedMarks[target] !== 0) {
            continue;
          }
          expandedMarks[target] = componentId;
          const component = expandedComponents.get(componentId);
          if (component) {
            component.minX = Math.min(component.minX, xx);
            component.minY = Math.min(component.minY, yy);
            component.maxX = Math.max(component.maxX, xx);
            component.maxY = Math.max(component.maxY, yy);
          }
        }
      }
    }
  }

  return { marks: expandedMarks, components: expandedComponents };
}

function traceComponentContour(
  marks: Int32Array,
  width: number,
  height: number,
  component: ComponentSummary
): PixelPoint[] {
  const nextByPoint = new Map<string, string[]>();

  function hasPixel(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < width && y < height && marks[y * width + x] === component.componentId;
  }

  function addEdge(ax: number, ay: number, bx: number, by: number): void {
    const from = pointKey(ax, ay);
    const to = pointKey(bx, by);
    const next = nextByPoint.get(from);
    if (next) {
      next.push(to);
    } else {
      nextByPoint.set(from, [to]);
    }
  }

  for (let y = component.minY; y <= component.maxY; y += 1) {
    for (let x = component.minX; x <= component.maxX; x += 1) {
      if (!hasPixel(x, y)) {
        continue;
      }

      if (!hasPixel(x, y - 1)) {
        addEdge(x, y, x + 1, y);
      }
      if (!hasPixel(x + 1, y)) {
        addEdge(x + 1, y, x + 1, y + 1);
      }
      if (!hasPixel(x, y + 1)) {
        addEdge(x + 1, y + 1, x, y + 1);
      }
      if (!hasPixel(x - 1, y)) {
        addEdge(x, y + 1, x, y);
      }
    }
  }

  const contours: PixelPoint[][] = [];
  const visitedEdges = new Set<string>();

  for (const [startKey, nextKeys] of nextByPoint) {
    for (const firstNext of nextKeys) {
      const edgeKey = `${startKey}>${firstNext}`;
      if (visitedEdges.has(edgeKey)) {
        continue;
      }

      const contour = followContour(nextByPoint, startKey, firstNext, visitedEdges);
      if (contour.length >= 3) {
        contours.push(contour);
      }
    }
  }

  contours.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  const primary = contours[0];
  if (primary && primary.length >= 3) {
    return primary;
  }

  return [
    [component.minX, component.minY],
    [component.maxX + 1, component.minY],
    [component.maxX + 1, component.maxY + 1],
    [component.minX, component.maxY + 1]
  ];
}

function straightenDoorArcBulges(
  points: PixelPoint[],
  options: { maxChordPixels: number; maxDepthPixels: number; minDepthPixels: number }
): PixelPoint[] {
  if (points.length < 12 || options.maxChordPixels <= 0 || options.maxDepthPixels <= 0) {
    return points;
  }

  let current = points;
  const maxPasses = Math.min(32, Math.max(1, Math.floor(points.length / 12)));
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const candidate = findDoorArcBulgeCandidate(current, options);
    if (!candidate) {
      break;
    }
    current = removeContourSpan(current, candidate.startIndex, candidate.span);
    if (current.length < 12) {
      break;
    }
  }
  return current;
}

function findDoorArcBulgeCandidate(
  points: PixelPoint[],
  options: { maxChordPixels: number; maxDepthPixels: number; minDepthPixels: number }
): { startIndex: number; span: number; score: number } | null {
  const pointCount = points.length;
  const maxSpan = Math.min(pointCount - 3, Math.max(8, Math.ceil(options.maxChordPixels * 3)));
  let best: { startIndex: number; span: number; score: number } | null = null;

  for (let startIndex = 0; startIndex < pointCount; startIndex += 1) {
    for (let span = 6; span <= maxSpan; span += 1) {
      const candidate = scoreDoorArcBulge(points, startIndex, span, options);
      if (candidate && (!best || candidate.score > best.score)) {
        best = candidate;
      }
    }
  }

  return best;
}

function scoreDoorArcBulge(
  points: PixelPoint[],
  startIndex: number,
  span: number,
  options: { maxChordPixels: number; maxDepthPixels: number; minDepthPixels: number }
): { startIndex: number; span: number; score: number } | null {
  const start = points[startIndex];
  const end = points[(startIndex + span) % points.length];
  const chordLength = distanceBetweenPoints(start, end);
  if (chordLength < 6 || chordLength > options.maxChordPixels) {
    return null;
  }

  let pathLength = 0;
  let maxDistance = 0;
  let positive = 0;
  let negative = 0;
  const directions: PixelPoint[] = [];
  let previous = start;

  for (let offset = 1; offset < span; offset += 1) {
    const point = points[(startIndex + offset) % points.length];
    pathLength += distanceBetweenPoints(previous, point);
    const signedDistance = signedDistanceToLine(point, start, end);
    const absDistance = Math.abs(signedDistance);
    maxDistance = Math.max(maxDistance, absDistance);
    if (absDistance > 1) {
      if (signedDistance > 0) {
        positive += 1;
      } else {
        negative += 1;
      }
    }
    const direction = normalizedGridDirection(previous, point);
    if (direction) {
      directions.push(direction);
    }
    previous = point;
  }
  pathLength += distanceBetweenPoints(previous, end);

  if (maxDistance < options.minDepthPixels || maxDistance > options.maxDepthPixels) {
    return null;
  }
  const sideVotes = positive + negative;
  if (sideVotes < 4 || Math.max(positive, negative) / sideVotes < 0.85) {
    return null;
  }
  const pathRatio = pathLength / Math.max(1e-6, chordLength);
  if (pathRatio < 1.18 || pathRatio > 3.8) {
    return null;
  }
  if (maxDistance > chordLength * 0.9) {
    return null;
  }
  if (countDirectionChanges(directions) < 4) {
    return null;
  }

  return {
    startIndex,
    span,
    score: maxDistance * pathRatio * Math.min(1.5, span / 24)
  };
}

function removeContourSpan(points: PixelPoint[], startIndex: number, span: number): PixelPoint[] {
  const remove = new Uint8Array(points.length);
  for (let offset = 1; offset < span; offset += 1) {
    remove[(startIndex + offset) % points.length] = 1;
  }
  const result: PixelPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (!remove[index]) {
      result.push(points[index]);
    }
  }
  return result.length >= 3 ? result : points;
}

function cleanupRoomPolygon(points: PixelPoint[], options: PolygonCleanupOptions): PixelPoint[] {
  if (points.length < 3) {
    return points;
  }

  let current = removeRedundantPolygonPoints(points, 0.75);
  const originalArea = Math.abs(polygonArea(current));
  if (originalArea <= 1e-6) {
    return points;
  }

  for (let pass = 0; pass < options.maxPasses; pass += 1) {
    const beforeLength = current.length;
    if (options.notchMaxDepthPixels > 0 && options.notchMaxWidthPixels > 0) {
      current = removeSmallContourDetour(current, options);
    }
    current = removeRedundantPolygonPoints(current, 0.75);
    if (current.length === beforeLength) {
      break;
    }
  }

  if (options.orthogonalize) {
    const orthogonal = orthogonalizePolygon(current, options);
    if (isReasonablePolygonReplacement(current, orthogonal)) {
      current = orthogonal;
    }
  }

  current = removeRedundantPolygonPoints(current, 0.75);
  return current.length >= 3 ? current : points;
}

function removeSmallContourDetour(points: PixelPoint[], options: PolygonCleanupOptions): PixelPoint[] {
  if (points.length < 6) {
    return points;
  }

  const maxSpan = Math.min(points.length - 2, 24);
  let best: { startIndex: number; span: number; score: number } | null = null;
  for (let startIndex = 0; startIndex < points.length; startIndex += 1) {
    for (let span = 2; span <= maxSpan; span += 1) {
      const candidate = scoreSmallContourDetour(points, startIndex, span, options);
      if (candidate && (!best || candidate.score > best.score)) {
        best = candidate;
      }
    }
  }

  return best ? removeContourSpan(points, best.startIndex, best.span) : points;
}

function scoreSmallContourDetour(
  points: PixelPoint[],
  startIndex: number,
  span: number,
  options: PolygonCleanupOptions
): { startIndex: number; span: number; score: number } | null {
  const pointCount = points.length;
  const start = points[startIndex];
  const end = points[(startIndex + span) % pointCount];
  const chordLength = distanceBetweenPoints(start, end);
  if (chordLength < Math.max(4, options.minEdgePixels * 0.5) || chordLength > options.notchMaxWidthPixels) {
    return null;
  }

  const before = points[(startIndex - 1 + pointCount) % pointCount];
  const after = points[(startIndex + span + 1) % pointCount];
  if (!continuesAcrossDetour(before, start, end, after)) {
    return null;
  }

  let pathLength = 0;
  let maxDistance = 0;
  let positive = 0;
  let negative = 0;
  let previous = start;
  for (let offset = 1; offset < span; offset += 1) {
    const point = points[(startIndex + offset) % pointCount];
    pathLength += distanceBetweenPoints(previous, point);
    const signedDistance = signedDistanceToLine(point, start, end);
    const absDistance = Math.abs(signedDistance);
    maxDistance = Math.max(maxDistance, absDistance);
    if (absDistance > 0.75) {
      if (signedDistance > 0) {
        positive += 1;
      } else {
        negative += 1;
      }
    }
    previous = point;
  }
  pathLength += distanceBetweenPoints(previous, end);

  if (maxDistance < 1.25 || maxDistance > options.notchMaxDepthPixels) {
    return null;
  }
  const sideVotes = positive + negative;
  if (sideVotes > 0 && Math.max(positive, negative) / sideVotes < 0.8) {
    return null;
  }
  if (pathLength < chordLength + Math.max(2, maxDistance * 0.5)) {
    return null;
  }

  return {
    startIndex,
    span,
    score: maxDistance * (pathLength / Math.max(1e-6, chordLength))
  };
}

function continuesAcrossDetour(before: PixelPoint, start: PixelPoint, end: PixelPoint, after: PixelPoint): boolean {
  const chordAngle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  const beforeLength = distanceBetweenPoints(before, start);
  const afterLength = distanceBetweenPoints(end, after);
  if (beforeLength < 1 || afterLength < 1) {
    return false;
  }

  const beforeAngle = Math.atan2(start[1] - before[1], start[0] - before[0]);
  const afterAngle = Math.atan2(after[1] - end[1], after[0] - end[0]);
  const tolerance = degreesToRadians(24);
  return (
    angleDistanceRadians(beforeAngle, chordAngle) <= tolerance &&
    angleDistanceRadians(afterAngle, chordAngle) <= tolerance
  );
}

function orthogonalizePolygon(points: PixelPoint[], options: PolygonCleanupOptions): PixelPoint[] {
  if (points.length < 4) {
    return points;
  }

  const dominantAngle = estimateDominantOrthogonalAxis(points, options.minEdgePixels);
  if (dominantAngle === null) {
    return points;
  }

  const snapRadians = degreesToRadians(options.snapAngleDegrees);
  const lines = points.map((point, index): { point: PixelPoint; direction: PixelPoint; axis: number } | null => {
    const next = points[(index + 1) % points.length];
    const length = distanceBetweenPoints(point, next);
    if (length < options.minEdgePixels) {
      return null;
    }
    const angle = Math.atan2(next[1] - point[1], next[0] - point[0]);
    const axis = nearestOrthogonalAxis(angle, dominantAngle);
    if (axis.distance > snapRadians) {
      return null;
    }
    return {
      point: [(point[0] + next[0]) * 0.5, (point[1] + next[1]) * 0.5],
      direction: [Math.cos(axis.angle), Math.sin(axis.angle)],
      axis: axis.index
    };
  });

  const result = points.map((point, index): PixelPoint => {
    const previousLine = lines[(index - 1 + lines.length) % lines.length];
    const nextLine = lines[index];
    if (!previousLine || !nextLine || previousLine.axis === nextLine.axis) {
      return point;
    }
    return intersectLines(previousLine.point, previousLine.direction, nextLine.point, nextLine.direction) ?? point;
  });

  return removeRedundantPolygonPoints(result, 0.75);
}

function estimateDominantOrthogonalAxis(points: PixelPoint[], minEdgePixels: number): number | null {
  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const length = distanceBetweenPoints(point, next);
    if (length < Math.max(1, minEdgePixels)) {
      continue;
    }
    const angle = Math.atan2(next[1] - point[1], next[0] - point[0]);
    sumX += Math.cos(angle * 4) * length;
    sumY += Math.sin(angle * 4) * length;
    totalWeight += length;
  }
  if (totalWeight <= 0) {
    return null;
  }

  let angle = Math.atan2(sumY, sumX) * 0.25;
  const halfPi = Math.PI * 0.5;
  while (angle < 0) {
    angle += halfPi;
  }
  while (angle >= halfPi) {
    angle -= halfPi;
  }
  return angle;
}

function nearestOrthogonalAxis(angle: number, dominantAngle: number): { angle: number; index: number; distance: number } {
  const primary = dominantAngle;
  const secondary = dominantAngle + Math.PI * 0.5;
  const primaryDistance = angleDistanceRadians(angle, primary);
  const secondaryDistance = angleDistanceRadians(angle, secondary);
  if (primaryDistance <= secondaryDistance) {
    return { angle: primary, index: 0, distance: primaryDistance };
  }
  return { angle: secondary, index: 1, distance: secondaryDistance };
}

function intersectLines(pointA: PixelPoint, directionA: PixelPoint, pointB: PixelPoint, directionB: PixelPoint): PixelPoint | null {
  const cross = directionA[0] * directionB[1] - directionA[1] * directionB[0];
  if (Math.abs(cross) <= 1e-8) {
    return null;
  }
  const dx = pointB[0] - pointA[0];
  const dy = pointB[1] - pointA[1];
  const t = (dx * directionB[1] - dy * directionB[0]) / cross;
  return [pointA[0] + directionA[0] * t, pointA[1] + directionA[1] * t];
}

function removeRedundantPolygonPoints(points: PixelPoint[], collinearTolerance: number): PixelPoint[] {
  let current = removeConsecutiveDuplicatePoints(points);
  if (current.length < 4) {
    return current;
  }

  let changed = true;
  while (changed && current.length >= 4) {
    changed = false;
    const nextPoints: PixelPoint[] = [];
    for (let index = 0; index < current.length; index += 1) {
      const previous = current[(index - 1 + current.length) % current.length];
      const point = current[index];
      const next = current[(index + 1) % current.length];
      if (distanceBetweenPoints(previous, point) <= 0.25 || distanceBetweenPoints(point, next) <= 0.25) {
        changed = true;
        continue;
      }
      if (perpendicularDistance(point, previous, next) <= collinearTolerance) {
        changed = true;
        continue;
      }
      nextPoints.push(point);
    }
    if (nextPoints.length >= 3) {
      current = nextPoints;
    } else {
      break;
    }
  }
  return current;
}

function removeConsecutiveDuplicatePoints(points: PixelPoint[]): PixelPoint[] {
  const result: PixelPoint[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || distanceBetweenPoints(previous, point) > 0.25) {
      result.push(point);
    }
  }
  if (result.length > 1 && distanceBetweenPoints(result[0], result[result.length - 1]) <= 0.25) {
    result.pop();
  }
  return result;
}

function isReasonablePolygonReplacement(original: PixelPoint[], replacement: PixelPoint[]): boolean {
  if (replacement.length < 3) {
    return false;
  }
  const originalArea = Math.abs(polygonArea(original));
  const replacementArea = Math.abs(polygonArea(replacement));
  if (originalArea <= 1e-6 || replacementArea <= 1e-6) {
    return false;
  }
  const areaRatio = replacementArea / originalArea;
  return areaRatio >= 0.55 && areaRatio <= 1.65;
}

function followContour(
  nextByPoint: Map<string, string[]>,
  startKey: string,
  firstNext: string,
  visitedEdges: Set<string>
): PixelPoint[] {
  const points: PixelPoint[] = [parsePointKey(startKey)];
  let current = startKey;
  let next = firstNext;
  let guard = 0;

  while (guard < 1_000_000) {
    guard += 1;
    visitedEdges.add(`${current}>${next}`);
    points.push(parsePointKey(next));
    if (next === startKey) {
      points.pop();
      break;
    }

    const candidates = nextByPoint.get(next);
    if (!candidates || candidates.length === 0) {
      break;
    }

    const unused = candidates.find((candidate) => !visitedEdges.has(`${next}>${candidate}`));
    current = next;
    next = unused ?? candidates[0];
    if (visitedEdges.has(`${current}>${next}`)) {
      break;
    }
  }

  return points;
}

function simplifyPolygon(points: PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length <= 3) {
    return points;
  }

  const closed = [...points, points[0]];
  const simplified = simplifyPolyline(closed, tolerance);
  if (simplified.length > 1 && pointsEqual(simplified[0], simplified[simplified.length - 1])) {
    simplified.pop();
  }
  return simplified.length >= 3 ? simplified : points;
}

function simplifyPolyline(points: PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length <= 2) {
    return points;
  }

  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= tolerance) {
    return [start, end];
  }

  const left = simplifyPolyline(points.slice(0, index + 1), tolerance);
  const right = simplifyPolyline(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

function outputPointToWorld(
  point: PixelPoint,
  shape: ParsedOutputShape,
  letterbox: LetterboxMapping,
  pageRect: Bounds
): [number, number] {
  const inputX = (point[0] / shape.width) * letterbox.inputWidth;
  const inputY = (point[1] / shape.height) * letterbox.inputHeight;
  const sourceX = clampNumber((inputX - letterbox.offsetX) / Math.max(1e-6, letterbox.scaledWidth) * letterbox.sourceWidth, 0, letterbox.sourceWidth, 0);
  const sourceY = clampNumber((inputY - letterbox.offsetY) / Math.max(1e-6, letterbox.scaledHeight) * letterbox.sourceHeight, 0, letterbox.sourceHeight, 0);
  const minX = Math.min(pageRect.minX, pageRect.maxX);
  const maxX = Math.max(pageRect.minX, pageRect.maxX);
  const minY = Math.min(pageRect.minY, pageRect.maxY);
  const maxY = Math.max(pageRect.minY, pageRect.maxY);
  const nx = letterbox.sourceWidth > 0 ? sourceX / letterbox.sourceWidth : 0;
  const ny = letterbox.sourceHeight > 0 ? sourceY / letterbox.sourceHeight : 0;
  return [
    minX + nx * (maxX - minX),
    maxY - ny * (maxY - minY)
  ];
}

function computeWorldBounds(points: Array<[number, number]>): Bounds {
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

  return { minX, minY, maxX, maxY };
}

function polygonArea(points: PixelPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function perpendicularDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-12) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / Math.sqrt(lengthSq);
}

function signedDistanceToLine(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) {
    return 0;
  }
  return ((point[0] - start[0]) * dy - (point[1] - start[1]) * dx) / length;
}

function distanceBetweenPoints(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function angleDistanceRadians(left: number, right: number): number {
  const twoPi = Math.PI * 2;
  let diff = Math.abs((left - right) % twoPi);
  if (diff > Math.PI) {
    diff = twoPi - diff;
  }
  return Math.min(diff, Math.abs(Math.PI - diff));
}

function normalizedGridDirection(a: PixelPoint, b: PixelPoint): PixelPoint | null {
  const dx = Math.sign(b[0] - a[0]);
  const dy = Math.sign(b[1] - a[1]);
  if (dx === 0 && dy === 0) {
    return null;
  }
  return [dx, dy];
}

function countDirectionChanges(directions: PixelPoint[]): number {
  let changes = 0;
  let previous: PixelPoint | null = null;
  for (const direction of directions) {
    if (previous && (previous[0] !== direction[0] || previous[1] !== direction[1])) {
      changes += 1;
    }
    previous = direction;
  }
  return changes;
}

function pointKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parsePointKey(key: string): PixelPoint {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

function pointsEqual(a: PixelPoint, b: PixelPoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX &&
    bounds.maxY > bounds.minY
  );
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
