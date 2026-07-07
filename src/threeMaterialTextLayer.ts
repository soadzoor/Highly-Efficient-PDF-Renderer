import * as THREE from "three";

import {
  CORE_TEXT_FRAGMENT_SHADER_SOURCE,
  CORE_TEXT_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { buildTextRasterAtlas } from "./textRasterAtlas";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { HEPR_THREE_LAYER_ORDER_TEXT } from "./threeLayerOrder";
import {
  normalizeThreeRawShaderSource,
  normalizeThreeTextRawFragmentShaderSource
} from "./threeRawShaderColorSpace";
import { createThreeWebGpuTextMaterial, type ThreeWebGpuTextMaterialState } from "./threeWebGpuTextMaterial";
import type { ViewState } from "./webGlFloorplanRenderer";

interface TextLayerOptions {
  materialBackend?: "webgl" | "webgpu";
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
  vectorOverride: [number, number, number, number];
  maxRasterAtlasTextureSize?: number;
}

interface ViewportPixels {
  width: number;
  height: number;
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
  private readonly instanceStartUniform: { value: number };
  private readonly pageMaskEnabledUniform: { value: number };
  private readonly pageModeTexture: THREE.DataTexture;
  private readonly pageModeData: Uint8Array;
  private readonly textInstanceCount: number;
  private readonly pageRects: Float32Array;
  private readonly pageTextRanges: Uint32Array;
  private explicitInstanceWindow: { start: number; count: number } | null = null;
  private webGpuState: ThreeWebGpuTextMaterialState | null = null;

  constructor(scene: VectorScene, options: TextLayerOptions) {
    const materialBackend = options.materialBackend ?? "webgl";
    this.textInstanceCount = Math.max(0, scene.textInstanceCount | 0);
    this.pageRects = normalizeLayerPageRects(scene);
    this.pageTextRanges = normalizeLayerPageTextRanges(scene, this.pageRects, this.textInstanceCount);
    this.instanceStartUniform = { value: 0 };
    this.pageMaskEnabledUniform = { value: 0 };

    const pageCount = Math.max(1, Math.floor(this.pageRects.length / 4));
    const pageModeTextureSize = chooseTextureSize(pageCount);
    this.pageModeData = new Uint8Array(pageModeTextureSize.width * pageModeTextureSize.height);
    this.pageModeTexture = new THREE.DataTexture(
      this.pageModeData,
      pageModeTextureSize.width,
      pageModeTextureSize.height,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    this.pageModeTexture.magFilter = THREE.NearestFilter;
    this.pageModeTexture.minFilter = THREE.NearestFilter;
    this.pageModeTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.pageModeTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.pageModeTexture.flipY = false;
    this.pageModeTexture.generateMipmaps = false;
    this.pageModeTexture.unpackAlignment = 1;
    this.pageModeTexture.needsUpdate = true;

    const textInstanceCount = this.textInstanceCount;
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
      stampPageIndexIntoInstanceB(scene.textInstanceB, this.pageTextRanges, textInstanceCount),
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

    // The mipmapped glyph raster atlas keeps minified text cheap, matching the
    // native renderers; both material backends sample it.
    const rasterMetaData = new Float32Array(glyphMetaTextureSize.width * glyphMetaTextureSize.height * 4);
    const rasterAtlas = buildTextRasterAtlas(
      scene,
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

    const geometry = createTextGeometry(textInstanceCount);
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
        textInstanceTextureA: this.textInstanceTextureA,
        textInstanceTextureB: this.textInstanceTextureB,
        textInstanceTextureC: this.textInstanceTextureC,
        textGlyphMetaTextureA: this.textGlyphMetaTextureA,
        textGlyphMetaTextureB: this.textGlyphMetaTextureB,
        textGlyphRasterMetaTexture: this.textGlyphRasterMetaTexture,
        textGlyphSegmentTextureA: this.textGlyphSegmentTextureA,
        textGlyphSegmentTextureB: this.textGlyphSegmentTextureB,
        textRasterAtlasTexture: this.textRasterAtlasTexture,
        textPageModeTexture: this.pageModeTexture,
        textPageModeTextureWidth: this.pageModeTexture.image.width,
        rasterAtlasSize: this.rasterAtlasSizeUniform,
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
          uVectorOverride: { value: this.vectorOverrideUniform },
          uTextInstanceStart: this.instanceStartUniform,
          uTextPageMaskEnabled: this.pageMaskEnabledUniform,
          uTextPageModeTex: { value: this.pageModeTexture },
          uTextPageModeTexSize: {
            value: new Int32Array([this.pageModeTexture.image.width, this.pageModeTexture.image.height])
          }
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

  // Overrides the bounds-derived instance window (pass null to restore it).
  setInstanceWindow(start: number, count: number): void {
    this.explicitInstanceWindow = { start, count };
  }

  clearInstanceWindow(): void {
    this.explicitInstanceWindow = null;
  }

  // Per-page mask: pages flagged 1 collapse their glyphs so baked tiles can be
  // drawn for them instead. Pass null to disable masking entirely.
  setPageTileMask(tiledFlags: Uint8Array | null): void {
    if (!tiledFlags) {
      if (this.pageMaskEnabledUniform.value !== 0) {
        this.pageMaskEnabledUniform.value = 0;
        if (this.webGpuState) {
          this.webGpuState.pageMaskEnabledUniform.value = 0;
        }
      }
      return;
    }

    const copyLength = Math.min(tiledFlags.length, this.pageModeData.length);
    this.pageModeData.fill(0);
    for (let i = 0; i < copyLength; i += 1) {
      this.pageModeData[i] = tiledFlags[i] ? 255 : 0;
    }
    this.pageModeTexture.needsUpdate = true;
    this.pageMaskEnabledUniform.value = 1;
    if (this.webGpuState) {
      this.webGpuState.pageMaskEnabledUniform.value = 1;
    }
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClipUniform.value = 0;
    if (this.webGpuState) {
      this.webGpuState.useLocalToClipUniform.value = 0;
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4): void {
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    if (this.webGpuState) {
      this.webGpuState.useLocalToClipUniform.value = 1;
    }
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds: Bounds | null = null): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    if (this.webGpuState) {
      this.webGpuState.zoomUniform.value = this.zoomUniform.value;
    }
    this.applyInstanceWindow(cullingBounds);
  }

  // Restricts the instanced draw to an explicit range (page tile orchestration)
  // or, by default, the contiguous range covering pages that intersect the
  // culling bounds; draws everything without either.
  private applyInstanceWindow(cullingBounds: Bounds | null): void {
    if (this.explicitInstanceWindow) {
      const start = clampInt(this.explicitInstanceWindow.start, 0, this.textInstanceCount);
      const count = clampInt(this.explicitInstanceWindow.count, 0, this.textInstanceCount - start);
      this.instanceStartUniform.value = start;
      if (this.webGpuState) {
        this.webGpuState.instanceStartUniform.value = start;
      }
      this.mesh.geometry.instanceCount = count;
      return;
    }

    let windowStart = 0;
    let windowEnd = this.textInstanceCount;

    const pageCount = Math.floor(this.pageRects.length / 4);
    if (cullingBounds && pageCount > 0 && this.pageTextRanges.length >= pageCount * 2) {
      windowStart = this.textInstanceCount;
      windowEnd = 0;
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const rectOffset = pageIndex * 4;
        const minX = Math.min(this.pageRects[rectOffset], this.pageRects[rectOffset + 2]);
        const minY = Math.min(this.pageRects[rectOffset + 1], this.pageRects[rectOffset + 3]);
        const maxX = Math.max(this.pageRects[rectOffset], this.pageRects[rectOffset + 2]);
        const maxY = Math.max(this.pageRects[rectOffset + 1], this.pageRects[rectOffset + 3]);
        if (
          maxX < cullingBounds.minX ||
          minX > cullingBounds.maxX ||
          maxY < cullingBounds.minY ||
          minY > cullingBounds.maxY
        ) {
          continue;
        }

        const rangeOffset = pageIndex * 2;
        const rangeStart = this.pageTextRanges[rangeOffset] ?? 0;
        const rangeCount = this.pageTextRanges[rangeOffset + 1] ?? 0;
        if (rangeCount <= 0) {
          continue;
        }
        windowStart = Math.min(windowStart, rangeStart);
        windowEnd = Math.max(windowEnd, rangeStart + rangeCount);
      }
      if (windowEnd <= windowStart) {
        windowStart = 0;
        windowEnd = 0;
      }
    }

    this.instanceStartUniform.value = windowStart;
    if (this.webGpuState) {
      this.webGpuState.instanceStartUniform.value = windowStart;
    }
    this.mesh.geometry.instanceCount = Math.max(0, windowEnd - windowStart);
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
    this.pageModeTexture.dispose();
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

function createTextGeometry(textInstanceCount: number): THREE.InstancedBufferGeometry {
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
  const textInstanceIds = new Float32Array(Math.max(1, instanceCount));
  for (let i = 0; i < instanceCount; i += 1) {
    textInstanceIds[i] = i;
  }
  geometry.setAttribute("aTextInstanceIndex", new THREE.InstancedBufferAttribute(textInstanceIds, 1));
  geometry.instanceCount = instanceCount;

  return geometry;
}


// The .w channel of instance texture B is unused by the shaders, so the three
// layer stores each glyph's page index there for the per-page tile mask.
function stampPageIndexIntoInstanceB(
  source: Float32Array,
  pageTextRanges: Uint32Array,
  textInstanceCount: number
): Float32Array {
  const out = new Float32Array(Math.min(source.length, textInstanceCount * 4));
  out.set(source.subarray(0, out.length));
  const pageCount = Math.floor(pageTextRanges.length / 2);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const start = pageTextRanges[pageIndex * 2];
    const count = pageTextRanges[pageIndex * 2 + 1];
    for (let i = 0; i < count; i += 1) {
      const offset = (start + i) * 4 + 3;
      if (offset < out.length) {
        out[offset] = pageIndex;
      }
    }
  }
  return out;
}

function normalizeLayerPageRects(scene: VectorScene): Float32Array {
  if (scene.pageRects instanceof Float32Array && scene.pageRects.length >= 4) {
    return new Float32Array(scene.pageRects);
  }

  return new Float32Array([
    scene.pageBounds.minX,
    scene.pageBounds.minY,
    scene.pageBounds.maxX,
    scene.pageBounds.maxY
  ]);
}

function normalizeLayerPageTextRanges(
  scene: VectorScene,
  pageRects: Float32Array,
  textInstanceCount: number
): Uint32Array {
  const pageCount = Math.max(1, Math.floor(pageRects.length / 4));
  const expectedLength = pageCount * 2;
  const maxTextInstanceCount = Math.max(0, textInstanceCount | 0);

  if (scene.pageTextRanges instanceof Uint32Array && scene.pageTextRanges.length >= expectedLength) {
    const out = new Uint32Array(expectedLength);
    let previousEnd = 0;
    for (let i = 0; i < pageCount; i += 1) {
      const offset = i * 2;
      const start = clampNumber(Math.trunc(scene.pageTextRanges[offset]), previousEnd, maxTextInstanceCount);
      const count = clampNumber(Math.trunc(scene.pageTextRanges[offset + 1]), 0, maxTextInstanceCount - start);
      out[offset] = start;
      out[offset + 1] = count;
      previousEnd = start + count;
    }
    return out;
  }

  const out = new Uint32Array(expectedLength);
  out[0] = 0;
  out[1] = maxTextInstanceCount;
  for (let i = 1; i < pageCount; i += 1) {
    const offset = i * 2;
    out[offset] = maxTextInstanceCount;
    out[offset + 1] = 0;
  }
  return out;
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
