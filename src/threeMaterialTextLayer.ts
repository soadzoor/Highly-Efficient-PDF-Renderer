import * as THREE from "three";

import {
  CORE_TEXT_FRAGMENT_SHADER_SOURCE,
  CORE_TEXT_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { VectorScene } from "./pdfVectorExtractor";
import { buildTextRasterAtlas } from "./textRasterAtlas";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { HEPR_THREE_LAYER_ORDER_TEXT } from "./threeLayerOrder";
import {
  normalizeThreeRawShaderSource,
  normalizeThreeTextRawFragmentShaderSource
} from "./threeRawShaderColorSpace";
import { createThreeWebGpuTextMaterial, type ThreeWebGpuTextMaterialState } from "./threeWebGpuTextMaterial";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";

interface TextLayerOptions {
  materialBackend?: "webgl" | "webgpu";
  colorCompositing?: ThreeColorCompositing;
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
  vectorOverride: [number, number, number, number];
  maxRasterAtlasTextureSize?: number;
  /**
   * Prefix of real glyphs eligible for raster-atlas sampling. Clustered Text
   * LOD appends an analytic solid-square glyph after this prefix.
   */
  rasterAtlasGlyphCount?: number;
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

const DEFAULT_MAX_RASTER_ATLAS_TEXTURE_SIZE = 4096;

export class ThreeMaterialTextLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

  private readonly textInstanceTextureA: THREE.DataTexture;
  private readonly textInstanceTextureB: THREE.DataTexture;
  private readonly textInstanceTextureC: THREE.DataTexture;
  private readonly textGlyphMetaTextureA: THREE.DataTexture;
  private readonly textGlyphMetaTextureB: THREE.DataTexture;
  private readonly textGlyphRasterMetaTexture: THREE.DataTexture;
  private readonly textGlyphSegmentTextureA: THREE.DataTexture;
  private readonly textGlyphSegmentTextureB: THREE.DataTexture;
  private readonly textRasterAtlasTexture: THREE.DataTexture;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;
  private readonly curveUniform: { value: number };
  private readonly vectorOnlyUniform: { value: number };
  private readonly vectorOverrideUniform: THREE.Vector4;
  private readonly rasterAtlasSizeUniform: THREE.Vector2;
  private webGpuState: ThreeWebGpuTextMaterialState | null = null;

  private readonly textInstanceCount: number;
  private readonly pageCount: number;
  private readonly pageRects: Float32Array;
  private readonly pageTextRanges: Uint32Array;
  private readonly sceneMinX: number;
  private readonly sceneMinY: number;
  private readonly sceneMaxX: number;
  private readonly sceneMaxY: number;
  private readonly textInstanceIds: Float32Array;
  private readonly textInstanceIndexAttribute: THREE.InstancedBufferAttribute;
  private readonly rangeStarts: Uint32Array;
  private readonly rangeCounts: Uint32Array;
  private readonly previousRangeStarts: Uint32Array;
  private readonly previousRangeCounts: Uint32Array;
  private previousRangeCount = -1;
  private usingAllTextInstances = true;
  private usingExternalSelection = false;
  private externalSelectionCount = -1;
  private useLocalToClip = false;
  private renderedTextInstanceCount: number;

  constructor(scene: VectorScene, options: TextLayerOptions) {
    const materialBackend = options.materialBackend ?? "webgl";
    const textInstanceCount = Math.max(0, scene.textInstanceCount | 0);
    const textGlyphCount = Math.max(0, scene.textGlyphCount | 0);
    const textGlyphSegmentCount = Math.max(0, scene.textGlyphSegmentCount | 0);

    const instanceTextureSize = chooseTextureSize(textInstanceCount);
    const glyphMetaTextureSize = chooseTextureSize(textGlyphCount);
    const glyphSegmentTextureSize = chooseTextureSize(textGlyphSegmentCount);

    this.textInstanceTextureA = createFloatTexture(
      scene.textInstanceA,
      textInstanceCount,
      instanceTextureSize.width,
      instanceTextureSize.height
    );
    this.textInstanceTextureB = createFloatTexture(
      scene.textInstanceB,
      textInstanceCount,
      instanceTextureSize.width,
      instanceTextureSize.height
    );
    this.textInstanceTextureC = createNormalizedByteTexture(
      scene.textInstanceC,
      textInstanceCount,
      instanceTextureSize.width,
      instanceTextureSize.height
    );

    this.textGlyphMetaTextureA = createFloatTexture(
      scene.textGlyphMetaA,
      textGlyphCount,
      glyphMetaTextureSize.width,
      glyphMetaTextureSize.height
    );
    this.textGlyphMetaTextureB = createFloatTexture(
      scene.textGlyphMetaB,
      textGlyphCount,
      glyphMetaTextureSize.width,
      glyphMetaTextureSize.height
    );

    const rasterMetaData = new Float32Array(glyphMetaTextureSize.width * glyphMetaTextureSize.height * 4);
    const rasterAtlasGlyphCount = clampInt(
      options.rasterAtlasGlyphCount ?? textGlyphCount,
      0,
      textGlyphCount
    );
    const rasterAtlasScene = rasterAtlasGlyphCount === textGlyphCount
      ? scene
      : { ...scene, textGlyphCount: rasterAtlasGlyphCount };
    const rasterAtlas = buildTextRasterAtlas(
      rasterAtlasScene,
      clampInt(
        options.maxRasterAtlasTextureSize ?? DEFAULT_MAX_RASTER_ATLAS_TEXTURE_SIZE,
        256,
        8192
      )
    );
    if (rasterAtlas) {
      rasterMetaData.set(rasterAtlas.glyphUvRects, 0);
    }
    this.textGlyphRasterMetaTexture = createFloatTexture(
      rasterMetaData,
      glyphMetaTextureSize.width * glyphMetaTextureSize.height,
      glyphMetaTextureSize.width,
      glyphMetaTextureSize.height
    );

    this.textGlyphSegmentTextureA = createFloatTexture(
      scene.textGlyphSegmentsA,
      textGlyphSegmentCount,
      glyphSegmentTextureSize.width,
      glyphSegmentTextureSize.height
    );
    this.textGlyphSegmentTextureB = createFloatTexture(
      scene.textGlyphSegmentsB,
      textGlyphSegmentCount,
      glyphSegmentTextureSize.width,
      glyphSegmentTextureSize.height
    );

    if (rasterAtlas) {
      this.textRasterAtlasTexture = createRasterAtlasTexture(
        rasterAtlas.alpha,
        rasterAtlas.width,
        rasterAtlas.height
      );
      this.rasterAtlasSizeUniform = new THREE.Vector2(rasterAtlas.width, rasterAtlas.height);
    } else {
      this.textRasterAtlasTexture = createRasterAtlasTexture(new Uint8Array([0]), 1, 1);
      this.rasterAtlasSizeUniform = new THREE.Vector2(1, 1);
    }

    this.textInstanceCount = textInstanceCount;
    const pageLayout = resolvePageLayout(scene, textInstanceCount);
    this.pageCount = pageLayout.pageCount;
    this.pageRects = pageLayout.pageRects;
    this.pageTextRanges = pageLayout.pageTextRanges;
    this.sceneMinX = pageLayout.sceneMinX;
    this.sceneMinY = pageLayout.sceneMinY;
    this.sceneMaxX = pageLayout.sceneMaxX;
    this.sceneMaxY = pageLayout.sceneMaxY;
    this.rangeStarts = new Uint32Array(Math.max(1, this.pageCount));
    this.rangeCounts = new Uint32Array(Math.max(1, this.pageCount));
    this.previousRangeStarts = new Uint32Array(Math.max(1, this.pageCount));
    this.previousRangeCounts = new Uint32Array(Math.max(1, this.pageCount));
    this.renderedTextInstanceCount = textInstanceCount;

    this.textInstanceIds = new Float32Array(Math.max(1, textInstanceCount));
    for (let i = 0; i < textInstanceCount; i += 1) {
      this.textInstanceIds[i] = i;
    }
    const geometry = createTextGeometry(this.textInstanceIds, textInstanceCount);
    this.textInstanceIndexAttribute = geometry.getAttribute("aTextInstanceIndex") as THREE.InstancedBufferAttribute;
    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();
    this.curveUniform = { value: options.strokeCurveEnabled ? 1 : 0 };
    this.vectorOnlyUniform = { value: options.textVectorOnly ? 1 : 0 };
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );

    let material: THREE.Material;
    if (materialBackend === "webgpu") {
      const state = createThreeWebGpuTextMaterial({
        colorCompositing: options.colorCompositing ?? "linear",
        textInstanceTextureA: this.textInstanceTextureA,
        textInstanceTextureB: this.textInstanceTextureB,
        textInstanceTextureC: this.textInstanceTextureC,
        textGlyphMetaTextureA: this.textGlyphMetaTextureA,
        textGlyphMetaTextureB: this.textGlyphMetaTextureB,
        textGlyphRasterMetaTexture: this.textGlyphRasterMetaTexture,
        textGlyphSegmentTextureA: this.textGlyphSegmentTextureA,
        textGlyphSegmentTextureB: this.textGlyphSegmentTextureB,
        textRasterAtlasTexture: this.textRasterAtlasTexture,
        textRasterAtlasSize: this.rasterAtlasSizeUniform,
        textInstanceTextureWidth: instanceTextureSize.width,
        textGlyphTextureWidth: glyphMetaTextureSize.width,
        textSegmentTextureWidth: glyphSegmentTextureSize.width,
        viewport: this.viewportUniform,
        cameraCenter: this.cameraCenterUniform,
        localToClip: this.localToClipUniform,
        vectorOverride: this.vectorOverrideUniform,
        strokeCurveEnabled: options.strokeCurveEnabled,
        textVectorOnly: options.textVectorOnly
      });
      state.zoomUniform.value = this.zoomUniform.value;
      state.useLocalToClipUniform.value = this.useLocalToClipUniform.value;
      this.webGpuState = state;
      material = state.material;
    } else {
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: normalizeThreeRawShaderSource(CORE_TEXT_VERTEX_SHADER_SOURCE),
        fragmentShader: normalizeThreeTextRawFragmentShaderSource(CORE_TEXT_FRAGMENT_SHADER_SOURCE),
        transparent: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uTextInstanceTexA: { value: this.textInstanceTextureA },
          uTextInstanceTexB: { value: this.textInstanceTextureB },
          uTextInstanceTexC: { value: this.textInstanceTextureC },
          uTextGlyphMetaTexA: { value: this.textGlyphMetaTextureA },
          uTextGlyphMetaTexB: { value: this.textGlyphMetaTextureB },
          uTextGlyphRasterMetaTex: { value: this.textGlyphRasterMetaTexture },
          uTextGlyphSegmentTexA: { value: this.textGlyphSegmentTextureA },
          uTextGlyphSegmentTexB: { value: this.textGlyphSegmentTextureB },
          uTextRasterAtlasTex: { value: this.textRasterAtlasTexture },
          uTextInstanceTexSize: {
            value: new Int32Array([instanceTextureSize.width, instanceTextureSize.height])
          },
          uTextGlyphMetaTexSize: {
            value: new Int32Array([glyphMetaTextureSize.width, glyphMetaTextureSize.height])
          },
          uTextGlyphSegmentTexSize: {
            value: new Int32Array([glyphSegmentTextureSize.width, glyphSegmentTextureSize.height])
          },
          uTextRasterAtlasSize: { value: this.rasterAtlasSizeUniform },
          uViewport: { value: this.viewportUniform },
          uCameraCenter: { value: this.cameraCenterUniform },
          uZoom: this.zoomUniform,
          uUseLocalToClip: this.useLocalToClipUniform,
          uLocalToClip: { value: this.localToClipUniform },
          uTextAAScreenPx: { value: 1.25 },
          uTextCurveEnabled: this.curveUniform,
          uTextVectorOnly: this.vectorOnlyUniform,
          uVectorOverride: { value: this.vectorOverrideUniform }
        }
      });
    }
    configureStraightAlphaBlending(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_TEXT;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    this.curveUniform.value = enabled ? 1 : 0;
    if (this.webGpuState) {
      this.webGpuState.curveUniform.value = this.curveUniform.value;
    }
  }

  setTextVectorOnly(enabled: boolean): void {
    this.vectorOnlyUniform.value = enabled ? 1 : 0;
    if (this.webGpuState) {
      this.webGpuState.vectorOnlyUniform.value = this.vectorOnlyUniform.value;
    }
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  setRasterAtlasAnisotropy(anisotropy: number): void {
    const supported = Math.max(1, Math.floor(Number.isFinite(anisotropy) ? anisotropy : 1));
    if (this.textRasterAtlasTexture.anisotropy === supported) {
      return;
    }
    this.textRasterAtlasTexture.anisotropy = supported;
    this.textRasterAtlasTexture.needsUpdate = true;
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

  getRenderedTextInstanceCount(): number {
    return this.renderedTextInstanceCount;
  }

  getTextInstanceCount(): number {
    return this.textInstanceCount;
  }

  /**
   * Replace the draw's instance indirection with an already source-ordered
   * selection. Clustered text LOD uses this to choose either the exact glyphs
   * or the coarse run for each visible cluster while retaining one text draw.
   *
   * Supplying the same IDs is a no-op, so a stationary camera causes no GPU
   * selection upload. `instanceIds` may alias a buffer the caller reuses, so it
   * is copied here and never retained.
   */
  setSelectedTextInstanceIds(instanceIds: Uint32Array): boolean {
    const count = instanceIds.length;
    if (count > this.textInstanceIds.length) {
      throw new RangeError(
        `Text selection contains ${count} instances, but the layer capacity is ${this.textInstanceIds.length}.`
      );
    }
    // The ids are derived from immutable build data, so an out-of-range value
    // would be a wiring bug that shows up on the first selection. Auditing every
    // element on adoption catches that without scanning the whole selection on
    // each frame of a camera move, which the checks below already avoid.
    if (!this.usingExternalSelection) {
      for (let i = 0; i < count; i += 1) {
        const instanceId = instanceIds[i];
        if (!Number.isInteger(instanceId) || instanceId < 0 || instanceId >= this.textInstanceCount) {
          throw new RangeError(`Text selection instance ID ${instanceId} is outside the uploaded text payload.`);
        }
      }
    }

    let changed = !this.usingExternalSelection || this.externalSelectionCount !== count;
    if (!changed) {
      for (let i = 0; i < count; i += 1) {
        if (this.textInstanceIds[i] !== instanceIds[i]) {
          changed = true;
          break;
        }
      }
    }

    this.usingExternalSelection = true;
    this.externalSelectionCount = count;
    this.renderedTextInstanceCount = count;
    this.mesh.geometry.instanceCount = count;
    if (!changed) {
      return false;
    }

    this.textInstanceIds.set(instanceIds, 0);
    if (count > 0) {
      markAttributeForUpdate(this.textInstanceIndexAttribute, count);
    }
    return true;
  }

  /** Restore the ordinary page-range culling path. */
  clearSelectedTextInstanceIds(): void {
    if (!this.usingExternalSelection) {
      return;
    }
    this.usingExternalSelection = false;
    this.externalSelectionCount = -1;
    this.usingAllTextInstances = false;
    this.previousRangeCount = -1;
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    if (this.webGpuState) {
      this.webGpuState.zoomUniform.value = this.zoomUniform.value;
    }
    if (this.usingExternalSelection) {
      return;
    }
    this.updateVisibleTextInstances(viewState, viewport, cullingBounds);
  }

  private updateVisibleTextInstances(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): void {
    if (this.pageCount <= 0 || this.textInstanceCount <= 0) {
      this.setAllTextInstancesVisible();
      return;
    }

    if (this.useLocalToClip && !cullingBounds) {
      this.setAllTextInstancesVisible();
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
      this.setAllTextInstancesVisible();
      return;
    }

    let rangeCount = 0;
    let visibleInstanceCount = 0;
    for (let pageIndex = 0; pageIndex < this.pageCount; pageIndex += 1) {
      const rectOffset = pageIndex * 4;
      if (
        this.pageRects[rectOffset + 2] < viewMinX ||
        this.pageRects[rectOffset] > viewMaxX ||
        this.pageRects[rectOffset + 3] < viewMinY ||
        this.pageRects[rectOffset + 1] > viewMaxY
      ) {
        continue;
      }

      const rangeOffset = pageIndex * 2;
      const start = this.pageTextRanges[rangeOffset];
      const count = this.pageTextRanges[rangeOffset + 1];
      if (count <= 0) {
        continue;
      }

      visibleInstanceCount += count;
      // Pages are laid out in a grid, so visible pages are rarely one run, but
      // neighbours within a row still merge into a single span.
      if (rangeCount > 0 && this.rangeStarts[rangeCount - 1] + this.rangeCounts[rangeCount - 1] === start) {
        this.rangeCounts[rangeCount - 1] += count;
        continue;
      }

      this.rangeStarts[rangeCount] = start;
      this.rangeCounts[rangeCount] = count;
      rangeCount += 1;
    }

    this.renderedTextInstanceCount = visibleInstanceCount;
    this.mesh.geometry.instanceCount = visibleInstanceCount;

    // Rewriting 2.8M ids every frame would cost more than the culling saves, and
    // the visible page set only changes when the view crosses a page edge.
    if (!this.usingAllTextInstances && this.rangesMatchPrevious(rangeCount)) {
      return;
    }

    let outCount = 0;
    for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex += 1) {
      const start = this.rangeStarts[rangeIndex];
      const end = start + this.rangeCounts[rangeIndex];
      for (let instanceIndex = start; instanceIndex < end; instanceIndex += 1) {
        this.textInstanceIds[outCount] = instanceIndex;
        outCount += 1;
      }
    }

    this.rememberRanges(rangeCount);
    this.usingAllTextInstances = false;
    if (outCount > 0) {
      markAttributeForUpdate(this.textInstanceIndexAttribute, outCount);
    }
  }

  private setAllTextInstancesVisible(): void {
    if (!this.usingAllTextInstances) {
      for (let i = 0; i < this.textInstanceCount; i += 1) {
        this.textInstanceIds[i] = i;
      }
      this.previousRangeCount = -1;
      if (this.textInstanceCount > 0) {
        markAttributeForUpdate(this.textInstanceIndexAttribute, this.textInstanceCount);
      }
    }
    this.usingAllTextInstances = true;
    this.renderedTextInstanceCount = this.textInstanceCount;
    this.mesh.geometry.instanceCount = this.textInstanceCount;
  }

  private rangesMatchPrevious(rangeCount: number): boolean {
    if (rangeCount !== this.previousRangeCount) {
      return false;
    }
    for (let i = 0; i < rangeCount; i += 1) {
      if (this.rangeStarts[i] !== this.previousRangeStarts[i] || this.rangeCounts[i] !== this.previousRangeCounts[i]) {
        return false;
      }
    }
    return true;
  }

  private rememberRanges(rangeCount: number): void {
    this.previousRangeCount = rangeCount;
    for (let i = 0; i < rangeCount; i += 1) {
      this.previousRangeStarts[i] = this.rangeStarts[i];
      this.previousRangeCounts[i] = this.rangeCounts[i];
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.textInstanceTextureA.dispose();
    this.textInstanceTextureB.dispose();
    this.textInstanceTextureC.dispose();
    this.textGlyphMetaTextureA.dispose();
    this.textGlyphMetaTextureB.dispose();
    this.textGlyphRasterMetaTexture.dispose();
    this.textGlyphSegmentTextureA.dispose();
    this.textGlyphSegmentTextureB.dispose();
    this.textRasterAtlasTexture.dispose();
  }
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

function createNormalizedByteTexture(
  source: Float32Array,
  count: number,
  width: number,
  height: number
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  const sourceLength = Math.min(source.length, count * 4);
  for (let i = 0; i < sourceLength; i += 1) {
    data[i] = Math.round(clampNumber(source[i], 0, 1) * 255);
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createRasterAtlasTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function createTextGeometry(
  textInstanceIds: Float32Array,
  textInstanceCount: number
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();

  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const instanceCount = Math.max(0, textInstanceCount | 0);
  const textInstanceIndexAttribute = new THREE.InstancedBufferAttribute(textInstanceIds, 1);
  // Three's common renderer uploads DynamicDrawUsage attributes on every
  // render. StreamDrawUsage still describes this mutable indirection buffer
  // to WebGL while letting the explicit `needsUpdate` calls control uploads.
  textInstanceIndexAttribute.setUsage(THREE.StreamDrawUsage);
  geometry.setAttribute("aTextInstanceIndex", textInstanceIndexAttribute);
  geometry.instanceCount = instanceCount;

  return geometry;
}

/**
 * Partial update ranges were added after the oldest supported three.js peer.
 * Older hosts still upload correctly through `needsUpdate`, just without the
 * smaller modern range hint.
 */
function markAttributeForUpdate(attribute: THREE.InstancedBufferAttribute, count: number): void {
  const ranged = attribute as THREE.InstancedBufferAttribute & {
    clearUpdateRanges?: () => void;
    addUpdateRange?: (start: number, count: number) => void;
  };
  if (typeof ranged.clearUpdateRanges === "function" && typeof ranged.addUpdateRange === "function") {
    ranged.clearUpdateRanges();
    ranged.addUpdateRange(0, count);
  }
  attribute.needsUpdate = true;
}

interface PageLayout {
  pageCount: number;
  pageRects: Float32Array;
  pageTextRanges: Uint32Array;
  sceneMinX: number;
  sceneMinY: number;
  sceneMaxX: number;
  sceneMaxY: number;
}

/**
 * Page rects paired with the instance range each page owns, so a frame can draw
 * only the pages it touches. Ranges must stay ordered, stay inside the instance
 * buffer, and account for every instance; a scene that fails any of those checks
 * returns `pageCount: 0`, which disables culling rather than risking lost glyphs.
 */
function resolvePageLayout(scene: VectorScene, textInstanceCount: number): PageLayout {
  const fallback: PageLayout = {
    pageCount: 0,
    pageRects: new Float32Array(0),
    pageTextRanges: new Uint32Array(0),
    sceneMinX: scene.bounds.minX,
    sceneMinY: scene.bounds.minY,
    sceneMaxX: scene.bounds.maxX,
    sceneMaxY: scene.bounds.maxY
  };

  if (textInstanceCount <= 0) {
    return fallback;
  }
  if (!(scene.pageRects instanceof Float32Array) || !(scene.pageTextRanges instanceof Uint32Array)) {
    return fallback;
  }

  const pageCount = Math.floor(scene.pageRects.length / 4);
  if (pageCount <= 0 || scene.pageTextRanges.length < pageCount * 2) {
    return fallback;
  }

  const pageRects = new Float32Array(pageCount * 4);
  const pageTextRanges = new Uint32Array(pageCount * 2);
  let sceneMinX = Number.POSITIVE_INFINITY;
  let sceneMinY = Number.POSITIVE_INFINITY;
  let sceneMaxX = Number.NEGATIVE_INFINITY;
  let sceneMaxY = Number.NEGATIVE_INFINITY;
  let coveredInstances = 0;
  let previousEnd = 0;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const rectOffset = pageIndex * 4;
    const x0 = scene.pageRects[rectOffset];
    const y0 = scene.pageRects[rectOffset + 1];
    const x1 = scene.pageRects[rectOffset + 2];
    const y1 = scene.pageRects[rectOffset + 3];
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
      return fallback;
    }

    const minX = Math.min(x0, x1);
    const minY = Math.min(y0, y1);
    const maxX = Math.max(x0, x1);
    const maxY = Math.max(y0, y1);
    pageRects[rectOffset] = minX;
    pageRects[rectOffset + 1] = minY;
    pageRects[rectOffset + 2] = maxX;
    pageRects[rectOffset + 3] = maxY;
    sceneMinX = Math.min(sceneMinX, minX);
    sceneMinY = Math.min(sceneMinY, minY);
    sceneMaxX = Math.max(sceneMaxX, maxX);
    sceneMaxY = Math.max(sceneMaxY, maxY);

    const rangeOffset = pageIndex * 2;
    const start = scene.pageTextRanges[rangeOffset];
    const count = scene.pageTextRanges[rangeOffset + 1];
    if (start < previousEnd || start > textInstanceCount || count > textInstanceCount - start) {
      return fallback;
    }

    pageTextRanges[rangeOffset] = start;
    pageTextRanges[rangeOffset + 1] = count;
    previousEnd = start + count;
    coveredInstances += count;
  }

  // A page set that does not account for every instance would silently drop
  // glyphs the moment culling engages, so keep drawing everything instead.
  if (coveredInstances !== textInstanceCount) {
    return fallback;
  }

  return {
    pageCount,
    pageRects,
    pageTextRanges,
    sceneMinX,
    sceneMinY,
    sceneMaxX,
    sceneMaxY
  };
}


function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.trunc(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
