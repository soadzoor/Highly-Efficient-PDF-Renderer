import type { VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveRef, PrimitiveKind } from "./scenePrimitives";
import { getSceneAnnotationRuns } from "./scenePrimitives";
import { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } from "./scenePageViews";

type Resolver = (ref: PrimitiveRef) => string;
const identities = new WeakMap<VectorScene, Resolver>();
export const editorAuthoredOwner = (id: string): string => `object:${JSON.stringify(id)}`;
export const editorCloneOwner = (id: string, original: string): string => `clone:${JSON.stringify([id, original])}`;
export function editorPaintOwnerObject(owner: string): string | undefined {
  if (owner.startsWith("object:")) return JSON.parse(owner.slice(7));
  if (owner.startsWith("clone:")) return JSON.parse(owner.slice(6))[0];
  return undefined;
}
export function remapEditorPaintOwner(owner: string, ids: ReadonlyMap<string, string>): string {
  const id = editorPaintOwnerObject(owner), next = id === undefined ? undefined : ids.get(id);
  if (next === undefined) return owner;
  return owner.startsWith("object:") ? editorAuthoredOwner(next) : editorCloneOwner(next, JSON.parse(owner.slice(6))[1]);
}

/** Operation-local provenance only. Nothing is added to scene or HEP data. */
export function editorPaintIdentity(scene: VectorScene): Resolver {
  let resolver = identities.get(scene); if (resolver) return resolver;
  const annotations = new Map<PrimitiveKind, { first: number; end: number; owner: string }[]>();
  for (const [id, runs] of getSceneAnnotationRuns(scene)) for (const run of runs) {
    const ranges = annotations.get(run.kind) ?? []; ranges.push({ first: run.first, end: run.first + run.count, owner: `annotation:${id}` }); annotations.set(run.kind, ranges);
  }
  for (const ranges of annotations.values()) ranges.sort((a, b) => a.first - b.first);
  resolver = ref => {
    const ranges = annotations.get(ref.kind) ?? []; let low = 0, high = ranges.length;
    while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle].first <= ref.index) low = middle + 1; else high = middle; }
    const range = ranges[low - 1]; return range && ref.index < range.end ? range.owner : `source:${ref.kind}:${ref.index}`;
  };
  identities.set(scene, resolver); return resolver;
}
export function setEditorPaintIdentity(scene: VectorScene, resolver: Resolver | string): void {
  identities.set(scene, typeof resolver === "string" ? () => resolver : resolver);
}
export function retainEditorPaintIdentity(source: VectorScene, target: VectorScene): void {
  const resolver = identities.get(source); if (resolver && !identities.has(target)) identities.set(target, resolver);
}
export function remapEditorPaintIdentity(source: VectorScene, target: VectorScene, indices: Record<PrimitiveKind, ArrayLike<number>>): void {
  const resolver = editorPaintIdentity(source);
  identities.set(target, ref => resolver({ kind: ref.kind, index: indices[ref.kind][ref.index] }));
}
export function composeEditorPaintIdentity(sources: readonly VectorScene[], target: VectorScene): void {
  const resolvers = sources.map(editorPaintIdentity), counts = sources.map(scenePrimitiveCounts);
  const ends = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => { let end = 0; return [kind, counts.map(count => end += count[kind])]; })) as Record<PrimitiveKind, number[]>;
  identities.set(target, ref => {
    const limits = ends[ref.kind]; let low = 0, high = limits.length;
    while (low < high) { const middle = (low + high) >>> 1; if (limits[middle] <= ref.index) low = middle + 1; else high = middle; }
    return resolvers[low]({ kind: ref.kind, index: ref.index - (limits[low - 1] ?? 0) });
  });
}
