import { requireThreeWebGpuBackend, type ThreeWebGpuBackend } from "./threeMaterialBackend";
import { bindRawPageTransform, type ThreePageTransforms } from "./threePageTransforms";
import type { OptionalContentSnapshot } from "./optionalContent";
import type { PrimitiveColorUpdate } from "./primitiveAppearance";
import { patchPrimitiveColorTexture } from "./threePrimitiveColors";
import {
  sceneStrokeRecords, splitStrokeTextures, type SplitStrokeTextures, type StrokeRecords, type StrokeTextureData
} from "./strokeRecords";
import { createThreeVectorClipTexture, initializeThreeVectorClip } from "./threeVectorClips";
import { ThreeVectorDrawRuns } from "./threeVectorDrawRuns";
import type { ThreeVectorDrawPlan } from "./threeVectorDrawPlan";
import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import {
  CORE_STROKE_FRAGMENT_SHADER_SOURCE,
  CORE_STROKE_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import { buildSpatialGrid, writeStrokeCullingBounds, type SpatialGrid } from "./spatialGrid";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { HEPR_THREE_LAYER_ORDER_STROKE } from "./threeLayerOrder";
import {
  normalizeThreeRawShaderSource,
  normalizeThreeStrokeRawFragmentShaderSource
} from "./threeRawShaderColorSpace";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";

interface StrokeLayerOptions {
  pageTransforms?: ThreePageTransforms;
  drawPlan?: ThreeVectorDrawPlan;
  canonicalScene?: VectorScene;
  strokeOrigins?: Uint32Array;
  /** Stroke records to draw instead of the scene's own; see vectorStrokeLodStorage. */
  strokeRecords?: StrokeRecords;
  /** Prepared texture data of `strokeRecords`, shared by every layer of one hierarchy. */
  strokeTextures?: SplitStrokeTextures;
  materialBackend?: "webgl" | "webgpu";
  webGpu?: ThreeWebGpuBackend;
  colorCompositing?: ThreeColorCompositing;
  strokeCurveEnabled: boolean;
  vectorOverride: [number, number, number, number];
}

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

export class ThreeMaterialStrokeLayer {
  private readonly vectorClipTexture: THREE.DataTexture;
  private readonly orderedRuns: ThreeVectorDrawRuns | null;
  private readonly pageTransforms: ThreePageTransforms | undefined;
  private readonly solidColorOverrides = new Set<string>();
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

  private readonly segmentTextureA: THREE.DataTexture;
  private readonly segmentTextureB: THREE.DataTexture;
  private readonly segmentStyleTexture: THREE.DataTexture;
  private readonly segmentBoundsTexture: THREE.DataTexture;
  // IDs from segmentSplit, after the scene's complete texture rows.
  private readonly segmentTailTextureA: THREE.DataTexture;
  private readonly segmentTailTextureB: THREE.DataTexture;
  private readonly segmentTailStyleTexture: THREE.DataTexture;
  private readonly segmentTailBoundsTexture: THREE.DataTexture;
  private readonly segmentSplit: number;
  /** Style data still belongs to the scene or LOD store; recoloring copies it first. */
  private styleDataShared = true;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private zoomUniform: { value: number };
  private useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;
  private localUnitsPerPixelUniform: { value: number };
  private curveUniform: { value: number };
  private readonly vectorOverrideUniform: THREE.Vector4;
  private readonly segmentCount: number;
  private readonly segmentIndexAttribute: THREE.InstancedBufferAttribute;
  private readonly visibleSegmentIds: Float32Array;
  /** Entries past this prefix still hold their own index, here and on the GPU. */
  private overwrittenSegmentIds = 0;
  private readonly grid: SpatialGrid | null;
  /** Grid culling computes stroke bounds from this scene instead of storing them. */
  private readonly cullingScene: VectorScene;
  private readonly strokeBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly segmentMarks: Uint8Array;
  private readonly maxHalfWidth: number;
  private drawInstanceCount: number;
  private markToken = 1;
  private usingAllSegments = true;
  private useLocalToClip = false;

  constructor(scene: VectorScene, options: StrokeLayerOptions) {
    this.vectorClipTexture = createThreeVectorClipTexture(scene);
    const records = options.strokeRecords ?? sceneStrokeRecords(scene);
    const segmentCount = Math.max(0, records.count | 0);
    this.segmentCount = segmentCount;
    // Data textures upload one array each. The scene's complete texture rows
    // are views of its own arrays; only the remainder has a texture of its own.
    const textures = options.strokeTextures ?? splitStrokeTextures(records);
    const head = textures.head.endpoints, tail = textures.tail.endpoints;
    this.segmentSplit = textures.split;
    this.segmentTextureA = createSegmentDataTexture(textures.head.endpoints);
    this.segmentTextureB = createSegmentDataTexture(textures.head.primitiveMeta);
    this.segmentStyleTexture = createSegmentDataTexture(textures.head.styles);
    this.segmentBoundsTexture = createSegmentDataTexture(textures.head.primitiveBounds);
    this.segmentTailTextureA = createSegmentDataTexture(textures.tail.endpoints);
    this.segmentTailTextureB = createSegmentDataTexture(textures.tail.primitiveMeta);
    this.segmentTailStyleTexture = createSegmentDataTexture(textures.tail.styles);
    this.segmentTailBoundsTexture = createSegmentDataTexture(textures.tail.primitiveBounds);

    this.grid = segmentCount > 0 && !options.strokeOrigins ? buildSpatialGrid(scene) : null;
    // Ordered LOD supplies an already culled selection. Its runtime owns the
    // spatial bounds and marks; this layer never visits them without a grid.
    this.cullingScene = scene;
    this.segmentMarks = new Uint8Array(this.grid ? segmentCount : 0);
    this.visibleSegmentIds = new Float32Array(Math.max(1, segmentCount));
    for (let i = 0; i < segmentCount; i += 1) this.visibleSegmentIds[i] = i;
    this.maxHalfWidth = Math.max(0, scene.maxHalfWidth);
    this.drawInstanceCount = segmentCount;

    const geometry = createStrokeGeometry(this.visibleSegmentIds, segmentCount);
    this.segmentIndexAttribute = geometry.getAttribute("aSegmentIndex") as THREE.InstancedBufferAttribute;
    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();
    this.localUnitsPerPixelUniform = { value: 1 };
    this.curveUniform = { value: options.strokeCurveEnabled ? 1 : 0 };
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );

    this.pageTransforms = options.pageTransforms;
    const pageBinding = options.pageTransforms?.instances("stroke", scene, options.strokeOrigins);
    const materialBackend = options.materialBackend ?? "webgl";
    let material: THREE.Material;
    if (materialBackend === "webgpu") {
      const webGpuMaterial = requireThreeWebGpuBackend(options.webGpu).createThreeWebGpuStrokeMaterial({
        colorCompositing: options.colorCompositing ?? "linear",
        segmentTextureA: this.segmentTextureA,
        segmentTextureB: this.segmentTextureB,
        segmentStyleTexture: this.segmentStyleTexture,
        segmentBoundsTexture: this.segmentBoundsTexture,
        segmentTextureWidth: head.width,
        segmentTail: {
          textureA: this.segmentTailTextureA,
          textureB: this.segmentTailTextureB,
          styleTexture: this.segmentTailStyleTexture,
          boundsTexture: this.segmentTailBoundsTexture,
          width: tail.width,
          split: textures.split
        },
        viewport: this.viewportUniform,
        cameraCenter: this.cameraCenterUniform,
        localToClip: this.localToClipUniform,
        pageBinding,
        vectorOverride: this.vectorOverrideUniform,
        strokeCurveEnabled: options.strokeCurveEnabled
      });
      this.zoomUniform = webGpuMaterial.zoomUniform;
      this.useLocalToClipUniform = webGpuMaterial.useLocalToClipUniform;
      this.localUnitsPerPixelUniform = webGpuMaterial.localUnitsPerPixelUniform;
      this.curveUniform = webGpuMaterial.curveUniform;
      material = webGpuMaterial.material;
    } else {
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: normalizeThreeRawShaderSource(CORE_STROKE_VERTEX_SHADER_SOURCE),
        fragmentShader: normalizeThreeStrokeRawFragmentShaderSource(CORE_STROKE_FRAGMENT_SHADER_SOURCE),
        transparent: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        defines: { HEPR_SPLIT_STROKE_STORE: "" },
        uniforms: {
          uSegmentTexA: { value: this.segmentTextureA },
          uSegmentTexB: { value: this.segmentTextureB },
          uSegmentStyleTex: { value: this.segmentStyleTexture },
          uSegmentBoundsTex: { value: this.segmentBoundsTexture },
          uSegmentTexSize: {
            value: new Int32Array([head.width, head.height])
          },
          uSegmentTailTexA: { value: this.segmentTailTextureA },
          uSegmentTailTexB: { value: this.segmentTailTextureB },
          uSegmentTailStyleTex: { value: this.segmentTailStyleTexture },
          uSegmentTailBoundsTex: { value: this.segmentTailBoundsTexture },
          uSegmentTailTexSize: {
            value: new Int32Array([tail.width, tail.height])
          },
          uSegmentSplit: { value: textures.split },
          uViewport: { value: this.viewportUniform },
          uCameraCenter: { value: this.cameraCenterUniform },
          uZoom: this.zoomUniform,
          uUseLocalToClip: this.useLocalToClipUniform,
          uLocalToClip: { value: this.localToClipUniform },
          uLocalUnitsPerPixel: this.localUnitsPerPixelUniform,
          uAAScreenPx: { value: 1.0 },
          uStrokeCurveEnabled: this.curveUniform,
          uVectorOverride: { value: this.vectorOverrideUniform }
        }
      });
    }
    configureStraightAlphaBlending(material);

    bindRawPageTransform(material, pageBinding);
    initializeThreeVectorClip(material, this.vectorClipTexture);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_STROKE;
    this.orderedRuns = ThreeVectorDrawRuns.create(options.canonicalScene ?? scene, "stroke", this.mesh, "aSegmentIndex", options.drawPlan, options.strokeOrigins);
    // Coverage in the original layout cannot prove redundancy after pages move.
    if (this.pageTransforms) this.orderedRuns?.setStrokeRedundancyEnabled(false);
  }

  setOptionalContentVisibility(snapshot: OptionalContentSnapshot): void {
    this.orderedRuns?.setOptionalContentVisibility(snapshot);
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  setDrawEnabled(enabled: boolean): void {
    if (this.orderedRuns) { this.orderedRuns.setEnabled(enabled); return; }
    this.mesh.geometry.instanceCount = enabled ? this.drawInstanceCount : 0;
  }

  getRenderedSegmentCount(): number {
    if (!this.mesh.visible) {
      return 0;
    }
    return this.orderedRuns?.getRenderedCount() ?? Math.max(0, this.mesh.geometry.instanceCount ?? 0);
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    this.curveUniform.value = enabled ? 1 : 0;
  }

  setPrimitiveColorUpdates(updates: readonly PrimitiveColorUpdate[], scene: VectorScene): void {
    if (this.styleDataShared && updates.some(update => update.ref.kind === "stroke")) {
      // Keep canonical and simplified geometry immutable across renderers.
      // Recoloring forces exact LOD, but edits still belong to these textures only.
      for (const texture of [this.segmentStyleTexture, this.segmentTailStyleTexture]) {
        texture.image.data = (texture.image.data as Float32Array).slice();
      }
      this.styleDataShared = false;
    }
    const colorChannels = [{ source: 1, target: 1 }, { source: 2, target: 2 }, { source: 3, target: 3 }];
    patchPrimitiveColorTexture(this.segmentStyleTexture, scene.styles, updates, "stroke", colorChannels, 0, this.segmentSplit);
    patchPrimitiveColorTexture(this.segmentTailStyleTexture, scene.styles, updates, "stroke", colorChannels, this.segmentSplit);
    // The shared redundancy planner may cross same-color fill/text paints.
    // Recoloring any solid primitive therefore restores all stroke candidates,
    // until clearing the last override makes the original proof valid again.
    for (const update of updates) {
      if (update.ref.kind !== "stroke" && update.ref.kind !== "fill" && update.ref.kind !== "text") continue;
      const key = `${update.ref.kind}:${update.ref.index}`;
      if (update.color) this.solidColorOverrides.add(key);
      else this.solidColorOverrides.delete(key);
    }
    this.orderedRuns?.setStrokeRedundancyEnabled(!this.pageTransforms && this.solidColorOverrides.size === 0);
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClip = false;
    this.useLocalToClipUniform.value = 0;
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4, localUnitsPerPixel: number): void {
    this.useLocalToClip = true;
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    this.localUnitsPerPixelUniform.value =
      Number.isFinite(localUnitsPerPixel) && localUnitsPerPixel > 1e-8
        ? localUnitsPerPixel
        : 1;
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): void {
    this.updateFrameUniforms(viewState, viewport);
    this.orderedRuns?.beginUpdate();
    this.updateVisibleSegments(viewState, viewport, cullingBounds);
    this.orderedRuns?.finishUpdate();
  }

  updateFrameWithVisibleSegmentIds(
    viewState: ViewState,
    viewport: ViewportPixels,
    segmentIds: Uint32Array,
    segmentIdCount: number
  ): void {
    this.updateFrameUniforms(viewState, viewport);
    this.orderedRuns?.beginUpdate();
    const outCount = Math.max(0, Math.min(segmentIdCount | 0, this.segmentCount, this.visibleSegmentIds.length));
    this.overwrittenSegmentIds = Math.max(this.overwrittenSegmentIds, outCount);
    let changed = false;
    for (let i = 0; i < outCount; i += 1) {
      if (this.visibleSegmentIds[i] !== segmentIds[i]) { this.visibleSegmentIds[i] = segmentIds[i]; changed = true; }
    }
    this.usingAllSegments = false;
    this.drawInstanceCount = outCount;
    this.mesh.geometry.instanceCount = outCount;
    if (changed && outCount > 0) {
      this.segmentIndexAttribute.clearUpdateRanges();
      this.segmentIndexAttribute.addUpdateRange(0, outCount);
      this.segmentIndexAttribute.needsUpdate = true;
    }
    this.orderedRuns?.finishUpdate();
  }

  /** Reuse external selection IDs while refreshing camera and shared paint order. */
  updateFrameWithUnchangedSelection(viewState: ViewState, viewport: ViewportPixels): void {
    this.updateFrameUniforms(viewState, viewport);
    this.orderedRuns?.beginUpdate();
    this.orderedRuns?.finishUpdate();
  }

  estimateVisibleSegmentCount(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): number {
    const estimate = this.collectVisibleSegments(viewState, viewport, cullingBounds, false);
    return estimate >= 0 ? estimate : this.segmentCount;
  }

  dispose(): void {
    this.orderedRuns?.dispose();
    this.vectorClipTexture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.segmentTextureA.dispose();
    this.segmentTextureB.dispose();
    this.segmentStyleTexture.dispose();
    this.segmentBoundsTexture.dispose();
    this.segmentTailTextureA.dispose();
    this.segmentTailTextureB.dispose();
    this.segmentTailStyleTexture.dispose();
    this.segmentTailBoundsTexture.dispose();
  }

  private updateVisibleSegments(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): void {
    const outCount = this.collectVisibleSegments(viewState, viewport, cullingBounds, true);
    if (outCount >= 0) {
      this.usingAllSegments = false;
      this.drawInstanceCount = outCount;
      this.mesh.geometry.instanceCount = outCount;
      this.segmentIndexAttribute.addUpdateRange(0, outCount);
      this.segmentIndexAttribute.needsUpdate = true;
    }
  }

  private updateFrameUniforms(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
  }

  private collectVisibleSegments(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds: CullingBounds | null | undefined,
    writeVisibleIds: boolean
  ): number {
    if (this.useLocalToClip && !cullingBounds) {
      if (writeVisibleIds) {
        this.setAllSegmentsVisible();
      }
      return -1;
    }

    if (!this.grid || this.segmentCount <= 0) {
      if (writeVisibleIds) {
        this.setAllSegmentsVisible();
        return -1;
      }
      return this.segmentCount;
    }

    const safeZoom = Math.max(1e-6, viewState.zoom);
    const halfViewWidth = Math.max(1, viewport.width) / (2 * safeZoom);
    const halfViewHeight = Math.max(1, viewport.height) / (2 * safeZoom);
    const margin = Math.max(16 / safeZoom, this.maxHalfWidth * 2, 0.5);

    const viewMinX = cullingBounds
      ? cullingBounds.minX - margin
      : viewState.cameraCenterX - halfViewWidth - margin;
    const viewMaxX = cullingBounds
      ? cullingBounds.maxX + margin
      : viewState.cameraCenterX + halfViewWidth + margin;
    const viewMinY = cullingBounds
      ? cullingBounds.minY - margin
      : viewState.cameraCenterY - halfViewHeight - margin;
    const viewMaxY = cullingBounds
      ? cullingBounds.maxY + margin
      : viewState.cameraCenterY + halfViewHeight + margin;
    const grid = this.grid;

    if (
      viewMaxX < grid.minX ||
      viewMinX > grid.maxX ||
      viewMaxY < grid.minY ||
      viewMinY > grid.maxY
    ) {
      return 0;
    }

    if (
      viewMinX <= grid.minX &&
      viewMaxX >= grid.maxX &&
      viewMinY <= grid.minY &&
      viewMaxY >= grid.maxY
    ) {
      if (writeVisibleIds) {
        this.setAllSegmentsVisible();
        return -1;
      }
      return this.segmentCount;
    }

    const c0 = clampToGrid(Math.floor((viewMinX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const c1 = clampToGrid(Math.floor((viewMaxX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const r0 = clampToGrid(Math.floor((viewMinY - grid.minY) / grid.cellHeight), grid.gridHeight);
    const r1 = clampToGrid(Math.floor((viewMaxY - grid.minY) / grid.cellHeight), grid.gridHeight);

    // Byte stamps restart every 255 passes instead of costing four bytes per stroke.
    this.markToken += 1;
    if (this.markToken === 0xff) {
      this.segmentMarks.fill(0);
      this.markToken = 1;
    }

    let outCount = 0;
    const bounds = this.strokeBounds;
    for (let row = r0; row <= r1; row += 1) {
      // A stroke is registered only in cells its bounds reach, so a cell inside
      // the view needs no per-stroke test. Border cells also hold strokes
      // clamped from beyond the grid, and are always tested.
      const rowInside = row > 0 && row < grid.gridHeight - 1 &&
        grid.minY + row * grid.cellHeight >= viewMinY && grid.minY + (row + 1) * grid.cellHeight <= viewMaxY;
      let cellIndex = row * grid.gridWidth + c0;
      for (let col = c0; col <= c1; col += 1) {
        const inside = rowInside && col > 0 && col < grid.gridWidth - 1 &&
          grid.minX + col * grid.cellWidth >= viewMinX && grid.minX + (col + 1) * grid.cellWidth <= viewMaxX;
        const offset = grid.offsets[cellIndex];
        const count = grid.counts[cellIndex];
        for (let i = 0; i < count; i += 1) {
          const segmentIndex = grid.indices[offset + i];
          if (this.segmentMarks[segmentIndex] === this.markToken) {
            continue;
          }
          this.segmentMarks[segmentIndex] = this.markToken;

          // Rounded as the Float32 bounds this layer used to store per stroke.
          if (!inside && (!writeStrokeCullingBounds(this.cullingScene, segmentIndex, bounds) ||
              Math.fround(bounds.maxX) < viewMinX || Math.fround(bounds.minX) > viewMaxX ||
              Math.fround(bounds.maxY) < viewMinY || Math.fround(bounds.minY) > viewMaxY)) {
            continue;
          }

          if (writeVisibleIds) {
            this.visibleSegmentIds[outCount] = segmentIndex;
          }
          outCount += 1;
        }
        cellIndex += 1;
      }
    }
    if (writeVisibleIds) {
      this.usingAllSegments = false;
      this.overwrittenSegmentIds = Math.max(this.overwrittenSegmentIds, outCount);
    }
    return outCount;
  }

  private setAllSegmentsVisible(): void {
    if (!this.usingAllSegments && this.overwrittenSegmentIds > 0) {
      // Only culled passes replace IDs, from the start: restore that prefix.
      const count = this.overwrittenSegmentIds;
      for (let index = 0; index < count; index++) this.visibleSegmentIds[index] = index;
      this.overwrittenSegmentIds = 0;
      this.segmentIndexAttribute.addUpdateRange(0, count);
      this.segmentIndexAttribute.needsUpdate = true;
    }
    this.usingAllSegments = true;
    this.drawInstanceCount = this.segmentCount;
    this.mesh.geometry.instanceCount = this.segmentCount;
  }
}

/** Uses the data as is: it may be a view of scene or LOD storage, never written here. */
function createSegmentDataTexture({ data, width, height }: StrokeTextureData): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createStrokeGeometry(segmentIds: Float32Array, segmentCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();

  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const segmentIndexAttribute = new THREE.InstancedBufferAttribute(segmentIds, 1);
  // Avoid Three's unconditional per-render upload for DynamicDrawUsage. The
  // culling path explicitly marks this stream dirty whenever its IDs change.
  segmentIndexAttribute.setUsage(THREE.StreamDrawUsage);
  geometry.setAttribute("aSegmentIndex", segmentIndexAttribute);
  geometry.instanceCount = Math.max(0, segmentCount | 0);

  return geometry;
}

function clampToGrid(value: number, side: number): number {
  if (side <= 1) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value >= side) {
    return side - 1;
  }
  return value;
}
