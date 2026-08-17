const OUTPUT_ENCODING_HELPER = `
vec4 heprThreeEncodeOutputColor(vec4 color) {
  // Scene colors come from PDF.js in display/sRGB space. Raw materials bypass
  // Three's output-color chunks, so the stored components are the output values.
  return color;
}

float heprThreeLinearCoverageToOutputAlpha(float coverage) {
  return clamp(coverage, 0.0, 1.0);
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
    useGammaCorrectTextCoverage(source),
    true
  );
}

export function normalizeThreeStrokeRawFragmentShaderSource(source: string): string {
  return normalizeThreeRawShaderSource(useGammaCorrectStrokeCoverage(source), true);
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
