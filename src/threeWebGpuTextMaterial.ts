import { registerThreePdfShapeUniform } from "./threePdfShape";
import { FILL_COVERAGE_VERTEX_WGSL, FILL_COVERAGE_WGSL } from "./fillCoverageShaders";
import { TEXT_RASTER_ATLAS_PADDING_PX } from "./textRasterAtlas";
import { registerThreeNodeClipPosition } from "./threeVectorClips";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import {
  createThreeWebGpuOutputFragmentFns,
  type ThreeColorCompositing
} from "./threeWebGpuColorSpace";

interface MutableUniform<T> {
  value: T;
}

export interface ThreeWebGpuTextMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
  curveUniform: MutableUniform<number>;
  vectorOnlyUniform: MutableUniform<number>;
}

interface ThreeWebGpuTextMaterialOptions {
  colorCompositing: ThreeColorCompositing;
  textInstanceTextureA: THREE.DataTexture;
  textInstanceTextureB: THREE.DataTexture;
  textInstanceTextureC: THREE.DataTexture;
  textGlyphMetaTextureA: THREE.DataTexture;
  textGlyphMetaTextureB: THREE.DataTexture;
  textGlyphRasterMetaTexture: THREE.DataTexture;
  textGlyphSegmentTextureA: THREE.DataTexture;
  textGlyphSegmentTextureB: THREE.DataTexture;
  textRasterAtlasTexture: THREE.DataTexture;
  textRasterAtlasSize: THREE.Vector2;
  textInstanceTextureWidth: number;
  textGlyphTextureWidth: number;
  textSegmentTextureWidth: number;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  vectorOverride: THREE.Vector4;
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
}

// Deliberately typed as `unknown`: naming the TSL function type (e.g. via
// `ReturnType<typeof TSL.wgslFn>`) instantiates @types/three's recursive
// ProxiedTuple/ProxiedObject types, which hangs the TypeScript 7 native compiler.
// Since three r180, wgslFn results are proxies without a `functionNode`
// property; the include entry is the wgslFn value itself.
function includeNode(fn: unknown): never {
  return fn as never;
}

function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

// `flat` mirrors the `flat` qualifier the GLSL shaders and the
// `@interpolate(flat)` attribute the native WGSL shaders use for per-primitive
// values. Only positions, which really do vary across the quad, stay
// interpolated.
function varyingNode(node: unknown, flat = false): never {
  const varying = (TSL.varying as unknown as (node: unknown) =>
    { setInterpolation(type: string): unknown })(node);
  return (flat ? varying.setInterpolation("flat") : varying) as never;
}

const coordFromIndexFn = TSL.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`);

const clipCoordFromReferenceFn = TSL.wgslFn(`
fn heprClipCoordFromReference(reference: f32, width: f32) -> vec2<i32> {
  let itemIndex = max(i32(reference + 0.5) - 1, 0);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`);

const fillCoverageFn = TSL.wgslFn(FILL_COVERAGE_WGSL);
const fillCoverageVertexFn = TSL.wgslFn(FILL_COVERAGE_VERTEX_WGSL);

const textVertexPackFn = TSL.wgslFn(`
fn heprTextVertexPack(
  corner: vec2<f32>,
  instanceA: vec4<f32>,
  instanceB: vec4<f32>,
  glyphMetaA: vec4<f32>,
  glyphMetaB: vec4<f32>,
  viewport: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let segmentCount = i32(glyphMetaA.y + 0.5);
  if (segmentCount <= 0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  // Widen the glyph quad by a pixel in glyph space, so stems and dots thinner
  // than a pixel reach every pixel their footprint touches.
  let glyphToWorld = mat2x2<f32>(instanceA.x, instanceA.y, instanceA.z, instanceA.w);
  let cornerWorld = glyphToWorld * (minBounds + (maxBounds - minBounds) * corner01) + instanceB.xy;
  let margin = heprCoverageMargin(heprPathToPixel(cornerWorld, useLocalToClip, localToClip, zoom,
    max(viewport, vec2<f32>(1.0))) * glyphToWorld);
  let local = minBounds - margin + (maxBounds - minBounds + 2.0 * margin) * corner01;
  let world = vec2<f32>(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );
  return vec4<f32>(world, local);
}
`, [includeNode(fillCoverageVertexFn)]);

const textClipFn = TSL.wgslFn(`
fn heprTextClipPosition(
  vertexPack: vec4<f32>,
  glyphMetaA: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  // Cull on the glyph's own segment count, like the GLSL and native WGSL text
  // shaders. vertexPack.zw carries glyph-space coordinates, so any sentinel
  // packed there would also match real glyphs whose bounds reach far enough
  // below the origin, dragging one quad corner off-screen.
  if (i32(glyphMetaA.y + 0.5) <= 0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 1.0);
  }

  let world = vertexPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`);

const textNormCoordFn = TSL.wgslFn(`
fn heprTextNormCoord(local: vec2<f32>, glyphMetaA: vec4<f32>, glyphMetaB: vec4<f32>) -> vec2<f32> {
  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let span = max(maxBounds - minBounds, vec2<f32>(0.000001));
  // Unclamped, so the widened quad samples the atlas tile's transparent padding.
  return (local - minBounds) / span;
}
`);

const textRasterAtlasPixelsFn = TSL.wgslFn(`
fn heprTextRasterAtlasPixels(
  normCoord: vec2<f32>,
  rasterRect: vec4<f32>,
  atlasSize: vec2<f32>
) -> vec2<f32> {
  let dims = max(atlasSize, vec2<f32>(1.0));
  return vec2<f32>(normCoord.x, 1.0 - normCoord.y) * (rasterRect.zw * dims);
}
`);

const textFragmentFns = createThreeWebGpuOutputFragmentFns(`
fn heprTextFragment(
  local: vec2<f32>,
  world: vec2<f32>,
  clipReference: f32,
  clipRect: vec4<f32>,
  glyphMetaA: vec4<f32>,
  instanceColor: vec4<f32>,
  normCoord: vec2<f32>,
  atlasPixels: vec2<f32>,
  rasterRect: vec4<f32>,
  rasterAtlasTex: texture_2d<f32>,
  rasterAtlasSampler: sampler,
  rasterAtlasSize: vec2<f32>,
  vectorOnly: f32,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  textAAScreenPx: f32,
  textCurveEnabled: f32,
  vectorOverride: vec4<f32>,
  shapeOnly: f32,
  inkDensity: f32
) -> vec4<f32> {
  if (clipReference > 0.0 &&
      (world.x < clipRect.x || world.y < clipRect.y ||
       world.x > clipRect.z || world.y > clipRect.w)) {
    discard;
  }
  let localDx = dpdx(local);
  let localDy = dpdy(local);
  let pixelToLocalX = length(vec2<f32>(localDx.x, localDy.x));
  let pixelToLocalY = length(vec2<f32>(localDx.y, localDy.y));
  let glyphPixel = vec2<f32>(
    length(vec2<f32>(dpdx(normCoord.x), dpdy(normCoord.x))),
    length(vec2<f32>(dpdx(normCoord.y), dpdy(normCoord.y)))
  );
  // Derivatives must be taken before any discard or divergent branch. Supplying
  // them explicitly below makes conditional atlas sampling valid WGSL while
  // retaining the footprint used by the anisotropic sampler.
  let atlasPixelsDx = dpdx(atlasPixels);
  let atlasPixelsDy = dpdy(atlasPixels);
  let atlasFootprint = min(
    abs(atlasPixelsDx.x) + abs(atlasPixelsDy.x),
    abs(atlasPixelsDx.y) + abs(atlasPixelsDy.y)
  );

  let segmentStart = i32(glyphMetaA.x + 0.5);
  let segmentCount = i32(glyphMetaA.y + 0.5);
  if (segmentCount <= 0 || instanceColor.a <= 0.001) {
    discard;
  }

  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let tintedColor = instanceColor.rgb * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  // A glyph a few pixels across is its box at mean ink density, as coarse
  // text LOD runs are, so switching between them changes nothing. Its shape
  // fades in as it grows from 2.5 to 5 pixels.
  let glyphPixels = 1.0 / max(min(glyphPixel.x, glyphPixel.y), 0.000001);
  let detail = clamp((glyphPixels - 2.5) / 2.5, 0.0, 1.0);
  let halfBox = max(0.5 * textAAScreenPx * glyphPixel, vec2<f32>(0.000001));
  let boxOverlap = max(min(normCoord + halfBox, vec2<f32>(1.0)) - max(normCoord - halfBox, vec2<f32>(0.0)), vec2<f32>(0.0)) /
    (2.0 * halfBox);
  var coverage = clamp(inkDensity, 0.0, 1.0) * boxOverlap.x * boxOverlap.y;

  if (detail > 0.0) {
    var detailCoverage = 0.0;
    // Once a glyph is minified past roughly two atlas texels per pixel, the
    // mipmapped coverage atlas is both cheaper and less aliased than evaluating
    // the outline per pixel.
    if (vectorOnly < 0.5 && rasterRect.z > 0.0 && rasterRect.w > 0.0 && atlasFootprint > 2.0) {
      let atlasDims = max(rasterAtlasSize, vec2<f32>(1.0));
      let texel = 1.0 / atlasDims;
      let uvCenter = vec2<f32>(
        rasterRect.x + normCoord.x * rasterRect.z,
        rasterRect.y + (1.0 - normCoord.y) * rasterRect.w
      );
      // The widened quad reaches past the glyph box into its tile's transparent
      // padding, which must read as empty rather than repeat the edge texels.
      let padding = texel * ${TEXT_RASTER_ATLAS_PADDING_PX - 0.5};
      let uvMin = rasterRect.xy - padding;
      let uvMax = rasterRect.xy + rasterRect.zw + padding;
      let tapDx = atlasPixelsDx * 0.33 * texel;
      let tapDy = atlasPixelsDy * 0.33 * texel;
      // Coarser mips than the padding blend neighbouring glyphs' ink in.
      let mipCap = min(1.0, ${TEXT_RASTER_ATLAS_PADDING_PX}.0 /
        max(max(length(atlasPixelsDx), length(atlasPixelsDy)) * 0.42044820762685725, 0.000001));
      // Scaling both explicit gradients by exp2(-1.25) preserves the previous
      // negative mip bias without discarding their anisotropic direction/ratio.
      let mipBiasedUvDx = atlasPixelsDx * texel * 0.42044820762685725 * mipCap;
      let mipBiasedUvDy = atlasPixelsDy * texel * 0.42044820762685725 * mipCap;
      detailCoverage = (1.0 / 3.0) * textureSampleGrad(
        rasterAtlasTex,
        rasterAtlasSampler,
        clamp(uvCenter, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r + (1.0 / 6.0) * (
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter - tapDx - tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter - tapDx + tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter + tapDx - tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter + tapDx + tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r
      );
    } else {
      // Average the glyph's nonzero winding number over the pixel footprint in
      // glyph space. Thin stems keep their ink instead of snapping to pixels.
      let footprint = max(vec2<f32>(pixelToLocalX, pixelToLocalY) * textAAScreenPx, vec2<f32>(0.0001));
      let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
      var winding = 0.0;
      let safeWidth = max(i32(segmentTexWidth), 1);
      for (var i = 0; i < segmentCount; i = i + 1) {
        let primitiveIndex = segmentStart + i;
        let coord = vec2<i32>(primitiveIndex % safeWidth, primitiveIndex / safeWidth);
        let primitiveA = textureLoad(segmentTexA, coord, 0);
        let primitiveB = textureLoad(segmentTexB, coord, 0);
        winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          textCurveEnabled >= 0.5 && primitiveB.z >= 1.0, box, 0.0, 1.0);
      }
      detailCoverage = heprFillCoverage(winding, false);
    }
    coverage = mix(coverage, detailCoverage, detail);
  }

  let alpha = clamp(coverage, 0.0, 1.0) * mix(instanceColor.a, 1.0, shapeOnly);
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputColor(tintedColor), alpha);
}
`, [includeNode(fillCoverageFn)]);

export function createThreeWebGpuTextMaterial(
  options: ThreeWebGpuTextMaterialOptions
): ThreeWebGpuTextMaterialState {
  const material = new NodeMaterial();
  material.transparent = false;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  material.fog = false;
  material.lights = false;
  configureStraightAlphaBlending(material);

  const shapeOnlyUniform = TSL.uniform(0);
  registerThreePdfShapeUniform(material, shapeOnlyUniform);
  const zoomUniform = TSL.uniform(1);
  const useLocalToClipUniform = TSL.uniform(0);
  const curveUniform = TSL.uniform(options.strokeCurveEnabled ? 1 : 0);
  const vectorOnlyUniform = TSL.uniform(options.textVectorOnly ? 1 : 0);
  const textAAScreenPxUniform = TSL.uniform(1.25);
  const instanceTextureWidthUniform = TSL.uniform(Math.max(1, options.textInstanceTextureWidth));
  const glyphTextureWidthUniform = TSL.uniform(Math.max(1, options.textGlyphTextureWidth));
  const segmentTextureWidthUniform = TSL.uniform(Math.max(1, options.textSegmentTextureWidth));

  const corner = TSL.attribute("aCorner", "vec2");
  const instanceIndex = TSL.attribute("aTextInstanceIndex", "float");
  const instanceCoord = callNode(coordFromIndexFn, {
    index: instanceIndex,
    width: instanceTextureWidthUniform
  });
  const instanceA = varyingNode(TSL.textureLoad(options.textInstanceTextureA, instanceCoord, 0), true);
  const instanceB = varyingNode(TSL.textureLoad(options.textInstanceTextureB, instanceCoord, 0), true);
  const instanceColor = varyingNode(TSL.textureLoad(options.textInstanceTextureC, instanceCoord, 0), true);
  const glyphCoord = callNode(coordFromIndexFn, {
    index: (instanceB as { z: unknown }).z,
    width: glyphTextureWidthUniform
  });
  const glyphMetaA = varyingNode(TSL.textureLoad(options.textGlyphMetaTextureA, glyphCoord, 0), true);
  const glyphMetaB = varyingNode(TSL.textureLoad(options.textGlyphMetaTextureB, glyphCoord, 0), true);
  const rasterRect = varyingNode(TSL.textureLoad(options.textGlyphRasterMetaTexture, glyphCoord, 0), true);
  const viewportUniform = TSL.uniform(options.viewport);
  const localToClipUniform = TSL.uniform(options.localToClip);
  const vertexPack = varyingNode(callNode(textVertexPackFn, {
    corner,
    instanceA,
    instanceB,
    glyphMetaA,
    glyphMetaB,
    viewport: viewportUniform,
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: localToClipUniform
  }));
  const vertexPackValue = vertexPack as { zw: unknown };
  const clipCoord = callNode(clipCoordFromReferenceFn, {
    reference: (instanceB as { w: unknown }).w,
    width: glyphTextureWidthUniform
  });
  const clipRect = varyingNode(TSL.textureLoad(options.textGlyphMetaTextureA, clipCoord, 0), true);

  material.vertexNode = callNode(textClipFn, {
    vertexPack,
    glyphMetaA,
    viewport: viewportUniform,
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: localToClipUniform
  });

  const rasterAtlasSizeUniform = TSL.uniform(options.textRasterAtlasSize);
  const normCoord = callNode(textNormCoordFn, {
    local: vertexPackValue.zw,
    glyphMetaA,
    glyphMetaB
  });
  const atlasPixels = callNode(textRasterAtlasPixelsFn, {
    normCoord,
    rasterRect,
    atlasSize: rasterAtlasSizeUniform
  });

  material.fragmentNode = callNode(textFragmentFns[options.colorCompositing], {
    local: vertexPackValue.zw,
    world: (vertexPack as { xy: unknown }).xy,
    clipReference: (instanceB as { w: unknown }).w,
    clipRect,
    glyphMetaA,
    instanceColor,
    normCoord,
    atlasPixels,
    rasterRect,
    rasterAtlasTex: TSL.texture(options.textRasterAtlasTexture),
    rasterAtlasSampler: TSL.sampler(options.textRasterAtlasTexture),
    rasterAtlasSize: rasterAtlasSizeUniform,
    vectorOnly: vectorOnlyUniform,
    segmentTexA: TSL.textureLoad(options.textGlyphSegmentTextureA),
    segmentTexB: TSL.textureLoad(options.textGlyphSegmentTextureB),
    segmentTexWidth: segmentTextureWidthUniform,
    textAAScreenPx: textAAScreenPxUniform,
    textCurveEnabled: curveUniform,
    vectorOverride: TSL.uniform(options.vectorOverride),
    shapeOnly: shapeOnlyUniform,
    inkDensity: (glyphMetaB as { z: unknown }).z
  });

  registerThreeNodeClipPosition(material, (vertexPack as { xy: unknown }).xy);

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    curveUniform: curveUniform as MutableUniform<number>,
    vectorOnlyUniform: vectorOnlyUniform as MutableUniform<number>
  };
}
