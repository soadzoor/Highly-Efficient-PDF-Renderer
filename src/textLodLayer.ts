import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import { createOrthographicLocalToClip } from "./planarProjection";
import { ThreeMaterialTextLayer } from "./threeMaterialTextLayer";
import {
  createTextLodCombinedPayload,
  getOrBuildTextLod,
  TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
  TextLodRuntime,
  type TextLodMode,
  type TextLodStats
} from "./textLodCore";
import type { ViewState } from "./webGlFloorplanRenderer";

interface ViewportPixels {
  width: number;
  height: number;
}

interface CullingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MAX_EXACT_FLOAT_INSTANCE_IDS = 16_777_216;
const CONSERVATIVE_THREE_TEXTURE_DIMENSION = 4096;
const MAX_COMBINED_TEXT_ARRAY_BYTES = 512 * 1024 * 1024;

/**
 * Three-side adapter for the shared clustered text selector.
 *
 * Exact glyphs and coarse runs live in one immutable text payload. Per frame,
 * the shared runtime emits one source-ordered list of absolute instance IDs;
 * this adapter uploads that list to the existing material layer only when the
 * selection changes. There is deliberately no second material or cross-fade.
 */
export class ThreeTextLodLayer {
  private runtime: TextLodRuntime | null;
  private renderScene: VectorScene | null;
  private combinedPayload: boolean;
  private requiredTextureDimension: number;
  private resourceFallback = false;
  private useLocalToClip = false;
  private readonly localToClip = new THREE.Matrix4();
  private selectionApplied = false;

  private constructor(scene: VectorScene, mode: TextLodMode) {
    this.runtime = null;
    this.renderScene = scene;
    this.combinedPayload = false;
    this.requiredTextureDimension = requiredTextPayloadTextureDimension(scene);
    if (mode === "auto") {
      this.initializeAuto(scene);
    }
  }

  static create(scene: VectorScene, mode: TextLodMode): ThreeTextLodLayer {
    return new ThreeTextLodLayer(scene, mode);
  }

  /** Scene uploaded by the one Three text material. */
  getRenderScene(): VectorScene {
    if (!this.renderScene) {
      throw new Error("Cannot read a disposed Three text LOD payload.");
    }
    return this.renderScene;
  }

  /**
   * The material constructor copies text payload arrays into its textures, so
   * retaining the temporary combined scene here would needlessly double its
   * CPU residency for the object's lifetime.
   */
  releaseRenderSceneReference(): void {
    this.renderScene = null;
  }

  getRequiredTextureDimension(): number {
    return this.requiredTextureDimension;
  }

  hasCombinedPayload(): boolean {
    return this.combinedPayload;
  }

  /**
   * Change mode and lazily materialize the combined payload when an object
   * created exact-only is explicitly switched from Off to Auto. The returned
   * scene must replace the current material payload before the next draw.
   */
  setMode(mode: TextLodMode, scene: VectorScene): VectorScene | null {
    if (mode === "auto" && !this.runtime && !this.resourceFallback) {
      try {
        const combinedScene = this.initializeAuto(scene);
        this.selectionApplied = false;
        return combinedScene;
      } catch (error) {
        // Keep the adapter compatible with the already-installed exact
        // material if a lazy build/materialization fails before its caller can
        // atomically replace that material.
        this.useExactResourceFallback("material-construction", scene);
        throw error;
      }
    }
    this.runtime?.setMode(mode);
    this.selectionApplied = false;
    return null;
  }

  getStats(): TextLodStats | null {
    return this.runtime?.getStats() ?? null;
  }

  setResourceFallback(reason: Parameters<TextLodRuntime["setResourceFallback"]>[0]): void {
    this.runtime?.setResourceFallback(reason);
    this.selectionApplied = false;
  }

  useExactResourceFallback(
    reason: Parameters<TextLodRuntime["setResourceFallback"]>[0],
    exactScene?: VectorScene
  ): void {
    this.setResourceFallback(reason);
    this.resourceFallback = true;
    this.combinedPayload = false;
    this.renderScene = null;
    if (exactScene) {
      this.requiredTextureDimension = requiredTextPayloadTextureDimension(exactScene);
    }
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClip = false;
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4): void {
    this.useLocalToClip = true;
    this.localToClip.copy(localToClip);
  }

  updateFrame(
    materialLayer: ThreeMaterialTextLayer,
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): void {
    const runtime = this.runtime;
    if (!runtime) {
      return;
    }

    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    const localToClip = this.useLocalToClip
      ? this.localToClip.elements
      : createOrthographicLocalToClip(
        viewState.cameraCenterX,
        viewState.cameraCenterY,
        viewState.zoom,
        viewportWidth,
        viewportHeight
      );
    const selection = runtime.update({
      localToClip,
      viewportWidth,
      viewportHeight,
      cullingBounds: cullingBounds ?? undefined
    });
    if (selection.changed || !this.selectionApplied) {
      materialLayer.setSelectedTextInstanceIds(selection.instanceIds);
      this.selectionApplied = true;
    }
  }

  deactivate(): void {
    // Keep per-cluster hysteresis across native/material pipeline switches. The
    // material mesh is hidden by its owner, so no selection reset is required.
  }

  dispose(): void {
    this.runtime?.dispose();
    this.runtime = null;
    this.renderScene = null;
    this.selectionApplied = false;
  }

  private initializeAuto(scene: VectorScene): VectorScene | null {
    const result = getOrBuildTextLod(scene);
    this.runtime?.dispose();
    this.runtime = new TextLodRuntime(result, "auto");

    if (result.data && canMaterializeCombinedPayload(scene, result.data)) {
      try {
        const payload = createTextLodCombinedPayload(scene, result.data);
        this.renderScene = payload.scene;
        this.combinedPayload = true;
        this.requiredTextureDimension = requiredTextPayloadTextureDimension(payload.scene);
        return payload.scene;
      } catch (error) {
        if (!(error instanceof RangeError)) {
          throw error;
        }
        this.runtime.setResourceFallback("resource-capacity");
        this.resourceFallback = true;
      }
    } else if (result.data) {
      this.runtime.setResourceFallback("resource-capacity");
      this.resourceFallback = true;
    }

    this.renderScene = scene;
    this.combinedPayload = false;
    this.requiredTextureDimension = requiredTextPayloadTextureDimension(scene);
    return null;
  }
}

function requiredTextPayloadTextureDimension(scene: VectorScene): number {
  return Math.max(
    squareTextureDimension(scene.textInstanceCount),
    squareTextureDimension(scene.textGlyphCount),
    squareTextureDimension(scene.textGlyphSegmentCount)
  );
}

function squareTextureDimension(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(0, Math.trunc(count)))));
}

function canMaterializeCombinedPayload(
  scene: VectorScene,
  data: {
    combinedInstanceCount: number;
  }
): boolean {
  const combinedInstanceCount = Math.max(0, Math.trunc(data.combinedInstanceCount));
  const combinedGlyphCount = Math.max(0, Math.trunc(scene.textGlyphCount)) + 1;
  const combinedSegmentCount =
    Math.max(0, Math.trunc(scene.textGlyphSegmentCount)) + TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT;
  if (
    combinedInstanceCount > MAX_EXACT_FLOAT_INSTANCE_IDS ||
    squareTextureDimension(combinedInstanceCount) > CONSERVATIVE_THREE_TEXTURE_DIMENSION ||
    squareTextureDimension(combinedGlyphCount) > CONSERVATIVE_THREE_TEXTURE_DIMENSION ||
    squareTextureDimension(combinedSegmentCount) > CONSERVATIVE_THREE_TEXTURE_DIMENSION
  ) {
    return false;
  }

  // The combined payload owns three vec4 instance arrays. Keep optional LOD
  // from attempting an allocation that is unreasonable even when a texture
  // dimension would technically fit; exact text remains available.
  const combinedInstanceBytes = combinedInstanceCount * 3 * 4 * Float32Array.BYTES_PER_ELEMENT;
  const combinedGlyphBytes = combinedGlyphCount * 2 * 4 * Float32Array.BYTES_PER_ELEMENT;
  const combinedSegmentBytes = combinedSegmentCount * 2 * 4 * Float32Array.BYTES_PER_ELEMENT;
  // Material texture construction pads/copies these arrays, so account for the
  // temporary payload and its resident texture backing at peak allocation.
  const peakPayloadBytes = 2 * (combinedInstanceBytes + combinedGlyphBytes + combinedSegmentBytes);
  return Number.isSafeInteger(peakPayloadBytes) && peakPayloadBytes <= MAX_COMBINED_TEXT_ARRAY_BYTES;
}
