import type { VectorScene, VectorDrawRun, Bounds } from "./pdfVectorExtractor";
import type { PrimitiveRef } from "./scenePrimitives";
import { getScenePrimitiveBounds } from "./scenePrimitives";
import { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } from "./scenePageViews";
import type { ScenePaintNode } from "./scenePaintGraph";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { bakeEditorAnnotationEdits, editorUnionBounds, retainEditorAnnotationPlacements, editorSelectionClipOwnership } from "./editorScene";
import { setEditorSceneTranslationHint } from "./editorScenePreview";

const key = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;

/** Prepare immutable geometry once; translation never changes paint topology or resources. */
export function prepareEditorTranslationPreview(scene: VectorScene, refs: readonly PrimitiveRef[], annotationIds: readonly string[]): {
  translate(dx: number, dy: number, signal?: AbortSignal): VectorScene;
} | null {
  refs = [...new Map(refs.map(ref => [key(ref), ref])).values()];
  if (refs.some(ref => ref.kind !== "stroke" && ref.kind !== "fill" && ref.kind !== "text")) return null;
  const selected = new Set(refs.map(key)), originalRuns = scene.drawRuns ?? defaultVectorDrawRuns(scene);
  const selectedRun = (index: number): boolean => {
    const run = originalRuns[index];
    for (let i = run.first; i < run.first + run.count; i++) if (selected.has(key({ kind: run.kind, index: i }))) return true;
    return false;
  };
  let unsupported = false;
  const movingNodes = new WeakSet<ScenePaintNode>();
  const inspect = (nodes: readonly ScenePaintNode[]): boolean => {
    let contains = false;
    for (const node of nodes) {
      let own = false;
      if (node.kind === "draw") own = selectedRun(node.runIndex);
      else if (node.kind === "group") {
        const body = inspect(node.children), mask = node.softMask ? inspect(node.softMask.children) : false;
        if ((body || mask) && (node.softMask || node.knockout || node.isolated || node.alpha !== 1 || node.alphaIsShape || node.blendMode !== "Normal")) unsupported = true;
        own = body || mask;
      }
      if (own) movingNodes.add(node);
      contains ||= own;
    }
    return contains;
  };
  if (scene.paintGraph) inspect(scene.paintGraph.roots);
  if (unsupported) return null;
  const strokes = refs.filter(ref => ref.kind === "stroke").map(ref => ref.index);
  const fills = refs.filter(ref => ref.kind === "fill").map(ref => ref.index);
  const texts = refs.filter(ref => ref.kind === "text").map(ref => ref.index);
  // General transforms promote these legacy hard clips to antialiased vector
  // clips. Keep their preview on that path so release cannot change edge coverage.
  if (strokes.some(index => (Math.floor(scene.primitiveMeta[index * 4 + 3] / 2) & 4) !== 0) ||
      texts.some(index => scene.textInstanceB[index * 4 + 3] > 0)) return null;
  // Legacy word boxes do not identify their individual glyph owners.
  if (texts.length && scene.textContent?.length) return null;
  const fillSegments = new Set<number>();
  for (const index of fills) {
    const first = scene.fillPathMetaA[index * 4], count = scene.fillPathMetaA[index * 4 + 1];
    for (let i = first; i < first + count; i++) fillSegments.add(i);
  }
  // A shared path must be detached before editing; retain the general compiler for it.
  for (let index = 0; index < scene.fillPathCount; index++) if (!selected.has(`fill:${index}`)) {
    const first = scene.fillPathMetaA[index * 4], count = scene.fillPathMetaA[index * 4 + 1];
    for (let i = first; i < first + count; i++) if (fillSegments.has(i)) return null;
  }
  const clips = scene.clipPaths?.slice() ?? [], clipCopies = new Map<number, number>(), changedClips: number[] = [];
  const ownsClip = editorSelectionClipOwnership(scene, refs);
  const detachClip = (index: number): number => {
    if (index < 0) return index;
    const existing = clipCopies.get(index); if (existing !== undefined) return existing;
    const original = scene.clipPaths![index], parent = detachClip(original.parent), owned = ownsClip(index);
    if (!owned && parent === original.parent) { clipCopies.set(index, index); return index; }
    const next = clips.length;
    clips.push({ ...original, parent }); clipCopies.set(index, next); if (owned) changedClips.push(next); return next;
  };
  const drawRuns: VectorDrawRun[] = [], runMap = new Map<number, number[]>();
  originalRuns.forEach((run, runIndex) => {
    const indices: number[] = [];
    for (let index = run.first; index < run.first + run.count; index++) {
      const clipIndex = selected.has(key({ kind: run.kind, index })) && run.clipIndex !== undefined ? detachClip(run.clipIndex) : run.clipIndex;
      const previous = drawRuns[drawRuns.length - 1];
      if (indices.length && previous.first + previous.count === index && previous.clipIndex === clipIndex) previous.count++;
      else { indices.push(drawRuns.length); drawRuns.push({ ...run, first: index, count: 1, ...(clipIndex === undefined ? {} : { clipIndex }) }); }
    }
    runMap.set(runIndex, indices);
  });
  const nodes = (input: readonly ScenePaintNode[]): ScenePaintNode[] => input.flatMap((node): ScenePaintNode[] => node.kind === "draw"
    ? (runMap.get(node.runIndex) ?? []).map(runIndex => ({ ...node, runIndex }))
    : node.kind === "group" ? [{ ...node, bounds: movingNodes.has(node) ? undefined : node.bounds, children: nodes(node.children),
      ...(node.softMask ? { softMask: { ...node.softMask, children: nodes(node.softMask.children) } } : {}) }] : [node]);
  const baseline: VectorScene = { ...scene, drawRuns,
    ...(clips.length ? { clipPaths: clips } : {}), ...(scene.paintGraph ? { paintGraph: { roots: nodes(scene.paintGraph.roots) } } : {}) };
  retainEditorAnnotationPlacements(scene, baseline);
  let stationaryBounds = { ...scene.pageBounds }, movingBounds: Bounds | null = null;
  const counts = scenePrimitiveCounts(scene);
  for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
    const bounds = getScenePrimitiveBounds(scene, { kind, index });
    if (selected.has(key({ kind, index }))) movingBounds = editorUnionBounds(movingBounds, bounds);
    else stationaryBounds = editorUnionBounds(stationaryBounds, bounds);
  }
  const shiftBounds = (bounds: Bounds, dx: number, dy: number): Bounds => ({ minX: bounds.minX + dx, minY: bounds.minY + dy,
    maxX: bounds.maxX + dx, maxY: bounds.maxY + dy });
  return { translate(dx, dy, signal) {
    signal?.throwIfAborted();
    const result: VectorScene = { ...baseline, bounds: movingBounds ? editorUnionBounds(stationaryBounds, shiftBounds(movingBounds, dx, dy)) : stationaryBounds };
    if (strokes.length) {
      result.endpoints = baseline.endpoints.slice(); result.primitiveMeta = baseline.primitiveMeta.slice(); result.primitiveBounds = baseline.primitiveBounds.slice();
      for (const index of strokes) {
        const i = index * 4;
        result.endpoints[i] += dx; result.endpoints[i + 1] += dy;
        if (baseline.primitiveMeta[i + 2] >= .5) { result.endpoints[i + 2] += dx; result.endpoints[i + 3] += dy; }
        result.primitiveMeta[i] += dx; result.primitiveMeta[i + 1] += dy;
        result.primitiveBounds[i] += dx; result.primitiveBounds[i + 1] += dy; result.primitiveBounds[i + 2] += dx; result.primitiveBounds[i + 3] += dy;
      }
    }
    if (fills.length) {
      result.fillSegmentsA = baseline.fillSegmentsA.slice(); result.fillSegmentsB = baseline.fillSegmentsB.slice();
      result.fillPathMetaA = baseline.fillPathMetaA.slice(); result.fillPathMetaB = baseline.fillPathMetaB.slice();
      for (const index of fillSegments) {
        const i = index * 4; result.fillSegmentsA[i] += dx; result.fillSegmentsA[i + 1] += dy;
        if (baseline.fillSegmentsB[i + 2] >= .5) { result.fillSegmentsA[i + 2] += dx; result.fillSegmentsA[i + 3] += dy; }
        result.fillSegmentsB[i] += dx; result.fillSegmentsB[i + 1] += dy;
      }
      for (const index of fills) {
        const i = index * 4; result.fillPathMetaA[i + 2] += dx; result.fillPathMetaA[i + 3] += dy;
        result.fillPathMetaB[i] += dx; result.fillPathMetaB[i + 1] += dy;
      }
    }
    if (texts.length) {
      result.textInstanceB = baseline.textInstanceB.slice();
      for (const index of texts) { result.textInstanceB[index * 4] += dx; result.textInstanceB[index * 4 + 1] += dy; }
    }
    if (changedClips.length) {
      result.clipPaths = baseline.clipPaths!.slice();
      for (const index of changedClips) {
        const clip = baseline.clipPaths![index];
        result.clipPaths[index] = { ...clip, edges: Float32Array.from(clip.edges, (value, offset) => value + (offset % 2 ? dy : dx)) };
      }
    }
    retainEditorAnnotationPlacements(baseline, result);
    const translated = bakeEditorAnnotationEdits(result, annotationIds.map(id => ({ id, deleted: false, transform: [1, 0, 0, 1, dx, dy] })));
    setEditorSceneTranslationHint(translated, { source: baseline, changed: refs, dx, dy, ...(changedClips.length ? { changedClips } : {}) });
    signal?.throwIfAborted(); return translated;
  } };
}
