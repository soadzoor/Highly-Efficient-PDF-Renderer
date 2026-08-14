import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { threeWebGpuOutputSrgbToLinearFn } from "./threeWebGpuColorSpace";

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

function varyingNode(node: unknown): never {
  return (TSL.varying as unknown as (node: unknown) => unknown)(node) as never;
}

/**
 * Sample the glyph coverage atlas at an explicit mip level.
 *
 * `wgslFn` parameters cannot carry a sampler, so the filtered taps happen here
 * as TSL nodes and only the resulting coverage is handed to the shader code.
 */
function sampleRasterAtlasCoverage(texture: THREE.Texture, uv: unknown, level: unknown): never {
  const textureNode = (TSL.texture as unknown as (
    value: THREE.Texture,
    uv: unknown
  ) => { level: (level: unknown) => { r: unknown } })(texture, uv);
  return textureNode.level(level).r as never;
}

const coordFromIndexFn = TSL.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`);

const textVertexPackFn = TSL.wgslFn(`
fn heprTextVertexPack(
  corner: vec2<f32>,
  instanceA: vec4<f32>,
  instanceB: vec4<f32>,
  glyphMetaA: vec4<f32>,
  glyphMetaB: vec4<f32>
) -> vec4<f32> {
  let segmentCount = i32(glyphMetaA.y + 0.5);
  if (segmentCount <= 0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let local = minBounds + (maxBounds - minBounds) * corner01;
  let world = vec2<f32>(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );
  return vec4<f32>(world, local);
}
`);

const textClipFn = TSL.wgslFn(`
fn heprTextClipPosition(
  vertexPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  if (vertexPack.z <= -1.5 && vertexPack.w <= -1.5) {
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
  return clamp((local - minBounds) / span, vec2<f32>(0.0), vec2<f32>(1.0));
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

const textRasterAtlasLodFn = TSL.wgslFn(`
fn heprTextRasterAtlasLod(atlasPixels: vec2<f32>) -> f32 {
  let mipBias = -1.25;
  let footprint = max(max(fwidth(atlasPixels.x), fwidth(atlasPixels.y)), 0.000001);
  return max(log2(footprint) + mipBias, 0.0);
}
`);

const textRasterAtlasTapUvFn = TSL.wgslFn(`
fn heprTextRasterAtlasTapUv(
  normCoord: vec2<f32>,
  atlasPixels: vec2<f32>,
  rasterRect: vec4<f32>,
  atlasSize: vec2<f32>,
  offsetX: f32,
  offsetY: f32
) -> vec2<f32> {
  let dims = max(atlasSize, vec2<f32>(1.0));
  let texel = 1.0 / dims;
  let uvCenter = vec2<f32>(
    rasterRect.x + normCoord.x * rasterRect.z,
    rasterRect.y + (1.0 - normCoord.y) * rasterRect.w
  );
  let uvMin = rasterRect.xy + texel * 0.5;
  let uvMax = rasterRect.xy + rasterRect.zw - texel * 0.5;
  let dx = dpdx(atlasPixels) * 0.33 * texel;
  let dy = dpdy(atlasPixels) * 0.33 * texel;
  return clamp(uvCenter + dx * offsetX + dy * offsetY, uvMin, uvMax);
}
`);

const distanceToLineSegmentFn = TSL.wgslFn(`
fn heprLineDistanceInfo(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> vec4<f32> {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 0.0000000001) {
    return vec4<f32>(length(p - a), 0.0, 1.0, 0.0);
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  let offset = p - (a + ab * t);
  let tangent = ab * inverseSqrt(abLenSq);
  let leftNormal = vec2<f32>(-tangent.y, tangent.x);
  return vec4<f32>(length(offset), t, leftNormal);
}
`);

const distanceToQuadraticBezierFn = TSL.wgslFn(`
fn heprQuadraticDistanceInfo(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> vec4<f32> {
  let aa = b - a;
  let bb = a - 2.0 * b + c;
  let cc = aa * 2.0;
  let dd = a - p;

  let bbLenSq = dot(bb, bb);
  if (bbLenSq <= 0.000000000001) {
    return heprLineDistanceInfo(p, a, c);
  }

  let inv = 1.0 / bbLenSq;
  let kx = inv * dot(aa, bb);
  let ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  let kz = inv * dot(dd, aa);
  let pValue = ky - kx * kx;
  let pCube = pValue * pValue * pValue;
  let qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let hValue = qValue * qValue + 4.0 * pCube;
  var best = 100000000000000000000.0;
  var closestT = 0.0;

  if (hValue >= 0.0) {
    let hSqrt = sqrt(hValue);
    let roots = (vec2<f32>(hSqrt, -hSqrt) - vec2<f32>(qValue)) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2<f32>(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
    closestT = t;
  } else {
    let z = sqrt(-pValue);
    let acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    let angle = acos(acosArg) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let t = clamp(
      vec3<f32>(cosine + cosine, -sine - cosine, sine - cosine) * z - vec3<f32>(kx),
      vec3<f32>(0.0),
      vec3<f32>(1.0)
    );

    var delta = dd + (cc + bb * t.x) * t.x;
    best = dot(delta, delta);
    closestT = t.x;
    delta = dd + (cc + bb * t.y) * t.y;
    var candidate = dot(delta, delta);
    if (candidate < best) {
      best = candidate;
      closestT = t.y;
    }
    delta = dd + (cc + bb * t.z) * t.z;
    candidate = dot(delta, delta);
    if (candidate < best) {
      best = candidate;
      closestT = t.z;
    }
  }

  let oneMinusT = 1.0 - closestT;
  let closestPoint = oneMinusT * oneMinusT * a +
    2.0 * oneMinusT * closestT * b + closestT * closestT * c;
  var tangent = 2.0 * (oneMinusT * (b - a) + closestT * (c - b));
  var tangentLenSq = dot(tangent, tangent);
  if (tangentLenSq <= 0.000000000001) {
    tangent = c - a;
    tangentLenSq = dot(tangent, tangent);
  }
  var leftNormal = vec2<f32>(1.0, 0.0);
  if (tangentLenSq > 0.000000000001) {
    leftNormal = vec2<f32>(-tangent.y, tangent.x) * inverseSqrt(tangentLenSq);
  }
  return vec4<f32>(sqrt(max(best, 0.0)), closestT, leftNormal);
}
`, [includeNode(distanceToLineSegmentFn)]);

const textCrossingFns = TSL.wgslFn(`
fn heprLineWindingDelta(a: vec2<f32>, b: vec2<f32>, p: vec2<f32>) -> i32 {
  let upward = (a.y <= p.y) && (b.y > p.y);
  let downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) {
    return 0;
  }
  let denom = b.y - a.y;
  if (abs(denom) <= 0.000001) {
    return 0;
  }
  let xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross > p.x) {
    if (upward) {
      return 1;
    }
    return -1;
  }
  return 0;
}

fn heprQuadraticCrossingRootDelta(
  a: vec2<f32>,
  b: vec2<f32>,
  c: vec2<f32>,
  p: vec2<f32>,
  ay: f32,
  by: f32,
  t: f32
) -> i32 {
  if (t < -0.00001 || t >= 0.99999) {
    return 0;
  }
  let tc = clamp(t, 0.0, 1.0);
  let oneMinusT = 1.0 - tc;
  let xCross = oneMinusT * oneMinusT * a.x + 2.0 * oneMinusT * tc * b.x + tc * tc * c.x;
  if (xCross <= p.x) {
    return 0;
  }
  let dy = by + 2.0 * ay * tc;
  if (abs(dy) <= 0.000001) {
    return 0;
  }
  return select(-1, 1, dy > 0.0);
}

fn heprQuadraticWindingDelta(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, p: vec2<f32>) -> i32 {
  let ay = a.y - 2.0 * b.y + c.y;
  let by = 2.0 * (b.y - a.y);
  let cy = a.y - p.y;
  if (abs(ay) <= 0.00000001) {
    if (abs(by) <= 0.00000001) {
      return 0;
    }
    return heprQuadraticCrossingRootDelta(a, b, c, p, ay, by, -cy / by);
  }
  let discriminant = by * by - 4.0 * ay * cy;
  if (discriminant < 0.0) {
    return 0;
  }
  let sqrtDiscriminant = sqrt(max(discriminant, 0.0));
  let invDen = 0.5 / ay;
  let t0 = (-by - sqrtDiscriminant) * invDen;
  let t1 = (-by + sqrtDiscriminant) * invDen;
  var delta = heprQuadraticCrossingRootDelta(a, b, c, p, ay, by, t0);
  if (abs(t1 - t0) > 0.00001) {
    delta = delta + heprQuadraticCrossingRootDelta(a, b, c, p, ay, by, t1);
  }
  return delta;
}
`);

const textFragmentFn = TSL.wgslFn(`
fn heprTextFragment(
  local: vec2<f32>,
  glyphMetaA: vec4<f32>,
  instanceColor: vec4<f32>,
  normCoord: vec2<f32>,
  atlasPixels: vec2<f32>,
  rasterRect: vec4<f32>,
  rasterCenterTap: f32,
  rasterTapNegNeg: f32,
  rasterTapNegPos: f32,
  rasterTapPosNeg: f32,
  rasterTapPosPos: f32,
  vectorOnly: f32,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  textAAScreenPx: f32,
  textCurveEnabled: f32,
  vectorOverride: vec4<f32>
) -> vec4<f32> {
  let localDx = dpdx(local);
  let localDy = dpdy(local);
  let pixelToLocalX = length(vec2<f32>(localDx.x, localDy.x));
  let pixelToLocalY = length(vec2<f32>(localDx.y, localDy.y));
  let localPerPixel = max(pixelToLocalX, pixelToLocalY);
  let baseAAWidth = max(localPerPixel * textAAScreenPx, 0.0001);
  // Derivatives must be taken before any discard, so the atlas footprint is
  // measured here even when the vector path ends up handling the pixel.
  let atlasFootprint = min(fwidth(atlasPixels.x), fwidth(atlasPixels.y));

  let segmentStart = i32(glyphMetaA.x + 0.5);
  let segmentCount = i32(glyphMetaA.y + 0.5);
  if (segmentCount <= 0 || instanceColor.a <= 0.001) {
    discard;
  }

  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let tintedColor = instanceColor.rgb * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  // Once a glyph is minified past roughly two atlas texels per pixel, the
  // mipmapped coverage atlas is both cheaper and less aliased than evaluating
  // the outline per pixel.
  if (vectorOnly < 0.5 && rasterRect.z > 0.0 && rasterRect.w > 0.0 && atlasFootprint > 2.0) {
    let rasterCoverage = (1.0 / 3.0) * rasterCenterTap +
      (1.0 / 6.0) * (rasterTapNegNeg + rasterTapNegPos + rasterTapPosNeg + rasterTapPosPos);
    let rasterAlpha = clamp(rasterCoverage, 0.0, 1.0) * instanceColor.a;
    if (rasterAlpha <= 0.001) {
      discard;
    }
    return vec4<f32>(heprThreeOutputSrgbToLinear(tintedColor), rasterAlpha);
  }

  let coincidentEpsilon = max(baseAAWidth * 0.0001, 0.0000001);
  // Outside the antialiasing band the smoothstep below saturates, so the winding
  // number alone decides the pixel and exact distances stop mattering. The small
  // margin keeps coincident-edge grouping from losing a tie candidate.
  let aaCullDistance = baseAAWidth * 1.05 + coincidentEpsilon;

  // A tiny deterministic offset keeps exact-on-edge winding tests stable.
  let queryLocal = local + 0.001 * (localDx + 0.37 * localDy);
  var minDistance = 100000000000000000000.0;
  var nearestT = 0.0;
  var nearestPoint = vec2<f32>(0.0);
  var nearestNormal = vec2<f32>(1.0, 0.0);
  var nearestSideMultiplicity = 0;
  var winding = 0;
  let safeWidth = max(i32(segmentTexWidth), 1);

  for (var i = 0; i < 256; i = i + 1) {
    if (i >= segmentCount) {
      break;
    }

    let primitiveIndex = segmentStart + i;
    let coord = vec2<i32>(primitiveIndex % safeWidth, primitiveIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    let p0 = primitiveA.xy;
    let p1 = primitiveA.zw;
    let p2 = primitiveB.xy;
    let primitiveType = primitiveB.z;
    let isQuadratic = textCurveEnabled >= 0.5 && primitiveType >= 1.0;

    // A quadratic stays inside the hull of its control points, so this box
    // contains the primitive for both curve and line cases.
    var hullMin = min(p0, p2);
    var hullMax = max(p0, p2);
    if (isQuadratic) {
      hullMin = min(hullMin, p1);
      hullMax = max(hullMax, p1);
    }

    // The ray used for the winding test travels along +x, so it can only cross
    // this primitive within the box's y span and to the right of the query point.
    let mayCross = queryLocal.y >= hullMin.y && queryLocal.y <= hullMax.y && hullMax.x > queryLocal.x;

    // Distance to the box lower-bounds the distance to the primitive inside it.
    let boundOffset = max(max(hullMin - queryLocal, queryLocal - hullMax), vec2<f32>(0.0));
    let cullDistance = min(aaCullDistance, minDistance + coincidentEpsilon);
    let mayBeNearest = dot(boundOffset, boundOffset) <= cullDistance * cullDistance;

    if (!mayCross && !mayBeNearest) {
      continue;
    }

    if (mayBeNearest) {
      var distanceInfo: vec4<f32>;
      var closestPoint: vec2<f32>;
      if (isQuadratic) {
        distanceInfo = heprQuadraticDistanceInfo(queryLocal, p0, p1, p2);
        let oneMinusT = 1.0 - distanceInfo.y;
        closestPoint = oneMinusT * oneMinusT * p0 +
          2.0 * oneMinusT * distanceInfo.y * p1 + distanceInfo.y * distanceInfo.y * p2;
      } else {
        distanceInfo = heprLineDistanceInfo(queryLocal, p0, p2);
        closestPoint = mix(p0, p2, distanceInfo.y);
      }

      let signedOffset = dot(queryLocal - closestPoint, distanceInfo.zw);
      let sideStep = select(-1, 1, signedOffset >= 0.0);
      if (distanceInfo.x + coincidentEpsilon < minDistance) {
        minDistance = distanceInfo.x;
        nearestT = distanceInfo.y;
        nearestPoint = closestPoint;
        nearestNormal = distanceInfo.zw;
        nearestSideMultiplicity = sideStep;
      } else if (abs(distanceInfo.x - minDistance) <= coincidentEpsilon) {
        let normalAlignment = dot(distanceInfo.zw, nearestNormal);
        let bothInterior = distanceInfo.y > 0.0001 && distanceInfo.y < 0.9999 &&
          nearestT > 0.0001 && nearestT < 0.9999;
        let sameEdge = bothInterior && distance(closestPoint, nearestPoint) <= coincidentEpsilon &&
          abs(normalAlignment) >= 0.9999;
        if (sameEdge) {
          nearestSideMultiplicity = nearestSideMultiplicity + sideStep;
          minDistance = min(minDistance, distanceInfo.x);
        } else if (distanceInfo.x < minDistance) {
          minDistance = distanceInfo.x;
          nearestT = distanceInfo.y;
          nearestPoint = closestPoint;
          nearestNormal = distanceInfo.zw;
          nearestSideMultiplicity = sideStep;
        }
      }
    }

    if (mayCross) {
      if (isQuadratic) {
        winding = winding + heprQuadraticWindingDelta(p0, p1, p2, queryLocal);
      } else {
        winding = winding + heprLineWindingDelta(p0, p2, queryLocal);
      }
    }
  }

  let inside = winding != 0;
  let acrossWinding = winding - nearestSideMultiplicity;
  let nearestSeparatesFill = inside != (acrossWinding != 0);
  let signedDistance = select(minDistance, -minDistance, inside);
  let edgeAlpha = 1.0 - smoothstep(-baseAAWidth, baseAAWidth, signedDistance);
  // Nonzero fill stays opaque across overlap-only contour edges. Coincident
  // exterior edges are grouped above and antialiased as one true boundary.
  let alphaBase = select(select(0.0, 1.0, inside), edgeAlpha, nearestSeparatesFill);
  let alpha = alphaBase * instanceColor.a;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputSrgbToLinear(tintedColor), alpha);
}
`, [
  includeNode(threeWebGpuOutputSrgbToLinearFn),
  includeNode(distanceToLineSegmentFn),
  includeNode(distanceToQuadraticBezierFn),
  includeNode(textCrossingFns)
]);

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
  const instanceA = varyingNode(TSL.textureLoad(options.textInstanceTextureA, instanceCoord, 0));
  const instanceB = varyingNode(TSL.textureLoad(options.textInstanceTextureB, instanceCoord, 0));
  const instanceColor = varyingNode(TSL.textureLoad(options.textInstanceTextureC, instanceCoord, 0));
  const glyphCoord = callNode(coordFromIndexFn, {
    index: (instanceB as { z: unknown }).z,
    width: glyphTextureWidthUniform
  });
  const glyphMetaA = varyingNode(TSL.textureLoad(options.textGlyphMetaTextureA, glyphCoord, 0));
  const glyphMetaB = varyingNode(TSL.textureLoad(options.textGlyphMetaTextureB, glyphCoord, 0));
  const rasterRect = varyingNode(TSL.textureLoad(options.textGlyphRasterMetaTexture, glyphCoord, 0));
  const vertexPack = varyingNode(callNode(textVertexPackFn, {
    corner,
    instanceA,
    instanceB,
    glyphMetaA,
    glyphMetaB
  }));
  const vertexPackValue = vertexPack as { zw: unknown };

  material.vertexNode = callNode(textClipFn, {
    vertexPack,
    viewport: TSL.uniform(options.viewport),
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: TSL.uniform(options.localToClip)
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
  const rasterAtlasLod = callNode(textRasterAtlasLodFn, { atlasPixels });
  const rasterTap = (offsetX: number, offsetY: number): never => sampleRasterAtlasCoverage(
    options.textRasterAtlasTexture,
    callNode(textRasterAtlasTapUvFn, {
      normCoord,
      atlasPixels,
      rasterRect,
      atlasSize: rasterAtlasSizeUniform,
      offsetX: TSL.float(offsetX),
      offsetY: TSL.float(offsetY)
    }),
    rasterAtlasLod
  );

  material.fragmentNode = callNode(textFragmentFn, {
    local: vertexPackValue.zw,
    glyphMetaA,
    instanceColor,
    normCoord,
    atlasPixels,
    rasterRect,
    rasterCenterTap: rasterTap(0, 0),
    rasterTapNegNeg: rasterTap(-1, -1),
    rasterTapNegPos: rasterTap(-1, 1),
    rasterTapPosNeg: rasterTap(1, -1),
    rasterTapPosPos: rasterTap(1, 1),
    vectorOnly: vectorOnlyUniform,
    segmentTexA: TSL.textureLoad(options.textGlyphSegmentTextureA),
    segmentTexB: TSL.textureLoad(options.textGlyphSegmentTextureB),
    segmentTexWidth: segmentTextureWidthUniform,
    textAAScreenPx: textAAScreenPxUniform,
    textCurveEnabled: curveUniform,
    vectorOverride: TSL.uniform(options.vectorOverride)
  });

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    curveUniform: curveUniform as MutableUniform<number>,
    vectorOnlyUniform: vectorOnlyUniform as MutableUniform<number>
  };
}
