// Exercise production contour geometry directly without a browser or server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/roomDetector.ts", import.meta.url), "utf8");
const geometry = vm.runInNewContext([
  sourceFunction(source, "traceRegionContour"),
  sourceFunction(source, "signedPolygonArea"),
  sourceFunction(source, "snapAxisAlignedEdges"),
  sourceFunction(source, "snapPolygonToWallFaces"),
  sourceFunction(source, "distanceToSegmentSquared"),
  "const WALL_STRIDE = 5;",
  "({ traceRegionContour, signedPolygonArea, snapAxisAlignedEdges, snapPolygonToWallFaces })"
].join("\n"));

function trace(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const region = Uint16Array.from(rows.join(""), (pixel) => pixel === "#" ? 1 : 0);
  const snapshot = region.slice();
  const contour = Array.from(geometry.traceRegionContour(region, width, height, 1, 0, 0, width - 1, height - 1));
  assert.deepEqual(region, snapshot, "tracing must preserve region ownership");
  assert.equal(geometry.signedPolygonArea(contour), region.reduce((sum, pixel) => sum + pixel, 0),
    "a simply connected region's polygon must preserve its exact raster area");

  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height && region[y * width + x] === 1;
  for (let index = 0; index < contour.length; index += 2) {
    const next = (index + 2) % contour.length;
    const dx = contour[next] - contour[index];
    const dy = contour[next + 1] - contour[index + 1];
    assert.ok((dx === 0) !== (dy === 0), "raw contours must follow nonzero grid edges");
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    for (let step = 0; step < Math.abs(dx) + Math.abs(dy); step += 1) {
      const x = contour[index] + (step + 0.5) * stepX;
      const y = contour[index + 1] + (step + 0.5) * stepY;
      assert.ok(inside(Math.floor(x - 0.5 * stepY), Math.floor(y + 0.5 * stepX)),
        "every boundary edge must keep the room on its inside");
      assert.ok(!inside(Math.floor(x + 0.5 * stepY), Math.floor(y - 0.5 * stepX)),
        "every boundary edge must keep the neighboring region outside");
    }
  }
  return contour;
}

assert.deepEqual(trace([
  "..........",
  "..........",
  "..######..",
  "..######..",
  "..######..",
  "..######..",
  "..######..",
  "..######..",
  ".........."
]), [2, 2, 8, 2, 8, 8, 2, 8], "straight runs must retain the true corners of a rectangular room");

assert.deepEqual(trace([
  "######",
  "######",
  "##....",
  "##....",
  "##...."
]), [0, 0, 6, 0, 6, 2, 2, 2, 2, 5, 0, 5], "concave room corners must remain exact");

trace([
  ".........",
  ".######..",
  "..######.",
  "...#####.",
  "....####.",
  ".....###.",
  "........."
]);
trace([
  ".........",
  ".###.###.",
  ".###.###.",
  ".#######.",
  ".###.###.",
  ".###.###.",
  "........."
]);
assert.deepEqual(trace(["#"]), [0, 0, 1, 0, 1, 1, 0, 1]);

const nearAxis = [0, 0, 30, 1, 60, 0, 90, 1, 90, 70, 0, 70];
const snap = (polygon) => Array.from(geometry.snapAxisAlignedEdges(polygon, Math.tan(4 * Math.PI / 180)));
const canonical = (polygon) => Array.from({ length: polygon.length / 2 }, (_, index) =>
  [polygon[index * 2], polygon[index * 2 + 1]]).sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
const expected = [0, 0.5, 90, 0.5, 90, 70, 0, 70];
assert.deepEqual(snap(nearAxis), expected, "successive near-horizontal edges must become one straight wall");
for (let start = 0; start < nearAxis.length; start += 2) {
  const shifted = [...nearAxis.slice(start), ...nearAxis.slice(0, start)];
  assert.deepEqual(canonical(snap(shifted)), canonical(expected), "axis snapping must not depend on the contour's starting corner");
}
const oblique = [0, 0, 30, 10, 30, 40, 0, 40];
assert.deepEqual(snap(oblique), oblique, "real oblique walls must remain oblique");

const walls = [
  [0, 0, 40, 0, 1], [40, 0, 40, 40, 1],
  [40, 40, 0, 40, 1], [0, 40, 0, 0, 1]
];
const snapWalls = (polygon, segments = walls, wallWidth = 2, rasterError = 0.25) =>
  Array.from(geometry.snapPolygonToWallFaces(Float64Array.from(polygon), Float64Array.from(segments.flat()), {
    forEachNear(_x, _y, _radius, visit) { segments.forEach((_segment, index) => visit(index)); }
  }, wallWidth, rasterError));
const bevel = [1, 1, 39, 1, 39, 39, 2.4, 39, 1, 37.6];
assert.deepEqual(snapWalls(bevel), [1, 1, 39, 1, 39, 39, 1, 39],
  "a raster bevel must recover the intersection of the two real wall faces");
const diagonalOffset = Math.SQRT1_2;
assert.equal(snapWalls(bevel, [...walls,
  [2.4 - diagonalOffset, 39 + diagonalOffset, 1 - diagonalOffset, 37.6 + diagonalOffset, 1]
]).length, bevel.length, "even a short diagonal wall with real support must keep its chamfer");
assert.equal(snapWalls(bevel, [walls[0], walls[1], [40, 40, 10, 40, 1], [0, 30, 0, 0, 1]]).length,
  bevel.length, "remote wall extensions must not manufacture a corner");

const angle = 27 * Math.PI / 180;
const rotate = (polygon) => polygon.flatMap((value, index) => index % 2 === 0 ? [
  100 + value * Math.cos(angle) - polygon[index + 1] * Math.sin(angle),
  -20 + value * Math.sin(angle) + polygon[index + 1] * Math.cos(angle)
] : []);
const rotated = snapWalls(rotate(bevel), walls.map((wall) => [...rotate(wall.slice(0, 4)), wall[4]]));
const rotatedExpected = rotate(snapWalls(bevel));
assert.equal(rotated.length, rotatedExpected.length);
rotated.forEach((coordinate, index) => assert.ok(Math.abs(coordinate - rotatedExpected[index]) < 1e-9,
  "supported corners must be equally accurate on rotated floorplans"));

const longEdge = [0, 0, 100, 0, 100, 60, 0, 60];
const shortTiltedStroke = [[49, -0.16, 51, -0.04, 0.1]];
assert.deepEqual(snapWalls(longEdge, shortTiltedStroke, 2, 0.1), longEdge,
  "a short wall fragment near an edge midpoint must not tilt its unsupported endpoints");

const thinWalls = walls.map((wall) => [...wall.slice(0, 4), 0.05]);
const quantizedOutside = [-0.02, -0.02, 40.02, -0.02, 40.02, 40.02, -0.02, 40.02];
const innerFaces = [0.05, 0.05, 39.95, 0.05, 39.95, 39.95, 0.05, 39.95];
const assertNear = (actual, expectedCoordinates) => actual.forEach((coordinate, index) =>
  assert.ok(Math.abs(coordinate - expectedCoordinates[index]) < 1e-9));
assertNear(snapWalls(quantizedOutside, thinWalls, 0.1), innerFaces);
const reverseRing = (polygon) => Array.from({ length: polygon.length / 2 }, (_, index) =>
  polygon.slice(polygon.length - 2 - index * 2, polygon.length - index * 2)).flat();
assertNear(snapWalls(reverseRing(quantizedOutside), thinWalls, 0.1), reverseRing(innerFaces));

console.log("Room boundary geometry: exact contours, straight runs, supported corners, genuine diagonals, rotation, and fragment rejection passed.");
