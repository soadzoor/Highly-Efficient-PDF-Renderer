// Focused production regressions for the deterministic room detector.
//
// Vite is used only as an in-process TypeScript/SSR transformer. Middleware mode does
// not bind a network listener, and HMR/WebSocket support is explicitly disabled.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const DEFAULT_PAGE = [0, 0, 100, 100];
const RASTER_SIZE = 512;

function line(x0, y0, x1, y1, halfWidth = 0.5, gray = 0) {
  return { x0, y0, x1, y1, halfWidth, gray };
}

function quadratic(x0, y0, controlX, controlY, x1, y1, halfWidth = 0.5, gray = 0) {
  return { x0, y0, controlX, controlY, x1, y1, halfWidth, gray, primitiveType: 1 };
}

function closedRectangle(minX, minY, maxX, maxY, halfWidth = 0.5) {
  return [
    line(minX, minY, maxX, minY, halfWidth),
    line(maxX, minY, maxX, maxY, halfWidth),
    line(maxX, maxY, minX, maxY, halfWidth),
    line(minX, maxY, minX, minY, halfWidth)
  ];
}

function subdividedRectangle(minX, minY, maxX, maxY, piecesPerSide, halfWidth = 0.5) {
  const segments = [];
  const addSide = (x0, y0, x1, y1) => {
    for (let index = 0; index < piecesPerSide; index += 1) {
      const start = index / piecesPerSide;
      const end = (index + 1) / piecesPerSide;
      segments.push(
        line(
          x0 + (x1 - x0) * start,
          y0 + (y1 - y0) * start,
          x0 + (x1 - x0) * end,
          y0 + (y1 - y0) * end,
          halfWidth
        )
      );
    }
  };
  addSide(minX, minY, maxX, minY);
  addSide(maxX, minY, maxX, maxY);
  addSide(maxX, maxY, minX, maxY);
  addSide(minX, maxY, minX, minY);
  return segments;
}

function rectangleWithBottomGap(minX, minY, maxX, maxY, gapMinX, gapMaxX, halfWidth = 0.5) {
  return [
    line(minX, minY, gapMinX, minY, halfWidth),
    line(gapMaxX, minY, maxX, minY, halfWidth),
    line(maxX, minY, maxX, maxY, halfWidth),
    line(maxX, maxY, minX, maxY, halfWidth),
    line(minX, maxY, minX, minY, halfWidth)
  ];
}

function polylineCircle(centerX, centerY, radius, pieceCount = 12, halfWidth = 0.05) {
  const segments = [];
  for (let index = 0; index < pieceCount; index += 1) {
    const startAngle = (index / pieceCount) * Math.PI * 2;
    const endAngle = ((index + 1) / pieceCount) * Math.PI * 2;
    segments.push(
      line(
        centerX + Math.cos(startAngle) * radius,
        centerY + Math.sin(startAngle) * radius,
        centerX + Math.cos(endAngle) * radius,
        centerY + Math.sin(endAngle) * radius,
        halfWidth
      )
    );
  }
  return segments;
}

function textItem(text, centerX, centerY, width = 8, height = 4) {
  return {
    text,
    minX: centerX - width / 2,
    minY: centerY - height / 2,
    maxX: centerX + width / 2,
    maxY: centerY + height / 2,
    pageIndex: 0
  };
}

function buildScene(segments, { page = DEFAULT_PAGE, textContent } = {}) {
  const endpoints = new Float32Array(segments.length * 4);
  const primitiveMeta = new Float32Array(segments.length * 4);
  const primitiveBounds = new Float32Array(segments.length * 4);
  const styles = new Float32Array(segments.length * 4);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const offset = index * 4;
    const isQuadratic = segment.primitiveType === 1;
    const controlX = isQuadratic ? segment.controlX : segment.x1;
    const controlY = isQuadratic ? segment.controlY : segment.y1;
    endpoints[offset] = segment.x0;
    endpoints[offset + 1] = segment.y0;
    endpoints[offset + 2] = controlX;
    endpoints[offset + 3] = controlY;
    primitiveMeta[offset] = segment.x1;
    primitiveMeta[offset + 1] = segment.y1;
    primitiveMeta[offset + 2] = isQuadratic ? 1 : 0;
    primitiveMeta[offset + 3] = 1; // opaque alpha, no style flags
    primitiveBounds[offset] = Math.min(segment.x0, controlX, segment.x1) - segment.halfWidth;
    primitiveBounds[offset + 1] = Math.min(segment.y0, controlY, segment.y1) - segment.halfWidth;
    primitiveBounds[offset + 2] = Math.max(segment.x0, controlX, segment.x1) + segment.halfWidth;
    primitiveBounds[offset + 3] = Math.max(segment.y0, controlY, segment.y1) + segment.halfWidth;
    styles[offset] = segment.halfWidth;
    styles[offset + 1] = segment.gray ?? 0;
    styles[offset + 2] = segment.gray ?? 0;
    styles[offset + 3] = segment.gray ?? 0;
  }

  const [minX, minY, maxX, maxY] = page;
  const bounds = { minX, minY, maxX, maxY };
  return {
    pageCount: 1,
    pageRects: Float32Array.from(page),
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    segmentCount: segments.length,
    bounds,
    pageBounds: bounds,
    ...(textContent === undefined ? {} : { textContent })
  };
}

function transformFixture(segments, page, textContent, scale, translateX, translateY) {
  const transformX = (x) => x * scale + translateX;
  const transformY = (y) => y * scale + translateY;
  return {
    segments: segments.map((segment) => ({
      x0: transformX(segment.x0),
      y0: transformY(segment.y0),
      x1: transformX(segment.x1),
      y1: transformY(segment.y1),
      halfWidth: segment.halfWidth * scale
    })),
    page: [transformX(page[0]), transformY(page[1]), transformX(page[2]), transformY(page[3])],
    textContent: textContent?.map((item) => ({
      ...item,
      minX: transformX(item.minX),
      minY: transformY(item.minY),
      maxX: transformX(item.maxX),
      maxY: transformY(item.maxY)
    }))
  };
}

function rotateFixture90(segments, page, translateX, translateY) {
  const [minX, minY, maxX, maxY] = page;
  const transformX = (_x, y) => translateX + maxY - y;
  const transformY = (x, _y) => translateY + x - minX;
  return {
    segments: segments.map((segment) => ({
      x0: transformX(segment.x0, segment.y0),
      y0: transformY(segment.x0, segment.y0),
      x1: transformX(segment.x1, segment.y1),
      y1: transformY(segment.x1, segment.y1),
      halfWidth: segment.halfWidth
    })),
    page: [translateX, translateY, translateX + (maxY - minY), translateY + (maxX - minX)]
  };
}

function detectorOptions(wallHalfWidth, overrides = {}) {
  return {
    wallHalfWidthThreshold: wallHalfWidth * 0.5,
    maxRasterSize: RASTER_SIZE,
    minRoomAreaPixels: 100,
    boundaryOffsetFactor: 0,
    collectDebugInfo: true,
    ...overrides
  };
}

function normalizedPolygon(room, page) {
  const [minX, minY, maxX, maxY] = page;
  const width = maxX - minX;
  const height = maxY - minY;
  const points = [];
  for (let index = 0; index + 1 < room.polygon.length; index += 2) {
    points.push([(room.polygon[index] - minX) / width, (room.polygon[index + 1] - minY) / height]);
  }
  return points;
}

function polygonBounds(room) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let index = 0; index + 1 < room.polygon.length; index += 2) {
    bounds.minX = Math.min(bounds.minX, room.polygon[index]);
    bounds.minY = Math.min(bounds.minY, room.polygon[index + 1]);
    bounds.maxX = Math.max(bounds.maxX, room.polygon[index]);
    bounds.maxY = Math.max(bounds.maxY, room.polygon[index + 1]);
  }
  return bounds;
}

function signedPolygonArea(room) {
  let twiceArea = 0;
  const vertexCount = room.polygon.length / 2;
  for (let index = 0; index < vertexCount; index += 1) {
    const next = (index + 1) % vertexCount;
    twiceArea +=
      room.polygon[index * 2] * room.polygon[next * 2 + 1] -
      room.polygon[next * 2] * room.polygon[index * 2 + 1];
  }
  return twiceArea / 2;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
      : 0;
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t));
}

function directedPolygonDistance(from, to) {
  let maxDistance = 0;
  for (const point of from) {
    let minDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < to.length; index += 1) {
      minDistance = Math.min(minDistance, pointToSegmentDistance(point, to[index], to[(index + 1) % to.length]));
    }
    maxDistance = Math.max(maxDistance, minDistance);
  }
  return maxDistance;
}

function assertNormalizedGeometryNear(
  actualRoom,
  actualPage,
  expectedRoom,
  expectedPage,
  tolerance,
  message,
  transformActualPoint = (point) => point
) {
  const actual = normalizedPolygon(actualRoom, actualPage).map(transformActualPoint);
  const expected = normalizedPolygon(expectedRoom, expectedPage);
  const distance = Math.max(directedPolygonDistance(actual, expected), directedPolygonDistance(expected, actual));
  assert.ok(distance <= tolerance, `${message}: normalized boundary distance ${distance} exceeds ${tolerance}`);

  const actualPageArea = (actualPage[2] - actualPage[0]) * (actualPage[3] - actualPage[1]);
  const expectedPageArea = (expectedPage[2] - expectedPage[0]) * (expectedPage[3] - expectedPage[1]);
  const areaDelta = Math.abs(actualRoom.area / actualPageArea - expectedRoom.area / expectedPageArea);
  assert.ok(areaDelta <= tolerance, `${message}: normalized area delta ${areaDelta} exceeds ${tolerance}`);
}

async function run() {
  const viteServer = await createServer({
    configFile: false,
    root: repoRootDir,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom"
  });

  const tests = [];
  const test = (name, body) => tests.push({ name, body });

  try {
    const { detectRooms } = await viteServer.ssrLoadModule("/src/roomDetector.ts");

    test("quadratic wall primitives use their control and true endpoint fields", () => {
      const result = detectRooms(
        buildScene([quadratic(10, 20, 40, 80, 90, 30, 1)]),
        detectorOptions(1, { minWallComponentFactor: 0 })
      );
      const walls = result.debug?.wallSegments;
      assert.ok(walls);
      assert.equal(walls.length, 32, "the quadratic was not flattened into eight connected wall runs");
      assert.ok(Math.abs(walls[2] - 17.8125) < 1e-6);
      assert.ok(Math.abs(walls[3] - 33.28125) < 1e-6);
      assert.ok(Math.abs(walls[14] - 45) < 1e-6);
      assert.ok(Math.abs(walls[15] - 52.5) < 1e-6);
      assert.ok(Math.abs(walls[30] - 90) < 1e-6);
      assert.ok(Math.abs(walls[31] - 30) < 1e-6);
      for (let index = 0; index + 7 < walls.length; index += 4) {
        assert.ok(Math.abs(walls[index + 2] - walls[index + 4]) < 1e-6);
        assert.ok(Math.abs(walls[index + 3] - walls[index + 5]) < 1e-6);
      }
      const stats = result.debug?.pageStats.get(0);
      assert.equal(stats?.wallSegmentCount, 8);
      assert.ok(Math.abs((stats?.totalStrokeLength ?? 0) - 137.79271744364846) < 1e-6);
    });

    test("a tightly curved quadratic is door-arc evidence rather than a wall", () => {
      const result = detectRooms(
        buildScene([quadratic(40, 50, 44, 50, 42, 50.1, 2)]),
        detectorOptions(2, { minWallComponentFactor: 0 })
      );
      const stats = result.debug?.pageStats.get(0);
      assert.equal(stats?.doorArcCandidateSegmentCount, 4);
      assert.equal(stats?.wallSegmentCount, 0);
      assert.ok(Math.abs((stats?.totalStrokeLength ?? 0) - 6.002498363338199) < 1e-6);
    });

    test("paired wall faces recover an oversized doorway only with attached swing evidence", () => {
      const shell = [
        ...closedRectangle(10, 10, 90, 90, 0.05),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05)
      ];
      const partition = [
        line(49.75, 10.5, 49.75, 47.75, 0.05),
        line(50.25, 10.5, 50.25, 47.75, 0.05),
        line(49.75, 52.25, 49.75, 89.5, 0.05),
        line(50.25, 52.25, 50.25, 89.5, 0.05),
        // Long jamb/leaf runs prevent the ordinary whisker heuristic from sealing the
        // gap, so the test specifically exercises paired-track recovery.
        line(45.5, 52.25, 50.25, 52.25, 0.05),
        line(49.75, 47.75, 54.5, 47.75, 0.05)
      ];
      const swing = quadratic(49.75, 52.25, 49.75, 48.25, 45.75, 48.25, 0.05);
      const textContent = [textItem("OFFICE 101", 30, 50), textItem("OFFICE 102", 70, 50)];
      const options = detectorOptions(0.05, {
        minWallComponentFactor: 0,
        doorGapFactor: 35,
        doorGapFloorFactor: 0.0001,
        splitByLabels: false,
        detectUnlabeledRooms: false
      });

      const recovered = detectRooms(buildScene([...shell, ...partition, swing], { textContent }), options);
      assert.equal(recovered.rooms.length, 2);
      assert.deepEqual(recovered.rooms.map((room) => room.roomNumber).sort(), ["101", "102"]);
      assert.ok(recovered.rooms.every((room) => room.hasDoorEvidence));
      assert.equal(recovered.debug?.pageStats.get(0)?.pairedDoorRecoveryCount, 1);

      const noSwing = detectRooms(buildScene([...shell, ...partition], { textContent }), options);
      assert.equal(noSwing.rooms.length, 1, "wall faces alone manufactured a closed partition");
      assert.equal(noSwing.debug?.pageStats.get(0)?.pairedDoorRecoveryCount, 0);
    });

    test("a recovered paired wall, not attached furniture, defines the room boundary", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.05),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05),
        line(49.75, 10.5, 49.75, 47.75, 0.05),
        line(50.25, 10.5, 50.25, 47.75, 0.05),
        line(49.75, 52.25, 49.75, 89.5, 0.05),
        line(50.25, 52.25, 50.25, 89.5, 0.05),
        line(45.5, 52.25, 50.25, 52.25, 0.05),
        line(49.75, 47.75, 54.5, 47.75, 0.05),
        quadratic(49.75, 52.25, 49.75, 48.25, 45.75, 48.25, 0.05),
        // A narrow-mouthed, non-rectangular furniture outline touches the right wall
        // face. Its long detour must stay interior instead of replacing the wall edge.
        line(50.25, 35, 55, 35, 0.05),
        line(55, 35, 57, 35.6, 0.05),
        line(57, 35.6, 59, 35, 0.05),
        line(59, 35, 61, 35.6, 0.05),
        line(61, 35.6, 65, 35, 0.05),
        line(65, 35, 65, 36.8, 0.05),
        line(65, 36.8, 61, 36.2, 0.05),
        line(61, 36.2, 59, 36.8, 0.05),
        line(59, 36.8, 57, 36.2, 0.05),
        line(57, 36.2, 55, 36.8, 0.05),
        line(55, 36.8, 50.25, 36.8, 0.05)
      ];
      const textContent = [textItem("OFFICE 101", 30, 50), textItem("OFFICE 102", 70, 50)];
      const result = detectRooms(buildScene(segments, { textContent }), detectorOptions(0.05, {
        minWallComponentFactor: 0,
        doorGapFactor: 35,
        doorGapFloorFactor: 0.0001,
        splitByLabels: false,
        detectUnlabeledRooms: false
      }));

      assert.equal(result.rooms.length, 2);
      assert.equal(result.debug?.pageStats.get(0)?.pairedDoorRecoveryCount, 1);
      assert.ok((result.debug?.pageStats.get(0)?.geometryRepairCount ?? 0) >= 1);
      const rightRoom = result.rooms.find((room) => room.roomNumber === "102");
      assert.ok(rightRoom);
      const furnitureBoundaryVertices = [];
      for (let index = 0; index + 1 < rightRoom.polygon.length; index += 2) {
        const x = rightRoom.polygon[index];
        const y = rightRoom.polygon[index + 1];
        if (x > 52 && x < 70 && y > 34 && y < 38) {
          furnitureBoundaryVertices.push([x, y]);
        }
      }
      assert.deepEqual(furnitureBoundaryVertices, [], "the room boundary still followed the furniture detour");
    });

    const genericNotchShell = [
      ...closedRectangle(25, 25, 75, 75, 0.05),
      ...closedRectangle(25.5, 25.5, 74.5, 74.5, 0.05)
    ];
    const genericNotchText = [textItem("OFFICE 101", 62, 35)];
    const genericNotchOptions = detectorOptions(0.05, {
      maxRasterSize: 1024,
      minWallComponentFactor: 0,
      doorGapFactor: 35,
      doorGapFloorFactor: 0.0001,
      splitByLabels: false,
      detectUnlabeledRooms: false
    });

    test("a central desk on a narrow tether is removed by a generic paired-wall notch", () => {
      const structuralPartition = [
        line(39.75, 25.5, 39.75, 74.5, 0.05),
        line(40.25, 25.5, 40.25, 74.5, 0.05)
      ];
      const deskOutline = [
        // Raster expansion turns this 3.68-unit opening into roughly 1.11 inferred
        // door widths. The same-pen outline reaches the center of the labeled cell;
        // only the continuous partition behind its mouth is structurally paired.
        [40.25, 48.16],
        [48, 48.16],
        [49, 47.6],
        [50, 48.16],
        [51, 47.6],
        [52, 48.16],
        [53, 47.6],
        [55, 48.16],
        [58, 48.16],
        [58, 51.84],
        [55, 51.84],
        [53, 51.28],
        [52, 51.84],
        [51, 51.28],
        [50, 51.84],
        [49, 51.28],
        [48, 51.84],
        [40.25, 51.84]
      ];
      const deskSegments = deskOutline.slice(1).map((point, index) =>
        line(deskOutline[index][0], deskOutline[index][1], point[0], point[1], 0.05)
      );
      const clean = detectRooms(
        buildScene([...genericNotchShell, ...structuralPartition], { textContent: genericNotchText }),
        genericNotchOptions
      );
      const result = detectRooms(
        buildScene([...genericNotchShell, ...structuralPartition, ...deskSegments], {
          textContent: genericNotchText
        }),
        genericNotchOptions
      );

      assert.equal(clean.rooms.length, 1);
      assert.equal(result.rooms.length, 1);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(result.debug?.pageStats.get(0)?.pairedDoorRecoveryCount, 0);
      assert.ok(
        (result.debug?.pageStats.get(0)?.geometryRepairCount ?? 0) >
          (clean.debug?.pageStats.get(0)?.geometryRepairCount ?? 0)
      );
      assert.ok(
        result.rooms[0].polygon.length / 2 <= 12,
        `the repaired contour retained ${result.rooms[0].polygon.length / 2} vertices`
      );
      assert.deepEqual(
        Array.from({ length: result.rooms[0].polygon.length / 2 }, (_, index) => [
          result.rooms[0].polygon[index * 2],
          result.rooms[0].polygon[index * 2 + 1]
        ]).filter(([x, y]) => x > 42 && y > 47 && y < 53),
        [],
        "desk or chair vertices remain inside the room contour"
      );
      assertNormalizedGeometryNear(
        result.rooms[0],
        DEFAULT_PAGE,
        clean.rooms[0],
        DEFAULT_PAGE,
        2 / RASTER_SIZE,
        "the generic notch repair did not restore the clean paired-wall face"
      );
      assert.ok(result.rooms[0].area >= 0.99 * clean.rooms[0].area);
    });

    test("a coherently paired narrow bay is not erased as a furniture notch", () => {
      // P is the room-facing outline of a deep, narrow architectural bay. Q is its
      // consistently inset second face; every detour leg therefore has paired-wall
      // support even though its mouth and fill area resemble the desk fixture.
      const outerFace = [
        [25.5, 48.05],
        [36, 48.05],
        [36, 46.95],
        [38.5, 46.95],
        [38.5, 48.05],
        [41.5, 48.05],
        [41.5, 51.95],
        [38.5, 51.95],
        [38.5, 53.05],
        [36, 53.05],
        [36, 51.95],
        [25.5, 51.95]
      ];
      const innerFace = [
        [25.5, 48.45],
        [36.4, 48.45],
        [36.4, 47.35],
        [38.1, 47.35],
        [38.1, 48.45],
        [41.1, 48.45],
        [41.1, 51.55],
        [38.1, 51.55],
        [38.1, 52.65],
        [36.4, 52.65],
        [36.4, 51.55],
        [25.5, 51.55]
      ];
      const pairedBay = [outerFace, innerFace].flatMap((face) =>
        face.slice(1).map((point, index) =>
          line(face[index][0], face[index][1], point[0], point[1], 0.05)
        )
      );
      const clean = detectRooms(
        buildScene(genericNotchShell, { textContent: genericNotchText }),
        genericNotchOptions
      );
      const result = detectRooms(
        buildScene([...genericNotchShell, ...pairedBay], { textContent: genericNotchText }),
        genericNotchOptions
      );

      assert.equal(result.rooms.length, 1);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(result.debug?.pageStats.get(0)?.pairedDoorRecoveryCount, 0);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 0);
      assert.ok(result.rooms[0].polygon.length / 2 >= 12, "the paired bay was flattened");
      assert.ok(result.rooms[0].area < clean.rooms[0].area - 50, "the structural bay was filled");
      assert.ok(
        Array.from({ length: result.rooms[0].polygon.length / 2 }, (_, index) => [
          result.rooms[0].polygon[index * 2],
          result.rooms[0].polygon[index * 2 + 1]
        ]).some(([x, y]) => x > 40.5 && y > 47.5 && y < 52.5),
        "the paired structural cap disappeared"
      );
    });

    test("perpendicular paired wall faces replace an attached equipment corner detour", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.05),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05),
        // Three paired runs form a stepped partition. There is no recovered door on
        // this fixture: the corner cleanup must use the general structural pairs.
        line(44.75, 89.5, 44.75, 52.25, 0.05),
        line(45.25, 89.5, 45.25, 52.25, 0.05),
        line(44.75, 51.75, 55.25, 51.75, 0.05),
        line(44.75, 52.25, 55.25, 52.25, 0.05),
        line(54.75, 51.75, 54.75, 10.5, 0.05),
        line(55.25, 51.75, 55.25, 10.5, 0.05),
        // A desk/equipment trace connects the two real faces and makes the raster
        // contour follow a complex diagonal chain instead of their orthogonal corner.
        line(45.25, 61.5, 46, 60.1, 0.05),
        line(46, 60.1, 46.6, 59.5, 0.05),
        line(46.6, 59.5, 47, 58.2, 0.05),
        line(47, 58.2, 48.8, 57.4, 0.05),
        line(48.8, 57.4, 49.3, 56.1, 0.05),
        line(49.3, 56.1, 51.2, 55.8, 0.05),
        line(51.2, 55.8, 52, 54.1, 0.05),
        line(52, 54.1, 53.8, 54.6, 0.05),
        line(53.8, 54.6, 54.2, 53.2, 0.05),
        line(54.2, 53.2, 55.25, 52.25, 0.05)
      ];
      const textContent = [textItem("OFFICE 101", 25, 30), textItem("OFFICE 102", 75, 70)];
      const result = detectRooms(buildScene(segments, { textContent }), detectorOptions(0.05, {
        minWallComponentFactor: 0,
        doorGapFactor: 35,
        doorGapFloorFactor: 0.0001,
        splitByLabels: false,
        detectUnlabeledRooms: false
      }));

      assert.equal(result.rooms.length, 2);
      assert.equal(result.debug?.pageStats.get(0)?.pairedDoorRecoveryCount, 0);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 1);
      const room = result.rooms.find((candidate) => candidate.roomNumber === "102");
      assert.ok(room);
      assert.ok(room.polygon.length / 2 <= 8, `equipment corner retained ${room.polygon.length / 2} vertices`);
      assert.ok(room.area > 3_040, `equipment still cut into the structural corner: ${room.area}`);
      const detourVertices = [];
      for (let index = 0; index + 1 < room.polygon.length; index += 2) {
        const x = room.polygon[index];
        const y = room.polygon[index + 1];
        if (x > 45.8 && x < 55.2 && y > 52.6 && y < 61) {
          detourVertices.push([x, y]);
        }
      }
      assert.deepEqual(detourVertices, [], "the repaired corner still follows equipment geometry");
      const cornerVertices = Array.from({ length: room.polygon.length / 2 }, (_, index) => [
        room.polygon[index * 2],
        room.polygon[index * 2 + 1]
      ]).filter(([x, y]) => x > 45 && x < 56 && y > 52 && y < 62);
      assert.equal(cornerVertices.length, 3);
      assert.ok(Math.abs(cornerVertices[0][0] - cornerVertices[1][0]) < 1e-6, "first wall leg is slanted");
      assert.ok(Math.abs(cornerVertices[1][1] - cornerVertices[2][1]) < 1e-6, "second wall leg is slanted");
    });

    test("a genuine paired diagonal chamfer is not squared into an orthogonal corner", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.05),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05),
        line(44.75, 89.5, 44.75, 52.25, 0.05),
        line(45.25, 89.5, 45.25, 52.25, 0.05),
        line(44.75, 51.75, 55.25, 51.75, 0.05),
        line(44.75, 52.25, 55.25, 52.25, 0.05),
        line(54.75, 51.75, 54.75, 10.5, 0.05),
        line(55.25, 51.75, 55.25, 10.5, 0.05),
        // Two clean parallel faces make the diagonal independently structural. It is
        // therefore a real chamfer, even though perpendicular pairs meet behind it.
        line(45.25, 61.5, 55.25, 52.25, 0.05),
        line(45.6, 61.87, 55.6, 52.62, 0.05)
      ];
      const textContent = [textItem("OFFICE 101", 25, 30), textItem("OFFICE 102", 75, 70)];
      const result = detectRooms(buildScene(segments, { textContent }), detectorOptions(0.05, {
        minWallComponentFactor: 0,
        doorGapFactor: 35,
        doorGapFloorFactor: 0.0001,
        splitByLabels: false,
        detectUnlabeledRooms: false
      }));

      assert.equal(result.rooms.length, 2);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 0);
      const room = result.rooms.find((candidate) => candidate.roomNumber === "102");
      assert.ok(room);
      assert.equal(room.polygon.length / 2, 7);
      assert.ok(room.area < 3_010, `the real chamfer was filled: ${room.area}`);
      assert.ok(
        Array.from({ length: room.polygon.length / 2 }, (_, index) => [
          room.polygon[index * 2],
          room.polygon[index * 2 + 1]
        ]).some(([x, y]) => x > 50 && x < 56.5 && y > 52.3 && y < 58),
        "the paired diagonal chamfer disappeared"
      );
    });

    const pairedCapStructure = [
      ...closedRectangle(10, 10, 90, 90, 0.05),
      ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05),
      // Two paired side tracks and their paired perpendicular cap enclose room 102.
      line(44.75, 89.5, 44.75, 51.75, 0.05),
      line(45.25, 89.5, 45.25, 52.25, 0.05),
      line(60.15, 89.5, 60.15, 52.25, 0.05),
      line(60.65, 89.5, 60.65, 51.75, 0.05),
      line(44.75, 51.75, 60.65, 51.75, 0.05),
      line(45.25, 52.25, 60.15, 52.25, 0.05)
    ];
    const pairedCapText = [textItem("OFFICE 101", 25, 30), textItem("OFFICE 102", 51, 70)];
    const pairedCapOptions = detectorOptions(0.05, {
      maxRasterSize: 1024,
      minWallComponentFactor: 0,
      doorGapFactor: 35,
      doorGapFloorFactor: 0.0001,
      splitByLabels: false,
      detectUnlabeledRooms: false
    });
    const pairedCapFurniture = [
      line(45.25, 55.1, 46.2, 54.7, 0.05),
      line(46.2, 54.7, 47.1, 55, 0.05),
      line(47.1, 55, 48.1, 54.2, 0.05),
      line(48.1, 54.2, 49.2, 54.8, 0.05),
      line(49.2, 54.8, 50.3, 53.9, 0.05),
      line(50.3, 53.9, 51.4, 54.5, 0.05),
      line(51.4, 54.5, 52.5, 53.8, 0.05),
      line(52.5, 53.8, 53.5, 54.6, 0.05),
      line(53.5, 54.6, 54.5, 54, 0.05),
      line(54.5, 54, 55.5, 54.8, 0.05),
      line(55.5, 54.8, 56.3, 54.4, 0.05),
      line(56.3, 54.4, 57.3, 55, 0.05),
      line(57.3, 55, 58.3, 54.1, 0.05),
      line(58.3, 54.1, 59.2, 54.7, 0.05),
      line(59.2, 54.7, 60.15, 55.1, 0.05)
    ];

    test("three paired walls restore a cap obscured by attached furniture", () => {
      const clean = detectRooms(
        buildScene(pairedCapStructure, { textContent: pairedCapText }),
        pairedCapOptions
      );
      const result = detectRooms(
        buildScene([...pairedCapStructure, ...pairedCapFurniture], { textContent: pairedCapText }),
        pairedCapOptions
      );

      assert.equal(clean.rooms.length, 2);
      assert.equal(result.rooms.length, 2);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 1);
      const cleanRoom = clean.rooms.find((candidate) => candidate.roomNumber === "102");
      const room = result.rooms.find((candidate) => candidate.roomNumber === "102");
      assert.ok(cleanRoom);
      assert.ok(room);
      assert.ok(room.polygon.length / 2 <= 6, `equipment cap retained ${room.polygon.length / 2} vertices`);
      assert.ok(
        room.area > cleanRoom.area - 3.5,
        `equipment still cut into the structural cap: ${room.area} versus ${cleanRoom.area}`
      );

      const points = Array.from({ length: room.polygon.length / 2 }, (_, index) => [
        room.polygon[index * 2],
        room.polygon[index * 2 + 1]
      ]);
      assert.deepEqual(
        points.filter(([x, y]) => x > 45.6 && x < 59.8 && y > 53 && y < 56.5),
        [],
        "the repaired cap still follows furniture geometry"
      );
      const capY = Math.min(...points.map((point) => point[1]));
      const capCorners = points.filter((point) => Math.abs(point[1] - capY) < 1e-6);
      assert.equal(capCorners.length, 2);
      assert.ok(Math.abs(capCorners[0][0] - capCorners[1][0]) > 10, "the structural cap was not restored");
    });

    test("a nearer genuine paired cap is not replaced by a remote structural cap", () => {
      const nearerCap = [
        // This genuine barrier is long enough to be structural (>2 door gaps), but
        // deliberately shorter than the selectable-cap threshold of four gaps. Small
        // end gaps are closed by ordinary wall continuation, not by the remote cap.
        line(47.25, 52.9, 58.15, 52.9, 0.05),
        line(47.25, 53.3, 58.15, 53.3, 0.05)
      ];
      const result = detectRooms(
        buildScene([...pairedCapStructure, ...nearerCap, ...pairedCapFurniture], {
          textContent: pairedCapText
        }),
        pairedCapOptions
      );

      assert.equal(result.rooms.length, 2);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 0);
      const room = result.rooms.find((candidate) => candidate.roomNumber === "102");
      assert.ok(room);
      assert.ok(room.polygon.length / 2 >= 10, "the nearer-cap negative did not exercise cap repair");
      assert.ok(room.area < 548, `the nearer structural cap was skipped: ${room.area}`);
      assert.ok(
        Array.from({ length: room.polygon.length / 2 }, (_, index) => [
          room.polygon[index * 2],
          room.polygon[index * 2 + 1]
        ]).some(([x, y]) => x > 45.6 && x < 59.8 && y > 53.5 && y < 55.5),
        "the table-like contour was incorrectly replaced by the remote cap"
      );
    });

    test("a genuine paired diagonal cap is not replaced by an orthogonal cap", () => {
      const diagonalCap = [
        line(45.25, 56, 60.15, 53, 0.05),
        line(45.35, 56.4, 60.25, 53.4, 0.05)
      ];
      const result = detectRooms(
        buildScene([...pairedCapStructure, ...diagonalCap], { textContent: pairedCapText }),
        pairedCapOptions
      );

      assert.equal(result.rooms.length, 2);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 0);
      const room = result.rooms.find((candidate) => candidate.roomNumber === "102");
      assert.ok(room);
      assert.ok(room.area < 520, `the genuine diagonal cap was filled: ${room.area}`);
      const points = Array.from({ length: room.polygon.length / 2 }, (_, index) => [
        room.polygon[index * 2],
        room.polygon[index * 2 + 1]
      ]);
      assert.ok(
        points.some((point, index) => {
          const next = points[(index + 1) % points.length];
          return Math.abs(next[0] - point[0]) > 8 && Math.abs(next[1] - point[1]) > 1.5;
        }),
        "the paired diagonal cap disappeared"
      );
    });

    const pairedEnvelopeStructure = [
      // Each real wall has two independently drawn faces. The deliberately extended
      // runs make the four corners part of a crossing architectural wall network.
      line(30, 32, 30, 53, 0.05),
      line(30.5, 32, 30.5, 53, 0.05),
      line(50, 32, 50, 53, 0.05),
      line(50.5, 32, 50.5, 53, 0.05),
      line(27, 35, 53.5, 35, 0.05),
      line(27, 35.5, 53.5, 35.5, 0.05),
      line(27, 50, 53.5, 50, 0.05),
      line(27, 50.5, 53.5, 50.5, 0.05)
    ];
    const pairedEnvelopeOptions = detectorOptions(0.05, {
      maxRasterSize: 1024,
      minWallComponentFactor: 0,
      doorGapFactor: 35,
      doorGapFloorFactor: 0.0001,
      splitByLabels: false,
      detectUnlabeledRooms: false
    });

    test("three paired room sides recover a full side displaced by attached equipment", () => {
      const equipmentBarrier = [
        // This single-stroke desk edge joins the top and bottom walls. Its small steps
        // make the detected room follow furniture instead of the real left wall face.
        line(32.05, 35.5, 32.05, 41, 0.05),
        line(32.05, 41, 33.2, 41.7, 0.05),
        line(33.2, 41.7, 32.6, 42.4, 0.05),
        line(32.6, 42.4, 33.2, 43.1, 0.05),
        line(33.2, 43.1, 32.6, 43.8, 0.05),
        line(32.6, 43.8, 33.2, 44.5, 0.05),
        line(33.2, 44.5, 32.05, 45.2, 0.05),
        line(32.05, 45.2, 32.05, 50, 0.05)
      ];
      const result = detectRooms(
        buildScene([...pairedEnvelopeStructure, ...equipmentBarrier], {
          textContent: [textItem("OFFICE 101", 42, 43)]
        }),
        pairedEnvelopeOptions
      );

      assert.equal(result.rooms.length, 1);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(
        result.debug?.pageStats.get(0)?.geometryRepairCount,
        1,
        "the strict rectangular-envelope repair did not run"
      );
      const room = result.rooms[0];
      assert.equal(room.polygon.length / 2, 4, "the recovered room still follows the stepped equipment edge");
      const bounds = polygonBounds(room);
      assert.ok(bounds.minX < 31, `the real left wall face was not restored: ${bounds.minX}`);
      assert.ok(bounds.maxX > 49.5 && bounds.minY < 36 && bounds.maxY > 49.5);
    });

    test("an isolated paired table cannot manufacture an outward room envelope", () => {
      const pairedTable = [
        // The two long rails look like a paired wall in isolation, but their short
        // table ends do not join the surrounding architectural wall network.
        line(34, 40, 47, 40, 0.05),
        line(34, 40.5, 47, 40.5, 0.05),
        line(34, 45, 47, 45, 0.05),
        line(34, 45.5, 47, 45.5, 0.05),
        line(34, 40, 34, 45.5, 0.05),
        line(47, 40, 47, 45.5, 0.05)
      ];
      const result = detectRooms(
        buildScene([...pairedEnvelopeStructure, ...pairedTable], {
          textContent: [textItem("OFFICE 101", 42, 47.5)]
        }),
        pairedEnvelopeOptions
      );

      assert.equal(result.rooms.length, 1);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 0);
      assert.equal(result.rooms[0].polygon.length / 2, 4, "the isolated table reshaped the room envelope");
      const bounds = polygonBounds(result.rooms[0]);
      assert.ok(bounds.minX < 31 && bounds.maxX > 49.5 && bounds.minY < 36 && bounds.maxY > 49.5);
    });

    test("a floating paired table with long single-line caps cannot become a partition", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.05),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05),
        line(49.75, 30, 49.75, 47.75, 0.05),
        line(50.25, 30, 50.25, 47.75, 0.05),
        line(49.75, 52.25, 49.75, 70, 0.05),
        line(50.25, 52.25, 50.25, 70, 0.05),
        line(45.5, 52.25, 50.25, 52.25, 0.05),
        line(49.75, 47.75, 54.5, 47.75, 0.05),
        // These convincing long caps are retained wall candidates, but they are not
        // independently paired structural walls and therefore cannot anchor recovery.
        line(40, 30, 60, 30, 0.05),
        line(40, 70, 60, 70, 0.05),
        quadratic(49.75, 52.25, 49.75, 48.25, 45.75, 48.25, 0.05)
      ];
      const textContent = [textItem("OFFICE 101", 30, 50), textItem("OFFICE 102", 70, 50)];
      const result = detectRooms(buildScene(segments, { textContent }), detectorOptions(0.05, {
        minWallComponentFactor: 0,
        doorGapFactor: 35,
        doorGapFloorFactor: 0.0001,
        splitByLabels: false,
        detectUnlabeledRooms: false
      }));

      assert.equal(result.rooms.length, 1);
      assert.ok(result.rooms[0].area > 6_000);
      assert.equal(result.debug?.pageStats.get(0)?.pairedDoorRecoveryCount, 0);
    });

    test("a label-backed paired stub splits adjacent numbered rooms without disturbing their neighbor", () => {
      const shell = [
        ...closedRectangle(10, 10, 90, 90, 0.05),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05)
      ];
      const pairedStubFaces = [];
      const stubPieceCount = 38;
      for (let index = 0; index < stubPieceCount; index += 1) {
        const y0 = 10.5 + (37.25 * index) / stubPieceCount;
        const y1 = 10.5 + (37.25 * (index + 1)) / stubPieceCount;
        pairedStubFaces.push(
          line(39.75, y0, 39.75, y1, 0.01),
          line(40.25, y0, 40.25, y1, 0.01)
        );
      }
      const segments = [
        ...shell,
        // A paired vertical stub separates rooms 101 and 102. Its many thin, short
        // source fragments are omitted by the general filter, but pair into one long
        // wall.
        // The top meets the paired shell and the bottom has an attached door swing.
        ...pairedStubFaces,
        quadratic(39.75, 47.75, 39.75, 51.75, 37.75, 51.75, 0.05, 0.7),
        // The swing ends on this perpendicular paired partition. It protects room 103
        // and provides structural corroboration for the missing vertical stub.
        line(10.5, 51.75, 89.5, 51.75, 0.05),
        line(10.5, 52.25, 89.5, 52.25, 0.05),
        // Attached equipment makes a long U-shaped detour from the room-103 face.
        // It is not structural and must not replace the straight horizontal partition.
        line(55, 52.25, 55, 60, 0.05, 0.7),
        line(55, 60, 75, 60, 0.05, 0.7),
        line(75, 60, 75, 52.25, 0.05, 0.7)
      ];
      const textContent = [
        textItem("101", 38, 28),
        textItem("OFFICE", 38, 32),
        textItem("CLSW", 38, 36),
        textItem("102", 42, 28),
        textItem("OFFICE", 42, 32),
        textItem("CLSW", 42, 36),
        textItem("103", 70, 70),
        textItem("OFFICE", 70, 74),
        textItem("CLSW", 70, 78),
        textItem("MOBP", 70, 82)
      ];
      const result = detectRooms(buildScene(segments, { textContent }), {
        maxRasterSize: RASTER_SIZE,
        minRoomAreaPixels: 100,
        boundaryOffsetFactor: 0,
        collectDebugInfo: true,
        minWallComponentFactor: 0,
        doorGapFactor: 35,
        doorGapFloorFactor: 0.0001,
        splitByLabels: false,
        detectUnlabeledRooms: false
      });

      assert.deepEqual(
        result.rooms.map((room) => room.roomNumber).sort(),
        ["101", "102", "103"],
        "the selected attempt re-merged the two rooms recovered by structural walls"
      );
      assert.equal(result.failedSeeds.length, 0);

      const roomsByNumber = new Map(result.rooms.map((room) => [room.roomNumber, room]));
      for (const roomNumber of ["101", "102", "103"]) {
        const room = roomsByNumber.get(roomNumber);
        assert.ok(room);
        assert.deepEqual(
          room.labels.map((label) => label.text).filter((text) => /^\d{3}$/.test(text)),
          [roomNumber],
          `room ${roomNumber} absorbed a foreign numeric label cluster`
        );
      }

      const room101Bounds = polygonBounds(roomsByNumber.get("101"));
      const room102Bounds = polygonBounds(roomsByNumber.get("102"));
      const room103 = roomsByNumber.get("103");
      const room103Bounds = polygonBounds(room103);
      assert.ok(room101Bounds.maxX < room102Bounds.minX, "rooms 101 and 102 cross their paired wall faces");
      assert.ok(
        Math.max(room101Bounds.maxY, room102Bounds.maxY) < room103Bounds.minY,
        "the recovered split overlaps the protected neighbor"
      );
      assert.ok(
        Math.abs(room103Bounds.minY - 52.3) < 0.35,
        `room 103 did not use the long structural partition: ${room103Bounds.minY}`
      );
      const equipmentDetourVertices = [];
      for (let index = 0; index + 1 < room103.polygon.length; index += 2) {
        const x = room103.polygon[index];
        const y = room103.polygon[index + 1];
        if (x > 53 && x < 77 && y > 54 && y < 62) {
          equipmentDetourVertices.push([x, y]);
        }
      }
      assert.deepEqual(equipmentDetourVertices, [], "the adjacent room still follows attached equipment");
    });

    test("short floating paired furniture cannot manufacture a room split", () => {
      const shell = [
        ...closedRectangle(10, 10, 90, 90, 0.05),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.05)
      ];
      const floatingFurniture = [
        // The thin paired sides are absent from ordinary occupancy, just like the
        // positive stub, but float between unpaired table caps instead of real walls.
        line(49.75, 30, 49.75, 47.75, 0.01),
        line(50.25, 30, 50.25, 47.75, 0.01),
        line(49.75, 52.25, 49.75, 70, 0.01),
        line(50.25, 52.25, 50.25, 70, 0.01),
        line(45.5, 52.25, 50.25, 52.25, 0.05),
        line(49.75, 47.75, 54.5, 47.75, 0.05),
        line(40, 30, 60, 30, 0.05),
        line(40, 70, 60, 70, 0.05),
        quadratic(49.75, 52.25, 49.75, 48.25, 45.75, 48.25, 0.05)
      ];
      const textContent = [
        textItem("101", 30, 44),
        textItem("OFFICE", 30, 48),
        textItem("CLSW", 30, 52),
        textItem("PRINT", 30, 56),
        textItem("MOBP", 30, 60),
        textItem("102", 70, 44),
        textItem("OFFICE", 70, 48),
        textItem("CLSW", 70, 52),
        textItem("PRINT", 70, 56),
        textItem("MOBP", 70, 60)
      ];
      const options = {
        maxRasterSize: RASTER_SIZE,
        minRoomAreaPixels: 100,
        boundaryOffsetFactor: 0,
        collectDebugInfo: true,
        minWallComponentFactor: 0,
        doorGapFactor: 35,
        doorGapFloorFactor: 0.0001,
        splitByLabels: false,
        detectUnlabeledRooms: false
      };
      const clean = detectRooms(buildScene(shell, { textContent }), options);
      const result = detectRooms(buildScene([...shell, ...floatingFurniture], { textContent }), options);

      assert.equal(clean.rooms.length, 1);
      assert.equal(result.rooms.length, 1, "floating furniture manufactured a structural split");
      assert.deepEqual(
        Array.from(result.rooms[0].polygon),
        Array.from(clean.rooms[0].polygon),
        "floating furniture changed the enclosing room polygon"
      );
      assert.equal(result.rooms[0].area, clean.rooms[0].area);
    });

    test("an enclosure with a large exterior opening leaks", () => {
      const segments = rectangleWithBottomGap(20, 20, 80, 80, 40, 60, 0.5);
      const scene = buildScene(segments, { textContent: [textItem("ROOM 101", 50, 50)] });
      const result = detectRooms(scene, detectorOptions(0.5));
      assert.equal(result.rooms.length, 0);
      assert.ok(result.failedSeeds.some((failure) => failure.reason === "leaked"));
      assert.equal(result.debug?.pageStats.get(0)?.closureCount, 0);
    });

    test("structural PDF hairlines are recovered only as a ranked fallback", () => {
      const textContent = Array.from({ length: 10 }, (_, index) =>
        textItem(index === 0 ? "CONFERENCE" : `10${index}`, 30 + (index % 3) * 10, 35 + Math.floor(index / 3) * 8, 7, 3)
      );
      const segments = [
        ...subdividedRectangle(10, 10, 90, 90, 20, 0),
        ...subdividedRectangle(10.5, 10.5, 89.5, 89.5, 20, 0)
      ];
      const result = detectRooms(buildScene(segments, { textContent }), {
        maxRasterSize: RASTER_SIZE,
        minRoomAreaPixels: 100,
        boundaryOffsetFactor: 0,
        collectDebugInfo: true
      });
      assert.equal(result.rooms.length, 1);
      assert.ok(result.rooms[0].area > 5_000);
      assert.equal(result.failedSeeds.length, 0);
      assert.equal(result.debug?.pageStats.get(0)?.hairlineSegmentCount, 160);
      assert.equal(result.debug?.pageStats.get(0)?.eligibleSegmentCount, 160);
    });

    test("an isolated circular symbol cannot manufacture door evidence", () => {
      const openShell = rectangleWithBottomGap(25, 25, 75, 75, 40, 60, 0.05);
      const scene = buildScene([...openShell, ...polylineCircle(50, 50, 1.2, 12, 0.05)]);
      const result = detectRooms(scene, detectorOptions(0.05, { minRoomAreaPixels: 10 }));
      assert.equal(result.rooms.length, 0, "an isolated curve/circle was promoted to a room or sealed the open shell");
      assert.equal(result.debug?.pageStats.get(0)?.closureCount, 0);
    });

    test("an isolated circle cannot supply access to a sealed enclosure", () => {
      const segments = [
        ...closedRectangle(25, 25, 75, 75, 0.05),
        ...polylineCircle(50, 50, 1.2, 12, 0.05)
      ];
      const scene = buildScene(segments);
      const options = detectorOptions(0.05, { minRoomAreaPixels: 10 });

      const defaultResult = detectRooms(scene, options);
      assert.equal(defaultResult.rooms.length, 1, "default semantics should retain the sealed enclosure");
      assert.equal(defaultResult.rooms[0].hasDoorEvidence, false, "the isolated circle was mistaken for a door");

      const accessRequiredResult = detectRooms(scene, { ...options, requireDoor: true });
      assert.equal(accessRequiredResult.rooms.length, 0, "the isolated circle incorrectly satisfied requireDoor");
    });

    test("a sealed unlabeled shaft/enclosure is emitted", () => {
      const scene = buildScene(closedRectangle(35, 35, 65, 65, 0.5));
      const result = detectRooms(scene, detectorOptions(0.5));
      assert.equal(result.rooms.length, 1);
      assert.equal(result.rooms[0].labelText, "");
      assert.equal(result.rooms[0].hasDoorEvidence, false);
    });

    test("a narrow but room-sized sealed shaft is emitted", () => {
      const scene = buildScene(closedRectangle(47.5, 42, 52.5, 58, 0.5));
      const result = detectRooms(scene, detectorOptions(0.5));
      assert.equal(result.rooms.length, 1);
      assert.equal(result.rooms[0].labelText, "");
      assert.equal(result.rooms[0].hasDoorEvidence, false);
    });

    test("a thin sealed sliver is not promoted to a shaft", () => {
      const scene = buildScene(closedRectangle(48, 35, 52, 65, 0.5));
      const result = detectRooms(scene, detectorOptions(0.5));
      assert.equal(result.rooms.length, 0);
    });

    test("a long partition gap closes only with substantial wall backing", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        line(10, 50, 41, 50, 0.5),
        line(59, 50, 90, 50, 0.5)
      ];
      const result = detectRooms(buildScene(segments), detectorOptions(0.5));
      assert.equal(result.rooms.length, 2);
      assert.ok((result.debug?.pageStats.get(0)?.closureCount ?? 0) > 0);
      assert.ok(result.rooms.every((room) => room.hasDoorEvidence));
    });

    test("a shallow wall bay is not capped into a room", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        line(10, 50, 41, 50, 0.5),
        line(59, 50, 90, 50, 0.5),
        line(41, 60, 59, 60, 0.5)
      ];
      const result = detectRooms(buildScene(segments), detectorOptions(0.5));
      assert.equal(result.rooms.length, 1);
      assert.equal(result.debug?.pageStats.get(0)?.closureCount, 0);
      assert.equal(result.rooms[0].hasDoorEvidence, false);
    });

    test("unsupported long wall fragments cannot manufacture a partition", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        line(30, 50, 40, 50, 0.5),
        line(60, 50, 70, 50, 0.5)
      ];
      const result = detectRooms(buildScene(segments), detectorOptions(0.5));
      assert.equal(result.rooms.length, 1);
      assert.equal(result.debug?.pageStats.get(0)?.closureCount, 0);
      assert.equal(result.rooms[0].hasDoorEvidence, false);
    });

    test("an outer super room containing an inner room is suppressed", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        ...closedRectangle(40, 40, 60, 60, 0.5)
      ];
      const result = detectRooms(
        buildScene(segments),
        detectorOptions(0.5, { minWallComponentFactor: 0 })
      );
      assert.equal(result.rooms.length, 1, "the annular outer region was exposed as a containing super room");
      assert.ok(result.rooms[0].area < 600, `expected the inner room, received area ${result.rooms[0].area}`);
      assert.equal(result.debug?.pageStats.get(0)?.containedRoomSuppressionCount, 1);
    });

    test("a labeled room defeats an unlabeled furniture pocket inside it", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        ...closedRectangle(45, 45, 55, 55, 0.5)
      ];
      const result = detectRooms(
        buildScene(segments, {
          textContent: [textItem("CONFERENCE", 25, 27, 14, 3), textItem("101", 25, 23, 6, 3)]
        }),
        detectorOptions(0.5, { minWallComponentFactor: 0 })
      );
      assert.equal(result.rooms.length, 1);
      assert.ok(result.rooms[0].area > 5_000, `furniture pocket displaced the labeled room: ${result.rooms[0].area}`);
      assert.match(result.rooms[0].labelText, /CONFERENCE/);
      assert.match(result.rooms[0].labelText, /101/);
      assert.equal(result.debug?.pageStats.get(0)?.containedRoomSuppressionCount, 1);
    });

    test("a numeric tag frame cannot evict the real room around it", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        ...rectangleWithBottomGap(47, 47, 53, 53, 49.5, 50.5, 0.5)
      ];
      const result = detectRooms(
        buildScene(segments, {
          textContent: [textItem("LOBBY 100", 25, 25), textItem("123C", 50, 50, 4, 2)]
        }),
        detectorOptions(0.5, { minWallComponentFactor: 0 })
      );
      assert.equal(result.rooms.length, 1);
      assert.ok(
        result.rooms[0].area > 5_000,
        `tag frame displaced the surrounding room: area ${result.rooms[0].area}, label ${JSON.stringify(result.rooms[0].labelText)}, door=${result.rooms[0].hasDoorEvidence}`
      );
      assert.match(result.rooms[0].labelText, /LOBBY 100/);
      assert.doesNotMatch(result.rooms[0].labelText, /123C/);
      assert.equal(result.debug?.pageStats.get(0)?.containedRoomSuppressionCount, 0);
    });

    test("a tiny equipment watershed is absorbed without notching the room", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        line(50, 10, 50, 45, 0.5),
        line(50, 55, 50, 90, 0.5),
        line(50, 45, 58, 45, 0.5),
        line(50, 55, 58, 55, 0.5)
      ];
      const result = detectRooms(
        buildScene(segments, {
          textContent: [
            textItem("WORK STATION", 30, 41, 8, 1),
            textItem("1113", 30, 39, 2, 0.5),
            textItem("OFFICE", 70, 41, 5, 1),
            textItem("1114", 70, 39, 2, 0.5),
            textItem("CLSW", 54, 50.15, 2, 0.2),
            textItem("237", 54, 49.85, 1, 0.2)
          ]
        }),
        detectorOptions(0.5, {
          minRoomAreaPixels: 50,
          minWallComponentFactor: 0,
          doorGapFactor: 4,
          doorGapFloorFactor: 0.0001,
          detectUnlabeledRooms: false,
          boundaryOffsetFactor: 0.03
        })
      );

      assert.equal(result.rooms.length, 2);
      assert.equal(result.failedSeeds.length, 0);
      const room = result.rooms.find((candidate) => candidate.roomNumber === "1113");
      assert.ok(room, "the main room lost its number when the equipment cell was absorbed");
      assert.match(room.labelText, /WORK STATION/);
      assert.doesNotMatch(room.labelText, /CLSW|237/);
      const bayVertices = [];
      for (let index = 0; index + 1 < room.polygon.length; index += 2) {
        const x = room.polygon[index];
        const y = room.polygon[index + 1];
        if (x > 53.5 && y >= 45 && y <= 55) {
          bayVertices.push([x, y]);
        }
      }
      assert.equal(bayVertices.length, 2, `equipment left a polygon notch: ${JSON.stringify(bayVertices)}`);
      assert.ok(
        Math.abs(bayVertices[0][0] - bayVertices[1][0]) < 1e-6,
        `equipment bent a straight room edge: ${JSON.stringify(bayVertices)}`
      );
      assert.equal(result.debug?.pageStats.get(0)?.closureCount, 0);
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 0);
    });

    test("a dominant architectural stroke layer removes a wall-attached furniture bay", () => {
      const structuralGray = 0.325;
      const furnitureGray = 0.59;
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.1).map((segment) => ({ ...segment, gray: structuralGray })),
        line(10, 35, 35, 35, 0.1, furnitureGray),
        line(35, 35, 35, 65, 0.1, furnitureGray),
        line(35, 65, 10, 65, 0.1, furnitureGray)
      ];
      const textContent = Array.from({ length: 10 }, (_, index) =>
        textItem("OFFICE 101", 60 + (index % 2), 48 + (index % 5), 8, 2)
      );
      const result = detectRooms(buildScene(segments, { textContent }), {
        maxRasterSize: RASTER_SIZE,
        minRoomAreaPixels: 100,
        boundaryOffsetFactor: 0,
        minWallComponentFactor: 0,
        splitByLabels: false,
        detectUnlabeledRooms: false,
        collectDebugInfo: true
      });

      assert.equal(result.rooms.length, 1);
      assert.equal(result.rooms[0].polygon.length / 2, 4, "the light furniture bay still shaped the room boundary");
      assert.equal(result.debug?.pageStats.get(0)?.structuralGeometryRefinementCount, 1);
      const bounds = polygonBounds(result.rooms[0]);
      assert.ok(bounds.minX < 11 && bounds.maxX > 89 && bounds.minY < 11 && bounds.maxY > 89);
    });

    test("a same-number structural trace trims a label-free equipment excursion", () => {
      const structuralGray = 0.325;
      const equipmentGray = 0.59;
      const fragmentedPartition = [];
      for (let index = 0; index < 80; index += 1) {
        const y0 = 10.5 + (79 * index) / 80;
        const y1 = 10.5 + (79 * (index + 1)) / 80;
        fragmentedPartition.push(line(65, y0, 65, y1, 0.01, structuralGray));
      }
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.1).map((segment) => ({ ...segment, gray: structuralGray })),
        ...closedRectangle(10.5, 10.5, 89.5, 89.5, 0.1).map((segment) => ({ ...segment, gray: structuralGray })),
        ...fragmentedPartition,
        // An equipment-colored barrier joined to the outer wall makes the primary
        // room ring take a large detour through the space beyond the thin partition.
        line(89.5, 35, 72, 35, 0.1, equipmentGray),
        line(72, 35, 72, 65, 0.1, equipmentGray),
        line(72, 65, 89.5, 65, 0.1, equipmentGray)
      ];
      const textContent = [
        textItem("WORK STATION", 35, 42, 18, 4),
        textItem("101", 35, 48, 7, 4),
        textItem("EQ", 76, 70, 2, 0.6),
        textItem("J", 76, 72, 1, 0.6),
        textItem("DM", 80, 70, 2, 0.6),
        textItem("GFI", 80, 72, 2, 0.6),
        textItem("PR", 76, 78, 2, 0.6),
        textItem("TV", 79, 78, 2, 0.6),
        textItem("FA", 82, 78, 2, 0.6),
        textItem("AFF", 85, 78, 2, 0.6)
      ];
      const options = {
        maxRasterSize: RASTER_SIZE,
        // Keep the neighbor-side structural cell below the reporting threshold. Its
        // small tags must count as unexplained in alternate attempts, preserving the
        // primary room for conservative cross-attempt refinement.
        minRoomAreaPixels: 60_000,
        boundaryOffsetFactor: 0,
        minWallComponentFactor: 0,
        splitByLabels: false,
        detectUnlabeledRooms: false,
        collectDebugInfo: true
      };
      const primaryOnly = detectRooms(buildScene(segments, { textContent }), {
        ...options,
        wallHalfWidthThreshold: 0.05
      });
      const result = detectRooms(buildScene(segments, { textContent }), options);

      assert.equal(primaryOnly.rooms.length, 1);
      const primaryRoom = primaryOnly.rooms[0];
      assert.equal(primaryRoom.roomNumber, "101");
      assert.ok(primaryRoom.polygon.length / 2 >= 8, "control did not retain the equipment excursion");
      assert.match(primaryRoom.labelText, /GFI|AFF/);

      const room = result.rooms.find((candidate) => candidate.roomNumber === "101");
      assert.ok(room, `structural trim lost room 101: ${JSON.stringify(result.rooms.map((candidate) => candidate.roomNumber))}`);
      assert.ok(
        result.rooms.filter((candidate) => candidate !== room).every((candidate) => candidate.roomNumber === ""),
        `a small excursion tag became a room number: ${JSON.stringify(result.rooms.map((candidate) => candidate.roomNumber))}`
      );
      assert.equal(room.roomNumber, "101");
      assert.equal(room.polygon.length / 2, 4, "structural trace did not remove the large excursion");
      assert.equal(result.debug?.pageStats.get(0)?.structuralGeometryRefinementCount, 1);
      assert.match(room.labelText, /WORK STATION/);
      assert.match(room.labelText, /101/);
      assert.doesNotMatch(room.labelText, /GFI|AFF|DM|PR|TV/);
      assert.deepEqual(room.labels.map((label) => label.text).sort(), ["101", "WORK STATION"]);
      const bounds = polygonBounds(room);
      assert.ok(bounds.maxX < 66, `structural trim retained the neighbor excursion: ${bounds.maxX}`);

      // The same geometry must remain untrimmed when the excursion owns a label at the
      // architectural room-number scale. Label ownership, not the text itself, blocks
      // the otherwise valid structural replacement.
      const protectedResult = detectRooms(
        buildScene(segments, {
          textContent: [...textContent, textItem("STORAGE", 80, 74, 12, 4)]
        }),
        options
      );
      assert.equal(protectedResult.rooms.length, 1);
      const protectedRoom = protectedResult.rooms[0];
      assert.equal(protectedRoom.roomNumber, "101");
      assert.equal(protectedResult.debug?.pageStats.get(0)?.structuralGeometryRefinementCount, 0);
      assert.ok(protectedRoom.polygon.length / 2 >= 8, "architectural label did not block the trim");
      assert.match(protectedRoom.labelText, /STORAGE/);
      assert.match(protectedRoom.labelText, /GFI|AFF/);
      assert.deepEqual(Array.from(protectedRoom.polygon), Array.from(primaryRoom.polygon));
    });

    test("a structural-color trace cannot merge two accepted rooms", () => {
      const structuralGray = 0.325;
      const secondaryGray = 0.59;
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.1).map((segment) => ({ ...segment, gray: structuralGray })),
        line(50, 10, 50, 90, 0.1, secondaryGray)
      ];
      const textContent = Array.from({ length: 10 }, (_, index) => {
        const onLeft = index < 5;
        return textItem(onLeft ? "OFFICE 101" : "OFFICE 102", onLeft ? 30 : 70, 45 + (index % 5), 8, 2);
      });
      const result = detectRooms(buildScene(segments, { textContent }), {
        maxRasterSize: RASTER_SIZE,
        minRoomAreaPixels: 100,
        boundaryOffsetFactor: 0,
        minWallComponentFactor: 0,
        splitByLabels: false,
        detectUnlabeledRooms: false,
        collectDebugInfo: true
      });

      assert.equal(result.rooms.length, 2);
      assert.equal(result.debug?.pageStats.get(0)?.structuralGeometryRefinementCount, 0);
      assert.deepEqual(result.rooms.map((room) => room.roomNumber).sort(), ["101", "102"]);
    });

    test("a labeled open alcove is reconstructed from dominant walls, not its equipment", () => {
      const structuralGray = 0.325;
      const furnitureGray = 0.59;
      const structural = [
        ...closedRectangle(30, 5, 65, 40, 0.1).map((segment) => ({ ...segment, gray: structuralGray })),
        line(40, 5, 40, 16, 0.1, structuralGray),
        line(52, 5, 52, 16, 0.1, structuralGray),
        line(30, 16, 40, 16, 0.1, structuralGray),
        line(52, 16, 65, 16, 0.1, structuralGray)
      ];
      const equipment = [
        line(40, 12, 43.2, 12, 0.1, furnitureGray),
        line(43.2, 12, 43.2, 15.2, 0.1, furnitureGray),
        line(43.2, 15.2, 40, 15.2, 0.1, furnitureGray),
        ...closedRectangle(47, 6.5, 50.5, 9.2, 0.1).map((segment) => ({ ...segment, gray: furnitureGray }))
      ];
      const textContent = [
        textItem("SCSC", 44, 13.5, 2.2, 0.6),
        textItem("212DA", 44, 12.7, 2.2, 0.6),
        textItem("PATIENT", 47, 12, 4, 1),
        textItem("ALCOVE", 44.5, 11.1, 3.4, 1),
        textItem("WEIGH-IN", 46, 10.1, 4, 1),
        textItem("1119", 46, 8.7, 2.5, 1.4),
        textItem("SCSC", 43, 7.8, 2.2, 0.6),
        textItem("212", 43, 7.1, 1.6, 0.6),
        textItem("EQ", 47.5, 14.4, 1, 0.5),
        textItem("J", 48.5, 13.8, 0.5, 0.5)
      ];
      const result = detectRooms(buildScene([...structural, ...equipment], { textContent }), {
        maxRasterSize: RASTER_SIZE,
        minRoomAreaPixels: 25,
        boundaryOffsetFactor: 0,
        minWallComponentFactor: 0,
        splitByLabels: false,
        detectUnlabeledRooms: false,
        collectDebugInfo: true
      });

      assert.equal(result.rooms.length, 1);
      const room = result.rooms[0];
      assert.equal(room.roomNumber, "1119");
      assert.equal(room.labelX, 46, "the first equipment tag displaced the room-number anchor");
      assert.equal(room.labelY, 8.7, "the first equipment tag displaced the room-number anchor");
      assert.equal(room.polygon.length / 2, 4, "equipment still shaped the reconstructed alcove");
      const bounds = polygonBounds(room);
      assert.ok(Math.abs(bounds.minX - 40.1) < 0.3, `unexpected alcove left wall: ${bounds.minX}`);
      assert.ok(Math.abs(bounds.maxX - 52.1) < 0.3, `unexpected alcove right wall: ${bounds.maxX}`);
      assert.ok(Math.abs(bounds.minY - 5.1) < 0.3, `unexpected alcove back wall: ${bounds.minY}`);
      assert.ok(Math.abs(bounds.maxY - 15.9) < 0.3, `unexpected alcove open frontier: ${bounds.maxY}`);
      assert.equal(result.debug?.pageStats.get(0)?.openBayRefinementCount, 1);
    });

    test("an equipment-colored U shape cannot manufacture an open alcove", () => {
      const structuralGray = 0.325;
      const furnitureGray = 0.59;
      const segments = [
        ...closedRectangle(30, 5, 65, 40, 0.1).map((segment) => ({ ...segment, gray: structuralGray })),
        line(30, 16, 40, 16, 0.1, structuralGray),
        line(52, 16, 65, 16, 0.1, structuralGray),
        line(40, 5, 40, 16, 0.1, furnitureGray),
        line(52, 5, 52, 16, 0.1, furnitureGray),
        line(40, 12, 43.2, 12, 0.1, furnitureGray),
        line(43.2, 12, 43.2, 15.2, 0.1, furnitureGray),
        line(43.2, 15.2, 40, 15.2, 0.1, furnitureGray)
      ];
      const textContent = [
        textItem("PATIENT", 47, 12, 4, 1),
        textItem("ALCOVE", 44.5, 11.1, 3.4, 1),
        textItem("WEIGH-IN", 46, 10.1, 4, 1),
        textItem("1119", 46, 8.7, 2.5, 1.4),
        ...Array.from({ length: 6 }, (_, index) => textItem(`EQ${index}`, 43 + index, 7 + index * 0.4, 1, 0.5))
      ];
      const result = detectRooms(buildScene(segments, { textContent }), {
        maxRasterSize: RASTER_SIZE,
        minRoomAreaPixels: 25,
        boundaryOffsetFactor: 0,
        minWallComponentFactor: 0,
        splitByLabels: false,
        detectUnlabeledRooms: false,
        collectDebugInfo: true
      });

      assert.equal(result.rooms.length, 1);
      assert.equal(result.debug?.pageStats.get(0)?.openBayRefinementCount, 0);
      const bounds = polygonBounds(result.rooms[0]);
      assert.ok(bounds.minX < 31 && bounds.maxX > 64 && bounds.maxY > 39, "equipment strokes were promoted to walls");
    });

    test("larger architectural text wins over a smaller equipment number", () => {
      const result = detectRooms(
        buildScene(closedRectangle(10, 10, 90, 90, 0.5), {
          textContent: [
            textItem("MOBP", 50, 70, 6, 2),
            textItem("237", 50, 66, 3, 2),
            textItem("WORK STATION", 50, 54, 18, 4),
            textItem("1113", 50, 48, 7, 4)
          ]
        }),
        detectorOptions(0.5, { splitByLabels: false })
      );

      assert.equal(result.rooms.length, 1);
      assert.match(result.rooms[0].labelText, /237/);
      assert.equal(result.rooms[0].roomNumber, "1113");
    });

    test("outward boundary recovery cannot make adjacent rooms overlap", () => {
      const segments = [
        ...closedRectangle(10, 10, 90, 90, 0.5),
        line(50, 10, 50, 90, 0.5)
      ];
      const result = detectRooms(
        buildScene(segments),
        detectorOptions(0.5, { minWallComponentFactor: 0, boundaryOffsetFactor: 0.03 })
      );
      assert.equal(result.rooms.length, 2);
      for (const room of result.rooms) {
        assert.ok(signedPolygonArea(room) > 0, "topology fallback returned clockwise geometry");
      }
      const ordered = result.rooms
        .map((room) => ({ room, bounds: polygonBounds(room) }))
        .sort((left, right) => left.bounds.minX - right.bounds.minX);
      assert.ok(
        ordered[0].bounds.maxX <= ordered[1].bounds.minX,
        `adjacent rooms overlap from x=${ordered[1].bounds.minX} to x=${ordered[0].bounds.maxX}`
      );
      assert.equal(result.debug?.pageStats.get(0)?.geometryRepairCount, 2);
    });

    test("a sealed labeled shaft is independent of text-item order", () => {
      const segments = closedRectangle(35, 35, 65, 65, 0.5);
      const annotation = textItem("J", 47, 50, 2, 2);
      const shaft = textItem("SHAFT", 53, 50, 8, 3);
      const annotationFirst = detectRooms(
        buildScene(segments, { textContent: [annotation, shaft] }),
        detectorOptions(0.5, { requireDoor: true })
      );
      const shaftFirst = detectRooms(
        buildScene(segments, { textContent: [shaft, annotation] }),
        detectorOptions(0.5, { requireDoor: true })
      );
      assert.equal(annotationFirst.rooms.length, 1);
      assert.equal(shaftFirst.rooms.length, 1);
      assert.equal(annotationFirst.rooms[0].hasDoorEvidence, false);
      assert.equal(shaftFirst.rooms[0].hasDoorEvidence, false);
      assertNormalizedGeometryNear(
        annotationFirst.rooms[0],
        DEFAULT_PAGE,
        shaftFirst.rooms[0],
        DEFAULT_PAGE,
        2 / RASTER_SIZE,
        "text-item order changed the sealed shaft"
      );
    });

    test("adding or removing SHAFT text does not change enclosure geometry", () => {
      const segments = closedRectangle(35, 35, 65, 65, 0.5);
      const withoutText = detectRooms(buildScene(segments), detectorOptions(0.5));
      const withText = detectRooms(
        buildScene(segments, { textContent: [textItem("SHAFT", 50, 50)] }),
        detectorOptions(0.5)
      );
      assert.equal(withoutText.rooms.length, 1);
      assert.equal(withText.rooms.length, 1);
      assert.equal(withoutText.rooms[0].hasDoorEvidence, false);
      assert.equal(withText.rooms[0].hasDoorEvidence, false);
      assertNormalizedGeometryNear(
        withText.rooms[0],
        DEFAULT_PAGE,
        withoutText.rooms[0],
        DEFAULT_PAGE,
        2 / RASTER_SIZE,
        "SHAFT text changed the detected enclosure"
      );
    });

    test("a large enclosed room is not mistaken for an exterior leak", () => {
      const segments = rectangleWithBottomGap(10, 10, 90, 90, 48.5, 51.5, 1);
      const scene = buildScene(segments, { textContent: [textItem("OPEN OFFICE 100", 50, 50, 16, 4)] });
      const result = detectRooms(scene, detectorOptions(1));
      assert.equal(result.rooms.length, 1);
      assert.ok(result.rooms[0].area > 5_000, `expected a large room, received area ${result.rooms[0].area}`);
      assert.equal(result.rooms[0].hasDoorEvidence, true);
    });

    test("scale and translation preserve normalized room geometry", () => {
      const segments = rectangleWithBottomGap(20, 20, 80, 80, 48.5, 51.5, 1);
      const baseScene = buildScene(segments);
      const baseResult = detectRooms(baseScene, detectorOptions(1));

      const transformed = transformFixture(segments, DEFAULT_PAGE, undefined, 3.25, -123, 88);
      const transformedScene = buildScene(transformed.segments, { page: transformed.page });
      const transformedResult = detectRooms(transformedScene, detectorOptions(3.25));

      assert.equal(baseResult.rooms.length, 1);
      assert.equal(transformedResult.rooms.length, baseResult.rooms.length);
      assert.equal(baseResult.rooms[0].hasDoorEvidence, true);
      assert.equal(transformedResult.rooms[0].hasDoorEvidence, true);
      assertNormalizedGeometryNear(
        transformedResult.rooms[0],
        transformed.page,
        baseResult.rooms[0],
        DEFAULT_PAGE,
        2 / RASTER_SIZE,
        "scale/translation changed the detected room"
      );
    });

    test("a translated 90-degree rotation preserves normalized room geometry", () => {
      const page = [0, 0, 120, 80];
      const segments = rectangleWithBottomGap(15, 10, 90, 50, 40, 43, 1);
      const baseResult = detectRooms(buildScene(segments, { page }), detectorOptions(1));

      const rotated = rotateFixture90(segments, page, 250, 175);
      const rotatedResult = detectRooms(buildScene(rotated.segments, { page: rotated.page }), detectorOptions(1));

      assert.equal(baseResult.rooms.length, 1);
      assert.equal(rotatedResult.rooms.length, baseResult.rooms.length);
      assert.equal(baseResult.rooms[0].hasDoorEvidence, true);
      assert.equal(rotatedResult.rooms[0].hasDoorEvidence, baseResult.rooms[0].hasDoorEvidence);
      assertNormalizedGeometryNear(
        rotatedResult.rooms[0],
        rotated.page,
        baseResult.rooms[0],
        page,
        // A quarter turn swaps which non-square page dimension receives the raster
        // ceiling/padding error; allow four pixels of normalized contour drift.
        4 / RASTER_SIZE,
        "90-degree rotation changed the detected room",
        ([rotatedX, rotatedY]) => [rotatedY, 1 - rotatedX]
      );
    });

    let failureCount = 0;
    for (const { name, body } of tests) {
      try {
        await body();
        console.log(`ok - ${name}`);
      } catch (error) {
        failureCount += 1;
        console.error(`not ok - ${name}`);
        console.error(error?.stack ?? error);
      }
    }

    if (failureCount > 0) {
      throw new Error(`${failureCount}/${tests.length} room-detector regressions failed`);
    }
    console.log(`\n${tests.length} room-detector regressions passed`);
  } finally {
    await viteServer.close();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
