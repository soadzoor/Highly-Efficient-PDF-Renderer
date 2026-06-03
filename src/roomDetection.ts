import type { Bounds, DetectedRoom, RoomPolygonPoint, SceneTextItem, VectorScene } from "./pdfVectorExtractor";

const MAX_ROOM_LABEL_CANDIDATES = 4_000;
const MAX_INDEXED_STROKES = 180_000;
const MAX_GRID_AXIS_CELLS = 120;
const MIN_GRID_AXIS_CELLS = 24;
const ROOM_LABEL_MAX_LENGTH = 28;
const RAY_SAMPLE_OFFSETS = [-2, -1, 0, 1, 2];
const ROOM_OUTLINE_SCAN_COUNT = 7;
const ROOM_OUTLINE_MIN_INTERVALS = 3;

interface PageRect extends Bounds {
  pageIndex: number;
}

interface LabelCandidate {
  label: string;
  bounds: Bounds;
  pageIndex: number;
  score: number;
}

interface StrokeCandidate {
  bounds: Bounds;
  halfWidth: number;
  length: number;
  alpha: number;
  score: number;
}

interface StrokeIndex {
  bounds: Bounds;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  cells: number[][];
  wideIndices: number[];
  strokes: StrokeCandidate[];
  seen: Uint32Array;
  stamp: number;
}

interface RoomBoundaryResult {
  bounds: Bounds;
  polygon: RoomPolygonPoint[];
  score: number;
}

interface RoomScanInterval {
  minY: number;
  maxY: number;
  left: number;
  right: number;
}

export function detectRooms(scene: VectorScene): DetectedRoom[] {
  if (!Array.isArray(scene.textItems) || scene.textItems.length === 0 || scene.segmentCount <= 0) {
    return [];
  }

  const pageRects = readPageRects(scene);
  const labels = buildLabelCandidates(scene.textItems, pageRects);
  if (labels.length === 0) {
    return [];
  }

  const strokeIndex = buildStrokeIndex(scene);
  if (!strokeIndex || strokeIndex.strokes.length === 0) {
    return labels.slice(0, 200).map((label, index) => createFallbackRoom(label, pageRects, index));
  }

  const rooms: DetectedRoom[] = [];
  for (const label of labels.slice(0, MAX_ROOM_LABEL_CANDIDATES)) {
    const room = detectRoomFromLabel(label, pageRects, strokeIndex, rooms.length);
    if (!room) {
      continue;
    }
    mergeOrAppendRoom(rooms, room);
  }

  const resolvedRooms = resolveRoomOverlaps(rooms);
  resolvedRooms.sort(compareRooms);
  return resolvedRooms;
}

function buildLabelCandidates(textItems: SceneTextItem[], pageRects: PageRect[]): LabelCandidate[] {
  const candidates: LabelCandidate[] = [];
  const normalizedItems = textItems
    .map((item) => normalizeTextItem(item, pageRects))
    .filter((item): item is LabelCandidate => item !== null);

  for (const item of normalizedItems) {
    if (looksLikeRoomLabel(item.label)) {
      candidates.push(item);
    }
  }

  const sorted = [...normalizedItems].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) {
      return a.pageIndex - b.pageIndex;
    }
    const ay = centerY(a.bounds);
    const by = centerY(b.bounds);
    if (Math.abs(ay - by) > Math.max(boundsHeight(a.bounds), boundsHeight(b.bounds)) * 0.8) {
      return ay - by;
    }
    return centerX(a.bounds) - centerX(b.bounds);
  });

  for (let i = 0; i < sorted.length; i += 1) {
    let mergedText = sorted[i].label;
    let mergedBounds = sorted[i].bounds;
    for (let j = i + 1; j < Math.min(sorted.length, i + 4); j += 1) {
      const next = sorted[j];
      if (next.pageIndex !== sorted[i].pageIndex || !sameTextLine(mergedBounds, next.bounds)) {
        break;
      }
      const gap = next.bounds.minX - mergedBounds.maxX;
      const maxGap = Math.max(boundsHeight(mergedBounds), boundsHeight(next.bounds)) * 1.25;
      if (gap < -maxGap || gap > maxGap * 2.5) {
        break;
      }
      mergedText = `${mergedText} ${next.label}`.replace(/\s+/g, " ").trim();
      mergedBounds = unionBounds(mergedBounds, next.bounds);
      if (looksLikeRoomLabel(mergedText)) {
        candidates.push({
          label: normalizeRoomLabel(mergedText),
          bounds: mergedBounds,
          pageIndex: sorted[i].pageIndex,
          score: Math.max(sorted[i].score, next.score) + 0.08
        });
      }
    }
  }

  const unique = new Map<string, LabelCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.pageIndex}|${candidate.label}|${Math.round(centerX(candidate.bounds) * 2)}|${Math.round(centerY(candidate.bounds) * 2)}`;
    const existing = unique.get(key);
    if (!existing || candidate.score > existing.score) {
      unique.set(key, candidate);
    }
  }

  return [...unique.values()].sort((a, b) => b.score - a.score);
}

function normalizeTextItem(item: SceneTextItem, pageRects: PageRect[]): LabelCandidate | null {
  const label = normalizeRoomLabel(item.text);
  if (label.length === 0 || label.length > ROOM_LABEL_MAX_LENGTH || !isFiniteBounds(item.bounds)) {
    return null;
  }
  const pageIndex = resolvePageIndex(item, pageRects);
  const digitScore = /\d/.test(label) ? 0.25 : 0;
  const compactScore = label.length <= 12 ? 0.12 : 0;
  return {
    label,
    bounds: item.bounds,
    pageIndex,
    score: digitScore + compactScore
  };
}

function looksLikeRoomLabel(label: string): boolean {
  const normalized = normalizeRoomLabel(label);
  if (normalized.length === 0 || normalized.length > ROOM_LABEL_MAX_LENGTH || !/\d/.test(normalized)) {
    return false;
  }
  if (/^(?:scale|sheet|page|date|rev|revision|level|floor)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(?:mm|cm|meter|metre|sqm|sqft|m2|m²)\b/i.test(normalized)) {
    return false;
  }
  const compact = normalized.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/#-]*$/.test(compact)) {
    return false;
  }
  return compact.length <= ROOM_LABEL_MAX_LENGTH;
}

function detectRoomFromLabel(
  label: LabelCandidate,
  pageRects: PageRect[],
  strokeIndex: StrokeIndex,
  index: number
): DetectedRoom | null {
  const pageBounds = pageRects[label.pageIndex] ?? pageRects[0] ?? strokeIndex.bounds;
  const labelWidth = boundsWidth(label.bounds);
  const labelHeight = boundsHeight(label.bounds);
  if (labelWidth <= 0 || labelHeight <= 0) {
    return null;
  }

  const labelBoxScore = scoreLabelBox(label.bounds, strokeIndex, pageBounds);
  const rayResult = findRayRoomBounds(label.bounds, strokeIndex, pageBounds);
  const fallbackBounds = clampBounds(
    expandBounds(label.bounds, Math.max(labelWidth, labelHeight) * 8 + Math.max(boundsWidth(pageBounds), boundsHeight(pageBounds)) * 0.015),
    pageBounds
  );
  const bounds = rayResult?.bounds ?? fallbackBounds;
  const confidence = clamp01(label.score + labelBoxScore + (rayResult?.score ?? 0.08));

  return {
    id: buildRoomId(label, index),
    label: label.label,
    bounds,
    labelBounds: label.bounds,
    ...(rayResult && rayResult.polygon.length >= 3 ? { polygon: rayResult.polygon } : {}),
    confidence,
    pageIndex: label.pageIndex
  };
}

function findRayRoomBounds(labelBounds: Bounds, strokeIndex: StrokeIndex, pageBounds: Bounds): RoomBoundaryResult | null {
  const cx = centerX(labelBounds);
  const cy = centerY(labelBounds);
  const labelWidth = boundsWidth(labelBounds);
  const labelHeight = boundsHeight(labelBounds);
  const pageWidth = boundsWidth(pageBounds);
  const pageHeight = boundsHeight(pageBounds);
  const ignoreBounds = expandBounds(labelBounds, Math.max(labelWidth, labelHeight) * 1.4 + 1);
  const xBand = Math.max(labelWidth * 0.6, pageWidth * 0.0025, 2);
  const yBand = Math.max(labelHeight * 0.8, pageHeight * 0.0025, 2);
  const horizontalSampleStep = Math.max(labelHeight * 1.15, yBand);
  const verticalSampleStep = Math.max(labelWidth * 1.15, xBand);

  const leftValues = findHorizontalBoundaryValues(
    "left",
    strokeIndex,
    pageBounds,
    labelBounds,
    ignoreBounds,
    cy,
    horizontalSampleStep,
    yBand
  );
  const rightValues = findHorizontalBoundaryValues(
    "right",
    strokeIndex,
    pageBounds,
    labelBounds,
    ignoreBounds,
    cy,
    horizontalSampleStep,
    yBand
  );
  const bottomValues = findVerticalBoundaryValues(
    "bottom",
    strokeIndex,
    pageBounds,
    labelBounds,
    ignoreBounds,
    cx,
    verticalSampleStep,
    xBand
  );
  const topValues = findVerticalBoundaryValues(
    "top",
    strokeIndex,
    pageBounds,
    labelBounds,
    ignoreBounds,
    cx,
    verticalSampleStep,
    xBand
  );

  const left = selectMedianBoundary(leftValues);
  const right = selectMedianBoundary(rightValues);
  const bottom = selectMedianBoundary(bottomValues);
  const top = selectMedianBoundary(topValues);

  if (
    left === null ||
    right === null ||
    bottom === null ||
    top === null ||
    right <= left ||
    top <= bottom
  ) {
    return null;
  }

  const bounds = clampBounds({ minX: left, minY: bottom, maxX: right, maxY: top }, pageBounds);
  if (boundsWidth(bounds) < labelWidth * 2 || boundsHeight(bounds) < labelHeight * 2) {
    return null;
  }
  const outline = buildScannedRoomOutline(
    bounds,
    labelBounds,
    strokeIndex,
    pageBounds,
    ignoreBounds,
    xBand,
    yBand
  );
  const hitRatio = (leftValues.length + rightValues.length + bottomValues.length + topValues.length) / (RAY_SAMPLE_OFFSETS.length * 4);
  return {
    bounds: outline?.bounds ?? bounds,
    polygon: outline?.polygon ?? boundsToPolygon(bounds),
    score: 0.42 + Math.min(0.2, hitRatio * 0.24)
  };
}

function buildScannedRoomOutline(
  baseBounds: Bounds,
  labelBounds: Bounds,
  strokeIndex: StrokeIndex,
  pageBounds: Bounds,
  ignoreBounds: Bounds,
  xBand: number,
  yBand: number
): { bounds: Bounds; polygon: RoomPolygonPoint[] } | null {
  const baseHeight = boundsHeight(baseBounds);
  const baseWidth = boundsWidth(baseBounds);
  if (baseWidth <= 0 || baseHeight <= 0) {
    return null;
  }

  const intervals: RoomScanInterval[] = [];
  const anchorX = centerX(labelBounds);
  const stripHeight = baseHeight / ROOM_OUTLINE_SCAN_COUNT;
  const scanBand = Math.max(yBand, stripHeight * 0.24, 1);

  for (let i = 0; i < ROOM_OUTLINE_SCAN_COUNT; i += 1) {
    const minY = baseBounds.minY + stripHeight * i;
    const maxY = i === ROOM_OUTLINE_SCAN_COUNT - 1 ? baseBounds.maxY : baseBounds.minY + stripHeight * (i + 1);
    const sampleY = (minY + maxY) * 0.5;
    const left = findHorizontalBoundaryValueAtY(
      "left",
      strokeIndex,
      baseBounds,
      ignoreBounds,
      anchorX,
      sampleY,
      scanBand
    );
    const right = findHorizontalBoundaryValueAtY(
      "right",
      strokeIndex,
      baseBounds,
      ignoreBounds,
      anchorX,
      sampleY,
      scanBand
    );

    const resolvedLeft = left === null ? baseBounds.minX : clampNumber(left, baseBounds.minX, baseBounds.maxX);
    const resolvedRight = right === null ? baseBounds.maxX : clampNumber(right, baseBounds.minX, baseBounds.maxX);
    if (resolvedRight - resolvedLeft <= Math.max(boundsWidth(labelBounds) * 1.35, 1e-3)) {
      continue;
    }
    intervals.push({
      minY,
      maxY,
      left: resolvedLeft,
      right: resolvedRight
    });
  }

  if (intervals.length < ROOM_OUTLINE_MIN_INTERVALS) {
    return null;
  }

  const polygon = simplifyRoomPolygon(buildStripUnionPolygon(intervals));
  if (polygon.length < 3) {
    return null;
  }
  const bounds = boundsFromPolygon(polygon);
  if (!pointInBounds(centerX(labelBounds), centerY(labelBounds), bounds)) {
    return null;
  }
  return { bounds, polygon };
}

function findHorizontalBoundaryValueAtY(
  direction: "left" | "right",
  strokeIndex: StrokeIndex,
  queryBounds: Bounds,
  ignoreBounds: Bounds,
  anchorX: number,
  sampleY: number,
  band: number
): number | null {
  const candidates = queryStrokeIndex(strokeIndex, {
    minX: queryBounds.minX,
    minY: sampleY - band,
    maxX: queryBounds.maxX,
    maxY: sampleY + band
  });
  let bestValue: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const stroke of candidates) {
    const bounds = stroke.bounds;
    if (boundsIntersect(bounds, ignoreBounds) || !boundsIntersectY(bounds, sampleY - band, sampleY + band)) {
      continue;
    }
    const value = direction === "left" ? bounds.maxX : bounds.minX;
    if (direction === "left" ? value >= anchorX : value <= anchorX) {
      continue;
    }
    const distance = Math.abs(value - anchorX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestValue = value;
    }
  }

  return bestValue;
}

function buildStripUnionPolygon(intervals: RoomScanInterval[]): RoomPolygonPoint[] {
  const points: RoomPolygonPoint[] = [];
  for (const interval of intervals) {
    points.push({ x: interval.left, y: interval.minY });
    points.push({ x: interval.left, y: interval.maxY });
  }
  for (let i = intervals.length - 1; i >= 0; i -= 1) {
    const interval = intervals[i];
    points.push({ x: interval.right, y: interval.maxY });
    points.push({ x: interval.right, y: interval.minY });
  }
  return points;
}

function findHorizontalBoundaryValues(
  direction: "left" | "right",
  strokeIndex: StrokeIndex,
  pageBounds: Bounds,
  labelBounds: Bounds,
  ignoreBounds: Bounds,
  centerYValue: number,
  sampleStep: number,
  band: number
): number[] {
  const values: number[] = [];
  for (const offset of RAY_SAMPLE_OFFSETS) {
    const sampleY = clampNumber(centerYValue + offset * sampleStep, pageBounds.minY, pageBounds.maxY);
    const candidates = queryStrokeIndex(strokeIndex, {
      minX: pageBounds.minX,
      minY: sampleY - band,
      maxX: pageBounds.maxX,
      maxY: sampleY + band
    });
    let bestValue: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const stroke of candidates) {
      const bounds = stroke.bounds;
      if (boundsIntersect(bounds, ignoreBounds) || !boundsIntersectY(bounds, sampleY - band, sampleY + band)) {
        continue;
      }
      const value = direction === "left" ? bounds.maxX : bounds.minX;
      if (direction === "left" ? value >= labelBounds.minX : value <= labelBounds.maxX) {
        continue;
      }
      const distance = Math.abs(value - (direction === "left" ? labelBounds.minX : labelBounds.maxX));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestValue = value;
      }
    }
    if (bestValue !== null) {
      values.push(bestValue);
    }
  }
  return values;
}

function findVerticalBoundaryValues(
  direction: "bottom" | "top",
  strokeIndex: StrokeIndex,
  pageBounds: Bounds,
  labelBounds: Bounds,
  ignoreBounds: Bounds,
  centerXValue: number,
  sampleStep: number,
  band: number
): number[] {
  const values: number[] = [];
  for (const offset of RAY_SAMPLE_OFFSETS) {
    const sampleX = clampNumber(centerXValue + offset * sampleStep, pageBounds.minX, pageBounds.maxX);
    const candidates = queryStrokeIndex(strokeIndex, {
      minX: sampleX - band,
      minY: pageBounds.minY,
      maxX: sampleX + band,
      maxY: pageBounds.maxY
    });
    let bestValue: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const stroke of candidates) {
      const bounds = stroke.bounds;
      if (boundsIntersect(bounds, ignoreBounds) || !boundsIntersectX(bounds, sampleX - band, sampleX + band)) {
        continue;
      }
      const value = direction === "bottom" ? bounds.maxY : bounds.minY;
      if (direction === "bottom" ? value >= labelBounds.minY : value <= labelBounds.maxY) {
        continue;
      }
      const distance = Math.abs(value - (direction === "bottom" ? labelBounds.minY : labelBounds.maxY));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestValue = value;
      }
    }
    if (bestValue !== null) {
      values.push(bestValue);
    }
  }
  return values;
}

function selectMedianBoundary(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.5)];
}

function scoreLabelBox(labelBounds: Bounds, strokeIndex: StrokeIndex, pageBounds: Bounds): number {
  const labelWidth = boundsWidth(labelBounds);
  const labelHeight = boundsHeight(labelBounds);
  const nearBounds = clampBounds(expandBounds(labelBounds, Math.max(labelWidth, labelHeight) * 2 + 2), pageBounds);
  const strokes = queryStrokeIndex(strokeIndex, nearBounds);
  let left = false;
  let right = false;
  let bottom = false;
  let top = false;

  for (const stroke of strokes) {
    const bounds = stroke.bounds;
    const width = boundsWidth(bounds);
    const height = boundsHeight(bounds);
    const horizontal = width >= height * 1.8;
    const vertical = height >= width * 1.8;
    if (horizontal && boundsIntersectX(bounds, labelBounds.minX, labelBounds.maxX)) {
      if (bounds.maxY <= labelBounds.minY) {
        bottom = true;
      }
      if (bounds.minY >= labelBounds.maxY) {
        top = true;
      }
    }
    if (vertical && boundsIntersectY(bounds, labelBounds.minY, labelBounds.maxY)) {
      if (bounds.maxX <= labelBounds.minX) {
        left = true;
      }
      if (bounds.minX >= labelBounds.maxX) {
        right = true;
      }
    }
  }

  const edgeCount = Number(left) + Number(right) + Number(bottom) + Number(top);
  return edgeCount >= 3 ? 0.22 : edgeCount >= 2 ? 0.12 : 0;
}

function buildStrokeIndex(scene: VectorScene): StrokeIndex | null {
  const segmentCount = Math.max(0, Math.min(scene.segmentCount | 0, Math.floor(scene.primitiveBounds.length / 4)));
  if (segmentCount <= 0) {
    return null;
  }

  const sceneBounds = normalizeBounds(scene.pageBounds) ?? normalizeBounds(scene.bounds);
  if (!sceneBounds) {
    return null;
  }

  const pageSpan = Math.max(boundsWidth(sceneBounds), boundsHeight(sceneBounds), 1);
  const widthThreshold = Math.max(0.15, scene.maxHalfWidth * 0.22);
  const labelBoxWidthThreshold = Math.max(0.03, widthThreshold * 0.35);
  const longLineThreshold = pageSpan * 0.035;
  const labelLineThreshold = pageSpan * 0.006;
  const strokes: StrokeCandidate[] = [];

  for (let i = 0; i < segmentCount; i += 1) {
    const offset = i * 4;
    const bounds = readPrimitiveBounds(scene.primitiveBounds, offset);
    if (!bounds || !boundsIntersect(bounds, sceneBounds)) {
      continue;
    }
    const halfWidth = Math.max(0, scene.styles[offset] ?? 0);
    const alpha = decodeStrokeAlpha(scene.primitiveMeta[offset + 3] ?? 1);
    if (alpha <= 0.05) {
      continue;
    }
    const length = readStrokeLength(scene.endpoints, offset, bounds);
    const relevant =
      halfWidth >= widthThreshold ||
      length >= longLineThreshold ||
      (halfWidth >= labelBoxWidthThreshold && length >= labelLineThreshold);
    if (!relevant) {
      continue;
    }
    strokes.push({
      bounds,
      halfWidth,
      length,
      alpha,
      score: halfWidth * 100 + length / pageSpan
    });
  }

  if (strokes.length > MAX_INDEXED_STROKES) {
    strokes.sort((a, b) => b.score - a.score);
    strokes.length = MAX_INDEXED_STROKES;
  }

  const aspect = Math.max(0.1, boundsWidth(sceneBounds) / Math.max(1e-6, boundsHeight(sceneBounds)));
  const targetAxis = clampInt(Math.round(Math.sqrt(Math.max(1, strokes.length) / 10)), MIN_GRID_AXIS_CELLS, MAX_GRID_AXIS_CELLS);
  const columns = clampInt(Math.round(targetAxis * Math.sqrt(aspect)), MIN_GRID_AXIS_CELLS, MAX_GRID_AXIS_CELLS);
  const rows = clampInt(Math.round(targetAxis / Math.sqrt(aspect)), MIN_GRID_AXIS_CELLS, MAX_GRID_AXIS_CELLS);
  const cellWidth = boundsWidth(sceneBounds) / columns || 1;
  const cellHeight = boundsHeight(sceneBounds) / rows || 1;
  const cells = Array.from({ length: columns * rows }, () => [] as number[]);
  const wideIndices: number[] = [];

  for (let i = 0; i < strokes.length; i += 1) {
    const bounds = strokes[i].bounds;
    const x0 = clampInt(Math.floor((bounds.minX - sceneBounds.minX) / cellWidth), 0, columns - 1);
    const x1 = clampInt(Math.floor((bounds.maxX - sceneBounds.minX) / cellWidth), 0, columns - 1);
    const y0 = clampInt(Math.floor((bounds.minY - sceneBounds.minY) / cellHeight), 0, rows - 1);
    const y1 = clampInt(Math.floor((bounds.maxY - sceneBounds.minY) / cellHeight), 0, rows - 1);
    const coveredCells = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (coveredCells > 256) {
      wideIndices.push(i);
      continue;
    }
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        cells[y * columns + x].push(i);
      }
    }
  }

  return {
    bounds: sceneBounds,
    columns,
    rows,
    cellWidth,
    cellHeight,
    cells,
    wideIndices,
    strokes,
    seen: new Uint32Array(strokes.length),
    stamp: 1
  };
}

function queryStrokeIndex(index: StrokeIndex, query: Bounds): StrokeCandidate[] {
  const out: StrokeCandidate[] = [];
  const x0 = clampInt(Math.floor((query.minX - index.bounds.minX) / index.cellWidth), 0, index.columns - 1);
  const x1 = clampInt(Math.floor((query.maxX - index.bounds.minX) / index.cellWidth), 0, index.columns - 1);
  const y0 = clampInt(Math.floor((query.minY - index.bounds.minY) / index.cellHeight), 0, index.rows - 1);
  const y1 = clampInt(Math.floor((query.maxY - index.bounds.minY) / index.cellHeight), 0, index.rows - 1);
  index.stamp = index.stamp === 0xffffffff ? 1 : index.stamp + 1;
  const stamp = index.stamp;

  const add = (strokeIndex: number): void => {
    if (index.seen[strokeIndex] === stamp) {
      return;
    }
    index.seen[strokeIndex] = stamp;
    const stroke = index.strokes[strokeIndex];
    if (boundsIntersect(stroke.bounds, query)) {
      out.push(stroke);
    }
  };

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const cell = index.cells[y * index.columns + x];
      for (const strokeIndex of cell) {
        add(strokeIndex);
      }
    }
  }
  for (const strokeIndex of index.wideIndices) {
    add(strokeIndex);
  }
  return out;
}

function readPageRects(scene: VectorScene): PageRect[] {
  const rects: PageRect[] = [];
  const count = Math.floor(scene.pageRects.length / 4);
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const bounds = normalizeBounds({
      minX: scene.pageRects[offset],
      minY: scene.pageRects[offset + 1],
      maxX: scene.pageRects[offset + 2],
      maxY: scene.pageRects[offset + 3]
    });
    if (bounds) {
      rects.push({ ...bounds, pageIndex: i });
    }
  }
  if (rects.length > 0) {
    return rects;
  }
  const fallback = normalizeBounds(scene.pageBounds) ?? normalizeBounds(scene.bounds) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return [{ ...fallback, pageIndex: 0 }];
}

function resolvePageIndex(item: SceneTextItem, pageRects: PageRect[]): number {
  const requested = Math.max(0, Math.trunc(item.pageIndex));
  if (requested < pageRects.length) {
    return requested;
  }
  const x = centerX(item.bounds);
  const y = centerY(item.bounds);
  for (const page of pageRects) {
    if (x >= page.minX && x <= page.maxX && y >= page.minY && y <= page.maxY) {
      return page.pageIndex;
    }
  }
  return 0;
}

function createFallbackRoom(label: LabelCandidate, pageRects: PageRect[], index: number): DetectedRoom {
  const pageBounds = pageRects[label.pageIndex] ?? pageRects[0];
  const bounds = clampBounds(expandBounds(label.bounds, Math.max(boundsWidth(label.bounds), boundsHeight(label.bounds)) * 8 + 4), pageBounds);
  return {
    id: buildRoomId(label, index),
    label: label.label,
    bounds,
    labelBounds: label.bounds,
    confidence: clamp01(label.score),
    pageIndex: label.pageIndex
  };
}

function mergeOrAppendRoom(rooms: DetectedRoom[], room: DetectedRoom): void {
  for (let i = 0; i < rooms.length; i += 1) {
    const existing = rooms[i];
    if (
      existing.pageIndex === room.pageIndex &&
      existing.label === room.label &&
      distanceSquared(centerX(existing.labelBounds), centerY(existing.labelBounds), centerX(room.labelBounds), centerY(room.labelBounds)) < 16
    ) {
      if (room.confidence > existing.confidence) {
        rooms[i] = room;
      }
      return;
    }
  }
  rooms.push(room);
}

function resolveRoomOverlaps(rooms: DetectedRoom[]): DetectedRoom[] {
  const resolved = rooms.map((room) => normalizeRoomPolygon(room));

  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < resolved.length; i += 1) {
      for (let j = i + 1; j < resolved.length; j += 1) {
        const a = resolved[i];
        const b = resolved[j];
        if (a.pageIndex !== b.pageIndex) {
          continue;
        }
        const overlap = boundsIntersection(a.bounds, b.bounds);
        if (!overlap) {
          continue;
        }
        const overlapArea = boundsArea(overlap);
        const smallerArea = Math.min(boundsArea(a.bounds), boundsArea(b.bounds));
        if (smallerArea <= 0 || overlapArea / smallerArea < 0.18) {
          continue;
        }

        const ax = centerX(a.labelBounds);
        const ay = centerY(a.labelBounds);
        const bx = centerX(b.labelBounds);
        const by = centerY(b.labelBounds);
        const dx = Math.abs(ax - bx);
        const dy = Math.abs(ay - by);
        if (dx < 1e-3 && dy < 1e-3) {
          continue;
        }

        const split = dx >= dy ? (ax + bx) * 0.5 : (ay + by) * 0.5;
        const clippedA = dx >= dy
          ? clipRoomToHorizontalSeparation(a, ax <= bx ? "left" : "right", split)
          : clipRoomToVerticalSeparation(a, ay <= by ? "bottom" : "top", split);
        const clippedB = dx >= dy
          ? clipRoomToHorizontalSeparation(b, bx <= ax ? "left" : "right", split)
          : clipRoomToVerticalSeparation(b, by <= ay ? "bottom" : "top", split);

        if (clippedA) {
          resolved[i] = clippedA;
        }
        if (clippedB) {
          resolved[j] = clippedB;
        }
      }
    }
  }

  return resolved;
}

function normalizeRoomPolygon(room: DetectedRoom): DetectedRoom {
  const polygon = simplifyRoomPolygon(room.polygon && room.polygon.length >= 3 ? room.polygon : boundsToPolygon(room.bounds));
  if (polygon.length < 3) {
    return room;
  }
  return {
    ...room,
    bounds: boundsFromPolygon(polygon),
    polygon
  };
}

function clipRoomToHorizontalSeparation(room: DetectedRoom, side: "left" | "right", splitX: number): DetectedRoom | null {
  const labelMargin = Math.max(boundsWidth(room.labelBounds), boundsHeight(room.labelBounds)) * 0.65 + 1;
  const limit = side === "left"
    ? Math.max(splitX, room.labelBounds.maxX + labelMargin)
    : Math.min(splitX, room.labelBounds.minX - labelMargin);
  const nextBounds = side === "left"
    ? { ...room.bounds, maxX: Math.min(room.bounds.maxX, limit) }
    : { ...room.bounds, minX: Math.max(room.bounds.minX, limit) };
  return clipRoomToBounds(room, nextBounds);
}

function clipRoomToVerticalSeparation(room: DetectedRoom, side: "bottom" | "top", splitY: number): DetectedRoom | null {
  const labelMargin = Math.max(boundsWidth(room.labelBounds), boundsHeight(room.labelBounds)) * 0.65 + 1;
  const limit = side === "bottom"
    ? Math.max(splitY, room.labelBounds.maxY + labelMargin)
    : Math.min(splitY, room.labelBounds.minY - labelMargin);
  const nextBounds = side === "bottom"
    ? { ...room.bounds, maxY: Math.min(room.bounds.maxY, limit) }
    : { ...room.bounds, minY: Math.max(room.bounds.minY, limit) };
  return clipRoomToBounds(room, nextBounds);
}

function clipRoomToBounds(room: DetectedRoom, bounds: Bounds): DetectedRoom | null {
  if (
    bounds.maxX <= bounds.minX ||
    bounds.maxY <= bounds.minY ||
    !boundsContainBounds(bounds, room.labelBounds)
  ) {
    return null;
  }

  const sourcePolygon = room.polygon && room.polygon.length >= 3 ? room.polygon : boundsToPolygon(room.bounds);
  const polygon = simplifyRoomPolygon(clipPolygonToBounds(sourcePolygon, bounds));
  if (polygon.length < 3) {
    return null;
  }
  const clippedBounds = boundsFromPolygon(polygon);
  if (!boundsContainBounds(clippedBounds, room.labelBounds)) {
    return null;
  }
  return {
    ...room,
    bounds: clippedBounds,
    polygon
  };
}

function compareRooms(a: DetectedRoom, b: DetectedRoom): number {
  if (a.pageIndex !== b.pageIndex) {
    return a.pageIndex - b.pageIndex;
  }
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
}

function buildRoomId(label: LabelCandidate, index: number): string {
  const safeLabel = label.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
  return `${label.pageIndex + 1}-${safeLabel}-${Math.round(centerX(label.bounds))}-${Math.round(centerY(label.bounds))}-${index}`;
}

function normalizeRoomLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readPrimitiveBounds(values: Float32Array, offset: number): Bounds | null {
  return normalizeBounds({
    minX: values[offset],
    minY: values[offset + 1],
    maxX: values[offset + 2],
    maxY: values[offset + 3]
  });
}

function readStrokeLength(endpoints: Float32Array, offset: number, bounds: Bounds): number {
  const x0 = endpoints[offset];
  const y0 = endpoints[offset + 1];
  const x1 = endpoints[offset + 2];
  const y1 = endpoints[offset + 3];
  if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1)) {
    return Math.hypot(x1 - x0, y1 - y0);
  }
  return Math.hypot(boundsWidth(bounds), boundsHeight(bounds));
}

function decodeStrokeAlpha(encoded: number): number {
  if (!Number.isFinite(encoded)) {
    return 1;
  }
  const flags = Math.max(0, Math.trunc(encoded / 2 + 1e-6));
  return clamp01(encoded - flags * 2);
}

function normalizeBounds(bounds: Bounds): Bounds | null {
  const minX = Math.min(bounds.minX, bounds.maxX);
  const minY = Math.min(bounds.minY, bounds.maxY);
  const maxX = Math.max(bounds.minX, bounds.maxX);
  const maxY = Math.max(bounds.minY, bounds.maxY);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
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

function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount
  };
}

function clampBounds(bounds: Bounds, outer: Bounds): Bounds {
  return {
    minX: Math.max(outer.minX, Math.min(outer.maxX, bounds.minX)),
    minY: Math.max(outer.minY, Math.min(outer.maxY, bounds.minY)),
    maxX: Math.max(outer.minX, Math.min(outer.maxX, bounds.maxX)),
    maxY: Math.max(outer.minY, Math.min(outer.maxY, bounds.maxY))
  };
}

function boundsToPolygon(bounds: Bounds): RoomPolygonPoint[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY }
  ];
}

function boundsFromPolygon(polygon: RoomPolygonPoint[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function simplifyRoomPolygon(polygon: RoomPolygonPoint[]): RoomPolygonPoint[] {
  const withoutDuplicates: RoomPolygonPoint[] = [];
  for (const point of polygon) {
    const previous = withoutDuplicates[withoutDuplicates.length - 1];
    if (previous && Math.abs(previous.x - point.x) <= 1e-5 && Math.abs(previous.y - point.y) <= 1e-5) {
      continue;
    }
    withoutDuplicates.push(point);
  }

  if (withoutDuplicates.length > 1) {
    const first = withoutDuplicates[0];
    const last = withoutDuplicates[withoutDuplicates.length - 1];
    if (Math.abs(first.x - last.x) <= 1e-5 && Math.abs(first.y - last.y) <= 1e-5) {
      withoutDuplicates.pop();
    }
  }

  if (withoutDuplicates.length < 3) {
    return [];
  }

  const simplified: RoomPolygonPoint[] = [];
  for (let i = 0; i < withoutDuplicates.length; i += 1) {
    const previous = withoutDuplicates[(i + withoutDuplicates.length - 1) % withoutDuplicates.length];
    const current = withoutDuplicates[i];
    const next = withoutDuplicates[(i + 1) % withoutDuplicates.length];
    if (areCollinear(previous, current, next)) {
      continue;
    }
    simplified.push(current);
  }
  return simplified.length >= 3 ? simplified : withoutDuplicates;
}

function clipPolygonToBounds(polygon: RoomPolygonPoint[], bounds: Bounds): RoomPolygonPoint[] {
  let clipped = polygon;
  clipped = clipPolygonAgainstVertical(clipped, bounds.minX, true);
  clipped = clipPolygonAgainstVertical(clipped, bounds.maxX, false);
  clipped = clipPolygonAgainstHorizontal(clipped, bounds.minY, true);
  clipped = clipPolygonAgainstHorizontal(clipped, bounds.maxY, false);
  return clipped;
}

function clipPolygonAgainstVertical(polygon: RoomPolygonPoint[], x: number, keepGreater: boolean): RoomPolygonPoint[] {
  return clipPolygonAgainstEdge(
    polygon,
    (point) => keepGreater ? point.x >= x : point.x <= x,
    (a, b) => {
      const denominator = b.x - a.x;
      const t = Math.abs(denominator) <= 1e-12 ? 0 : (x - a.x) / denominator;
      return { x, y: a.y + (b.y - a.y) * t };
    }
  );
}

function clipPolygonAgainstHorizontal(polygon: RoomPolygonPoint[], y: number, keepGreater: boolean): RoomPolygonPoint[] {
  return clipPolygonAgainstEdge(
    polygon,
    (point) => keepGreater ? point.y >= y : point.y <= y,
    (a, b) => {
      const denominator = b.y - a.y;
      const t = Math.abs(denominator) <= 1e-12 ? 0 : (y - a.y) / denominator;
      return { x: a.x + (b.x - a.x) * t, y };
    }
  );
}

function clipPolygonAgainstEdge(
  polygon: RoomPolygonPoint[],
  isInside: (point: RoomPolygonPoint) => boolean,
  intersect: (a: RoomPolygonPoint, b: RoomPolygonPoint) => RoomPolygonPoint
): RoomPolygonPoint[] {
  if (polygon.length < 3) {
    return [];
  }
  const out: RoomPolygonPoint[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const previous = polygon[(i + polygon.length - 1) % polygon.length];
    const currentInside = isInside(current);
    const previousInside = isInside(previous);
    if (currentInside) {
      if (!previousInside) {
        out.push(intersect(previous, current));
      }
      out.push(current);
    } else if (previousInside) {
      out.push(intersect(previous, current));
    }
  }
  return out;
}

function areCollinear(a: RoomPolygonPoint, b: RoomPolygonPoint, c: RoomPolygonPoint): boolean {
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const span = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y), 1);
  return area / span <= 1e-4;
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function boundsIntersection(a: Bounds, b: Bounds): Bounds | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}

function boundsArea(bounds: Bounds): number {
  return boundsWidth(bounds) * boundsHeight(bounds);
}

function boundsContainBounds(outer: Bounds, inner: Bounds): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}

function pointInBounds(x: number, y: number, bounds: Bounds): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

function boundsIntersectX(bounds: Bounds, minX: number, maxX: number): boolean {
  return bounds.maxX >= minX && bounds.minX <= maxX;
}

function boundsIntersectY(bounds: Bounds, minY: number, maxY: number): boolean {
  return bounds.maxY >= minY && bounds.minY <= maxY;
}

function sameTextLine(a: Bounds, b: Bounds): boolean {
  const overlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return overlap > Math.min(boundsHeight(a), boundsHeight(b)) * 0.35;
}

function boundsWidth(bounds: Bounds): number {
  return Math.max(0, bounds.maxX - bounds.minX);
}

function boundsHeight(bounds: Bounds): number {
  return Math.max(0, bounds.maxY - bounds.minY);
}

function centerX(bounds: Bounds): number {
  return (bounds.minX + bounds.maxX) * 0.5;
}

function centerY(bounds: Bounds): number {
  return (bounds.minY + bounds.maxY) * 0.5;
}

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
