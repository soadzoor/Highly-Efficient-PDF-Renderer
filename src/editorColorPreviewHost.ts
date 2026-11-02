import type { VectorScene } from "./pdfVectorExtractor";
import { normalizePrimitiveColor } from "./colorInput";
import type { PrimitiveColorUpdate } from "./primitiveAppearance";
import { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts, type ScenePageView } from "./scenePageViews";
import { validatePrimitiveRef, type PrimitiveKind, type PrimitiveRef } from "./scenePrimitives";

const key = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;
type RefMap = Record<PrimitiveKind, Uint32Array>;

/** Canonical editor refs mapped through a Reader/Grid page recomposition. */
function pageRefMap(source: VectorScene, displayed: VectorScene, views: readonly ScenePageView[]): RefMap | null {
  const sourceCounts = scenePrimitiveCounts(source), displayedCounts = scenePrimitiveCounts(displayed);
  const result = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Uint32Array(sourceCounts[kind])])) as RefMap;
  for (const kind of PAGE_PRIMITIVE_KINDS) {
    let offset = 0;
    for (const view of views) {
      const indices = view.primitives[kind];
      for (let index = 0; index < indices.length; index++) {
        const original = indices[index];
        if (original >= sourceCounts[kind] || result[kind][original] !== 0) return null;
        result[kind][original] = offset + index + 1;
      }
      offset += indices.length;
    }
    if (offset !== sourceCounts[kind] || offset !== displayedCounts[kind]) return null;
  }
  return result;
}

/** GPU-only RGB handoff. No document mutation, picking, timers, or frame work. */
export function createEditorColorPreviewHost<T extends object>(options: {
  getTarget(): T | null;
  getScene(): VectorScene | null;
  canApply?(target: T): boolean;
  apply(target: T, updates: readonly PrimitiveColorUpdate[]): void;
}) {
  let binding: { source: VectorScene; displayed: VectorScene; views?: readonly ScenePageView[]; refs?: RefMap } | null = null;
  let target: T | null = null, scene: VectorScene | null = null;
  let owned = new Map<string, PrimitiveColorUpdate>();
  const clear = (): void => {
    if (owned.size && target === options.getTarget() && scene === options.getScene() && target && options.canApply?.(target) !== false)
      options.apply(target, [...owned.values()].map(update => ({ ref: update.ref, color: null })));
    owned.clear(); target = null; scene = null;
  };
  return {
    /** Bind only the frame acknowledged for this canonical publication. */
    bind(source: VectorScene, displayed: VectorScene, views?: readonly ScenePageView[]): void {
      clear();
      // Keep the presented-frame callback constant time. Only an actual color
      // gesture in a recomposed layout needs its compact inverse ref tables.
      binding = source === displayed ? { source, displayed } : views ? { source, displayed, views } : null;
    },
    /** Called immediately before installing the replacement, after any asynchronous preparation. */
    beforeSceneChange(): void { clear(); binding = null; },
    hasPreview(): boolean { return owned.size > 0 && target === options.getTarget() && scene === options.getScene(); },
    previewColors(updates: readonly PrimitiveColorUpdate[] | null): boolean {
      if (updates === null) { clear(); return true; }
      const current = options.getTarget(), displayed = options.getScene();
      if (!current || !binding || displayed !== binding.displayed || options.canApply?.(current) === false) return false;
      if (binding.source !== displayed && !binding.refs) {
        const refs = pageRefMap(binding.source, displayed, binding.views!);
        if (!refs) { binding = null; return false; }
        binding.refs = refs;
      }
      const next = new Map<string, PrimitiveColorUpdate>();
      try {
        for (const update of updates) {
          validatePrimitiveRef(binding.source, update.ref);
          if (update.ref.kind === "raster") return false;
          const mapped = binding.refs?.[update.ref.kind][update.ref.index];
          if (binding.refs && !mapped) return false;
          const ref = mapped === undefined ? update.ref : { kind: update.ref.kind, index: mapped - 1 };
          validatePrimitiveRef(displayed, ref);
          if (update.color) next.set(key(ref), { ref: { ...ref }, color: normalizePrimitiveColor(update.color) });
        }
      } catch { return false; }
      // A replacement backend/object owns new textures. Never restore stale
      // indices into it; replay the current complete preview instead.
      const previous = target === current && scene === displayed ? owned : new Map<string, PrimitiveColorUpdate>();
      const changes: PrimitiveColorUpdate[] = [...previous].filter(([id]) => !next.has(id)).map(([, update]) => ({ ref: update.ref, color: null }));
      for (const [id, update] of next) {
        const before = previous.get(id)?.color;
        if (!before || update.color!.some((value, index) => value !== before[index])) changes.push(update);
      }
      if (changes.length) options.apply(current, changes);
      owned = next; target = current; scene = displayed; return true;
    }
  };
}

/** Three's public primitive API batches one RGB value over several references. */
export function groupEditorColorPreviewUpdates(updates: readonly PrimitiveColorUpdate[]): readonly { refs: PrimitiveRef[]; color: PrimitiveColorUpdate["color"] }[] {
  const groups = new Map<string, { refs: PrimitiveRef[]; color: PrimitiveColorUpdate["color"] }>();
  for (const update of updates) {
    const id = update.color?.join(",") ?? "restore";
    let group = groups.get(id); if (!group) groups.set(id, group = { refs: [], color: update.color });
    group.refs.push(update.ref);
  }
  return [...groups.values()];
}
