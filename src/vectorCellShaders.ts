/**
 * Coverage through a path's cell index (see vectorCellIndex.ts).
 *
 * The caller defines heprCellFetchA/B(index) over its segment textures, and
 * includes FILL_COVERAGE_GLSL first. `cells` is the path's header: first
 * level texel, level count, finest cell size and the log2 size ratio between
 * levels; `origin` is its grid origin. A piece keeps its endpoints in A and a
 * curve's control point and flag in B; a cell holding a curve negates its
 * piece count (see vectorPathCellStore).
 * The finest level whose cells span half the footprint keeps the box within
 * three columns and three rows: smaller cells than the footprint hold fewer
 * pieces the box does not reach, which outweighs reading more of them.
 * Each column's part of the box takes its pieces
 * exactly and everything right of it through the cell's closures; each row
 * integrates only its own rows, as bands do. The parts are weighted by their
 * share of the box, so the result is the whole box's averaged winding.
 */
export const VECTOR_CELL_COVERAGE_GLSL = `
float heprCellWinding(vec4 cells, vec2 origin, vec4 box, vec2 footprint) {
  float reach = 0.5 * max(footprint.x, footprint.y);
  float level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  float size = cells.z * exp2(level * cells.w);
  if (size < reach && level < cells.y - 1.0) {
    level = level + 1.0;
    size = cells.z * exp2(level * cells.w);
  }
  vec4 grid = heprCellFetchA(int(cells.x + level));
  float right = box.x + footprint.x;
  int firstColumn = int(clamp(floor((box.x - origin.x) / size), 0.0, grid.y - 1.0));
  int lastColumn = int(clamp(floor((right - origin.x) / size), 0.0, grid.y - 1.0));
  int firstRow = int(clamp(floor((box.y - origin.y) / size), 0.0, grid.z - 1.0));
  int lastRow = int(clamp(floor((box.y + footprint.y - origin.y) / size), 0.0, grid.z - 1.0));
  vec4 rowGrid = vec4(0.0, 0.0, origin.y, size);
  float winding = 0.0;
  // Reads run ahead of their use: the next cell's record before this cell's
  // pieces, four lines before any of them is computed, a curve cell's next
  // piece before this one. Their latencies then overlap. A pixel's time is
  // mostly that latency, and a draw lasts as long as its slowest pixels.
  for (int row = firstRow; row <= lastRow; row += 1) {
    vec2 rows = heprBandRows(rowGrid, row, int(grid.z), box);
    int rowBase = int(grid.x + float(row) * grid.y);
    vec4 nextCell = heprCellFetchA(rowBase + firstColumn);
    for (int column = firstColumn; column <= lastColumn; column += 1) {
      vec4 cell = nextCell;
      nextCell = heprCellFetchA(rowBase + min(column + 1, lastColumn));
      // The outer columns reach past the grid: nothing lies beyond them.
      float low = column == 0 ? box.x : max(box.x, origin.x + float(column) * size);
      float high = column == int(grid.y) - 1 ? right : min(right, origin.x + float(column + 1) * size);
      if (high > low) {
        vec4 part = vec4(low, box.y, 1.0 / (high - low), box.w);
        float cellWinding = 0.0;
        int first = int(cell.x);
        int count = int(abs(cell.y));
        int last = first + count - 1;
        if (cell.y > 0.0) {
          // Lines only, one texel each. Reads past the end repeat the last
          // line; an empty row range makes them add nothing.
          for (int piece = 0; piece < count; piece += 4) {
            vec4 l0 = heprCellFetchA(first + piece);
            vec4 l1 = heprCellFetchA(min(first + piece + 1, last));
            vec4 l2 = heprCellFetchA(min(first + piece + 2, last));
            vec4 l3 = heprCellFetchA(min(first + piece + 3, last));
            cellWinding += heprSegmentCoverage(vec2(l0.x, l0.y), vec2(l0.x, l0.y), vec2(l0.z, l0.w), false,
              part, rows.x, rows.y);
            cellWinding += heprSegmentCoverage(vec2(l1.x, l1.y), vec2(l1.x, l1.y), vec2(l1.z, l1.w), false,
              part, rows.x, piece + 1 < count ? rows.y : rows.x);
            cellWinding += heprSegmentCoverage(vec2(l2.x, l2.y), vec2(l2.x, l2.y), vec2(l2.z, l2.w), false,
              part, rows.x, piece + 2 < count ? rows.y : rows.x);
            cellWinding += heprSegmentCoverage(vec2(l3.x, l3.y), vec2(l3.x, l3.y), vec2(l3.z, l3.w), false,
              part, rows.x, piece + 3 < count ? rows.y : rows.x);
          }
        } else if (count > 0) {
          vec4 nextA = heprCellFetchA(first);
          vec4 nextB = heprCellFetchB(first);
          for (int piece = 0; piece < count; piece += 1) {
            vec4 a = nextA;
            vec4 b = nextB;
            int following = min(first + piece + 1, last);
            nextA = heprCellFetchA(following);
            nextB = heprCellFetchB(following);
            cellWinding += heprSegmentCoverage(vec2(a.x, a.y), vec2(b.x, b.y), vec2(a.z, a.w), b.z >= 0.5,
              part, rows.x, rows.y);
          }
        }
        int closures = int(cell.z);
        int closureCount = int(cell.w);
        for (int closure = 0; closure < closureCount; closure += 2) {
          vec4 pair = heprCellFetchA(closures + closure);
          vec4 pair2 = heprCellFetchA(closures + min(closure + 1, closureCount - 1));
          float more = closure + 1 < closureCount ? 1.0 : 0.0;
          cellWinding += pair.y * (clamp((pair.x - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += pair.w * (clamp((pair.z - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += more * pair2.y * (clamp((pair2.x - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += more * pair2.w * (clamp((pair2.z - box.y) * box.w, rows.x, rows.y) - rows.y);
        }
        winding += cellWinding * (high - low) / footprint.x;
      }
    }
  }
  return winding;
}
`;

/**
 * The same coverage in WGSL, for native WebGPU and Three's node materials.
 * Textures are parameters, as TSL functions cannot name globals; A holds the
 * segments, pieces and index records, B the pieces' control points.
 */
export const VECTOR_CELL_COVERAGE_WGSL = /* wgsl */ `
fn heprCellWinding(cells: vec4<f32>, origin: vec2<f32>, box: vec4<f32>, footprint: vec2<f32>,
    segmentsA: texture_2d<f32>, segmentsB: texture_2d<f32>) -> f32 {
  let reach = 0.5 * max(footprint.x, footprint.y);
  var level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  var size = cells.z * exp2(level * cells.w);
  if (size < reach && level < cells.y - 1.0) {
    level = level + 1.0;
    size = cells.z * exp2(level * cells.w);
  }
  let grid = heprCellTexel(segmentsA, i32(cells.x + level));
  let right = box.x + footprint.x;
  let firstColumn = i32(clamp(floor((box.x - origin.x) / size), 0.0, grid.y - 1.0));
  let lastColumn = i32(clamp(floor((right - origin.x) / size), 0.0, grid.y - 1.0));
  let firstRow = i32(clamp(floor((box.y - origin.y) / size), 0.0, grid.z - 1.0));
  let lastRow = i32(clamp(floor((box.y + footprint.y - origin.y) / size), 0.0, grid.z - 1.0));
  let rowGrid = vec4<f32>(0.0, 0.0, origin.y, size);
  var winding = 0.0;
  // Reads run ahead of their use, as in the GLSL version.
  for (var row = firstRow; row <= lastRow; row = row + 1) {
    let rows = heprBandRows(rowGrid, row, i32(grid.z), box);
    let rowBase = i32(grid.x + f32(row) * grid.y);
    var nextCell = heprCellTexel(segmentsA, rowBase + firstColumn);
    for (var column = firstColumn; column <= lastColumn; column = column + 1) {
      let cell = nextCell;
      nextCell = heprCellTexel(segmentsA, rowBase + min(column + 1, lastColumn));
      // The outer columns reach past the grid: nothing lies beyond them.
      var low = max(box.x, origin.x + f32(column) * size);
      if (column == 0) {
        low = box.x;
      }
      var high = min(right, origin.x + f32(column + 1) * size);
      if (column == i32(grid.y) - 1) {
        high = right;
      }
      if (high > low) {
        let part = vec4<f32>(low, box.y, 1.0 / (high - low), box.w);
        var cellWinding = 0.0;
        let first = i32(cell.x);
        let count = i32(abs(cell.y));
        let last = first + count - 1;
        if (cell.y > 0.0) {
          // Lines only, one texel each. Reads past the end repeat the last
          // line; an empty row range makes them add nothing.
          for (var piece = 0; piece < count; piece = piece + 4) {
            let l0 = heprCellTexel(segmentsA, first + piece);
            let l1 = heprCellTexel(segmentsA, min(first + piece + 1, last));
            let l2 = heprCellTexel(segmentsA, min(first + piece + 2, last));
            let l3 = heprCellTexel(segmentsA, min(first + piece + 3, last));
            cellWinding = cellWinding + heprCellLine(l0, part, rows.x, rows.y) +
              heprCellLine(l1, part, rows.x, select(rows.x, rows.y, piece + 1 < count)) +
              heprCellLine(l2, part, rows.x, select(rows.x, rows.y, piece + 2 < count)) +
              heprCellLine(l3, part, rows.x, select(rows.x, rows.y, piece + 3 < count));
          }
        } else if (count > 0) {
          var nextA = heprCellTexel(segmentsA, first);
          var nextB = heprCellTexel(segmentsB, first);
          for (var piece = 0; piece < count; piece = piece + 1) {
            let a = nextA;
            let b = nextB;
            let following = min(first + piece + 1, last);
            nextA = heprCellTexel(segmentsA, following);
            nextB = heprCellTexel(segmentsB, following);
            cellWinding = cellWinding + heprSegmentCoverage(vec2<f32>(a.x, a.y), vec2<f32>(b.x, b.y),
              vec2<f32>(a.z, a.w), b.z >= 0.5, part, rows.x, rows.y);
          }
        }
        let closures = i32(cell.z);
        let closureCount = i32(cell.w);
        for (var closure = 0; closure < closureCount; closure = closure + 2) {
          let pair = heprCellTexel(segmentsA, closures + closure);
          let pair2 = heprCellTexel(segmentsA, closures + min(closure + 1, closureCount - 1));
          let more = select(0.0, 1.0, closure + 1 < closureCount);
          cellWinding = cellWinding + pair.y * (clamp((pair.x - box.y) * box.w, rows.x, rows.y) - rows.y) +
            pair.w * (clamp((pair.z - box.y) * box.w, rows.x, rows.y) - rows.y) +
            more * pair2.y * (clamp((pair2.x - box.y) * box.w, rows.x, rows.y) - rows.y) +
            more * pair2.w * (clamp((pair2.z - box.y) * box.w, rows.x, rows.y) - rows.y);
        }
        winding = winding + cellWinding * (high - low) / footprint.x;
      }
    }
  }
  return winding;
}

fn heprCellTexel(segments: texture_2d<f32>, index: i32) -> vec4<f32> {
  let width = i32(textureDimensions(segments).x);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}

fn heprCellLine(line: vec4<f32>, part: vec4<f32>, low: f32, high: f32) -> f32 {
  return heprSegmentCoverage(vec2<f32>(line.x, line.y), vec2<f32>(line.x, line.y), vec2<f32>(line.z, line.w), false,
    part, low, high);
}
`;

/** A path's cell header, from `headers` (the first header's texel plus one; zero means none). */
export const VECTOR_FILL_CELL_INFO_WGSL = /* wgsl */ `
fn heprFillCellInfo(pathIndex: f32, headers: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (headers <= 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(headers - 1.0 + pathIndex);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}
`;
