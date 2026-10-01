import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import { placeSceneAnnotation } from "./annotationData";
import { createEmptyVectorScene } from "./emptyVectorScene";
import { HEPR_ANNOTATION_MARKED_CONTENT_TAG, HEPR_COLOR_SPACE_KIND, HEPR_PAINT_KIND, HEPR_STROKE_FLAG, expandHeprImageToRgba8,
  type HeprPageData, type PdfMatrix } from "./heprDocumentData";
import { executeHeprDisplayProgram, multiplyHeprMatrices, resolveHeprPatternPaint, type HeprDisplayBackend,
  type HeprDrawRunExecution, type HeprExecutionClipScope, type HeprExecutionIndexScope, type HeprExecutionState } from "./heprDisplayExecutor";
import { AnnotationLayerBuilder } from "./annotationLayers";
import { ContentItemRangeBuilder } from "./structureData";
import { visitHeprPath } from "./heprPathGeometry";
import { HeprFunctionEvaluator } from "./heprFunctionEvaluator";
import { HeprColorEvaluator } from "./heprColorEvaluator";
import { buildHeprVectorGradient } from "./retainedVectorGradient";
import type { GradientSceneData } from "./orderedGradientPaint";
import type { OptionalContentCondition, SceneOptionalContent } from "./optionalContentData";
import type { Bounds, SceneTextIndex, VectorScene } from "./pdfVectorExtractor";
import type { ScenePaintGroup, ScenePaintNode } from "./scenePaintGraph";
import { buildNativeFallbackTextIndex } from "./pdf/nativeRasterPage";
import { NativeTextClipTester } from "./pdf/nativeTextClip";
import { NativeVectorClipBuilder } from "./pdf/nativeVectorClips";
import { emitCubicAsQuadratics, VectorPageTextIndexBuilder } from "./pdf/nativeVectorPage";
import { buildNativeGlyphStroke, buildNativeGlyphStrokeAtOrigin, nativeGlyphStrokeCacheKey, type NativeGlyphStrokeStyle } from "./pdf/nativeGlyphStroke";
import { buildNativeGlyphHairline } from "./pdf/nativeGlyphHairline";
import type { NativeGlyphPathCommand } from "./pdf/nativeFont";
import type { DensePdfTextClip } from "./pdf/nativeContentCompiler";
import { PdfError } from "./pdf/nativeTypes";
import type { PdfDiagnostic } from "./pdf/nativeTypes";

const IDENTITY: PdfMatrix = [1, 0, 0, 1, 0, 0];
type Color = readonly [number, number, number, number];
interface Geometry { a: number[]; b: number[]; bounds: Bounds }

/** Append-only final stroke values; no page-sized boxed arrays or growth copies. */
class RetainedStrokeBuffer {
  private static readonly chunkLength = 16_384;
  private chunks: Float32Array[] = [];
  private current: Float32Array | null = null;
  private offset = 0;
  length = 0;

  push(a: number, b: number, c: number, d: number): void {
    if (!this.current || this.offset === this.current.length) {
      this.current = new Float32Array(RetainedStrokeBuffer.chunkLength);
      this.chunks.push(this.current);
      this.offset = 0;
    }
    this.current[this.offset++] = a;
    this.current[this.offset++] = b;
    this.current[this.offset++] = c;
    this.current[this.offset++] = d;
    this.length += 4;
  }

  take(): Float32Array {
    const chunks = this.chunks, length = this.length;
    this.chunks = []; this.current = null; this.offset = this.length = 0;
    if (chunks.length === 0) return new Float32Array(0);
    if (chunks.length === 1) {
      const chunk = chunks[0], buffer = chunk.buffer as ArrayBuffer & {
        transferToFixedLength?: (newByteLength: number) => ArrayBuffer;
      };
      if (length === chunk.length) return chunk;
      return typeof buffer.transferToFixedLength === "function"
        ? new Float32Array(buffer.transferToFixedLength(length * Float32Array.BYTES_PER_ELEMENT))
        : chunk.slice(0, length);
    }
    const result = new Float32Array(length);
    while (chunks.length) {
      const offset = (chunks.length - 1) * RetainedStrokeBuffer.chunkLength, chunk = chunks.pop()!;
      result.set(chunk.subarray(0, Math.min(chunk.length, length - offset)), offset);
      // These chunks are exclusively owned. Release copied backing stores now
      // where supported, rather than waiting for a mobile GC cycle.
      const buffer = chunk.buffer as ArrayBuffer & { transferToFixedLength?: (newByteLength: number) => ArrayBuffer };
      if (typeof buffer.transferToFixedLength === "function") buffer.transferToFixedLength(0);
    }
    return result;
  }
}
/**
 * Page-space pen geometry for each glyph occurrence in a page's text index,
 * captured while compiling. It is never persisted; without it the lowered
 * index falls back to the parser's raw separators.
 */
export interface RetainedTextPositions {
  /** One entry per text-index code unit: its occurrence, or -1 for a separator. */
  readonly charOccurrences: Int32Array;
  /** Five floats per occurrence: pen start x/y, pen end x/y and em height. */
  readonly pens: Float32Array;
  /** One flag per occurrence: an explicit TJ word gap precedes it. */
  readonly gapBefore: Uint8Array;
}

export interface RetainedVectorPageOptions {
  readonly optionalContent?: SceneOptionalContent;
  readonly textPositions?: RetainedTextPositions;
  /**
   * Marked-content nodes `[0, n)` come from the page's own content stream.
   * Only their MCIDs attribute paint to structure content items; without it,
   * no paint is attributed.
   */
  readonly pageMarkedContentCount?: number;
  readonly signal: AbortSignal;
  readonly maxPrimitives?: number;
  readonly maxCoordinates?: number;
  readonly maxPatternCells?: number;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}

/**
 * Folds an image's /SMask into its alpha, in place, over straight RGBA8.
 *
 * The mask's gray samples are the image's alpha, and the two are independent
 * rasters that need not share a size, so the mask is point-sampled across the
 * base's grid. Any alpha the base already carries is kept: the two multiply,
 * as a mask and a source-alpha do when both apply.
 */
function applyHeprImageSoftMask(base: Uint8Array, width: number, height: number,
  mask: Uint8Array, maskWidth: number, maskHeight: number, signal?: AbortSignal): Uint8Array {
  if (maskWidth <= 0 || maskHeight <= 0 || width <= 0 || height <= 0) return base;
  for (let y = 0; y < height; y++) {
    signal?.throwIfAborted();
    const row = Math.min(maskHeight - 1, Math.floor(y * maskHeight / height)) * maskWidth;
    for (let x = 0; x < width; x++) {
      const column = Math.min(maskWidth - 1, Math.floor(x * maskWidth / width));
      const offset = (y * width + x) * 4;
      base[offset + 3] = Math.round(base[offset + 3] * mask[(row + column) * 4] / 255);
    }
  }
  return base;
}

/** Lower self-contained reusable PDF programs into canonical geometry and a retained paint graph. */
export async function lowerRetainedPageToVectorScene(source: HeprPageData, options: RetainedVectorPageOptions): Promise<VectorScene> {
  const { signal } = options;
  const maximum = options.maxPrimitives ?? 1_000_000, maxCoordinates = options.maxCoordinates ?? 60_000_000;
  const maxCells = options.maxPatternCells ?? 100_000;
  for (const limit of [maximum, maxCoordinates, maxCells]) if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Retained vector budgets must be nonnegative safe integers.");
  // Execute every retained command; visibility is applied by the scene controller later.
  const page: HeprPageData = { ...source, stores: { ...source.stores, optionalContent: {
    ...source.stores.optionalContent, defaultVisible: new Uint8Array(source.stores.optionalContent.defaultVisible.length).fill(1)
  } } };
  const scene = createEmptyVectorScene(), { width, height } = page.pageInfo;
  scene.pageCount = 1; scene.pagesPerRow = 1;
  scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: width, maxY: height };
  scene.pageRects = new Float32Array([0, 0, width, height]); scene.pageTextRanges = new Uint32Array([0, 0]);
  scene.drawRuns = []; scene.paintGraph = { roots: [] };
  const runColors: (Color | undefined)[] = [];
  const conditions: OptionalContentCondition[] = [...(options.optionalContent?.conditions ?? [])];
  const conditionKeys = new Map<string, number>();
  const fillsA: number[] = [], fillsB: number[] = [], fillsC: number[] = [], segmentsA: number[] = [], segmentsB: number[] = [];
  const textA: number[] = [], textB: number[] = [], textC: number[] = [], glyphMetaA: number[] = [], glyphMetaB: number[] = [], glyphA: number[] = [], glyphB: number[] = [];
  const endpoints = new RetainedStrokeBuffer(), primitiveMeta = new RetainedStrokeBuffer(), primitiveBounds = new RetainedStrokeBuffer(), styles = new RetainedStrokeBuffer();
  const clipBuilder = new NativeVectorClipBuilder(), clipCache = new WeakMap<HeprExecutionClipScope, DensePdfTextClip>();
  const glyphConditions = new Int32Array(page.stores.glyphs.glyphIds.length).fill(-1);
  // Search references the first instance painting each glyph. A glyph whose
  // every placement misses its clip chain or the page leaves the index.
  const glyphInstances = new Int32Array(page.stores.glyphs.glyphIds.length).fill(-1);
  const glyphReach = new Uint8Array(page.stores.glyphs.glyphIds.length);
  const glyphClipTester = new NativeTextClipTester();
  let reportedGlyphStrokeComplexity = false, reportedHairlineCurveApproximation = false, reportedHairlineStyleApproximation = false;
  let reportedViewTransformApproximation = false;
  const stack: ScenePaintNode[][] = [scene.paintGraph.roots];
  const knockoutScopes = new WeakSet<ScenePaintNode[]>();
  const groupScopes = new WeakMap<ScenePaintNode[], ScenePaintGroup>();
  const masks = new WeakMap<HeprPageData, Map<number, { children: ScenePaintNode[]; backdrop?: [number, number, number] }>>();
  const functions = new HeprFunctionEvaluator(page.stores.functions);
  const colors = new HeprColorEvaluator(page.stores.colors,
    (indices, inputs) => indices.flatMap(index => [...functions.evaluate(index, inputs, { signal })]), signal);
  const gradients: GradientSceneData[] = [];
  const imagePixels = new Map<number, Uint8Array>();
  const glyphAtlas = new Map<string, number>();
  const hairlineAtlas = new Map<string, ReturnType<typeof buildNativeGlyphHairline>>();
  let gradientSegments = 0, meshVertices = 0, meshIndices = 0;
  let count = 0, coordinates = 0, cells = 0, skippedPatternCells = 0, lastYield = performance.now();
  const fail = (message: string, reason = "vector-retained-program"): never => {
    throw new PdfError("unsupported-content", `VectorScene retained program: ${message}`, { details: { reason } });
  };
  const budget = (added: number): void => {
    signal.throwIfAborted(); coordinates += added;
    if (++count > maximum || coordinates > maxCoordinates) throw new PdfError("resource-limit", "Retained vector expansion exceeds its geometry budget.", { details: { reason: "vector-expansion-limit" } });
  };
  const transform = (index: number): PdfMatrix => Array.from(page.stores.transforms.values.subarray(index * 6, index * 6 + 6)) as unknown as PdfMatrix;
  const inverseMatrix = (matrix: PdfMatrix): PdfMatrix => {
    const [a, b, c, d, e, f] = matrix, det = a * d - b * c;
    if (Math.abs(det) < 1e-12) return fail("singular paint transform.");
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  };
  const point = (matrix: PdfMatrix, x: number, y: number): [number, number] => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  const emptyBounds = (): Bounds => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const include = (bounds: Bounds, x: number, y: number): void => { bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y); bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y); };
  const append = (target: number[], values: readonly number[]): void => { for (const value of values) target.push(value); };
  const combineLayers = (state: HeprExecutionState, inherited = -1): number | undefined => {
    const indices = new Set<number>();
    if (inherited >= 0) indices.add(inherited);
    for (let scope = state.optionalContent; scope; scope = scope.parent) if (scope.index >= 0) indices.add(scope.index);
    if (!indices.size) return undefined;
    if (!options.optionalContent) return undefined;
    if (indices.size === 1) return [...indices][0];
    const operands = [...indices].sort((a, b) => a - b), key = operands.join(":");
    let index = conditionKeys.get(key);
    if (index === undefined) { index = conditions.length; conditions.push({ kind: "and", operands }); conditionKeys.set(key, index); }
    return index;
  };
  // An appearance's paint inherits its invocation's `Annot` node, however
  // deeply its programs nest. Only the page's own annotation ids qualify, so
  // PDF content that happens to use an /Annot tag is not captured.
  const annotationIds = new Set(source.annotations?.map(annotation => annotation.id) ?? []);
  const annotationLayers = new AnnotationLayerBuilder(options.optionalContent, conditions);
  const annotationScopes = new WeakMap<HeprExecutionIndexScope, string | null>();
  const annotationOf = (scope: HeprExecutionIndexScope | null): string | undefined => {
    if (!scope || !annotationIds.size) return undefined;
    let annotation = annotationScopes.get(scope);
    if (annotation === undefined) {
      const { tags, propertyNames } = page.stores.markedContent, name = propertyNames[scope.index];
      annotation = tags[scope.index] === HEPR_ANNOTATION_MARKED_CONTENT_TAG && name !== null && annotationIds.has(name)
        ? name : annotationOf(scope.parent) ?? null;
      annotationScopes.set(scope, annotation);
    }
    return annotation ?? undefined;
  };
  const combine = (state: HeprExecutionState, inherited = -1): number | undefined =>
    annotationLayers.condition(combineLayers(state, inherited), annotationOf(state.markedContent));
  // Structure content items: the innermost page-level marked-content node with
  // an MCID. Form content's own MCIDs need the Form's /StructParents key, so
  // that paint keeps its caller's item.
  const pageMarkedContentCount = options.pageMarkedContentCount ?? 0;
  const contentItems: { mcid: number; tag: string }[] = [];
  const contentItemIndexes = new Map<number, number>();
  const itemScopes = new WeakMap<HeprExecutionIndexScope, number>();
  const itemRanges = new ContentItemRangeBuilder();
  let currentItem = -1, ignoredFormContentItems = false;
  const itemOf = (scope: HeprExecutionIndexScope | null): number => {
    if (!scope || !pageMarkedContentCount) return -1;
    let item = itemScopes.get(scope);
    if (item === undefined) {
      const { mcids, tags, parentIndices } = page.stores.markedContent;
      // Execution scopes link invocations; lexical BMC/BDC parents live in the store.
      for (let node = scope.index; node >= 0; node = parentIndices[node] ?? -1) {
        const mcid = mcids[node] ?? -1;
        if (mcid < 0) continue;
        if (node >= pageMarkedContentCount) { ignoredFormContentItems = true; continue; }
        item = contentItemIndexes.get(node);
        if (item === undefined) {
          item = contentItems.length;
          contentItemIndexes.set(node, item);
          contentItems.push({ mcid, tag: tags[node] });
        }
        break;
      }
      item ??= itemOf(scope.parent);
      itemScopes.set(scope, item);
    }
    return item;
  };
  const color = (index: number, state?: HeprExecutionState): Color => {
    if (index < 0) index = state?.type3PaintIndex ?? -1;
    const paints = page.stores.paints;
    if (index < 0 || paints.kinds[index] !== HEPR_PAINT_KIND.SolidColor) return fail("paint is not a resolved solid color.");
    const store = page.stores.colors, resource = paints.resourceIndices[index];
    const values = store.parameters.subarray(store.parameterOffsets[resource], store.parameterOffsets[resource + 1]);
    return [...colors.convert(resource, values, "retained-vector-paint"), paints.alphas[index]];
  };
  const glyphPaths = (glyph: number): number[] => {
    const { fonts, glyphs } = page.stores, font = glyphs.fontIndices[glyph], id = glyphs.glyphIds[glyph];
    for (let index = fonts.glyphOffsets[font]; index < fonts.glyphOffsets[font + 1]; index++) if (fonts.glyphIds[index] === id) {
      return Array.from({ length: fonts.outlinePathCounts[index] }, (_, offset) => fonts.outlinePathStarts[index] + offset);
    }
    return [];
  };
  const pathCommands = (indices: readonly number[]): NativeGlyphPathCommand[] => {
    const result: NativeGlyphPathCommand[] = [];
    for (const index of indices) visitHeprPath(page.stores.paths, index, {
      moveTo: (x, y) => { result.push({ kind: "move", x, y }); },
      lineTo: (x, y) => { result.push({ kind: "line", x, y }); },
      quadraticTo: (controlX, controlY, x, y) => { result.push({ kind: "quadratic", controlX, controlY, x, y }); },
      cubicTo: (control1X, control1Y, control2X, control2Y, x, y) => { result.push({ kind: "cubic", control1X, control1Y, control2X, control2Y, x, y } as NativeGlyphPathCommand); },
      close: () => { result.push({ kind: "close" }); }
    });
    return result;
  };
  const geometry = (indices: readonly number[], matrix: PdfMatrix): Geometry => {
    const a: number[] = [], b: number[] = [], bounds = emptyBounds();
    let x = 0, y = 0, sx = 0, sy = 0, open = false;
    const line = (nx: number, ny: number): void => { if (x !== nx || y !== ny) { a.push(x, y, nx, ny); b.push(nx, ny, 0, 0); include(bounds, x, y); include(bounds, nx, ny); } x = nx; y = ny; };
    const quadratic = (cx: number, cy: number, nx: number, ny: number): void => { a.push(x, y, cx, cy); b.push(nx, ny, 1, 0); include(bounds, x, y); include(bounds, cx, cy); include(bounds, nx, ny); x = nx; y = ny; };
    for (const index of indices) visitHeprPath(page.stores.paths, index, {
      moveTo: (px, py) => { if (open) line(sx, sy); [x, y] = point(matrix, px, py); sx = x; sy = y; open = true; },
      lineTo: (px, py) => line(...point(matrix, px, py)),
      quadraticTo: (cx, cy, px, py) => quadratic(...point(matrix, cx, cy), ...point(matrix, px, py)),
      cubicTo: (c1x, c1y, c2x, c2y, px, py) => emitCubicAsQuadratics(x, y, ...point(matrix, c1x, c1y), ...point(matrix, c2x, c2y), ...point(matrix, px, py), quadratic),
      close: () => { if (open) line(sx, sy); open = false; }
    });
    if (open) line(sx, sy);
    return { a, b, bounds };
  };
  const clipFromGeometry = (g: Geometry, parent: DensePdfTextClip | null, fillRule: number): DensePdfTextClip => {
    const data: number[] = []; let x = NaN, y = NaN;
    for (let i = 0; i < g.a.length; i += 4) {
      if (g.a[i] !== x || g.a[i + 1] !== y) data.push(0, g.a[i], g.a[i + 1]);
      if (g.b[i + 2] === 1) data.push(3, g.a[i + 2], g.a[i + 3], g.b[i], g.b[i + 1]);
      else data.push(1, g.b[i], g.b[i + 1]);
      x = g.b[i]; y = g.b[i + 1];
    }
    return { parent, fillRule: fillRule === 1 ? 1 : 0, path: { data: Float32Array.from(data), transform: [...IDENTITY], bounds: g.bounds } };
  };
  const resourceClip = (index: number, outer: PdfMatrix, parent: DensePdfTextClip | null): DensePdfTextClip | null => {
    if (index < 0) return parent;
    const clips = page.stores.clips;
    parent = resourceClip(clips.parentIndices[index], outer, parent);
    const matrix = multiplyHeprMatrices(outer, transform(clips.transformIndices[index]));
    let g: Geometry;
    if (clips.glyphCounts[index] > 0) {
      g = { a: [], b: [], bounds: emptyBounds() };
      for (let glyph = clips.firstGlyphs[index]; glyph < clips.firstGlyphs[index] + clips.glyphCounts[index]; glyph++) {
        const part = geometry(glyphPaths(glyph), multiplyHeprMatrices(matrix, transform(page.stores.glyphs.transformIndices[glyph])));
        append(g.a, part.a); append(g.b, part.b); include(g.bounds, part.bounds.minX, part.bounds.minY); include(g.bounds, part.bounds.maxX, part.bounds.maxY);
      }
    } else g = geometry(Array.from({ length: clips.pathCounts[index] }, (_, offset) => clips.firstPaths[index] + offset), matrix);
    return clipFromGeometry(g, parent, clips.fillRules[index]);
  };
  const clipScope = (scope: HeprExecutionClipScope | null): DensePdfTextClip | null => {
    if (!scope) return null;
    const cached = clipCache.get(scope); if (cached) return cached;
    const parent = clipScope(scope.parent);
    let result: DensePdfTextClip | null;
    if (scope.kind === "resource") result = resourceClip(scope.clipIndex, scope.outerTransform, parent);
    else {
      const [x0, y0, x1, y1] = scope.bounds;
      result = { parent, fillRule: 0, path: { data: new Float32Array([0, x0, y0, 1, x1, y0, 1, x1, y1, 1, x0, y1, 4]), transform: [...scope.outerTransform],
        bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 } } };
    }
    if (result) clipCache.set(scope, result); return result;
  };
  const appendRun = (kind: "fill" | "stroke" | "raster" | "text" | "gradient-fill", first: number, amount: number, clip: DensePdfTextClip | null, condition?: number, paintColor?: Color): void => {
    itemRanges.add(kind, first, amount, currentItem);
    const clipIndex = clipBuilder.add(clip, signal);
    const siblings = stack.at(-1)!, previousNode = siblings.at(-1);
    const previous = previousNode?.kind === "draw" ? scene.drawRuns![previousNode.runIndex] : undefined;
    const previousColor = previousNode?.kind === "draw" ? runColors[previousNode.runIndex] : undefined;
    // Keep RGB boundaries visible to the scheduler: a mixed-color run hides
    // otherwise commuting paints behind one large, inseparable overlap bound.
    // Alpha stays per primitive; equal RGB commutes at every coverage/opacity.
    const sameColor = paintColor && previousColor &&
      Math.fround(paintColor[0]) === Math.fround(previousColor[0]) &&
      Math.fround(paintColor[1]) === Math.fround(previousColor[1]) &&
      Math.fround(paintColor[2]) === Math.fround(previousColor[2]);
    // Consecutive paints within one compositing scope may share a draw without
    // moving any paint across a clip, layer, or transparency boundary.
    if (sameColor && (kind === "stroke" || kind === "fill" || kind === "text") && !knockoutScopes.has(siblings) &&
        previous?.kind === kind && previous.first + previous.count === first &&
        previous.clipIndex === clipIndex && previous.optionalContent === condition) {
      previous.count += amount; return;
    }
    const runIndex = scene.drawRuns!.length;
    runColors.push(paintColor);
    scene.drawRuns!.push({ kind, first, count: amount, ...(clipIndex === undefined ? {} : { clipIndex }), ...(condition === undefined ? {} : { optionalContent: condition }) });
    stack.at(-1)!.push({ kind: "draw", runIndex });
  };
  const fill = (g: Geometry, rgba: Color, rule: number, clip: DensePdfTextClip | null, condition?: number): void => {
    if (!g.a.length) return; budget(g.a.length + g.b.length);
    const index = fillsA.length / 4, first = segmentsA.length / 4;
    append(segmentsA, g.a); append(segmentsB, g.b);
    fillsA.push(first, g.a.length / 4, g.bounds.minX, g.bounds.minY); fillsB.push(g.bounds.maxX, g.bounds.maxY, rgba[0], rgba[1]); fillsC.push(rule, 0, rgba[2], rgba[3]);
    appendRun("fill", index, 1, clip, condition, rgba);
  };
  /**
   * Glyph outlines are shared. An atlas entry holds the outline with its 2x2
   * applied but no placement; the instance carries the translation, so a
   * repeated glyph costs one instance instead of another copy of its curves.
   * Baking placement into the outline would give every drawn glyph its own
   * entry, which `optimizeVectorSceneTextGlyphs` cannot merge because the
   * coordinates differ. The 2x2 stays in the key so cubic flattening keeps the
   * absolute tolerance it already resolved at, never a font-unit scale.
   */
  const textGeometry = (key: string, placement: PdfMatrix, rgba: Color, clip: DensePdfTextClip | null,
    condition: number | undefined, build: () => Geometry | null): void => {
    let atlas = glyphAtlas.get(key);
    if (atlas === undefined) {
      const g = build();
      if (!g?.a.length) { glyphAtlas.set(key, -1); return; }
      budget(g.a.length + g.b.length);
      atlas = glyphMetaA.length / 4;
      const first = glyphA.length / 4;
      append(glyphA, g.a); append(glyphB, g.b);
      glyphMetaA.push(first, g.a.length / 4, g.bounds.minX, g.bounds.minY); glyphMetaB.push(g.bounds.maxX, g.bounds.maxY, 0, 0);
      glyphAtlas.set(key, atlas);
    } else {
      if (atlas < 0) return;
      budget(0);
    }
    const index = textA.length / 4;
    textA.push(1, 0, 0, 1); textB.push(placement[4], placement[5], atlas, 0); textC.push(...rgba);
    appendRun("text", index, 1, clip, condition, rgba);
  };
  const text = (glyph: number, indices: readonly number[], placement: PdfMatrix, rgba: Color,
    clip: DensePdfTextClip | null, condition?: number): void => {
    const { fontIndices, glyphIds } = page.stores.glyphs;
    const [a, b, c, d] = placement;
    textGeometry(`fill:${fontIndices[glyph]}:${glyphIds[glyph]}:${a}:${b}:${c}:${d}`, placement, rgba, clip, condition,
      () => geometry(indices, [a, b, c, d, 0, 0]));
  };
  const strokeStyle = (index: number, matrix: PdfMatrix): NativeGlyphStrokeStyle => {
    const strokes = page.stores.strokes;
    return { transform: matrix, width: strokes.lineWidths[index], lineCap: strokes.lineCaps[index] as 0 | 1 | 2,
      lineJoin: strokes.lineJoins[index] as 0 | 1 | 2, miterLimit: strokes.miterLimits[index],
      dashArray: Array.from(strokes.dashValues.subarray(strokes.dashOffsets[index], strokes.dashOffsets[index + 1])),
      dashPhase: strokes.dashPhases[index] };
  };
  const packedStroke = (g: NonNullable<ReturnType<typeof buildNativeGlyphHairline>>, placement: ArrayLike<number>,
    rgba: Color, clip: DensePdfTextClip | null, condition?: number, halfWidth = 0): void => {
    // Opaque contour segments form a union in the isolated surface; apply the
    // glyph/path opacity once so adjacent segments do not darken their joins.
    const translucent = rgba[3] < 1;
    if (translucent) {
      const group: ScenePaintGroup = { kind: "group", children: [], alpha: rgba[3], isolated: true,
        knockout: false, blendMode: "Normal", optionalContent: condition };
      stack.at(-1)!.push(group); stack.push(group.children);
    }
    const first = endpoints.length / 4, x = placement[4], y = placement[5];
    for (let offset = 0; offset < g.endpoints.length; offset += 4) {
      budget(16);
      endpoints.push(g.endpoints[offset] + x, g.endpoints[offset + 1] + y, g.endpoints[offset + 2] + x, g.endpoints[offset + 3] + y);
      const flags = Math.floor(g.primitiveMeta[offset + 3] / 2);
      primitiveMeta.push(g.primitiveMeta[offset] + x, g.primitiveMeta[offset + 1] + y, g.primitiveMeta[offset + 2],
        (halfWidth > 0 ? flags & ~1 : flags) * 2 + 1);
      primitiveBounds.push(g.primitiveBounds[offset] + x, g.primitiveBounds[offset + 1] + y, g.primitiveBounds[offset + 2] + x, g.primitiveBounds[offset + 3] + y);
      styles.push(halfWidth, rgba[0], rgba[1], rgba[2]);
    }
    scene.maxHalfWidth = Math.max(scene.maxHalfWidth, halfWidth);
    appendRun("stroke", first, g.endpoints.length / 4, clip, condition, rgba);
    if (translucent) stack.pop();
    if (g.approximated && !reportedHairlineCurveApproximation) {
      reportedHairlineCurveApproximation = true;
      options.onDiagnostic?.({ code: "glyph-stroke-curve-approximation", severity: "warning", pageIndex: page.pageInfo.sourcePageIndex,
        message: "Stroke curves use vector centerlines with a maximum 0.01-point subdivision tolerance." });
    }
    if (g.approximateStyle && !reportedHairlineStyleApproximation) {
      reportedHairlineStyleApproximation = true;
      options.onDiagnostic?.({ code: "glyph-hairline-style-approximation", severity: "warning", pageIndex: page.pageInfo.sourcePageIndex,
        message: "Hairline joins and square caps use rounded device-pixel coverage; their contours remain vector." });
    }
  };
  const omitStrokeError = (error: unknown, omittable: boolean): void => {
    if (!omittable || !(error instanceof PdfError) || error.details?.reason !== "native-glyph-stroke-complexity") throw error;
    if (!reportedGlyphStrokeComplexity) {
      reportedGlyphStrokeComplexity = true;
      options.onDiagnostic?.({ code: "glyph-stroke-complexity", severity: "warning",
        message: "A glyph outline was too intricate to stroke and is omitted; the rest of the page stays vector.",
        details: { reason: "native-glyph-stroke-complexity" } });
    }
  };
  /**
   * `omittable` says the shape survives without this outline, because a fill
   * paints it too. Only then may an outline too intricate to build be left out;
   * a shape that has nothing else would simply vanish, so its page falls back
   * to a bounded raster instead, where the ink is at least still there.
   */
  const strokeGeometry = (indices: readonly number[], matrix: PdfMatrix, style: number,
    omittable = false): Geometry | null => {
    let g;
    try {
      g = buildNativeGlyphStroke(pathCommands(indices), matrix, strokeStyle(style, matrix), signal);
    } catch (error) {
      omitStrokeError(error, omittable);
      return null;
    }
    return g ? { a: g.segmentsA, b: g.segmentsB, bounds: g.bounds } : null;
  };
  const strokePath = (indices: readonly number[], matrix: PdfMatrix, style: number, rgba: Color,
    clip: DensePdfTextClip | null, condition?: number, omittable = false): void => {
    if (page.stores.strokes.lineWidths[style] === 0) {
      if (rgba[3] <= 1e-3) return;
      const g = buildNativeGlyphHairline(pathCommands(indices), matrix, strokeStyle(style, matrix), signal);
      if (g) packedStroke(g, IDENTITY, rgba, clip, condition);
      return;
    }
    // Preserve the centerline when the packed renderer can represent the pen
    // exactly. Expanding a thin line to a fill is both expensive and unstable
    // under minification because its two edges can fall between pixel centers.
    const stroke = strokeStyle(style, matrix), strokes = page.stores.strokes;
    const scaleX = Math.hypot(matrix[0], matrix[1]), scaleY = Math.hypot(matrix[2], matrix[3]);
    const uniform = scaleX > 0 && scaleY > 0 && Math.abs(scaleX - scaleY) <= 1e-6 * Math.max(scaleX, scaleY) &&
      Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) <= scaleX * scaleY * 1e-6;
    if (uniform && stroke.dashArray.length === 0 && (strokes.flags[style] & HEPR_STROKE_FLAG.StrokeAdjust) === 0) {
      const commands = pathCommands(indices);
      const singleLine = commands.length === 2 && commands[0].kind === "move" && commands[1].kind === "line";
      if (stroke.lineCap === 1 && (stroke.lineJoin === 1 || singleLine)) {
        if (rgba[3] <= 1e-3) return;
        const g = buildNativeGlyphHairline(commands, matrix, { ...stroke, width: 0 }, signal);
        if (g) packedStroke(g, IDENTITY, rgba, clip, condition, stroke.width * scaleX * 0.5);
        return;
      }
    }
    const g = strokeGeometry(indices, matrix, style, omittable);
    if (g) fill(g, rgba, 0, clip, condition);
  };
  const strokeText = (glyph: number, indices: readonly number[], placement: PdfMatrix, pen: PdfMatrix,
    style: number, rgba: Color, clip: DensePdfTextClip | null, condition: number | undefined, omittable: boolean): void => {
    const stroke = strokeStyle(style, pen), { fontIndices, glyphIds } = page.stores.glyphs;
    const key = `stroke:${nativeGlyphStrokeCacheKey(fontIndices[glyph], glyphIds[glyph], placement, stroke)}`;
    if (stroke.width === 0) {
      if (rgba[3] <= 1e-3) return;
      let g = hairlineAtlas.get(key);
      if (g === undefined) {
        g = buildNativeGlyphHairline(pathCommands(indices), [placement[0], placement[1], placement[2], placement[3], 0, 0], stroke, signal);
        hairlineAtlas.set(key, g);
      }
      if (!g) return;
      packedStroke(g, placement, rgba, clip, condition);
      return;
    }
    try {
      textGeometry(key, placement, rgba, clip, condition, () => {
        const g = buildNativeGlyphStrokeAtOrigin(pathCommands(indices), placement, stroke, signal);
        return g ? { a: g.segmentsA, b: g.segmentsB, bounds: g.bounds } : null;
      });
    } catch (error) { omitStrokeError(error, omittable); }
  };
  const gradient = async (index: number, matrix: PdfMatrix, alpha: number, clip: DensePdfTextClip | null,
    condition?: number, shape?: Geometry, paintBackground = false): Promise<void> => {
    const data = await buildHeprVectorGradient(page, index, matrix, shape?.bounds ?? scene.pageBounds, alpha, { signal, paintBackground });
    const paint = gradients.length;
    const meshBackground = data.gradientMetaA[0] === 2 && data.gradientMetaA[3] > 0;
    const grouped = alpha !== 1 || meshBackground;
    if (grouped) {
      const group: ScenePaintGroup = { kind: "group", children: [], alpha, isolated: true, knockout: false, blendMode: "Normal", optionalContent: condition };
      stack.at(-1)!.push(group); stack.push(group.children);
      data.gradientFillPathMetaC[3] = 1;
    }
    if (meshBackground) {
      const encoded = data.gradientMetaA[3] - 1, rgb: Color = [Math.floor(encoded / 65536) / 255, Math.floor(encoded / 256) % 256 / 255, encoded % 256 / 255, 1];
      const bounds = shape?.bounds ?? scene.pageBounds, { minX: x0, minY: y0, maxX: x1, maxY: y1 } = bounds;
      const rectangle: Geometry = { bounds, a: [x0,y0,x1,y0, x1,y0,x1,y1, x1,y1,x0,y1, x0,y1,x0,y0], b: [x1,y0,0,0, x1,y1,0,0, x0,y1,0,0, x0,y0,0,0] };
      let backgroundClip = clip;
      if (data.gradientMetaA[1]) {
        const [a, b, c, d] = data.gradientMetaE;
        backgroundClip = { parent: clip, fillRule: 0, path: { data: Float32Array.of(0,a,b,1,c,b,1,c,d,1,a,d,4),
          transform: [...matrix], bounds: { minX: a, minY: b, maxX: c, maxY: d } } };
      }
      fill(shape ?? rectangle, rgb, 0, backgroundClip, condition);
      data.gradientMetaA[3] = 0;
    }
    if (shape) {
      data.gradientFillSegmentsA = Float32Array.from(shape.a); data.gradientFillSegmentsB = Float32Array.from(shape.b);
      data.gradientFillSegmentCount = shape.a.length / 4;
      data.gradientFillPathMetaA[1] = data.gradientFillSegmentCount;
    }
    budget(data.gradientFillSegmentsA.length + data.gradientFillSegmentsB.length + (data.gradientMeshPositions?.length ?? 0));
    data.gradientFillPathMetaA[0] += gradientSegments;
    data.gradientFillPaintMeta[0] = paint;
    data.gradientFillPaintMeta[2] = scene.drawRuns!.length;
    if (data.gradientMeshRanges) data.gradientMeshRanges[0] += meshIndices;
    if (data.gradientMeshIndices) for (let i = 0; i < data.gradientMeshIndices.length; i++) data.gradientMeshIndices[i] += meshVertices;
    gradientSegments += data.gradientFillSegmentCount;
    meshVertices += (data.gradientMeshPositions?.length ?? 0) / 2;
    meshIndices += data.gradientMeshIndices?.length ?? 0;
    gradients.push(data); appendRun("gradient-fill", paint, 1, clip, condition);
    if (grouped) stack.pop();
  };
  const clipBoundsCache = new WeakMap<DensePdfTextClip, Bounds | null>();
  const clipBounds = (clip: DensePdfTextClip): Bounds | null => {
    if (clipBoundsCache.has(clip)) return clipBoundsCache.get(clip)!;
    const bounds = emptyBounds(), { data, transform: matrix } = clip.path;
    for (let offset = 0; offset < data.length;) {
      const op = data[offset++], size = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : op === 4 ? 0 : -1;
      if (size < 0 || offset + size > data.length) { clipBoundsCache.set(clip, null); return null; }
      for (let i = 0; i < size; i += 2) include(bounds, ...point(matrix, data[offset + i], data[offset + i + 1]));
      offset += size;
    }
    // Bezier control hulls give conservative bounds, including for curved/text clips.
    const result = Object.values(bounds).every(Number.isFinite) ? bounds : null;
    clipBoundsCache.set(clip, result); return result;
  };
  /** Conservative outline bounds, or the em box of an empty glyph, against its exact clips and the page. */
  const glyphReachesPage = (glyph: number, indices: readonly number[], local: PdfMatrix, clip: DensePdfTextClip | null): boolean => {
    const { fonts, paths } = page.stores, font = page.stores.glyphs.fontIndices[glyph], outline = emptyBounds();
    for (const path of indices) {
      include(outline, paths.bounds[path * 4], paths.bounds[path * 4 + 1]);
      include(outline, paths.bounds[path * 4 + 2], paths.bounds[path * 4 + 3]);
    }
    if (!Object.values(outline).every(Number.isFinite) || outline.minX === outline.maxX || outline.minY === outline.maxY) {
      outline.minX = 0; outline.maxX = fonts.unitsPerEm[font]; outline.minY = fonts.descents[font]; outline.maxY = fonts.ascents[font];
    }
    const reach = emptyBounds(), visible = { ...scene.pageBounds };
    for (const x of [outline.minX, outline.maxX]) for (const y of [outline.minY, outline.maxY]) include(reach, ...point(local, x, y));
    for (let scope = clip; scope; scope = scope.parent) {
      const bounds = clipBounds(scope);
      if (!bounds) continue;
      visible.minX = Math.max(visible.minX, bounds.minX); visible.minY = Math.max(visible.minY, bounds.minY);
      visible.maxX = Math.min(visible.maxX, bounds.maxX); visible.maxY = Math.min(visible.maxY, bounds.maxY);
    }
    if (reach.maxX < visible.minX || reach.minX > visible.maxX || reach.maxY < visible.minY || reach.minY > visible.maxY) return false;
    return !clip || !glyphClipTester.isFullyOutside(reach, clip, signal);
  };
  const patternActive = new Set<number>();
  let draw: (execution: HeprDrawRunExecution, inheritedClip?: DensePdfTextClip | null, inheritedCondition?: number,
    inheritedItem?: number) => Promise<void>;
  const pattern = async (paint: number, g: Geometry, matrix: PdfMatrix, clip: DensePdfTextClip | null, rule: number, condition?: number): Promise<void> => {
    const resolved = resolveHeprPatternPaint(page, paint);
    if (!resolved) return fail("missing pattern resource.");
    if (resolved.kind === "shading") {
      await gradient(resolved.gradientIndex, multiplyHeprMatrices(matrix, resolved.patternToOwnerTransform),
        page.stores.paints.alphas[paint], clipFromGeometry(g, clip, rule), condition, g, true);
      return;
    }
    if (patternActive.has(resolved.patternIndex) || patternActive.size >= 16) return fail("recursive pattern expansion.");
    const toScene = multiplyHeprMatrices(matrix, resolved.patternToOwnerTransform), [a, b, c, d, e, f] = toScene, det = a * d - b * c;
    if (Math.abs(det) < 1e-12) return fail("singular pattern transform.");
    const inverse: PdfMatrix = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
    const bnd = { minX: Math.max(g.bounds.minX, scene.pageBounds.minX), minY: Math.max(g.bounds.minY, scene.pageBounds.minY),
      maxX: Math.min(g.bounds.maxX, scene.pageBounds.maxX), maxY: Math.min(g.bounds.maxY, scene.pageBounds.maxY) };
    for (let scope = clip; scope; scope = scope.parent) {
      const bounds = clipBounds(scope);
      if (bounds) { bnd.minX = Math.max(bnd.minX, bounds.minX); bnd.minY = Math.max(bnd.minY, bounds.minY);
        bnd.maxX = Math.min(bnd.maxX, bounds.maxX); bnd.maxY = Math.min(bnd.maxY, bounds.maxY); }
    }
    if (bnd.maxX <= bnd.minX || bnd.maxY <= bnd.minY) return;
    const points = [point(inverse, bnd.minX, bnd.minY), point(inverse, bnd.maxX, bnd.minY), point(inverse, bnd.minX, bnd.maxY), point(inverse, bnd.maxX, bnd.maxY)];
    const local = { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) };
    const patterns = page.stores.patterns, p = resolved.patternIndex, bounds = patterns.bounds.subarray(p * 4, p * 4 + 4), xs = patterns.xSteps[p], ys = patterns.ySteps[p];
    const range = (lo: number, hi: number, c0: number, c1: number, step: number): [number, number] => {
      const first = (lo - c1) / step, last = (hi - c0) / step;
      return [Math.floor(Math.min(first, last)) + 1, Math.ceil(Math.max(first, last)) - 1];
    };
    const [x0, x1] = range(local.minX, local.maxX, bounds[0], bounds[2], xs), [y0, y1] = range(local.minY, local.maxY, bounds[1], bounds[3], ys);
    const amount = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > maxCells - cells) throw new PdfError("resource-limit", "Vector tiling pattern exceeds its cell budget.", { details: { reason: "vector-expansion-limit" } });
    cells += amount; patternActive.add(p);
    const paintedClip = clipFromGeometry(g, clip, rule);
    const baseTransform = page.stores.transforms.values.length / 6, transforms = new Float32Array(page.stores.transforms.values.length + (resolved.basePaintIndex >= 0 ? 12 : 6));
    transforms.set(page.stores.transforms.values);
    const wrapperTransform = baseTransform + 1;
    if (resolved.basePaintIndex >= 0) transforms.set(IDENTITY, wrapperTransform * 6);
    // The executor models inherited paint on Type3 invocations. An uncolored
    // pattern uses the same adapter as the retained Canvas backend.
    const programs = resolved.basePaintIndex < 0 ? page.displayProgram.programs : [...page.displayProgram.programs, {
      kind: "type3" as const, matrixIndex: wrapperTransform, bounds: null, clipToBounds: false,
      resourceName: "Vector uncolored-pattern paint adapter",
      commands: [{ kind: "invoke-program" as const, transformIndex: wrapperTransform, clipIndex: -1,
        optionalContentIndex: -1, markedContentIndex: -1, sourceOffset: -1, sourceLength: -1,
        programIndex: resolved.programIndex, type3PaintIndex: -1, viewTransformFlags: 0 }]
    }];
    const programIndex = resolved.basePaintIndex < 0 ? resolved.programIndex : page.displayProgram.programs.length;
    const root = { ...page.displayProgram.groups[page.displayProgram.rootGroupIndex], alpha: 1, alphaIsShape: false, isolated: true, knockout: false, blendMode: "Normal" as const, softMaskGroupIndex: -1, softMaskSubtype: null, softMaskTransferFunctionIndex: -1, backdropPaintIndex: -1, blendingColorSpaceIndex: -1, clipIndex: -1,
      commands: [{ kind: "invoke-program" as const, transformIndex: baseTransform, clipIndex: -1, optionalContentIndex: -1, markedContentIndex: -1, sourceOffset: -1, sourceLength: -1, programIndex, type3PaintIndex: resolved.basePaintIndex, viewTransformFlags: 0 }] };
    const stores = { ...page.stores, transforms: { values: transforms } };
    const displayProgram = { ...page.displayProgram, programs, rootGroupIndex: page.displayProgram.groups.length, groups: [...page.displayProgram.groups, root] };
    const group: ScenePaintGroup = { kind: "group", children: [], alpha: page.stores.paints.alphas[paint],
      isolated: true, knockout: false, blendMode: "Normal", optionalContent: condition };
    stack.at(-1)!.push(group); stack.push(group.children);
    try {
      // The top-level execution validated `page`, and the root, adapter and wrapper
      // transform above only reference its valid indices. The cell matrix is the one
      // new value, so each tile checks it after Float32 storage instead of
      // revalidating the whole page.
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        signal.throwIfAborted();
        transforms.set(multiplyHeprMatrices(toScene, [1, 0, 0, 1, x * xs, y * ys]), baseTransform * 6);
        if (!transforms.subarray(baseTransform * 6, baseTransform * 6 + 6).every(Number.isFinite)) { skippedPatternCells++; continue; }
        // A page object per tile keeps each cell's soft-mask executions apart.
        await executeHeprDisplayProgram({ ...page, stores, displayProgram }, backend(paintedClip, condition, currentItem), { signal, trustedPage: true });
      }
    } finally { stack.pop(); patternActive.delete(p); }
  };
  const drawContent = async (execution: HeprDrawRunExecution, inheritedClip?: DensePdfTextClip | null, inheritedCondition?: number): Promise<void> => {
    if (performance.now() - lastYield > 8) { await new Promise<void>(resolve => setTimeout(resolve, 0)); lastYield = performance.now(); }
    signal.throwIfAborted();
    const command = execution.command, matrix = execution.state.transform, condition = combine(execution.state, inheritedCondition);
    let clip = clipScope(execution.state.clips);
    if (inheritedClip) {
      // Pattern-cell clips are nested inside the painted path's clipping scope.
      const attach = (node: DensePdfTextClip | null): DensePdfTextClip => node ? { ...node, parent: attach(node.parent) } : inheritedClip;
      clip = attach(clip);
    }
    // A static scene has no viewer zoom or rotation to counter-transform, so
    // NoZoom/NoRotate appearances keep their page geometry, as rasters do.
    if (execution.state.viewTransformFlags && !reportedViewTransformApproximation) {
      reportedViewTransformApproximation = true;
      options.onDiagnostic?.({ code: "annotation.view-transform-approximated", severity: "warning", pageIndex: page.pageInfo.sourcePageIndex,
        message: "NoZoom/NoRotate annotation appearances use page geometry and scale with the page." });
    }
    if (command.source === "fill-paths") {
      const store = page.stores.paths, rgba = color(command.paintIndex, execution.state);
      for (let path = command.first; path < command.first + command.count; path++) {
        const offset = path * 4, first = store.fillPathMetaA[offset], end = first + store.fillPathMetaA[offset + 1];
        const g: Geometry = { a: [], b: [], bounds: emptyBounds() };
        for (let segment = first; segment < end; segment++) { const i = segment * 4;
          const p0 = point(matrix, store.fillSegmentsA[i], store.fillSegmentsA[i + 1]), c = point(matrix, store.fillSegmentsA[i + 2], store.fillSegmentsA[i + 3]), p1 = point(matrix, store.fillSegmentsB[i], store.fillSegmentsB[i + 1]);
          g.a.push(...p0, ...c); g.b.push(...p1, store.fillSegmentsB[i + 2], 0); for (const p of [p0, c, p1]) include(g.bounds, ...p);
        }
        fill(g, rgba, store.fillPathMetaC[offset], clip, condition);
      }
    } else if (command.source === "stroke-segments") {
      const store = page.stores.strokes, rgba = color(command.paintIndex, execution.state), scaleX = Math.hypot(matrix[0], matrix[1]), scaleY = Math.hypot(matrix[2], matrix[3]);
      if (Math.abs(scaleX - scaleY) > 1e-6 * Math.max(scaleX, scaleY) || Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) > 1e-6) return fail("nonuniform packed stroke transform.");
      const first = endpoints.length / 4;
      for (let stroke = command.first; stroke < command.first + command.count; stroke++) { budget(16); const i = stroke * 4;
        // Keep transformed coordinates in double precision until every output
        // (especially the expanded bounds) is computed, then round each once.
        const x0 = matrix[0] * store.endpoints[i] + matrix[2] * store.endpoints[i + 1] + matrix[4];
        const y0 = matrix[1] * store.endpoints[i] + matrix[3] * store.endpoints[i + 1] + matrix[5];
        const cx = matrix[0] * store.endpoints[i + 2] + matrix[2] * store.endpoints[i + 3] + matrix[4];
        const cy = matrix[1] * store.endpoints[i + 2] + matrix[3] * store.endpoints[i + 3] + matrix[5];
        const x1 = matrix[0] * store.primitiveMeta[i] + matrix[2] * store.primitiveMeta[i + 1] + matrix[4];
        const y1 = matrix[1] * store.primitiveMeta[i] + matrix[3] * store.primitiveMeta[i + 1] + matrix[5];
        const flags = Math.floor(store.primitiveMeta[i + 3] / 2), alpha = store.primitiveMeta[i + 3] - flags * 2, half = store.styles[i] * scaleX;
        endpoints.push(x0, y0, cx, cy); primitiveMeta.push(x1, y1, store.primitiveMeta[i + 2], flags * 2 + rgba[3] * alpha); styles.push(half, rgba[0], rgba[1], rgba[2]);
        primitiveBounds.push(Math.min(x0, cx, x1) - half, Math.min(y0, cy, y1) - half, Math.max(x0, cx, x1) + half, Math.max(y0, cy, y1) + half); scene.maxHalfWidth = Math.max(scene.maxHalfWidth, half);
      }
      appendRun("stroke", first, command.count, clip, condition);
    } else if (command.source === "paths") {
      for (let index = command.first; index < command.first + command.count; index++) {
        const g = geometry([index], matrix);
        const fillPaint = command.fillPaintInherited ? execution.state.type3PaintIndex : command.fillPaintIndex;
        if (fillPaint >= 0) {
          if (page.stores.paints.kinds[fillPaint] === HEPR_PAINT_KIND.Pattern) await pattern(fillPaint, g, multiplyHeprMatrices(matrix, inverseMatrix(transform(command.transformIndex))), clip, command.fillRule, condition);
          else fill(g, color(fillPaint, execution.state), command.fillRule, clip, condition);
        }
        const strokePaint = command.strokePaintInherited ? execution.state.type3PaintIndex : command.strokePaintIndex;
        if (strokePaint >= 0) {
          if (page.stores.paints.kinds[strokePaint] === HEPR_PAINT_KIND.Pattern) {
            const outline = strokeGeometry([index], matrix, command.strokeStyleIndex);
            if (outline) await pattern(strokePaint, outline, multiplyHeprMatrices(matrix, inverseMatrix(transform(command.transformIndex))), clip, 0, condition);
          } else strokePath([index], matrix, command.strokeStyleIndex, color(strokePaint, execution.state), clip, condition);
        }
      }
    } else if (command.source === "glyphs") {
      for (let glyph = command.first; glyph < command.first + command.count; glyph++) {
        glyphConditions[glyph] = condition ?? -1;
        const indices = glyphPaths(glyph), local = multiplyHeprMatrices(matrix, transform(page.stores.glyphs.transformIndices[glyph]));
        const firstInstance = textA.length / 4;
        if ([0, 2, 4, 6].includes(command.renderingMode) && command.fillPaintIndex >= 0) text(glyph, indices, local, color(command.fillPaintIndex, execution.state), clip, condition);
        // Modes 2 and 6 fill the glyph as well, so its shape survives an
        // outline this renderer cannot build; modes 1 and 5 have only the stroke.
        if ([1, 2, 5, 6].includes(command.renderingMode) && command.strokePaintIndex >= 0) {
          strokeText(glyph, indices, local, command.strokeTransformIndex === undefined ? local
            : multiplyHeprMatrices(matrix, transform(command.strokeTransformIndex)), command.strokeStyleIndex, color(command.strokePaintIndex, execution.state),
            clip, condition, command.renderingMode === 2 || command.renderingMode === 6);
        }
        if (!glyphReachesPage(glyph, indices, local, clip)) {
          if (glyphReach[glyph] === 0) glyphReach[glyph] = 1;
          continue;
        }
        glyphReach[glyph] = 2;
        if (glyphInstances[glyph] < 0 && textA.length / 4 > firstInstance) glyphInstances[glyph] = firstInstance;
      }
    } else if (command.source === "gradients") {
      for (let index = command.first; index < command.first + command.count; index++) await gradient(index, matrix, 1, clip, condition);
    } else if (command.source === "images") {
      const images = page.stores.images;
      for (let index = command.first; index < command.first + command.count; index++) {
        // Each of these needs a different preparation, and which one it is
        // decides whether a page keeps its vectors, so name them apart.
        // Each of these needs a different preparation, and which one it is
        // decides whether a page keeps its vectors, so name them apart.
        if (images.imageMask[index]) return fail("a stencil image mask requires preparation.");
        if (images.matteOffsets[index + 1] > images.matteOffsets[index]) return fail("a pre-multiplied image matte requires preparation.");
        let data = imagePixels.get(index);
        if (!data) {
          // Raster layers are straight RGBA8; a grayscale store widens once here.
          const expanded = expandHeprImageToRgba8(images.data.subarray(images.dataOffsets[index], images.dataOffsets[index + 1]),
            images.formats[index], images.widths[index], images.heights[index], signal);
          if (!expanded) return fail(`an image stored as format ${images.formats[index]} requires a codec.`);
          const maskIndex = images.softMaskImageIndices[index];
          if (maskIndex < 0) data = expanded;
          else {
            const mask = expandHeprImageToRgba8(images.data.subarray(images.dataOffsets[maskIndex], images.dataOffsets[maskIndex + 1]),
              images.formats[maskIndex], images.widths[maskIndex], images.heights[maskIndex], signal);
            if (!mask) return fail(`an image soft mask stored as format ${images.formats[maskIndex]} requires a codec.`);
            // An Rgba8 store widens to itself, so the alpha is written into a
            // copy rather than back into the page's own image bytes.
            data = applyHeprImageSoftMask(Uint8Array.from(expanded), images.widths[index], images.heights[index],
              mask, images.widths[maskIndex], images.heights[maskIndex], signal);
          }
          imagePixels.set(index, data);
        }
        const first = scene.rasterLayers.length; budget(6);
        scene.rasterLayers.push({ width: images.widths[index], height: images.heights[index], data, matrix: Float32Array.from(multiplyHeprMatrices(matrix, [1, 0, 0, -1, 0, 1])), paintOrder: first, pageIndex: 0 });
        appendRun("raster", first, 1, clip, condition);
      }
    } else return fail(`${command.source} requires a specialized vector adapter.`);
  };
  // Pattern cells run as separate programs; they keep the painting command's item.
  draw = async (execution, inheritedClip, inheritedCondition, inheritedItem = -1) => {
    const previous = currentItem, own = itemOf(execution.state.markedContent);
    currentItem = own >= 0 ? own : inheritedItem;
    try { await drawContent(execution, inheritedClip, inheritedCondition); } finally { currentItem = previous; }
  };
  const backend = (inheritedClip?: DensePdfTextClip | null, inheritedCondition?: number, inheritedItem = -1): HeprDisplayBackend => ({
    drawRun: execution => draw(execution, inheritedClip, inheritedCondition, inheritedItem),
    beginProgram(execution) {
      if (execution.program.kind !== "type3") return;
      const condition = combine(execution.state, inheritedCondition);
      for (let glyph = 0; glyph < page.stores.glyphs.glyphIds.length; glyph++) {
        if (page.stores.glyphs.transformIndices[glyph] === execution.invocationCommand.transformIndex) glyphConditions[glyph] = condition ?? -1;
      }
    },
    beginCompositeGroup(execution) {
      let executionMasks = masks.get(execution.page);
      if (!executionMasks) masks.set(execution.page, executionMasks = new Map());
      const children: ScenePaintNode[] = [];
      const node: ScenePaintGroup = { kind: "group", children, alpha: execution.alpha, isolated: execution.isolated, knockout: execution.knockout,
        blendMode: execution.blendMode, alphaIsShape: execution.alphaIsShape, optionalContent: combine(execution.state, inheritedCondition) };
      if (execution.blendingColorSpaceIndex >= 0 && page.stores.colors.spaceKinds[execution.blendingColorSpaceIndex] !== HEPR_COLOR_SPACE_KIND.DeviceRgb) {
        options.onDiagnostic?.({ code: "compositing-approximation", severity: "warning", pageIndex: page.pageInfo.sourcePageIndex,
          message: "A transparency group's explicit blending color space is approximated in sRGB.",
          details: { colorSpaceIndex: execution.blendingColorSpaceIndex } });
      }
      if (execution.softMaskExecutionId !== null) {
        const mask = executionMasks.get(execution.softMaskExecutionId); if (!mask) return fail("missing soft-mask graph.");
        node.softMask = { ...mask, subtype: execution.softMaskSubtype ?? "Alpha" };
        if (execution.softMaskTransferFunctionIndex >= 0) {
          node.softMask.transfer = Float32Array.from({ length: 1024 }, (_, index) => functions.evaluate(execution.softMaskTransferFunctionIndex, [index / 1023], { signal })[0]);
        }
      }
      if (execution.role === "soft-mask") {
        const rgba = execution.backdropPaintIndex >= 0 ? color(execution.backdropPaintIndex, execution.state) : undefined;
        executionMasks.set(execution.executionId, { children: [node], ...(rgba ? { backdrop: [rgba[0], rgba[1], rgba[2]] } : {}) });
      }
      else stack.at(-1)!.push(node);
      if (node.knockout) knockoutScopes.add(children);
      groupScopes.set(children, node);
      stack.push(children);
    },
    endCompositeGroup(_execution, outcome) {
      const children = stack.pop()!, group = groupScopes.get(children);
      if (outcome.status !== "complete" || !group || group.alpha === 1 || group.alphaIsShape ||
          group.knockout || group.softMask || group.blendMode !== "Normal" || children.length !== 1 ||
          stack.some(scope => knockoutScopes.has(scope) || groupScopes.get(scope)?.alphaIsShape)) return;
      const child = children[0];
      if (child.kind !== "draw") return;
      const run = scene.drawRuns![child.runIndex];
      if (run.count !== 1 || run.blendMode) return;
      const output = run.kind === "fill" ? fillsC : run.kind === "text" ? textC : null;
      if (!output) return;
      // One analytic fill/glyph already evaluates its full coverage as a unit.
      // Moving Normal group opacity onto that one paint gives identical
      // source-over output, including antialiased edges, without a surface.
      // Keep the node and its visibility scope; knockout/shape passes above
      // deliberately keep their opacity boundary instead of changing shape.
      output[run.first * 4 + 3] *= group.alpha;
      group.alpha = 1;
    }
  });
  await executeHeprDisplayProgram(page, backend(), { signal });
  scene.fillPathCount = fillsA.length / 4; scene.fillSegmentCount = segmentsA.length / 4;
  scene.fillPathMetaA = Float32Array.from(fillsA); scene.fillPathMetaB = Float32Array.from(fillsB); scene.fillPathMetaC = Float32Array.from(fillsC);
  scene.fillSegmentsA = Float32Array.from(segmentsA); scene.fillSegmentsB = Float32Array.from(segmentsB);
  scene.endpoints = endpoints.take(); scene.primitiveMeta = primitiveMeta.take(); scene.primitiveBounds = primitiveBounds.take(); scene.styles = styles.take();
  scene.textInstanceA = Float32Array.from(textA); scene.textInstanceB = Float32Array.from(textB); scene.textInstanceC = Float32Array.from(textC);
  scene.textGlyphMetaA = Float32Array.from(glyphMetaA); scene.textGlyphMetaB = Float32Array.from(glyphMetaB); scene.textGlyphSegmentsA = Float32Array.from(glyphA); scene.textGlyphSegmentsB = Float32Array.from(glyphB);
  scene.textInstanceCount = textA.length / 4; scene.textGlyphCount = glyphMetaA.length / 4; scene.textGlyphSegmentCount = glyphA.length / 4; scene.pageTextRanges[1] = scene.textInstanceCount;
  scene.segmentCount = scene.endpoints.length / 4; scene.sourceSegmentCount = scene.segmentCount; scene.mergedSegmentCount = scene.segmentCount;
  scene.imageLayerSegmentCount = 0;
  scene.clipPaths = clipBuilder.paths;
  if (gradients.length) {
    const floats = (key: keyof GradientSceneData): Float32Array => {
      const parts = gradients.map(part => part[key] as Float32Array | undefined), result = new Float32Array(parts.reduce((sum, part) => sum + (part?.length ?? 0), 0));
      let offset = 0; for (const part of parts) if (part) { result.set(part, offset); offset += part.length; } return result;
    };
    for (const key of ["gradientMetaA", "gradientMetaB", "gradientMetaC", "gradientMetaD", "gradientMetaE", "gradientFillPathMetaA", "gradientFillPathMetaB", "gradientFillPathMetaC", "gradientFillPaintMeta", "gradientFillSegmentsA", "gradientFillSegmentsB", "gradientMeshPositions", "gradientMeshColors"] as const) scene[key] = floats(key);
    scene.gradientLut = Uint8Array.from(gradients.flatMap(part => Array.from(part.gradientLut)));
    scene.gradientMeshRanges = Uint32Array.from(gradients.flatMap(part => Array.from(part.gradientMeshRanges ?? [0, 0])));
    scene.gradientMeshIndices = Uint32Array.from(gradients.flatMap(part => Array.from(part.gradientMeshIndices ?? [])));
    scene.gradientCount = scene.gradientFillPathCount = gradients.length; scene.gradientFillSegmentCount = gradientSegments;
  }
  const optionalContent = annotationLayers.build();
  if (optionalContent) scene.optionalContent = optionalContent;
  if (!itemRanges.isEmpty) scene.markedContent = {
    items: contentItems.map(({ mcid, tag }) => ({ pageIndex: 0, sourcePageIndex: page.pageInfo.sourcePageIndex, mcid, tag })),
    ranges: itemRanges.build()
  };
  if (ignoredFormContentItems) options.onDiagnostic?.({ code: "structure.form-content-items", severity: "warning",
    pageIndex: page.pageInfo.sourcePageIndex,
    message: "Structure content items (MCIDs) inside Form XObjects are not attributed; their paint belongs to the enclosing page item, if any." });
  if (skippedPatternCells) options.onDiagnostic?.({ code: "pattern.cell-transform-overflow", severity: "warning",
    pageIndex: page.pageInfo.sourcePageIndex,
    message: `${skippedPatternCells} tiling pattern cell(s) were skipped because their placement exceeds the 32-bit float range.`,
    details: { cellCount: skippedPatternCells } });
  if (annotationLayers.unavailableCount) options.onDiagnostic?.({ code: "annotation.layer-limit", severity: "warning",
    pageIndex: page.pageInfo.sourcePageIndex,
    message: `${annotationLayers.unavailableCount} annotation appearance(s) exceed the layer limit and cannot be hidden individually.`,
    details: { annotationCount: annotationLayers.unavailableCount } });
  // Annotation layers alone condition text only when an appearance paints some.
  scene.textIndex = buildRetainedTextIndex(source, glyphInstances, glyphReach,
    options.optionalContent || (optionalContent && glyphConditions.some(condition => condition >= 0)) ? glyphConditions : undefined,
    options.textPositions, signal);
  scene.sourceTextCount = source.stores.glyphs.glyphIds.length;
  scene.pathCount = scene.fillPathCount + scene.segmentCount;
  scene.imagePaintOpCount = scene.rasterLayers.length;
  const image = scene.rasterLayers[0];
  if (image) { scene.rasterLayerWidth = image.width; scene.rasterLayerHeight = image.height; scene.rasterLayerData = image.data; scene.rasterLayerMatrix = image.matrix; }
  scene.pdfPages = [{ pageIndex: 0, sourcePageIndex: source.pageInfo.sourcePageIndex,
    pdfToScene: computeNativePdfPageGeometry(source.pageInfo).pageMatrix }];
  scene.annotations = source.annotations?.map(annotation => {
    const result = placeSceneAnnotation(annotation, 0);
    // Memberships address the page's PDF layers, not its annotation layers.
    if (!options.optionalContent) delete result.optionalContent;
    return result;
  });
  return scene;
}

/**
 * Search text for a lowered page. A painted glyph references its first vector
 * instance, a glyph with no visible placement leaves the index, whitespace is a
 * separator, and unpainted (OCR) text keeps a fallback quad in character order,
 * as the HEP char map requires. With pen positions, word breaks are inferred
 * exactly as on every other vector page; otherwise the parser's raw separators
 * are kept, never doubled, leading, or trailing.
 */
function buildRetainedTextIndex(page: HeprPageData, glyphInstances: Int32Array, glyphReach: Uint8Array,
  glyphConditions: Int32Array | undefined, positions: RetainedTextPositions | undefined, signal: AbortSignal): SceneTextIndex {
  const source = page.textIndex, fallback = buildNativeFallbackTextIndex(page, signal).pages[0];
  const quadOf = (index: number): Float32Array => {
    const slot = -fallback.charInstance[index] - 2;
    return fallback.fallbackQuads.subarray(slot * 4, slot * 4 + 4);
  };
  if (positions && positions.charOccurrences.length === source.charGlyphIndices.length) {
    const builder = new VectorPageTextIndexBuilder();
    for (let index = 0; index < source.charGlyphIndices.length;) {
      if ((index & 1023) === 0) signal.throwIfAborted();
      const occurrence = positions.charOccurrences[index];
      let end = index + 1;
      // The parser's positioning hints are superseded by the pen geometry.
      if (occurrence < 0) { index = end; continue; }
      while (end < source.charGlyphIndices.length && positions.charOccurrences[end] === occurrence) end++;
      const glyph = source.charGlyphIndices[index], unicode = source.text.slice(index, end), first = index;
      index = end;
      if (glyph >= 0 && glyphReach[glyph] === 1) continue;
      if (positions.gapBefore[occurrence]) builder.appendSeparator();
      if (unicode.trim().length === 0) { builder.appendSeparator(); continue; }
      const instance = glyph >= 0 ? glyphInstances[glyph] : -1, pen = occurrence * 5;
      builder.appendGlyph(unicode, instance, instance >= 0 ? null : quadOf(first),
        positions.pens[pen], positions.pens[pen + 1], positions.pens[pen + 2], positions.pens[pen + 3],
        positions.pens[pen + 4], glyph >= 0 ? glyphConditions?.[glyph] ?? -1 : -1);
    }
    return { version: 2, pages: [builder.build()] };
  }
  const text: string[] = [], references: number[] = [], quads: number[] = [], conditions: number[] = [];
  let separator: string | null = null;
  for (let index = 0; index < source.charGlyphIndices.length; index++) {
    if ((index & 1023) === 0) signal.throwIfAborted();
    const glyph = source.charGlyphIndices[index];
    if (glyph >= 0 && glyphReach[glyph] === 1) continue;
    // A decoded space glyph is a word boundary, not a searchable glyph.
    if (glyph === -1 || source.text[index].trim().length === 0) {
      const next = glyph === -1 ? source.text[index] : " ";
      if (text.length && (next === "\n" || separator === null)) separator = next;
      continue;
    }
    if (separator !== null) { text.push(separator); references.push(-1); conditions.push(-1); separator = null; }
    text.push(source.text[index]);
    conditions.push(glyph >= 0 ? glyphConditions?.[glyph] ?? -1 : -1);
    const instance = glyph >= 0 ? glyphInstances[glyph] : -1;
    if (instance >= 0) { references.push(instance); continue; }
    references.push(-2 - quads.length / 4);
    for (const value of quadOf(index)) quads.push(value);
  }
  return { version: 2, pages: [{ text: text.join(""), charInstance: Int32Array.from(references),
    fallbackQuads: Float32Array.from(quads), ...(glyphConditions ? { optionalContent: Int32Array.from(conditions) } : {}) }] };
}
