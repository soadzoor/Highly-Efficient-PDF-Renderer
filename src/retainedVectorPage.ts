import { createEmptyVectorScene } from "./emptyVectorScene";
import { HEPR_COLOR_SPACE_KIND, HEPR_PAINT_KIND, expandHeprImageToRgba8, type HeprPageData, type PdfMatrix } from "./heprDocumentData";
import { executeHeprDisplayProgram, multiplyHeprMatrices, resolveHeprPatternPaint, type HeprDisplayBackend,
  type HeprDrawRunExecution, type HeprExecutionClipScope, type HeprExecutionState } from "./heprDisplayExecutor";
import { visitHeprPath } from "./heprPathGeometry";
import { HeprFunctionEvaluator } from "./heprFunctionEvaluator";
import { HeprColorEvaluator } from "./heprColorEvaluator";
import { buildHeprVectorGradient } from "./retainedVectorGradient";
import type { GradientSceneData } from "./orderedGradientPaint";
import type { OptionalContentCondition, SceneOptionalContent } from "./optionalContentData";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { ScenePaintGroup, ScenePaintNode } from "./scenePaintGraph";
import { buildNativeFallbackTextIndex } from "./pdf/nativeRasterPage";
import { NativeVectorClipBuilder } from "./pdf/nativeVectorClips";
import { emitCubicAsQuadratics } from "./pdf/nativeVectorPage";
import { buildNativeGlyphStroke } from "./pdf/nativeGlyphStroke";
import type { NativeGlyphPathCommand } from "./pdf/nativeFont";
import type { DensePdfTextClip } from "./pdf/nativeContentCompiler";
import { PdfError } from "./pdf/nativeTypes";
import type { PdfDiagnostic } from "./pdf/nativeTypes";

const IDENTITY: PdfMatrix = [1, 0, 0, 1, 0, 0];
type Color = readonly [number, number, number, number];
interface Geometry { a: number[]; b: number[]; bounds: Bounds }
export interface RetainedVectorPageOptions {
  readonly optionalContent?: SceneOptionalContent;
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
  const conditions: OptionalContentCondition[] = [...(options.optionalContent?.conditions ?? [])];
  const conditionKeys = new Map<string, number>();
  const fillsA: number[] = [], fillsB: number[] = [], fillsC: number[] = [], segmentsA: number[] = [], segmentsB: number[] = [];
  const textA: number[] = [], textB: number[] = [], textC: number[] = [], glyphMetaA: number[] = [], glyphMetaB: number[] = [], glyphA: number[] = [], glyphB: number[] = [];
  const endpoints: number[] = [], primitiveMeta: number[] = [], primitiveBounds: number[] = [], styles: number[] = [];
  const clipBuilder = new NativeVectorClipBuilder(), clipCache = new WeakMap<HeprExecutionClipScope, DensePdfTextClip>();
  const glyphConditions = new Int32Array(page.stores.glyphs.glyphIds.length).fill(-1);
  let reportedGlyphStrokeComplexity = false;
  const stack: ScenePaintNode[][] = [scene.paintGraph.roots];
  const masks = new WeakMap<HeprPageData, Map<number, { children: ScenePaintNode[]; backdrop?: [number, number, number] }>>();
  const functions = new HeprFunctionEvaluator(page.stores.functions);
  const colors = new HeprColorEvaluator(page.stores.colors,
    (indices, inputs) => indices.flatMap(index => [...functions.evaluate(index, inputs, { signal })]), signal);
  const gradients: GradientSceneData[] = [];
  const imagePixels = new Map<number, Uint8Array>();
  const glyphAtlas = new Map<string, number>();
  let gradientSegments = 0, meshVertices = 0, meshIndices = 0;
  let count = 0, coordinates = 0, cells = 0, lastYield = performance.now();
  const fail = (message: string): never => { throw new PdfError("unsupported-content", `VectorScene retained program: ${message}`, { details: { reason: "vector-retained-program" } }); };
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
  const combine = (state: HeprExecutionState, inherited = -1): number | undefined => {
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
  const appendRun = (kind: "fill" | "stroke" | "raster" | "text" | "gradient-fill", first: number, amount: number, clip: DensePdfTextClip | null, condition?: number): void => {
    const runIndex = scene.drawRuns!.length, clipIndex = clipBuilder.add(clip, signal);
    scene.drawRuns!.push({ kind, first, count: amount, ...(clipIndex === undefined ? {} : { clipIndex }), ...(condition === undefined ? {} : { optionalContent: condition }) });
    stack.at(-1)!.push({ kind: "draw", runIndex });
  };
  const fill = (g: Geometry, rgba: Color, rule: number, clip: DensePdfTextClip | null, condition?: number): void => {
    if (!g.a.length) return; budget(g.a.length + g.b.length);
    const index = fillsA.length / 4, first = segmentsA.length / 4;
    append(segmentsA, g.a); append(segmentsB, g.b);
    fillsA.push(first, g.a.length / 4, g.bounds.minX, g.bounds.minY); fillsB.push(g.bounds.maxX, g.bounds.maxY, rgba[0], rgba[1]); fillsC.push(rule, 0, rgba[2], rgba[3]);
    appendRun("fill", index, 1, clip, condition);
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
  const text = (glyph: number, indices: readonly number[], placement: PdfMatrix, rgba: Color,
    clip: DensePdfTextClip | null, condition?: number): void => {
    const { fontIndices, glyphIds } = page.stores.glyphs;
    const [a, b, c, d, e, f] = placement;
    const key = `${fontIndices[glyph]}:${glyphIds[glyph]}:${a}:${b}:${c}:${d}`;
    let atlas = glyphAtlas.get(key);
    if (atlas === undefined) {
      const g = geometry(indices, [a, b, c, d, 0, 0]);
      if (!g.a.length) { glyphAtlas.set(key, -1); return; }
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
    textA.push(1, 0, 0, 1); textB.push(e, f, atlas, 0); textC.push(...rgba);
    appendRun("text", index, 1, clip, condition);
  };
  /**
   * `omittable` says the shape survives without this outline, because a fill
   * paints it too. Only then may an outline too intricate to build be left out;
   * a shape that has nothing else would simply vanish, so its page falls back
   * to a bounded raster instead, where the ink is at least still there.
   */
  const strokeGeometry = (indices: readonly number[], matrix: PdfMatrix, style: number,
    omittable = false): Geometry | null => {
    const strokes = page.stores.strokes;
    let g;
    try {
      g = buildNativeGlyphStroke(pathCommands(indices), matrix, { transform: matrix, width: strokes.lineWidths[style], lineCap: strokes.lineCaps[style] as 0 | 1 | 2,
        lineJoin: strokes.lineJoins[style] as 0 | 1 | 2, miterLimit: strokes.miterLimits[style], dashArray: Array.from(strokes.dashValues.subarray(strokes.dashOffsets[style], strokes.dashOffsets[style + 1])), dashPhase: strokes.dashPhases[style] }, signal);
    } catch (error) {
      // One glyph too intricate to outline must not cost the page its vectors:
      // everything else stays resolution independent and this outline is left
      // out, reported once rather than for each glyph sharing the shape.
      if (!omittable || !(error instanceof PdfError) ||
        error.details?.reason !== "native-glyph-stroke-complexity") throw error;
      if (!reportedGlyphStrokeComplexity) {
        reportedGlyphStrokeComplexity = true;
        options.onDiagnostic?.({ code: "glyph-stroke-complexity", severity: "warning",
          message: "A glyph outline was too intricate to stroke and is omitted; the rest of the page stays vector.",
          details: { reason: "native-glyph-stroke-complexity" } });
      }
      return null;
    }
    return g ? { a: g.segmentsA, b: g.segmentsB, bounds: g.bounds } : null;
  };
  const strokePath = (indices: readonly number[], matrix: PdfMatrix, style: number, rgba: Color,
    clip: DensePdfTextClip | null, condition?: number, omittable = false): void => {
    const g = strokeGeometry(indices, matrix, style, omittable);
    if (g) fill(g, rgba, 0, clip, condition);
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
  const patternActive = new Set<number>();
  let draw: (execution: HeprDrawRunExecution, inheritedClip?: DensePdfTextClip | null, inheritedCondition?: number) => Promise<void>;
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
    const bnd = g.bounds, points = [point(inverse, bnd.minX, bnd.minY), point(inverse, bnd.maxX, bnd.minY), point(inverse, bnd.minX, bnd.maxY), point(inverse, bnd.maxX, bnd.maxY)];
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
    const group: ScenePaintGroup = { kind: "group", children: [], alpha: page.stores.paints.alphas[paint],
      isolated: true, knockout: false, blendMode: "Normal", optionalContent: condition };
    stack.at(-1)!.push(group); stack.push(group.children);
    try {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        signal.throwIfAborted();
        const cellMatrix = multiplyHeprMatrices(toScene, [1, 0, 0, 1, x * xs, y * ys]);
        transforms.set(cellMatrix, baseTransform * 6);
        const root = { ...page.displayProgram.groups[page.displayProgram.rootGroupIndex], alpha: 1, alphaIsShape: false, isolated: true, knockout: false, blendMode: "Normal" as const, softMaskGroupIndex: -1, softMaskSubtype: null, softMaskTransferFunctionIndex: -1, backdropPaintIndex: -1, blendingColorSpaceIndex: -1, clipIndex: -1,
          commands: [{ kind: "invoke-program" as const, transformIndex: baseTransform, clipIndex: -1, optionalContentIndex: -1, markedContentIndex: -1, sourceOffset: -1, sourceLength: -1, programIndex, type3PaintIndex: resolved.basePaintIndex, viewTransformFlags: 0 }] };
        const synthetic = { ...page, stores: { ...page.stores, transforms: { values: transforms } }, displayProgram: { ...page.displayProgram, programs, rootGroupIndex: page.displayProgram.groups.length, groups: [...page.displayProgram.groups, root] } };
        await executeHeprDisplayProgram(synthetic, backend(paintedClip, condition), { signal });
      }
    } finally { stack.pop(); patternActive.delete(p); }
  };
  draw = async (execution, inheritedClip, inheritedCondition) => {
    if (performance.now() - lastYield > 8) { await new Promise<void>(resolve => setTimeout(resolve, 0)); lastYield = performance.now(); }
    signal.throwIfAborted();
    const command = execution.command, matrix = execution.state.transform, condition = combine(execution.state, inheritedCondition);
    let clip = clipScope(execution.state.clips);
    if (inheritedClip) {
      // Pattern-cell clips are nested inside the painted path's clipping scope.
      const attach = (node: DensePdfTextClip | null): DensePdfTextClip => node ? { ...node, parent: attach(node.parent) } : inheritedClip;
      clip = attach(clip);
    }
    if (execution.state.viewTransformFlags) return fail("view-dependent annotation transform.");
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
        const p0 = point(matrix, store.endpoints[i], store.endpoints[i + 1]), c = point(matrix, store.endpoints[i + 2], store.endpoints[i + 3]), p1 = point(matrix, store.primitiveMeta[i], store.primitiveMeta[i + 1]);
        const flags = Math.floor(store.primitiveMeta[i + 3] / 2), alpha = store.primitiveMeta[i + 3] - flags * 2, half = store.styles[i] * scaleX;
        endpoints.push(...p0, ...c); primitiveMeta.push(...p1, store.primitiveMeta[i + 2], flags * 2 + rgba[3] * alpha); styles.push(half, rgba[0], rgba[1], rgba[2]);
        primitiveBounds.push(Math.min(p0[0], c[0], p1[0]) - half, Math.min(p0[1], c[1], p1[1]) - half, Math.max(p0[0], c[0], p1[0]) + half, Math.max(p0[1], c[1], p1[1]) + half); scene.maxHalfWidth = Math.max(scene.maxHalfWidth, half);
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
        if ([0, 2, 4, 6].includes(command.renderingMode) && command.fillPaintIndex >= 0) text(glyph, indices, local, color(command.fillPaintIndex, execution.state), clip, condition);
        // Modes 2 and 6 fill the glyph as well, so its shape survives an
        // outline this renderer cannot build; modes 1 and 5 have only the stroke.
        if ([1, 2, 5, 6].includes(command.renderingMode) && command.strokePaintIndex >= 0) {
          strokePath(indices, local, command.strokeStyleIndex, color(command.strokePaintIndex, execution.state),
            clip, condition, command.renderingMode === 2 || command.renderingMode === 6);
        }
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
  const backend = (inheritedClip?: DensePdfTextClip | null, inheritedCondition?: number): HeprDisplayBackend => ({
    drawRun: execution => draw(execution, inheritedClip, inheritedCondition),
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
      stack.push(children);
    },
    endCompositeGroup() { stack.pop(); }
  });
  await executeHeprDisplayProgram(page, backend(), { signal });
  scene.fillPathCount = fillsA.length / 4; scene.fillSegmentCount = segmentsA.length / 4;
  scene.fillPathMetaA = Float32Array.from(fillsA); scene.fillPathMetaB = Float32Array.from(fillsB); scene.fillPathMetaC = Float32Array.from(fillsC);
  scene.fillSegmentsA = Float32Array.from(segmentsA); scene.fillSegmentsB = Float32Array.from(segmentsB);
  scene.endpoints = Float32Array.from(endpoints); scene.primitiveMeta = Float32Array.from(primitiveMeta); scene.primitiveBounds = Float32Array.from(primitiveBounds); scene.styles = Float32Array.from(styles);
  scene.textInstanceA = Float32Array.from(textA); scene.textInstanceB = Float32Array.from(textB); scene.textInstanceC = Float32Array.from(textC);
  scene.textGlyphMetaA = Float32Array.from(glyphMetaA); scene.textGlyphMetaB = Float32Array.from(glyphMetaB); scene.textGlyphSegmentsA = Float32Array.from(glyphA); scene.textGlyphSegmentsB = Float32Array.from(glyphB);
  scene.textInstanceCount = textA.length / 4; scene.textGlyphCount = glyphMetaA.length / 4; scene.textGlyphSegmentCount = glyphA.length / 4; scene.pageTextRanges[1] = scene.textInstanceCount;
  scene.segmentCount = endpoints.length / 4; scene.sourceSegmentCount = scene.segmentCount; scene.mergedSegmentCount = scene.segmentCount;
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
  if (options.optionalContent) scene.optionalContent = { ...options.optionalContent, conditions };
  scene.textIndex = buildNativeFallbackTextIndex(source, signal);
  const index = scene.textIndex.pages[0];
  if (options.optionalContent) index.optionalContent = Int32Array.from(source.textIndex.charGlyphIndices, glyph => glyph >= 0 ? glyphConditions[glyph] : -1);
  scene.sourceTextCount = source.stores.glyphs.glyphIds.length;
  scene.pathCount = scene.fillPathCount + scene.segmentCount;
  scene.imagePaintOpCount = scene.rasterLayers.length;
  const image = scene.rasterLayers[0];
  if (image) { scene.rasterLayerWidth = image.width; scene.rasterLayerHeight = image.height; scene.rasterLayerData = image.data; scene.rasterLayerMatrix = image.matrix; }
  return scene;
}
