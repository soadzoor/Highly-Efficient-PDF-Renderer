import type { AnnotationInteractionAdapter } from "./annotationInteraction";
import type { VectorScene } from "./pdfVectorExtractor";
import type { RendererApi } from "./rendererTypes";
import { PrimitiveAppearanceState } from "./primitiveAppearance";
import { ScenePrimitivePicker, type PrimitivePoint } from "./scenePrimitives";
import { createDefaultOptionalContentSnapshot, createAnnotationInteractionSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import { SceneAnnotationIndex, applySceneAnnotationHighlights, pickSceneAnnotationInteraction } from "./sceneAnnotationInteraction";

interface NativeAnnotationInteractionOptions {
  getCanvas(): HTMLCanvasElement;
  getScene(): VectorScene | null;
  getRenderer(): RendererApi;
}

/** Native demos share annotation geometry, fallback and ordering with HeprThreePdfObject. */
export function createNativeAnnotationInteractionAdapter(options: NativeAnnotationInteractionOptions): AnnotationInteractionAdapter {
  let scene: VectorScene | null = null, index: SceneAnnotationIndex | null = null, picker: ScenePrimitivePicker | null = null;
  let appearance: PrimitiveAppearanceState | null = null, active = true;
  let selected: string[] = [], hovered: string | null = null;
  let applied: OptionalContentSnapshot | null = null, interaction: OptionalContentSnapshot | null = null;
  let defaults: OptionalContentSnapshot | null = null;
  let dirty = true, lastSnapshot: OptionalContentSnapshot | null = null, lastRenderer: RendererApi | null = null;
  function ensure(): void {
    const next = options.getScene();
    if (scene === next) return;
    index?.dispose(); picker?.dispose();
    // Disposal of old state must not upload an old document's overlay into the new renderer.
    scene = null; appearance?.dispose(); scene = next;
    index = null; picker = null; appearance = null;
    selected = []; hovered = null; applied = interaction = defaults = null;
    dirty = true; lastSnapshot = null; lastRenderer = null;
    if (next) appearance = new PrimitiveAppearanceState(next, {
      onHighlights: highlights => { if (active && scene === options.getScene()) options.getRenderer().setPrimitiveHighlights?.(highlights); }
    });
    if (!next && active) options.getRenderer().setPrimitiveHighlights?.(null);
  }
  function visibility(): OptionalContentSnapshot {
    const snapshot = options.getRenderer().getOptionalContentVisibility?.() ??
      (defaults ??= createDefaultOptionalContentSnapshot(scene!));
    if (snapshot !== applied) { applied = snapshot; interaction = createAnnotationInteractionSnapshot(scene!, snapshot); }
    return interaction!;
  }
  function refresh(forceReplay = false): void {
    ensure();
    if (!scene || !appearance || !active) return;
    const snapshot = visibility();
    const renderer = options.getRenderer();
    if (!dirty && snapshot === lastSnapshot) {
      if (forceReplay || renderer !== lastRenderer) renderer.setPrimitiveHighlights?.(appearance.getHighlights());
      lastRenderer = renderer; return;
    }
    // Clear the stored packet too, so resuming after drawing selection cannot replay an old trace.
    if (!selected.length && hovered === null) appearance.setAnnotationHighlights([], [], null);
    else {
      index ??= new SceneAnnotationIndex(scene);
      applySceneAnnotationHighlights(scene, index, appearance, snapshot, selected, hovered);
    }
    dirty = false; lastSnapshot = snapshot; lastRenderer = renderer;
  }
  return {
    getCanvas: options.getCanvas, getScene: options.getScene, getTarget: options.getRenderer,
    getViewKey() {
      const target = options.getRenderer();
      // The native demo creates its controls before initializing the renderer.
      if (!target) return "";
      const view = target.getViewState();
      return `${view.cameraCenterX}:${view.cameraCenterY}:${view.zoom}:${target.getOptionalContentVisibility?.()?.revision ?? 0}`;
    },
    setSelection(ids) {
      ensure();
      const next = [...new Set(ids ?? [])];
      if (next.length) { index ??= new SceneAnnotationIndex(scene!); for (const id of next) index.get(id); }
      if (next.length === selected.length && next.every((id, i) => id === selected[i])) return;
      selected = next; dirty = true; refresh();
    },
    setHover(id) {
      ensure();
      if (id !== null) { index ??= new SceneAnnotationIndex(scene!); index.get(id); }
      if (hovered === id) return;
      hovered = id; dirty = true; refresh();
    },
    refresh,
    setActive(value) {
      if (active === value) return;
      active = value;
      if (value) refresh(); else { lastRenderer = null; options.getRenderer().setPrimitiveHighlights?.(null); }
    },
    async pick(client, signal) {
      ensure(); signal.throwIfAborted();
      if (!scene || !active) return null;
      const source = scene, target = options.getRenderer(), rect = options.getCanvas().getBoundingClientRect();
      if (client.x < rect.left || client.x >= rect.left + rect.width || client.y < rect.top || client.y >= rect.top + rect.height) return null;
      const point = target.clientToScenePoint?.(client.x, client.y);
      if (!point) return null;
      // Native projection is affine. Capture its basis so cooperative queries cannot mix camera frames.
      const origin = target.sceneToClientPoint?.(point.x, point.y);
      const x = target.sceneToClientPoint?.(point.x + 1, point.y), y = target.sceneToClientPoint?.(point.x, point.y + 1);
      if (!origin || !x || !y) return null;
      const ax = x.x - origin.x, ay = x.y - origin.y, bx = y.x - origin.x, by = y.y - origin.y;
      const determinant = ax * by - ay * bx;
      if (!Number.isFinite(determinant) || determinant === 0) return null;
      const project = (p: PrimitivePoint): PrimitivePoint => ({ x: origin.x + (p.x - point.x) * ax + (p.y - point.y) * bx,
        y: origin.y + (p.x - point.x) * ay + (p.y - point.y) * by });
      const unproject = (p: PrimitivePoint): PrimitivePoint => ({ x: point.x + ((p.x - origin.x) * by - (p.y - origin.y) * bx) / determinant,
        y: point.y + ((p.y - origin.y) * ax - (p.x - origin.x) * ay) / determinant });
      const snapshot = visibility(), appliedSnapshot = applied;
      index ??= new SceneAnnotationIndex(source); picker ??= new ScenePrimitivePicker(source);
      return pickSceneAnnotationInteraction(source, index, picker, { point, clientPoint: client, project, unproject,
        tolerancePx: 4, signal, rasterLayers: target.getRasterLayerUpdates?.() }, snapshot, true, new Set(), () => {
        signal.throwIfAborted();
        if (source !== options.getScene() || source !== scene || target !== options.getRenderer() ||
            appliedSnapshot !== (target.getOptionalContentVisibility?.() ?? defaults)) throw new DOMException("Annotation view changed during picking.", "AbortError");
      });
    },
    dispose() {
      active = false; scene = null; index?.dispose(); picker?.dispose(); appearance?.dispose();
      index = null; picker = null; appearance = null;
    }
  };
}
