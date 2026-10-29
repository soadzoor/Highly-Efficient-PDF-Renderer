import type { VectorScene } from "./pdfVectorExtractor";
import { getEditorSceneTranslationHint, type EditorSceneTranslationHint } from "./editorScenePreview";
import { vectorFillCoverageMetadata } from "./vectorFillCoverage";
import { clipRectangle, vectorClipChainBounds } from "./vectorClips";
import type { VectorFillDrawData } from "./vectorFillDrawSelection";

export interface EditorPreviewSceneUpdate {
  hint: EditorSceneTranslationHint;
  strokes: readonly number[];
  fills: readonly number[];
  texts: readonly number[];
  textClips: readonly number[];
}
export type EditorPreviewTexture = "strokeA" | "strokeB" | "strokeBounds" | "fillA" | "fillB" | "fillC" | "fillSegmentsA" | "fillSegmentsB" | "textB" | "glyphA";
export interface EditorPreviewTexel { kind: EditorPreviewTexture; index: number; pixels: Float32Array }
export interface EditorPreviewTextureRow extends EditorPreviewTexel { count: number }

const immutableStores = ["styles", "textInstanceA", "textInstanceC", "textGlyphMetaA", "textGlyphMetaB", "textGlyphSegmentsA", "textGlyphSegmentsB",
  "fillPathMetaC", "pageRects", "pageTextRanges", "drawRuns", "paintGraph", "optionalContent", "rasterLayers", "retainedPages",
  "gradientMetaA", "gradientMetaB", "gradientMetaC", "gradientMetaD", "gradientMetaE", "gradientLut", "gradientMeshRanges", "gradientMeshPositions", "gradientMeshColors", "gradientMeshIndices",
  "gradientFillPathMetaA", "gradientFillPathMetaB", "gradientFillPathMetaC", "gradientFillPaintMeta", "gradientFillSegmentsA", "gradientFillSegmentsB",
  "gradientStrokeRunMetaA", "gradientStrokeRunMetaB", "gradientStrokeEndpoints", "gradientStrokePrimitiveMeta", "gradientStrokePrimitiveBounds", "gradientStrokeStyles"] as const;
const positionedStores = ["endpoints", "primitiveMeta", "primitiveBounds", "fillPathMetaA", "fillPathMetaB", "fillSegmentsA", "fillSegmentsB", "textInstanceB"] as const;

/** Prove that the currently uploaded generation can receive a position-only update. */
export function prepareEditorPreviewSceneUpdate(previous: VectorScene, scene: VectorScene): EditorPreviewSceneUpdate | null {
  const hint = getEditorSceneTranslationHint(scene), before = getEditorSceneTranslationHint(previous);
  if (!hint || !Number.isFinite(hint.dx) || !Number.isFinite(hint.dy) || hint.source !== (before?.source ?? previous)) return null;
  // Preparation rejects selected compositing groups. Unchanged effects elsewhere
  // still use the normal compositor with the current scene and original graph.
  if (!scene.drawRuns) return null;
  if (scene.pageCount !== previous.pageCount || scene.segmentCount !== previous.segmentCount || scene.fillPathCount !== previous.fillPathCount ||
      scene.fillSegmentCount !== previous.fillSegmentCount || scene.textInstanceCount !== previous.textInstanceCount ||
      scene.textGlyphCount !== previous.textGlyphCount || scene.textGlyphSegmentCount !== previous.textGlyphSegmentCount || scene.maxHalfWidth !== previous.maxHalfWidth ||
      scene.gradientCount !== previous.gradientCount || scene.gradientFillPathCount !== previous.gradientFillPathCount || scene.gradientFillSegmentCount !== previous.gradientFillSegmentCount ||
      scene.gradientStrokeRunCount !== previous.gradientStrokeRunCount || scene.gradientStrokeSegmentCount !== previous.gradientStrokeSegmentCount ||
      immutableStores.some(key => scene[key] !== previous[key]) || positionedStores.some(key => scene[key].length !== previous[key].length) ||
      (scene.textClipRects?.length ?? 0) !== (previous.textClipRects?.length ?? 0) || (scene.clipPaths?.length ?? 0) !== (previous.clipPaths?.length ?? 0)) return null;
  const movedClips = new Set(hint.changedClips);
  for (let index = 0; index < (scene.clipPaths?.length ?? 0); index++) {
    const clip = scene.clipPaths![index], old = previous.clipPaths![index];
    if (clip.parent !== old.parent || clip.fillRule !== old.fillRule || !movedClips.has(index) && clip.edges !== old.edges ||
        movedClips.has(index) && (!clipRectangle(clip.edges) || !clipRectangle(old.edges))) return null;
  }
  const strokes = new Set<number>(), fills = new Set<number>(), texts = new Set<number>(), clips = new Set<number>();
  for (const ref of hint.changed) {
    const count = ref.kind === "stroke" ? scene.segmentCount : ref.kind === "fill" ? scene.fillPathCount : ref.kind === "text" ? scene.textInstanceCount : -1;
    if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= count) return null;
    if (ref.kind === "stroke") strokes.add(ref.index);
    else if (ref.kind === "fill") {
      const offset = ref.index * 4;
      if (scene.fillPathMetaA[offset] !== previous.fillPathMetaA[offset] || scene.fillPathMetaA[offset + 1] !== previous.fillPathMetaA[offset + 1]) return null;
      fills.add(ref.index);
    } else if (ref.kind === "text") {
      const offset = ref.index * 4, clip = scene.textInstanceB[offset + 3];
      if (scene.textInstanceB[offset + 2] !== previous.textInstanceB[offset + 2] || clip !== previous.textInstanceB[offset + 3]) return null;
      texts.add(ref.index);
      if (clip > 0) {
        if (!Number.isInteger(clip) || clip * 4 > (scene.textClipRects?.length ?? 0)) return null;
        clips.add(clip - 1);
      }
    }
  }
  return { hint, strokes: [...strokes], fills: [...fills], texts: [...texts], textClips: [...clips] };
}

/** Recompute only moved fills; static path integrals and bounds stay cached. */
export function editorPreviewFillCoverage(scene: VectorScene, update: EditorPreviewSceneUpdate): ReturnType<typeof vectorFillCoverageMetadata> {
  const original = vectorFillCoverageMetadata(update.hint.source);
  if (!update.fills.length) return original;
  const take = (values: Float32Array): Float32Array => Float32Array.from(update.fills.flatMap(index => Array.from(values.subarray(index * 4, index * 4 + 4))));
  const moved = vectorFillCoverageMetadata({ ...scene, fillPathCount: update.fills.length,
    fillPathMetaA: take(scene.fillPathMetaA), fillPathMetaB: take(scene.fillPathMetaB), fillPathMetaC: take(scene.fillPathMetaC) });
  const result = { pathMetaA: original.pathMetaA.slice(), pathMetaB: original.pathMetaB.slice(), pathMetaC: original.pathMetaC.slice() };
  update.fills.forEach((index, position) => {
    result.pathMetaA.set(moved.pathMetaA.subarray(position * 4, position * 4 + 4), index * 4);
    result.pathMetaB.set(moved.pathMetaB.subarray(position * 4, position * 4 + 4), index * 4);
    result.pathMetaC.set(moved.pathMetaC.subarray(position * 4, position * 4 + 4), index * 4);
  });
  return result;
}

/** Preserve unrelated renderer-only sparse paths while replacing canonical rows. */
export function editorPreviewFillDrawData(scene: VectorScene, update: EditorPreviewSceneUpdate,
  coverage: ReturnType<typeof vectorFillCoverageMetadata>, previous: VectorFillDrawData): VectorFillDrawData {
  if (!update.fills.length) return previous;
  const metadata = previous.pathMetaA.length === coverage.pathMetaA.length ? coverage : {
    pathMetaA: previous.pathMetaA.slice(), pathMetaB: previous.pathMetaB.slice(), pathMetaC: previous.pathMetaC.slice()
  };
  if (metadata !== coverage) for (const key of ["pathMetaA", "pathMetaB", "pathMetaC"] as const) {
    for (const index of update.fills) metadata[key].set(coverage[key].subarray(index * 4, index * 4 + 4), index * 4);
  }
  return { ...previous, ...metadata, segmentsA: scene.fillSegmentsA, segmentsB: scene.fillSegmentsB };
}

/** Preserve the clip shader's antialiasing while updating independently owned rectangles. */
export function editorPreviewRectangleClipTexels(scene: VectorScene, update: EditorPreviewSceneUpdate, headers: Float32Array | null):
  { patches: readonly { index: number; pixels: Float32Array }[]; bounds?: Float32Array } | null {
  const moved = update.hint.changedClips ?? [];
  if (!moved.length) return { patches: [] };
  const clips = scene.clipPaths ?? [];
  if (!headers || headers.length !== clips.length * 4) return null;
  const patches: { index: number; pixels: Float32Array }[] = [];
  for (const index of moved) {
    const clip = clips[index], bounds = clip && clipRectangle(clip.edges), payload = headers[index * 4 + 1];
    if (!bounds || headers[index * 4 + 2] !== -1 || !Number.isSafeInteger(payload) || payload < clips.length) return null;
    for (let other = 0; other < clips.length; other++) if (other !== index && headers[other * 4 + 1] === payload) return null;
    let parent = clip.parent;
    while (parent >= 0) {
      const rectangle = clipRectangle(clips[parent].edges); if (!rectangle) break;
      bounds[0] = Math.max(bounds[0], rectangle[0]); bounds[1] = Math.max(bounds[1], rectangle[1]);
      bounds[2] = Math.min(bounds[2], rectangle[2]); bounds[3] = Math.min(bounds[3], rectangle[3]); parent = clips[parent].parent;
    }
    if (headers[index * 4] !== parent) return null;
    patches.push({ index: payload, pixels: Float32Array.from(bounds) });
  }
  return { patches, bounds: vectorClipChainBounds(clips) };
}

/** Canonical texels; renderer-specific packed index headers are handled separately. */
export function editorPreviewSceneTexels(scene: VectorScene, update: EditorPreviewSceneUpdate,
  coverage: ReturnType<typeof vectorFillCoverageMetadata>): EditorPreviewTexel[] {
  const patches: EditorPreviewTexel[] = [];
  const add = (kind: EditorPreviewTexture, index: number, values: Float32Array): void => { patches.push({ kind, index, pixels: values.subarray(index * 4, index * 4 + 4) }); };
  for (const index of update.strokes) {
    add("strokeA", index, scene.endpoints); add("strokeB", index, scene.primitiveMeta); add("strokeBounds", index, scene.primitiveBounds);
  }
  for (const index of update.fills) {
    add("fillA", index, coverage.pathMetaA); add("fillB", index, coverage.pathMetaB); add("fillC", index, coverage.pathMetaC);
    const offset = index * 4, first = scene.fillPathMetaA[offset], count = scene.fillPathMetaA[offset + 1];
    for (let segment = first; segment < first + count; segment++) { add("fillSegmentsA", segment, scene.fillSegmentsA); add("fillSegmentsB", segment, scene.fillSegmentsB); }
  }
  for (const index of update.texts) {
    const pixels = scene.textInstanceB.slice(index * 4, index * 4 + 4);
    if (pixels[3] > 0) pixels[3] += scene.textGlyphCount;
    patches.push({ kind: "textB", index, pixels });
  }
  for (const clip of update.textClips) patches.push({ kind: "glyphA", index: scene.textGlyphCount + clip,
    pixels: scene.textClipRects!.subarray(clip * 4, clip * 4 + 4) });
  return patches;
}

/** Coalesce adjacent texels on the same GPU texture row without crossing its width. */
export function coalesceEditorPreviewTexels(patches: readonly EditorPreviewTexel[], widths: Readonly<Record<EditorPreviewTexture, number>>): EditorPreviewTextureRow[] {
  const groups = new Map<EditorPreviewTexture, Map<number, Float32Array>>();
  for (const patch of patches) { let group = groups.get(patch.kind); if (!group) groups.set(patch.kind, group = new Map()); group.set(patch.index, patch.pixels); }
  const rows: EditorPreviewTextureRow[] = [];
  for (const [kind, group] of groups) {
    const ids = [...group.keys()].sort((a, b) => a - b), width = widths[kind];
    for (let start = 0; start < ids.length;) {
      let end = start + 1;
      while (end < ids.length && ids[end] === ids[end - 1] + 1 && Math.floor(ids[end] / width) === Math.floor(ids[start] / width)) end++;
      const count = end - start, pixels = count === 1 ? group.get(ids[start])! : new Float32Array(count * 4);
      if (count > 1) for (let index = start; index < end; index++) pixels.set(group.get(ids[index])!, (index - start) * 4);
      rows.push({ kind, index: ids[start], count, pixels }); start = end;
    }
  }
  return rows;
}
