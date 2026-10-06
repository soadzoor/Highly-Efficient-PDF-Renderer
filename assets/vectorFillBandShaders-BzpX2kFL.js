var e=`
fn heprFillBandInfo(pathIndex: f32, base: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (base < 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(base + pathIndex + 0.5);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}
`;function t(e){return`
  let bandInfo = ${e.bands};
  let bandCount = i32(bandInfo.y);
  let bandTextureWidth = i32(textureDimensions(${e.texture}).x);
  var firstBand = 0;
  var lastBand = 0;
  if (bandCount > 0) {
    firstBand = clamp(i32(floor((${e.y} - ${e.radius} - bandInfo.z) / bandInfo.w)), 0, bandCount - 1);
    lastBand = clamp(i32(floor((${e.y} + ${e.radius} - bandInfo.z) / bandInfo.w)), 0, bandCount - 1);
  }
  for (var band = firstBand; band <= lastBand; band = band + 1) {
    var bandSegmentCount = ${e.count};
    var entry = 0;
    if (bandCount > 0) {
      let tableIndex = i32(bandInfo.x) + band;
      let range = textureLoad(${e.texture}, vec2<i32>(tableIndex % bandTextureWidth, tableIndex / bandTextureWidth), 0);
      entry = i32(range.x);
      bandSegmentCount = i32(range.y);
    }
    ${e.setup??``}
    for (var bandSegment = 0; bandSegment < bandSegmentCount; bandSegment = bandSegment + 1) {
      var segmentIndex = ${e.start} + bandSegment;
      if (bandCount > 0) {
        let packedIndex = entry + bandSegment;
        let texel = i32(${e.entries}) + (packedIndex >> 2);
        let packed = textureLoad(${e.texture}, vec2<i32>(texel % bandTextureWidth, texel / bandTextureWidth), 0);
        segmentIndex = i32(packed[packedIndex & 3]);
      }
      ${e.edge}
    }
  }
`}export{t as n,e as t};