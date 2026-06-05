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
  private readonly forceVectorTextOnly: boolean;
  private webGpuState: ThreeWebGpuTextMaterialState | null = null;

  constructor(scene: VectorScene, options: TextLayerOptions) {
    const materialBackend = options.materialBackend ?? "webgl";
    this.forceVectorTextOnly = true;
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
    const rasterAtlas = this.forceVectorTextOnly
      ? null
      : buildTextRasterAtlas(
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
    this.vectorOnlyUniform = { value: this.resolveTextVectorOnlyValue(options.textVectorOnly) };
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
        textGlyphSegmentTextureA: this.textGlyphSegmentTextureA,
        textGlyphSegmentTextureB: this.textGlyphSegmentTextureB,
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
    this.vectorOnlyUniform.value = this.resolveTextVectorOnlyValue(enabled);
    if (this.webGpuState) {
      this.webGpuState.vectorOnlyUniform.value = this.vectorOnlyUniform.value;
    }
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
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

  updateFrame(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    if (this.webGpuState) {
      this.webGpuState.zoomUniform.value = this.zoomUniform.value;
    }
  }

  private resolveTextVectorOnlyValue(enabled: boolean): number {
    return enabled || this.forceVectorTextOnly ? 1 : 0;
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
