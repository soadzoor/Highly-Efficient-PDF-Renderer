import * as THREE from "three";

import {
  CORE_RASTER_FRAGMENT_SHADER_SOURCE,
  CORE_RASTER_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { VectorScene } from "./pdfVectorExtractor";
import type { ViewState } from "./webGlFloorplanRenderer";

interface RasterLayerOptions {
  pageBackground: [number, number, number, number];
}

interface ViewportPixels {
  width: number;
  height: number;
}

interface RasterLayerSource {
  width: number;
  height: number;
  data: Uint8Array<ArrayBufferLike>;
  matrix: Float32Array;
}

interface RasterLayerEntry {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.RawShaderMaterial>;
  material: THREE.RawShaderMaterial;
}

export class ThreeMaterialRasterLayer {
  readonly group: THREE.Group;

  private readonly geometry: THREE.BufferGeometry;
  private readonly pageBackgroundTexture: THREE.DataTexture;
  private readonly entries: RasterLayerEntry[] = [];
  private readonly ownedTextures = new Set<THREE.Texture>();

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };

  constructor(scene: VectorScene, options: RasterLayerOptions) {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };

    this.geometry = createRasterGeometry();

    this.pageBackgroundTexture = createPageBackgroundTexture(options.pageBackground);
    this.ownedTextures.add(this.pageBackgroundTexture);

    const pageRects = normalizePageRects(scene);
    for (let i = 0; i + 3 < pageRects.length; i += 4) {
      const minX = pageRects[i];
      const minY = pageRects[i + 1];
      const maxX = pageRects[i + 2];
      const maxY = pageRects[i + 3];
      const width = Math.max(maxX - minX, 1e-6);
      const height = Math.max(maxY - minY, 1e-6);
      const matrix = new Float32Array([width, 0, 0, height, minX, minY]);
      const entry = this.createEntry(this.pageBackgroundTexture, matrix, -20);
      this.entries.push(entry);
      this.group.add(entry.mesh);
    }

    for (const source of getSceneRasterLayers(scene)) {
      const texture = createRasterTexture(source);
      this.ownedTextures.add(texture);
      const entry = this.createEntry(texture, source.matrix, -10);
      this.entries.push(entry);
      this.group.add(entry.mesh);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void {
    const image = this.pageBackgroundTexture.image as { data?: Uint8Array };
    const data = image?.data;
    if (!data || data.length < 4) {
      return;
    }

    const rgba = premultiplyRgbaPixel(
      Math.round(clamp01(red) * 255),
      Math.round(clamp01(green) * 255),
      Math.round(clamp01(blue) * 255),
      Math.round(clamp01(alpha) * 255)
    );

    data[0] = rgba[0];
    data[1] = rgba[1];
    data[2] = rgba[2];
    data[3] = rgba[3];
    this.pageBackgroundTexture.needsUpdate = true;
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
  }

  dispose(): void {
    for (const entry of this.entries) {
      this.group.remove(entry.mesh);
      entry.material.dispose();
    }
    this.entries.length = 0;

    this.geometry.dispose();

    for (const texture of this.ownedTextures) {
      texture.dispose();
    }
    this.ownedTextures.clear();
  }

  private createEntry(
    texture: THREE.Texture,
    matrixSource: Float32Array,
    renderOrder: number
  ): RasterLayerEntry {
    const matrix = normalizeRasterMatrix(matrixSource);

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeCoreShaderSource(CORE_RASTER_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeCoreShaderSource(CORE_RASTER_FRAGMENT_SHADER_SOURCE),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uRasterTex: { value: texture },
        uRasterMatrixABCD: { value: new THREE.Vector4(matrix[0], matrix[1], matrix[2], matrix[3]) },
        uRasterMatrixEF: { value: new THREE.Vector2(matrix[4], matrix[5]) },
        uViewport: { value: this.viewportUniform },
        uCameraCenter: { value: this.cameraCenterUniform },
        uZoom: this.zoomUniform
      }
    });

    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;

    return { mesh, material };
  }
}

function createRasterGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
}

function createPageBackgroundTexture(color: [number, number, number, number]): THREE.DataTexture {
  const rgba = premultiplyRgbaPixel(
    Math.round(clamp01(color[0]) * 255),
    Math.round(clamp01(color[1]) * 255),
    Math.round(clamp01(color[2]) * 255),
    Math.round(clamp01(color[3]) * 255)
  );
  const data = new Uint8Array(rgba);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createRasterTexture(source: RasterLayerSource): THREE.DataTexture {
  const pixelCount = source.width * source.height * 4;
  const pixels = source.data.subarray(0, pixelCount);
  const premultiplied = premultiplyRgba(pixels);
  const texture = new THREE.DataTexture(
    premultiplied,
    Math.max(1, source.width),
    Math.max(1, source.height),
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function getSceneRasterLayers(scene: VectorScene): RasterLayerSource[] {
  const out: RasterLayerSource[] = [];

  if (Array.isArray(scene.rasterLayers)) {
    for (const layer of scene.rasterLayers) {
      const width = Math.max(0, Math.trunc(layer?.width ?? 0));
      const height = Math.max(0, Math.trunc(layer?.height ?? 0));
      if (width <= 0 || height <= 0 || !(layer?.data instanceof Uint8Array) || layer.data.length < width * height * 4) {
        continue;
      }
      out.push({
        width,
        height,
        data: layer.data,
        matrix: layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix)
      });
    }
  }

  if (out.length > 0) {
    return out;
  }

  const legacyWidth = Math.max(0, Math.trunc(scene.rasterLayerWidth));
  const legacyHeight = Math.max(0, Math.trunc(scene.rasterLayerHeight));
  if (legacyWidth <= 0 || legacyHeight <= 0 || scene.rasterLayerData.length < legacyWidth * legacyHeight * 4) {
    return out;
  }

  out.push({
    width: legacyWidth,
    height: legacyHeight,
    data: scene.rasterLayerData,
    matrix: scene.rasterLayerMatrix
  });

  return out;
}

function normalizePageRects(scene: VectorScene): Float32Array {
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

function normalizeRasterMatrix(matrix: Float32Array): [number, number, number, number, number, number] {
  return [
    readFinite(matrix[0], 1),
    readFinite(matrix[1], 0),
    readFinite(matrix[2], 0),
    readFinite(matrix[3], 1),
    readFinite(matrix[4], 0),
    readFinite(matrix[5], 0)
  ];
}

function readFinite(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function premultiplyRgba(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let i = 0; i + 3 < source.length; i += 4) {
    const premultiplied = premultiplyRgbaPixel(source[i], source[i + 1], source[i + 2], source[i + 3]);
    out[i] = premultiplied[0];
    out[i + 1] = premultiplied[1];
    out[i + 2] = premultiplied[2];
    out[i + 3] = premultiplied[3];
  }
  return out;
}

function premultiplyRgbaPixel(red: number, green: number, blue: number, alpha: number): [number, number, number, number] {
  const a = clampByte(alpha);
  if (a <= 0) {
    return [0, 0, 0, 0];
  }
  if (a >= 255) {
    return [clampByte(red), clampByte(green), clampByte(blue), 255];
  }
  const scale = a / 255;
  return [
    Math.round(clampByte(red) * scale),
    Math.round(clampByte(green) * scale),
    Math.round(clampByte(blue) * scale),
    a
  ];
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 255) {
    return 255;
  }
  return Math.round(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function normalizeCoreShaderSource(source: string): string {
  return source.replace(/^\s*#version\s+300\s+es\s*/m, "");
}
