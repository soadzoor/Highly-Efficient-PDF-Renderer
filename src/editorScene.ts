import type { Bounds, VectorClipPath, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { composeOverlappingVectorScenes } from "./pdfVectorExtractor";
import { editorPaintIdentity, setEditorPaintIdentity, retainEditorPaintIdentity, remapEditorPaintIdentity, composeEditorPaintIdentity } from "./editorPaintIdentity";
import type { PrimitiveKind, PrimitiveRef } from "./scenePrimitives";
import { getScenePrimitive, getPrimitiveClipChain, getPrimitiveSegmentClipBounds, getSceneAnnotationRuns, validatePrimitiveRef } from "./scenePrimitives";
import { transformAnnotationGeometry, transformAnnotationPoints } from "./annotationData";
import type { PdfMatrix } from "./heprDocumentData";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import { defaultVectorDrawRuns, validateVectorDrawRuns } from "./vectorDrawOrder";
import { validateScenePaintGraph, type ScenePaintNode } from "./scenePaintGraph";
import { ScenePageViews, PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } from "./scenePageViews";
import { buildNativeGlyphStroke } from "./pdf/nativeGlyphStroke";
import { rasterRepeatMatrix } from "./rasterRepeat";
import type { EditorAnnotationEdit, EditorMatrix, EditorSourceEdit } from "./editorTypes";
import type { SceneAnnotation } from "./annotationData";

export const EDITOR_IDENTITY: EditorMatrix = [1, 0, 0, 1, 0, 0];
const annotationTransforms = new WeakMap<VectorScene, ReadonlyMap<string, EditorMatrix>>();
const annotationSources = new WeakMap<VectorScene, ReadonlyMap<string, { annotation: SceneAnnotation; transform: EditorMatrix }>>();
/** Operation-local placement for regenerating a transformed field appearance; never serialized. */
export function getEditorAnnotationTransform(scene: VectorScene, id: string): EditorMatrix | undefined {
  const matrix = annotationTransforms.get(scene)?.get(id); return matrix ? [...matrix] as unknown as EditorMatrix : undefined;
}
/** Native field dimensions before editing; transformed bounds remain conservative AABBs. */
export function getEditorAnnotationSource(scene: VectorScene, id: string): SceneAnnotation | undefined {
  return annotationSources.get(scene)?.get(id)?.annotation;
}
/** Include an appearance's original local frame, recovered when reopening an edited PDF. */
export function getEditorAnnotationFrameTransform(scene: VectorScene, id: string): EditorMatrix | undefined {
  const source = annotationSources.get(scene)?.get(id), delta = annotationTransforms.get(scene)?.get(id);
  return source ? multiplyEditorMatrices(delta ?? EDITOR_IDENTITY, source.transform) : delta ? [...delta] as unknown as EditorMatrix : undefined;
}
export function setEditorAnnotationSource(scene: VectorScene, annotation: SceneAnnotation, transform: EditorMatrix = EDITOR_IDENTITY): void {
  const sources = new Map(annotationSources.get(scene)); sources.set(annotation.id, { annotation, transform: editorMatrix(transform) }); annotationSources.set(scene, sources);
}
/** Keep operation-local field frames through compilation without adding scene/HEP data. */
export function retainEditorAnnotationPlacements(source: VectorScene, target: VectorScene): void {
  retainEditorPaintIdentity(source, target);
  const transforms = annotationTransforms.get(source); if (transforms) annotationTransforms.set(target, transforms);
  const sources = annotationSources.get(source); if (sources) annotationSources.set(target, sources);
}
export function editorMatrix(value: readonly number[]): EditorMatrix {
  if (value.length !== 6 || !value.every(Number.isFinite)) throw new TypeError("An editor transform must have six finite components.");
  const determinant = value[0] * value[3] - value[1] * value[2];
  if (!Number.isFinite(determinant) || determinant === 0) throw new RangeError("An editor transform must be invertible.");
  return [...value] as unknown as EditorMatrix;
}
export function multiplyEditorMatrices(a: ArrayLike<number>, b: ArrayLike<number>): EditorMatrix {
  return editorMatrix([a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]);
}
export function invertEditorMatrix(m: ArrayLike<number>): EditorMatrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return editorMatrix([m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]);
}
export function editorPoint(m: ArrayLike<number>, x: number, y: number): [number, number] {
  const point: [number, number] = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  if (!point.every(value => Number.isFinite(Math.fround(value)))) throw new RangeError("Edited coordinates exceed the scene's representable range.");
  return point;
}
export function editorTransformBounds(bounds: Bounds, m: ArrayLike<number>): Bounds {
  const points = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]]
    .map(([x, y]) => editorPoint(m, x, y));
  return { minX: Math.min(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])),
    maxX: Math.max(...points.map(p => p[0])), maxY: Math.max(...points.map(p => p[1])) };
}
export function editorRefKey(ref: PrimitiveRef): string { return `${ref.kind}:${ref.index}`; }
export function editorMatrixIsIdentity(m: ArrayLike<number>): boolean { return EDITOR_IDENTITY.every((value, i) => value === m[i]); }
export function editorUnionBounds(a: Bounds | null, b: Bounds): Bounds {
  return a ? { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) } : { ...b };
}

/** Blank widgets and metadata-only annotations have no primitive ranges to edit. */
export function bakeEditorAnnotationEdits(scene: VectorScene, edits: readonly EditorAnnotationEdit[]): VectorScene {
  const pending = new Map(edits.filter(edit => edit.deleted || !editorMatrixIsIdentity(edit.transform)).map(edit => [edit.id, edit]));
  if (!pending.size || !scene.annotations) return scene;
  const transforms = new Map(annotationTransforms.get(scene));
  const sources = new Map(annotationSources.get(scene));
  const annotations = scene.annotations.flatMap(annotation => {
    const edit = pending.get(annotation.id); if (!edit) return [annotation]; if (edit.deleted) { transforms.delete(annotation.id); sources.delete(annotation.id); return []; }
    const matrix = editorMatrix(edit.transform), bounds = annotation.bounds;
    const geometry = transformAnnotationGeometry({ rect: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY], quadPoints: annotation.quadPoints,
      line: annotation.line, vertices: annotation.vertices, inkList: annotation.inkList }, matrix as PdfMatrix);
    const page = scene.pdfPages?.find(page => page.pageIndex === annotation.pageIndex);
    const mapping = page?.pdfToScene ?? [1, 0, 0, 1, scene.pageRects[annotation.pageIndex * 4], scene.pageRects[annotation.pageIndex * 4 + 1]];
    const pdfMatrix = multiplyEditorMatrices(invertEditorMatrix(mapping), multiplyEditorMatrices(matrix, mapping));
    const original = annotation.pdfGeometry, box = editorTransformBounds({ minX: original.rect[0], minY: original.rect[1], maxX: original.rect[2], maxY: original.rect[3] }, pdfMatrix);
    if (!sources.has(annotation.id)) sources.set(annotation.id, { annotation, transform: EDITOR_IDENTITY });
    transforms.set(annotation.id, multiplyEditorMatrices(matrix, transforms.get(annotation.id) ?? EDITOR_IDENTITY));
    return [{ ...annotation, ...geometry, pdfGeometry: { rect: [box.minX, box.minY, box.maxX, box.maxY] as const,
      ...(original.quadPoints ? { quadPoints: transformAnnotationPoints(original.quadPoints, pdfMatrix as PdfMatrix) } : {}),
      ...(original.line ? { line: transformAnnotationPoints(original.line, pdfMatrix as PdfMatrix) } : {}),
      ...(original.vertices ? { vertices: transformAnnotationPoints(original.vertices, pdfMatrix as PdfMatrix) } : {}),
      ...(original.inkList ? { inkList: original.inkList.map(path => transformAnnotationPoints(path, pdfMatrix as PdfMatrix)) } : {}) } }];
  });
  const result = { ...scene, annotations }; retainEditorPaintIdentity(scene, result);
  annotationTransforms.set(result, transforms); annotationSources.set(result, sources); return result;
}

/** Copy only arrays written by the edit; the caller's canonical scene stays immutable. */
export function bakeEditorSourceScene(source: VectorScene, edits: readonly EditorSourceEdit[], signal?: AbortSignal,
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void): VectorScene {
  edits = edits.filter(edit => edit.deleted || !editorMatrixIsIdentity(edit.transform));
  if (!edits.length) return source;
  const scene: VectorScene = { ...source, rasterLayers: source.rasterLayers.slice(), clipPaths: source.clipPaths?.slice(),
    retainedPages: source.retainedPages?.slice(), pagePrimitiveRanges: undefined };
  const detached = new Set<keyof VectorScene>();
  const appended = new Map<keyof VectorScene, { parts: Float32Array[]; length: number }>();
  const writable = (key: keyof VectorScene): Float32Array => {
    if (!detached.has(key)) { (scene as unknown as Record<string, unknown>)[key] = (scene[key] as Float32Array).slice(); detached.add(key); }
    return scene[key] as Float32Array;
  };
  const append = (key: keyof VectorScene, values: ArrayLike<number>): number => {
    let pending = appended.get(key); if (!pending) appended.set(key, pending = { parts: [], length: 0 });
    const first = (scene[key] as Float32Array).length + pending.length;
    pending.parts.push(Float32Array.from(values)); pending.length += values.length; return first;
  };
  const pending = new Map(edits.map(edit => [editorRefKey(edit.ref), edit]));
  const partition = source.pageCount > 1 ? new ScenePageViews(source) : null;
  const owners = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, partition ? Array.from(partition.owners[kind]) : Array(scenePrimitiveCounts(source)[kind]).fill(0)])) as Record<PrimitiveKind, number[]>;
  for (const edit of edits) { validatePrimitiveRef(source, edit.ref); editorMatrix(edit.transform); }
  const removed = new Set(edits.filter(edit => edit.deleted).map(edit => editorRefKey(edit.ref)));
  const replacements = new Map<string, PrimitiveRef[]>(), changedClips = new Map<string, number>(), changedGradients = new Map<string, number>();
  const originalRuns = source.drawRuns ?? defaultVectorDrawRuns(source);
  let outlinedApproximation = false;
  const transformedClip = (index: number, matrix: EditorMatrix): number => {
    if (index < 0) return -1;
    const key = `${index}/${matrix.join(",")}`;
    if (changedClips.has(key)) return changedClips.get(key)!;
    const clip = source.clipPaths![index], parent = transformedClip(clip.parent, matrix), edges = clip.edges.slice();
    for (let i = 0; i < edges.length; i += 2) edges.set(editorPoint(matrix, edges[i], edges[i + 1]), i);
    const result = (scene.clipPaths ??= []).push({ parent, fillRule: clip.fillRule, edges }) - 1; changedClips.set(key, result); return result;
  };
  const rectClip = (rect: Bounds, matrix: EditorMatrix, parent: number): number => {
    const corners = [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY]]
      .map(([x, y]) => editorPoint(matrix, x, y));
    const edges = new Float32Array(16);
    corners.forEach((point, i) => edges.set([...point, ...corners[(i + 1) % 4]], i * 4));
    return (scene.clipPaths ??= []).push({ parent, fillRule: 0, edges }) - 1;
  };
  const clipFor = new Map<string, number>();
  const replacementClips = new Map<string, number>();
  const gradient = (index: number, matrix: EditorMatrix): number => {
    if (index < 0) return -1;
    const key = `${index}/${matrix.join(",")}`;
    if (changedGradients.has(key)) return changedGradients.get(key)!;
    const i = index * 4, next = scene.gradientCount++, inverse = invertEditorMatrix(matrix);
    const old: EditorMatrix = [source.gradientMetaB[i], source.gradientMetaB[i + 1], source.gradientMetaB[i + 2], source.gradientMetaB[i + 3], source.gradientMetaC[i], source.gradientMetaC[i + 1]];
    const transformed = multiplyEditorMatrices(old, inverse);
    for (const key of ["gradientMetaA", "gradientMetaB", "gradientMetaC", "gradientMetaD", "gradientMetaE"] as const) {
      const values = source[key].slice(i, i + 4);
      if (key === "gradientMetaB") values.set(transformed.slice(0, 4));
      if (key === "gradientMetaC") { values[0] = transformed[4]; values[1] = transformed[5]; }
      append(key, values);
    }
    const lutStride = source.gradientLut.length / source.gradientCount;
    const lut = new Uint8Array(scene.gradientLut.length + lutStride); lut.set(scene.gradientLut); lut.set(source.gradientLut.subarray(index * lutStride, (index + 1) * lutStride), scene.gradientLut.length); scene.gradientLut = lut;
    if (source.gradientMeshRanges) {
      const ranges = new Uint32Array((scene.gradientMeshRanges?.length ?? 0) + 2); ranges.set(scene.gradientMeshRanges ?? []);
      ranges.set(source.gradientMeshRanges.subarray(index * 2, index * 2 + 2), ranges.length - 2); scene.gradientMeshRanges = ranges;
    }
    changedGradients.set(key, next); return next;
  };
  const transformSegments = (aKey: keyof VectorScene, bKey: keyof VectorScene, first: number, count: number, matrix: EditorMatrix): Bounds => {
    const a = writable(aKey), b = writable(bKey); let box: Bounds | null = null;
    for (let j = first; j < first + count; j++) {
      const i = j * 4, p = editorPoint(matrix, a[i], a[i + 1]), end = editorPoint(matrix, b[i], b[i + 1]);
      a.set(p, i); b.set(end, i);
      let minX = Math.min(p[0], end[0]), minY = Math.min(p[1], end[1]), maxX = Math.max(p[0], end[0]), maxY = Math.max(p[1], end[1]);
      if (b[i + 2] >= 0.5) { const control = editorPoint(matrix, a[i + 2], a[i + 3]); a.set(control, i + 2);
        minX = Math.min(minX, control[0]); minY = Math.min(minY, control[1]); maxX = Math.max(maxX, control[0]); maxY = Math.max(maxY, control[1]); }
      box = editorUnionBounds(box, { minX, minY, maxX, maxY });
    }
    return box ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  };
  const addFill = (a: ArrayLike<number>, b: ArrayLike<number>, bounds: Bounds, color: readonly number[], opacity: number,
    gradientIndex = -1, maskIndex = -1, pageIndex = 0): PrimitiveRef => {
    const isGradient = gradientIndex >= 0 || maskIndex >= 0, prefix = isGradient ? "gradientFill" : "fill";
    const first = isGradient ? scene.gradientFillSegmentCount : scene.fillSegmentCount, count = a.length / 4;
    const index = isGradient ? scene.gradientFillPathCount++ : scene.fillPathCount++;
    owners[isGradient ? "gradient-fill" : "fill"][index] = pageIndex;
    append(`${prefix}SegmentsA`, a); append(`${prefix}SegmentsB`, b);
    append(`${prefix}PathMetaA`, [first, count, bounds.minX, bounds.minY]);
    append(`${prefix}PathMetaB`, [bounds.maxX, bounds.maxY, color[0], color[1]]);
    append(`${prefix}PathMetaC`, [0, 0, color[2], opacity]);
    if (isGradient) { append("gradientFillPaintMeta", [gradientIndex, maskIndex, 0, pageIndex]); scene.gradientFillSegmentCount += count; }
    else scene.fillSegmentCount += count;
    return { kind: isGradient ? "gradient-fill" : "fill", index };
  };
  for (const edit of edits) {
    signal?.throwIfAborted();
    if (edit.deleted || editorMatrixIsIdentity(edit.transform)) continue;
    const { ref, transform: matrix } = edit, i = ref.index * 4, key = editorRefKey(ref), info = getScenePrimitive(source, ref);
    const clip = getPrimitiveClipChain(source, ref); let nextClip = transformedClip(clip.clipIndex, matrix);
    if (clip.rect) nextClip = rectClip(clip.rect, matrix, nextClip);
    clipFor.set(key, nextClip);
    if (ref.kind === "text") {
      const old: EditorMatrix = [source.textInstanceA[i], source.textInstanceA[i + 1], source.textInstanceA[i + 2], source.textInstanceA[i + 3], source.textInstanceB[i], source.textInstanceB[i + 1]];
      const next = multiplyEditorMatrices(matrix, old); writable("textInstanceA").set(next.slice(0, 4), i); writable("textInstanceB").set([next[4], next[5], source.textInstanceB[i + 2], 0], i);
    } else if (ref.kind === "raster") {
      const original = source.rasterLayers[ref.index];
      if (original.repeat && (matrix[1] !== 0 || matrix[2] !== 0)) {
        const refs: PrimitiveRef[] = [];
        for (let y = original.repeat.yFirst; y <= original.repeat.yLast; y++) for (let x = original.repeat.xFirst; x <= original.repeat.xLast; x++) {
          signal?.throwIfAborted(); const m = rasterRepeatMatrix(original.repeat, x, y), index = scene.rasterLayers.length;
          scene.rasterLayers.push({ ...original, repeat: undefined, matrix: Float32Array.from(multiplyEditorMatrices(matrix, m)) }); refs.push({ kind: "raster", index });
          owners.raster[index] = owners.raster[ref.index];
        }
        replacements.set(key, refs); removed.add(key);
      } else {
        const repeat = original.repeat ? { ...original.repeat, transform: Float64Array.from(multiplyEditorMatrices(matrix, original.repeat.transform)),
          translations: original.repeat.translations ? Float64Array.from(original.repeat.translations, (value, j) => j % 2 ? value * matrix[3] : value * matrix[0]) : undefined } : undefined;
        scene.rasterLayers[ref.index] = { ...original, matrix: Float32Array.from(multiplyEditorMatrices(matrix, original.matrix)), ...(repeat ? { repeat } : {}) };
      }
    } else if (ref.kind === "fill" || ref.kind === "gradient-fill") {
      const prefix = ref.kind === "fill" ? "fill" : "gradientFill", metaA = writable(`${prefix}PathMetaA`), metaB = writable(`${prefix}PathMetaB`);
      const box = transformSegments(`${prefix}SegmentsA`, `${prefix}SegmentsB`, metaA[i], metaA[i + 1], matrix);
      metaA[i + 2] = box.minX; metaA[i + 3] = box.minY; metaB[i] = box.maxX; metaB[i + 1] = box.maxY;
      if (ref.kind === "gradient-fill") { const paint = writable("gradientFillPaintMeta"); paint[i] = gradient(source.gradientFillPaintMeta[i], matrix); paint[i + 1] = gradient(source.gradientFillPaintMeta[i + 1], matrix); }
    } else {
      const isGradient = ref.kind === "gradient-stroke", first = isGradient ? source.gradientStrokeRunMetaA[i] : ref.index;
      const count = isGradient ? source.gradientStrokeRunMetaA[i + 1] : 1;
      const aKey = isGradient ? "gradientStrokeEndpoints" : "endpoints", bKey = isGradient ? "gradientStrokePrimitiveMeta" : "primitiveMeta";
      const stylesKey = isGradient ? "gradientStrokeStyles" : "styles", boundsKey = isGradient ? "gradientStrokePrimitiveBounds" : "primitiveBounds";
      const scaleX = Math.hypot(matrix[0], matrix[1]), scaleY = Math.hypot(matrix[2], matrix[3]);
      const uniform = Math.abs(scaleX - scaleY) <= Number.EPSILON * Math.max(scaleX, scaleY) * 16 && Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) <= Number.EPSILON * scaleX * scaleY * 16;
      const gradientIndex = isGradient ? gradient(source.gradientStrokeRunMetaA[i + 2], matrix) : -1;
      const maskIndex = isGradient ? gradient(source.gradientStrokeRunMetaA[i + 3], matrix) : -1;
      const refs: PrimitiveRef[] = [];
      const needsOutlines = !uniform && Array.from({ length: count }, (_, index) => first + index).some(index => source[stylesKey][index * 4] > 0 && (Math.floor(source[bKey][index * 4 + 3] / 2) & 1) === 0);
      const splitRun = isGradient && (needsOutlines || Array.from({ length: count }, (_, index) => first + index).some(index => (Math.floor(source[bKey][index * 4 + 3] / 2) & 4) !== 0));
      for (let j = first; j < first + count; j++) {
        const offset = j * 4, a = source[aKey], b = source[bKey], style = source[stylesKey], flags = Math.floor(b[offset + 3] / 2), alpha = b[offset + 3] - flags * 2;
        const hairline = (flags & 1) !== 0 || style[offset] === 0;
        if (!uniform && !hairline) {
          const commands = [{ kind: "move" as const, x: a[offset], y: a[offset + 1] }, b[offset + 2] >= 0.5
            ? { kind: "quadratic" as const, controlX: a[offset + 2], controlY: a[offset + 3], x: b[offset], y: b[offset + 1] }
            : { kind: "line" as const, x: b[offset], y: b[offset + 1] }];
          const outline = buildNativeGlyphStroke(commands, matrix, { transform: matrix, width: style[offset] * 2,
            lineCap: (flags & 2) !== 0 ? 1 : 0, lineJoin: 1, miterLimit: 10, dashArray: [], dashPhase: 0 }, signal);
          if (outline) {
            outlinedApproximation ||= outline.approximated;
            // Separate paints keep their own alpha; unioning a complete source run can change overlaps.
            const replacement = addFill(outline.segmentsA, outline.segmentsB, outline.bounds, [style[offset + 1], style[offset + 2], style[offset + 3]], alpha,
              gradientIndex, maskIndex, owners[ref.kind][ref.index]);
            refs.push(replacement);
            if (isGradient) { const rect = getPrimitiveSegmentClipBounds(source, ref, j - first);
              if (rect) replacementClips.set(editorRefKey(replacement), rectClip(rect, matrix, nextClip)); }
          }
        } else {
          const box = transformSegments(aKey, bKey, j, 1, matrix), half = hairline ? 0 : style[offset] * scaleX;
          writable(stylesKey)[offset] = half;
          writable(boundsKey).set([box.minX, box.minY, box.maxX, box.maxY], offset);
          // A former axis-aligned clip is now carried by the run's polygon chain.
          writable(bKey)[offset + 3] = (flags & ~4) * 2 + alpha;
          if (splitRun) {
            const replacementIndex = scene.gradientStrokeRunCount++;
            append("gradientStrokeRunMetaA", [j, 1, gradientIndex, maskIndex]);
            append("gradientStrokeRunMetaB", [source.gradientStrokeRunMetaB[i], owners["gradient-stroke"][ref.index], 0, 0]);
            owners["gradient-stroke"][replacementIndex] = owners["gradient-stroke"][ref.index];
            const replacement: PrimitiveRef = { kind: "gradient-stroke", index: replacementIndex }; refs.push(replacement);
            const rect = getPrimitiveSegmentClipBounds(source, ref, j - first);
            if (rect) replacementClips.set(editorRefKey(replacement), rectClip(rect, matrix, nextClip));
          }
        }
      }
      if (refs.length) { replacements.set(key, refs); removed.add(key); }
      if (isGradient && !removed.has(key)) { const meta = writable("gradientStrokeRunMetaA"); meta[i + 2] = gradientIndex; meta[i + 3] = maskIndex; }
    }
  }
  // Replay resources and the displayed pixels must share the same edited placement.
  const remapRetained = (nodes: readonly ScenePaintNode[]): ScenePaintNode[] => nodes.map(node => {
    if (node.kind === "group") return { ...node, children: remapRetained(node.children), ...(node.softMask ? { softMask: { ...node.softMask, children: remapRetained(node.softMask.children) } } : {}) };
    if (node.kind !== "retained") return { ...node };
    const edit = pending.get(`raster:${node.rasterIndex}`);
    if (!edit || edit.deleted || editorMatrixIsIdentity(edit.transform)) return { ...node };
    const resource = source.retainedPages![node.retainedPage], index = scene.retainedPages!.length;
    scene.retainedPages!.push({ ...resource, matrix: Float32Array.from(multiplyEditorMatrices(edit.transform, resource.matrix)) });
    return { ...node, retainedPage: index };
  });
  if (source.paintGraph) scene.paintGraph = { roots: remapRetained(source.paintGraph.roots) };
  const runs: VectorDrawRun[] = [], runMap = new Map<number, number[]>();
  originalRuns.forEach((run, runIndex) => {
    const nextIndices: number[] = [];
    const add = (ref: PrimitiveRef, clipIndex: number | undefined) => {
      const previous = runs[runs.length - 1];
      const candidate: VectorDrawRun = { ...run, kind: ref.kind, first: ref.index, count: 1,
        ...(clipIndex !== undefined && clipIndex >= 0 ? { clipIndex } : { clipIndex: undefined }) };
      if (ref.kind.startsWith("gradient-")) delete candidate.blendMode;
      if (nextIndices.length && previous.kind === candidate.kind && previous.first + previous.count === candidate.first && previous.clipIndex === candidate.clipIndex) previous.count++;
      else { nextIndices.push(runs.length); runs.push(candidate); }
    };
    for (let index = run.first; index < run.first + run.count; index++) {
      const key = `${run.kind}:${index}`, replacement = replacements.get(key), clip = clipFor.has(key) ? clipFor.get(key) : run.clipIndex;
      if (replacement) for (const ref of replacement) add(ref, replacementClips.get(editorRefKey(ref)) ?? clip);
      else if (!removed.has(key)) add({ kind: run.kind, index }, clip);
    }
    runMap.set(runIndex, nextIndices);
  });
  const updateNodes = (nodes: readonly ScenePaintNode[]): ScenePaintNode[] => nodes.flatMap((node): ScenePaintNode[] => {
    if (node.kind === "draw") return (runMap.get(node.runIndex) ?? []).map(runIndex => ({ ...node, runIndex }));
    if (node.kind === "retained") return removed.has(`raster:${node.rasterIndex}`) ? [] : [{ ...node }];
    const children = updateNodes(node.children); if (!children.length) return [];
    return [{ ...node, bounds: undefined, children, ...(node.softMask ? { softMask: { ...node.softMask, children: updateNodes(node.softMask.children) } } : {}) }];
  });
  scene.drawRuns = runs;
  if (scene.paintGraph) scene.paintGraph = { roots: updateNodes(scene.paintGraph.roots) };
  // Materialize appended outlines once, rather than copying the entire store
  // for every selected stroke in a large document.
  for (const [key, pending] of appended) {
    const original = scene[key] as Float32Array, result = new Float32Array(original.length + pending.length); result.set(original);
    let offset = original.length; for (const part of pending.parts) { result.set(part, offset); offset += part.length; }
    (scene as unknown as Record<string, unknown>)[key] = result;
  }
  const kept = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveKind, Set<number>>;
  for (const run of runs) for (let index = run.first; index < run.first + run.count; index++) kept[run.kind].add(index);
  const identity = editorPaintIdentity(source), replacementsByIdentity = new Map<string, string>();
  for (const [original, refs] of replacements) {
    const [kind, index] = original.split(":"); const owner = identity({ kind: kind as PrimitiveKind, index: Number(index) });
    for (const ref of refs) replacementsByIdentity.set(editorRefKey(ref), owner);
  }
  setEditorPaintIdentity(scene, ref => replacementsByIdentity.get(editorRefKey(ref)) ?? identity(ref));
  const compacted = compactEditorScene(scene, kept, owners);
  if (outlinedApproximation) {
    const diagnostic: PdfDiagnostic = { code: "editor.stroke-outline-approximation", severity: "warning",
      message: "Nonuniformly transformed stroke pens remain vector outlines; curved centerlines use at most 0.01 page-unit subdivision error." };
    if (onDiagnostic) onDiagnostic(diagnostic); else console.warn(`[HEPR] ${diagnostic.message}`);
  }
  if (source.annotations) {
    const appearances = getSceneAnnotationRuns(source);
    const transforms = new Map(annotationTransforms.get(source));
    const sources = new Map(annotationSources.get(source));
    compacted.annotations = source.annotations.flatMap(annotation => {
      const refs: PrimitiveRef[] = [];
      for (const run of appearances.get(annotation.id) ?? []) for (let index = run.first; index < run.first + run.count; index++) refs.push({ kind: run.kind, index });
      if (!refs.length) return [annotation];
      if (refs.every(ref => pending.get(editorRefKey(ref))?.deleted)) { transforms.delete(annotation.id); sources.delete(annotation.id); return []; }
      const matrix = pending.get(editorRefKey(refs[0]))?.transform;
      if (!matrix || refs.some(ref => {
        const edit = pending.get(editorRefKey(ref)); return !edit || edit.deleted || edit.transform.some((value, index) => value !== matrix[index]);
      })) return [annotation];
      if (!sources.has(annotation.id)) sources.set(annotation.id, { annotation, transform: EDITOR_IDENTITY });
      transforms.set(annotation.id, multiplyEditorMatrices(matrix, transforms.get(annotation.id) ?? EDITOR_IDENTITY));
      const bounds = annotation.bounds, transformed = transformAnnotationGeometry({ rect: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
        quadPoints: annotation.quadPoints, line: annotation.line, vertices: annotation.vertices, inkList: annotation.inkList }, matrix as PdfMatrix);
      const page = source.pdfPages?.find(page => page.pageIndex === annotation.pageIndex);
      const mapping = page?.pdfToScene ?? [1, 0, 0, 1, source.pageRects[annotation.pageIndex * 4], source.pageRects[annotation.pageIndex * 4 + 1]];
      const pdfMatrix = multiplyEditorMatrices(invertEditorMatrix(mapping), multiplyEditorMatrices(matrix, mapping));
      const original = annotation.pdfGeometry, pdfRect = editorTransformBounds({ minX: original.rect[0], minY: original.rect[1], maxX: original.rect[2], maxY: original.rect[3] }, pdfMatrix);
      return [{ ...annotation, ...transformed, pdfGeometry: { rect: [pdfRect.minX, pdfRect.minY, pdfRect.maxX, pdfRect.maxY] as const,
        ...(original.quadPoints ? { quadPoints: transformAnnotationPoints(original.quadPoints, pdfMatrix as PdfMatrix) } : {}),
        ...(original.line ? { line: transformAnnotationPoints(original.line, pdfMatrix as PdfMatrix) } : {}),
        ...(original.vertices ? { vertices: transformAnnotationPoints(original.vertices, pdfMatrix as PdfMatrix) } : {}),
        ...(original.inkList ? { inkList: original.inkList.map(path => transformAnnotationPoints(path, pdfMatrix as PdfMatrix)) } : {}) } }];
    });
    annotationTransforms.set(compacted, transforms);
    annotationSources.set(compacted, sources);
  }
  compacted.maxHalfWidth = 0; for (let i = 0; i < compacted.styles.length; i += 4) compacted.maxHalfWidth = Math.max(compacted.maxHalfWidth, compacted.styles[i]);
  compacted.bounds = { ...compacted.pageBounds };
  const counts = scenePrimitiveCounts(compacted);
  for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) compacted.bounds = editorUnionBounds(compacted.bounds, getScenePrimitive(compacted, { kind, index }).bounds);
  return compacted;
}

/** Compact canonical stores and remap paint and text references without rasterization. */
export function compactEditorScene(source: VectorScene, keep: Record<PrimitiveKind, ReadonlySet<number>>, suppliedOwners?: Record<PrimitiveKind, ArrayLike<number>>): VectorScene {
  const scene: VectorScene = { ...source, pagePrimitiveRanges: undefined }, ids = {} as Record<PrimitiveKind, number[]>, maps = {} as Record<PrimitiveKind, Map<number, number>>;
  retainEditorAnnotationPlacements(source, scene);
  const partition = !suppliedOwners && source.pageCount > 1 ? new ScenePageViews(source) : null;
  const owners = suppliedOwners ?? partition?.owners ?? Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, Array(scenePrimitiveCounts(source)[kind]).fill(0)])) as unknown as Record<PrimitiveKind, ArrayLike<number>>;
  for (const kind of PAGE_PRIMITIVE_KINDS) { ids[kind] = [...keep[kind]].sort((a, b) => owners[kind][a] - owners[kind][b] || a - b); maps[kind] = new Map(ids[kind].map((id, index) => [id, index])); }
  const take = (key: keyof VectorScene, indices: readonly number[]): Float32Array => {
    const data = source[key] as Float32Array, result = new Float32Array(indices.length * 4);
    indices.forEach((index, i) => result.set(data.subarray(index * 4, index * 4 + 4), i * 4)); return result;
  };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const) scene[key] = take(key, ids.stroke);
  scene.segmentCount = scene.sourceSegmentCount = scene.mergedSegmentCount = ids.stroke.length;
  const paths = (kind: "fill" | "gradient-fill", prefix: "fill" | "gradientFill") => {
    const segments: number[] = [], meta = take(`${prefix}PathMetaA`, ids[kind]);
    ids[kind].forEach((_, index) => { const i = index * 4, first = meta[i], count = meta[i + 1]; meta[i] = segments.length;
      for (let j = first; j < first + count; j++) segments.push(j); });
    Object.assign(scene, { [`${prefix}PathMetaA`]: meta, [`${prefix}PathMetaB`]: take(`${prefix}PathMetaB`, ids[kind]),
      [`${prefix}PathMetaC`]: take(`${prefix}PathMetaC`, ids[kind]), [`${prefix}SegmentsA`]: take(`${prefix}SegmentsA`, segments),
      [`${prefix}SegmentsB`]: take(`${prefix}SegmentsB`, segments), [`${prefix}PathCount`]: ids[kind].length, [`${prefix}SegmentCount`]: segments.length });
  };
  paths("fill", "fill"); paths("gradient-fill", "gradientFill"); scene.gradientFillPaintMeta = take("gradientFillPaintMeta", ids["gradient-fill"]);
  scene.gradientStrokeRunMetaA = take("gradientStrokeRunMetaA", ids["gradient-stroke"]); scene.gradientStrokeRunMetaB = take("gradientStrokeRunMetaB", ids["gradient-stroke"]);
  const gradientSegments: number[] = [];
  for (let i = 0; i < scene.gradientStrokeRunMetaA.length; i += 4) { const first = scene.gradientStrokeRunMetaA[i], count = scene.gradientStrokeRunMetaA[i + 1]; scene.gradientStrokeRunMetaA[i] = gradientSegments.length;
    for (let j = first; j < first + count; j++) gradientSegments.push(j); }
  for (const key of ["gradientStrokeEndpoints", "gradientStrokePrimitiveMeta", "gradientStrokePrimitiveBounds", "gradientStrokeStyles"] as const) scene[key] = take(key, gradientSegments);
  scene.gradientStrokeRunCount = ids["gradient-stroke"].length; scene.gradientStrokeSegmentCount = gradientSegments.length;
  for (const key of ["textInstanceA", "textInstanceB", "textInstanceC"] as const) scene[key] = take(key, ids.text);
  scene.textInstanceCount = scene.sourceTextCount = scene.textInPageCount = ids.text.length; scene.textOutOfPageCount = 0;
  scene.rasterLayers = ids.raster.map(index => source.rasterLayers[index]);
  const primary = scene.rasterLayers[0]; scene.rasterLayerWidth = primary?.width ?? 0; scene.rasterLayerHeight = primary?.height ?? 0;
  scene.rasterLayerData = primary?.data ?? new Uint8Array(); scene.rasterLayerMatrix = primary?.matrix ?? Float32Array.from(EDITOR_IDENTITY);
  const runs: VectorDrawRun[] = [], runMap = new Map<number, number[]>();
  (source.drawRuns ?? defaultVectorDrawRuns(source)).forEach((run, oldIndex) => {
    const indices: number[] = [];
    for (let index = run.first; index < run.first + run.count; index++) {
      const next = maps[run.kind].get(index); if (next === undefined) continue;
      const previous = runs[runs.length - 1];
      if (indices.length && previous.first + previous.count === next) previous.count++;
      else { indices.push(runs.length); runs.push({ ...run, first: next, count: 1 }); }
    }
    runMap.set(oldIndex, indices);
  });
  scene.drawRuns = runs;
  const nodes = (input: readonly ScenePaintNode[]): ScenePaintNode[] => input.flatMap((node): ScenePaintNode[] => {
    if (node.kind === "draw") return (runMap.get(node.runIndex) ?? []).map(runIndex => ({ ...node, runIndex }));
    if (node.kind === "retained") { const rasterIndex = maps.raster.get(node.rasterIndex); return rasterIndex === undefined ? [] : [{ ...node, rasterIndex }]; }
    const children = nodes(node.children); return children.length ? [{ ...node, children,
      ...(node.softMask ? { softMask: { ...node.softMask, children: nodes(node.softMask.children) } } : {}) }] : [];
  });
  if (source.paintGraph) scene.paintGraph = { roots: nodes(source.paintGraph.roots) };
  scene.textIndex = source.textIndex ? { version: 2, pages: source.textIndex.pages.map(page => {
    let text = "", refs: number[] = [], conditions: number[] = [];
    for (let i = 0; i < page.text.length; i++) {
      const old = page.charInstance[i], next = old >= 0 ? maps.text.get(old) : old;
      if (next === undefined) continue; text += page.text[i]; refs.push(next); conditions.push(page.optionalContent?.[i] ?? -1);
    }
    return { text, charInstance: Int32Array.from(refs), fallbackQuads: page.fallbackQuads, ...(page.optionalContent ? { optionalContent: Int32Array.from(conditions) } : {}) };
  }) } : null;
  scene.textContent = undefined;
  scene.pageTextRanges = new Uint32Array(source.pageCount * 2);
  for (let page = 0; page < source.pageCount; page++) {
    const first = source.pageTextRanges[page * 2], count = source.pageTextRanges[page * 2 + 1];
    const before = ids.text.filter(id => id < first).length, inPage = ids.text.filter(id => id >= first && id < first + count).length;
    scene.pageTextRanges.set([before, inPage], page * 2);
  }
  if (source.markedContent) {
    const ranges: NonNullable<VectorScene["markedContent"]>["ranges"] = {};
    for (const kind of PAGE_PRIMITIVE_KINDS) {
      const result: number[] = [], original = source.markedContent.ranges[kind];
      if (original) for (let i = 0; i < original.length; i += 3) for (let id = original[i]; id < original[i] + original[i + 1]; id++) {
        const next = maps[kind].get(id); if (next !== undefined) result.push(next, 1, original[i + 2]);
      }
      if (result.length) ranges[kind] = Uint32Array.from(result);
    }
    scene.markedContent = { items: source.markedContent.items, ranges };
  }
  scene.pathCount = scene.fillPathCount + scene.gradientFillPathCount;
  const ranges = new Uint32Array(source.pageCount * PAGE_PRIMITIVE_KINDS.length * 2);
  PAGE_PRIMITIVE_KINDS.forEach((kind, k) => {
    let next = 0;
    for (let page = 0; page < source.pageCount; page++) {
      const first = next; while (next < ids[kind].length && owners[kind][ids[kind][next]] === page) next++;
      ranges.set([first, next - first], page * PAGE_PRIMITIVE_KINDS.length * 2 + k * 2);
    }
  });
  scene.pagePrimitiveRanges = ranges;
  remapEditorPaintIdentity(source, scene, ids);
  compactEditorResources(scene);
  validateVectorDrawRuns(scene); validateScenePaintGraph(scene); return scene;
}

/** Editing changes rendering data, rather than retaining unreachable pre-edit resources. */
function compactEditorResources(scene: VectorScene): void {
  const gradients = new Set<number>();
  for (let i = 0; i < scene.gradientFillPaintMeta.length; i += 4) for (const index of [scene.gradientFillPaintMeta[i], scene.gradientFillPaintMeta[i + 1]]) if (index >= 0) gradients.add(index);
  for (let i = 0; i < scene.gradientStrokeRunMetaA.length; i += 4) for (const index of [scene.gradientStrokeRunMetaA[i + 2], scene.gradientStrokeRunMetaA[i + 3]]) if (index >= 0) gradients.add(index);
  if (gradients.size !== scene.gradientCount) {
    const ids = [...gradients].sort((a, b) => a - b), map = new Map(ids.map((id, index) => [id, index]));
    for (const key of ["gradientMetaA", "gradientMetaB", "gradientMetaC", "gradientMetaD", "gradientMetaE"] as const) {
      const old = scene[key], next = new Float32Array(ids.length * 4); ids.forEach((id, index) => next.set(old.subarray(id * 4, id * 4 + 4), index * 4)); scene[key] = next;
    }
    const stride = scene.gradientCount ? scene.gradientLut.length / scene.gradientCount : 0, lut = new Uint8Array(ids.length * stride);
    ids.forEach((id, index) => lut.set(scene.gradientLut.subarray(id * stride, (id + 1) * stride), index * stride)); scene.gradientLut = lut;
    if (scene.gradientMeshRanges && scene.gradientMeshIndices) {
      const ranges = new Uint32Array(ids.length * 2), positions: number[] = [], colors: number[] = [], indices: number[] = [], vertices = new Map<number, number>();
      ids.forEach((id, local) => {
        const first = scene.gradientMeshRanges![id * 2], count = scene.gradientMeshRanges![id * 2 + 1]; ranges.set([indices.length, count], local * 2);
        for (let i = first; i < first + count; i++) {
          const vertex = scene.gradientMeshIndices![i];
          if (!vertices.has(vertex)) { vertices.set(vertex, vertices.size); positions.push(...scene.gradientMeshPositions!.subarray(vertex * 2, vertex * 2 + 2)); colors.push(...scene.gradientMeshColors!.subarray(vertex * 4, vertex * 4 + 4)); }
          indices.push(vertices.get(vertex)!);
        }
      });
      scene.gradientMeshRanges = ranges; scene.gradientMeshPositions = Float32Array.from(positions); scene.gradientMeshColors = Float32Array.from(colors); scene.gradientMeshIndices = Uint32Array.from(indices);
    }
    for (let i = 0; i < scene.gradientFillPaintMeta.length; i += 4) for (const offset of [i, i + 1]) if (scene.gradientFillPaintMeta[offset] >= 0) scene.gradientFillPaintMeta[offset] = map.get(scene.gradientFillPaintMeta[offset])!;
    for (let i = 0; i < scene.gradientStrokeRunMetaA.length; i += 4) for (const offset of [i + 2, i + 3]) if (scene.gradientStrokeRunMetaA[offset] >= 0) scene.gradientStrokeRunMetaA[offset] = map.get(scene.gradientStrokeRunMetaA[offset])!;
    scene.gradientCount = ids.length;
  }
  const glyphs = new Set<number>(); for (let i = 2; i < scene.textInstanceB.length; i += 4) glyphs.add(scene.textInstanceB[i]);
  if (glyphs.size !== scene.textGlyphCount) {
    const ids = [...glyphs].sort((a, b) => a - b), map = new Map(ids.map((id, index) => [id, index]));
    const metaA = new Float32Array(ids.length * 4), metaB = new Float32Array(ids.length * 4), a: number[] = [], b: number[] = [];
    ids.forEach((id, index) => {
      const first = scene.textGlyphMetaA[id * 4], count = scene.textGlyphMetaA[id * 4 + 1];
      metaA.set(scene.textGlyphMetaA.subarray(id * 4, id * 4 + 4), index * 4); metaA[index * 4] = a.length / 4;
      metaB.set(scene.textGlyphMetaB.subarray(id * 4, id * 4 + 4), index * 4);
      for (let i = first * 4; i < (first + count) * 4; i++) { a.push(scene.textGlyphSegmentsA[i]); b.push(scene.textGlyphSegmentsB[i]); }
    });
    for (let i = 2; i < scene.textInstanceB.length; i += 4) scene.textInstanceB[i] = map.get(scene.textInstanceB[i])!;
    scene.textGlyphMetaA = metaA; scene.textGlyphMetaB = metaB; scene.textGlyphSegmentsA = Float32Array.from(a); scene.textGlyphSegmentsB = Float32Array.from(b);
    scene.textGlyphCount = ids.length; scene.textGlyphSegmentCount = a.length / 4;
  }
  if (scene.textClipRects) {
    const ids: number[] = [], map = new Map<number, number>();
    for (let i = 3; i < scene.textInstanceB.length; i += 4) if (scene.textInstanceB[i] > 0) {
      const index = scene.textInstanceB[i] - 1; if (!map.has(index)) { map.set(index, ids.length); ids.push(index); } scene.textInstanceB[i] = map.get(index)! + 1;
    }
    const rectangles = new Float32Array(ids.length * 4); ids.forEach((id, index) => rectangles.set(scene.textClipRects!.subarray(id * 4, id * 4 + 4), index * 4)); scene.textClipRects = ids.length ? rectangles : undefined;
  }
  if (scene.clipPaths) {
    const original = scene.clipPaths, result: VectorClipPath[] = [], map = new Map<number, number>();
    const clip = (index: number): number => {
      if (index < 0) return -1; if (map.has(index)) return map.get(index)!;
      const parent = clip(original[index].parent), next = result.length; result.push({ ...original[index], parent }); map.set(index, next); return next;
    };
    scene.drawRuns = scene.drawRuns!.map(run => run.clipIndex === undefined ? run : { ...run, clipIndex: clip(run.clipIndex) }); scene.clipPaths = result.length ? result : undefined;
  }
  if (scene.retainedPages && scene.paintGraph) {
    const original = scene.retainedPages, result: NonNullable<VectorScene["retainedPages"]> = [], map = new Map<number, number>();
    const visit = (nodes: readonly ScenePaintNode[]): ScenePaintNode[] => nodes.map(node => {
      if (node.kind === "group") return { ...node, children: visit(node.children), ...(node.softMask ? { softMask: { ...node.softMask, children: visit(node.softMask.children) } } : {}) };
      if (node.kind !== "retained") return node;
      if (!map.has(node.retainedPage)) { map.set(node.retainedPage, result.length); result.push(original[node.retainedPage]); }
      return { ...node, retainedPage: map.get(node.retainedPage)! };
    });
    scene.paintGraph = { roots: visit(scene.paintGraph.roots) }; scene.retainedPages = result.length ? result : undefined;
  }
}

/** Append local-page overlays without adding synthetic pages to the document. */
export function composeEditorPage(base: VectorScene, additions: readonly VectorScene[]): VectorScene {
  if (!additions.length) return base;
  const merged = composeOverlappingVectorScenes([base, ...additions]);
  composeEditorPaintIdentity([base, ...additions], merged);
  merged.pageCount = 1; merged.pagesPerRow = 1; merged.pageRects = base.pageRects.slice(0, 4); merged.pageTextRanges = Uint32Array.of(0, merged.textInstanceCount);
  merged.pagePrimitiveRanges = Uint32Array.from(PAGE_PRIMITIVE_KINDS.flatMap(kind => [0, scenePrimitiveCounts(merged)[kind]]));
  merged.rasterLayers = merged.rasterLayers.map(layer => ({ ...layer, pageIndex: 0 }));
  for (let i = 0; i < merged.gradientFillPaintMeta.length; i += 4) merged.gradientFillPaintMeta[i + 3] = 0;
  for (let i = 0; i < merged.gradientStrokeRunMetaB.length; i += 4) merged.gradientStrokeRunMetaB[i + 1] = 0;
  if (merged.textIndex) {
    let text = "", refs: number[] = [], fallback: number[] = [], conditions: number[] = [];
    for (const page of merged.textIndex.pages) {
      if (text && page.text) { text += " "; refs.push(-1); conditions.push(-1); }
      const offset = fallback.length / 4;
      text += page.text; for (let i = 0; i < page.charInstance.length; i++) { const ref = page.charInstance[i]; refs.push(ref <= -2 ? ref - offset : ref); conditions.push(page.optionalContent?.[i] ?? -1); }
      for (const value of page.fallbackQuads) fallback.push(value);
    }
    merged.textIndex = { version: 2, pages: [{ text, charInstance: Int32Array.from(refs), fallbackQuads: Float32Array.from(fallback), optionalContent: Int32Array.from(conditions) }] };
  }
  merged.annotations = merged.annotations?.map(annotation => ({ ...annotation, pageIndex: 0 })); merged.pdfPages = base.pdfPages;
  return merged;
}

export function transformWholeEditorScene(scene: VectorScene, matrix: EditorMatrix, signal?: AbortSignal,
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void): VectorScene {
  if (editorMatrixIsIdentity(matrix)) return scene;
  const counts = scenePrimitiveCounts(scene), edits: EditorSourceEdit[] = [];
  for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) edits.push({ ref: { kind, index }, transform: matrix, deleted: false });
  return bakeEditorSourceScene(scene, edits, signal, onDiagnostic);
}

export function splitEditorPages(scene: VectorScene): VectorScene[] {
  const partition = new ScenePageViews(scene);
  return Array.from({ length: partition.pageCount }, (_, index) => partition.extract(index).scene);
}
