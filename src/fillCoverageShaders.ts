/**
 * Box-filtered coverage for filled paths and glyph outlines.
 *
 * A signed distance to the nearest edge keeps resolved edges smooth, but it
 * cannot see a shape narrower than its filter: a thin rule or glyph stem is
 * either opaque where a pixel centre lands inside it or absent where none
 * does, so it blinks between a one-pixel line and nothing as the camera moves.
 *
 * Averaging the winding number over the pixel footprint instead preserves a
 * shape's ink at every size, as the two-sided stroke filter does for strokes.
 * The footprint is an axis-aligned box in path space mapped onto the unit
 * square. An edge adds the fraction of each box row lying left of it, so its
 * contribution is the integral of clamp(u, 0, 1) dv over the rows it spans:
 * rows it passes to the right of count fully, rows it misses not at all.
 * Line edges are exact. A quadratic is split where it turns vertically and
 * clipped exactly to the box rows. Within them it is flattened to 1/64 of the
 * box, and each piece inside the box columns adds its parabolic segment, so
 * only pieces crossing a box side are approximate. `low` and `high` restrict
 * the rows: a band-indexed path integrates each band over its own rows only,
 * and never counts a segment listed in two bands twice.
 *
 * As in other area rasterizers (FreeType, Vello), nonzero coverage saturates
 * the averaged winding and even-odd coverage folds it with a triangle wave.
 * Both are exact wherever the footprint spans one winding step. Coincident
 * edges of two same-direction contours antialias with a narrower ramp, and
 * same-direction even-odd contours closer together than a pixel read darker
 * than their area.
 *
 * Both variants use only scalar arithmetic on vector components, so tests can
 * evaluate the exact sources that ship.
 */
export const FILL_COVERAGE_GLSL = `
float heprCoverageRamp(float u) {
  float inside = clamp(u, 0.0, 1.0);
  return 0.5 * inside * inside + max(u - 1.0, 0.0);
}

float heprLineCoverage(vec2 a, vec2 b, float low, float high) {
  float va = clamp(a.y, low, high);
  float vb = clamp(b.y, low, high);
  if (va == vb) {
    return 0.0;
  }
  if (min(a.x, b.x) >= 1.0) {
    return vb - va;
  }
  if (max(a.x, b.x) <= 0.0) {
    return 0.0;
  }
  float dy = b.y - a.y;
  float ua = a.x + (b.x - a.x) * ((va - a.y) / dy);
  float ub = a.x + (b.x - a.x) * ((vb - a.y) / dy);
  float du = ub - ua;
  float mean = abs(du) < 0.0001
    ? clamp(0.5 * (ua + ub), 0.0, 1.0)
    : (heprCoverageRamp(ub) - heprCoverageRamp(ua)) / du;
  return (vb - va) * mean;
}

vec2 heprQuadraticPoint(vec2 a, vec2 b, vec2 c, float t) {
  float s = 1.0 - t;
  return vec2(
    s * s * a.x + 2.0 * s * t * b.x + t * t * c.x,
    s * s * a.y + 2.0 * s * t * b.y + t * t * c.y
  );
}

float heprQuadraticRoot(float qa, float qb, float qc, float t0, float t1) {
  float root = t0;
  if (qa == 0.0) {
    if (qb != 0.0) {
      root = -qc / qb;
    }
  } else {
    float q = -0.5 * (qb + (qb < 0.0 ? -1.0 : 1.0) * sqrt(max(qb * qb - 4.0 * qa * qc, 0.0)));
    float rootA = q / qa;
    float rootB = q == 0.0 ? rootA : qc / q;
    float missA = max(max(t0 - rootA, rootA - t1), 0.0);
    float missB = max(max(t0 - rootB, rootB - t1), 0.0);
    root = missB < missA ? rootB : rootA;
  }
  return clamp(root, t0, t1);
}

float heprQuadraticPieceCoverage(vec2 a, vec2 b, vec2 c, float t0, float t1, float low, float high) {
  if (t1 <= t0) {
    return 0.0;
  }
  vec2 startPoint = heprQuadraticPoint(a, b, c, t0);
  vec2 endPoint = heprQuadraticPoint(a, b, c, t1);
  float vStart = clamp(startPoint.y, low, high);
  float vEnd = clamp(endPoint.y, low, high);
  if (vStart == vEnd) {
    return 0.0;
  }
  float qa = a.y - 2.0 * b.y + c.y;
  float qb = 2.0 * (b.y - a.y);
  float ts = vStart == startPoint.y ? t0 : heprQuadraticRoot(qa, qb, a.y - vStart, t0, t1);
  float te = vEnd == endPoint.y ? t1 : heprQuadraticRoot(qa, qb, a.y - vEnd, t0, t1);
  float span = te - ts;
  float deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  int pieces = int(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
  vec2 previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  float tPrevious = ts;
  float coverage = 0.0;
  for (int piece = 1; piece <= 8; piece += 1) {
    if (piece > pieces) {
      break;
    }
    float tNext = piece == pieces ? te : ts + span * float(piece) / float(pieces);
    vec2 next = heprQuadraticPoint(a, b, c, tNext);
    if (piece == pieces) {
      next.y = vEnd;
    }
    coverage += heprLineCoverage(previous, next, low, high);
    float sa = 1.0 - tPrevious;
    float sb = 1.0 - tNext;
    float blend = sa * tNext + tPrevious * sb;
    vec2 control = vec2(
      sa * sb * a.x + blend * b.x + tPrevious * tNext * c.x,
      sa * sb * a.y + blend * b.y + tPrevious * tNext * c.y
    );
    if (min(min(previous.x, next.x), control.x) >= 0.0 && max(max(previous.x, next.x), control.x) <= 1.0) {
      coverage += ((control.x - previous.x) * (next.y - previous.y) - (control.y - previous.y) * (next.x - previous.x)) / 3.0;
    }
    previous = next;
    tPrevious = tNext;
  }
  return coverage;
}

float heprQuadraticCoverage(vec2 a, vec2 b, vec2 c, float low, float high) {
  if (max(max(a.y, b.y), c.y) <= low || min(min(a.y, b.y), c.y) >= high || max(max(a.x, b.x), c.x) <= 0.0) {
    return 0.0;
  }
  float qa = a.y - 2.0 * b.y + c.y;
  float turn = qa == 0.0 ? 0.0 : clamp((a.y - b.y) / qa, 0.0, 1.0);
  if (min(min(a.x, b.x), c.x) >= 1.0) {
    float middle = clamp(heprQuadraticPoint(a, b, c, turn).y, low, high);
    return middle - clamp(a.y, low, high) + clamp(c.y, low, high) - middle;
  }
  return heprQuadraticPieceCoverage(a, b, c, 0.0, turn, low, high) +
    heprQuadraticPieceCoverage(a, b, c, turn, 1.0, low, high);
}

float heprSegmentCoverage(vec2 p0, vec2 p1, vec2 p2, bool quadratic, vec4 box, float low, float high) {
  vec2 a = vec2((p0.x - box.x) * box.z, (p0.y - box.y) * box.w);
  vec2 c = vec2((p2.x - box.x) * box.z, (p2.y - box.y) * box.w);
  // One exit: D3D's FXC (under ANGLE) cannot prove that an early return here
  // covers every path and warns X4000 about the result.
  float coverage = 0.0;
  if (quadratic) {
    vec2 b = vec2((p1.x - box.x) * box.z, (p1.y - box.y) * box.w);
    coverage = heprQuadraticCoverage(a, b, c, low, high);
  } else {
    coverage = heprLineCoverage(a, c, low, high);
  }
  return coverage;
}

vec2 heprBandRows(vec4 bandInfo, int band, int bandCount, vec4 box) {
  if (bandCount <= 0) {
    return vec2(0.0, 1.0);
  }
  float bandLow = bandInfo.z + float(band) * bandInfo.w;
  vec2 rows = vec2(
    clamp((bandLow - box.y) * box.w, 0.0, 1.0),
    clamp((bandLow + bandInfo.w - box.y) * box.w, 0.0, 1.0)
  );
  if (band == 0) {
    rows.x = 0.0;
  }
  if (band == bandCount - 1) {
    rows.y = 1.0;
  }
  return rows;
}

float heprFillCoverage(float winding, bool evenOdd) {
  float magnitude = abs(winding);
  return evenOdd
    ? abs(magnitude - 2.0 * floor(0.5 * magnitude + 0.5))
    : min(magnitude, 1.0);
}
`;

export const FILL_COVERAGE_WGSL = /* wgsl */ `
fn heprCoverageRamp(u: f32) -> f32 {
  let inside = clamp(u, 0.0, 1.0);
  return 0.5 * inside * inside + max(u - 1.0, 0.0);
}

fn heprLineCoverage(a: vec2<f32>, b: vec2<f32>, low: f32, high: f32) -> f32 {
  let va = clamp(a.y, low, high);
  let vb = clamp(b.y, low, high);
  if (va == vb) {
    return 0.0;
  }
  if (min(a.x, b.x) >= 1.0) {
    return vb - va;
  }
  if (max(a.x, b.x) <= 0.0) {
    return 0.0;
  }
  let dy = b.y - a.y;
  let ua = a.x + (b.x - a.x) * ((va - a.y) / dy);
  let ub = a.x + (b.x - a.x) * ((vb - a.y) / dy);
  let du = ub - ua;
  var mean = clamp(0.5 * (ua + ub), 0.0, 1.0);
  if (abs(du) >= 0.0001) {
    mean = (heprCoverageRamp(ub) - heprCoverageRamp(ua)) / du;
  }
  return (vb - va) * mean;
}

fn heprQuadraticPoint(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t: f32) -> vec2<f32> {
  let s = 1.0 - t;
  return vec2<f32>(
    s * s * a.x + 2.0 * s * t * b.x + t * t * c.x,
    s * s * a.y + 2.0 * s * t * b.y + t * t * c.y
  );
}

fn heprQuadraticRoot(qa: f32, qb: f32, qc: f32, t0: f32, t1: f32) -> f32 {
  var root = t0;
  if (qa == 0.0) {
    if (qb != 0.0) {
      root = -qc / qb;
    }
  } else {
    let q = -0.5 * (qb + select(1.0, -1.0, qb < 0.0) * sqrt(max(qb * qb - 4.0 * qa * qc, 0.0)));
    let rootA = q / qa;
    var rootB = rootA;
    if (q != 0.0) {
      rootB = qc / q;
    }
    let missA = max(max(t0 - rootA, rootA - t1), 0.0);
    let missB = max(max(t0 - rootB, rootB - t1), 0.0);
    root = select(rootA, rootB, missB < missA);
  }
  return clamp(root, t0, t1);
}

fn heprQuadraticPieceCoverage(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t0: f32, t1: f32, low: f32, high: f32) -> f32 {
  if (t1 <= t0) {
    return 0.0;
  }
  let startPoint = heprQuadraticPoint(a, b, c, t0);
  let endPoint = heprQuadraticPoint(a, b, c, t1);
  let vStart = clamp(startPoint.y, low, high);
  let vEnd = clamp(endPoint.y, low, high);
  if (vStart == vEnd) {
    return 0.0;
  }
  let qa = a.y - 2.0 * b.y + c.y;
  let qb = 2.0 * (b.y - a.y);
  var ts = t0;
  if (vStart != startPoint.y) {
    ts = heprQuadraticRoot(qa, qb, a.y - vStart, t0, t1);
  }
  var te = t1;
  if (vEnd != endPoint.y) {
    te = heprQuadraticRoot(qa, qb, a.y - vEnd, t0, t1);
  }
  let span = te - ts;
  let deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  let pieces = i32(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
  var previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  var tPrevious = ts;
  var coverage = 0.0;
  for (var piece = 1; piece <= 8; piece = piece + 1) {
    if (piece > pieces) {
      break;
    }
    let tNext = select(ts + span * f32(piece) / f32(pieces), te, piece == pieces);
    var next = heprQuadraticPoint(a, b, c, tNext);
    if (piece == pieces) {
      next.y = vEnd;
    }
    coverage = coverage + heprLineCoverage(previous, next, low, high);
    let sa = 1.0 - tPrevious;
    let sb = 1.0 - tNext;
    let blend = sa * tNext + tPrevious * sb;
    let control = vec2<f32>(
      sa * sb * a.x + blend * b.x + tPrevious * tNext * c.x,
      sa * sb * a.y + blend * b.y + tPrevious * tNext * c.y
    );
    if (min(min(previous.x, next.x), control.x) >= 0.0 && max(max(previous.x, next.x), control.x) <= 1.0) {
      coverage = coverage + ((control.x - previous.x) * (next.y - previous.y) - (control.y - previous.y) * (next.x - previous.x)) / 3.0;
    }
    previous = next;
    tPrevious = tNext;
  }
  return coverage;
}

fn heprQuadraticCoverage(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, low: f32, high: f32) -> f32 {
  if (max(max(a.y, b.y), c.y) <= low || min(min(a.y, b.y), c.y) >= high || max(max(a.x, b.x), c.x) <= 0.0) {
    return 0.0;
  }
  let qa = a.y - 2.0 * b.y + c.y;
  var turn = 0.0;
  if (qa != 0.0) {
    turn = clamp((a.y - b.y) / qa, 0.0, 1.0);
  }
  if (min(min(a.x, b.x), c.x) >= 1.0) {
    let middle = clamp(heprQuadraticPoint(a, b, c, turn).y, low, high);
    return middle - clamp(a.y, low, high) + clamp(c.y, low, high) - middle;
  }
  return heprQuadraticPieceCoverage(a, b, c, 0.0, turn, low, high) +
    heprQuadraticPieceCoverage(a, b, c, turn, 1.0, low, high);
}

fn heprSegmentCoverage(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, quadratic: bool, box: vec4<f32>, low: f32, high: f32) -> f32 {
  let a = vec2<f32>((p0.x - box.x) * box.z, (p0.y - box.y) * box.w);
  let c = vec2<f32>((p2.x - box.x) * box.z, (p2.y - box.y) * box.w);
  if (!quadratic) {
    return heprLineCoverage(a, c, low, high);
  }
  let b = vec2<f32>((p1.x - box.x) * box.z, (p1.y - box.y) * box.w);
  return heprQuadraticCoverage(a, b, c, low, high);
}

fn heprBandRows(bandInfo: vec4<f32>, band: i32, bandCount: i32, box: vec4<f32>) -> vec2<f32> {
  if (bandCount <= 0) {
    return vec2<f32>(0.0, 1.0);
  }
  let bandLow = bandInfo.z + f32(band) * bandInfo.w;
  var rows = vec2<f32>(
    clamp((bandLow - box.y) * box.w, 0.0, 1.0),
    clamp((bandLow + bandInfo.w - box.y) * box.w, 0.0, 1.0)
  );
  if (band == 0) {
    rows.x = 0.0;
  }
  if (band == bandCount - 1) {
    rows.y = 1.0;
  }
  return rows;
}

fn heprFillCoverage(winding: f32, evenOdd: bool) -> f32 {
  let magnitude = abs(winding);
  return select(min(magnitude, 1.0), abs(magnitude - 2.0 * floor(0.5 * magnitude + 0.5)), evenOdd);
}
`;

/**
 * Fill and glyph quads cover their shape's bounds widened by this many
 * pixels, so every pixel whose footprint reaches the shape gets a fragment
 * even when the shape itself falls between pixel centres. It covers filters
 * up to two pixels wide.
 */
export const FILL_COVERAGE_MARGIN_PX = 1;

/**
 * `heprPathToPixel` gives the pixel motion of unit steps along path x and y
 * at a path-space point, as matrix columns, for both the 2D camera and a
 * projective local-to-clip transform. `heprCoverageMargin` inverts it into
 * the path-space extent of the quad margin along each axis: the same
 * per-axis pixel extent the fragment stage's derivatives measure as the
 * footprint. A degenerate transform gets no margin.
 */
export const FILL_COVERAGE_VERTEX_GLSL = `
mat2 heprPathToPixel(vec2 world, float useLocalToClip, mat4 localToClip, float zoom, vec2 viewport) {
  if (useLocalToClip < 0.5) {
    return mat2(zoom, 0.0, 0.0, zoom);
  }
  vec4 clip = localToClip * vec4(world, 0.0, 1.0);
  float w = abs(clip.w) > 1e-6 ? clip.w : 1e-6;
  vec2 ndc = clip.xy / w;
  vec2 halfViewport = 0.5 * viewport;
  return mat2(
    (localToClip[0].xy - ndc * localToClip[0].w) / w * halfViewport,
    (localToClip[1].xy - ndc * localToClip[1].w) / w * halfViewport
  );
}

vec2 heprCoverageMargin(mat2 pathToPixel) {
  float det = abs(pathToPixel[0][0] * pathToPixel[1][1] - pathToPixel[1][0] * pathToPixel[0][1]);
  if (!(det > 1e-30)) {
    return vec2(0.0);
  }
  return vec2(length(pathToPixel[1]), length(pathToPixel[0])) * (${FILL_COVERAGE_MARGIN_PX.toFixed(1)} / det);
}
`;

export const FILL_COVERAGE_VERTEX_WGSL = /* wgsl */ `
fn heprPathToPixel(world: vec2<f32>, useLocalToClip: f32, localToClip: mat4x4<f32>, zoom: f32, viewport: vec2<f32>) -> mat2x2<f32> {
  if (useLocalToClip < 0.5) {
    return mat2x2<f32>(zoom, 0.0, 0.0, zoom);
  }
  let clip = localToClip * vec4<f32>(world, 0.0, 1.0);
  let w = select(0.000001, clip.w, abs(clip.w) > 0.000001);
  let ndc = clip.xy / w;
  let halfViewport = 0.5 * viewport;
  return mat2x2<f32>(
    (localToClip[0].xy - ndc * localToClip[0].w) / w * halfViewport,
    (localToClip[1].xy - ndc * localToClip[1].w) / w * halfViewport
  );
}

fn heprCoverageMargin(pathToPixel: mat2x2<f32>) -> vec2<f32> {
  let det = abs(pathToPixel[0].x * pathToPixel[1].y - pathToPixel[1].x * pathToPixel[0].y);
  if (!(det > 1e-30)) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(length(pathToPixel[1]), length(pathToPixel[0])) * (${FILL_COVERAGE_MARGIN_PX.toFixed(1)} / det);
}
`;
