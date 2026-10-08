import { VECTOR_CLIP_GLSL, VECTOR_CLIP_AA_WGSL } from "./vectorClipShaders";

// PDF image tiles often overlap behind rectangular clips. Antialiasing each
// rectangle separately fades both images at a shared edge; source-over cannot
// add their coverage back together. Test rectangle clips at the pixel centre,
// including page clips, while keeping the shared antialiasing for polygons.
export const RASTER_CLIP_RECT_GLSL = `
uint heprRasterClipRectSamples(vec4 bounds, vec2 point) {
  bool inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return inside ? 0xFFFFu : 0u;
}
`;

// Some tile rectangles have a 0.001-point skew from PDF decimal rounding.
// Keep their exact winding, but give these nearly axis-aligned quads the same
// solid coverage. This does not approximate or widen the clipping geometry.
const RASTER_CLIP_POLYGON_GLSL = `
uint heprRasterClipPolygonSamples(vec4 node, vec2 point, vec4 sampleX, vec4 sampleY, float span) {
  bool tileRect = node.z == 4.0 && (int(node.w) & 6) == 0;
  if (tileRect) {
    for (int edge = 0; edge < 4; edge++) {
      vec4 line = heprClipTexel(int(node.y) + edge);
      tileRect = tileRect && min(abs(line.x - line.z), abs(line.y - line.w)) <= 0.002;
    }
  }
  if (tileRect) {
    sampleX = vec4(point.x);
    sampleY = vec4(point.y);
    span = 0.0;
  }
  return heprClipPolygonSamples(node, sampleX, sampleY, span);
}
`;

export const RASTER_CLIP_GLSL = RASTER_CLIP_RECT_GLSL + VECTOR_CLIP_GLSL.replace(
  "heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)",
  "heprRasterClipRectSamples(heprClipTexel(int(node.y)), point)"
).replace("heprClipPolygonSamples(node, sampleX, sampleY, span);",
  "heprRasterClipPolygonSamples(node, point, sampleX, sampleY, span);")
  .replace("float heprVectorClipAA(vec2 point, float aaWidth)",
    RASTER_CLIP_POLYGON_GLSL + "float heprVectorClipAA(vec2 point, float aaWidth)");

export const RASTER_CLIP_RECT_WGSL = /* wgsl */ `
fn heprRasterClipRectSamples(bounds: vec4<f32>, point: vec2<f32>) -> u32 {
  let inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return select(0u, 0xFFFFu, inside);
}
`;

const RASTER_CLIP_POLYGON_WGSL = /* wgsl */ `
fn heprRasterClipPolygonSamples(clipTexture: texture_2d<f32>, node: vec4<f32>, point: vec2<f32>,
    sampleX: vec4<f32>, sampleY: vec4<f32>, span: f32) -> u32 {
  var tileRect = node.z == 4.0 && (i32(node.w) & 6) == 0;
  if (tileRect) {
    for (var edge = 0; edge < 4; edge++) {
      let line = heprClipTexel(clipTexture, i32(node.y) + edge);
      tileRect = tileRect && min(abs(line.x - line.z), abs(line.y - line.w)) <= 0.002;
    }
  }
  if (tileRect) { return heprClipPolygonSamples(clipTexture, node, vec4<f32>(point.x), vec4<f32>(point.y), 0.0); }
  return heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);
}
`;

// TSL uses the first WGSL function as its entry point; helpers must follow it.
export const RASTER_CLIP_WGSL = VECTOR_CLIP_AA_WGSL.replace(
  "heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY)",
  "heprRasterClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), point)"
).replace("heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);",
  "heprRasterClipPolygonSamples(clipTexture, node, point, sampleX, sampleY, span);")
  + RASTER_CLIP_RECT_WGSL + RASTER_CLIP_POLYGON_WGSL;
