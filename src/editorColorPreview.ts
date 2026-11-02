import type { EditorSession } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import { editorAuthoredOwner, editorPaintIdentity, editorPaintOwnerObject, editorPaintRole } from "./editorPaintIdentity";
import { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } from "./scenePageViews";
import { getPrimitiveVisibilityConditions, getSceneAnnotationRuns, type PrimitiveRef } from "./scenePrimitives";

interface PaintIndex {
  identity: ReturnType<typeof editorPaintIdentity>;
  role: ReturnType<typeof editorPaintRole>;
  owners: Map<string, PrimitiveRef[]>;
  objects: Map<string, PrimitiveRef[]>;
}
const indexes = new WeakMap<VectorScene, PaintIndex>();
const key = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;
const sourceFill = (ref: PrimitiveRef): boolean => ref.kind === "fill" || ref.kind === "gradient-fill";
function paintIndex(scene: VectorScene): PaintIndex {
  const identity = editorPaintIdentity(scene), role = editorPaintRole(scene), previous = indexes.get(scene);
  if (previous?.identity === identity && previous.role === role) return previous;
  const result: PaintIndex = { identity, role, owners: new Map(), objects: new Map() }, counts = scenePrimitiveCounts(scene);
  for (const kind of PAGE_PRIMITIVE_KINDS) {
    if (kind === "raster") continue;
    for (let index = 0; index < counts[kind]; index++) {
      const ref = { kind, index };
      if (role(ref) === null || getPrimitiveVisibilityConditions(scene, ref) === null) continue;
      const owner = identity(ref), owned = result.owners.get(owner) ?? []; owned.push(ref); result.owners.set(owner, owned);
      const id = editorPaintOwnerObject(owner);
      if (id !== undefined) { const objects = result.objects.get(id) ?? []; objects.push(ref); result.objects.set(id, objects); }
    }
  }
  indexes.set(scene, result); return result;
}

/** Equal immutable coordinate stores prove that raw primitive addresses survived a color-only edit. */
function stablePrimitiveAddress(source: VectorScene, scene: VectorScene, ref: PrimitiveRef): boolean {
  if (source === scene) return true;
  const counts = scenePrimitiveCounts(source), current = scenePrimitiveCounts(scene);
  if (counts[ref.kind] !== current[ref.kind]) return false;
  switch (ref.kind) {
    case "stroke": return source.endpoints === scene.endpoints && source.primitiveMeta === scene.primitiveMeta;
    case "fill": return source.fillSegmentsA === scene.fillSegmentsA && source.fillSegmentsB === scene.fillSegmentsB && source.fillPathMetaA === scene.fillPathMetaA;
    case "text": return source.textInstanceA === scene.textInstanceA && source.textInstanceB === scene.textInstanceB;
    case "gradient-fill": return source.gradientFillSegmentsA === scene.gradientFillSegmentsA && source.gradientFillSegmentsB === scene.gradientFillSegmentsB && source.gradientFillPathMetaA === scene.gradientFillPathMetaA;
    case "gradient-stroke": return source.gradientStrokeEndpoints === scene.gradientStrokeEndpoints && source.gradientStrokePrimitiveMeta === scene.gradientStrokePrimitiveMeta && source.gradientStrokeRunMetaA === scene.gradientStrokeRunMetaA;
    default: return false;
  }
}

/** Resolve once per picker/compiled scene; subsequent samples update RGB only.
 * Roles retain the difference between a filled body and an outlined stroke.
 * Ambiguous host-supplied identities fail explicitly rather than tinting other objects. */
export function resolveEditorColorPreviewRefs(session: EditorSession, scene: VectorScene, ids: readonly string[], property: "color" | "fill"): PrimitiveRef[] {
  let compiled: PaintIndex | undefined, source: PaintIndex | undefined, resolveSources = false;
  const currentIndex = (): PaintIndex => compiled ??= paintIndex(scene), sourceIndex = (): PaintIndex => source ??= paintIndex(session.sourceScene);
  const compiledRole = editorPaintRole(scene), compiledIdentity = editorPaintIdentity(scene), sourceIdentity = editorPaintIdentity(session.sourceScene);
  const selected = new Map<string, PrimitiveRef>(), visited = new Set<string>(), originals = new Map<string, PrimitiveRef>();
  const include = (refs: readonly PrimitiveRef[], sourceColor: boolean): void => {
    for (const ref of refs) if (sourceColor || compiledRole(ref) === property) selected.set(key(ref), ref);
  };
  const visit = (id: string): void => {
    if (visited.has(id)) return; visited.add(id);
    if (session.isObjectLocked(id)) return;
    const object = session.getObject(id);
    if (object.kind === "group") { object.children.forEach(visit); return; }
    if (object.kind === "image") return;
    if (object.kind !== "source" || object.isClone) {
      if (sourceIndex().objects.has(id) || sourceIndex().owners.has(editorAuthoredOwner(id))) throw new Error("Live color preview cannot separate reused source object identities. The final color can still be committed.");
      include(currentIndex().objects.get(id) ?? [], object.kind === "source" && property === "color"); return;
    }
    if (object.annotationId && id === `annotation:${object.annotationId}`) {
      const refs = (getSceneAnnotationRuns(scene).get(object.annotationId) ?? []).flatMap(run =>
        Array.from({ length: run.count }, (_, offset) => ({ kind: run.kind, index: run.first + offset })))
        .filter(ref => ref.kind !== "raster" && getPrimitiveVisibilityConditions(scene, ref) !== null);
      include(refs, property === "color"); return;
    }
    const refs = object.primitives.filter(ref => ref.kind !== "raster" && getPrimitiveVisibilityConditions(session.sourceScene, ref) !== null &&
      (property === "color" || sourceFill(ref)));
    refs.forEach(ref => originals.set(key(ref), ref));
    // Ordinary source recoloring retains exact addresses. Avoid constructing
    // whole-document owner indexes for the first sample of a small selection.
    if (refs.every(ref => stablePrimitiveAddress(session.sourceScene, scene, ref) && compiledIdentity(ref) === sourceIdentity(ref))) {
      for (const ref of refs) if (getPrimitiveVisibilityConditions(scene, ref) !== null) selected.set(key(ref), ref);
    } else resolveSources = true;
  };
  ids.forEach(visit);
  if (!resolveSources) return [...selected.values()].map(ref => ({ ...ref }));
  const sourcePaint = sourceIndex(), currentPaint = currentIndex(), owners = new Set([...originals.values()].map(sourcePaint.identity));
  for (const owner of owners) {
    const all = sourcePaint.owners.get(owner) ?? [], members = all.filter(ref => property === "color" || sourceFill(ref));
    const inconsistentRole = property === "fill" && all.some(ref => sourcePaint.role(ref) !== (sourceFill(ref) ? "fill" : "color"));
    if (members.some(ref => !originals.has(key(ref))) || inconsistentRole && all.some(ref => !originals.has(key(ref)))) {
      for (const ref of [...originals.values()].filter(ref => sourcePaint.identity(ref) === owner)) {
        if (!stablePrimitiveAddress(session.sourceScene, scene, ref) || compiledIdentity(ref) !== owner)
          throw new Error("Live color preview cannot isolate this shared source identity. Select the complete source group to preview its color.");
        selected.set(key(ref), ref);
      }
    } else include(currentPaint.owners.get(owner) ?? [], property === "color" || property === "fill" && all.every(sourceFill));
  }
  return [...selected.values()].map(ref => ({ ...ref }));
}
