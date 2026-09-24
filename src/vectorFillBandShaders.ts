/** The band table shares the path segment texture on every GPU backend. */
export const VECTOR_FILL_BAND_INFO_WGSL = /* wgsl */ `
fn heprFillBandInfo(pathIndex: f32, base: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (base < 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(base + pathIndex + 0.5);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}
`;

/**
 * Keep band selection and packed addressing identical in native and Three
 * WGSL. The caller supplies its existing edge math between the loop's braces.
 * Only the row's own band contributes crossings; adjacent bands add distance
 * samples for AA without counting a shared edge twice.
 */
export function vectorFillBandLoopWgsl(options: {
  bands: string; y: string; radius: string; count: string; start: string;
  texture: string; entries: string; edge: string;
}): string {
  return `
  let bandInfo = ${options.bands};
  let bandCount = i32(bandInfo.y);
  let bandTextureWidth = i32(textureDimensions(${options.texture}).x);
  var firstBand = 0;
  var lastBand = 0;
  var rowBand = 0;
  if (bandCount > 0) {
    rowBand = clamp(i32(floor((${options.y} - bandInfo.z) / bandInfo.w)), 0, bandCount - 1);
    firstBand = clamp(i32(floor((${options.y} - ${options.radius} - bandInfo.z) / bandInfo.w)), 0, bandCount - 1);
    lastBand = clamp(i32(floor((${options.y} + ${options.radius} - bandInfo.z) / bandInfo.w)), 0, bandCount - 1);
  }
  for (var band = firstBand; band <= lastBand; band = band + 1) {
    var bandSegmentCount = ${options.count};
    var entry = 0;
    let countsCrossings = bandCount <= 0 || band == rowBand;
    if (bandCount > 0) {
      let tableIndex = i32(bandInfo.x) + band;
      let range = textureLoad(${options.texture}, vec2<i32>(tableIndex % bandTextureWidth, tableIndex / bandTextureWidth), 0);
      entry = i32(range.x);
      bandSegmentCount = i32(range.y);
    }
    for (var bandSegment = 0; bandSegment < bandSegmentCount; bandSegment = bandSegment + 1) {
      var segmentIndex = ${options.start} + bandSegment;
      if (bandCount > 0) {
        let packedIndex = entry + bandSegment;
        let texel = i32(${options.entries}) + (packedIndex >> 2);
        let packed = textureLoad(${options.texture}, vec2<i32>(texel % bandTextureWidth, texel / bandTextureWidth), 0);
        segmentIndex = i32(packed[packedIndex & 3]);
      }
      ${options.edge}
    }
  }
`;
}
