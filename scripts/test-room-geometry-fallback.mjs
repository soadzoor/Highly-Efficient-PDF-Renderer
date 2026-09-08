// Shared room boundaries must stay simple and disjoint after geometry repair.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/roomDetector.ts", import.meta.url), "utf8");
const names = [
  "repairRoomGeometryConflicts", "chooseGeometryConflictSuppressions", "polygonBounds",
  "boundsHaveInteriorIntersection", "isSimplePolygon", "segmentsIntersectInclusive",
  "segmentsCrossProperly", "crossProduct", "pointOnSegment", "pointInPolygon",
  "pointInPolygonStrict", "polygonsHavePositiveAreaOverlap", "polygonIntervalsAtY",
  "polygonsHaveScanlineOverlap", "signedPolygonArea", "offsetPolygonOutward",
  "simplifyClosedPolyline", "simplifyChain", "simplifyChainWrapped", "distanceToSegmentSquared"
];
const geometry = vm.runInNewContext([
  ...names.map((name) => sourceFunction(source, name)),
  `({ ${names.join(", ")} })`
].join("\n"));

const shared = [[10, 0]];
for (let step = 1; step <= 30; step += 1) shared.push([9 + step, 2 * step], [10 + step, 2 * step]);
const raw = [
  new Float32Array([[-30, 0], ...shared, [-30, 60]].flat()),
  new Float32Array([...shared.toReversed(), [100, 0], [100, 60]].flat())
];
const offset = (polygon, distance) => new Float32Array(geometry.offsetPolygonOutward(polygon, distance));
const rooms = raw.map((polygon, index) => ({
  polygon: offset(polygon, 1.2), area: geometry.signedPolygonArea(polygon),
  labelX: index === 0 ? -20 : 90, labelY: 30, confidence: 0.8, labels: [], roomNumber: String(101 + index)
}));
const repair = geometry.repairRoomGeometryConflicts(rooms, raw.map((polygon) => offset(polygon, 0.4)), raw, 1);
assert.equal(repair.suppressedRoomIndices.size, 0, "both adjacent rooms must survive cleanup");
for (const [index, room] of rooms.entries()) {
  assert.ok(room.polygon.length / 2 <= 8, "a straight diagonal frontier must not retain every raster stair step");
  assert.ok(room.area >= 0.95 * geometry.signedPolygonArea(raw[index]), "cleanup must preserve room area");
  assert.ok(geometry.isSimplePolygon(room.polygon, 1e-9));
  assert.ok(geometry.pointInPolygon(room.labelX, room.labelY, room.polygon));
}
assert.equal(geometry.polygonsHavePositiveAreaOverlap(
  rooms[0].polygon, rooms[1].polygon,
  geometry.polygonBounds(rooms[0].polygon), geometry.polygonBounds(rooms[1].polygon), 1e-9
), false, "straightening a shared frontier must not create overlap");

// A secondary owned label near the frontier must survive even when the primary
// label is well inside the room and would not prevent an excessive inward margin.
const secondaryLabel = { text: "STORAGE", minX: 19.65, maxX: 19.85, minY: 19.9, maxY: 20.1 };
assert.ok(geometry.pointInPolygon(19.75, 20, raw[0]));
const labeledRooms = raw.map((polygon, index) => ({
  ...rooms[index], polygon: offset(polygon, 1.2), labels: index === 0 ? [secondaryLabel] : []
}));
const labeledRepair = geometry.repairRoomGeometryConflicts(labeledRooms, raw.map((polygon) => offset(polygon, 0.4)), raw, 1);
assert.equal(labeledRepair.suppressedRoomIndices.size, 0);
assert.ok(geometry.pointInPolygon(19.75, 20, labeledRooms[0].polygon), "cleanup must preserve every owned interior label");
assert.equal(geometry.polygonsHavePositiveAreaOverlap(
  labeledRooms[0].polygon, labeledRooms[1].polygon,
  geometry.polygonBounds(labeledRooms[0].polygon), geometry.polygonBounds(labeledRooms[1].polygon), 1e-9
), false, "preserving a near-boundary label must not compromise room separation");

// A caller requesting a precise contour must not receive the default coarser
// simplification merely because independently processed rooms needed topology repair.
const preciseRooms = raw.map((polygon, index) => ({ ...rooms[index], polygon: offset(polygon, 1.2) }));
const preciseRepair = geometry.repairRoomGeometryConflicts(preciseRooms, raw.map((polygon) => offset(polygon, 0.4)), raw, 1, 0.01);
assert.equal(preciseRepair.suppressedRoomIndices.size, 0);
for (const [index, room] of preciseRooms.entries()) {
  assert.ok(room.polygon.length >= 0.8 * raw[index].length,
    "the requested simplification tolerance must preserve the detailed stair-step frontier");
}
assert.equal(geometry.polygonsHavePositiveAreaOverlap(
  preciseRooms[0].polygon, preciseRooms[1].polygon,
  geometry.polygonBounds(preciseRooms[0].polygon), geometry.polygonBounds(preciseRooms[1].polygon), 1e-9
), false, "preserving precise contours must not compromise room separation");

// Tiny rooms cannot pay the same inward margin as a large room. Their exact valid
// contour is preferable to either shrinking them materially or dropping the room.
const tiny = new Float32Array([0, 0, 2, 0, 2, 2, 0, 2]);
const invalid = new Float32Array([0, 0, 2, 2, 0, 2, 2, 0]);
const tinyRooms = [{ polygon: invalid, area: 4, labelX: 1, labelY: 1, confidence: 0.8, labels: [], roomNumber: "103" }];
const tinyRepair = geometry.repairRoomGeometryConflicts(tinyRooms, [invalid], [tiny], 1);
assert.equal(tinyRepair.suppressedRoomIndices.size, 0);
assert.deepEqual(Array.from(tinyRooms[0].polygon), Array.from(tiny));

console.log("Room geometry fallback: compact shared frontiers, area preservation, owned labels, tolerance control, and tiny rooms passed.");
