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
  updateSource(texture: THREE.Texture, matrix: Float32Array, opacity: number): void;
}

interface ThreeWebGpuRasterMaterialOptions {
  instancedPageBackground?: boolean;
  opacity?: number;
  colorCompositing: ThreeColorCompositing;
  texture: THREE.Texture;
  matrixABCD: THREE.Vector4;
  matrixEF: THREE.Vector2;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  pageBinding?: ThreePageBinding;
}

// Deliberately typed as `unknown`: naming the TSL function type (e.g. via
// `ReturnType<typeof TSL.wgslFn>`) instantiates @types/three's recursive
// ProxiedTuple/ProxiedObject types, which hangs the TypeScript 7 native compiler.
function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

function varyingNode(node: unknown): never {
  return (TSL.varying as unknown as (node: unknown) => unknown)(node) as never;
}

export const rasterPackFn: unknown = TSL.wgslFn(`
fn heprRasterPack(
  corner: vec2<f32>,
  matrixABCD: vec4<f32>,
  matrixEF: vec2<f32>
) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let localTopDown = vec2<f32>(corner01.x, 1.0 - corner01.y);
  let world = vec2<f32>(
    matrixABCD.x * localTopDown.x + matrixABCD.z * localTopDown.y + matrixEF.x,
    matrixABCD.y * localTopDown.x + matrixABCD.w * localTopDown.y + matrixEF.y
  );
  return vec4<f32>(world, localTopDown);
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
  const rasterPack = varyingNode(options.instancedPageBackground
    ? callNode(pageBackgroundPackFn, { corner, pageRect: TSL.attribute("aPageRect", "vec4") })
    : callNode(rasterPackFn, {
      corner,
      matrixABCD: TSL.uniform(options.matrixABCD),
      matrixEF: TSL.uniform(options.matrixEF)
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

  // Clips are often an image's visible outline; their edges are antialiased.
  registerThreeNodeClipPosition(material, (rasterPack as { xy: unknown }).xy, "premultiplied");

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    updateSource(texture, matrix, opacity) {
      textureNode.value = texture;
      options.matrixABCD.set(matrix[0], matrix[1], matrix[2], matrix[3]);
      options.matrixEF.set(matrix[4], matrix[5]);
      opacityUniform.value = opacity;
    }
  };
}
