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
