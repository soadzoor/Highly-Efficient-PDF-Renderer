import type { ThreeWebGpuFillMaterialOptions } from "./threeWebGpuFillMaterial";
import type { ThreePageBinding } from "./threePageTransforms";
import { requireThreeWebGpuBackend, type ThreeWebGpuBackend } from "./threeMaterialBackend";
import { bindRawPageTransform, type ThreePageTransforms } from "./threePageTransforms";
import type { ThreeVectorDrawPlan } from "./threeVectorDrawPlan";
import { buildVectorFillBandIndex, vectorFillBandIndex } from "./vectorFillBands";
import { vectorIndexedPathStore } from "./vectorCellIndex";
import { vectorFillDrawData, VectorFillDrawSelection, type VectorFillDrawData } from "./vectorFillDrawSelection";
import { choosePdfCompositeResolution } from "./pdfCompositeBudget";
import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";
import type { OptionalContentSnapshot } from "./optionalContent";
import type { PrimitiveColorUpdate } from "./primitiveAppearance";
import { patchPrimitiveColorTexture } from "./threePrimitiveColors";
import { acquireThreeVectorClipTexture, initializeThreeVectorClip } from "./threeVectorClips";
import { enableThreeRawPaintFold, threePaintFoldFragmentGlsl } from "./threePaintFold";
import { ThreeVectorDrawRuns } from "./threeVectorDrawRuns";
import { getThreeRenderPerformance } from "./threeRenderPerformance";
import { GUARDED_RUN_COUNT, VISIBILITY_GUARD_PIXELS } from "./visibilityGuard";
import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import {
  CORE_FILL_FRAGMENT_SHADER_SOURCE,
  CORE_FILL_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { HEPR_THREE_LAYER_ORDER_FILL } from "./threeLayerOrder";
import { normalizeThreeRawShaderSource } from "./threeRawShaderColorSpace";
import type { ThreeWebGpuFillMaterialState } from "./threeWebGpuFillMaterial";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";

interface FillLayerOptions {
  pageTransforms?: ThreePageTransforms;
  drawPlan?: ThreeVectorDrawPlan;
  materialBackend?: "webgl" | "webgpu";
  webGpu?: ThreeWebGpuBackend;
  colorCompositing?: ThreeColorCompositing;
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

export class ThreeMaterialFillLayer {
  private readonly mixedOptions: ThreeWebGpuFillMaterialOptions;
  private readonly mixedPageBinding: ThreePageBinding | undefined;
  private readonly vectorClipTexture: THREE.DataTexture;
  private readonly releaseVectorClipTexture: () => void;
  private readonly orderedRuns: ThreeVectorDrawRuns | null;
  private readonly fillData: VectorFillDrawData;
  private readonly fillSelection: VectorFillDrawSelection;
  private readonly scene: VectorScene;
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

  private readonly fillPathMetaTextureA: THREE.DataTexture;
  private readonly fillPathMetaTextureB: THREE.DataTexture;
  private readonly fillPathMetaTextureC: THREE.DataTexture;
  private readonly fillSegmentTextureA: THREE.DataTexture;
  private readonly fillSegmentTextureB: THREE.DataTexture;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;
  private readonly vectorOverrideUniform: THREE.Vector4;
  private readonly fillPathCount: number;
  private readonly fillPathIndexAttribute: THREE.InstancedBufferAttribute;
  private readonly allFillPathIds: Float32Array;
  private readonly visibleFillPathIds: Float32Array;
  private readonly fillMinX: Float32Array;
  private readonly fillMinY: Float32Array;
  private readonly fillMaxX: Float32Array;
  private readonly fillMaxY: Float32Array;
  private readonly sceneMinX: number;
  private readonly sceneMinY: number;
  private readonly sceneMaxX: number;
  private readonly sceneMaxY: number;
  private webGpuState: ThreeWebGpuFillMaterialState | null = null;
  private usingAllFillPaths = true;
  /** The culling window of the current selection; null when it must be rebuilt. */
  private selectionBounds: CullingBounds | null = null;
  private useLocalToClip = false;
  private usingFillSelection = false;

  constructor(scene: VectorScene, options: FillLayerOptions) {
    this.scene = scene;
    const fillPathCount = Math.max(0, scene.fillPathCount | 0);
    this.fillPathCount = fillPathCount;
    const coverage = this.fillData = vectorFillDrawData(scene, 2 ** 24);
    this.fillSelection = new VectorFillDrawSelection(coverage);
    const pathTextureSize = chooseTextureSize(coverage.pathCount);
    // The band and cell indexes follow the segments in the same store, so the
    // texture is sized for all three. A store too large for one goes without.
    const store = vectorIndexedPathStore(coverage, coverage.parts.size
      ? buildVectorFillBandIndex(coverage) : vectorFillBandIndex(scene));
    const segmentTextureSize = chooseTextureSize(store.texels);

    this.fillPathMetaTextureA = createFloatTexture(
      coverage.pathMetaA,
      coverage.pathCount,
      pathTextureSize.width,
      pathTextureSize.height
    );
    this.fillPathMetaTextureB = createFloatTexture(
      coverage.pathMetaB,
      coverage.pathCount,
      pathTextureSize.width,
      pathTextureSize.height
    );
    this.fillPathMetaTextureC = createFloatTexture(
      coverage.pathMetaC,
      coverage.pathCount,
      pathTextureSize.width,
      pathTextureSize.height
    );
    this.fillSegmentTextureA = createFloatTexture(
      store.dataA,
      store.texels,
      segmentTextureSize.width,
      segmentTextureSize.height
    );
    this.fillSegmentTextureB = createFloatTexture(
      store.dataB,
      store.dataB.length / 4,
      segmentTextureSize.width,
      segmentTextureSize.height
    );

    this.visibleFillPathIds = new Float32Array(Math.max(1, coverage.pathCount));
    this.allFillPathIds = new Float32Array(Math.max(1, fillPathCount));
    for (let i = 0; i < fillPathCount; i += 1) {
      this.visibleFillPathIds[i] = i;
      this.allFillPathIds[i] = i;
    }
    const fillBounds = buildFillPathBounds({ ...scene, fillPathMetaA: coverage.pathMetaA,
      fillPathMetaB: coverage.pathMetaB }, fillPathCount);
    this.fillMinX = fillBounds.minX;
    this.fillMinY = fillBounds.minY;
    this.fillMaxX = fillBounds.maxX;
    this.fillMaxY = fillBounds.maxY;
    this.sceneMinX = fillBounds.sceneMinX;
    this.sceneMinY = fillBounds.sceneMinY;
    this.sceneMaxX = fillBounds.sceneMaxX;
    this.sceneMaxY = fillBounds.sceneMaxY;

    const geometry = createFillGeometry(this.visibleFillPathIds, fillPathCount);
    this.fillPathIndexAttribute = geometry.getAttribute("aFillPathIndex") as THREE.InstancedBufferAttribute;
    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );

    let origins: Uint32Array | undefined;
    if (coverage.parts.size) {
      origins = new Uint32Array(coverage.pathCount);
      for (let id = 0; id < fillPathCount; id++) origins[id] = id;
      origins.set(coverage.origins, fillPathCount);
    }
    const pageBinding = options.pageTransforms?.instances("fill", scene, origins);
    this.mixedPageBinding = pageBinding;
    this.mixedOptions = {
      colorCompositing: options.colorCompositing ?? "linear",
      fillPathMetaTextureA: this.fillPathMetaTextureA,
      fillPathMetaTextureB: this.fillPathMetaTextureB,
      fillPathMetaTextureC: this.fillPathMetaTextureC,
      fillSegmentTextureA: this.fillSegmentTextureA,
      fillSegmentTextureB: this.fillSegmentTextureB,
      fillPathTextureWidth: pathTextureSize.width,
      fillSegmentTextureWidth: segmentTextureSize.width,
      fillBandBase: store.bandBase,
      fillBandEntries: store.bandEntries,
      fillCellBase: store.cellBase,
      viewport: this.viewportUniform,
      cameraCenter: this.cameraCenterUniform,
      localToClip: this.localToClipUniform,
      pageBinding,
      vectorOverride: this.vectorOverrideUniform
    };
    let material: THREE.Material;
    if ((options.materialBackend ?? "webgl") === "webgpu") {
      const state = requireThreeWebGpuBackend(options.webGpu).createThreeWebGpuFillMaterial(this.mixedOptions);
      state.zoomUniform.value = this.zoomUniform.value;
      state.useLocalToClipUniform.value = this.useLocalToClipUniform.value;
      this.webGpuState = state;
      material = state.material;
      requireThreeWebGpuBackend(options.webGpu).enableThreeNodePaintFold(state.material);
    } else {
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: normalizeThreeRawShaderSource(CORE_FILL_VERTEX_SHADER_SOURCE),
        fragmentShader: normalizeThreeRawShaderSource(threePaintFoldFragmentGlsl(CORE_FILL_FRAGMENT_SHADER_SOURCE), true),
        transparent: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uFillPathMetaTexA: { value: this.fillPathMetaTextureA },
          uFillPathMetaTexB: { value: this.fillPathMetaTextureB },
          uFillPathMetaTexC: { value: this.fillPathMetaTextureC },
          uFillBandBase: { value: store.bandBase },
          uFillBandEntries: { value: store.bandEntries },
          // Stored plus one: zero means the store has no cell index.
          uFillCellHeaders: { value: store.cellBase + 1 },
          // Three projects fills and does not upload the native bounds store.
          uFillClipBoundsEnabled: { value: 0 },
          uFillSegmentTexA: { value: this.fillSegmentTextureA },
          uFillSegmentTexB: { value: this.fillSegmentTextureB },
          uFillPathMetaTexSize: {
            value: new Int32Array([pathTextureSize.width, pathTextureSize.height])
          },
          uFillSegmentTexSize: {
            value: new Int32Array([segmentTextureSize.width, segmentTextureSize.height])
          },
          uViewport: { value: this.viewportUniform },
          uCameraCenter: { value: this.cameraCenterUniform },
          uZoom: this.zoomUniform,
          uUseLocalToClip: this.useLocalToClipUniform,
          uLocalToClip: { value: this.localToClipUniform },
          uFillAAScreenPx: { value: 1.0 },
          uVectorOverride: { value: this.vectorOverrideUniform }
        }
      });
      // A group chain holding one fill draws it straight onto the surface.
      enableThreeRawPaintFold(material as THREE.RawShaderMaterial);
    }
    configureStraightAlphaBlending(material);

    bindRawPageTransform(material, pageBinding);
    const clips = acquireThreeVectorClipTexture(scene);
    this.vectorClipTexture = clips.texture;
    this.releaseVectorClipTexture = clips.release;
    try {
      initializeThreeVectorClip(material, this.vectorClipTexture);
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_FILL;
      this.orderedRuns = ThreeVectorDrawRuns.create(scene, "fill", this.mesh, "aFillPathIndex", options.drawPlan,
        undefined, coverage.parts.size ? this.fillSelection : undefined, origins);
    } catch (error) {
      clips.release();
      throw error;
    }
  }

  /** Borrow immutable texture stores and live view state; the layer retains ownership. */
  getMixedVectorResources() {
    return { options: this.mixedOptions, pageBinding: this.mixedPageBinding,
      clipTexture: this.vectorClipTexture, zoomUniform: this.zoomUniform,
      useLocalToClipUniform: this.useLocalToClipUniform };
  }

  setOptionalContentVisibility(snapshot: OptionalContentSnapshot): void {
    this.orderedRuns?.setOptionalContentVisibility(snapshot);
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  setPrimitiveColorUpdates(updates: readonly PrimitiveColorUpdate[], scene: VectorScene): void {
    patchPrimitiveColorTexture(this.fillPathMetaTextureB, scene.fillPathMetaB, updates, "fill", [
      { source: 2, target: 2 }, { source: 3, target: 3 }
    ]);
    patchPrimitiveColorTexture(this.fillPathMetaTextureC, scene.fillPathMetaC, updates, "fill", [
      { source: 2, target: 2, component: 2 }
    ]);
    const b = this.fillPathMetaTextureB.image.data as Float32Array;
    const c = this.fillPathMetaTextureC.image.data as Float32Array;
    for (const update of updates) {
      if (update.ref.kind !== "fill") continue;
      const variants = this.fillData.parts.get(update.ref.index);
      if (!variants) continue;
      const source = update.ref.index * 4;
      for (const parts of variants) for (let id = parts.first; id < parts.first + parts.count; id++) {
        b[id * 4 + 2] = b[source + 2]; b[id * 4 + 3] = b[source + 3]; c[id * 4 + 2] = c[source + 2];
      }
    }
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClip = false;
    this.useLocalToClipUniform.value = 0;
    if (this.webGpuState) {
      this.webGpuState.useLocalToClipUniform.value = 0;
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4): void {
    this.useLocalToClip = true;
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    if (this.webGpuState) {
      this.webGpuState.useLocalToClipUniform.value = 1;
    }
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null,
    compositing = sceneRequiresPaintCompositing(this.scene)): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    if (this.webGpuState) {
      this.webGpuState.zoomUniform.value = this.zoomUniform.value;
    }
    this.orderedRuns?.beginUpdate();
    const resolution = compositing ? choosePdfCompositeResolution(this.scene, viewport.width, viewport.height) : null;
    // A downscaled surface has wider fragment footprints than the vertex
    // padding computed from the presentation viewport. Keep whole paints.
    const reduced = resolution && (resolution.width < viewport.width || resolution.height < viewport.height);
    const units = reduced ? null : this.fillUnitsPerPixel(viewState, viewport);
    const zoom = Math.max(1e-6, viewState.zoom);
    const bounds = cullingBounds ?? (this.useLocalToClip ? null : {
      minX: viewState.cameraCenterX - viewport.width / (2 * zoom),
      minY: viewState.cameraCenterY - viewport.height / (2 * zoom),
      maxX: viewState.cameraCenterX + viewport.width / (2 * zoom),
      maxY: viewState.cameraCenterY + viewport.height / (2 * zoom)
    });
    const selectionChanged = this.fillSelection.update(units, units === null ? null : bounds);
    if (selectionChanged) this.orderedRuns?.invalidateFillSelection();
    if (units === null) this.updateVisibleFillPaths(viewState, viewport, cullingBounds);
    else if (selectionChanged || !this.usingFillSelection) this.updateSelectedFillPaths();
    this.usingFillSelection = units !== null;
    this.orderedRuns?.finishUpdate();
    const profile = getThreeRenderPerformance();
    profile?.add("three.fillSelectionActive", units === null ? 0 : 1);
    profile?.add("three.fillSplitPaths", this.fillSelection.splitPaths.size);
  }

  /** Bound inverse pixel footprints for each visible page's planar projection. */
  private fillUnitsPerPixel(view: ViewState, viewport: ViewportPixels): number | null {
    if (!this.useLocalToClip) return 1 / Math.max(1e-6, view.zoom);
    const pages = this.mixedPageBinding?.table;
    if (!pages) return projectedUnitsPerPixel(this.localToClipUniform, viewport);
    let maximum = 0;
    for (let page = 0; page < pages.visibility.length; page++) {
      if (!pages.visibility[page]) continue;
      const units = projectedUnitsPerPixel(pages.projections[page], viewport);
      if (units === null) return null;
      maximum = Math.max(maximum, units);
    }
    return maximum > 0 ? maximum : null;
  }

  private updateSelectedFillPaths(): void {
    this.selectionBounds = null;
    const visible = this.fillSelection.visible;
    if (!visible) { this.setAllFillPathsVisible(); return; }
    let count = 0, changed = false;
    for (let id = 0; id < this.fillPathCount; id++) {
      if (!visible[id]) continue;
      if (this.visibleFillPathIds[count] !== id) { this.visibleFillPathIds[count] = id; changed = true; }
      count++;
    }
    this.usingAllFillPaths = count === this.fillPathCount;
    this.mesh.geometry.instanceCount = count;
    if (changed) {
      this.fillPathIndexAttribute.clearUpdateRanges();
      this.fillPathIndexAttribute.addUpdateRange(0, count);
      this.fillPathIndexAttribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.orderedRuns?.dispose();
    this.releaseVectorClipTexture();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.fillPathMetaTextureA.dispose();
    this.fillPathMetaTextureB.dispose();
    this.fillPathMetaTextureC.dispose();
    this.fillSegmentTextureA.dispose();
    this.fillSegmentTextureB.dispose();
  }

  private updateVisibleFillPaths(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): void {
    if (this.useLocalToClip && !cullingBounds) {
      this.setAllFillPathsVisible();
      return;
    }

    if (this.fillPathCount <= 0) {
      this.setAllFillPathsVisible();
      return;
    }

    const safeZoom = Math.max(1e-6, viewState.zoom);
    const halfViewWidth = Math.max(1, viewport.width) / (2 * safeZoom);
    const halfViewHeight = Math.max(1, viewport.height) / (2 * safeZoom);
    const margin = Math.max(16 / safeZoom, 0.5);

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

    if (
      viewMinX <= this.sceneMinX &&
      viewMaxX >= this.sceneMaxX &&
      viewMinY <= this.sceneMinY &&
      viewMaxY >= this.sceneMaxY
    ) {
      this.setAllFillPathsVisible();
      return;
    }

    // As in native run culling, large drawings select a margin beyond the view
    // and keep that selection while the view stays inside it, so panning does
    // not rebuild every batch each frame. The window may exceed the view by at
    // most four margins, so zooming into a detail refreshes it.
    const guard = this.fillPathCount >= GUARDED_RUN_COUNT ? VISIBILITY_GUARD_PIXELS / safeZoom : 0;
    const previous = this.selectionBounds;
    if (guard > 0 && previous && !this.usingAllFillPaths &&
        viewMinX >= previous.minX && viewMinY >= previous.minY && viewMaxX <= previous.maxX && viewMaxY <= previous.maxY &&
        previous.maxX - previous.minX <= viewMaxX - viewMinX + guard * 4 &&
        previous.maxY - previous.minY <= viewMaxY - viewMinY + guard * 4) {
      return;
    }
    const minX = viewMinX - guard, minY = viewMinY - guard, maxX = viewMaxX + guard, maxY = viewMaxY + guard;
    this.selectionBounds = guard > 0 && [minX, minY, maxX, maxY].every(Number.isFinite) ? { minX, minY, maxX, maxY } : null;

    let outCount = 0;
    for (let i = 0; i < this.fillPathCount; i += 1) {
      if (
        this.fillMaxX[i] < minX ||
        this.fillMinX[i] > maxX ||
        this.fillMaxY[i] < minY ||
        this.fillMinY[i] > maxY
      ) {
        continue;
      }

      this.visibleFillPathIds[outCount] = i;
      outCount += 1;
    }

    this.usingAllFillPaths = false;
    this.mesh.geometry.instanceCount = outCount;
    this.fillPathIndexAttribute.addUpdateRange(0, outCount);
    this.fillPathIndexAttribute.needsUpdate = true;
  }

  private setAllFillPathsVisible(): void {
    this.selectionBounds = null;
    if (!this.usingAllFillPaths) {
      this.visibleFillPathIds.set(this.allFillPathIds.subarray(0, this.fillPathCount), 0);
      this.fillPathIndexAttribute.addUpdateRange(0, this.fillPathCount);
      this.fillPathIndexAttribute.needsUpdate = true;
    }
    this.usingAllFillPaths = true;
    this.mesh.geometry.instanceCount = this.fillPathCount;
  }
}

/** Bound inverse pixel derivatives over the viewport and neighbouring samples. */
function projectedUnitsPerPixel(matrix: THREE.Matrix4, viewport: ViewportPixels): number | null {
  const m = matrix.elements;
  const w = Math.fround(m[15]);
  const a = Math.fround(m[0]) * viewport.width / 2, b = Math.fround(m[4]) * viewport.width / 2;
  const c = Math.fround(m[1]) * viewport.height / 2, d = Math.fround(m[5]) * viewport.height / 2;
  const tx = Math.fround(m[12]) * viewport.width / 2, ty = Math.fround(m[13]) * viewport.height / 2;
  const p = Math.fround(m[3]), q = Math.fround(m[7]), determinant = a * d - b * c;
  const tolerance = 2 ** -20;
  // Nearly cancelling products cannot establish a reliable inverse from the
  // Float32 matrices seen by the shader. Keep the original drawing domain.
  if (Math.abs(determinant) <= (Math.abs(a * d) + Math.abs(b * c)) * tolerance) return null;
  const inverseWX = c * q - d * p, inverseWY = b * p - a * q;
  const halfWidth = viewport.width / 2 + 1, halfHeight = viewport.height / 2 + 1;
  const variation = Math.abs(inverseWX) * halfWidth + Math.abs(inverseWY) * halfHeight;
  // Inverse homogeneous W is linear in screen XY. Its smallest absolute
  // value bounds perspective division everywhere in the viewport, including
  // the neighbouring samples used for fragment derivatives. A horizon inside
  // that domain, or cancellation at Float32 precision, has no reliable bound.
  const minimumW = Math.abs(determinant) - variation;
  const uncertainty = (Math.abs(a * d) + Math.abs(b * c) +
    (Math.abs(c * q) + Math.abs(d * p)) * halfWidth +
    (Math.abs(b * p) + Math.abs(a * q)) * halfHeight) * tolerance;
  if (!(minimumW > uncertainty)) return null;
  const depth = w * determinant, offsetX = tx * inverseWX, offsetY = ty * inverseWY;
  const planarDeterminant = depth + offsetX + offsetY;
  // Positive forward clip W is required on screen, but the data origin itself
  // can be behind the eye under a translated/projective object transform.
  if (!(planarDeterminant * Math.sign(determinant) > 0) || Math.abs(planarDeterminant) <=
      (Math.abs(depth) + Math.abs(offsetX) + Math.abs(offsetY)) * tolerance) return null;
  // For inverse homography H^-1, derivative numerators are det(H) times
  // (d-q*y, q*x-b) and (p*y-c, a-p*x). Their row norms, divided by the
  // smallest inverse W squared, also bound the shader's finite differences.
  const units = Math.abs(planarDeterminant) / (minimumW * minimumW) * Math.max(
    Math.hypot(Math.abs(d) + Math.abs(q) * halfHeight, Math.abs(b) + Math.abs(q) * halfWidth),
    Math.hypot(Math.abs(c) + Math.abs(p) * halfHeight, Math.abs(a) + Math.abs(p) * halfWidth)
  ) * (1 + tolerance);
  return Number.isFinite(units) && units > 0 ? units : null;
}

function chooseTextureSize(count: number): { width: number; height: number } {
  if (count <= 0) {
    return { width: 1, height: 1 };
  }

  const width = Math.max(1, Math.ceil(Math.sqrt(count)));
  const height = Math.max(1, Math.ceil(count / width));
  return { width, height };
}

function createFloatTexture(
  source: Float32Array,
  count: number,
  width: number,
  height: number
): THREE.DataTexture {
  const data = new Float32Array(width * height * 4);
  const sourceLength = Math.min(source.length, count * 4);
  if (sourceLength > 0) {
    data.set(source.subarray(0, sourceLength), 0);
  }

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

function createFillGeometry(fillPathIds: Float32Array, fillPathCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();

  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const fillPathIndexAttribute = new THREE.InstancedBufferAttribute(fillPathIds, 1);
  // Avoid Three's unconditional per-render upload for DynamicDrawUsage. The
  // culling path explicitly marks this stream dirty whenever its IDs change.
  fillPathIndexAttribute.setUsage(THREE.StreamDrawUsage);
  geometry.setAttribute("aFillPathIndex", fillPathIndexAttribute);
  geometry.instanceCount = Math.max(0, fillPathCount | 0);

  return geometry;
}

function buildFillPathBounds(scene: VectorScene, fillPathCount: number): {
  minX: Float32Array;
  minY: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
  sceneMinX: number;
  sceneMinY: number;
  sceneMaxX: number;
  sceneMaxY: number;
} {
  const minX = new Float32Array(fillPathCount);
  const minY = new Float32Array(fillPathCount);
  const maxX = new Float32Array(fillPathCount);
  const maxY = new Float32Array(fillPathCount);

  let sceneMinX = Number.POSITIVE_INFINITY;
  let sceneMinY = Number.POSITIVE_INFINITY;
  let sceneMaxX = Number.NEGATIVE_INFINITY;
  let sceneMaxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < fillPathCount; i += 1) {
    const offset = i * 4;
    const x0 = scene.fillPathMetaA[offset + 2];
    const y0 = scene.fillPathMetaA[offset + 3];
    const x1 = scene.fillPathMetaB[offset];
    const y1 = scene.fillPathMetaB[offset + 1];

    minX[i] = Math.min(x0, x1);
    minY[i] = Math.min(y0, y1);
    maxX[i] = Math.max(x0, x1);
    maxY[i] = Math.max(y0, y1);

    sceneMinX = Math.min(sceneMinX, minX[i]);
    sceneMinY = Math.min(sceneMinY, minY[i]);
    sceneMaxX = Math.max(sceneMaxX, maxX[i]);
    sceneMaxY = Math.max(sceneMaxY, maxY[i]);
  }

  if (!Number.isFinite(sceneMinX) || !Number.isFinite(sceneMinY) || !Number.isFinite(sceneMaxX) || !Number.isFinite(sceneMaxY)) {
    sceneMinX = scene.bounds.minX;
    sceneMinY = scene.bounds.minY;
    sceneMaxX = scene.bounds.maxX;
    sceneMaxY = scene.bounds.maxY;
  }

  return { minX, minY, maxX, maxY, sceneMinX, sceneMinY, sceneMaxX, sceneMaxY };
}
