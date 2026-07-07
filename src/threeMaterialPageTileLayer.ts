import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

import { configurePremultipliedAlphaBlending } from "./threeMaterialBlending";
import { HEPR_THREE_LAYER_ORDER_TEXT } from "./threeLayerOrder";
import { normalizeThreeRawShaderSource } from "./threeRawShaderColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";

interface PageTileLayerOptions {
  materialBackend?: "webgl" | "webgpu";
  atlasWidth: number;
  atlasHeight: number;
  maxTileCount: number;
}

interface ViewportPixels {
  width: number;
  height: number;
}

// Tiles hold premultiplied text baked in the shared output color space, so the
// fragment shader passes texels through and the material composites with
// (ONE, ONE_MINUS_SRC_ALPHA), mirroring the native renderers' tile draw.
const PAGE_TILE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPageWorldRect;
layout(location = 2) in vec4 aPageUvRect;

uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

out vec2 vUv;

void main() {
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 world = mix(aPageWorldRect.xy, aPageWorldRect.zw, corner01);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
  vUv = mix(aPageUvRect.xy, aPageUvRect.zw, corner01);
}
`;

const PAGE_TILE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPageTileAtlasTex;

in vec2 vUv;
out vec4 outColor;

void main() {
  outColor = texture(uPageTileAtlasTex, vUv);
}
`;

const pageTileClipFn = TSL.wgslFn(`
fn heprPageTileClipPosition(
  corner: vec2<f32>,
  worldRect: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let world = worldRect.xy + (worldRect.zw - worldRect.xy) * corner01;

  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`);

const pageTileUvFn = TSL.wgslFn(`
fn heprPageTileUv(corner: vec2<f32>, uvRect: vec4<f32>) -> vec2<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  return uvRect.xy + (uvRect.zw - uvRect.xy) * corner01;
}
`);

// Tile texels are already sRGB-encoded premultiplied output-space values; the
// node pipeline re-encodes fragment output, so decode here to round-trip exactly.
const pageTileDecodeFn = TSL.wgslFn(`
fn heprPageTileDecode(texel: vec4<f32>) -> vec4<f32> {
  let c = max(texel.rgb, vec3<f32>(0.0));
  let lower = c / 12.92;
  let higher = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  let linear = select(higher, lower, c <= vec3<f32>(0.04045));
  return vec4<f32>(linear, texel.a);
}
`);

function callNode(fn: ReturnType<typeof TSL.wgslFn>, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

export class ThreeMaterialPageTileLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly atlasData: Uint8Array;

  private readonly atlasTexture: THREE.DataTexture;
  private readonly worldRectAttribute: THREE.InstancedBufferAttribute;
  private readonly uvRectAttribute: THREE.InstancedBufferAttribute;
  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;
  private webGpuUniforms: {
    zoom: { value: number };
    useLocalToClip: { value: number };
  } | null = null;

  constructor(options: PageTileLayerOptions) {
    const materialBackend = options.materialBackend ?? "webgl";
    this.atlasWidth = Math.max(64, options.atlasWidth | 0);
    this.atlasHeight = Math.max(64, options.atlasHeight | 0);
    this.atlasData = new Uint8Array(this.atlasWidth * this.atlasHeight * 4);

    this.atlasTexture = new THREE.DataTexture(
      this.atlasData,
      this.atlasWidth,
      this.atlasHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.atlasTexture.magFilter = THREE.LinearFilter;
    this.atlasTexture.minFilter = THREE.LinearFilter;
    this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.atlasTexture.flipY = false;
    this.atlasTexture.generateMipmaps = false;
    this.atlasTexture.needsUpdate = true;

    const maxTileCount = Math.max(1, options.maxTileCount | 0);
    const geometry = new THREE.InstancedBufferGeometry();
    const corners = new Float32Array([
      -1, -1,
      1, -1,
      1, 1,
      -1, 1
    ]);
    geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    this.worldRectAttribute = new THREE.InstancedBufferAttribute(new Float32Array(maxTileCount * 4), 4);
    this.worldRectAttribute.setUsage(THREE.DynamicDrawUsage);
    this.uvRectAttribute = new THREE.InstancedBufferAttribute(new Float32Array(maxTileCount * 4), 4);
    this.uvRectAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aPageWorldRect", this.worldRectAttribute);
    geometry.setAttribute("aPageUvRect", this.uvRectAttribute);
    geometry.instanceCount = 0;

    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();

    let material: THREE.Material;
    if (materialBackend === "webgpu") {
      material = this.createWebGpuMaterial();
    } else {
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: normalizeThreeRawShaderSource(PAGE_TILE_VERTEX_SHADER_SOURCE),
        fragmentShader: normalizeThreeRawShaderSource(PAGE_TILE_FRAGMENT_SHADER_SOURCE),
        transparent: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uPageTileAtlasTex: { value: this.atlasTexture },
          uViewport: { value: this.viewportUniform },
          uCameraCenter: { value: this.cameraCenterUniform },
          uZoom: this.zoomUniform,
          uUseLocalToClip: this.useLocalToClipUniform,
          uLocalToClip: { value: this.localToClipUniform }
        }
      });
    }
    configurePremultipliedAlphaBlending(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_TEXT;
    this.mesh.visible = false;
  }

  private createWebGpuMaterial(): THREE.Material {
    const material = new NodeMaterial();
    material.transparent = false;
    material.depthTest = false;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.toneMapped = false;
    material.fog = false;
    material.lights = false;

    const zoomUniform = TSL.uniform(1);
    const useLocalToClipUniform = TSL.uniform(0);
    const corner = TSL.attribute("aCorner", "vec2");
    const worldRect = TSL.attribute("aPageWorldRect", "vec4");
    const uvRect = TSL.attribute("aPageUvRect", "vec4");

    material.vertexNode = callNode(pageTileClipFn, {
      corner,
      worldRect,
      viewport: TSL.uniform(this.viewportUniform),
      cameraCenter: TSL.uniform(this.cameraCenterUniform),
      zoom: zoomUniform,
      useLocalToClip: useLocalToClipUniform,
      localToClip: TSL.uniform(this.localToClipUniform)
    });

    const uv = TSL.varying(callNode(pageTileUvFn, { corner, uvRect }));
    material.fragmentNode = callNode(pageTileDecodeFn, { texel: TSL.texture(this.atlasTexture, uv) });

    this.webGpuUniforms = {
      zoom: zoomUniform as { value: number },
      useLocalToClip: useLocalToClipUniform as { value: number }
    };
    return material;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  // instanceData layout per tile: [worldMinX, worldMinY, worldMaxX, worldMaxY,
  // uvX0, uvY0, uvX1, uvY1] where uvY* already encode the atlas row convention.
  setTiles(instanceData: Float32Array, tileCount: number): void {
    const capacity = Math.floor(this.worldRectAttribute.array.length / 4);
    const count = Math.max(0, Math.min(tileCount, capacity));
    const worldArray = this.worldRectAttribute.array as Float32Array;
    const uvArray = this.uvRectAttribute.array as Float32Array;
    for (let i = 0; i < count; i += 1) {
      const source = i * 8;
      const target = i * 4;
      worldArray[target] = instanceData[source];
      worldArray[target + 1] = instanceData[source + 1];
      worldArray[target + 2] = instanceData[source + 2];
      worldArray[target + 3] = instanceData[source + 3];
      uvArray[target] = instanceData[source + 4];
      uvArray[target + 1] = instanceData[source + 5];
      uvArray[target + 2] = instanceData[source + 6];
      uvArray[target + 3] = instanceData[source + 7];
    }
    this.worldRectAttribute.needsUpdate = true;
    this.uvRectAttribute.needsUpdate = true;
    this.mesh.geometry.instanceCount = count;
  }

  writeTilePixels(atlasX: number, atlasY: number, width: number, height: number, pixels: Uint8Array): void {
    const rowBytes = width * 4;
    for (let row = 0; row < height; row += 1) {
      const targetOffset = ((atlasY + row) * this.atlasWidth + atlasX) * 4;
      this.atlasData.set(pixels.subarray(row * rowBytes, row * rowBytes + rowBytes), targetOffset);
    }
  }

  markAtlasDirty(): void {
    this.atlasTexture.needsUpdate = true;
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClipUniform.value = 0;
    if (this.webGpuUniforms) {
      this.webGpuUniforms.useLocalToClip.value = 0;
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4): void {
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    if (this.webGpuUniforms) {
      this.webGpuUniforms.useLocalToClip.value = 1;
    }
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    if (this.webGpuUniforms) {
      this.webGpuUniforms.zoom.value = this.zoomUniform.value;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.atlasTexture.dispose();
  }
}
