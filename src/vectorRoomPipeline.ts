// Vector-native room detection: the TypeScript half of the pipeline.
//
// Mirrors ml/room-detection/roomdet (vector_dataset.py + vector_faces.py) so the
// ONNX graphs exported from the trained checkpoints see exactly the inputs they
// were trained on. Everything here is pure math over typed arrays - no DOM, no
// onnxruntime - so scripts/verify-vector-rooms.mjs can replay it in Node against
// reference intermediates dumped by the Python pipeline.
//
// Stage map (Python counterpart in parentheses):
//   collectPageSegments        (load_segment_dump)
//   buildPageInputs            (build_page_inputs: features + kNN graph + edge feats)
//   encodePageTiled            (encode_page_chunked; spatial tiles + 5-hop halo keep
//                               the attention memory bounded, outputs stay exact)
//   buildBridgeCandidates      (build_bridge_candidates)
//   buildBridgeFeatures        (build_bridge_features)
//   selectBoundarySegments     (select_boundary_segments: threshold + chain filter)
//   chainFilterSelected        (chain_filter_selected)
//   extractRoomFaces           (extract_rooms: snap-round noding + planar faces +
//                               perimeter-support scoring instead of shapely)
//   faceShapeFeatures          (face_shape_features)
//   pooledFaceEmbedding        (pooled_face_embedding)

export const SEGMENT_FLAG_HAIRLINE = 1 << 0;
export const SEGMENT_FLAG_ROUND_CAP = 1 << 1;
export const SEGMENT_FLAG_CLIPPED = 1 << 2;
export const SEGMENT_FLAG_FILL_OUTLINE = 1 << 3;
export const SEGMENT_FLAG_QUADRATIC = 1 << 4;

export const VECTOR_FEATURE_DIM = 21;
export const VECTOR_EDGE_FEATURE_DIM = 6;
export const VECTOR_BRIDGE_PAIR_DIM = 8;
export const VECTOR_FACE_SHAPE_DIM = 6;

export interface VectorBoundsLike {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Structural subset of VectorScene that segment collection needs; the verify
// script feeds the raw arrays of a segments dump through the same code path.
export interface VectorSegmentSource {
  segmentCount: number;
  endpoints: ArrayLike<number>;
  primitiveMeta: ArrayLike<number>;
  styles: ArrayLike<number>;
  fillPathMetaA: ArrayLike<number>;
  fillPathMetaB: ArrayLike<number>;
  fillPathMetaC: ArrayLike<number>;
  fillSegmentsA: ArrayLike<number>;
  fillSegmentsB: ArrayLike<number>;
}

export interface VectorPageSegments {
  count: number;
  p0x: Float32Array;
  p0y: Float32Array;
  p1x: Float32Array;
  p1y: Float32Array;
  halfWidth: Float32Array;
  colorR: Float32Array;
  colorG: Float32Array;
  colorB: Float32Array;
  alpha: Float32Array;
  flags: Uint8Array;
}

export interface VectorPrepConfig {
  snapTolerancePageFraction: number;
  snapToleranceMinHalfwidths: number;
  weldToleranceFraction: number;
  bridgeRadiusHalfwidths: number;
  bridgeRadiusPageFractionMax: number;
  bridgeMinLengthFraction: number;
}

export interface VectorFaceConfig {
  threshold: number;
  weldToleranceFraction: number;
  minAreaFraction: number;
  maxAreaFraction: number;
  minPerimeterCoverage: number;
  minMeanWidthToleranceFactor: number;
  simplifyFraction: number;
  maxPerimeterSamples: number;
  chainMinLengthTolerances: number;
  chainAngleToleranceDegrees: number;
  chainJoinToleranceFraction: number;
}

export const DEFAULT_VECTOR_PREP_CONFIG: VectorPrepConfig = {
  snapTolerancePageFraction: 0.002,
  snapToleranceMinHalfwidths: 4,
  weldToleranceFraction: 0.25,
  bridgeRadiusHalfwidths: 24,
  bridgeRadiusPageFractionMax: 0.04,
  bridgeMinLengthFraction: 0.1
};

export const DEFAULT_VECTOR_FACE_CONFIG: VectorFaceConfig = {
  threshold: 0.5,
  weldToleranceFraction: 0.25,
  minAreaFraction: 5e-5,
  maxAreaFraction: 0.35,
  minPerimeterCoverage: 0.55,
  minMeanWidthToleranceFactor: 1,
  simplifyFraction: 0.5,
  maxPerimeterSamples: 256,
  chainMinLengthTolerances: 8,
  chainAngleToleranceDegrees: 10,
  chainJoinToleranceFraction: 0.5
};

export interface VectorPageNormalizers {
  centerX: number;
  centerY: number;
  diag: number;
  medianHalfWidth: number;
  medianLength: number;
}

export interface VectorPageInputs {
  features: Float32Array;
  knnIdx: Int32Array;
  edge: Float32Array;
  midX: Float64Array;
  midY: Float64Array;
  normalizers: VectorPageNormalizers;
  k: number;
}

export interface VectorBridgeCandidates {
  segA: Int32Array;
  segB: Int32Array;
  coords: Float32Array; // (C, 4) ax ay bx by
  radius: number;
}

export interface VectorRoomFace {
  polygon: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
  coverage: number;
  meanProbability: number;
  area: number;
  memberSegments: Int32Array;
  classId: number | null;
}

// ---------------------------------------------------------------------------
// Segment collection (load_segment_dump)
// ---------------------------------------------------------------------------

export function collectPageSegments(source: VectorSegmentSource, pageRect?: VectorBoundsLike): VectorPageSegments {
  const strokeCount = Math.floor(source.primitiveMeta.length / 4);
  const fillPathCount = Math.floor(source.fillPathMetaA.length / 4);
  const fillSegCount = fillPathCount > 0 ? Math.floor(source.fillSegmentsA.length / 4) : 0;
  const total = strokeCount + fillSegCount;

  const p0x = new Float32Array(total);
  const p0y = new Float32Array(total);
  const p1x = new Float32Array(total);
  const p1y = new Float32Array(total);
  const halfWidth = new Float32Array(total);
  const colorR = new Float32Array(total);
  const colorG = new Float32Array(total);
  const colorB = new Float32Array(total);
  const alpha = new Float32Array(total);
  const flags = new Uint8Array(total);

  for (let i = 0; i < strokeCount; i += 1) {
    const e = i * 4;
    p0x[i] = source.endpoints[e];
    p0y[i] = source.endpoints[e + 1];
    p1x[i] = source.endpoints[e + 2];
    p1y[i] = source.endpoints[e + 3];
    const styleMeta = source.primitiveMeta[e + 3];
    const rawFlags = Math.floor(styleMeta / 2 + 1e-6);
    alpha[i] = clamp(styleMeta - rawFlags * 2, 0, 1);
    flags[i] = (rawFlags & 0b111) | (source.primitiveMeta[e + 2] >= 0.5 ? SEGMENT_FLAG_QUADRATIC : 0);
    halfWidth[i] = source.styles[e];
    colorR[i] = source.styles[e + 1];
    colorG[i] = source.styles[e + 2];
    colorB[i] = source.styles[e + 3];
  }

  if (fillSegCount > 0) {
    // Fill colors live on the path records; spread them across the path's segments.
    const fillColorR = new Float32Array(fillSegCount);
    const fillColorG = new Float32Array(fillSegCount);
    const fillColorB = new Float32Array(fillSegCount);
    const fillAlpha = new Float32Array(fillSegCount);
    for (let p = 0; p < fillPathCount; p += 1) {
      const start = Math.trunc(source.fillPathMetaA[p * 4]);
      const count = Math.trunc(source.fillPathMetaA[p * 4 + 1]);
      for (let s = start; s < start + count && s < fillSegCount; s += 1) {
        fillColorR[s] = source.fillPathMetaB[p * 4 + 2];
        fillColorG[s] = source.fillPathMetaB[p * 4 + 3];
        fillColorB[s] = source.fillPathMetaC[p * 4 + 2];
        fillAlpha[s] = source.fillPathMetaC[p * 4 + 3];
      }
    }
    for (let s = 0; s < fillSegCount; s += 1) {
      const target = strokeCount + s;
      const a = s * 4;
      const quadratic = source.fillSegmentsB[a + 2] >= 0.5;
      p0x[target] = source.fillSegmentsA[a];
      p0y[target] = source.fillSegmentsA[a + 1];
      p1x[target] = quadratic ? source.fillSegmentsB[a] : source.fillSegmentsA[a + 2];
      p1y[target] = quadratic ? source.fillSegmentsB[a + 1] : source.fillSegmentsA[a + 3];
      halfWidth[target] = 0;
      colorR[target] = fillColorR[s];
      colorG[target] = fillColorG[s];
      colorB[target] = fillColorB[s];
      alpha[target] = fillAlpha[s];
      flags[target] = SEGMENT_FLAG_FILL_OUTLINE | (quadratic ? SEGMENT_FLAG_QUADRATIC : 0);
    }
  }

  const segments: VectorPageSegments = { count: total, p0x, p0y, p1x, p1y, halfWidth, colorR, colorG, colorB, alpha, flags };
  if (!pageRect) {
    return segments;
  }
  return filterSegmentsByRect(segments, pageRect);
}

function filterSegmentsByRect(segments: VectorPageSegments, rect: VectorBoundsLike): VectorPageSegments {
  const minX = Math.min(rect.minX, rect.maxX);
  const maxX = Math.max(rect.minX, rect.maxX);
  const minY = Math.min(rect.minY, rect.maxY);
  const maxY = Math.max(rect.minY, rect.maxY);
  const keep: number[] = [];
  for (let i = 0; i < segments.count; i += 1) {
    const midX = (segments.p0x[i] + segments.p1x[i]) * 0.5;
    const midY = (segments.p0y[i] + segments.p1y[i]) * 0.5;
    if (midX >= minX && midX <= maxX && midY >= minY && midY <= maxY) {
      keep.push(i);
    }
  }
  const count = keep.length;
  const result: VectorPageSegments = {
    count,
    p0x: new Float32Array(count),
    p0y: new Float32Array(count),
    p1x: new Float32Array(count),
    p1y: new Float32Array(count),
    halfWidth: new Float32Array(count),
    colorR: new Float32Array(count),
    colorG: new Float32Array(count),
    colorB: new Float32Array(count),
    alpha: new Float32Array(count),
    flags: new Uint8Array(count)
  };
  for (let j = 0; j < count; j += 1) {
    const i = keep[j];
    result.p0x[j] = segments.p0x[i];
    result.p0y[j] = segments.p0y[i];
    result.p1x[j] = segments.p1x[i];
    result.p1y[j] = segments.p1y[i];
    result.halfWidth[j] = segments.halfWidth[i];
    result.colorR[j] = segments.colorR[i];
    result.colorG[j] = segments.colorG[i];
    result.colorB[j] = segments.colorB[i];
    result.alpha[j] = segments.alpha[i];
    result.flags[j] = segments.flags[i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Normalizers + snap tolerance
// ---------------------------------------------------------------------------

function median(values: Float64Array): number {
  const sorted = values.slice().sort();
  const n = sorted.length;
  if (n === 0) {
    return 0;
  }
  const half = n >> 1;
  return n % 2 === 1 ? sorted[half] : (sorted[half - 1] + sorted[half]) * 0.5;
}

// numpy subtracts the float32 endpoint arrays before casting to float64;
// Math.fround reproduces that rounding so tie-heavy ranks order identically.
function deltaX(segments: VectorPageSegments, i: number): number {
  return Math.fround(segments.p1x[i] - segments.p0x[i]);
}

function deltaY(segments: VectorPageSegments, i: number): number {
  return Math.fround(segments.p1y[i] - segments.p0y[i]);
}

function segmentLengths(segments: VectorPageSegments): Float64Array {
  const lengths = new Float64Array(segments.count);
  for (let i = 0; i < segments.count; i += 1) {
    const dx = deltaX(segments, i);
    const dy = deltaY(segments, i);
    // sqrt(dx^2 + dy^2), not Math.hypot: bit-identical with the Python side.
    lengths[i] = Math.sqrt(dx * dx + dy * dy);
  }
  return lengths;
}

function boundsDiag(bounds: VectorBoundsLike): number {
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 1;
}

export function computePageNormalizers(segments: VectorPageSegments, pageBounds: VectorBoundsLike): VectorPageNormalizers {
  const diag = boundsDiag(pageBounds);
  const strokeWidths: number[] = [];
  for (let i = 0; i < segments.count; i += 1) {
    if ((segments.flags[i] & SEGMENT_FLAG_FILL_OUTLINE) === 0 && segments.halfWidth[i] > 0) {
      strokeWidths.push(segments.halfWidth[i]);
    }
  }
  const lengths = segmentLengths(segments);
  return {
    centerX: (pageBounds.minX + pageBounds.maxX) * 0.5,
    centerY: (pageBounds.minY + pageBounds.maxY) * 0.5,
    diag,
    medianHalfWidth: strokeWidths.length > 0 ? median(Float64Array.from(strokeWidths)) : diag * 1e-4,
    medianLength: lengths.length > 0 ? median(lengths) : diag * 1e-3
  };
}

// snap_tolerance in Python takes the median over *all* stroke half-widths
// (zeros included), unlike the normalizers' positive-only median.
export function computeSnapTolerance(
  segments: VectorPageSegments,
  prep: VectorPrepConfig,
  pageBounds: VectorBoundsLike
): number {
  const strokeWidths: number[] = [];
  for (let i = 0; i < segments.count; i += 1) {
    if ((segments.flags[i] & SEGMENT_FLAG_FILL_OUTLINE) === 0) {
      strokeWidths.push(segments.halfWidth[i]);
    }
  }
  const medianHalfWidth = strokeWidths.length > 0 ? median(Float64Array.from(strokeWidths)) : 0;
  return Math.max(prep.snapTolerancePageFraction * boundsDiag(pageBounds), prep.snapToleranceMinHalfwidths * medianHalfWidth);
}

// ---------------------------------------------------------------------------
// Segment features (build_segment_features)
// ---------------------------------------------------------------------------

function normalizedRanks(values: Float64Array): Float64Array {
  const count = values.length;
  const ranks = new Float64Array(count);
  if (count <= 1) {
    ranks.fill(0.5);
    return ranks;
  }
  const order = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    order[i] = i;
  }
  order.sort((a, b) => values[a] - values[b] || a - b);
  const denom = count - 1;
  for (let position = 0; position < count; position += 1) {
    ranks[order[position]] = position / denom;
  }
  return ranks;
}

export function buildSegmentFeatures(
  segments: VectorPageSegments,
  normalizers: VectorPageNormalizers
): Float32Array {
  const count = segments.count;
  const features = new Float32Array(count * VECTOR_FEATURE_DIM);
  const lengths = segmentLengths(segments);
  const widths = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    widths[i] = segments.halfWidth[i];
  }
  const lengthRank = normalizedRanks(lengths);
  const widthRank = normalizedRanks(widths);
  const diag = normalizers.diag;
  const safeMedianLength = Math.max(normalizers.medianLength, 1e-9);
  const safeMedianWidth = Math.max(normalizers.medianHalfWidth, 1e-9);

  for (let i = 0; i < count; i += 1) {
    const dx = deltaX(segments, i);
    const dy = deltaY(segments, i);
    const length = lengths[i];
    const safeLength = Math.max(length, 1e-9);
    const ux = dx / safeLength;
    const uy = dy / safeLength;
    const midX = Math.fround(segments.p0x[i] + segments.p1x[i]) * 0.5;
    const midY = Math.fround(segments.p0y[i] + segments.p1y[i]) * 0.5;
    const halfWidth = segments.halfWidth[i];
    const flags = segments.flags[i];
    const base = i * VECTOR_FEATURE_DIM;

    features[base] = (midX - normalizers.centerX) / (0.5 * diag);
    features[base + 1] = (midY - normalizers.centerY) / (0.5 * diag);
    features[base + 2] = ux * ux - uy * uy;
    features[base + 3] = 2 * ux * uy;
    features[base + 4] = length / diag;
    features[base + 5] = Math.log1p(length / safeMedianLength);
    features[base + 6] = lengthRank[i];
    features[base + 7] = Math.log1p(halfWidth / safeMedianWidth);
    features[base + 8] = clamp(halfWidth / safeMedianWidth, 0, 16) / 16;
    features[base + 9] = widthRank[i];
    features[base + 10] = segments.colorR[i];
    features[base + 11] = segments.colorG[i];
    features[base + 12] = segments.colorB[i];
    features[base + 13] = segments.alpha[i];
    features[base + 14] = segments.colorR[i] * 0.299 + segments.colorG[i] * 0.587 + segments.colorB[i] * 0.114;
    features[base + 15] = (flags & SEGMENT_FLAG_HAIRLINE) !== 0 ? 1 : 0;
    features[base + 16] = (flags & SEGMENT_FLAG_ROUND_CAP) !== 0 ? 1 : 0;
    features[base + 17] = (flags & SEGMENT_FLAG_CLIPPED) !== 0 ? 1 : 0;
    features[base + 18] = (flags & SEGMENT_FLAG_FILL_OUTLINE) !== 0 ? 1 : 0;
    features[base + 19] = (flags & SEGMENT_FLAG_QUADRATIC) !== 0 ? 1 : 0;
    features[base + 20] = Math.log1p(length / (2 * Math.max(halfWidth, normalizers.medianHalfWidth * 0.25)));
  }
  return features;
}

// ---------------------------------------------------------------------------
// kd-tree kNN over midpoints (build_knn_graph)
// ---------------------------------------------------------------------------

class KdTree2 {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly order: Int32Array;
  private readonly splitAxis: Uint8Array;

  constructor(xs: Float64Array, ys: Float64Array) {
    this.xs = xs;
    this.ys = ys;
    const count = xs.length;
    this.order = new Int32Array(count);
    for (let i = 0; i < count; i += 1) {
      this.order[i] = i;
    }
    this.splitAxis = new Uint8Array(count);
    this.build(0, count, 0);
  }

  private build(start: number, end: number, depth: number): void {
    if (end - start <= 1) {
      return;
    }
    const axis = depth % 2;
    const mid = (start + end) >> 1;
    this.select(start, end, mid, axis);
    this.splitAxis[mid] = axis;
    this.build(start, mid, depth + 1);
    this.build(mid + 1, end, depth + 1);
  }

  // Quickselect the element at target within [start, end) by axis coordinate.
  private select(start: number, end: number, target: number, axis: number): void {
    const coords = axis === 0 ? this.xs : this.ys;
    const order = this.order;
    let lo = start;
    let hi = end - 1;
    while (lo < hi) {
      const pivot = coords[order[(lo + hi) >> 1]];
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (coords[order[i]] < pivot) {
          i += 1;
        }
        while (coords[order[j]] > pivot) {
          j -= 1;
        }
        if (i <= j) {
          const tmp = order[i];
          order[i] = order[j];
          order[j] = tmp;
          i += 1;
          j -= 1;
        }
      }
      if (target <= j) {
        hi = j;
      } else if (target >= i) {
        lo = i;
      } else {
        break;
      }
    }
  }

  // k nearest points to (qx, qy), including an exact self match; results sorted
  // by (squared distance, index) ascending into outIdx/outDist (squared, matching
  // scipy's internal ordering). Returns found count.
  query(qx: number, qy: number, k: number, outIdx: Int32Array, outDist: Float64Array): number {
    const heapIdx = new Int32Array(k);
    const heapDist = new Float64Array(k);
    let heapSize = 0;

    const pushCandidate = (index: number, dist: number): void => {
      if (heapSize < k) {
        let child = heapSize;
        heapIdx[child] = index;
        heapDist[child] = dist;
        heapSize += 1;
        while (child > 0) {
          const parent = (child - 1) >> 1;
          if (heapDist[parent] >= heapDist[child]) {
            break;
          }
          swapHeap(heapIdx, heapDist, parent, child);
          child = parent;
        }
      } else if (dist < heapDist[0]) {
        heapIdx[0] = index;
        heapDist[0] = dist;
        let parent = 0;
        for (;;) {
          const left = parent * 2 + 1;
          const right = left + 1;
          let largest = parent;
          if (left < heapSize && heapDist[left] > heapDist[largest]) {
            largest = left;
          }
          if (right < heapSize && heapDist[right] > heapDist[largest]) {
            largest = right;
          }
          if (largest === parent) {
            break;
          }
          swapHeap(heapIdx, heapDist, parent, largest);
          parent = largest;
        }
      }
    };

    const stack: number[] = [0, this.order.length, 0];
    while (stack.length > 0) {
      const depth = stack.pop() as number;
      const end = stack.pop() as number;
      const start = stack.pop() as number;
      if (end <= start) {
        continue;
      }
      if (end - start <= 8) {
        for (let position = start; position < end; position += 1) {
          const index = this.order[position];
          pushCandidate(index, squaredDistance(this.xs[index] - qx, this.ys[index] - qy));
        }
        continue;
      }
      const mid = (start + end) >> 1;
      const index = this.order[mid];
      pushCandidate(index, squaredDistance(this.xs[index] - qx, this.ys[index] - qy));
      const axis = this.splitAxis[mid];
      const diff = axis === 0 ? qx - this.xs[index] : qy - this.ys[index];
      const nearFirst = diff < 0;
      const worst = heapSize === k ? heapDist[0] : Number.POSITIVE_INFINITY;
      // Push the far side first so the near side is explored first (LIFO).
      if (diff * diff <= worst || heapSize < k) {
        if (nearFirst) {
          stack.push(mid + 1, end, depth + 1);
          stack.push(start, mid, depth + 1);
        } else {
          stack.push(start, mid, depth + 1);
          stack.push(mid + 1, end, depth + 1);
        }
      } else if (nearFirst) {
        stack.push(start, mid, depth + 1);
      } else {
        stack.push(mid + 1, end, depth + 1);
      }
    }

    const found = heapSize;
    const sortable = new Array<number>(found);
    for (let i = 0; i < found; i += 1) {
      sortable[i] = i;
    }
    sortable.sort((a, b) => heapDist[a] - heapDist[b] || heapIdx[a] - heapIdx[b]);
    for (let i = 0; i < found; i += 1) {
      outIdx[i] = heapIdx[sortable[i]];
      outDist[i] = heapDist[sortable[i]];
    }
    return found;
  }
}

function squaredDistance(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

function swapHeap(idx: Int32Array, dist: Float64Array, a: number, b: number): void {
  const ti = idx[a];
  idx[a] = idx[b];
  idx[b] = ti;
  const td = dist[a];
  dist[a] = dist[b];
  dist[b] = td;
}

export function buildKnnGraph(
  midX: Float64Array,
  midY: Float64Array,
  k: number
): { knnIdx: Int32Array; edge: Float32Array; nnDistances: Float64Array } {
  const count = midX.length;
  const knnIdx = new Int32Array(count * k);
  const edge = new Float32Array(count * k * VECTOR_EDGE_FEATURE_DIM);
  const nnDistances = new Float64Array(count);
  if (count <= 1) {
    return { knnIdx, edge, nnDistances };
  }

  const kEffective = Math.min(k, count - 1);
  const tree = new KdTree2(midX, midY);
  const queryK = kEffective + 1;
  const candIdx = new Int32Array(queryK);
  const candDist = new Float64Array(queryK);
  const distances = new Float64Array(count * k);

  for (let i = 0; i < count; i += 1) {
    const found = tree.query(midX[i], midY[i], queryK, candIdx, candDist);
    // Drop the self entry (mirrors scipy's [:, 1:] on a query that includes it).
    let write = 0;
    let selfDropped = false;
    for (let c = 0; c < found && write < kEffective; c += 1) {
      if (!selfDropped && candIdx[c] === i) {
        selfDropped = true;
        continue;
      }
      knnIdx[i * k + write] = candIdx[c];
      distances[i * k + write] = Math.sqrt(candDist[c]); // scipy reports sqrt(sum of squares)
      write += 1;
    }
    while (write < kEffective) {
      // Degenerate duplicate-heavy neighbourhoods: fall back to self.
      knnIdx[i * k + write] = i;
      distances[i * k + write] = 0;
      write += 1;
    }
    for (let pad = kEffective; pad < k; pad += 1) {
      knnIdx[i * k + pad] = knnIdx[i * k + kEffective - 1];
      distances[i * k + pad] = distances[i * k + kEffective - 1];
    }
    nnDistances[i] = distances[i * k];
  }

  const localScale = Math.max(median(nnDistances), 1e-9);
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const neighbor = knnIdx[i * k + j];
      const base = (i * k + j) * VECTOR_EDGE_FEATURE_DIM;
      const relX = (midX[neighbor] - midX[i]) / localScale;
      const relY = (midY[neighbor] - midY[i]) / localScale;
      const relDist = distances[i * k + j] / localScale;
      edge[base] = relX;
      edge[base + 1] = relY;
      edge[base + 2] = relDist;
      edge[base + 3] = Math.log1p(relDist);
    }
  }
  return { knnIdx, edge, nnDistances };
}

export function buildPageInputs(segments: VectorPageSegments, pageBounds: VectorBoundsLike, k: number): VectorPageInputs {
  const count = segments.count;
  const normalizers = computePageNormalizers(segments, pageBounds);
  const features = buildSegmentFeatures(segments, normalizers);
  const midX = new Float64Array(count);
  const midY = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    // Mirrors ((seg_p0 + seg_p1) * 0.5).astype(np.float64): float32 add, exact halve.
    midX[i] = Math.fround(segments.p0x[i] + segments.p1x[i]) * 0.5;
    midY[i] = Math.fround(segments.p0y[i] + segments.p1y[i]) * 0.5;
  }
  const { knnIdx, edge } = buildKnnGraph(midX, midY, k);

  // finish_edge_features: direction-alignment slots.
  for (let i = 0; i < count; i += 1) {
    const uxI = unitX(segments, i);
    const uyI = unitY(segments, i);
    for (let j = 0; j < k; j += 1) {
      const neighbor = knnIdx[i * k + j];
      const uxJ = unitX(segments, neighbor);
      const uyJ = unitY(segments, neighbor);
      const base = (i * k + j) * VECTOR_EDGE_FEATURE_DIM;
      edge[base + 4] = Math.abs(uxI * uxJ + uyI * uyJ);
      edge[base + 5] = Math.abs(uxI * uyJ - uyI * uxJ);
    }
  }
  return { features, knnIdx, edge, midX, midY, normalizers, k };
}

function unitX(segments: VectorPageSegments, i: number): number {
  const dx = deltaX(segments, i);
  const dy = deltaY(segments, i);
  return dx / Math.max(Math.hypot(dx, dy), 1e-9);
}

function unitY(segments: VectorPageSegments, i: number): number {
  const dx = deltaX(segments, i);
  const dy = deltaY(segments, i);
  return dy / Math.max(Math.hypot(dx, dy), 1e-9);
}

// ---------------------------------------------------------------------------
// Tiled encoder inference
// ---------------------------------------------------------------------------

export interface EncodeChunkResult {
  embedding: Float32Array;
  probs: Float32Array;
}

export type EncodeChunkRunner = (
  features: Float32Array,
  knnIdx: Int32Array,
  edge: Float32Array,
  count: number
) => Promise<EncodeChunkResult>;

export interface EncodeTilingOptions {
  layers: number;
  width: number;
  directLimit?: number;
  tileTarget?: number;
  subsetCap?: number;
  onProgress?: (done: number, total: number) => void;
}

// Full-page inference with bounded attention memory. Pages up to directLimit run
// in one call. Larger pages are split into spatially coherent tiles; each tile is
// expanded by its `layers`-hop out-neighbourhood in the kNN graph, which makes the
// tile rows *exact*: a node at hop distance d only becomes inaccurate after
// layer (layers - d + 1), so hop-0 rows are correct through all layers.
export async function encodePageTiled(
  inputs: VectorPageInputs,
  options: EncodeTilingOptions,
  runChunk: EncodeChunkRunner
): Promise<EncodeChunkResult> {
  const count = inputs.midX.length;
  const k = inputs.k;
  const directLimit = options.directLimit ?? 24_576;
  const tileTarget = options.tileTarget ?? 12_288;
  const subsetCap = options.subsetCap ?? 40_960;
  const embedding = new Float32Array(count * options.width);
  const probs = new Float32Array(count);
  if (count === 0) {
    return { embedding, probs };
  }
  if (count <= directLimit) {
    const result = await runChunk(inputs.features, inputs.knnIdx, inputs.edge, count);
    options.onProgress?.(count, count);
    return result;
  }

  // Order segments by spatial cell so consecutive slices form compact tiles.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    minX = Math.min(minX, inputs.midX[i]);
    minY = Math.min(minY, inputs.midY[i]);
    maxX = Math.max(maxX, inputs.midX[i]);
    maxY = Math.max(maxY, inputs.midY[i]);
  }
  const gridSide = Math.max(1, Math.round(Math.sqrt(count / 256)));
  const cellW = Math.max((maxX - minX) / gridSide, 1e-9);
  const cellH = Math.max((maxY - minY) / gridSide, 1e-9);
  const ordered = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    ordered[i] = i;
  }
  const cellOf = (i: number): number => {
    const cx = Math.min(gridSide - 1, Math.floor((inputs.midX[i] - minX) / cellW));
    const cy = Math.min(gridSide - 1, Math.floor((inputs.midY[i] - minY) / cellH));
    // Serpentine row order keeps consecutive cells adjacent.
    return cy * gridSide + (cy % 2 === 0 ? cx : gridSide - 1 - cx);
  };
  ordered.sort((a, b) => cellOf(a) - cellOf(b) || a - b);

  const tiles: Array<[number, number]> = [];
  for (let start = 0; start < count; start += tileTarget) {
    tiles.push([start, Math.min(count, start + tileTarget)]);
  }

  const membership = new Int32Array(count).fill(-1);
  const stamp = new Int32Array(count).fill(-1);
  let done = 0;
  let tileRun = 0;
  const pending = tiles.slice().reverse();
  while (pending.length > 0) {
    const [start, end] = pending.pop() as [number, number];
    const subset: number[] = [];
    const runId = tileRun;
    tileRun += 1;
    for (let position = start; position < end; position += 1) {
      const node = ordered[position];
      stamp[node] = runId;
      subset.push(node);
    }
    const tileSize = subset.length;
    let frontierStart = 0;
    for (let hop = 0; hop < options.layers; hop += 1) {
      const frontierEnd = subset.length;
      for (let position = frontierStart; position < frontierEnd; position += 1) {
        const node = subset[position];
        for (let j = 0; j < k; j += 1) {
          const neighbor = inputs.knnIdx[node * k + j];
          if (stamp[neighbor] !== runId) {
            stamp[neighbor] = runId;
            subset.push(neighbor);
          }
        }
      }
      frontierStart = frontierEnd;
    }
    if (subset.length > subsetCap && end - start > 1024) {
      const mid = (start + end) >> 1;
      pending.push([mid, end], [start, mid]);
      continue;
    }

    const localCount = subset.length;
    const localFeatures = new Float32Array(localCount * VECTOR_FEATURE_DIM);
    const localKnn = new Int32Array(localCount * k);
    const localEdge = new Float32Array(localCount * k * VECTOR_EDGE_FEATURE_DIM);
    for (let local = 0; local < localCount; local += 1) {
      membership[subset[local]] = local;
    }
    for (let local = 0; local < localCount; local += 1) {
      const node = subset[local];
      localFeatures.set(inputs.features.subarray(node * VECTOR_FEATURE_DIM, (node + 1) * VECTOR_FEATURE_DIM), local * VECTOR_FEATURE_DIM);
      localEdge.set(
        inputs.edge.subarray(node * k * VECTOR_EDGE_FEATURE_DIM, (node + 1) * k * VECTOR_EDGE_FEATURE_DIM),
        local * k * VECTOR_EDGE_FEATURE_DIM
      );
      for (let j = 0; j < k; j += 1) {
        const neighbor = inputs.knnIdx[node * k + j];
        const localNeighbor = stamp[neighbor] === runId ? membership[neighbor] : -1;
        // Missing neighbours only occur on the outermost halo ring, whose
        // outputs are never read back; self-reference keeps the graph valid.
        localKnn[local * k + j] = localNeighbor >= 0 ? localNeighbor : local;
      }
    }

    const result = await runChunk(localFeatures, localKnn, localEdge, localCount);
    for (let position = 0; position < tileSize; position += 1) {
      const node = subset[position];
      const local = position;
      embedding.set(result.embedding.subarray(local * options.width, (local + 1) * options.width), node * options.width);
      probs[node] = result.probs[local];
    }
    done += tileSize;
    options.onProgress?.(done, count);
  }
  return { embedding, probs };
}

// ---------------------------------------------------------------------------
// Gap bridge candidates (build_bridge_candidates / build_bridge_features)
// ---------------------------------------------------------------------------

export function buildBridgeCandidates(
  segments: VectorPageSegments,
  boundaryMask: Uint8Array,
  prep: VectorPrepConfig,
  pageBounds: VectorBoundsLike
): VectorBridgeCandidates {
  const indices: number[] = [];
  for (let i = 0; i < segments.count; i += 1) {
    if (boundaryMask[i]) {
      indices.push(i);
    }
  }
  const tolerance = computeSnapTolerance(segments, prep, pageBounds);
  const weldTolerance = Math.max(tolerance * prep.weldToleranceFraction, 1e-6);
  const boundaryWidths = new Float64Array(indices.length);
  for (let j = 0; j < indices.length; j += 1) {
    boundaryWidths[j] = segments.halfWidth[indices[j]];
  }
  const medianHalfWidth = indices.length > 0 ? median(boundaryWidths) : 0;
  const radius = Math.min(
    Math.max(prep.bridgeRadiusHalfwidths * Math.max(medianHalfWidth, 1e-3), tolerance * 4),
    prep.bridgeRadiusPageFractionMax * boundsDiag(pageBounds)
  );

  // Free endpoints: welded node degree 1 among boundary segments.
  const pointCount = indices.length * 2;
  const pointX = new Float64Array(pointCount);
  const pointY = new Float64Array(pointCount);
  const pointSeg = new Int32Array(pointCount);
  for (let j = 0; j < indices.length; j += 1) {
    const i = indices[j];
    pointX[j] = segments.p0x[i];
    pointY[j] = segments.p0y[i];
    pointSeg[j] = i;
    pointX[indices.length + j] = segments.p1x[i];
    pointY[indices.length + j] = segments.p1y[i];
    pointSeg[indices.length + j] = i;
  }
  const nodeCounts = new Map<string, number>();
  const nodeKeys = new Array<string>(pointCount);
  for (let p = 0; p < pointCount; p += 1) {
    const key = `${Math.round(pointX[p] / weldTolerance)},${Math.round(pointY[p] / weldTolerance)}`;
    nodeKeys[p] = key;
    nodeCounts.set(key, (nodeCounts.get(key) ?? 0) + 1);
  }
  const freeX: number[] = [];
  const freeY: number[] = [];
  const freeSeg: number[] = [];
  for (let p = 0; p < pointCount; p += 1) {
    if (nodeCounts.get(nodeKeys[p]) === 1) {
      freeX.push(pointX[p]);
      freeY.push(pointY[p]);
      freeSeg.push(pointSeg[p]);
    }
  }
  if (freeX.length < 2) {
    return { segA: new Int32Array(0), segB: new Int32Array(0), coords: new Float32Array(0), radius };
  }

  // All pairs within the bridge radius via a uniform hash grid.
  const cell = Math.max(radius, 1e-9);
  const buckets = new Map<string, number[]>();
  for (let p = 0; p < freeX.length; p += 1) {
    const key = `${Math.floor(freeX[p] / cell)},${Math.floor(freeY[p] / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(p);
    } else {
      buckets.set(key, [p]);
    }
  }
  const minLength = prep.bridgeMinLengthFraction * tolerance;
  const segA: number[] = [];
  const segB: number[] = [];
  const coords: number[] = [];
  for (let p = 0; p < freeX.length; p += 1) {
    const cx = Math.floor(freeX[p] / cell);
    const cy = Math.floor(freeY[p] / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = buckets.get(`${cx + dx},${cy + dy}`);
        if (!bucket) {
          continue;
        }
        for (const q of bucket) {
          if (q <= p) {
            continue;
          }
          const length = Math.hypot(freeX[q] - freeX[p], freeY[q] - freeY[p]);
          if (length > radius || freeSeg[p] === freeSeg[q] || length < minLength) {
            continue;
          }
          segA.push(freeSeg[p]);
          segB.push(freeSeg[q]);
          coords.push(freeX[p], freeY[p], freeX[q], freeY[q]);
        }
      }
    }
  }
  return {
    segA: Int32Array.from(segA),
    segB: Int32Array.from(segB),
    coords: Float32Array.from(coords),
    radius
  };
}

export function buildBridgeFeatures(
  segments: VectorPageSegments,
  candidates: VectorBridgeCandidates,
  normalizers: VectorPageNormalizers
): Float32Array {
  const count = candidates.segA.length;
  const features = new Float32Array(count * VECTOR_BRIDGE_PAIR_DIM);
  const medianHalfWidth = Math.max(normalizers.medianHalfWidth, 1e-9);
  for (let c = 0; c < count; c += 1) {
    const a = candidates.segA[c];
    const b = candidates.segB[c];
    const deltaX = candidates.coords[c * 4 + 2] - candidates.coords[c * 4];
    const deltaY = candidates.coords[c * 4 + 3] - candidates.coords[c * 4 + 1];
    const length = Math.max(Math.hypot(deltaX, deltaY), 1e-9);
    const bridgeUx = deltaX / length;
    const bridgeUy = deltaY / length;
    const uxA = unitX(segments, a);
    const uyA = unitY(segments, a);
    const uxB = unitX(segments, b);
    const uyB = unitY(segments, b);
    const base = c * VECTOR_BRIDGE_PAIR_DIM;
    features[base] = Math.log1p(length / (2 * medianHalfWidth));
    features[base + 1] = length / normalizers.diag;
    features[base + 2] = clamp(length / (24 * medianHalfWidth), 0, 4);
    features[base + 3] = Math.abs(bridgeUx * uxA + bridgeUy * uyA);
    features[base + 4] = Math.abs(bridgeUx * uxB + bridgeUy * uyB);
    features[base + 5] = Math.abs(uxA * uxB + uyA * uyB);
    features[base + 6] = Math.abs(uxA * uyB - uyA * uxB);
    const hwA = Math.max(segments.halfWidth[a], 1e-9);
    const hwB = Math.max(segments.halfWidth[b], 1e-9);
    features[base + 7] = Math.min(hwA, hwB) / Math.max(hwA, hwB);
  }
  return features;
}

// ---------------------------------------------------------------------------
// Boundary selection (select_boundary_segments / chain_filter_selected)
// ---------------------------------------------------------------------------

// numpy's np.round is half-to-even; Math.round is half-up. Weld node ids must
// agree with weld_endpoints bit for bit or chains split differently at ties.
function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) {
    return floor + 1;
  }
  if (diff < 0.5) {
    return floor;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

// Drop selected segments whose near-collinear chain is shorter than
// minChainLength. Mirrors chain_filter_selected: chains grow across welded
// endpoints through an angle gate, so a wall drawn as many short pieces keeps
// its full run length while equipment/furniture strokes form short chains and
// are removed before they can chord a room into fragments. Corners do not
// chain: an L stays two independently-measured runs.
export function chainFilterSelected(
  segments: VectorPageSegments,
  selected: number[],
  minChainLength: number,
  joinTolerance: number,
  angleToleranceDegrees: number
): number[] {
  const count = selected.length;
  if (count === 0 || minChainLength <= 0) {
    return selected;
  }
  const lengths = new Float64Array(count);
  const ux = new Float64Array(count);
  const uy = new Float64Array(count);
  for (let j = 0; j < count; j += 1) {
    const i = selected[j];
    const dx = segments.p1x[i] - segments.p0x[i];
    const dy = segments.p1y[i] - segments.p0y[i];
    // sqrt(dx^2 + dy^2) for bit-parity with the Python side (not Math.hypot).
    const length = Math.sqrt(dx * dx + dy * dy);
    lengths[j] = length;
    const safeLength = Math.max(length, 1e-12);
    ux[j] = dx / safeLength;
    uy[j] = dy / safeLength;
  }

  const parent = new Int32Array(count);
  for (let j = 0; j < count; j += 1) {
    parent[j] = j;
  }
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };

  const minDot = Math.cos((angleToleranceDegrees * Math.PI) / 180);
  const tol = Math.max(joinTolerance, 1e-9);
  // Insertion order matches Python's enumerate over concat(p0, p1): all first
  // endpoints, then all second endpoints.
  const buckets = new Map<string, number[]>();
  for (let p = 0; p < count * 2; p += 1) {
    const j = p % count;
    const i = selected[j];
    const x = p < count ? segments.p0x[i] : segments.p1x[i];
    const y = p < count ? segments.p0y[i] : segments.p1y[i];
    const key = `${roundHalfToEven(x / tol)},${roundHalfToEven(y / tol)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(j);
    } else {
      buckets.set(key, [j]);
    }
  }
  for (const members of buckets.values()) {
    const unique = Array.from(new Set(members));
    for (let a = 0; a < unique.length; a += 1) {
      for (let b = a + 1; b < unique.length; b += 1) {
        const ja = unique[a];
        const jb = unique[b];
        if (Math.abs(ux[ja] * ux[jb] + uy[ja] * uy[jb]) >= minDot) {
          const rootA = find(ja);
          const rootB = find(jb);
          if (rootA !== rootB) {
            parent[rootB] = rootA;
          }
        }
      }
    }
  }

  const roots = new Int32Array(count);
  for (let j = 0; j < count; j += 1) {
    roots[j] = find(j);
  }
  const chainLength = new Float64Array(count);
  for (let j = 0; j < count; j += 1) {
    chainLength[roots[j]] += lengths[j];
  }
  const kept: number[] = [];
  for (let j = 0; j < count; j += 1) {
    if (chainLength[roots[j]] >= minChainLength) {
      kept.push(selected[j]);
    }
  }
  return kept;
}

// Threshold + chain filter: the boundary selection every downstream stage uses
// (select_boundary_segments).
export function selectBoundarySegments(
  segments: VectorPageSegments,
  probabilities: Float32Array,
  faceConfig: VectorFaceConfig,
  prepConfig: VectorPrepConfig,
  pageBounds: VectorBoundsLike
): number[] {
  const tolerance = computeSnapTolerance(segments, prepConfig, pageBounds);
  let selected: number[] = [];
  for (let i = 0; i < segments.count; i += 1) {
    if (probabilities[i] >= faceConfig.threshold) {
      selected.push(i);
    }
  }
  if (faceConfig.chainMinLengthTolerances > 0 && selected.length > 0) {
    selected = chainFilterSelected(
      segments,
      selected,
      faceConfig.chainMinLengthTolerances * tolerance,
      faceConfig.chainJoinToleranceFraction * tolerance,
      faceConfig.chainAngleToleranceDegrees
    );
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Polygonization: snap-round noding + planar faces (vector_faces.py sans shapely)
// ---------------------------------------------------------------------------

export interface ExtractRoomFacesOptions {
  faceConfig: VectorFaceConfig;
  prepConfig: VectorPrepConfig;
  pageBounds: VectorBoundsLike;
  bridgeCoords?: Float32Array | null; // (B, 4)
}

export function extractRoomFaces(
  segments: VectorPageSegments,
  probabilities: Float32Array,
  options: ExtractRoomFacesOptions
): VectorRoomFace[] {
  const { faceConfig, prepConfig, pageBounds } = options;
  const tolerance = computeSnapTolerance(segments, prepConfig, pageBounds);
  const weldTolerance = tolerance * faceConfig.weldToleranceFraction;

  const selected = selectBoundarySegments(segments, probabilities, faceConfig, prepConfig, pageBounds);
  if (selected.length === 0) {
    return [];
  }

  const lines: number[] = [];
  for (const i of selected) {
    lines.push(segments.p0x[i], segments.p0y[i], segments.p1x[i], segments.p1y[i]);
  }
  if (options.bridgeCoords) {
    for (let b = 0; b < options.bridgeCoords.length; b += 1) {
      lines.push(options.bridgeCoords[b]);
    }
  }

  const faces = polygonizeLines(lines, weldTolerance);
  if (faces.length === 0) {
    return [];
  }
  return scoreFaces(faces, segments, probabilities, selected, tolerance, pageBounds, faceConfig);
}

interface ArrangementFace {
  exterior: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
  shellArea: number;
  area: number; // shell minus holes
}

// Snap-round noding + planar-arrangement face extraction. Equivalent (up to
// snap-rounding details) to shapely's set_precision -> unary_union -> polygonize.
// Work happens on the integer grid (coordinates divided by the weld tolerance).
function polygonizeLines(lines: number[], weldTolerance: number): ArrangementFace[] {
  const grid = Math.max(weldTolerance, 1e-12);
  const lineCount = lines.length / 4;

  // 1. Quantize endpoints; drop degenerates.
  const rawAx = new Float64Array(lineCount);
  const rawAy = new Float64Array(lineCount);
  const rawBx = new Float64Array(lineCount);
  const rawBy = new Float64Array(lineCount);
  let rawCount = 0;
  for (let l = 0; l < lineCount; l += 1) {
    const ax = Math.round(lines[l * 4] / grid);
    const ay = Math.round(lines[l * 4 + 1] / grid);
    const bx = Math.round(lines[l * 4 + 2] / grid);
    const by = Math.round(lines[l * 4 + 3] / grid);
    if (ax === bx && ay === by) {
      continue;
    }
    rawAx[rawCount] = ax;
    rawAy[rawCount] = ay;
    rawBx[rawCount] = bx;
    rawBy[rawCount] = by;
    rawCount += 1;
  }
  if (rawCount === 0) {
    return [];
  }

  // 2. Hot pixels: all endpoints plus all pairwise intersection points.
  const hotKeys = new Map<string, number>();
  const hotX: number[] = [];
  const hotY: number[] = [];
  const addHot = (x: number, y: number): void => {
    const key = `${x},${y}`;
    if (!hotKeys.has(key)) {
      hotKeys.set(key, hotX.length);
      hotX.push(x);
      hotY.push(y);
    }
  };
  for (let l = 0; l < rawCount; l += 1) {
    addHot(rawAx[l], rawAy[l]);
    addHot(rawBx[l], rawBy[l]);
  }

  // Candidate pairs via corridor cells (Amanatides-Woo on a coarse grid). The
  // cell size adapts to density so buckets stay small on huge pages. Pairs
  // sharing several cells are simply tested more than once: addHot is
  // idempotent, so no pair-dedup set is needed (a global Set would overflow
  // V8's 2^24-entry cap on dense drawings).
  let bboxMinX = Number.POSITIVE_INFINITY;
  let bboxMinY = Number.POSITIVE_INFINITY;
  let bboxMaxX = Number.NEGATIVE_INFINITY;
  let bboxMaxY = Number.NEGATIVE_INFINITY;
  for (let l = 0; l < rawCount; l += 1) {
    bboxMinX = Math.min(bboxMinX, rawAx[l], rawBx[l]);
    bboxMinY = Math.min(bboxMinY, rawAy[l], rawBy[l]);
    bboxMaxX = Math.max(bboxMaxX, rawAx[l], rawBx[l]);
    bboxMaxY = Math.max(bboxMaxY, rawAy[l], rawBy[l]);
  }
  const bboxArea = Math.max(bboxMaxX - bboxMinX, 1) * Math.max(bboxMaxY - bboxMinY, 1);
  const cellSize = Math.trunc(clamp(Math.ceil(Math.sqrt(bboxArea / rawCount)), 16, 4096));
  const lineBuckets = new Map<string, number[]>();
  for (let l = 0; l < rawCount; l += 1) {
    for (const key of corridorCells(rawAx[l], rawAy[l], rawBx[l], rawBy[l], cellSize)) {
      const bucket = lineBuckets.get(key);
      if (bucket) {
        bucket.push(l);
      } else {
        lineBuckets.set(key, [l]);
      }
    }
  }
  for (const bucket of lineBuckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        const point = properIntersection(
          rawAx[a], rawAy[a], rawBx[a], rawBy[a],
          rawAx[b], rawAy[b], rawBx[b], rawBy[b]
        );
        if (point) {
          addHot(Math.round(point[0]), Math.round(point[1]));
        }
      }
    }
  }

  // 3. Split every line at hot pixels within half a grid unit of it.
  const hotBuckets = new Map<string, number[]>();
  for (let h = 0; h < hotX.length; h += 1) {
    const key = `${Math.floor(hotX[h] / cellSize)},${Math.floor(hotY[h] / cellSize)}`;
    const bucket = hotBuckets.get(key);
    if (bucket) {
      bucket.push(h);
    } else {
      hotBuckets.set(key, [h]);
    }
  }
  const nodeIds = new Map<string, number>();
  const nodeX: number[] = [];
  const nodeY: number[] = [];
  const nodeOf = (x: number, y: number): number => {
    const key = `${x},${y}`;
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = nodeX.length;
      nodeIds.set(key, id);
      nodeX.push(x);
      nodeY.push(y);
    }
    return id;
  };
  const edgeKeys = new Set<string>();
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const addEdge = (a: number, b: number): void => {
    if (a === b) {
      return;
    }
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edgeA.push(a);
    edgeB.push(b);
  };

  const cuts: Array<{ t: number; x: number; y: number }> = [];
  for (let l = 0; l < rawCount; l += 1) {
    const ax = rawAx[l];
    const ay = rawAy[l];
    const bx = rawBx[l];
    const by = rawBy[l];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    cuts.length = 0;
    cuts.push({ t: 0, x: ax, y: ay }, { t: 1, x: bx, y: by });
    const visited = new Set<string>();
    for (const cellKey of corridorCells(ax, ay, bx, by, cellSize)) {
      const [cellX, cellY] = cellKey.split(",").map(Number);
      for (let ring = -1; ring <= 1; ring += 1) {
        for (let ring2 = -1; ring2 <= 1; ring2 += 1) {
          const neighborKey = `${cellX + ring},${cellY + ring2}`;
          if (visited.has(neighborKey)) {
            continue;
          }
          visited.add(neighborKey);
          const bucket = hotBuckets.get(neighborKey);
          if (!bucket) {
            continue;
          }
          for (const h of bucket) {
            const px = hotX[h];
            const py = hotY[h];
            if ((px === ax && py === ay) || (px === bx && py === by)) {
              continue;
            }
            const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
            const qx = ax + t * dx;
            const qy = ay + t * dy;
            if (Math.hypot(px - qx, py - qy) <= 0.5) {
              cuts.push({ t, x: px, y: py });
            }
          }
        }
      }
    }
    cuts.sort((c1, c2) => c1.t - c2.t);
    let previous = nodeOf(cuts[0].x, cuts[0].y);
    for (let c = 1; c < cuts.length; c += 1) {
      const node = nodeOf(cuts[c].x, cuts[c].y);
      if (node !== previous) {
        addEdge(previous, node);
        previous = node;
      }
    }
  }

  return buildArrangementFaces(nodeX, nodeY, edgeA, edgeB, grid);
}

function* corridorCells(ax: number, ay: number, bx: number, by: number, cell: number): Generator<string> {
  // Amanatides-Woo traversal (mirrors roomdet's _segment_cells).
  const x0 = ax / cell;
  const y0 = ay / cell;
  const x1 = bx / cell;
  const y1 = by / cell;
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const endCx = Math.floor(x1);
  const endCy = Math.floor(y1);
  yield `${cx},${cy}`;
  if (cx === endCx && cy === endCy) {
    return;
  }
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  let tMaxX = dx !== 0 ? ((cx + (stepX > 0 ? 1 : 0)) - x0) / dx : Number.POSITIVE_INFINITY;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
  let tMaxY = dy !== 0 ? ((cy + (stepY > 0 ? 1 : 0)) - y0) / dy : Number.POSITIVE_INFINITY;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Number.POSITIVE_INFINITY;
  const maxSteps = Math.abs(endCx - cx) + Math.abs(endCy - cy) + 4;
  for (let step = 0; step < maxSteps; step += 1) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    yield `${cx},${cy}`;
    if (cx === endCx && cy === endCy) {
      return;
    }
  }
}

// Interior crossing point of two segments (excludes shared endpoints; includes
// T-junctions where an endpoint of one lies inside the other, which resolves to
// the endpoint itself and is already a hot pixel - so only proper crossings
// need a new point).
function properIntersection(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): [number, number] | null {
  const r1x = bx - ax;
  const r1y = by - ay;
  const r2x = dx - cx;
  const r2y = dy - cy;
  const denom = r1x * r2y - r1y * r2x;
  if (denom === 0) {
    return null; // parallel/collinear: overlaps resolve through endpoint hot pixels
  }
  const t = ((cx - ax) * r2y - (cy - ay) * r2x) / denom;
  const u = ((cx - ax) * r1y - (cy - ay) * r1x) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) {
    return null;
  }
  return [ax + t * r1x, ay + t * r1y];
}

function buildArrangementFaces(
  nodeX: number[],
  nodeY: number[],
  edgeAIn: number[],
  edgeBIn: number[],
  grid: number
): ArrangementFace[] {
  const nodeCount = nodeX.length;
  let edgeA = edgeAIn.slice();
  let edgeB = edgeBIn.slice();

  // Iteratively delete dangles (degree-1 chains), then cut edges (graph bridges):
  // exactly what GEOS's polygonizer removes before building edge rings.
  const alive = pruneDangles(nodeCount, edgeA, edgeB);
  const bridgeFree = removeCutEdges(nodeCount, edgeA, edgeB, alive);
  const finalA: number[] = [];
  const finalB: number[] = [];
  for (let e = 0; e < edgeA.length; e += 1) {
    if (bridgeFree[e]) {
      finalA.push(edgeA[e]);
      finalB.push(edgeB[e]);
    }
  }
  edgeA = finalA;
  edgeB = finalB;
  if (edgeA.length === 0) {
    return [];
  }

  // Half-edge structure: 2 directed edges per undirected edge.
  const halfCount = edgeA.length * 2;
  const halfFrom = new Int32Array(halfCount);
  const halfTo = new Int32Array(halfCount);
  for (let e = 0; e < edgeA.length; e += 1) {
    halfFrom[e * 2] = edgeA[e];
    halfTo[e * 2] = edgeB[e];
    halfFrom[e * 2 + 1] = edgeB[e];
    halfTo[e * 2 + 1] = edgeA[e];
  }
  const outgoing = new Map<number, number[]>();
  for (let h = 0; h < halfCount; h += 1) {
    const list = outgoing.get(halfFrom[h]);
    if (list) {
      list.push(h);
    } else {
      outgoing.set(halfFrom[h], [h]);
    }
  }
  for (const list of outgoing.values()) {
    list.sort((h1, h2) => angleOfHalf(h1) - angleOfHalf(h2));
  }

  function angleOfHalf(h: number): number {
    return Math.atan2(nodeY[halfTo[h]] - nodeY[halfFrom[h]], nodeX[halfTo[h]] - nodeX[halfFrom[h]]);
  }

  // next(h): at h's target, take the CCW-predecessor of h's reversal. This keeps
  // the face on the left, so bounded faces trace counterclockwise (area > 0).
  const nextHalf = new Int32Array(halfCount);
  for (let h = 0; h < halfCount; h += 1) {
    const twin = h ^ 1;
    const list = outgoing.get(halfTo[h]) as number[];
    const position = list.indexOf(twin);
    nextHalf[h] = list[(position - 1 + list.length) % list.length];
  }

  interface Walk {
    nodes: number[];
    area: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  const visited = new Uint8Array(halfCount);
  const walks: Walk[] = [];
  for (let h0 = 0; h0 < halfCount; h0 += 1) {
    if (visited[h0]) {
      continue;
    }
    const nodes: number[] = [];
    let area = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let h = h0;
    do {
      visited[h] = 1;
      const from = halfFrom[h];
      const to = halfTo[h];
      nodes.push(from);
      area += nodeX[from] * nodeY[to] - nodeX[to] * nodeY[from];
      minX = Math.min(minX, nodeX[from]);
      minY = Math.min(minY, nodeY[from]);
      maxX = Math.max(maxX, nodeX[from]);
      maxY = Math.max(maxY, nodeY[from]);
      h = nextHalf[h];
    } while (h !== h0);
    walks.push({ nodes, area: area * 0.5, minX, minY, maxX, maxY });
  }

  const shells = walks.filter((walk) => walk.area > 1e-9);
  const holes = walks.filter((walk) => walk.area < -1e-9);
  const toRealRing = (walk: Walk): Array<[number, number]> =>
    walk.nodes.map((node) => [nodeX[node] * grid, nodeY[node] * grid] as [number, number]);

  const faces: ArrangementFace[] = shells.map((walk) => ({
    exterior: toRealRing(walk),
    holes: [],
    shellArea: walk.area * grid * grid,
    area: walk.area * grid * grid
  }));

  // Assign holes to the smallest shell that strictly contains them; the outer
  // boundary of the unbounded face has no such shell and is dropped.
  for (const hole of holes) {
    let bestIndex = -1;
    let bestArea = Number.POSITIVE_INFINITY;
    for (let s = 0; s < shells.length; s += 1) {
      const shell = shells[s];
      const strictly =
        shell.minX <= hole.minX && shell.minY <= hole.minY && shell.maxX >= hole.maxX && shell.maxY >= hole.maxY &&
        !(shell.minX === hole.minX && shell.minY === hole.minY && shell.maxX === hole.maxX && shell.maxY === hole.maxY);
      if (!strictly || shell.area < -hole.area || shell.area >= bestArea) {
        continue;
      }
      const testNode = hole.nodes[0];
      if (pointInRing(nodeX[testNode], nodeY[testNode], shell.nodes, nodeX, nodeY)) {
        bestIndex = s;
        bestArea = shell.area;
      }
    }
    if (bestIndex >= 0) {
      faces[bestIndex].holes.push(toRealRing(hole));
      faces[bestIndex].area += hole.area * grid * grid; // hole.area is negative
    }
  }
  return faces;
}

function pruneDangles(nodeCount: number, edgeA: number[], edgeB: number[]): Uint8Array {
  const alive = new Uint8Array(edgeA.length).fill(1);
  const degree = new Int32Array(nodeCount);
  const incident = new Map<number, number[]>();
  for (let e = 0; e < edgeA.length; e += 1) {
    degree[edgeA[e]] += 1;
    degree[edgeB[e]] += 1;
    pushMapList(incident, edgeA[e], e);
    pushMapList(incident, edgeB[e], e);
  }
  const queue: number[] = [];
  for (let n = 0; n < nodeCount; n += 1) {
    if (degree[n] === 1) {
      queue.push(n);
    }
  }
  while (queue.length > 0) {
    const node = queue.pop() as number;
    if (degree[node] !== 1) {
      continue;
    }
    for (const e of incident.get(node) ?? []) {
      if (!alive[e]) {
        continue;
      }
      alive[e] = 0;
      const other = edgeA[e] === node ? edgeB[e] : edgeA[e];
      degree[node] -= 1;
      degree[other] -= 1;
      if (degree[other] === 1) {
        queue.push(other);
      }
      break;
    }
  }
  // Compact in place.
  let write = 0;
  const keptAlive = new Uint8Array(edgeA.length);
  for (let e = 0; e < edgeA.length; e += 1) {
    if (alive[e]) {
      edgeA[write] = edgeA[e];
      edgeB[write] = edgeB[e];
      keptAlive[write] = 1;
      write += 1;
    }
  }
  edgeA.length = write;
  edgeB.length = write;
  return keptAlive.subarray(0, write) as Uint8Array;
}

// Tarjan bridge finding: cut edges lie on no cycle and would corrupt face walks.
function removeCutEdges(nodeCount: number, edgeA: number[], edgeB: number[], alive: Uint8Array): Uint8Array {
  const keep = new Uint8Array(edgeA.length).fill(1);
  const adjacency = new Map<number, Array<[number, number]>>(); // node -> [neighbor, edge]
  for (let e = 0; e < edgeA.length; e += 1) {
    if (!alive[e]) {
      keep[e] = 0;
      continue;
    }
    pushMapList(adjacency, edgeA[e], [edgeB[e], e] as [number, number]);
    pushMapList(adjacency, edgeB[e], [edgeA[e], e] as [number, number]);
  }
  const discovery = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  let timer = 0;
  for (const root of adjacency.keys()) {
    if (discovery[root] !== -1) {
      continue;
    }
    // Iterative DFS with parent-edge tracking.
    const stack: Array<[number, number, number]> = [[root, -1, 0]]; // node, parentEdge, childCursor
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const [node, parentEdge] = frame;
      if (frame[2] === 0) {
        discovery[node] = low[node] = timer;
        timer += 1;
      }
      const neighbors = adjacency.get(node) ?? [];
      let descended = false;
      while (frame[2] < neighbors.length) {
        const [neighbor, edge] = neighbors[frame[2]];
        frame[2] += 1;
        if (edge === parentEdge) {
          continue;
        }
        if (discovery[neighbor] === -1) {
          stack.push([neighbor, edge, 0]);
          descended = true;
          break;
        }
        low[node] = Math.min(low[node], discovery[neighbor]);
      }
      if (descended) {
        continue;
      }
      stack.pop();
      if (stack.length > 0) {
        const parentNode = stack[stack.length - 1][0];
        low[parentNode] = Math.min(low[parentNode], low[node]);
        if (low[node] > discovery[parentNode]) {
          keep[parentEdge] = 0; // bridge
        }
      }
    }
  }
  return keep;
}

function pushMapList<T>(map: Map<number, T[]>, key: number, value: T): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pointInRing(px: number, py: number, ring: number[], nodeX: number[], nodeY: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = nodeX[ring[i]];
    const yi = nodeY[ring[i]];
    const xj = nodeX[ring[j]];
    const yj = nodeY[ring[j]];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Face scoring (score_faces)
// ---------------------------------------------------------------------------

function scoreFaces(
  faces: ArrangementFace[],
  segments: VectorPageSegments,
  probabilities: Float32Array,
  selected: number[],
  tolerance: number,
  pageBounds: VectorBoundsLike,
  config: VectorFaceConfig
): VectorRoomFace[] {
  const pageArea = Math.max(
    (pageBounds.maxX - pageBounds.minX) * (pageBounds.maxY - pageBounds.minY),
    1e-9
  );
  const nearest = new SegmentNearestGrid(segments, selected, tolerance * 2);

  const accepted: VectorRoomFace[] = [];
  for (const face of faces) {
    const area = face.area;
    if (area < config.minAreaFraction * pageArea || area > config.maxAreaFraction * pageArea) {
      continue;
    }
    const exterior = face.exterior;
    const perimeter = ringLength(exterior);
    if ((2 * area) / Math.max(perimeter, 1e-9) < config.minMeanWidthToleranceFactor * tolerance) {
      continue;
    }
    const sampleCount = Math.trunc(
      Math.min(config.maxPerimeterSamples, Math.max(8, Math.ceil(perimeter / Math.max(tolerance, 1e-9))))
    );
    let supported = 0;
    let supportProbSum = 0;
    const supporting = new Set<number>();
    const cumulative = ringCumulativeLengths(exterior);
    for (let step = 0; step < sampleCount; step += 1) {
      const [px, py] = ringInterpolate(exterior, cumulative, ((step + 0.5) / sampleCount) * perimeter);
      const hit = nearest.nearestWithin(px, py, tolerance);
      if (hit >= 0) {
        supported += 1;
        supporting.add(hit);
        supportProbSum += probabilities[selected[hit]];
      }
    }
    const coverage = supported / sampleCount;
    if (coverage < config.minPerimeterCoverage) {
      continue;
    }

    const simplifyTolerance = config.simplifyFraction * tolerance;
    const simplifiedExterior = simplifyRing(exterior, simplifyTolerance);
    const simplifiedHoles = face.holes
      .map((hole) => simplifyRing(hole, simplifyTolerance))
      .filter((hole) => hole.length >= 3);
    const members = Array.from(supporting, (localIndex) => selected[localIndex]).sort((a, b) => a - b);
    accepted.push({
      polygon: simplifiedExterior,
      holes: simplifiedHoles,
      coverage,
      meanProbability: supportProbSum / Math.max(1, supported),
      area,
      memberSegments: Int32Array.from(members),
      classId: null
    });
  }
  return accepted;
}

// Uniform hash grid over the selected segments; nearestWithin returns the local
// (selected-list) index of the nearest segment within `radius`, or -1. The cell
// size (2 * tolerance) guarantees one bucket ring covers a `tolerance` radius.
class SegmentNearestGrid {
  private readonly buckets = new Map<string, number[]>();
  private readonly cell: number;
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;

  constructor(segments: VectorPageSegments, selected: number[], cell: number) {
    this.cell = Math.max(cell, 1e-9);
    const count = selected.length;
    this.ax = new Float64Array(count);
    this.ay = new Float64Array(count);
    this.bx = new Float64Array(count);
    this.by = new Float64Array(count);
    for (let j = 0; j < count; j += 1) {
      const i = selected[j];
      this.ax[j] = segments.p0x[i];
      this.ay[j] = segments.p0y[i];
      this.bx[j] = segments.p1x[i];
      this.by[j] = segments.p1y[i];
      for (const key of corridorCells(
        this.ax[j] / this.cell, this.ay[j] / this.cell,
        this.bx[j] / this.cell, this.by[j] / this.cell,
        1
      )) {
        const bucket = this.buckets.get(key);
        if (bucket) {
          bucket.push(j);
        } else {
          this.buckets.set(key, [j]);
        }
      }
    }
  }

  nearestWithin(px: number, py: number, radius: number): number {
    const cx = Math.floor(px / this.cell);
    const cy = Math.floor(py / this.cell);
    let best = -1;
    let bestDistance = radius;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = this.buckets.get(`${cx + dx},${cy + dy}`);
        if (!bucket) {
          continue;
        }
        for (const j of bucket) {
          const distance = pointSegmentDistance(px, py, this.ax[j], this.ay[j], this.bx[j], this.by[j]);
          if (distance <= bestDistance) {
            if (distance < bestDistance || best === -1 || j < best) {
              best = j;
            }
            bestDistance = distance;
          }
        }
      }
    }
    return best;
  }
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-18) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function ringLength(ring: Array<[number, number]>): number {
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const next = ring[(i + 1) % ring.length];
    total += Math.hypot(next[0] - ring[i][0], next[1] - ring[i][1]);
  }
  return total;
}

function ringCumulativeLengths(ring: Array<[number, number]>): Float64Array {
  const cumulative = new Float64Array(ring.length + 1);
  for (let i = 0; i < ring.length; i += 1) {
    const next = ring[(i + 1) % ring.length];
    cumulative[i + 1] = cumulative[i] + Math.hypot(next[0] - ring[i][0], next[1] - ring[i][1]);
  }
  return cumulative;
}

function ringInterpolate(
  ring: Array<[number, number]>,
  cumulative: Float64Array,
  distance: number
): [number, number] {
  const total = cumulative[cumulative.length - 1];
  let target = clamp(distance, 0, total);
  let lo = 0;
  let hi = ring.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid + 1] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const segStart = ring[lo];
  const segEnd = ring[(lo + 1) % ring.length];
  const segLen = cumulative[lo + 1] - cumulative[lo];
  const t = segLen > 0 ? (target - cumulative[lo]) / segLen : 0;
  return [segStart[0] + (segEnd[0] - segStart[0]) * t, segStart[1] + (segEnd[1] - segStart[1]) * t];
}

// Douglas-Peucker on a closed ring: split at the vertex farthest from vertex 0,
// simplify both halves. Falls back to the original ring if it would collapse.
function simplifyRing(ring: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (ring.length <= 4 || tolerance <= 0) {
    return ring.slice();
  }
  let farIndex = 1;
  let farDistance = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const distance = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (distance > farDistance) {
      farDistance = distance;
      farIndex = i;
    }
  }
  const first = douglasPeucker(ring.slice(0, farIndex + 1), tolerance);
  const second = douglasPeucker([...ring.slice(farIndex), ring[0]], tolerance);
  const result = [...first.slice(0, -1), ...second.slice(0, -1)];
  return result.length >= 3 ? result : ring.slice();
}

function douglasPeucker(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 2) {
    return points.slice();
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = start + 1; i < end; i += 1) {
      const distance = pointSegmentDistance(
        points[i][0], points[i][1],
        points[start][0], points[start][1],
        points[end][0], points[end][1]
      );
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([start, worst], [worst, end]);
    }
  }
  const result: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) {
      result.push(points[i]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Room-type head inputs (face_shape_features / pooled_face_embedding)
// ---------------------------------------------------------------------------

export function faceShapeFeatures(polygon: Array<[number, number]>, pageBounds: VectorBoundsLike): Float32Array {
  const diag = Math.max(boundsDiag(pageBounds), 1e-9);
  const pageArea = Math.max((pageBounds.maxX - pageBounds.minX) * (pageBounds.maxY - pageBounds.minY), 1e-9);
  let area2 = 0;
  let perimeter = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x, y] = polygon[i];
    const [nx, ny] = polygon[(i + 1) % polygon.length];
    area2 += x * ny - nx * y;
    perimeter += Math.hypot(nx - x, ny - y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const area = Math.abs(area2) * 0.5;
  const width = maxX - minX || 1e-9;
  const height = maxY - minY || 1e-9;
  return Float32Array.from([
    Math.sqrt(Math.max(area, 0)) / diag,
    Math.log1p((area / pageArea) * 100),
    Math.min(width, height) / Math.max(width, height),
    (4 * Math.PI * area) / Math.max(perimeter * perimeter, 1e-9),
    Math.min(polygon.length, 64) / 64,
    perimeter / diag
  ]);
}

export function pooledFaceEmbedding(embedding: Float32Array, width: number, memberSegments: Int32Array): Float32Array {
  const pooled = new Float32Array(width);
  if (memberSegments.length === 0) {
    return pooled;
  }
  for (const segment of memberSegments) {
    const base = segment * width;
    for (let c = 0; c < width; c += 1) {
      pooled[c] += embedding[base + c];
    }
  }
  for (let c = 0; c < width; c += 1) {
    pooled[c] /= memberSegments.length;
  }
  return pooled;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
