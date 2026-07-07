import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

import {
  CORE_RASTER_FRAGMENT_SHADER_SOURCE,
  CORE_RASTER_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { VectorScene } from "./pdfVectorExtractor";
import {
  HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND,
  HEPR_THREE_LAYER_ORDER_RASTER
} from "./threeLayerOrder";
import { createThreeWebGpuRasterMaterial, type ThreeWebGpuRasterMaterialState } from "./threeWebGpuRasterMaterial";
import type { ViewState } from "./webGlFloorplanRenderer";

/** How page background rectangles are represented in the three.js scene. */
export type HeprPageBackgroundMode = "auto" | "mesh" | "instanced";

// Above this page count, "auto" switches from one mesh per page to a single
// instanced draw; hundreds of per-page meshes cost a draw call plus
// per-object updates each frame.
export const HEPR_PAGE_BACKGROUND_AUTO_MESH_MAX_PAGES = 200;

interface RasterLayerOptions {
  materialBackend?: "webgl" | "webgpu";
  pageBackground: [number, number, number, number];
  pageBackgroundMode?: HeprPageBackgroundMode;
  /** Scene center subtracted from data coordinates for object-local meshes. */
  sceneCenter?: [number, number];
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
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  material: THREE.Material;
  webGpuState?: ThreeWebGpuRasterMaterialState;
}

// Page backgrounds draw as ONE instanced quad mesh (a rect per page). A mesh
// per page — like the native texture-per-page approach would suggest — costs a
// draw call plus per-object uniform/bind-group updates per page per frame,
// which dominates frame CPU on documents with hundreds of pages (and hits the
// three.js WebGPU backend hardest).
const PAGE_BACKGROUND_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPageRect;

uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

void main() {
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 world = aPageRect.xy + aPageRect.zw * corner01;

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
}
`;

const PAGE_BACKGROUND_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 uPageColor;

out vec4 outColor;

void main() {
  if (uPageColor.a <= 0.001) {
    discard;
  }
  outColor = vec4(uPageColor.rgb * uPageColor.a, uPageColor.a);
}
`;

const pageBackgroundClipFn = TSL.wgslFn(`
fn heprPageBackgroundClip(
  corner: vec2<f32>,
  pageRect: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let world = pageRect.xy + pageRect.zw * corner01;

  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`);

// The straight sRGB page color premultiplies in sRGB space (matching the
// WebGL path and the native renderers), then decodes to linear so the node
// pipeline's output encode round-trips exactly, mirroring the tile layer.
const pageBackgroundColorFn = TSL.wgslFn(`
fn heprPageBackgroundColor(color: vec4<f32>) -> vec4<f32> {
  if (color.a <= 0.001) {
    discard;
  }
  let premultiplied = max(color.rgb * color.a, vec3<f32>(0.0));
  let lower = premultiplied / 12.92;
  let higher = pow((premultiplied + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  let linear = select(higher, lower, premultiplied <= vec3<f32>(0.04045));
  return vec4<f32>(linear, color.a);
}
`);

function callNode(fn: ReturnType<typeof TSL.wgslFn>, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

export class ThreeMaterialRasterLayer {
  readonly group: THREE.Group;

  private readonly geometry: THREE.BufferGeometry;
  private readonly materialBackend: "webgl" | "webgpu";
  private readonly entries: RasterLayerEntry[] = [];
  private readonly ownedTextures = new Set<THREE.Texture>();

  private readonly pageRects: Float32Array;
  private readonly pageCount: number;
  private readonly useMeshBackgrounds: boolean;
  private readonly sceneCenterX: number;
  private readonly sceneCenterY: number;
  private pageBackgroundMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material> | null = null;
  private pageRectAttribute: THREE.InstancedBufferAttribute | null = null;
  private readonly pageColorUniform: THREE.Vector4;
  private pageBackgroundWebGpuUniforms: {
    zoom: { value: number };
    useLocalToClip: { value: number };
  } | null = null;
  // Mesh-mode state: one user-visible mesh per page plus its resting local
  // position; appliedPageOffsets mirrors the offsets last pushed through
  // setPageOffset so externally moved meshes can be detected.
  private readonly pageBackgroundMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private pageMeshGeometry: THREE.BufferGeometry | null = null;
  private pageMeshMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly pageMeshBasePositions: Float32Array;
  private readonly appliedPageOffsets: Float32Array;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;

  constructor(scene: VectorScene, options: RasterLayerOptions) {
    this.materialBackend = options.materialBackend ?? "webgl";
    this.group = new THREE.Group();
    this.group.visible = false;

    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();

    this.geometry = createRasterGeometry();

    this.pageColorUniform = new THREE.Vector4(
      clamp01(options.pageBackground[0]),
      clamp01(options.pageBackground[1]),
      clamp01(options.pageBackground[2]),
      clamp01(options.pageBackground[3])
    );
    this.pageRects = normalizePageRects(scene);
    this.pageCount = Math.floor(this.pageRects.length / 4);
    this.sceneCenterX = options.sceneCenter?.[0] ?? 0;
    this.sceneCenterY = options.sceneCenter?.[1] ?? 0;
    this.pageMeshBasePositions = new Float32Array(Math.max(2, this.pageCount * 2));
    this.appliedPageOffsets = new Float32Array(Math.max(2, this.pageCount * 2));

    const mode = options.pageBackgroundMode ?? "auto";
    this.useMeshBackgrounds =
      mode === "mesh" || (mode === "auto" && this.pageCount <= HEPR_PAGE_BACKGROUND_AUTO_MESH_MAX_PAGES);
    if (this.useMeshBackgrounds) {
      this.createPageBackgroundMeshes();
    } else {
      this.pageBackgroundMesh = this.createPageBackgroundInstancedMesh();
      this.group.add(this.pageBackgroundMesh);
    }

    for (const source of getSceneRasterLayers(scene)) {
      const texture = createRasterTexture(source);
      this.ownedTextures.add(texture);
      const entry = this.createEntry(texture, source.matrix, HEPR_THREE_LAYER_ORDER_RASTER);
      this.entries.push(entry);
      this.group.add(entry.mesh);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void {
    this.pageColorUniform.set(clamp01(red), clamp01(green), clamp01(blue), clamp01(alpha));
    if (this.pageMeshMaterial) {
      this.pageMeshMaterial.color.setRGB(clamp01(red), clamp01(green), clamp01(blue), THREE.SRGBColorSpace);
      const alphaClamped = clamp01(alpha);
      this.pageMeshMaterial.opacity = alphaClamped;
      this.pageMeshMaterial.transparent = alphaClamped < 1;
    }
  }

  /** One three.js mesh per page in mesh mode, or null when instanced. */
  getPageBackgroundMesh(pageIndex: number): THREE.Mesh | null {
    return this.pageBackgroundMeshes[pageIndex] ?? null;
  }

  // Applies a page offset to the background representation: mesh mode moves
  // the page mesh, instanced mode patches that page's rect attribute entry.
  setPageOffset(pageIndex: number, offsetX: number, offsetY: number): void {
    if (pageIndex < 0 || pageIndex >= this.pageCount) {
      return;
    }
    this.appliedPageOffsets[pageIndex * 2] = offsetX;
    this.appliedPageOffsets[pageIndex * 2 + 1] = offsetY;

    const mesh = this.pageBackgroundMeshes[pageIndex];
    if (mesh) {
      mesh.position.set(
        this.pageMeshBasePositions[pageIndex * 2] + offsetX,
        this.pageMeshBasePositions[pageIndex * 2 + 1] + offsetY,
        mesh.position.z
      );
      return;
    }

    if (this.pageRectAttribute) {
      const rectOffset = pageIndex * 4;
      const minX = Math.min(this.pageRects[rectOffset], this.pageRects[rectOffset + 2]);
      const minY = Math.min(this.pageRects[rectOffset + 1], this.pageRects[rectOffset + 3]);
      const array = this.pageRectAttribute.array as Float32Array;
      array[rectOffset] = minX + offsetX;
      array[rectOffset + 1] = minY + offsetY;
      this.pageRectAttribute.addUpdateRange(rectOffset, 4);
      this.pageRectAttribute.needsUpdate = true;
    }
  }

  // Detects page meshes the application moved directly (mesh mode only) and
  // reports their offsets so the rest of the page content can follow.
  collectMeshDrivenOffsetChanges(onOffsetChanged: (pageIndex: number, offsetX: number, offsetY: number) => void): void {
    for (let pageIndex = 0; pageIndex < this.pageBackgroundMeshes.length; pageIndex += 1) {
      const mesh = this.pageBackgroundMeshes[pageIndex];
      const offsetX = mesh.position.x - this.pageMeshBasePositions[pageIndex * 2];
      const offsetY = mesh.position.y - this.pageMeshBasePositions[pageIndex * 2 + 1];
      if (
        Math.abs(offsetX - this.appliedPageOffsets[pageIndex * 2]) > 1e-6 ||
        Math.abs(offsetY - this.appliedPageOffsets[pageIndex * 2 + 1]) > 1e-6
      ) {
        this.appliedPageOffsets[pageIndex * 2] = offsetX;
        this.appliedPageOffsets[pageIndex * 2 + 1] = offsetY;
        onOffsetChanged(pageIndex, offsetX, offsetY);
      }
    }
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    if (this.pageBackgroundWebGpuUniforms) {
      this.pageBackgroundWebGpuUniforms.zoom.value = this.zoomUniform.value;
    }
    for (const entry of this.entries) {
      if (entry.webGpuState) {
        entry.webGpuState.zoomUniform.value = this.zoomUniform.value;
      }
    }
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClipUniform.value = 0;
    if (this.pageBackgroundWebGpuUniforms) {
      this.pageBackgroundWebGpuUniforms.useLocalToClip.value = 0;
    }
    for (const entry of this.entries) {
      if (entry.webGpuState) {
        entry.webGpuState.useLocalToClipUniform.value = 0;
      }
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4): void {
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    if (this.pageBackgroundWebGpuUniforms) {
      this.pageBackgroundWebGpuUniforms.useLocalToClip.value = 1;
    }
    for (const entry of this.entries) {
      if (entry.webGpuState) {
        entry.webGpuState.useLocalToClipUniform.value = 1;
      }
    }
  }

  dispose(): void {
    for (const entry of this.entries) {
      this.group.remove(entry.mesh);
      entry.material.dispose();
    }
    this.entries.length = 0;

    if (this.pageBackgroundMesh) {
      this.group.remove(this.pageBackgroundMesh);
      this.pageBackgroundMesh.geometry.dispose();
      this.pageBackgroundMesh.material.dispose();
      this.pageBackgroundMesh = null;
    }
    for (const mesh of this.pageBackgroundMeshes) {
      this.group.remove(mesh);
    }
    this.pageBackgroundMeshes.length = 0;
    this.pageMeshGeometry?.dispose();
    this.pageMeshGeometry = null;
    this.pageMeshMaterial?.dispose();
    this.pageMeshMaterial = null;

    this.geometry.dispose();

    for (const texture of this.ownedTextures) {
      texture.dispose();
    }
    this.ownedTextures.clear();
  }

  // Mesh mode: one plain, user-manipulable THREE.Mesh per page. Positions live
  // in the pdf object's local space (data coordinates minus scene center), so
  // three's regular camera pipeline lands them exactly where the HEPR layers
  // draw the page content.
  private createPageBackgroundMeshes(): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3)
    );
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    geometry.computeBoundingSphere();
    this.pageMeshGeometry = geometry;

    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
      depthTest: false,
      depthWrite: false
    });
    material.color.setRGB(
      this.pageColorUniform.x,
      this.pageColorUniform.y,
      this.pageColorUniform.z,
      THREE.SRGBColorSpace
    );
    material.opacity = this.pageColorUniform.w;
    material.transparent = this.pageColorUniform.w < 1;
    this.pageMeshMaterial = material;

    for (let pageIndex = 0; pageIndex < this.pageCount; pageIndex += 1) {
      const rectOffset = pageIndex * 4;
      const minX = Math.min(this.pageRects[rectOffset], this.pageRects[rectOffset + 2]);
      const minY = Math.min(this.pageRects[rectOffset + 1], this.pageRects[rectOffset + 3]);
      const maxX = Math.max(this.pageRects[rectOffset], this.pageRects[rectOffset + 2]);
      const maxY = Math.max(this.pageRects[rectOffset + 1], this.pageRects[rectOffset + 3]);
      const baseX = minX - this.sceneCenterX;
      const baseY = minY - this.sceneCenterY;
      this.pageMeshBasePositions[pageIndex * 2] = baseX;
      this.pageMeshBasePositions[pageIndex * 2 + 1] = baseY;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `hepr-page-background-${pageIndex}`;
      mesh.position.set(baseX, baseY, 0);
      mesh.scale.set(Math.max(maxX - minX, 1e-6), Math.max(maxY - minY, 1e-6), 1);
      mesh.renderOrder = HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND;
      this.pageBackgroundMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private createPageBackgroundInstancedMesh(): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material> {
    const pageCount = this.pageCount;
    const rects = new Float32Array(Math.max(4, pageCount * 4));
    for (let i = 0; i < pageCount; i += 1) {
      const offset = i * 4;
      const minX = Math.min(this.pageRects[offset], this.pageRects[offset + 2]);
      const minY = Math.min(this.pageRects[offset + 1], this.pageRects[offset + 3]);
      const maxX = Math.max(this.pageRects[offset], this.pageRects[offset + 2]);
      const maxY = Math.max(this.pageRects[offset + 1], this.pageRects[offset + 3]);
      rects[offset] = minX;
      rects[offset + 1] = minY;
      rects[offset + 2] = Math.max(maxX - minX, 1e-6);
      rects[offset + 3] = Math.max(maxY - minY, 1e-6);
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "aCorner",
      new THREE.Float32BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2)
    );
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    const rectAttribute = new THREE.InstancedBufferAttribute(rects, 4);
    rectAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aPageRect", rectAttribute);
    geometry.instanceCount = pageCount;
    this.pageRectAttribute = rectAttribute;

    let material: THREE.Material;
    if (this.materialBackend === "webgpu") {
      material = this.createWebGpuPageBackgroundMaterial();
    } else {
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: normalizeCoreShaderSource(PAGE_BACKGROUND_VERTEX_SHADER_SOURCE),
        fragmentShader: normalizeCoreShaderSource(PAGE_BACKGROUND_FRAGMENT_SHADER_SOURCE),
        transparent: false,
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
          uPageColor: { value: this.pageColorUniform },
          uViewport: { value: this.viewportUniform },
          uCameraCenter: { value: this.cameraCenterUniform },
          uZoom: this.zoomUniform,
          uUseLocalToClip: this.useLocalToClipUniform,
          uLocalToClip: { value: this.localToClipUniform }
        }
      });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND;
    return mesh;
  }

  private createWebGpuPageBackgroundMaterial(): THREE.Material {
    const material = new NodeMaterial();
    material.transparent = false;
    material.depthTest = false;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.toneMapped = false;
    material.fog = false;
    material.lights = false;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

    const zoomUniform = TSL.uniform(1);
    const useLocalToClipUniform = TSL.uniform(0);

    material.vertexNode = callNode(pageBackgroundClipFn, {
      corner: TSL.attribute("aCorner", "vec2"),
      pageRect: TSL.attribute("aPageRect", "vec4"),
      viewport: TSL.uniform(this.viewportUniform),
      cameraCenter: TSL.uniform(this.cameraCenterUniform),
      zoom: zoomUniform,
      useLocalToClip: useLocalToClipUniform,
      localToClip: TSL.uniform(this.localToClipUniform)
    });
    material.fragmentNode = callNode(pageBackgroundColorFn, {
      color: TSL.uniform(this.pageColorUniform)
    });

    this.pageBackgroundWebGpuUniforms = {
      zoom: zoomUniform as { value: number },
      useLocalToClip: useLocalToClipUniform as { value: number }
    };
    return material;
  }

  private createEntry(
    texture: THREE.Texture,
    matrixSource: Float32Array,
    renderOrder: number
  ): RasterLayerEntry {
    const matrix = normalizeRasterMatrix(matrixSource);

    if (this.materialBackend === "webgpu") {
      const state = createThreeWebGpuRasterMaterial({
        texture,
        matrixABCD: new THREE.Vector4(matrix[0], matrix[1], matrix[2], matrix[3]),
        matrixEF: new THREE.Vector2(matrix[4], matrix[5]),
        viewport: this.viewportUniform,
        cameraCenter: this.cameraCenterUniform,
        localToClip: this.localToClipUniform
      });
      state.zoomUniform.value = this.zoomUniform.value;
      state.useLocalToClipUniform.value = this.useLocalToClipUniform.value;

      const mesh = new THREE.Mesh(this.geometry, state.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      return { mesh, material: state.material, webGpuState: state };
    }

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeCoreShaderSource(CORE_RASTER_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeCoreShaderSource(CORE_RASTER_FRAGMENT_SHADER_SOURCE),
      transparent: false,
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
        uZoom: this.zoomUniform,
        uUseLocalToClip: this.useLocalToClipUniform,
        uLocalToClip: { value: this.localToClipUniform }
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
