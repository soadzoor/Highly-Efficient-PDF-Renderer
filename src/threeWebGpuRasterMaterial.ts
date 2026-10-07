import { pageProjectionNode } from "./threeWebGpuPageTransforms";
import type { ThreePageBinding } from "./threePageTransforms";
import { registerThreePdfShapeUniform } from "./threePdfShape";
import { registerThreeNodeClipPosition } from "./threeWebGpuVectorClips";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { threeRasterTextureInfo } from "./threeRasterTextures";
import { PAGE_PLACEHOLDER_BAR_WGSL, PAGE_PLACEHOLDER_COLOR_WGSL } from "./pageLoadingPlaceholder";

import {
  createThreeWebGpuOutputFragmentFns,
  type ThreeColorCompositing
} from "./threeWebGpuColorSpace";

interface MutableUniform<T> {
  value: T;
}

export interface ThreeWebGpuRasterMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
  pagePlaceholderTimeUniform: MutableUniform<number>;
  updateSource(texture: THREE.Texture, matrix: Float32Array, opacity: number, tile?: ThreeRasterTileRect): void;
}

/** A tile's part of the image's unit square, and the same corners in its texture. */
export interface ThreeRasterTileRect {
  readonly quad: readonly number[];
  readonly uv: readonly number[];
}

interface ThreeWebGpuRasterMaterialOptions {
  instancedPageBackground?: boolean;
  opacity?: number;
  colorCompositing: ThreeColorCompositing;
  texture: THREE.Texture;
  matrixABCD: THREE.Vector4;
  matrixEF: THREE.Vector2;
  /** Defaults to the whole image in one texture. */
  tile?: ThreeRasterTileRect;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  pageBinding?: ThreePageBinding;
}

const WHOLE_RASTER_RECT = [0, 0, 1, 1];
const placeholderBarFn: unknown = TSL.wgslFn(PAGE_PLACEHOLDER_BAR_WGSL);
const placeholderColorFn: unknown = TSL.wgslFn(PAGE_PLACEHOLDER_COLOR_WGSL, [placeholderBarFn] as never);

// Deliberately typed as `unknown`: naming the TSL function type (e.g. via
// `ReturnType<typeof TSL.wgslFn>`) instantiates @types/three's recursive
// ProxiedTuple/ProxiedObject types, which hangs the TypeScript 7 native compiler.
function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

function varyingNode(node: unknown): never {
  return (TSL.varying as unknown as (node: unknown) => unknown)(node) as never;
}

/** Placement of an image, or of one tile's part of it; whole images pass unit rects. */
export const rasterPackFn: unknown = TSL.wgslFn(`
fn heprRasterPack(
  corner: vec2<f32>,
  matrixABCD: vec4<f32>,
  matrixEF: vec2<f32>,
  tileQuad: vec4<f32>,
  tileUv: vec4<f32>
) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let localTopDown = vec2<f32>(corner01.x, 1.0 - corner01.y);
  // Corners select, never interpolate, so neighboring tiles share exact edges.
  let farCorner = localTopDown > vec2<f32>(0.5);
  let tileCorner = select(tileQuad.xy, tileQuad.zw, farCorner);
  let world = vec2<f32>(
    matrixABCD.x * tileCorner.x + matrixABCD.z * tileCorner.y + matrixEF.x,
    matrixABCD.y * tileCorner.x + matrixABCD.w * tileCorner.y + matrixEF.y
  );
  return vec4<f32>(world, select(tileUv.xy, tileUv.zw, farCorner));
}
`);

const pageBackgroundPackFn: unknown = TSL.wgslFn(`
fn heprPageBackgroundPack(corner: vec2<f32>, pageRect: vec4<f32>) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let localTopDown = vec2<f32>(corner01.x, 1.0 - corner01.y);
  let world = pageRect.xy + pageRect.zw * localTopDown;
  return vec4<f32>(world, localTopDown);
}
`);

export const rasterClipFn: unknown = TSL.wgslFn(`
fn heprRasterClipPosition(
  rasterPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let world = rasterPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`);

export const rasterFragmentFns = createThreeWebGpuOutputFragmentFns(`
fn heprRasterFragment(inputColor: vec4<f32>, opacity: f32, shapeOnly: f32) -> vec4<f32> {
  let color = inputColor * mix(opacity, 1.0, shapeOnly);
  if (color.a <= 0.001) {
    discard;
  }
  let straightSrgb = clamp(color.rgb / color.a, vec3<f32>(0.0), vec3<f32>(1.0));
  let outputPremultiplied = heprThreeOutputColor(straightSrgb) * color.a;
  return vec4<f32>(outputPremultiplied, color.a);
}
`);

const rasterBitFn: unknown = TSL.wgslFn(`
fn heprThreeRasterBit(image: texture_2d<f32>, size: vec2f, pixel: vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), vec2i(size) - vec2i(1));
  let bits = u32(round(textureLoad(image, vec2i(p.x / 8, p.y), 0).r * 255.0));
  return f32((bits >> (7u - (u32(p.x) & 7u))) & 1u);
}`);
const rasterSampleFn: unknown = TSL.wgslFn(`
fn heprThreeRasterSample(image: texture_2d<f32>, imageSampler: sampler,
  coverageImage: texture_2d<f32>, coverageSampler: sampler,
  uv: vec2f, mode: f32, size: vec2f, color0: vec4f, color1: vec4f, opaque: f32) -> vec4f {
  let dx = dpdx(uv); let dy = dpdy(uv);
  if (mode < 0.5) {
    var color = textureSampleGrad(image, imageSampler, uv, dx, dy);
    if (opaque > 0.5) { color.a = 1.0; }
    return color;
  }
  if (mode > 1.5) {
    return mix(color0, color1, textureSampleGrad(image, imageSampler, uv, dx, dy).r);
  }
  let lod = max(0.0, log2(max(1.0, max(length(dx * size), length(dy * size)))));
  var coverage: f32;
  if (lod < 1.0) {
    let position = uv * size - vec2f(0.5);
    let pixel = vec2i(floor(position)); let weight = fract(position);
    let base = mix(mix(heprThreeRasterBit(image, size, pixel), heprThreeRasterBit(image, size, pixel + vec2i(1,0)), weight.x),
      mix(heprThreeRasterBit(image, size, pixel + vec2i(0,1)), heprThreeRasterBit(image, size, pixel + vec2i(1,1)), weight.x), weight.y);
    coverage = mix(base, textureSampleLevel(coverageImage, coverageSampler, uv, 0.0).r, lod);
  } else {
    coverage = textureSampleLevel(coverageImage, coverageSampler, uv, lod - 1.0).r;
  }
  return mix(color0, color1, coverage);
}`, [rasterBitFn] as never);

export function createThreeWebGpuRasterMaterial(
  options: ThreeWebGpuRasterMaterialOptions
): ThreeWebGpuRasterMaterialState {
  const material = new NodeMaterial();
  const pageProjection = pageProjectionNode(options.localToClip, options.pageBinding);
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

  const shapeOnlyUniform = TSL.uniform(0);
  registerThreePdfShapeUniform(material, shapeOnlyUniform);
  const zoomUniform = TSL.uniform(1);
  const useLocalToClipUniform = TSL.uniform(0);
  const corner = TSL.attribute("aCorner", "vec2");
  const tileQuad = new THREE.Vector4().fromArray(options.tile?.quad ?? WHOLE_RASTER_RECT);
  const tileUv = new THREE.Vector4().fromArray(options.tile?.uv ?? WHOLE_RASTER_RECT);
  const rasterPack = varyingNode(options.instancedPageBackground
    ? callNode(pageBackgroundPackFn, { corner, pageRect: TSL.attribute("aPageRect", "vec4") })
    : callNode(rasterPackFn, {
      corner,
      matrixABCD: TSL.uniform(options.matrixABCD),
      matrixEF: TSL.uniform(options.matrixEF),
      tileQuad: TSL.uniform(tileQuad),
      tileUv: TSL.uniform(tileUv)
    }));
  const rasterPackValue = rasterPack as { zw: unknown };
  const info = threeRasterTextureInfo(options.texture);
  const textureNode = TSL.texture(options.texture);
  const coverageNode = TSL.texture(info.coverage);
  // R8/RGBA tiers share a texture, while packed tiers need two. Preserve both
  // binding identities across replacements instead of deduplicating by texture UUID.
  textureNode.getUniformHash = () => textureNode.uuid;
  coverageNode.getUniformHash = () => coverageNode.uuid;
  const modeUniform = TSL.uniform(info.mode);
  const opaqueUniform = TSL.uniform(info.compressionFormat ? 1 : 0);
  const size = info.size.clone(), color0 = info.color0.clone(), color1 = info.color1.clone();
  // Packed bytes use textureLoad. Its nearest-only texture has no TSL sampler;
  // the coverage sampler also serves the filtered RGBA/R8 branches after a tier switch.
  const inputColor = callNode(rasterSampleFn, { image: textureNode, imageSampler: TSL.sampler(coverageNode),
    coverageImage: coverageNode, coverageSampler: TSL.sampler(coverageNode), uv: rasterPackValue.zw,
    mode: modeUniform, size: TSL.uniform(size), color0: TSL.uniform(color0), color1: TSL.uniform(color1), opaque: opaqueUniform });
  const opacityUniform = TSL.uniform(options.opacity ?? 1);
  const pagePlaceholderTimeUniform = TSL.uniform(0);
  const pageColor = options.instancedPageBackground ? callNode(placeholderColorFn, { paper: inputColor,
    uv: rasterPackValue.zw, pending: varyingNode(TSL.attribute("aPageLoading", "float")), time: pagePlaceholderTimeUniform }) : inputColor;

  material.vertexNode = callNode(rasterClipFn, {
    rasterPack,
    viewport: TSL.uniform(options.viewport),
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: pageProjection.matrix
  });
  pageProjection.finish(material);
  material.fragmentNode = callNode(rasterFragmentFns[options.colorCompositing], {
    inputColor: pageColor,
    opacity: opacityUniform,
    shapeOnly: shapeOnlyUniform
  });

  // Polygon outlines are antialiased; rectangular tile/page clips stay solid.
  registerThreeNodeClipPosition(material, (rasterPack as { xy: unknown }).xy, "premultiplied", true);

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    pagePlaceholderTimeUniform: pagePlaceholderTimeUniform as MutableUniform<number>,
    updateSource(texture, matrix, opacity, tile) {
      textureNode.value = texture;
      const info = threeRasterTextureInfo(texture);
      coverageNode.value = info.coverage;
      modeUniform.value = info.mode;
      opaqueUniform.value = info.compressionFormat ? 1 : 0;
      size.copy(info.size); color0.copy(info.color0); color1.copy(info.color1);
      options.matrixABCD.set(matrix[0], matrix[1], matrix[2], matrix[3]);
      options.matrixEF.set(matrix[4], matrix[5]);
      tileQuad.fromArray(tile?.quad ?? WHOLE_RASTER_RECT);
      tileUv.fromArray(tile?.uv ?? WHOLE_RASTER_RECT);
      opacityUniform.value = opacity;
    }
  };
}
