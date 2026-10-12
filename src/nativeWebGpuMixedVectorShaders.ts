/** Native ordered vectors share the existing coverage math and only pack their varyings differently. */
export const MIXED_VECTOR_WGPU_VERTEX_TEXTURES = 8;
export const MIXED_VECTOR_WGPU_FRAGMENT_TEXTURES = 3;
export const MIXED_VECTOR_WGPU_VARYING_VARIABLES = 10;
export const MIXED_VECTOR_WGPU_VARYING_COMPONENTS = 26;

function removeBlock(source: string, prefix: string): string {
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Missing mixed vector shader block: ${prefix}`);
  const open = source.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  if (source[end] === ";") end++;
  return source.slice(0, start) + source.slice(end);
}

function privateOutput(source: string, name: string): string {
  return source.replace(/struct VsOut \{([\s\S]*?)\};/, (_match, fields: string) =>
    `struct ${name} {${fields.replace(/@(?:location|builtin|interpolate)\([^)]*\)\s*/g, "")}};`)
    .replace(/\bVsOut\b/g, name)
    .replace(/@vertex\s+fn vsMain\(@builtin\(vertex_index\) vertexIndex : u32, @builtin\(instance_index\) instanceIndex : u32\)/,
      `fn ${name}Vertex(vertexIndex : u32, instanceIndex : u32)`)
    .replace(/@fragment\s+fn fsMain\(inData : \w+\) -> @location\(0\) vec4f/,
      `fn ${name}Fragment(inData : ${name}) -> vec4f`);
}

/** Keep the separate shaders authoritative for clipping, analytic strokes and area coverage. */
export function buildNativeWebGpuMixedVectorShader(strokeSource: string, fillSource: string): string {
  let stroke = privateOutput(strokeSource, "MixedStrokeData");
  stroke = removeBlock(stroke, "struct SegmentIdBuffer");
  stroke = stroke.replace(/@group\(0\) @binding\(5\) var<storage, read> uSegmentIds : SegmentIdBuffer;/, "")
    .replace(/var segmentIndex: u32;\s*if \(uVectorClip.x < -1.5\) \{ segmentIndex = uOrderedInstances\[instanceIndex\].x; \}\s*else \{ segmentIndex = uSegmentIds.values\[instanceIndex\]; \}/,
      "let segmentIndex = uMixedInstances[instanceIndex * 3u];")
    .replace(/\bcoordFromIndex\b/g, "mixedStrokeCoordFromIndex");
  let fill = privateOutput(fillSource, "MixedFillData");
  fill = removeBlock(fill, "struct CameraUniforms");
  fill = fill.replace(/@group\(0\) @binding\(0\) var<uniform> uCamera : CameraUniforms;/, "")
    .replace(/@group\(0\) @binding\(([1-5])\)/g, (_match, index: string) => `@group(0) @binding(${Number(index) + 4})`)
    .replace(/var pathIndex = i32\(instanceIndex\);\s*if \(uVectorClip.x < -1.5\) \{ pathIndex = i32\(uOrderedInstances\[instanceIndex\].x\); \}/,
      "let pathIndex = i32(uMixedInstances[instanceIndex * 3u]);")
    .replace(/\bcoordFromIndex\b/g, "mixedFillCoordFromIndex");
  // The common helpers are byte-for-byte those of the separate programs.
  const strokeFunctions = new Set(Array.from(stroke.matchAll(/\bfn (\w+)\(/g), match => match[1]));
  for (const match of Array.from(fill.matchAll(/\bfn (\w+)\(/g))) {
    if (strokeFunctions.has(match[1])) fill = removeBlock(fill, `fn ${match[1]}(`);
  }
  fill = fill.replace(/@group\(1\)[^\n]*\n/g, "");
  const clipIndex = /out.vectorClipIndex = uVectorClip.x;\s*if \(uVectorClip.x < -1.5\) \{ out.vectorClipIndex = f32\(uOrderedInstances\[instanceIndex\].y\) - 1.0; \}/g;
  stroke = stroke.replace(clipIndex, "out.vectorClipIndex = f32(uMixedInstances[instanceIndex * 3u + 1u]) - 1.0;")
    .replace(/uOrderedInstances: array<vec2u>/, "uMixedInstances: array<u32>");
  fill = fill.replace(clipIndex, "out.vectorClipIndex = f32(uMixedInstances[instanceIndex * 3u + 1u]) - 1.0;");
  const footprint = /  \/\/ The path-space footprint of this pixel, taken before any discard\.\n(  let footprint = max\([\s\S]*?vec2f\(1e-4\)\);)/;
  const footprintMatch = fill.match(footprint);
  if (!footprintMatch) throw new Error("Missing mixed vector fill footprint");
  fill = fill.replace(footprint, "")
    .replace("fn MixedFillDataFragment(inData : MixedFillData)", "fn MixedFillDataFragment(inData : MixedFillData, footprint : vec2f)");
  return `${stroke}\n${fill}\n
struct MixedVectorData {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) alpha: f32,
  @location(3) @interpolate(flat) vectorClipIndex: f32,
  @location(4) @interpolate(flat) kind: u32,
  @location(5) @interpolate(flat) data0: vec4f,
  @location(6) @interpolate(flat) data1: vec4f,
  @location(7) @interpolate(flat) data2: vec4f,
  @location(8) @interpolate(flat) data3: vec4f,
  @location(9) @interpolate(flat) indices: vec2i,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> MixedVectorData {
  var out: MixedVectorData;
  out.kind = uMixedInstances[instanceIndex * 3u + 2u];
  if (out.kind == 0u) {
    let value = MixedStrokeDataVertex(vertexIndex, instanceIndex);
    out.position = value.position; out.local = value.local;
    out.color = value.color; out.alpha = value.alpha; out.vectorClipIndex = value.vectorClipIndex;
    out.data0 = vec4f(value.p0, value.p1);
    out.data1 = vec4f(value.p2, value.halfWidth, value.aaWorld);
    out.data2 = vec4f(value.primitiveType, value.hasClipBounds, 0.0, 0.0);
    out.data3 = value.clipBounds;
  } else {
    let value = MixedFillDataVertex(vertexIndex, instanceIndex);
    out.position = value.position; out.local = value.local;
    out.color = value.color; out.alpha = value.alpha; out.vectorClipIndex = value.vectorClipIndex;
    out.data0 = value.bands; out.data1 = value.cells;
    out.data2 = vec4f(value.origin, value.fillRule, value.fillHasCompanionStroke);
    out.indices = vec2i(value.segmentStart, value.segmentCount);
  }
  return out;
}

@fragment
fn fsMain(inData: MixedVectorData) -> @location(0) vec4f {
  // Derivatives must precede the per-instance dispatch, whose condition is not uniform.
${footprintMatch[1]}
  if (inData.kind == 0u) {
    var value: MixedStrokeData;
    value.local = inData.local; value.color = inData.color; value.alpha = inData.alpha;
    value.vectorClipIndex = inData.vectorClipIndex;
    value.p0 = inData.data0.xy; value.p1 = inData.data0.zw; value.p2 = inData.data1.xy;
    value.halfWidth = inData.data1.z; value.aaWorld = inData.data1.w;
    value.primitiveType = inData.data2.x; value.hasClipBounds = inData.data2.y;
    value.clipBounds = inData.data3;
    return MixedStrokeDataFragment(value);
  }
  var value: MixedFillData;
  value.local = inData.local; value.color = inData.color; value.alpha = inData.alpha;
  value.vectorClipIndex = inData.vectorClipIndex;
  value.bands = inData.data0; value.cells = inData.data1; value.origin = inData.data2.xy;
  value.fillRule = inData.data2.z; value.fillHasCompanionStroke = inData.data2.w;
  value.segmentStart = inData.indices.x; value.segmentCount = inData.indices.y;
  return MixedFillDataFragment(value, footprint);
}
`;
}
