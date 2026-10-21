/**
 * Box-filtered coverage of a straight stroke, including its round caps/dots.
 * Work in the stroke frame and split a capsule into a rectangle and two
 * disjoint half disks. Circle/polygon intersection integrates chords inside
 * the disk and circular sectors outside it. Clipping a pixel edge to a cap's
 * half plane adds a diameter edge; its signed area about the disk centre is
 * zero. No point samples or extra scene geometry are needed.
 *
 * Helpers use scalar arithmetic on vector components so the exact GLSL/WGSL
 * sources can also be evaluated by the numerical regression tests.
 */
const functions = [
  `float heprStrokeCross(vec2 a, vec2 b) {
  return a.x * b.y - a.y * b.x;
}`,
  `float heprStrokeCdf(float t, float a, float b) {
  float wide = max(abs(a), abs(b));
  float narrow = min(abs(a), abs(b));
  float support = 0.5 * (wide + narrow);
  if (t <= -support) { return 0.0; }
  if (t >= support) { return 1.0; }
  if (abs(t) <= 0.5 * (wide - narrow)) { return 0.5 + t / wide; }
  float tail = support - abs(t);
  float area = tail * tail / (2.0 * wide * narrow);
  if (t < 0.0) { return area; }
  return 1.0 - area;
}`,
  `float heprStrokeLineArea(vec2 a, vec2 b) {
  float ya = clamp(a.y, 0.0, 1.0);
  float yb = clamp(b.y, 0.0, 1.0);
  if (ya == yb || max(a.x, b.x) <= 0.0) { return 0.0; }
  if (min(a.x, b.x) >= 1.0) { return yb - ya; }
  float xa = a.x + (b.x - a.x) * ((ya - a.y) / (b.y - a.y));
  float xb = a.x + (b.x - a.x) * ((yb - a.y) / (b.y - a.y));
  float lo = min(xa, xb);
  float hi = max(xa, xb);
  float span = hi - lo;
  if (span == 0.0) { return (yb - ya) * clamp(xa, 0.0, 1.0); }
  // Integrate the clamped ramp in pieces, avoiding cancellation between
  // nearly equal antiderivatives for thin/near-vertical rectangles.
  float start = clamp(lo, 0.0, 1.0);
  float end = clamp(hi, 0.0, 1.0);
  float ramp = 0.5 * (start + end) * (end - start);
  return (yb - ya) * (ramp + max(hi - max(lo, 1.0), 0.0)) / span;
}`,
  `vec2 heprStrokePixelPoint(vec2 p, vec2 dx, vec2 dy, float determinant) {
  return vec2(0.5 + heprStrokeCross(p, dy) / determinant,
    0.5 + heprStrokeCross(dx, p) / determinant);
}`,
  `float heprStrokeCircleEdge(vec2 a, vec2 b, float radius) {
  float crossValue = heprStrokeCross(a, b);
  // A radial edge contributes no area, even if it passes through the origin.
  if (crossValue == 0.0) { return 0.0; }
  float radius2 = radius * radius;
  float aa = a.x * a.x + a.y * a.y;
  float bb = b.x * b.x + b.y * b.y;
  if (max(aa, bb) <= radius2) { return 0.5 * crossValue; }
  vec2 delta = vec2(b.x - a.x, b.y - a.y);
  float length2 = delta.x * delta.x + delta.y * delta.y;
  float projection = -(a.x * delta.x + a.y * delta.y) / length2;
  float height2 = radius2 - crossValue * crossValue / length2;
  float sector = 0.5 * radius2 * atan(crossValue, a.x * b.x + a.y * b.y);
  if (height2 <= 0.0) { return sector; }
  float reach = sqrt(height2 / length2);
  float t0 = clamp(projection - reach, 0.0, 1.0);
  float t1 = clamp(projection + reach, 0.0, 1.0);
  if (t1 <= t0) { return sector; }
  vec2 entry = vec2(a.x + delta.x * t0, a.y + delta.y * t0);
  vec2 exitPoint = vec2(a.x + delta.x * t1, a.y + delta.y * t1);
  float insideCross = heprStrokeCross(entry, exitPoint);
  float insideAngle = atan(insideCross, entry.x * exitPoint.x + entry.y * exitPoint.y);
  return sector + 0.5 * (insideCross - radius2 * insideAngle);
}`,
  `float heprStrokeCapEdge(vec2 a, vec2 b, float radius, float side) {
  if (side * a.x < 0.0 && side * b.x < 0.0) { return 0.0; }
  vec2 start = a;
  vec2 end = b;
  if (side * a.x < 0.0) {
    start = vec2(0.0, a.y + (b.y - a.y) * (-a.x / (b.x - a.x)));
  } else if (side * b.x < 0.0) {
    end = vec2(0.0, a.y + (b.y - a.y) * (-a.x / (b.x - a.x)));
  }
  return heprStrokeCircleEdge(start, end, radius);
}`,
  `float heprStrokeCapArea(vec2 center, float radius, float side, vec2 dx, vec2 dy, float determinant) {
  float extentX = 0.5 * (abs(dx.x) + abs(dy.x));
  if (side * center.x >= extentX) { return 0.0; }
  float pixelRadius = 0.5 * (sqrt(dx.x * dx.x + dx.y * dx.y) + sqrt(dy.x * dy.x + dy.y * dy.y));
  if (center.x * center.x + center.y * center.y >= (radius + pixelRadius) * (radius + pixelRadius)) { return 0.0; }
  vec2 pixelCenter = heprStrokePixelPoint(center, dx, dy, determinant);
  float footprintArea = abs(determinant);
  float extentU = radius * sqrt(dy.x * dy.x + dy.y * dy.y) / footprintArea;
  float extentV = radius * sqrt(dx.x * dx.x + dx.y * dx.y) / footprintArea;
  if (abs(pixelCenter.x - 0.5) >= 0.5 + extentU || abs(pixelCenter.y - 0.5) >= 0.5 + extentV) {
    return 0.0;
  }
  if (abs(pixelCenter.x - 0.5) + extentU <= 0.5 && abs(pixelCenter.y - 0.5) + extentV <= 0.5) {
    return 1.5707963267948966 * radius * radius / footprintArea;
  }
  vec2 a = vec2(-0.5 * (dx.x + dy.x) - center.x, -0.5 * (dx.y + dy.y) - center.y);
  vec2 b = vec2(0.5 * (dx.x - dy.x) - center.x, 0.5 * (dx.y - dy.y) - center.y);
  vec2 c = vec2(0.5 * (dx.x + dy.x) - center.x, 0.5 * (dx.y + dy.y) - center.y);
  vec2 d = vec2(0.5 * (dy.x - dx.x) - center.x, 0.5 * (dy.y - dx.y) - center.y);
  float area = heprStrokeCapEdge(a, b, radius, side) + heprStrokeCapEdge(b, c, radius, side)
    + heprStrokeCapEdge(c, d, radius, side) + heprStrokeCapEdge(d, a, radius, side);
  return abs(area / determinant);
}`,
  `float heprStrokeFlatCoverage(float x, float y, float lengthValue, float radius, vec2 dx, vec2 dy, float roundCap) {
  float nx = 0.0;
  float ny = 1.0;
  if (y < 0.0) { ny = -1.0; }
  float edge = abs(y) - radius;
  if (roundCap >= 0.5) {
    float along = x - clamp(x, 0.0, lengthValue);
    float distanceValue = sqrt(along * along + y * y);
    if (distanceValue == 0.0) { return 1.0; }
    nx = along / distanceValue;
    ny = y / distanceValue;
    edge = distanceValue - radius;
  } else if (max(-x, x - lengthValue) > edge) {
    edge = max(-x, x - lengthValue);
    nx = 1.0;
    if (x < 0.0) { nx = -1.0; }
    ny = 0.0;
  }
  return heprStrokeCdf(-edge, nx * dx.x + ny * dx.y, nx * dy.x + ny * dy.y);
}`,
  `float heprLinearStrokeCoverage(vec2 point, vec2 p0, vec2 p2, float halfWidth, vec2 pixelDx, vec2 pixelDy, float roundCap) {
  if (halfWidth <= 0.0) { return 0.0; }
  float scale = max(max(abs(pixelDx.x), abs(pixelDx.y)), max(abs(pixelDy.x), abs(pixelDy.y)));
  if (scale <= 0.0) { return 0.0; }
  vec2 axis = vec2(p2.x - p0.x, p2.y - p0.y);
  float axisLength = sqrt(axis.x * axis.x + axis.y * axis.y);
  if (axisLength == 0.0 && roundCap < 0.5) { return 0.0; }
  vec2 tangent = vec2(1.0, 0.0);
  if (axisLength > 0.0) { tangent = vec2(axis.x / axisLength, axis.y / axisLength); }
  vec2 offset = vec2((point.x - p0.x) / scale, (point.y - p0.y) / scale);
  float x = offset.x * tangent.x + offset.y * tangent.y;
  float y = offset.y * tangent.x - offset.x * tangent.y;
  float lengthValue = axisLength / scale;
  float radius = halfWidth / scale;
  vec2 dx = vec2((pixelDx.x * tangent.x + pixelDx.y * tangent.y) / scale,
    (pixelDx.y * tangent.x - pixelDx.x * tangent.y) / scale);
  vec2 dy = vec2((pixelDy.x * tangent.x + pixelDy.y * tangent.y) / scale,
    (pixelDy.y * tangent.x - pixelDy.x * tangent.y) / scale);
  float determinant = heprStrokeCross(dx, dy);
  // A near-singular projected footprint cannot support stable area division.
  // Keep a filtered local edge approximation instead of dropping its ink.
  if (abs(determinant) <= 1e-12) {
    return heprStrokeFlatCoverage(x, y, lengthValue, radius, dx, dy, roundCap);
  }
  float extentX = 0.5 * (abs(dx.x) + abs(dy.x));
  float extentY = 0.5 * (abs(dx.y) + abs(dy.y));
  if (abs(y) >= radius + extentY) { return 0.0; }
  if (roundCap < 0.5 && (x >= lengthValue + extentX || x <= -extentX)) { return 0.0; }
  // The whole footprint lies between the ends: integrate an infinite strip.
  if (x >= extentX && x <= lengthValue - extentX) {
    return clamp(heprStrokeCdf(radius - y, dx.y, dy.y) - heprStrokeCdf(-radius - y, dx.y, dy.y), 0.0, 1.0);
  }
  float closestX = clamp(x, 0.0, lengthValue);
  float distanceValue = sqrt((x - closestX) * (x - closestX) + y * y);
  float pixelRadius = 0.5 * (sqrt(dx.x * dx.x + dx.y * dx.y) + sqrt(dy.x * dy.x + dy.y * dy.y));
  if (roundCap >= 0.5) {
    if (distanceValue >= radius + pixelRadius) { return 0.0; }
    if (distanceValue + pixelRadius <= radius) { return 1.0; }
    // At huge radii the boundary is locally flat. Avoid subtracting large
    // circular sectors in f32; sagitta is at most pixelRadius / 256 here.
    if (radius > 128.0 * pixelRadius) {
      return heprStrokeFlatCoverage(x, y, lengthValue, radius, dx, dy, roundCap);
    }
  }
  // Intersect the rectangle with the pixel's AABB first. This is exact and
  // keeps long offscreen endpoints out of the area arithmetic.
  float left = clamp(-x, -extentX, extentX);
  float right = clamp(lengthValue - x, -extentX, extentX);
  float bottom = clamp(-radius - y, -extentY, extentY);
  float top = clamp(radius - y, -extentY, extentY);
  float area = 0.0;
  if (right > left && top > bottom) {
    vec2 a = heprStrokePixelPoint(vec2(left, bottom), dx, dy, determinant);
    vec2 b = heprStrokePixelPoint(vec2(right, bottom), dx, dy, determinant);
    vec2 c = heprStrokePixelPoint(vec2(right, top), dx, dy, determinant);
    vec2 d = heprStrokePixelPoint(vec2(left, top), dx, dy, determinant);
    area = abs(heprStrokeLineArea(a, b) + heprStrokeLineArea(b, c)
      + heprStrokeLineArea(c, d) + heprStrokeLineArea(d, a));
  }
  if (roundCap >= 0.5) {
    area += heprStrokeCapArea(vec2(-x, -y), radius, -1.0, dx, dy, determinant);
    area += heprStrokeCapArea(vec2(lengthValue - x, -y), radius, 1.0, dx, dy, determinant);
  }
  return clamp(area, 0.0, 1.0);
}`
];

function toWgsl(source: string): string {
  const types: Record<string, string> = { float: "f32", vec2: "vec2<f32>" };
  return source.replace(/(float|vec2) (hepr\w+)\(([^)]*)\) \{/g, (_, type: string, name: string, args: string) =>
    `fn ${name}(${args.split(",").map(arg => {
      const [argType, argName] = arg.trim().split(/\s+/);
      return `${argName}: ${types[argType]}`;
    }).join(", ")}) -> ${types[type]} {`)
    .replace(/\b(?:float|vec2) (\w+) =/g, "var $1 =")
    .replace(/\bvec2\(/g, "vec2<f32>(")
    .replace(/\batan\(/g, "atan2(");
}

export const STROKE_AREA_COVERAGE_GLSL = functions.join("\n\n");
/** Individual definitions for Three.js function-node dependency tracking. */
export const STROKE_AREA_COVERAGE_WGSL_FUNCTIONS = functions.map(toWgsl);
export const STROKE_AREA_COVERAGE_WGSL = STROKE_AREA_COVERAGE_WGSL_FUNCTIONS.join("\n\n");
