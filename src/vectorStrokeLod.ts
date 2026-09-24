import type { OptionalContentSnapshot } from "./optionalContent";
import { getThreeVectorDrawPlan, type ThreeVectorDrawPlan } from "./threeVectorDrawPlan";
import { strokePaintOrigins } from "./vectorStrokePaintOrder";
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
  type VectorStrokeLodBuildTiming,
  type VectorStrokeLodBuildProgress,
  type VectorStrokeLodStats,
  type ViewportPixels
} from "./vectorStrokeLodCore";
import type { ViewState } from "./webGlFloorplanRenderer";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";

interface VectorStrokeLodLayerOptions {
  drawPlan?: ThreeVectorDrawPlan;
  materialBackend?: "webgl" | "webgpu";
  colorCompositing?: ThreeColorCompositing;
  strokeCurveEnabled: boolean;
  vectorOverride: [number, number, number, number];
}

export class ThreeVectorLodStrokeLayer {
  readonly group = new THREE.Group();

  private readonly scene: VectorScene;
  private readonly runtime: VectorStrokeLodRuntime;
  private readonly layers: ThreeMaterialStrokeLayer[];
  private requestedVisible = false;
  private selectionInitialized = false;
  private readonly combinedIds: Uint32Array | null;
  private readonly levelOffsets: number[] = [];

  constructor(scene: VectorScene, options: VectorStrokeLodLayerOptions) {
    this.scene = scene;
    this.group.name = "hepr-vector-lod-strokes";
    this.group.visible = false;
    this.runtime = takePrebuiltVectorStrokeLodRuntime(scene) ?? new VectorStrokeLodRuntime(scene);
    if (scene.drawRuns) {
      let count = 0;
      for (const level of this.runtime.levels) { this.levelOffsets.push(count); count += level.segmentCount; }
      const combined = { ...scene, segmentCount: count };
      const origins = new Uint32Array(count);
      for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"] as const) {
        combined[key] = new Float32Array(count * 4);
        this.runtime.levels.forEach((level, index) => combined[key].set(level.scene[key], this.levelOffsets[index] * 4));
      }
      this.runtime.levels.forEach((level, index) => origins.set(strokePaintOrigins(level.scene)!, this.levelOffsets[index]));
      const drawPlan = options.drawPlan ?? getThreeVectorDrawPlan(scene);
      drawPlan.setStrokeSource(combined, origins);
      const layer = new ThreeMaterialStrokeLayer(combined, { ...options, drawPlan, canonicalScene: scene, strokeOrigins: origins });
      this.layers = [layer];
      this.combinedIds = new Uint32Array(count);
      layer.setVisible(false); layer.setDrawEnabled(false);
      this.group.add(layer.mesh);
    } else {
      this.combinedIds = null;
      this.layers = this.runtime.levels.map((level) => {
        const layer = new ThreeMaterialStrokeLayer(level.scene, options);
        layer.mesh.name = `hepr-vector-lod-strokes-${formatToleranceName(level.tolerance)}`;
        layer.setVisible(false);
        layer.setDrawEnabled(false);
        this.group.add(layer.mesh);
        return layer;
      });
    }
  }

  setOptionalContentVisibility(snapshot: OptionalContentSnapshot): void {
    for (const layer of this.layers) layer.setOptionalContentVisibility(snapshot);
  }

  setVisible(visible: boolean): void {
    this.requestedVisible = visible;
    this.updateGroupVisibility();
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
    this.runtime.setLocalToClipTransform(localToClip.elements, localUnitsPerPixel);
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
    const selectionChanged = this.runtime.update(viewState, viewport, cullingBounds);
    if (selectionChanged || !this.selectionInitialized) {
      this.updateLevelDraws(viewState, viewport);
      this.selectionInitialized = true;
    } else {
      // Runtime reuse keeps every selected ID valid. Refresh camera uniforms
      // and any changed paint schedule without repacking/scanning those IDs.
      for (const layer of this.layers) layer.updateFrameWithUnchangedSelection(viewState, viewport);
    }
  }

  estimateVisibleSegmentCount(): number {
    return this.runtime.estimateVisibleSegmentCount();
  }

  getRenderedSegmentCount(): number {
    if (!this.group.visible) {
      return 0;
    }
    return this.combinedIds ? this.layers[0].getRenderedSegmentCount() : this.runtime.getRenderedSegmentCount();
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
    for (const layer of this.layers) {
      layer.dispose();
    }
    this.group.clear();
    storePrebuiltVectorStrokeLodRuntime(this.scene, this.runtime);
  }

  private updateLevelDraws(viewState: ViewState, viewport: ViewportPixels): void {
    const visible = this.requestedVisible && this.group.visible;
    if (this.combinedIds) {
      let count = 0;
      this.runtime.levels.forEach((level, index) => {
        if (!visible) return;
        for (let item = 0; item < level.visibleSegmentCount; item++) {
          this.combinedIds![count++] = this.levelOffsets[index] + level.visibleSegmentIds[item];
        }
      });
      this.layers[0].updateFrameWithVisibleSegmentIds(viewState, viewport, this.combinedIds, count);
      this.layers[0].setVisible(visible); this.layers[0].setDrawEnabled(count > 0);
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
      layer.setDrawEnabled(visible && (this.combinedIds ? this.runtime.getRenderedSegmentCount() > 0 : level.visibleSegmentCount > 0));
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
