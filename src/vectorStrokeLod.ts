import type { ThreeWebGpuBackend } from "./threeMaterialBackend";
import type { ThreePageTransforms } from "./threePageTransforms";
import type { OptionalContentSnapshot } from "./optionalContent";
import { getThreeVectorDrawPlan, type ThreeVectorDrawPlan } from "./threeVectorDrawPlan";
import { getThreeRenderPerformance } from "./threeRenderPerformance";
import {
  getSplitVectorStrokeLodStorage, vectorStrokeLodLevelUploadScene, vectorStrokeLodStorageOrigins,
  type VectorStrokeLodStorageLayout
} from "./vectorStrokeLodStorage";
import type { PrimitiveColorUpdate } from "./primitiveAppearance";
import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import {
  formatToleranceName,
  consumeVectorStrokeLodBuildTiming,
  prebuildVectorStrokeLodRuntime,
  shouldUseVectorStrokeLod,
  resetVectorStrokeLodBuildTiming,
  storePrebuiltVectorStrokeLodRuntime,
  takePrebuiltVectorStrokeLodRuntime,
  VectorStrokeLodRuntime,
  VECTOR_STROKE_LOD_MIN_SEGMENTS,
  VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS,
  VECTOR_STROKE_LOD_TOLERANCES,
  type CullingBounds,
  type VectorLodMode,
  type VectorStrokeLodAsyncBuildOptions,
  type VectorStrokeLodRuntimeReservation,
  type VectorStrokeLodBuildTiming,
  type VectorStrokeLodBuildProgress,
  type VectorStrokeLodStats,
  type ViewportPixels
} from "./vectorStrokeLodCore";
import type { ViewState } from "./webGlPdfRenderer";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";

interface VectorStrokeLodLayerOptions {
  pageTransforms?: ThreePageTransforms;
  drawPlan?: ThreeVectorDrawPlan;
  materialBackend?: "webgl" | "webgpu";
  webGpu?: ThreeWebGpuBackend;
  colorCompositing?: ThreeColorCompositing;
  strokeCurveEnabled: boolean;
  vectorOverride: [number, number, number, number];
}

export class ThreeVectorLodStrokeLayer {
  readonly group = new THREE.Group();

  private readonly scene: VectorScene;
  private readonly pageTransforms: ThreePageTransforms | undefined;
  private readonly runtime: VectorStrokeLodRuntime;
  private readonly layers: ThreeMaterialStrokeLayer[];
  private requestedVisible = false;
  private selectionInitialized = false;
  private disposed = false;
  /** One ordered layer selects stored records from every level directly. */
  private storedSelection: boolean;
  private layout: VectorStrokeLodStorageLayout | null = null;

  constructor(
    scene: VectorScene,
    options: VectorStrokeLodLayerOptions,
    preparedRuntime?: VectorStrokeLodRuntimeReservation | null
  ) {
    this.scene = scene;
    this.pageTransforms = options.pageTransforms;
    this.group.name = "hepr-vector-lod-strokes";
    this.group.visible = false;
    this.layers = [];
    this.storedSelection = false;
    this.runtime = preparedRuntime?.take(scene) ?? takePrebuiltVectorStrokeLodRuntime(scene) ?? new VectorStrokeLodRuntime(scene);
    try {
      if (scene.drawRuns) {
        const { layout, records, textures } = getSplitVectorStrokeLodStorage(scene, this.runtime.levels);
        const origins = vectorStrokeLodStorageOrigins(layout)!;
        this.layout = layout;
        const drawPlan = options.drawPlan ?? getThreeVectorDrawPlan(scene);
        drawPlan.setStrokeSource(records, origins);
        const layer = new ThreeMaterialStrokeLayer(scene, { ...options, drawPlan, canonicalScene: scene,
          strokeOrigins: origins, strokeRecords: records, strokeTextures: textures });
        this.layers.push(layer);
        this.storedSelection = true;
        layer.setVisible(false); layer.setDrawEnabled(false);
        this.group.add(layer.mesh);
      } else {
        this.storedSelection = false;
        for (const level of this.runtime.levels) {
          const layer = new ThreeMaterialStrokeLayer(vectorStrokeLodLevelUploadScene(level), options);
          this.layers.push(layer);
          layer.mesh.name = `hepr-vector-lod-strokes-${formatToleranceName(level.tolerance)}`;
          layer.setVisible(false);
          layer.setDrawEnabled(false);
          this.group.add(layer.mesh);
        }
      }
    } catch (error) {
      try { this.dispose(); } catch { /* Preserve the original initialization error. */ }
      throw error;
    }
  }

  setOptionalContentVisibility(snapshot: OptionalContentSnapshot): void {
    for (const layer of this.layers) layer.setOptionalContentVisibility(snapshot);
  }

  /** Ordered LOD already uses one shared store with stable primitive IDs. */
  getMixedVectorStrokeLayer(): ThreeMaterialStrokeLayer | null {
    return this.scene.drawRuns && this.layers.length === 1 ? this.layers[0] : null;
  }

  setVisible(visible: boolean): void {
    this.requestedVisible = visible;
    this.updateGroupVisibility();
  }

  setMinimumStrokeWidth(width: number | boolean): void {
    this.runtime.setMinimumStrokeWidth(width);
    for (const layer of this.layers) layer.setMinimumStrokeWidth(width);
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    for (const layer of this.layers) {
      layer.setStrokeCurveEnabled(enabled);
    }
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    for (const layer of this.layers) {
      layer.setVectorOverride(red, green, blue, opacity);
    }
  }

  setPrimitiveColorUpdates(updates: readonly PrimitiveColorUpdate[]): void {
    this.layers[0]?.setPrimitiveColorUpdates(updates, this.scene);
  }

  setForceExact(enabled: boolean): void {
    this.runtime.setForceExact(enabled);
  }

  setScreenSpaceTransform(): void {
    this.runtime.setScreenSpaceTransform();
    for (const layer of this.layers) {
      layer.setScreenSpaceTransform();
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4, localUnitsPerPixel: number): void {
    // One conservative global stroke tolerance is bounded by the most magnified
    // visible page. The renderer still projects each primitive with its own matrix.
    if (this.pageTransforms) this.runtime.setScreenSpaceTransform();
    else this.runtime.setLocalToClipTransform(localToClip.elements, localUnitsPerPixel);
    for (const layer of this.layers) {
      layer.setLocalToClipTransform(localToClip, localUnitsPerPixel);
    }
  }

  updateForLocalUnitsPerPixel(localUnitsPerPixel: number): boolean {
    const usingLod = this.runtime.updateForLocalUnitsPerPixel(localUnitsPerPixel);
    this.updateGroupVisibility();
    return usingLod;
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): void {
    if (!this.group.visible || this.layers.length <= 0) {
      return;
    }
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.strokeLodSelection");
    let selectionChanged: boolean;
    try { selectionChanged = this.runtime.update(viewState, viewport, cullingBounds); }
    finally { profile?.endSection("three.strokeLodSelection"); }
    profile?.add(selectionChanged ? "three.strokeLodSelections" : "three.strokeLodReuses");
    profile?.beginSection("three.strokeLodInstances");
    try {
      if (selectionChanged || !this.selectionInitialized) {
        profile?.add("three.strokeLodInstanceUpdates");
        this.updateLevelDraws(viewState, viewport);
        this.selectionInitialized = true;
      } else {
        // Runtime reuse keeps every selected ID valid. Refresh camera uniforms
        // and any changed paint schedule without repacking/scanning those IDs.
        for (const layer of this.layers) layer.updateFrameWithUnchangedSelection(viewState, viewport);
      }
    } finally { profile?.endSection("three.strokeLodInstances"); }
  }

  estimateVisibleSegmentCount(): number {
    return this.runtime.estimateVisibleSegmentCount();
  }

  getRenderedSegmentCount(): number {
    if (!this.group.visible) {
      return 0;
    }
    return this.storedSelection ? this.layers[0].getRenderedSegmentCount() : this.runtime.getRenderedSegmentCount();
  }

  getStats(): VectorStrokeLodStats {
    return this.runtime.getStats();
  }

  deactivate(): void {
    this.requestedVisible = false;
    this.selectionInitialized = false;
    this.runtime.resetVisible();
    for (const layer of this.layers) {
      layer.setDrawEnabled(false);
      layer.setVisible(false);
    }
    this.group.visible = false;
  }

  dispose(): void {
    // A second dispose must not return a runtime that a new layer now owns.
    if (this.disposed) return;
    this.disposed = true;
    for (const layer of this.layers) {
      layer.dispose();
    }
    this.group.clear();
    storePrebuiltVectorStrokeLodRuntime(this.scene, this.runtime);
  }

  private updateLevelDraws(viewState: ViewState, viewport: ViewportPixels): void {
    const visible = this.requestedVisible && this.group.visible;
    if (this.storedSelection) {
      // Ranks deduplicate records that several levels share.
      const layout = this.layout!, layer = this.layers[0];
      const count = layer.updateFrameWithStoredSelection(viewState, viewport,
        { levels: visible ? this.runtime.levels : [], records: layout.records, bases: layout.bases }) ?? 0;
      layer.setVisible(visible); layer.setDrawEnabled(count > 0);
      return;
    }
    for (let i = 0; i < this.layers.length; i += 1) {
      const layer = this.layers[i];
      const level = this.runtime.levels[i];
      const drawCount = visible ? level.visibleSegmentCount : 0;
      layer.updateFrameWithVisibleSegmentIds(viewState, viewport, level.visibleSegmentIds, drawCount);
      layer.setVisible(visible);
      layer.setDrawEnabled(drawCount > 0);
    }
  }

  private updateGroupVisibility(): void {
    const visible = this.requestedVisible && this.layers.length > 0;
    this.group.visible = visible;
    for (let i = 0; i < this.layers.length; i += 1) {
      const layer = this.layers[i];
      const level = this.runtime.levels[i];
      layer.setVisible(visible);
      layer.setDrawEnabled(visible && (this.storedSelection ? this.runtime.getRenderedSegmentCount() > 0 : level.visibleSegmentCount > 0));
    }
  }
}

export {
  consumeVectorStrokeLodBuildTiming,
  prebuildVectorStrokeLodRuntime,
  shouldUseVectorStrokeLod,
  resetVectorStrokeLodBuildTiming,
  storePrebuiltVectorStrokeLodRuntime,
  takePrebuiltVectorStrokeLodRuntime,
  VECTOR_STROKE_LOD_MIN_SEGMENTS,
  VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS,
  VECTOR_STROKE_LOD_TOLERANCES
};

export type {
  VectorLodMode,
  VectorStrokeLodAsyncBuildOptions,
  VectorStrokeLodBuildTiming,
  VectorStrokeLodBuildProgress,
  VectorStrokeLodStats
};
