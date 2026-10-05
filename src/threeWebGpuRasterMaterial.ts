import { pageProjectionNode, type ThreePageBinding } from "./threePageTransforms";
import { registerThreePdfShapeUniform } from "./threePdfShape";
import { registerThreeNodeClipPosition } from "./threeVectorClips";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

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
  const textureNode = TSL.texture(options.texture, rasterPackValue.zw as never);
  const opacityUniform = TSL.uniform(options.opacity ?? 1);

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
    inputColor: textureNode,
    opacity: opacityUniform,
    shapeOnly: shapeOnlyUniform
  });

  // Polygon outlines are antialiased; rectangular tile/page clips stay solid.
  registerThreeNodeClipPosition(material, (rasterPack as { xy: unknown }).xy, "premultiplied", true);

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    updateSource(texture, matrix, opacity, tile) {
      textureNode.value = texture;
      options.matrixABCD.set(matrix[0], matrix[1], matrix[2], matrix[3]);
      options.matrixEF.set(matrix[4], matrix[5]);
      tileQuad.fromArray(tile?.quad ?? WHOLE_RASTER_RECT);
      tileUv.fromArray(tile?.uv ?? WHOLE_RASTER_RECT);
      opacityUniform.value = opacity;
    }
  };
}
