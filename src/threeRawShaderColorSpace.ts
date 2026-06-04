const OUTPUT_ENCODING_HELPER = `
vec3 heprThreeLinearToOutputSrgb(vec3 color) {
  vec3 safeColor = max(color, vec3(0.0));
  vec3 cutoff = step(safeColor, vec3(0.0031308));
  vec3 lower = safeColor * 12.92;
  vec3 higher = 1.055 * pow(safeColor, vec3(1.0 / 2.4)) - 0.055;
  return mix(higher, lower, cutoff);
}

vec4 heprThreeEncodeOutputColor(vec4 color) {
  return vec4(heprThreeLinearToOutputSrgb(color.rgb), color.a);
}

float heprThreeLinearCoverageToOutputAlpha(float coverage) {
  float safeCoverage = clamp(coverage, 0.0, 1.0);
  return 1.0 - heprThreeLinearToOutputSrgb(vec3(1.0 - safeCoverage)).r;
}
`;

export function normalizeThreeRawShaderSource(source: string, encodeOutput = false): string {
  const normalized = source.replace(/^\s*#version\s+300\s+es\s*/m, "");
  if (!encodeOutput) {
    return normalized;
  }

  return injectOutputEncoding(normalized);
}

export function encodeThreeShaderOutputToSrgb(source: string): string {
  return injectOutputEncoding(source);
}

export function normalizeThreeTextRawFragmentShaderSource(source: string): string {
  return normalizeThreeRawShaderSource(
    useGammaCorrectTextCoverage(useWebGpuTextWinding(source)),
    true
  );
}

export function normalizeThreeStrokeRawFragmentShaderSource(source: string): string {
  return normalizeThreeRawShaderSource(useGammaCorrectStrokeCoverage(source), true);
}

const WEBGPU_TEXT_WINDING_GLSL = `
void accumulateQuadraticCrossing(vec2 a, vec2 b, vec2 c, vec2 p, inout int winding) {
  vec2 prev = a;
  for (int i = 1; i <= QUAD_WINDING_SUBDIVISIONS; i += 1) {
    float t = float(i) / float(QUAD_WINDING_SUBDIVISIONS);
    vec2 next = evaluateQuadratic(a, b, c, t);
    accumulateLineCrossing(prev, next, p, winding);
    prev = next;
  }
}
`;

function useWebGpuTextWinding(source: string): string {
  const start = source.indexOf("void accumulateQuadraticCrossingRoot(");
  if (start < 0) {
    return source;
  }

  const end = source.indexOf("void main()", start);
  if (end < 0) {
    return source;
  }

  return `${source.slice(0, start)}${WEBGPU_TEXT_WINDING_GLSL}\n${source.slice(end)}`;
}

function useGammaCorrectTextCoverage(source: string): string {
  return source.replace(
    "float alpha = alphaBase * vColorAlpha;",
    "float alpha = heprThreeLinearCoverageToOutputAlpha(alphaBase) * vColorAlpha;"
  );
}

function useGammaCorrectStrokeCoverage(source: string): string {
  return source
    .replace(
      "float alpha = coverage * vAlpha;",
      "float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;"
    )
    .replace(
      "float alpha = coverage * vColor.a;",
      "float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vColor.a;"
    );
}

function injectOutputEncoding(source: string): string {
  if (source.includes("heprThreeEncodeOutputColor")) {
    return source;
  }

  const encodedAssignments = source.replace(
    /\b(outColor|gl_FragColor)\s*=\s*(vec4\([^\n;]+\));/g,
    "$1 = heprThreeEncodeOutputColor($2);"
  );

  const precisionHeaderMatch = /^((?:\s*precision\s+\w+\s+\w+\s*;\s*)+)/.exec(encodedAssignments);
  if (!precisionHeaderMatch) {
    return `${OUTPUT_ENCODING_HELPER}\n${encodedAssignments}`;
  }

  const headerEnd = precisionHeaderMatch[0].length;
  return `${encodedAssignments.slice(0, headerEnd)}\n${OUTPUT_ENCODING_HELPER}\n${encodedAssignments.slice(headerEnd)}`;
}
