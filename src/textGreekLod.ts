import type { Bounds, VectorScene } from "./pdfVectorExtractor";

/** Documents below this size retain the exact text path only. */
export const TEXT_LOD_MIN_TEXT_INSTANCES = 50_000;
/** A coarse level that saves less than this is not worth keeping resident. */
export const TEXT_LOD_MAX_COARSE_RUN_RATIO = 0.7;
/** Value stored in the spare instance component for a coarse square. */
export const TEXT_COARSE_INSTANCE_FLAG = 1;
/** Maximum exact glyphs represented by one independently selected cluster. */
export const TEXT_LOD_MAX_CLUSTER_GLYPHS = 512;
/** Maximum coarse runs represented by one independently selected cluster. */
export const TEXT_LOD_MAX_CLUSTER_RUNS = 12;
/** Maximum spatial fragmentation accepted inside one cluster. */
export const TEXT_LOD_MAX_CLUSTER_AREA_RATIO = 4;
/** Segment count added by the shared solid-square glyph. */
export const TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT = 4;

export type TextLodFallbackReason =
  | "empty-text"
  | "below-instance-threshold"
  | "invalid-page-ranges"
  | "no-coarse-runs"
  | "insufficient-reduction"
  | "resource-capacity"
  | "invalid-build-data";

/** One atomic, source-contiguous exact/coarse choice. */
export interface TextLodRun {
  readonly exactStart: number;
  readonly exactCount: number;
  /** Index in the coarse suffix, or -1 when this run must remain exact. */
  readonly coarseIndex: number;
  readonly pageIndex: number;
  readonly bounds: Readonly<Bounds>;
  /** Unit-square-to-scene transform of the coarse run. */
  readonly transform: readonly [number, number, number, number, number, number];
  /** Largest glyph ink-box height in scene units. */
  readonly maxInkHeight: number;
  readonly eligible: boolean;
}

/** Page-contained group selected as a hard exact or coarse representation. */
export interface TextLodCluster {
  readonly pageIndex: number;
  readonly runStart: number;
  readonly runCount: number;
  readonly exactStart: number;
  readonly exactCount: number;
  /** First coarse suffix index, or -1 for an exact-only cluster. */
  readonly coarseStart: number;
  readonly coarseCount: number;
  readonly bounds: Readonly<Bounds>;
  readonly maxInkHeight: number;
  readonly eligible: boolean;
}

/** Cheap top-level culling node. */
export interface TextLodPageNode {
  readonly pageIndex: number;
  readonly clusterStart: number;
  readonly clusterCount: number;
  readonly exactStart: number;
  readonly exactCount: number;
  readonly coarseCount: number;
  readonly bounds: Readonly<Bounds>;
  readonly maxInkHeight: number;
  /** True only when every child cluster has a complete coarse representation. */
  readonly eligible: boolean;
}

/** Immutable scene-derived data shared by every renderer for a VectorScene. */
export interface TextLodBuildData {
  readonly exactInstanceCount: number;
  readonly coarseInstanceCount: number;
  readonly combinedInstanceCount: number;
  readonly solidGlyphIndex: number;
  readonly runs: readonly TextLodRun[];
  readonly clusters: readonly TextLodCluster[];
  readonly pages: readonly TextLodPageNode[];
  readonly coarseInstanceA: Float32Array;
  readonly coarseInstanceB: Float32Array;
  readonly coarseInstanceC: Float32Array;
}

/** Result cached for a scene, including deterministic ineligibility reasons. */
export interface TextLodBuildResult {
  readonly data: TextLodBuildData | null;
  readonly fallbackReason: TextLodFallbackReason | null;
  readonly buildTimeMs: number;
}

export interface TextLodBuildProgress {
  value: number;
  message: string;
}

export interface TextLodAsyncBuildOptions {
  signal?: AbortSignal;
  shouldCancel?: () => boolean;
  onProgress?: (progress: TextLodBuildProgress) => void;
  /** Cooperative-yield cadence. Defaults to 50ms. */
  yieldIntervalMs?: number;
}

export interface TextLodCombinedPayload {
  /** A single ordinary text scene: exact prefix followed by the coarse suffix. */
  scene: VectorScene;
  exactInstanceCount: number;
  coarseInstanceCount: number;
  combinedInstanceCount: number;
  solidGlyphIndex: number;
}

export interface TextLodCombinedDestinations {
  textInstanceA: Float32Array;
  textInstanceB: Float32Array;
  textInstanceC: Float32Array;
  textGlyphMetaA: Float32Array;
  textGlyphMetaB: Float32Array;
  textGlyphSegmentsA: Float32Array;
  textGlyphSegmentsB: Float32Array;
}

const GREEK_RUN_GAP_FACTOR = 1.5;
const GREEK_BASELINE_FACTOR = 0.05;
const GREEK_DIRECTION_BACKTRACK_FACTOR = 0.5;
const MATRIX_EPSILON = 1e-6;
const COLOR_EPSILON = 1 / 512;
const GEOMETRY_EPSILON = 1e-9;
const DEGENERATE_DETERMINANT = 1e-12;
const CONNECTION_EPSILON = 1e-3;
const ASYNC_INSTANCE_CHUNK_SIZE = 8_192;

interface MutableRun extends TextLodRun {}

interface BuildContext {
  scene: VectorScene;
  instanceCount: number;
  pageCount: number;
  inkAreas: Float32Array;
  runs: MutableRun[];
  coarse: Float4Builder;
  pageRunStarts: Uint32Array;
  pageRunCounts: Uint32Array;
}

export class TextLodBuildCancelledError extends Error {
  constructor() {
    super("Text LOD build cancelled.");
    this.name = "TextLodBuildCancelledError";
  }
}

export function shouldBuildTextLod(scene: VectorScene): boolean {
  return Math.max(0, scene.textInstanceCount | 0) >= TEXT_LOD_MIN_TEXT_INSTANCES;
}

/** Build clustered text LOD synchronously for standalone `setScene()` callers. */
export function buildTextLod(scene: VectorScene): TextLodBuildResult {
  const startedAt = nowMs();
  try {
    const prepared = prepareBuildContext(scene);
    if (typeof prepared === "string") {
      return freezeBuildResult(null, prepared, nowMs() - startedAt);
    }
    for (let pageIndex = 0; pageIndex < prepared.pageCount; pageIndex += 1) {
      buildPageRuns(prepared, pageIndex);
    }
    return finishBuild(prepared, startedAt);
  } catch (error: unknown) {
    return resourceCapacityFallbackOrThrow(error, startedAt);
  }
}

/** Build cooperatively, with progress, cancellation, and browser yields. */
export async function buildTextLodAsync(
  scene: VectorScene,
  options: TextLodAsyncBuildOptions = {}
): Promise<TextLodBuildResult> {
  const startedAt = nowMs();
  try {
    const scheduler = new BuildScheduler(options);
    scheduler.checkCancelled();
    scheduler.report(0, "Preparing Text LOD");
    const prepared = prepareBuildContext(scene);
    if (typeof prepared === "string") {
      scheduler.report(1, "Text LOD unavailable");
      return freezeBuildResult(null, prepared, nowMs() - startedAt);
    }

    let processedInstances = 0;
    for (let pageIndex = 0; pageIndex < prepared.pageCount; pageIndex += 1) {
      const rangeOffset = pageIndex * 2;
      const pageStart = prepared.scene.pageTextRanges[rangeOffset];
      const pageEnd = pageStart + prepared.scene.pageTextRanges[rangeOffset + 1];
      if (pageStart === pageEnd) {
        buildPageRuns(prepared, pageIndex, pageStart, pageEnd, true, true);
      }
      for (let chunkStart = pageStart; chunkStart < pageEnd; chunkStart += ASYNC_INSTANCE_CHUNK_SIZE) {
        const chunkEnd = Math.min(pageEnd, chunkStart + ASYNC_INSTANCE_CHUNK_SIZE);
        buildPageRuns(
          prepared,
          pageIndex,
          chunkStart,
          chunkEnd,
          chunkStart === pageStart,
          chunkEnd === pageEnd
        );
        processedInstances += chunkEnd - chunkStart;
        await scheduler.maybeYield(
          false,
          processedInstances / Math.max(1, prepared.instanceCount) * 0.9,
          `Building Text LOD pages ${pageIndex + 1}/${prepared.pageCount}`
        );
      }
    }
    await scheduler.maybeYield(true, 0.92, "Clustering Text LOD");
    const result = await finishBuildAsync(prepared, startedAt, scheduler);
    scheduler.report(1, result.data ? "Text LOD ready" : "Text LOD unavailable");
    return result;
  } catch (error: unknown) {
    return resourceCapacityFallbackOrThrow(error, startedAt);
  }
}

/**
 * Materialize exact instances as a prefix and coarse runs as a suffix, plus one
 * appended solid-square glyph. Source indices and the searchable text index are
 * deliberately retained unchanged.
 */
export function createTextLodCombinedPayload(
  scene: VectorScene,
  data: TextLodBuildData
): TextLodCombinedPayload {
  validateBuildDataForScene(scene, data);
  const exactInstanceCount = data.exactInstanceCount;
  const combinedInstanceCount = data.combinedInstanceCount;
  const combinedGlyphCount = Math.max(0, scene.textGlyphCount | 0) + 1;
  const sourceSegmentCount = Math.max(0, scene.textGlyphSegmentCount | 0);
  const combinedSegmentCount = sourceSegmentCount + TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT;
  const destinations: TextLodCombinedDestinations = {
    textInstanceA: new Float32Array(combinedInstanceCount * 4),
    textInstanceB: new Float32Array(combinedInstanceCount * 4),
    textInstanceC: new Float32Array(combinedInstanceCount * 4),
    textGlyphMetaA: new Float32Array(combinedGlyphCount * 4),
    textGlyphMetaB: new Float32Array(combinedGlyphCount * 4),
    textGlyphSegmentsA: new Float32Array(combinedSegmentCount * 4),
    textGlyphSegmentsB: new Float32Array(combinedSegmentCount * 4)
  };
  appendTextLodCombinedPayload(scene, data, destinations);

  return {
    scene: {
      ...scene,
      textInstanceCount: combinedInstanceCount,
      textInstanceA: destinations.textInstanceA,
      textInstanceB: destinations.textInstanceB,
      textInstanceC: destinations.textInstanceC,
      textGlyphCount: combinedGlyphCount,
      textGlyphSegmentCount: combinedSegmentCount,
      textGlyphMetaA: destinations.textGlyphMetaA,
      textGlyphMetaB: destinations.textGlyphMetaB,
      textGlyphSegmentsA: destinations.textGlyphSegmentsA,
      textGlyphSegmentsB: destinations.textGlyphSegmentsB
    },
    exactInstanceCount,
    coarseInstanceCount: data.coarseInstanceCount,
    combinedInstanceCount,
    solidGlyphIndex: data.solidGlyphIndex
  };
}

/** Write the combined payload into caller-owned (possibly padded) arrays. */
export function appendTextLodCombinedPayload(
  scene: VectorScene,
  data: TextLodBuildData,
  destinations: TextLodCombinedDestinations
): void {
  validateBuildDataForScene(scene, data);
  requireFloatCapacity(destinations.textInstanceA, data.combinedInstanceCount, "textInstanceA");
  requireFloatCapacity(destinations.textInstanceB, data.combinedInstanceCount, "textInstanceB");
  requireFloatCapacity(destinations.textInstanceC, data.combinedInstanceCount, "textInstanceC");
  requireFloatCapacity(destinations.textGlyphMetaA, data.solidGlyphIndex + 1, "textGlyphMetaA");
  requireFloatCapacity(destinations.textGlyphMetaB, data.solidGlyphIndex + 1, "textGlyphMetaB");
  requireFloatCapacity(
    destinations.textGlyphSegmentsA,
    Math.max(0, scene.textGlyphSegmentCount | 0) + TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
    "textGlyphSegmentsA"
  );
  requireFloatCapacity(
    destinations.textGlyphSegmentsB,
    Math.max(0, scene.textGlyphSegmentCount | 0) + TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
    "textGlyphSegmentsB"
  );

  const exactFloats = data.exactInstanceCount * 4;
  destinations.textInstanceA.set(scene.textInstanceA.subarray(0, exactFloats), 0);
  destinations.textInstanceB.set(scene.textInstanceB.subarray(0, exactFloats), 0);
  destinations.textInstanceC.set(scene.textInstanceC.subarray(0, exactFloats), 0);
  destinations.textInstanceA.set(data.coarseInstanceA, exactFloats);
  destinations.textInstanceB.set(data.coarseInstanceB, exactFloats);
  destinations.textInstanceC.set(data.coarseInstanceC, exactFloats);
  for (let i = 0; i < data.coarseInstanceCount; i += 1) {
    destinations.textInstanceB[exactFloats + i * 4 + 2] = data.solidGlyphIndex;
  }

  const sourceGlyphFloats = Math.max(0, scene.textGlyphCount | 0) * 4;
  const sourceSegmentFloats = Math.max(0, scene.textGlyphSegmentCount | 0) * 4;
  destinations.textGlyphMetaA.set(scene.textGlyphMetaA.subarray(0, sourceGlyphFloats), 0);
  destinations.textGlyphMetaB.set(scene.textGlyphMetaB.subarray(0, sourceGlyphFloats), 0);
  destinations.textGlyphSegmentsA.set(scene.textGlyphSegmentsA.subarray(0, sourceSegmentFloats), 0);
  destinations.textGlyphSegmentsB.set(scene.textGlyphSegmentsB.subarray(0, sourceSegmentFloats), 0);
  destinations.textGlyphMetaA.set(
    new Float32Array([
      Math.max(0, scene.textGlyphSegmentCount | 0),
      TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
      0,
      0
    ]),
    sourceGlyphFloats
  );
  destinations.textGlyphMetaB.set(SOLID_GLYPH_META_B, sourceGlyphFloats);
  destinations.textGlyphSegmentsA.set(SOLID_GLYPH_SEGMENTS_A, sourceSegmentFloats);
  destinations.textGlyphSegmentsB.set(SOLID_GLYPH_SEGMENTS_B, sourceSegmentFloats);
}

function prepareBuildContext(scene: VectorScene): BuildContext | TextLodFallbackReason {
  const instanceCount = Math.max(0, scene.textInstanceCount | 0);
  const pageCount = Math.max(0, scene.pageCount | 0);
  if (instanceCount <= 0 || pageCount <= 0) {
    return "empty-text";
  }
  if (instanceCount < TEXT_LOD_MIN_TEXT_INSTANCES) {
    return "below-instance-threshold";
  }
  if (!hasValidCompletePageRanges(scene, instanceCount, pageCount)) {
    return "invalid-page-ranges";
  }
  if (
    scene.textInstanceA.length < instanceCount * 4 ||
    scene.textInstanceB.length < instanceCount * 4 ||
    scene.textInstanceC.length < instanceCount * 4
  ) {
    return "invalid-build-data";
  }

  return {
    scene,
    instanceCount,
    pageCount,
    inkAreas: computeGlyphInkAreas(scene),
    runs: [],
    coarse: new Float4Builder(Math.min(instanceCount, 65_536)),
    pageRunStarts: new Uint32Array(pageCount),
    pageRunCounts: new Uint32Array(pageCount)
  };
}

function buildPageRuns(
  context: BuildContext,
  pageIndex: number,
  rangeStart?: number,
  rangeEnd?: number,
  initializePage = true,
  finalizePage = true
): void {
  const {scene, instanceCount} = context;
  const rangeOffset = pageIndex * 2;
  const declaredPageStart = Math.min(instanceCount, scene.pageTextRanges[rangeOffset]);
  const declaredPageEnd = Math.min(instanceCount, declaredPageStart + scene.pageTextRanges[rangeOffset + 1]);
  const pageStart = Math.max(declaredPageStart, Math.min(declaredPageEnd, rangeStart ?? declaredPageStart));
  const pageEnd = Math.max(pageStart, Math.min(declaredPageEnd, rangeEnd ?? declaredPageEnd));
  const pageBounds = pageBoundsAt(scene, pageIndex);
  if (initializePage) {
    context.pageRunStarts[pageIndex] = context.runs.length;
  }

  let index = pageStart;
  while (index < pageEnd) {
    const first = readGlyphPlacement(context, index);
    if (!first) {
      const invalidStart = index;
      let invalidBounds: Bounds | null = null;
      while (index < pageEnd && index - invalidStart < TEXT_LOD_MAX_CLUSTER_GLYPHS) {
        const placement = readGlyphPlacement(context, index);
        if (placement) break;
        invalidBounds = unionBounds(invalidBounds, approximateInstanceBounds(scene, index, pageBounds));
        index += 1;
      }
      context.runs.push(freezeRun({
        exactStart: invalidStart,
        exactCount: index - invalidStart,
        coarseIndex: -1,
        pageIndex,
        bounds: invalidBounds ?? pageBounds,
        transform: [0, 0, 0, 0, 0, 0],
        maxInkHeight: Number.POSITIVE_INFINITY,
        eligible: false
      }));
      continue;
    }

    const runStart = index;
    const a = first.a;
    const b = first.b;
    const c = first.c;
    const d = first.d;
    const originX = first.originX;
    const originY = first.originY;
    const inverseDeterminant = 1 / first.determinant;
    let minU = first.minU;
    let minV = first.minV;
    let maxU = first.maxU;
    let maxV = first.maxV;
    let inkTotal = first.inkArea;
    let maxInkHeight = first.inkHeight;
    let widestGlyph = Math.max(first.maxU - first.minU, GEOMETRY_EPSILON);
    let previousCenterU = (first.minU + first.maxU) * 0.5;
    let direction = 0;
    index += 1;

    while (index < pageEnd && index - runStart < TEXT_LOD_MAX_CLUSTER_GLYPHS) {
      const next = readGlyphPlacement(context, index);
      if (!next || !sameStyleAndTransform(first, next)) {
        break;
      }
      const deltaX = next.originX - originX;
      const deltaY = next.originY - originY;
      const advanceU = (d * deltaX - c * deltaY) * inverseDeterminant;
      const advanceV = (a * deltaY - b * deltaX) * inverseDeterminant;
      const runHeight = Math.max(maxV - minV, GEOMETRY_EPSILON);
      if (Math.abs(advanceV) > runHeight * GREEK_BASELINE_FACTOR) {
        break;
      }

      const nextMinU = next.minU + advanceU;
      const nextMinV = next.minV + advanceV;
      const nextMaxU = next.maxU + advanceU;
      const nextMaxV = next.maxV + advanceV;
      const nextWidth = Math.max(nextMaxU - nextMinU, GEOMETRY_EPSILON);
      const nextCenterU = (nextMinU + nextMaxU) * 0.5;
      const centerDelta = nextCenterU - previousCenterU;
      const directionThreshold = Math.min(widestGlyph, nextWidth) * 0.05;
      const candidateDirection = centerDelta > directionThreshold ? 1 : centerDelta < -directionThreshold ? -1 : 0;
      const effectiveDirection = direction || candidateDirection;
      const gapLimit = Math.max(widestGlyph, nextWidth) * GREEK_RUN_GAP_FACTOR;

      if (effectiveDirection > 0) {
        if (nextMinU - maxU > gapLimit || centerDelta < -widestGlyph * GREEK_DIRECTION_BACKTRACK_FACTOR) {
          break;
        }
      } else if (effectiveDirection < 0) {
        if (minU - nextMaxU > gapLimit || centerDelta > widestGlyph * GREEK_DIRECTION_BACKTRACK_FACTOR) {
          break;
        }
      } else {
        const intervalGap = Math.max(nextMinU - maxU, minU - nextMaxU, 0);
        if (intervalGap > gapLimit) break;
      }

      if (direction === 0 && candidateDirection !== 0) {
        direction = candidateDirection;
      }
      minU = Math.min(minU, nextMinU);
      minV = Math.min(minV, nextMinV);
      maxU = Math.max(maxU, nextMaxU);
      maxV = Math.max(maxV, nextMaxV);
      widestGlyph = Math.max(widestGlyph, nextWidth);
      previousCenterU = nextCenterU;
      inkTotal += next.inkArea;
      maxInkHeight = Math.max(maxInkHeight, next.inkHeight);
      index += 1;
    }

    const width = maxU - minU;
    const height = maxV - minV;
    if (!(width > GEOMETRY_EPSILON) || !(height > GEOMETRY_EPSILON) || !Number.isFinite(inkTotal)) {
      context.runs.push(freezeRun({
        exactStart: runStart,
        exactCount: index - runStart,
        coarseIndex: -1,
        pageIndex,
        bounds: boundsForExactRange(scene, runStart, index, pageBounds),
        transform: [0, 0, 0, 0, 0, 0],
        maxInkHeight: Number.POSITIVE_INFINITY,
        eligible: false
      }));
      continue;
    }

    const transform: [number, number, number, number, number, number] = [
      a * width,
      b * width,
      c * height,
      d * height,
      a * minU + c * minV + originX,
      b * minU + d * minV + originY
    ];
    const coarseIndex = context.coarse.count;
    const coverage = Math.min(1, Math.max(0, inkTotal / (width * height)));
    context.coarse.push(
      transform[0], transform[1], transform[2], transform[3],
      transform[4], transform[5], 0, TEXT_COARSE_INSTANCE_FLAG,
      first.red, first.green, first.blue, first.alpha * coverage
    );
    context.runs.push(freezeRun({
      exactStart: runStart,
      exactCount: index - runStart,
      coarseIndex,
      pageIndex,
      bounds: transformUnitBounds(transform),
      transform,
      maxInkHeight,
      eligible: true
    }));
  }

  if (finalizePage) {
    context.pageRunCounts[pageIndex] = context.runs.length - context.pageRunStarts[pageIndex];
  }
}

interface TextLodHierarchy {
  clusters: TextLodCluster[];
  pages: TextLodPageNode[];
}

function finishBuild(context: BuildContext, startedAt: number): TextLodBuildResult {
  const fallbackReason = finishFallbackReason(context);
  if (fallbackReason) {
    return freezeBuildResult(null, fallbackReason, nowMs() - startedAt);
  }
  const hierarchyBuilder = buildTextLodHierarchy(context);
  let hierarchy: TextLodHierarchy | null = null;
  while (!hierarchy) {
    const step = hierarchyBuilder.next();
    if (step.done) hierarchy = step.value;
  }
  const data = freezeTextLodBuildData(
    context,
    hierarchy,
    Object.freeze(context.runs.slice()),
    context.coarse.trimA(),
    context.coarse.trimB(),
    context.coarse.trimC()
  );
  // Stamp the timing only after hierarchy construction, array copies/trims,
  // and object freezing have all completed.
  return freezeBuildResult(data, null, nowMs() - startedAt);
}

async function finishBuildAsync(
  context: BuildContext,
  startedAt: number,
  scheduler: BuildScheduler
): Promise<TextLodBuildResult> {
  const fallbackReason = finishFallbackReason(context);
  if (fallbackReason) {
    scheduler.checkCancelled();
    return freezeBuildResult(null, fallbackReason, nowMs() - startedAt);
  }

  const hierarchyBuilder = buildTextLodHierarchy(context);
  let hierarchy: TextLodHierarchy | null = null;
  while (!hierarchy) {
    const step = hierarchyBuilder.next();
    if (step.done) {
      hierarchy = step.value;
      break;
    }
    await scheduler.maybeYield(
      false,
      0.92 + step.value * 0.055,
      "Clustering Text LOD hierarchy"
    );
  }

  await scheduler.maybeYield(true, 0.98, "Finalizing Text LOD run index");
  const frozenRuns = Object.freeze(context.runs.slice());
  await scheduler.maybeYield(true, 0.985, "Finalizing Text LOD instance A");
  const coarseInstanceA = context.coarse.trimA();
  await scheduler.maybeYield(true, 0.99, "Finalizing Text LOD instance B");
  const coarseInstanceB = context.coarse.trimB();
  await scheduler.maybeYield(true, 0.995, "Finalizing Text LOD instance C");
  const coarseInstanceC = context.coarse.trimC();
  scheduler.checkCancelled();
  const data = freezeTextLodBuildData(
    context,
    hierarchy,
    frozenRuns,
    coarseInstanceA,
    coarseInstanceB,
    coarseInstanceC
  );
  scheduler.checkCancelled();
  return freezeBuildResult(data, null, nowMs() - startedAt);
}

function finishFallbackReason(context: BuildContext): TextLodFallbackReason | null {
  const coarseCount = context.coarse.count;
  if (coarseCount <= 0) return "no-coarse-runs";
  if (coarseCount > context.instanceCount * TEXT_LOD_MAX_COARSE_RUN_RATIO) {
    return "insufficient-reduction";
  }
  return null;
}

function* buildTextLodHierarchy(context: BuildContext): Generator<number, TextLodHierarchy, void> {
  const clusters: TextLodCluster[] = [];
  const pages: TextLodPageNode[] = [];
  const totalRuns = Math.max(1, context.runs.length);
  let clustersSinceYield = 0;
  for (let pageIndex = 0; pageIndex < context.pageCount; pageIndex += 1) {
    const runStart = context.pageRunStarts[pageIndex];
    const runEnd = runStart + context.pageRunCounts[pageIndex];
    const clusterStart = clusters.length;
    let cursor = runStart;
    while (cursor < runEnd) {
      const first = context.runs[cursor];
      const eligible = first.eligible;
      const groupStart = cursor;
      let exactCount = 0;
      let coarseCountForCluster = 0;
      let bounds: Bounds | null = null;
      let summedArea = 0;
      let maxInkHeight = 0;

      while (cursor < runEnd) {
        const run = context.runs[cursor];
        if (run.eligible !== eligible) break;
        if (exactCount + run.exactCount > TEXT_LOD_MAX_CLUSTER_GLYPHS) break;
        if (eligible && coarseCountForCluster + 1 > TEXT_LOD_MAX_CLUSTER_RUNS) break;
        const nextBounds = unionBounds(bounds, run.bounds);
        const nextSummedArea = summedArea + boundsArea(run.bounds);
        if (
          cursor > groupStart &&
          boundsArea(nextBounds) > Math.max(GEOMETRY_EPSILON, nextSummedArea) * TEXT_LOD_MAX_CLUSTER_AREA_RATIO
        ) {
          break;
        }
        bounds = nextBounds;
        summedArea = nextSummedArea;
        exactCount += run.exactCount;
        coarseCountForCluster += run.eligible ? 1 : 0;
        maxInkHeight = Math.max(maxInkHeight, run.maxInkHeight);
        cursor += 1;
      }

      clusters.push(Object.freeze({
        pageIndex,
        runStart: groupStart,
        runCount: cursor - groupStart,
        exactStart: first.exactStart,
        exactCount,
        coarseStart: eligible ? first.coarseIndex : -1,
        coarseCount: coarseCountForCluster,
        bounds: Object.freeze(bounds ?? pageBoundsAt(context.scene, pageIndex)),
        maxInkHeight,
        eligible
      }));
      clustersSinceYield += 1;
      if (clustersSinceYield >= 256) {
        clustersSinceYield = 0;
        yield Math.min(1, cursor / totalRuns);
      }
    }

    const exactStart = context.scene.pageTextRanges[pageIndex * 2];
    const exactCount = context.scene.pageTextRanges[pageIndex * 2 + 1];
    let pageCoarseCount = 0;
    let pageMaxInkHeight = 0;
    let pageEligible = clusters.length > clusterStart;
    let pageNodeBounds = pageBoundsAt(context.scene, pageIndex);
    for (let i = clusterStart; i < clusters.length; i += 1) {
      pageCoarseCount += clusters[i].coarseCount;
      pageMaxInkHeight = Math.max(pageMaxInkHeight, clusters[i].maxInkHeight);
      pageEligible &&= clusters[i].eligible;
      pageNodeBounds = unionBounds(pageNodeBounds, clusters[i].bounds);
    }
    pages.push(Object.freeze({
      pageIndex,
      clusterStart,
      clusterCount: clusters.length - clusterStart,
      exactStart,
      exactCount,
      coarseCount: pageCoarseCount,
      bounds: Object.freeze(pageNodeBounds),
      maxInkHeight: pageMaxInkHeight,
      eligible: pageEligible
    }));
    if (clustersSinceYield > 0 || (pageIndex + 1) % 32 === 0) {
      clustersSinceYield = 0;
      yield Math.max(
        Math.min(1, (pageIndex + 1) / Math.max(1, context.pageCount)),
        Math.min(1, runEnd / totalRuns)
      );
    }
  }

  return {clusters, pages};
}

function freezeTextLodBuildData(
  context: BuildContext,
  hierarchy: TextLodHierarchy,
  runs: readonly TextLodRun[],
  coarseInstanceA: Float32Array,
  coarseInstanceB: Float32Array,
  coarseInstanceC: Float32Array
): TextLodBuildData {
  return Object.freeze({
    exactInstanceCount: context.instanceCount,
    coarseInstanceCount: context.coarse.count,
    combinedInstanceCount: context.instanceCount + context.coarse.count,
    solidGlyphIndex: Math.max(0, context.scene.textGlyphCount | 0),
    runs,
    clusters: Object.freeze(hierarchy.clusters),
    pages: Object.freeze(hierarchy.pages),
    coarseInstanceA,
    coarseInstanceB,
    coarseInstanceC
  });
}

interface GlyphPlacement {
  a: number;
  b: number;
  c: number;
  d: number;
  determinant: number;
  originX: number;
  originY: number;
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  inkArea: number;
  inkHeight: number;
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function readGlyphPlacement(context: BuildContext, instanceIndex: number): GlyphPlacement | null {
  const {scene} = context;
  const offset = instanceIndex * 4;
  const a = scene.textInstanceA[offset];
  const b = scene.textInstanceA[offset + 1];
  const c = scene.textInstanceA[offset + 2];
  const d = scene.textInstanceA[offset + 3];
  const originX = scene.textInstanceB[offset];
  const originY = scene.textInstanceB[offset + 1];
  const glyphIndex = Math.trunc(scene.textInstanceB[offset + 2]);
  const red = scene.textInstanceC[offset];
  const green = scene.textInstanceC[offset + 1];
  const blue = scene.textInstanceC[offset + 2];
  const alpha = scene.textInstanceC[offset + 3];
  if (![a, b, c, d, originX, originY, red, green, blue, alpha].every(Number.isFinite)) {
    return null;
  }
  const determinant = a * d - b * c;
  const glyphCount = Math.max(0, scene.textGlyphCount | 0);
  if (Math.abs(determinant) <= DEGENERATE_DETERMINANT || glyphIndex < 0 || glyphIndex >= glyphCount) {
    return null;
  }
  const glyphOffset = glyphIndex * 4;
  if (glyphOffset + 3 >= scene.textGlyphMetaA.length || glyphOffset + 1 >= scene.textGlyphMetaB.length) {
    return null;
  }
  const minU = scene.textGlyphMetaA[glyphOffset + 2];
  const minV = scene.textGlyphMetaA[glyphOffset + 3];
  const maxU = scene.textGlyphMetaB[glyphOffset];
  const maxV = scene.textGlyphMetaB[glyphOffset + 1];
  const localHeight = maxV - minV;
  const inkHeight = localHeight * Math.hypot(c, d);
  if (
    ![minU, minV, maxU, maxV, inkHeight].every(Number.isFinite) ||
    !(maxU - minU > GEOMETRY_EPSILON) ||
    !(localHeight > GEOMETRY_EPSILON) ||
    !(inkHeight > GEOMETRY_EPSILON)
  ) {
    return null;
  }
  return {
    a, b, c, d, determinant, originX, originY,
    minU, minV, maxU, maxV,
    inkArea: context.inkAreas[glyphIndex] ?? 0,
    inkHeight,
    red, green, blue, alpha
  };
}

function sameStyleAndTransform(first: GlyphPlacement, next: GlyphPlacement): boolean {
  return Math.abs(first.a - next.a) <= MATRIX_EPSILON &&
    Math.abs(first.b - next.b) <= MATRIX_EPSILON &&
    Math.abs(first.c - next.c) <= MATRIX_EPSILON &&
    Math.abs(first.d - next.d) <= MATRIX_EPSILON &&
    Math.abs(first.red - next.red) <= COLOR_EPSILON &&
    Math.abs(first.green - next.green) <= COLOR_EPSILON &&
    Math.abs(first.blue - next.blue) <= COLOR_EPSILON &&
    Math.abs(first.alpha - next.alpha) <= COLOR_EPSILON;
}

function hasValidCompletePageRanges(scene: VectorScene, instanceCount: number, pageCount: number): boolean {
  if (!(scene.pageTextRanges instanceof Uint32Array) || scene.pageTextRanges.length < pageCount * 2) {
    return false;
  }
  let cursor = 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const start = scene.pageTextRanges[pageIndex * 2];
    const count = scene.pageTextRanges[pageIndex * 2 + 1];
    if (start !== cursor || count > instanceCount - cursor) {
      return false;
    }
    cursor += count;
  }
  return cursor === instanceCount;
}

function computeGlyphInkAreas(scene: VectorScene): Float32Array {
  const glyphCount = Math.max(0, scene.textGlyphCount | 0);
  const areas = new Float32Array(glyphCount);
  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
    const glyphOffset = glyphIndex * 4;
    const segmentStart = Math.max(0, Math.trunc(scene.textGlyphMetaA[glyphOffset] ?? 0));
    const segmentCount = Math.max(0, Math.trunc(scene.textGlyphMetaA[glyphOffset + 1] ?? 0));
    let cross2 = 0;
    let subpathOpen = false;
    let subpathStartX = 0;
    let subpathStartY = 0;
    let cursorX = 0;
    let cursorY = 0;
    for (let i = 0; i < segmentCount; i += 1) {
      const segmentOffset = (segmentStart + i) * 4;
      if (segmentOffset + 3 >= scene.textGlyphSegmentsA.length || segmentOffset + 3 >= scene.textGlyphSegmentsB.length) {
        break;
      }
      const p0x = scene.textGlyphSegmentsA[segmentOffset];
      const p0y = scene.textGlyphSegmentsA[segmentOffset + 1];
      const cx = scene.textGlyphSegmentsA[segmentOffset + 2];
      const cy = scene.textGlyphSegmentsA[segmentOffset + 3];
      const p2x = scene.textGlyphSegmentsB[segmentOffset];
      const p2y = scene.textGlyphSegmentsB[segmentOffset + 1];
      const primitiveType = scene.textGlyphSegmentsB[segmentOffset + 2];
      if (![p0x, p0y, cx, cy, p2x, p2y, primitiveType].every(Number.isFinite)) continue;
      if (!subpathOpen || !pointsClose(p0x, p0y, cursorX, cursorY)) {
        if (subpathOpen) cross2 += cursorX * subpathStartY - cursorY * subpathStartX;
        subpathOpen = true;
        subpathStartX = p0x;
        subpathStartY = p0y;
      }
      cross2 += primitiveType >= 0.5
        ? (2 / 3) * (p0x * cy - p0y * cx) +
          (1 / 3) * (p0x * p2y - p0y * p2x) +
          (2 / 3) * (cx * p2y - cy * p2x)
        : p0x * p2y - p0y * p2x;
      cursorX = p2x;
      cursorY = p2y;
    }
    if (subpathOpen) cross2 += cursorX * subpathStartY - cursorY * subpathStartX;
    areas[glyphIndex] = Math.abs(cross2) * 0.5;
  }
  return areas;
}

class Float4Builder {
  private capacity: number;
  private a: Float32Array;
  private b: Float32Array;
  private c: Float32Array;
  count = 0;

  constructor(initialCapacity: number) {
    this.capacity = Math.max(16, initialCapacity);
    this.a = new Float32Array(this.capacity * 4);
    this.b = new Float32Array(this.capacity * 4);
    this.c = new Float32Array(this.capacity * 4);
  }

  push(
    a0: number, a1: number, a2: number, a3: number,
    b0: number, b1: number, b2: number, b3: number,
    c0: number, c1: number, c2: number, c3: number
  ): void {
    if (this.count >= this.capacity) this.grow();
    const offset = this.count * 4;
    this.a.set([a0, a1, a2, a3], offset);
    this.b.set([b0, b1, b2, b3], offset);
    this.c.set([c0, c1, c2, c3], offset);
    this.count += 1;
  }

  trimA(): Float32Array { return this.a.slice(0, this.count * 4); }
  trimB(): Float32Array { return this.b.slice(0, this.count * 4); }
  trimC(): Float32Array { return this.c.slice(0, this.count * 4); }

  private grow(): void {
    this.capacity *= 2;
    this.a = growFloatArray(this.a, this.capacity * 4);
    this.b = growFloatArray(this.b, this.capacity * 4);
    this.c = growFloatArray(this.c, this.capacity * 4);
  }
}

class BuildScheduler {
  private readonly options: TextLodAsyncBuildOptions;
  private readonly yieldIntervalMs: number;
  private lastYieldAt = nowMs();
  private lastProgress = -1;

  constructor(options: TextLodAsyncBuildOptions) {
    this.options = options;
    this.yieldIntervalMs = Math.max(1, options.yieldIntervalMs ?? 50);
  }

  checkCancelled(): void {
    if (this.options.signal?.aborted || this.options.shouldCancel?.()) {
      throw new TextLodBuildCancelledError();
    }
  }

  report(value: number, message: string): void {
    const normalized = Math.max(this.lastProgress, Math.min(1, Math.max(0, value)));
    this.lastProgress = normalized;
    this.options.onProgress?.({value: normalized, message});
  }

  async maybeYield(force: boolean, value: number, message: string): Promise<void> {
    this.checkCancelled();
    this.report(value, message);
    if (!force && nowMs() - this.lastYieldAt < this.yieldIntervalMs) return;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    this.lastYieldAt = nowMs();
    this.checkCancelled();
  }
}

function freezeBuildResult(
  data: TextLodBuildData | null,
  fallbackReason: TextLodFallbackReason | null,
  buildTimeMs: number
): TextLodBuildResult {
  return Object.freeze({data, fallbackReason, buildTimeMs: Math.max(0, buildTimeMs)});
}

function resourceCapacityFallbackOrThrow(error: unknown, startedAt: number): TextLodBuildResult {
  if (
    error instanceof RangeError &&
    /allocation failed|array buffer|invalid (?:typed )?array length|out of memory|length too large|maximum array/i.test(error.message)
  ) {
    return freezeBuildResult(null, "resource-capacity", nowMs() - startedAt);
  }
  throw error;
}

function freezeRun(run: MutableRun): MutableRun {
  return Object.freeze({
    ...run,
    bounds: Object.freeze(copyBounds(run.bounds)),
    transform: Object.freeze([...run.transform]) as unknown as TextLodRun["transform"]
  });
}

function pageBoundsAt(scene: VectorScene, pageIndex: number): Bounds {
  const offset = pageIndex * 4;
  if (offset + 3 < scene.pageRects.length) {
    const x0 = scene.pageRects[offset];
    const y0 = scene.pageRects[offset + 1];
    const x1 = scene.pageRects[offset + 2];
    const y1 = scene.pageRects[offset + 3];
    const bounds = {
      minX: Math.min(x0, x1),
      minY: Math.min(y0, y1),
      maxX: Math.max(x0, x1),
      maxY: Math.max(y0, y1)
    };
    if (isFiniteBounds(bounds)) return bounds;
  }
  return isFiniteBounds(scene.bounds) ? copyBounds(scene.bounds) : {minX: 0, minY: 0, maxX: 0, maxY: 0};
}

function approximateInstanceBounds(scene: VectorScene, instanceIndex: number, fallback: Bounds): Bounds {
  const offset = instanceIndex * 4;
  const a = scene.textInstanceA[offset];
  const b = scene.textInstanceA[offset + 1];
  const c = scene.textInstanceA[offset + 2];
  const d = scene.textInstanceA[offset + 3];
  const originX = scene.textInstanceB[offset];
  const originY = scene.textInstanceB[offset + 1];
  const glyphIndex = Math.trunc(scene.textInstanceB[offset + 2]);
  const glyphOffset = glyphIndex * 4;
  if (
    [a, b, c, d, originX, originY].every(Number.isFinite) && glyphIndex >= 0 &&
    glyphOffset + 3 < scene.textGlyphMetaA.length && glyphOffset + 1 < scene.textGlyphMetaB.length
  ) {
    const minU = scene.textGlyphMetaA[glyphOffset + 2];
    const minV = scene.textGlyphMetaA[glyphOffset + 3];
    const maxU = scene.textGlyphMetaB[glyphOffset];
    const maxV = scene.textGlyphMetaB[glyphOffset + 1];
    if ([minU, minV, maxU, maxV].every(Number.isFinite)) {
      return transformUnitBounds([
        a * (maxU - minU), b * (maxU - minU),
        c * (maxV - minV), d * (maxV - minV),
        a * minU + c * minV + originX,
        b * minU + d * minV + originY
      ]);
    }
  }
  return copyBounds(fallback);
}

function boundsForExactRange(scene: VectorScene, start: number, end: number, fallback: Bounds): Bounds {
  let result: Bounds | null = null;
  for (let i = start; i < end; i += 1) {
    result = unionBounds(result, approximateInstanceBounds(scene, i, fallback));
  }
  return result ?? copyBounds(fallback);
}

function transformUnitBounds(transform: readonly number[]): Bounds {
  const [a, b, c, d, e, f] = transform;
  const x0 = e;
  const y0 = f;
  const x1 = a + e;
  const y1 = b + f;
  const x2 = c + e;
  const y2 = d + f;
  const x3 = a + c + e;
  const y3 = b + d + f;
  return {
    minX: Math.min(x0, x1, x2, x3),
    minY: Math.min(y0, y1, y2, y3),
    maxX: Math.max(x0, x1, x2, x3),
    maxY: Math.max(y0, y1, y2, y3)
  };
}

function unionBounds(left: Bounds | null, right: Bounds): Bounds {
  if (!left) return copyBounds(right);
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY)
  };
}

function boundsArea(bounds: Bounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function copyBounds(bounds: Readonly<Bounds>): Bounds {
  return {minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY};
}

function isFiniteBounds(bounds: Bounds): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY) &&
    bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY;
}

function validateBuildDataForScene(scene: VectorScene, data: TextLodBuildData): void {
  if (
    data.exactInstanceCount !== Math.max(0, scene.textInstanceCount | 0) ||
    data.solidGlyphIndex !== Math.max(0, scene.textGlyphCount | 0) ||
    data.combinedInstanceCount !== data.exactInstanceCount + data.coarseInstanceCount
  ) {
    throw new Error("Text LOD build data does not belong to this scene.");
  }
}

function requireFloatCapacity(array: Float32Array, itemCount: number, name: string): void {
  if (array.length < itemCount * 4) {
    throw new RangeError(`${name} requires at least ${itemCount * 4} floats.`);
  }
}

function growFloatArray(source: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length);
  next.set(source);
  return next;
}

function pointsClose(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= CONNECTION_EPSILON && Math.abs(ay - by) <= CONNECTION_EPSILON;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

const SOLID_GLYPH_META_B = new Float32Array([1, 1, 0, 0]);
const SOLID_GLYPH_SEGMENTS_A = new Float32Array([
  0, 0, 0, 0,
  1, 0, 0, 0,
  1, 1, 0, 0,
  0, 1, 0, 0
]);
const SOLID_GLYPH_SEGMENTS_B = new Float32Array([
  1, 0, 0, 0,
  1, 1, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 0
]);
