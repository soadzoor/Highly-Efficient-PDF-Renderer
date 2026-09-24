import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

const f32 = Math.fround;
const scratch = new DataView(new ArrayBuffer(4));
let checkedRows = 0, checkedPoints = 0, checkedDistances = 0, checkedCoverage = 0;
try {
  const { packVectorClips } = await import("../src/vectorClips.ts");
  const oval = ellipse(2945, 125, 70);
  const fixtures = [
    ["dense oval", oval],
    ["subdivided rectangle with horizontal boundaries", subdividedRectangle(-125, -70, 125, 70)],
    ["rotated and sheared oval", ellipse(1536, 90, 30, ([x, y]) => [0.7 * x - 0.9 * y - 60, 0.6 * x + 1.1 * y + 25])],
    ["same-winding hole", join(ellipse(768, 90, 60), ellipse(512, 35, 25))],
    ["opposite-winding hole", join(ellipse(768, 90, 60), ellipse(512, 35, 25, p => p, true))],
    ["self-intersecting path", polygon(Array.from({ length: 1024 }, (_, i) => {
      const t = i * Math.PI * 2 / 1024;
      return [90 * Math.sin(3 * t), 60 * Math.sin(2 * t)];
    }))],
    ["large mixed-sign offsets", ellipse(1024, 256, 128, ([x, y]) => [x + 2 ** 22, y - 2 ** 22])],
    ["negative offsets", ellipse(1024, 70, 40, ([x, y]) => [x - 8000, y - 12000])],
    ["small normal coordinates", ellipse(1024, 1e-28, 5e-29)]
  ];
  let ovalStats;
  for (const [name, edges] of fixtures) {
    const bounds = edgeBounds(edges), [minX, minY, maxX, maxY] = bounds;
    const padX = maxX - minX, padY = maxY - minY;
    const clips = [
      { parent: -1, fillRule: 0, edges: rectangle(minX - padX, minY - padY, maxX + padX, maxY + padY) },
      { parent: 0, fillRule: 0, edges },
      { parent: 0, fillRule: 1, edges },
      { parent: 1, fillRule: 0, edges: rectangle(minX, minY, f32((minX + maxX) / 2), maxY) },
      { parent: 3, fillRule: 0, edges: rectangle(minX, f32((minY + maxY) / 2), maxX, maxY) }
    ];
    const snapshot = structuredClone(clips), packed = packVectorClips(clips);
    assert.deepEqual(clips, snapshot, `${name}: packing preserves retained geometry`);
    assert.equal(packed[1 * 4 + 3], 2, `${name}: nonzero clip is indexed`);
    assert.equal(packed[2 * 4 + 3], 3, `${name}: even-odd clip is indexed`);
    assert.equal(packed[1 * 4 + 2], edges.length / 4, "headers retain the original edge count");
    const stats = verifyBands(name, edges, packed, 1);
    const evenOddStats = bandStats(packed, 2);
    assert.deepEqual(evenOddStats, stats, "fill rule does not alter candidate selection");
    if (name === "dense oval") ovalStats = stats;
    verifyDistanceCandidates(name, edges, packed, 1, padY);

    const ys = boundaryRows(edges, packed, 1);
    const stride = Math.max(1, Math.ceil(ys.length / 80));
    for (let i = 0; i < ys.length; i += stride) {
      const y = ys[i];
      const edge = (i % (edges.length / 4)) * 4;
      const xs = [f32(minX - padX), minX, f32((minX + maxX) / 2), maxX, f32(maxX + padX),
        nextFloat(edges[edge], -1), edges[edge], nextFloat(edges[edge], 1)];
      for (const x of xs) for (const root of [1, 2, 3, 4]) {
        assert.equal(packedContains(packed, root, x, y), originalContains(clips, root, x, y),
          `${name}: Float32 winding for root ${root} at (${x}, ${y})`);
        checkedPoints++;
      }
    }
    // Coordinates far outside tiny shapes can overflow row division to infinity.
    // Clamping the floating row before converting to an integer must stay safe.
    for (const y of [-3e38, 3e38]) {
      assert.equal(packedContains(packed, 1, 0, f32(y)), originalContains(clips, 1, 0, f32(y)),
        `${name}: out-of-range row clamps safely`);
    }
  }
  assert(ovalStats.average < 2945 / 32, `dense oval reduces average candidates to ${ovalStats.average}`);
  assert(ovalStats.maximum < 2945 / 8, `dense oval limits the busiest band to ${ovalStats.maximum} edges`);
  assert(ovalStats.entries <= 2945 * 4, "index storage remains a bounded multiple of edge storage");

  const fallbackFixtures = [
    ["small polygon", ellipse(16, 30, 20)],
    ["full-height edges", polygon(Array.from({ length: 256 }, (_, i) => [i, i % 2 ? 100 : -100]))],
    ["flat polygon", polygon(Array.from({ length: 128 }, (_, i) => [i, 4]))],
    ["subnormal band height", ellipse(256, 1e-40, 1e-41)],
    ["overflowing Float32 vertical span", ellipse(256, 10, 3e38)]
  ];
  for (const [name, edges] of fallbackFixtures) {
    const packed = packVectorClips([{ parent: -1, fillRule: 1, edges }]);
    assert.equal(packed[3], 1, `${name}: retain the complete linear scan`);
    assert.deepEqual(packed.subarray(packed[1] * 4), edges, `${name}: original edges remain intact`);
    if (name === "small polygon") verifyDistanceCandidates(name, edges, packed, 0, 40);
  }

  // Compare the accelerated boundary probe and indexed samples against an
  // independent 4x4 evaluation of the original complete clip geometry.
  for (const edges of [oval, subdividedRectangle(-125, -70, 125, 70)]) {
    for (const fillRule of [0, 1]) {
      const clips = [{ parent: -1, fillRule, edges }], packed = packVectorClips(clips);
      for (const width of [0.0625, 0.5, 4, 16]) for (const delta of [-1, -0.25, 0, 0.25, 1]) {
        for (const [x, y] of [[125 + delta * width, 0], [0, 70 + delta * width]]) {
          const { coverage } = verifyCoverage("axis edge", clips, packed, 0, x, y, width);
          assert.equal(coverage, Math.max(0, Math.min(1, 0.5 - delta)),
            `axis edge coverage at (${x}, ${y}), pixel width ${width}`);
        }
      }
      for (const [x, y] of [[0, 0], [1000, 1000]]) {
        assert.equal(verifyCoverage("far from boundary", clips, packed, 0, x, y, 1).samples, 0,
          "full interior/exterior coverage does not need subpixel winding tests");
      }
    }
  }

  const contour = ellipse(512, 30, 20);
  const compoundFixtures = [
    ["overlapping nonzero contours", 0, join(contour, ellipse(512, 30, 20, ([x, y]) => [x + 20, y])),
      [[30, 0], [-10, 0]], 1],
    ["redundant nested nonzero contour", 0, join(contour, ellipse(256, 10, 8)), [[10, 0], [0, 8]], 1],
    ["duplicate even-odd contours", 1, join(contour, contour), [[30, 0], [0, 20], [0, 0]], 0],
    ["opposite coincident contours", 0, join(contour, ellipse(512, 30, 20, p => p, true)),
      [[30, 0], [0, 20], [0, 0]], 0]
  ];
  for (const [name, fillRule, edges, points, expected] of compoundFixtures) {
    const clips = [{ parent: -1, fillRule, edges }], packed = packVectorClips(clips);
    for (const width of [0.0625, 0.5, 4]) for (const [x, y] of points) {
      assert.equal(verifyCoverage(name, clips, packed, 0, x, y, width).coverage, expected,
        `${name}: antialiasing preserves the compound path interior`);
    }
  }

  const nested = [
    { parent: -1, fillRule: 0, edges: rectangle(-20, -20, 0, 20) },
    { parent: 0, fillRule: 0, edges: rectangle(-20, -20, 20, 0) },
    { parent: 1, fillRule: 0, edges: rectangle(-20, -20, 20, 0) },
    { parent: 0, fillRule: 0, edges: ellipse(512, 10, 10) }
  ], nestedPacked = packVectorClips(nested);
  for (const width of [0.0625, 0.5, 4]) {
    for (const root of [1, 2]) {
      assert.equal(verifyCoverage("intersecting rectangle ancestors", nested, nestedPacked, root, 0, 0, width).coverage,
        0.25, "clip ancestors intersect each subpixel instead of multiplying or minimizing per-clip alpha");
    }
    assert.equal(verifyCoverage("polygon and rectangle ancestors", nested, nestedPacked, 3, 0, 10, width).coverage,
      0.25, "polygon and rectangle clips use the same subpixel positions");
  }

  const clip = { parent: -1, fillRule: 0, edges: oval };
  const rawTexels = 1 + oval.length / 4;
  const limited = packVectorClips([clip], rawTexels);
  assert.equal(limited.length / 4, rawTexels, "capacity fallback fits the original storage budget");
  assert.equal(limited[3], 0, "lack of space disables indexing");
  assert.deepEqual(limited.subarray(4), oval, "capacity fallback keeps every edge");
  assert.throws(() => packVectorClips([clip], rawTexels - 1), /storage|limit|capacity/i,
    "a budget unable to store even the original geometry is rejected");
  const ample = packVectorClips([clip]);
  const mixedBudget = ample.length / 4 + rawTexels;
  const mixed = packVectorClips([clip, { ...clip, fillRule: 1 }], mixedBudget);
  assert(mixed.length / 4 <= mixedBudget, "several clips obey the shared upload budget");
  assert(mixed[3] >= 2, "the first useful index fits");
  assert.equal(mixed[7], 1, "a later clip falls back when only its raw edge storage remains");
  for (const y of [-70, -25, 0, 20, 70]) for (const x of [-125, -30, 0, 50, 125]) {
    for (const root of [0, 1]) assert.equal(packedContains(mixed, root, x, y), windingContains(oval, root, x, y));
  }
  console.log(`Vector clip bands preserve crossings at ${checkedRows} boundary rows and Float32 winding at ${checkedPoints} points; ` +
    `${checkedDistances} pixel footprints preserve boundary distance and ${checkedCoverage} preserve coverage; ` +
    `dense oval averages ${ovalStats.average.toFixed(1)} of 2945 edges (${ovalStats.maximum} maximum)`);
} finally { hooks.deregister(); }

function polygon(points) {
  return new Float32Array(points.flatMap((point, i) => [...point, ...points[(i + 1) % points.length]]));
}
function ellipse(count, rx, ry, transform = p => p, reverse = false) {
  const points = Array.from({ length: count }, (_, i) => {
    const t = i * Math.PI * 2 / count;
    return transform([Math.cos(t) * rx, Math.sin(t) * ry]);
  });
  return polygon(reverse ? points.reverse() : points);
}
function rectangle(x0, y0, x1, y1) { return polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); }
function subdividedRectangle(x0, y0, x1, y1) {
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return polygon(corners.flatMap(([x, y], index) => {
    const [nextX, nextY] = corners[(index + 1) % corners.length];
    return Array.from({ length: 64 }, (_, i) => [x + (nextX - x) * i / 64, y + (nextY - y) * i / 64]);
  }));
}
function join(a, b) { return new Float32Array([...a, ...b]); }
function edgeBounds(edges) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < edges.length; i += 2) {
    bounds[0] = Math.min(bounds[0], edges[i]); bounds[1] = Math.min(bounds[1], edges[i + 1]);
    bounds[2] = Math.max(bounds[2], edges[i]); bounds[3] = Math.max(bounds[3], edges[i + 1]);
  }
  return bounds;
}
function nextFloat(value, direction) {
  value = f32(value);
  if (value === 0) return direction * 2 ** -149;
  scratch.setFloat32(0, value);
  const bits = scratch.getUint32(0) + (value > 0 ? direction : -direction);
  scratch.setUint32(0, bits);
  return scratch.getFloat32(0);
}
function bandRange(packed, root, y) {
  const offset = packed[root * 4 + 1] * 4;
  if (packed[root * 4 + 3] < 2) return [offset, packed[root * 4 + 2]];
  const row = Math.max(0, Math.min(packed[offset + 3] - 1,
    Math.floor(f32(f32(y - packed[offset + 1]) / packed[offset + 2]))));
  const table = (packed[offset] + row) * 4;
  return [packed[table] * 4, packed[table + 1]];
}
function boundaryDistance(edges, x, y) {
  let distance = Infinity;
  for (let i = 0; i < edges.length; i += 4) {
    const dx = edges[i + 2] - edges[i], dy = edges[i + 3] - edges[i + 1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1,
      ((x - edges[i]) * dx + (y - edges[i + 1]) * dy) / lengthSquared)) : 0;
    distance = Math.min(distance, Math.hypot(x - edges[i] - t * dx, y - edges[i + 1] - t * dy));
  }
  return distance;
}
function packedBoundaryDistance(packed, root, x, y, width) {
  const offset = packed[root * 4 + 1] * 4;
  if (packed[root * 4 + 2] < 0) {
    return boundaryDistance(rectangle(...packed.subarray(offset, offset + 4)), x, y);
  }
  if (packed[root * 4 + 3] < 2) {
    return boundaryDistance(packed.subarray(offset, offset + packed[root * 4 + 2] * 4), x, y);
  }
  const bandCount = packed[offset + 3], table = packed[offset] * 4;
  const row = value => Math.max(0, Math.min(bandCount - 1,
    Math.floor(f32(f32(value - packed[offset + 1]) / packed[offset + 2]))));
  let distance = Infinity;
  // The conservative probe radius encloses every 4x4 subpixel sample. Nearby
  // boundaries must be present even when the center row has no candidate edges.
  const first = row(f32(y - width * 0.75)), last = row(f32(y + width * 0.75));
  for (let band = first; band <= last; band++) {
    const start = packed[table + band * 4] * 4, end = start + packed[table + band * 4 + 1] * 4;
    distance = Math.min(distance, boundaryDistance(packed.subarray(start, end), x, y));
  }
  return distance;
}
function packedCoverage(packed, root, x, y, width) {
  let nearBoundary = false;
  for (let index = root; index >= 0; index = packed[index * 4]) {
    if (packedBoundaryDistance(packed, index, x, y, width) <= width * 0.75) {
      nearBoundary = true;
      break;
    }
  }
  if (!nearBoundary) return { coverage: Number(packedContains(packed, root, x, y)), samples: 0 };
  let covered = 0;
  for (const dx of [-0.375, -0.125, 0.125, 0.375]) for (const dy of [-0.375, -0.125, 0.125, 0.375]) {
    covered += Number(packedContains(packed, root, f32(x + dx * width), f32(y + dy * width)));
  }
  return { coverage: covered / 16, samples: 16 };
}
function verifyCoverage(name, clips, packed, root, x, y, width) {
  let expected = 0;
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const sx = f32(x + ((column + 0.5) / 4 - 0.5) * width);
    const sy = f32(y + ((row + 0.5) / 4 - 0.5) * width);
    if (originalContains(clips, root, sx, sy)) expected += 1 / 16;
  }
  const actual = packedCoverage(packed, root, x, y, width);
  assert.equal(actual.coverage, expected, `${name}: pixel width ${width} preserves sampled coverage at (${x}, ${y})`);
  checkedCoverage++;
  return actual;
}
function verifyDistanceCandidates(name, edges, packed, root, height) {
  const stride = Math.max(4, Math.ceil(edges.length / 128) * 4);
  for (let edge = 0; edge < edges.length; edge += stride) {
    const dx = edges[edge + 2] - edges[edge], dy = edges[edge + 3] - edges[edge + 1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    for (const width of [height / 2048, height / 128, height / 8]) {
      for (const shift of [-0.75, -0.25, 0, 0.25, 0.75]) {
        const x = f32((edges[edge] + edges[edge + 2]) / 2 + shift * width * dy / length);
        const y = f32((edges[edge + 1] + edges[edge + 3]) / 2 - shift * width * dx / length);
        const expected = Math.min(width * 0.75, boundaryDistance(edges, x, y));
        const actual = Math.min(width * 0.75, packedBoundaryDistance(packed, root, x, y, width));
        assert.equal(actual, expected, `${name}: pixel width ${width} preserves nearest edge at (${x}, ${y})`);
        checkedDistances++;
      }
    }
  }
}
function boundaryRows(edges, packed, root) {
  const ys = new Set();
  const add = y => { y = f32(y); for (const value of [nextFloat(y, -1), y, nextFloat(y, 1)]) ys.add(value); };
  for (let i = 1; i < edges.length; i += 2) add(edges[i]);
  const info = packed[root * 4 + 1] * 4;
  for (let band = 0; band <= packed[info + 3]; band++) {
    add(packed[info + 1] + band * packed[info + 2]);
    add(f32(packed[info + 1] + f32(band * packed[info + 2])));
  }
  return [...ys].sort((a, b) => a - b);
}
function bandStats(packed, root) {
  const info = packed[root * 4 + 1] * 4, bandCount = packed[info + 3], table = packed[info] * 4;
  let maximum = 0, entries = 0;
  for (let band = 0; band < bandCount; band++) {
    const count = packed[table + band * 4 + 1];
    maximum = Math.max(maximum, count); entries += count;
  }
  return { average: entries / bandCount, maximum, entries };
}
function verifyBands(name, edges, packed, root) {
  const info = packed[root * 4 + 1] * 4, table = packed[info] * 4, bandCount = packed[info + 3];
  assert(Number.isInteger(bandCount) && bandCount > 0);
  assert(Number.isFinite(packed[info + 2]) && packed[info + 2] > 0);
  const originals = new Map();
  for (let band = 0; band < bandCount; band++) {
    const offset = packed[table + band * 4] * 4, count = packed[table + band * 4 + 1];
    assert(Number.isInteger(offset) && Number.isInteger(count) && count >= 0);
    assert(offset >= 0 && offset + count * 4 <= packed.length, "candidate range stays inside the upload");
    const indices = [];
    let original = 0;
    for (let edge = 0; edge < count; edge++) {
      const candidate = offset + edge * 4;
      while (original < edges.length && !sameEdge(edges, original, packed, candidate)) original += 4;
      assert(original < edges.length, `${name}: candidates retain exact original coordinates and order`);
      indices.push(original); original += 4;
    }
    originals.set(`${offset}:${count}`, indices);
  }
  // Preserving the complete ordered set of edges crossing each row is stronger
  // than testing a few pixel centers: winding then agrees for every x on that row.
  for (const y of boundaryRows(edges, packed, root)) {
    const [offset, count] = bandRange(packed, root, y), selected = originals.get(`${offset}:${count}`);
    assert(selected, `${name}: Float32 row lookup addresses a valid band`);
    let candidate = 0;
    for (let edge = 0; edge < edges.length; edge += 4) {
      if ((edges[edge + 1] > y) === (edges[edge + 3] > y)) continue;
      while (candidate < selected.length && selected[candidate] < edge) candidate++;
      assert.equal(selected[candidate], edge, `${name}: row ${y} preserves crossing edge ${edge / 4}`);
    }
    checkedRows++;
  }
  return bandStats(packed, root);
}
function sameEdge(a, i, b, j) { return a[i] === b[j] && a[i + 1] === b[j + 1] && a[i + 2] === b[j + 2] && a[i + 3] === b[j + 3]; }
function windingContains(edges, fillRule, x, y) {
  let winding = 0;
  for (let i = 0; i < edges.length; i += 4) {
    const x0 = edges[i], y0 = edges[i + 1], x1 = edges[i + 2], y1 = edges[i + 3];
    if ((y0 > y) !== (y1 > y)) {
      const crossX = f32(x0 + f32(f32(f32(y - y0) / f32(y1 - y0)) * f32(x1 - x0)));
      if (crossX > x) winding += y1 > y0 ? 1 : -1;
    }
  }
  return fillRule ? Math.abs(winding) % 2 !== 0 : winding !== 0;
}
function originalContains(clips, root, x, y) {
  for (let index = root; index >= 0; index = clips[index].parent) {
    if (!windingContains(clips[index].edges, clips[index].fillRule, x, y)) return false;
  }
  return true;
}
function packedContains(packed, root, x, y) {
  for (let index = root; index >= 0; index = packed[index * 4]) {
    const header = index * 4;
    if (packed[header + 2] < 0) {
      const offset = packed[header + 1] * 4;
      if (x < packed[offset] || y < packed[offset + 1] || x >= packed[offset + 2] || y >= packed[offset + 3]) return false;
    } else {
      const [offset, count] = bandRange(packed, index, y);
      if (!windingContains(packed.subarray(offset, offset + count * 4), packed[header + 3] & 1, x, y)) return false;
    }
  }
  return true;
}
