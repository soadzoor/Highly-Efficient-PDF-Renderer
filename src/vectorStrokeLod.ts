import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import {
  formatToleranceName,
  consumeVectorStrokeLodBuildTiming,
  prebuildVectorStrokeLodRuntime,
  shouldUseVectorStrokeLod,
  resetVectorStrokeLodBuildTiming,
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

interface VectorStrokeLodLayerOptions {
  strokeCurveEnabled: boolean;
  vectorOverride: [number, number, number, number];
}

export class ThreeVectorLodStrokeLayer {
  readonly group = new THREE.Group();

  private readonly runtime: VectorStrokeLodRuntime;
  private readonly layers: ThreeMaterialStrokeLayer[];
  private requestedVisible = false;

  constructor(scene: VectorScene, options: VectorStrokeLodLayerOptions) {
    this.group.name = "hepr-vector-lod-strokes";
    this.group.visible = false;
    this.runtime = takePrebuiltVectorStrokeLodRuntime(scene) ?? new VectorStrokeLodRuntime(scene);
    this.layers = this.runtime.levels.map((level) => {
      const layer = new ThreeMaterialStrokeLayer(level.scene, options);
      layer.mesh.name = `hepr-vector-lod-strokes-${formatToleranceName(level.tolerance)}`;
      layer.setVisible(false);
      layer.setDrawEnabled(false);
      this.group.add(layer.mesh);
      return layer;
    });
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
    this.runtime.update(viewState, viewport, cullingBounds);
    this.updateLevelDraws(viewState, viewport);
  }

  estimateVisibleSegmentCount(): number {
    return this.runtime.estimateVisibleSegmentCount();
  }

  getRenderedSegmentCount(): number {
    if (!this.group.visible) {
      return 0;
    }
    return this.runtime.estimateVisibleSegmentCount();
  }

  getStats(): VectorStrokeLodStats {
    return this.runtime.getStats();
  }

  deactivate(): void {
    this.requestedVisible = false;
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
  }

  private updateLevelDraws(viewState: ViewState, viewport: ViewportPixels): void {
    const visible = this.requestedVisible && this.group.visible;
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
      layer.setDrawEnabled(visible && level.visibleSegmentCount > 0);
    }
  }
}

export {
  consumeVectorStrokeLodBuildTiming,
  prebuildVectorStrokeLodRuntime,
  shouldUseVectorStrokeLod,
  resetVectorStrokeLodBuildTiming,
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
