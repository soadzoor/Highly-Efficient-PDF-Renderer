import {
  VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE,
  FILL_VERTEX_SHADER_SOURCE, FILL_FRAGMENT_SHADER_SOURCE
} from "./nativeWebGlCoreShaders";
import { VECTOR_INSTANCE_CLIP_GLSL } from "./vectorClipShaders";

/** Each branch shares the ordinary quad, primitive ID and clip attributes. */
export const MIXED_VECTOR_KIND_ATTRIBUTE = 5;
/** Conservative count before a linker packs the shared scalar varyings. */
export const MIXED_VECTOR_VARYING_VECTORS = 10;

const privateVaryings = new Set([
  "vP0", "vP1", "vP2", "vPrimitiveType", "vIsHairline", "vHalfWidth", "vAAWorld",
  "vClipBounds", "vHasClipBounds", "vSegmentStart", "vSegmentCount", "vFillBands",
  "vFillCells", "vFillOrigin", "vFillBoundsMax", "vFillSignedArea", "vFillRule", "vFillHasCompanionStroke"
]);

/** Keep the existing geometry/coverage functions as the single source of truth. */
function branchSource(source: string, entry: string): string {
  return source.replace(/^#version 300 es\s*/, "")
    .replace(/void main\(\)/, `void ${entry}()`)
    .replace(/^(?:flat )?(?:in|out) (\w+) (\w+);$/gm, (declaration, type: string, name: string) =>
      privateVaryings.has(name) ? `${type} ${name} = ${type}(0);` : declaration);
}

function mergeSources(first: string, second: string): string {
  const declarations = new Set<string>();
  return `#version 300 es\nprecision highp float;\nprecision highp int;\n${first}\n${second}`.replace(
    /^(?:precision |uniform |(?:layout\([^\n]*\) )?(?:flat )?(?:in|out) )[^\n]*;$/gm,
    declaration => {
      if (declarations.has(declaration)) return "";
      declarations.add(declaration);
      return declaration;
    });
}

function withoutColorHelpers(source: string): string {
  return source.replace(/vec4 heprThreeEncodeOutputColor\(vec4 color\) \{[^}]*\}/, "")
    .replace(/float heprThreeLinearCoverageToOutputAlpha\(float coverage\) \{[^}]*\}/, "");
}

const vertexStroke = branchSource(VERTEX_SHADER_SOURCE, "heprMixedStrokeVertex")
  .replaceAll("aSegmentIndex", "aVectorIndex");
const vertexFill = branchSource(FILL_VERTEX_SHADER_SOURCE, "heprMixedFillVertex")
  .replace("layout(location = 3)", "layout(location = 1)")
  .replaceAll("aFillPathIndex", "aVectorIndex");

/**
 * Attribute 1 is the original primitive ID, 4 is clip + 1, and 5 is kind
 * (0 stroke, 1 fill). The union keeps the original integer fill addresses and
 * fits below WebGL 2's varying capacity without carrying both payloads.
 */
export const MIXED_VECTOR_VERTEX_SHADER_SOURCE = mergeSources(vertexStroke, vertexFill) + `
layout(location = 5) in float aVectorKind;
uniform vec2 uMixedVectorEnabled;
flat out float vVectorKind;
flat out vec4 vMixedA;
flat out vec4 vMixedB;
flat out vec4 vMixedC;
flat out vec4 vMixedD;
flat out ivec2 vMixedSegments;

void main() {
  vVectorKind = aVectorKind;
  if ((aVectorKind < 0.5 ? uMixedVectorEnabled.x : uMixedVectorEnabled.y) < 0.5) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vLocal = vec2(0.0); vColor = vec3(0.0); vAlpha = 0.0;
    vVectorClipIndex = -1.0;
    vMixedA = vec4(0.0); vMixedB = vec4(0.0);
    vMixedC = vec4(0.0); vMixedD = vec4(0.0); vMixedSegments = ivec2(0);
    return;
  }
  if (aVectorKind < 0.5) {
    heprMixedStrokeVertex();
    vMixedA = vec4(vP0, vP1);
    vMixedB = vec4(vP2, vPrimitiveType, vIsHairline);
    vMixedC = vec4(vHalfWidth, vHasClipBounds, 0.0, 0.0);
    vMixedD = vClipBounds;
    vMixedSegments = ivec2(0);
  } else {
    heprMixedFillVertex();
    vMixedA = vFillBands;
    vMixedB = vFillCells;
    vMixedC = vec4(vFillOrigin, vFillRule, vFillSignedArea);
    vMixedD = vec4(vFillBoundsMax, 0.0, 0.0);
    vMixedSegments = ivec2(vSegmentStart, vSegmentCount);
  }
}
`;

const fragmentStroke = branchSource(FRAGMENT_SHADER_SOURCE, "heprMixedStrokeFragment")
  .replace("length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)))", "heprMixedLocalPerPixel.x")
  .replace("length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))", "heprMixedLocalPerPixel.y");
const fragmentFill = withoutColorHelpers(branchSource(FILL_FRAGMENT_SHADER_SOURCE, "heprMixedFillFragment")
  .replace(VECTOR_INSTANCE_CLIP_GLSL, ""))
  // Reserved by some GLES compilers; changing the local name preserves reads.
  .replace(/\bpacked\b/g, "packedFillIndices")
  .replace(/vec2 footprint = max\(vec2\(\s*length\(vec2\(dFdx\(vLocal.x\), dFdy\(vLocal.x\)\)\),\s*length\(vec2\(dFdx\(vLocal.y\), dFdy\(vLocal.y\)\)\)\s*\) \* uFillAAScreenPx, vec2\(1e-4\)\);/,
    "vec2 footprint = max(heprMixedLocalPerPixel * uFillAAScreenPx, vec2(1e-4));");

export const MIXED_VECTOR_FRAGMENT_SHADER_SOURCE = mergeSources(
  // The branch helpers read this global after main computes it for every lane.
  `vec2 heprMixedLocalPerPixel = vec2(0.0);\n${fragmentStroke}`, fragmentFill) + `
flat in float vVectorKind;
flat in vec4 vMixedA;
flat in vec4 vMixedB;
flat in vec4 vMixedC;
flat in vec4 vMixedD;
flat in ivec2 vMixedSegments;

void main() {
  // Derivatives precede the kind branch and either paint's early discards.
  heprMixedLocalPerPixel = vec2(
    length(vec2(dFdx(vLocal.x), dFdy(vLocal.x))),
    length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))
  );
  if (vVectorKind < 0.5) {
    vP0 = vMixedA.xy;
    vP1 = vMixedA.zw;
    vP2 = vMixedB.xy;
    vPrimitiveType = vMixedB.z;
    vIsHairline = vMixedB.w;
    vHalfWidth = vMixedC.x;
    vHasClipBounds = vMixedC.y;
    vClipBounds = vMixedD;
    heprMixedStrokeFragment();
  } else {
    vFillBands = vMixedA;
    vFillCells = vMixedB;
    vFillOrigin = vMixedC.xy;
    vFillRule = vMixedC.z;
    vFillSignedArea = vMixedC.w;
    vFillBoundsMax = vMixedD.xy;
    vSegmentStart = vMixedSegments.x;
    vSegmentCount = vMixedSegments.y;
    heprMixedFillFragment();
  }
}
`;
