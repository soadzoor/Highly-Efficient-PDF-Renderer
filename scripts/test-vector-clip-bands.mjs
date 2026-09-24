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
let checkedRows = 0, checkedPoints = 0;
try {
  const { packVectorClips } = await import("../src/vectorClips.ts");
  const oval = ellipse(2945, 125, 70);
  const fixtures = [
    ["dense oval", oval],
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
