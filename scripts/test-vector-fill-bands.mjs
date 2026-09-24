import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildVectorFillBandIndex, vectorFillBandSegments, vectorSceneFillStore,
    vectorSceneGradientFillStore } = await import("../src/vectorFillBands.ts");

  /** A path's segments as (p0, p1, p2, quadratic) tuples, laid out like the scene stores. */
  const sceneWith = (paths) => {
    const scene = createEmptyVectorScene();
    const metaA = [], metaB = [], a = [], b = [];
    for (const segments of paths) {
      const start = a.length / 4;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [p0, p1, p2, quadratic] of segments) {
        a.push(p0[0], p0[1], p1[0], p1[1]);
        b.push(p2[0], p2[1], quadratic ? 1 : 0, 0);
        for (const point of quadratic ? [p0, p1, p2] : [p0, p2]) {
          minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
          minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
        }
      }
      metaA.push(start, segments.length, minX, minY);
      metaB.push(maxX, maxY, 0, 0);
    }
    scene.fillPathCount = paths.length;
    scene.fillSegmentCount = a.length / 4;
    scene.fillPathMetaA = Float32Array.from(metaA);
    scene.fillPathMetaB = Float32Array.from(metaB);
    scene.fillSegmentsA = Float32Array.from(a);
    scene.fillSegmentsB = Float32Array.from(b);
    return scene;
  };

  // A dashed circle: the shape that made this necessary, as many short quads.
  const dashedCircle = (dashes, radius = 100) => {
    const segments = [];
    for (let dash = 0; dash < dashes; dash++) {
      const start = (dash * 2 * Math.PI) / dashes, end = start + Math.PI / dashes;
      const corner = (angle, r) => [Math.cos(angle) * r, Math.sin(angle) * r];
      const quad = [corner(start, radius - 3), corner(end, radius - 3), corner(end, radius + 3), corner(start, radius + 3)];
      for (let i = 0; i < 4; i++) segments.push([quad[i], quad[i], quad[(i + 1) % 4], false]);
    }
    return segments;
  };

  const circle = dashedCircle(475); // 1900 segments, the size seen in the wild
  const scene = sceneWith([circle]);
  const index = buildVectorFillBandIndex(vectorSceneFillStore(scene));
  assert(index, "a path of this size is worth indexing");

  const extent = (segment) => {
    const y0 = scene.fillSegmentsA[segment * 4 + 1], y2 = scene.fillSegmentsB[segment * 4 + 1];
    if (scene.fillSegmentsB[segment * 4 + 2] < 1) return [Math.min(y0, y2), Math.max(y0, y2)];
    const y1 = scene.fillSegmentsA[segment * 4 + 3];
    return [Math.min(y0, y1, y2), Math.max(y0, y1, y2)];
  };

  // The property the shader depends on: for any row, the band holds every
  // segment that can cross that row's ray, and every segment near enough to
  // still change coverage. Anything else it holds only costs a little work.
  let worstBand = 0, totalBand = 0, samples = 0;
  for (let step = 0; step <= 400; step++) {
    const y = -105 + (step * 210) / 400;
    for (const radius of [0, 0.5, 2]) {
      const selected = new Set(vectorFillBandSegments(index, 0, y, radius));
      for (let segment = 0; segment < circle.length; segment++) {
        const [low, high] = extent(segment);
        const crossesRow = low <= y && high > y;
        const withinRadius = low <= y + radius && high >= y - radius;
        if (crossesRow || withinRadius) {
          assert(selected.has(segment),
            `row ${y.toFixed(2)} radius ${radius} must examine segment ${segment} (y ${low}..${high})`);
        }
      }
      worstBand = Math.max(worstBand, selected.size);
      totalBand += selected.size;
      samples++;
    }
  }
  assert(worstBand < circle.length / 8,
    `a row examines at most ${worstBand} of ${circle.length} segments, not a large fraction of them`);
  assert(index.segments.length <= circle.length * 4, "the index stays a small multiple of the geometry");

  // Curves are bounded by their control hull, so a band never loses one.
  const curved = [];
  for (let i = 0; i < 60; i++) {
    const t = (i / 60) * Math.PI * 2, u = ((i + 1) / 60) * Math.PI * 2;
    curved.push([[Math.cos(t) * 50, Math.sin(t) * 50], [Math.cos((t + u) / 2) * 90, Math.sin((t + u) / 2) * 90],
      [Math.cos(u) * 50, Math.sin(u) * 50], true]);
  }
  const curvedIndex = buildVectorFillBandIndex(vectorSceneFillStore(sceneWith([curved])));
  assert(curvedIndex, "a curved path of this size is indexed too");
  for (let step = 0; step <= 200; step++) {
    const y = -95 + (step * 190) / 200;
    const selected = new Set(vectorFillBandSegments(curvedIndex, 0, y, 0.5));
    curved.forEach(([p0, p1, p2], segment) => {
      const low = Math.min(p0[1], p1[1], p2[1]), high = Math.max(p0[1], p1[1], p2[1]);
      if (low <= y + 0.5 && high >= y - 0.5) assert(selected.has(segment), `curve ${segment} at row ${y}`);
    });
  }

  // Paths too small, too flat, or whose segments all span the full height keep
  // their linear scan: an index would cost more than the search it replaces.
  assert.equal(buildVectorFillBandIndex(vectorSceneFillStore(sceneWith([dashedCircle(4)]))), null, "small paths are not indexed");
  const spanning = Array.from({ length: 200 }, (_, i) => [[i, -100], [i, 0], [i, 100], false]);
  assert.equal(buildVectorFillBandIndex(vectorSceneFillStore(sceneWith([spanning]))), null,
    "a path whose every segment spans its height is left unindexed: its bands would each hold all of it");
  const flat = Array.from({ length: 200 }, (_, i) => [[i, 0], [i, 0], [i + 1, 0], false]);
  assert.equal(buildVectorFillBandIndex(vectorSceneFillStore(sceneWith([flat]))), null, "a path with no height is left unindexed");

  // Several paths share one table, each addressing its own bands.
  const mixed = buildVectorFillBandIndex(vectorSceneFillStore(sceneWith([dashedCircle(4), circle, dashedCircle(100)])));
  assert.equal(mixed.paths[1], 0, "the small path stays unindexed");
  assert(mixed.paths[5] > 0 && mixed.paths[9] > 0, "the larger paths are indexed");
  assert(mixed.paths[8] >= mixed.paths[4] + mixed.paths[5], "each path owns a distinct span of the band table");
  const mixedScene = sceneWith([dashedCircle(4), circle, dashedCircle(100)]);
  const owned = (path) => [mixedScene.fillPathMetaA[path * 4], mixedScene.fillPathMetaA[path * 4 + 1]];
  for (const path of [1, 2]) {
    const [start, count] = owned(path);
    for (let step = 0; step <= 80; step++) {
      const selected = vectorFillBandSegments(mixed, path, -105 + (step * 210) / 80, 0.5);
      for (const segment of selected) {
        assert(segment >= start && segment < start + count,
          `path ${path}'s bands hold only its own segments (saw ${segment}, range ${start}..${start + count})`);
      }
    }
  }

  // The shader reads the index out of the segment store's own texels, so model
  // its addressing exactly - path record, band record, packed entries - and
  // check the coverage it computes against a full scan of the path. Any
  // disagreement here is a pixel that would come out wrong on screen.
  const { packVectorFillBands } = await import("../src/vectorFillBands.ts");
  const packed = packVectorFillBands(index, scene.fillSegmentCount);
  const texel = (i) => packed.data.subarray((i - packed.pathBase) * 4, (i - packed.pathBase) * 4 + 4);
  const segmentAt = (i) => [
    scene.fillSegmentsA[i * 4], scene.fillSegmentsA[i * 4 + 1],
    scene.fillSegmentsB[i * 4], scene.fillSegmentsB[i * 4 + 1]
  ];
  const accumulate = (state, [x0, y0, x2, y2], px, py, count) => {
    const near = distanceToSegment(px, py, x0, y0, x2, y2);
    state.distance = Math.min(state.distance, near);
    if (!count) return;
    const up = y0 <= py && y2 > py, down = y0 > py && y2 <= py;
    if (!up && !down) return;
    const x = x0 + ((py - y0) * (x2 - x0)) / (y2 - y0);
    if (x > px) { state.crossings++; state.winding += up ? 1 : -1; }
  };
  const linear = (px, py) => {
    const state = { distance: Infinity, crossings: 0, winding: 0 };
    for (let i = 0; i < circle.length; i++) accumulate(state, segmentAt(i), px, py, true);
    return state;
  };
  const banded = (px, py, radius) => {
    const record = texel(packed.pathBase + 0);
    const [bandTexel, bandCount, originY, bandHeight] = record;
    const state = { distance: Infinity, crossings: 0, winding: 0 };
    if (bandCount <= 0) return linear(px, py);
    const bandOf = (y) => Math.max(0, Math.min(bandCount - 1, Math.floor((y - originY) / bandHeight)));
    const rowBand = bandOf(py);
    for (let band = bandOf(py - radius); band <= bandOf(py + radius); band++) {
      const range = texel(bandTexel + band);
      for (let i = 0; i < range[1]; i++) {
        const entry = range[0] + i;
        const segment = texel(packed.entryBase + (entry >> 2))[entry & 3];
        accumulate(state, segmentAt(segment), px, py, band === rowBand);
      }
    }
    return state;
  };
  let compared = 0;
  for (let step = 0; step <= 120; step++) {
    const py = -104 + (step * 208) / 120;
    for (let column = 0; column <= 40; column++) {
      const px = -104 + (column * 208) / 40;
      const radius = 0.7;
      const a = linear(px, py), b = banded(px, py, radius);
      assert.equal(b.winding, a.winding, `winding at ${px.toFixed(1)},${py.toFixed(1)}`);
      assert.equal(b.crossings, a.crossings, `crossings at ${px.toFixed(1)},${py.toFixed(1)}`);
      // Distance only has to agree where coverage has not yet saturated.
      if (a.distance <= radius / 2) {
        assert(Math.abs(b.distance - a.distance) < 1e-6,
          `distance at ${px.toFixed(1)},${py.toFixed(1)}: ${b.distance} != ${a.distance}`);
      }
      compared++;
    }
  }

  // The gradient-fill store has the same shape, so one builder serves both.
  const gradientScene = sceneWith([circle]);
  gradientScene.gradientFillPathCount = gradientScene.fillPathCount;
  gradientScene.gradientFillSegmentCount = gradientScene.fillSegmentCount;
  gradientScene.gradientFillPathMetaA = gradientScene.fillPathMetaA;
  gradientScene.gradientFillPathMetaB = gradientScene.fillPathMetaB;
  gradientScene.gradientFillSegmentsA = gradientScene.fillSegmentsA;
  gradientScene.gradientFillSegmentsB = gradientScene.fillSegmentsB;
  const gradientIndex = buildVectorFillBandIndex(vectorSceneGradientFillStore(gradientScene));
  assert.deepEqual([...gradientIndex.paths], [...index.paths], "the gradient store indexes identically");

  // Every backend packs the identical segment prefix and index. Capacity
  // pressure must retain the original linear geometry with a disabled lookup.
  const { vectorFillBandStore } = await import("../src/vectorFillBands.ts");
  const combined = vectorFillBandStore(scene.fillSegmentsA, scene.fillSegmentCount, index);
  assert.equal(combined.pathBase, scene.fillSegmentCount);
  assert.deepEqual(combined.data.subarray(0, scene.fillSegmentCount * 4), scene.fillSegmentsA);
  assert.deepEqual(combined.data.subarray(scene.fillSegmentCount * 4), packed.data);
  const limited = vectorFillBandStore(scene.fillSegmentsA, scene.fillSegmentCount, index, 44);
  assert.equal(limited.pathBase, -1, "no room for metadata selects the complete linear scan");
  assert.equal(limited.data, scene.fillSegmentsA, "linear fallback reuses its geometry");

  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  for (const [segments, expectedBase] of [[dashedCircle(4), -1], [circle, circle.length]]) {
    const solid = sceneWith([segments]);
    solid.fillPathMetaC = new Float32Array([0, 0, 0, 1]);
    solid.gradientFillPathCount = solid.fillPathCount;
    solid.gradientFillSegmentCount = solid.fillSegmentCount;
    for (const suffix of ["PathMetaA", "PathMetaB", "PathMetaC", "SegmentsA", "SegmentsB"]) {
      solid[`gradientFill${suffix}`] = solid[`fill${suffix}`];
    }
    solid.gradientFillPaintMeta = new Float32Array([0, -1, 0, 0]);
    const options = { vectorOverride: [0, 0, 0, 0], strokeCurveEnabled: true };
    const fill = new ThreeMaterialFillLayer(solid, options);
    const gradient = new ThreeMaterialGradientLayer(solid, options);
    for (const mesh of [fill.mesh, gradient.group.children[0]]) {
      const uniforms = mesh.material.uniforms;
      assert.equal(uniforms.uFillBandBase.value, expectedBase,
        "solid and gradient GL materials initialize the band binding, even without an index");
      assert.equal(uniforms.uFillBandEntries.value, expectedBase < 0 ? 0 : combined.entryBase);
      const geometryData = uniforms.uFillSegmentTexA.value.image.data;
      assert.deepEqual(geometryData.subarray(0, solid.fillSegmentCount * 4), solid.fillSegmentsA);
      if (expectedBase >= 0) assert.deepEqual(geometryData.subarray(expectedBase * 4, combined.data.length), packed.data);
    }
    fill.dispose(); gradient.dispose();
  }

  // The count pass must use the same Float32 band height as the write passes.
  // With double precision, these first eight edges were counted in one band
  // but written into two, leaving the final band's eight entries out of range.
  {
    const count = 24, segmentsA = new Float32Array(count * 4), segmentsB = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const low = i % 3 === 0 ? 0 : i % 3 === 1 ? 2 : 4;
      const high = i % 3 === 0 ? Math.fround(5 / 3) : low + .1;
      segmentsA.set([i, low, i, high], i * 4); segmentsB.set([i, high, 0, 0], i * 4);
    }
    const boundaryIndex = buildVectorFillBandIndex({ pathCount: 1, segmentCount: count,
      pathMetaA: Float32Array.of(0, count, 0, 0), pathMetaB: Float32Array.of(count, 5, 0, 0), segmentsA, segmentsB });
    assert.equal(boundaryIndex.segments.length, 32, "all entries at rounded band boundaries are allocated");
    for (let band = 0; band < boundaryIndex.bands.length; band += 2) {
      assert.ok(boundaryIndex.bands[band] + boundaryIndex.bands[band + 1] <= boundaryIndex.segments.length);
    }
    for (let i = 2; i < count; i += 3) {
      assert.ok(vectorFillBandSegments(boundaryIndex, 0, 4.05, 0).includes(i), "late-band edges survive packing");
    }
  }
  const impreciseOffsets = vectorFillBandStore(scene.fillSegmentsA, scene.fillSegmentCount,
    { ...index, segments: { length: 0x1000001 } }, 8192);
  assert.equal(impreciseOffsets.pathBase, -1, "scalar entry offsets beyond exact Float32 integers use the complete linear scan");
  assert.equal(impreciseOffsets.data, scene.fillSegmentsA);

  console.log(`Vector fill bands: ${circle.length} segments narrow to at most ${worstBand} per row ` +
    `(${(totalBand / samples).toFixed(1)} average), matching a full scan at ${compared} sample points`);

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
}
} finally { hooks.deregister(); }
