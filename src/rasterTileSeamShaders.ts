/**
 * Adjacent opaque images share a geometric boundary inside their small gap.
 * Integrate the original empty interval once on either side of that boundary,
 * rather than fading two independent image edges with source-over blending.
 * Source pixels/UVs stay unchanged and sufficiently magnified gaps stay empty.
 */
export const RASTER_TILE_SEAM_GLSL = `
float heprRasterGapCoverage(float point, float footprint, float lo, float hi) {
  float width = max(footprint, 1e-8);
  return clamp((min(point + width * 0.5, hi) - max(point - width * 0.5, lo)) / width, 0.0, 1.0);
}

float heprRasterTileSeamCoverage(vec2 point, vec2 footprint, vec4 bounds, vec4 gaps) {
  float x = 1.0 - heprRasterGapCoverage(point.x, footprint.x, bounds.x - gaps.x, bounds.x)
    - heprRasterGapCoverage(point.x, footprint.x, bounds.z, bounds.z + gaps.z);
  float y = 1.0 - heprRasterGapCoverage(point.y, footprint.y, bounds.y - gaps.y, bounds.y)
    - heprRasterGapCoverage(point.y, footprint.y, bounds.w, bounds.w + gaps.w);
  // A footprint wider than a tile can reach further, unrecorded neighbors.
  // Preserve the original geometry sampling in that axis rather than invent
  // coverage from only the two immediately adjacent empty intervals.
  if (gaps.x + gaps.z > 0.0 && footprint.x > bounds.z - bounds.x) {
    x = point.x >= bounds.x && point.x < bounds.z ? 1.0 : 0.0;
  }
  if (gaps.y + gaps.w > 0.0 && footprint.y > bounds.w - bounds.y) {
    y = point.y >= bounds.y && point.y < bounds.w ? 1.0 : 0.0;
  }
  return clamp(x, 0.0, 1.0) * clamp(y, 0.0, 1.0);
}
`;

export const RASTER_TILE_SEAM_VERTEX_GLSL = `
vec4 heprRasterOriginalBounds(vec4 matrixABCD, vec2 matrixEF) {
  vec2 other = matrixEF + matrixABCD.xy + matrixABCD.zw;
  return vec4(min(matrixEF, other), max(matrixEF, other));
}

vec4 heprRasterTileSeamPack(vec2 uv, vec4 matrixABCD, vec2 matrixEF, vec4 bounds) {
  // Only axis-preserving source matrices use this path. Select the SAME stored
  // world edge on both tiles; separate matrix arithmetic can round differently.
  vec2 offset = uv - vec2(0.5);
  bvec2 farCorner = bvec2(dot(matrixABCD.xz, offset) > 0.0, dot(matrixABCD.yw, offset) > 0.0);
  vec2 world = mix(bounds.xy, bounds.zw, farCorner);
  vec4 original = heprRasterOriginalBounds(matrixABCD, matrixEF);
  vec2 delta = (world - mix(original.xy, original.zw, farCorner)) / (original.zw - original.xy);
  vec2 sourceUv = uv;
  if (matrixABCD.x != 0.0) sourceUv += vec2(sign(matrixABCD.x) * delta.x, sign(matrixABCD.w) * delta.y);
  else sourceUv += vec2(sign(matrixABCD.y) * delta.y, sign(matrixABCD.z) * delta.x);
  // Texture clamp-to-edge extends the edge texel into the filtered gap without
  // stretching the original image or enabling interpolation on nearest images.
  return vec4(world, sourceUv);
}
`;

/** Native GL's standalone path, including the texture-batch failure fallback. */
export function rasterTileSeamVertexGlsl(source: string): string {
  return source.replace("out vec2 vWorld;", `out vec2 vWorld;
uniform vec4 uRasterSeamBounds;
uniform vec4 uRasterSeamGaps;
flat out vec4 vRasterSeamOriginalBounds;
${RASTER_TILE_SEAM_VERTEX_GLSL}`)
    .replace("  if (uUseLocalToClip >= 0.5) {", `  vRasterSeamOriginalBounds = heprRasterOriginalBounds(uRasterMatrixABCD, uRasterMatrixEF);
  if (any(greaterThan(uRasterSeamGaps, vec4(0.0)))) {
    vec4 packed = heprRasterTileSeamPack(tileCorner, uRasterMatrixABCD, uRasterMatrixEF, uRasterSeamBounds);
    world = packed.xy; uv = packed.zw;
  }
  if (uUseLocalToClip >= 0.5) {`);
}

export function rasterTileSeamFragmentGlsl(source: string): string {
  return source.replace("in vec2 vWorld;", `in vec2 vWorld;
uniform vec4 uRasterSeamGaps;
flat in vec4 vRasterSeamOriginalBounds;
${RASTER_TILE_SEAM_GLSL}`)
    .replace("  vec4 color = texture(uRasterTex, vUv) * uRasterOpacity;", `  vec2 seamFootprint = abs(dFdx(vWorld)) + abs(dFdy(vWorld));
  vec4 color = texture(uRasterTex, vUv) * uRasterOpacity;
  if (any(greaterThan(uRasterSeamGaps, vec4(0.0)))) {
    color *= heprRasterTileSeamCoverage(vWorld, seamFootprint, vRasterSeamOriginalBounds, uRasterSeamGaps);
  }`);
}
