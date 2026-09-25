import { MAX_VECTOR_CLIP_DEPTH, MAX_VECTOR_CLIP_EDGES } from "./vectorClips";

// The width is supplied by the caller so derivatives can be taken before any
// divergent control flow or discard. A distance probe limits supersampling to
// boundary pixels; winding samples preserve holes and overlapping subpaths,
// whose internal edges must not become translucent distance-field seams.
function vectorClipGlsl(antialias: boolean): string {
  return `
float ${antialias ? "heprVectorClipAA(vec2 point, float aaWidth)" : "heprVectorClip(vec2 point)"} {
  ${antialias ? "" : "const float aaWidth = 0.0;"}
  bool needsSampling = false;
  float radius = aaWidth * 0.75;
  highp int index = int(uVectorClipIndex);
  for (highp int depth = 0; depth < ${MAX_VECTOR_CLIP_DEPTH}; depth++) {
    if (index < 0) break;
    vec4 node = heprClipTexel(index);
    if (node.z < 0.0) {
      vec4 bounds = heprClipTexel(int(node.y));
      if (aaWidth > 0.0) {
        if (any(greaterThanEqual(bounds.xy, bounds.zw))) return 0.0;
        vec2 inset = min(point - bounds.xy, bounds.zw - point);
        if (min(inset.x, inset.y) <= -radius) return 0.0;
        needsSampling = needsSampling || min(inset.x, inset.y) < radius;
      } else {
        // Match polygon winding at boundaries: include min, exclude max.
        if (any(lessThan(point, bounds.xy)) || any(greaterThanEqual(point, bounds.zw))) return 0.0;
      }
      index = int(node.x);
      continue;
    }
    highp int firstBand = 0;
    highp int lastBand = 0;
    highp int rowBand = 0;
    vec4 bands = vec4(0.0);
    if (node.w >= 2.0) {
      bands = heprClipTexel(int(node.y));
      // Clamp in float before converting: far-offscreen points can exceed i32.
      rowBand = int(clamp(floor((point.y - bands.y) / bands.z), 0.0, bands.w - 1.0));
      firstBand = int(clamp(floor((point.y - radius - bands.y) / bands.z), 0.0, bands.w - 1.0));
      lastBand = int(clamp(floor((point.y + radius - bands.y) / bands.z), 0.0, bands.w - 1.0));
    }
    highp int winding = 0;
    float minDistance = radius;
    for (highp int band = firstBand; band <= lastBand; band++) {
      highp int firstEdge = int(node.y);
      highp int edgeCount = int(node.z);
      if (node.w >= 2.0) {
        vec4 range = heprClipTexel(int(bands.x) + band);
        firstEdge = int(range.x);
        edgeCount = int(range.y);
      }
      for (highp int edge = 0; edge < ${MAX_VECTOR_CLIP_EDGES}; edge++) {
        if (edge >= edgeCount) break;
        vec4 line = heprClipTexel(firstEdge + edge);
        // An edge can appear in several bands; only the center row counts it.
        if (band == rowBand && (line.y > point.y) != (line.w > point.y)) {
          float x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) winding += line.w > line.y ? 1 : -1;
        }
        // Distant edges affect winding only. Keep distance work at the boundary.
        if (aaWidth > 0.0 && all(greaterThanEqual(point, min(line.xy, line.zw) - vec2(radius))) &&
            all(lessThanEqual(point, max(line.xy, line.zw) + vec2(radius)))) {
          vec2 delta = line.zw - line.xy;
          float squaredLength = dot(delta, delta);
          float t = squaredLength > 0.0 ? clamp(dot(point - line.xy, delta) / squaredLength, 0.0, 1.0) : 0.0;
          minDistance = min(minDistance, length(point - (line.xy + t * delta)));
        }
      }
    }
    bool inside = (int(node.w) & 1) != 0 ? (abs(winding) % 2 != 0) : winding != 0;
    if (aaWidth > 0.0) {
      if (minDistance < radius) needsSampling = true;
      else if (!inside) return 0.0;
    } else if (!inside) return 0.0;
    index = int(node.x);
  }
  if (index >= 0) return 0.0;
  ${antialias ? `
  if (needsSampling) {
    // A 4x4 pixel grid is bounded by the 0.75-pixel distance probe above.
    // Sample the whole intersection, so coincident ancestors do not fade twice.
    float coverage = 0.0;
    for (highp int y = 0; y < 4; y++) {
      for (highp int x = 0; x < 4; x++) {
        vec2 offset = (vec2(float(x), float(y)) + 0.5) * 0.25 - 0.5;
        coverage += heprVectorClip(point + offset * aaWidth);
      }
    }
    return coverage * 0.0625;
  }` : ""}
  return 1.0;
}
`;
}

export const VECTOR_CLIP_GLSL = `
uniform highp sampler2D uVectorClipTex;
uniform float uVectorClipIndex;
vec4 heprClipTexel(highp int index) {
  highp int width = textureSize(uVectorClipTex, 0).x;
  return texelFetch(uVectorClipTex, ivec2(index % width, index / width), 0);
}
` + vectorClipGlsl(false) + vectorClipGlsl(true);

function vectorClipWgsl(antialias: boolean): string {
  return `
fn ${antialias ? "heprVectorClipAA" : "heprVectorClip"}(point: vec2<f32>, clipIndex: f32, clipTexture: texture_2d<f32>${antialias ? ", aaWidth: f32" : ""}) -> f32 {
  ${antialias ? "" : "let aaWidth = 0.0;"}
  let width = i32(textureDimensions(clipTexture).x);
  var needsSampling = false;
  let radius = aaWidth * 0.75;
  var index = i32(clipIndex);
  for (var depth = 0; depth < ${MAX_VECTOR_CLIP_DEPTH}; depth++) {
    if (index < 0) { break; }
    let node = textureLoad(clipTexture, vec2<i32>(index % width, index / width), 0);
    if (node.z < 0.0) {
      let offset = i32(node.y);
      let bounds = textureLoad(clipTexture, vec2<i32>(offset % width, offset / width), 0);
      if (aaWidth > 0.0) {
        if (any(bounds.xy >= bounds.zw)) { return 0.0; }
        let inset = min(point - bounds.xy, bounds.zw - point);
        if (min(inset.x, inset.y) <= -radius) { return 0.0; }
        needsSampling = needsSampling || min(inset.x, inset.y) < radius;
      } else {
        if (any(point < bounds.xy) || any(point >= bounds.zw)) { return 0.0; }
      }
      index = i32(node.x);
      continue;
    }
    var firstBand = 0;
    var lastBand = 0;
    var rowBand = 0;
    var bands = vec4<f32>(0.0);
    if (node.w >= 2.0) {
      let offset = i32(node.y);
      bands = textureLoad(clipTexture, vec2<i32>(offset % width, offset / width), 0);
      rowBand = i32(clamp(floor((point.y - bands.y) / bands.z), 0.0, bands.w - 1.0));
      firstBand = i32(clamp(floor((point.y - radius - bands.y) / bands.z), 0.0, bands.w - 1.0));
      lastBand = i32(clamp(floor((point.y + radius - bands.y) / bands.z), 0.0, bands.w - 1.0));
    }
    var winding = 0;
    var minDistance = radius;
    for (var band = firstBand; band <= lastBand; band++) {
      var firstEdge = i32(node.y);
      var edgeCount = i32(node.z);
      if (node.w >= 2.0) {
        let tableOffset = i32(bands.x) + band;
        let range = textureLoad(clipTexture, vec2<i32>(tableOffset % width, tableOffset / width), 0);
        firstEdge = i32(range.x);
        edgeCount = i32(range.y);
      }
      for (var edge = 0; edge < ${MAX_VECTOR_CLIP_EDGES}; edge++) {
        if (edge >= edgeCount) { break; }
        let offset = firstEdge + edge;
        let line = textureLoad(clipTexture, vec2<i32>(offset % width, offset / width), 0);
        if (band == rowBand && (line.y > point.y) != (line.w > point.y)) {
          let x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) { winding += select(-1, 1, line.w > line.y); }
        }
        if (aaWidth > 0.0 && all(point >= min(line.xy, line.zw) - vec2<f32>(radius)) &&
            all(point <= max(line.xy, line.zw) + vec2<f32>(radius))) {
          let delta = line.zw - line.xy;
          let squaredLength = dot(delta, delta);
          var t = 0.0;
          if (squaredLength > 0.0) { t = clamp(dot(point - line.xy, delta) / squaredLength, 0.0, 1.0); }
          minDistance = min(minDistance, length(point - (line.xy + t * delta)));
        }
      }
    }
    let inside = select(winding != 0, abs(winding) % 2 != 0, (i32(node.w) & 1) != 0);
    if (aaWidth > 0.0) {
      if (minDistance < radius) { needsSampling = true; }
      else if (!inside) { return 0.0; }
    } else if (!inside) { return 0.0; }
    index = i32(node.x);
  }
  if (index >= 0) { return 0.0; }
  ${antialias ? `
  if (needsSampling) {
    var coverage = 0.0;
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        let offset = (vec2<f32>(f32(x), f32(y)) + vec2<f32>(0.5)) * 0.25 - vec2<f32>(0.5);
        coverage += heprVectorClip(point + offset * aaWidth, clipIndex, clipTexture);
      }
    }
    return coverage * 0.0625;
  }` : ""}
  return 1.0;
}
`;
}

export const VECTOR_CLIP_WGSL = vectorClipWgsl(false);
export const VECTOR_CLIP_AA_WGSL = vectorClipWgsl(true) + VECTOR_CLIP_WGSL;

export const VECTOR_INSTANCE_CLIP_GLSL = `flat in float vVectorClipIndex;\n` +
  VECTOR_CLIP_GLSL.replaceAll("int(uVectorClipIndex)", "int(uVectorClipIndex < -1.5 ? vVectorClipIndex : uVectorClipIndex)");
