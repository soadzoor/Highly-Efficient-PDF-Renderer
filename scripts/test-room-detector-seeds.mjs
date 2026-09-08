// Synthetic room attribution checks; loads production TypeScript directly in Node.
import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    return result.format === "module-typescript"
      ? { ...result, format: "module", source: stripTypeScriptTypes(String(result.source), { mode: "transform" }) }
      : result;
  }
});

function sceneWithLabels(labels, { partition = true } = {}) {
  const lines = [[10, 10, 90, 10], [90, 10, 90, 90], [90, 90, 10, 90], [10, 90, 10, 10]];
  if (partition) lines.push([50, 10, 50, 45], [50, 55, 50, 90], [50, 45, 58, 45], [50, 55, 58, 55]);
  return {
    pageRects: new Float32Array([0, 0, 100, 100]),
    segmentCount: lines.length,
    endpoints: new Float32Array(lines.flat()),
    primitiveMeta: new Float32Array(lines.flatMap((line) => [line[2], line[3], 0, 1])),
    primitiveBounds: new Float32Array(lines.flatMap(([x0, y0, x1, y1]) => [
      Math.min(x0, x1) - 0.5, Math.min(y0, y1) - 0.5,
      Math.max(x0, x1) + 0.5, Math.max(y0, y1) + 0.5
    ])),
    styles: new Float32Array(lines.flatMap(() => [0.5, 0, 0, 0])),
    textContent: labels.map(([text, x, y]) => ({ text, minX: x - 1, maxX: x + 1, minY: y - 0.5, maxY: y + 0.5, pageIndex: 0 }))
  };
}

const options = {
  wallHalfWidthThreshold: 0.25,
  maxRasterSize: 512,
  minRoomAreaPixels: 100,
  minWallComponentFactor: 0,
  doorGapFactor: 4,
  doorGapFloorFactor: 0.0001,
  boundaryOffsetFactor: 0,
  detectUnlabeledRooms: false,
  collectDebugInfo: true
};

try {
  const { detectRooms } = await import("../src/roomDetector.ts");
  const baseline = detectRooms(sceneWithLabels([["101", 30, 50], ["102", 70, 50]]), options);
  assert.equal(baseline.rooms.length, 2);
  assert.equal(baseline.debug.pageStats.get(0).closureCount, 0, "fixture must exercise an open watershed neck");
  const unsplit = detectRooms(sceneWithLabels([["101", 30, 50], ["102", 70, 50]]), { ...options, splitByLabels: false });
  assert.equal(unsplit.rooms.length, 1);

  // The annotation is closer to label 101 in Euclidean distance, but it is inside
  // room 102 across a partition. It must follow geometry without seeding a new cell.
  const labels = [["101", 30, 50], ["102", 70, 80]];
  const withoutAnnotation = detectRooms(sceneWithLabels(labels), options);
  const withAnnotation = detectRooms(sceneWithLabels([...labels, ["J", 70, 20]]), options);
  assert.equal(withAnnotation.rooms.length, 2);
  for (const room of withoutAnnotation.rooms) {
    const annotatedRoom = withAnnotation.rooms.find((candidate) => candidate.roomNumber === room.roomNumber);
    assert.ok(annotatedRoom);
    assert.deepEqual(annotatedRoom.polygon, room.polygon, "annotation placement changed room geometry");
    assert.equal(annotatedRoom.labels.some((item) => item.text === "J"), room.roomNumber === "102");
  }

  const sharedRoom = detectRooms(sceneWithLabels([
    ["LOUNGE", 12, 12], ["LOUNGE", 88, 88], ["J", 70, 20]
  ], { partition: false }), options);
  assert.equal(sharedRoom.rooms.length, 1, "repeated labels in a continuous room must merge back");
  assert.equal(sharedRoom.rooms[0].labels.length, 3, "merge-back must retain all original label metadata");
  assert.ok(sharedRoom.rooms[0].area > 6_000);

  const overflowLabels = [
    ...Array.from({ length: 4_000 }, () => ["J", 1, 1]),
    ["101", 30, 50], ["102", 70, 50]
  ];
  const crowded = detectRooms(sceneWithLabels(overflowLabels), options);
  assert.equal(crowded.debug.pageStats.get(0).seedCount, 4_000);
  assert.equal(crowded.rooms.length, 2, "equipment text must not exhaust the seed limit before later room labels");
  const explicit = detectRooms(sceneWithLabels([]), {
    ...options,
    seeds: overflowLabels.map(([label, x, y]) => ({ label, x, y }))
  });
  assert.equal(explicit.debug.pageStats.get(0).seedCount, 4_000);
  assert.equal(explicit.rooms.length, 0, "explicit caller seeds must retain their requested priority order");

  const rotatedDimensionScene = sceneWithLabels([["101", 30, 50], ["102", 70, 50]]);
  rotatedDimensionScene.textContent.push({
    text: "20'-0\" CLEAR", minX: 41.5, maxX: 42.5, minY: 40, maxY: 60, pageIndex: 0
  });
  const rotatedDimension = detectRooms(rotatedDimensionScene, options);
  assert.equal(rotatedDimension.rooms.length, 2, "a rotated dimension must not bridge distant room-label clusters");
  console.log("Room detection preserves annotation ownership, shared spaces, late room labels, and rotated text clusters.");
} finally {
  hooks.deregister();
}
