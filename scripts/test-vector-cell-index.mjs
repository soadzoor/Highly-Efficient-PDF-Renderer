import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const { evaluateGlsl, evaluateWgsl } = await import("./lib/scalarShaderEval.mjs");
  const { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL } = await import("../src/fillCoverageShaders.ts");
  const { VECTOR_CELL_COVERAGE_GLSL, VECTOR_CELL_COVERAGE_WGSL } = await import("../src/vectorCellShaders.ts");
  const { vectorPathCellStore, vectorIndexedPathStore, buildVectorPathCells } = await import("../src/vectorCellIndex.ts");
  const { buildVectorFillBandIndex } = await import("../src/vectorFillBands.ts");
  const { packVectorClips } = await import("../src/vectorClips.ts");
  const { CORE_FILL_VERTEX_SHADER_SOURCE } = await import("../src/webGlFloorplanRenderer.ts");
  const { GRADIENT_FILL_VERTEX_SHADER_SOURCE } = await import("../src/nativeGradientWebGlShaders.ts");

  // Hosts reuse the core fill shader without knowing about cells (Three's
  // materials, adapters): an integer uniform they never set reads zero, which
  // must mean that no path has cells.
  for (const [name, source, uniform] of [["core fill", CORE_FILL_VERTEX_SHADER_SOURCE, "uFillCellHeaders"],
    ["native gradient fill", GRADIENT_FILL_VERTEX_SHADER_SOURCE, "uCellHeaders"]]) {
    assert.match(source, new RegExp(`uniform int ${uniform};`), `${name}: declares ${uniform}`);
    assert.match(source, new RegExp(`${uniform} <= 0 \\? vec4\\(0\\.0\\)`), `${name}: zero disables cells`);
    assert.match(source, new RegExp(`${uniform} - 1 \\+ pathIndex`), `${name}: headers start one texel lower`);
  }

  let seed = 0x2545f491;
  const random = () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

  /** A path store from closed contours of [x, y] points; `curves` bends every other edge. */
  function store(contours, curves = false) {
    const a = [], b = [], metaA = [], metaB = [];
    for (const contour of contours) {
      const start = a.length / 4;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      contour.forEach(([x0, y0], index) => {
        const [x2, y2] = contour[(index + 1) % contour.length];
        const curve = curves && index % 2 === 0;
        // Bulge the control point off the chord, keeping it Float32.
        const cx = Math.fround((x0 + x2) / 2 + (y2 - y0) * 0.3), cy = Math.fround((y0 + y2) / 2 - (x2 - x0) * 0.3);
        a.push(x0, y0, curve ? cx : x0, curve ? cy : y0);
        b.push(x2, y2, curve ? 1 : 0, 0);
        for (const [x, y] of curve ? [[x0, y0], [cx, cy], [x2, y2]] : [[x0, y0], [x2, y2]]) {
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      });
      metaA.push(start, a.length / 4 - start, minX, minY);
      metaB.push(maxX, maxY, 0, 0);
    }
    return { pathCount: contours.length, segmentCount: a.length / 4, pathMetaA: Float32Array.from(metaA),
      pathMetaB: Float32Array.from(metaB), segmentsA: Float32Array.from(a), segmentsB: Float32Array.from(b) };
  }
  /** One path made of several closed contours. */
  function merged(contours, curves = false) {
    const flat = store(contours, curves);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let p = 0; p < contours.length; p++) {
      minX = Math.min(minX, flat.pathMetaA[p * 4 + 2]); minY = Math.min(minY, flat.pathMetaA[p * 4 + 3]);
      maxX = Math.max(maxX, flat.pathMetaB[p * 4]); maxY = Math.max(maxY, flat.pathMetaB[p * 4 + 1]);
    }
    return { ...flat, pathCount: 1, pathMetaA: Float32Array.of(0, flat.segmentCount, minX, minY),
      pathMetaB: Float32Array.of(maxX, maxY, 0, 0) };
  }
  const f32 = Math.fround;
  const ring = (count, radius, cx = 0, cy = 0, snap = v => f32(v)) => Array.from({ length: count }, (_, i) => {
    const t = i * Math.PI * 2 / count;
    return [snap(cx + radius * Math.cos(t)), snap(cy + radius * Math.sin(t))];
  });
  // Axis-aligned and 45-degree edges on a dyadic grid split at dyadic column
  // edges into dyadic points, so indexed coverage must match the scan exactly.
  const staircase = (steps, x0, y0, size) => {
    const points = [];
    for (let i = 0; i < steps; i++) points.push([x0 + i * size, y0 + (i % 2) * size], [x0 + (i + 1) * size, y0 + ((i + 1) % 2) * size]);
    points.push([x0 + steps * size, y0 + 3 * size], [x0, y0 + 3 * size]);
    return points;
  };
  // A dashed rule: hundreds of tiny closed dashes along a thin strip, the
  // pattern whose bands fall below a pixel when zoomed out.
  const dashes = (count) => Array.from({ length: count }, (_, i) => {
    const x = i * 3;
    return [[x, 0], [x + 1.5, 0], [x + 1.5, 0.75], [x, 0.75]];
  });
  const fetchFrom = data => index => ({ x: data[index * 4], y: data[index * 4 + 1], z: data[index * 4 + 2], w: data[index * 4 + 3] });

  function fillCase(name, pathStore, { tolerance, reference = "scan", boxes = 400, minFootprint = -6, maxFootprint = 6 }) {
    const indexed = vectorIndexedPathStore(pathStore, buildVectorFillBandIndex(pathStore), 4096);
    assert(indexed.cellBase >= 0, `${name}: the path is cell-indexed`);
    const fetchA = fetchFrom(indexed.dataA), fetchB = fetchFrom(indexed.dataB);
    const coverage = evaluateGlsl(FILL_COVERAGE_GLSL + VECTOR_CELL_COVERAGE_GLSL,
      { heprCellFetchA: fetchA, heprCellFetchB: fetchB });
    // The WGSL port reads the same store through textures of an odd width.
    const texture = data => ({ width: 97, fetch: fetchFrom(data) });
    const wgsl = evaluateWgsl(FILL_COVERAGE_WGSL + VECTOR_CELL_COVERAGE_WGSL, {
      textureDimensions: tex => ({ x: tex.width }),
      textureLoad: (tex, coord) => tex.fetch(coord.y * tex.width + coord.x)
    });
    const textureA = texture(indexed.dataA), textureB = texture(indexed.dataB);
    const A = pathStore.segmentsA, B = pathStore.segmentsB;
    let worst = 0, scanWorst = 0;
    for (let path = 0; path < pathStore.pathCount; path++) {
      const header = fetchA(indexed.cellBase + path);
      if (header.y <= 0) continue;
      const start = pathStore.pathMetaA[path * 4], count = pathStore.pathMetaA[path * 4 + 1];
      const minX = pathStore.pathMetaA[path * 4 + 2], minY = pathStore.pathMetaA[path * 4 + 3];
      const maxX = pathStore.pathMetaB[path * 4], maxY = pathStore.pathMetaB[path * 4 + 1];
      const scan = (box, strips = 1) => {
        let total = 0;
        for (let strip = 0; strip < strips; strip++) {
          const part = { x: box.x + strip / (box.z * strips), y: box.y, z: box.z * strips, w: box.w };
          for (let s = start; s < start + count; s++) {
            total += coverage.heprSegmentCoverage({ x: A[s * 4], y: A[s * 4 + 1] }, { x: A[s * 4 + 2], y: A[s * 4 + 3] },
              { x: B[s * 4], y: B[s * 4 + 1] }, B[s * 4 + 2] >= 0.5, part, 0, 1) / strips;
          }
        }
        return total;
      };
      for (let trial = 0; trial < boxes; trial++) {
        const footprint = 2 ** (minFootprint + random() * (maxFootprint - minFootprint));
        const fx = footprint * (0.5 + random()), fy = footprint * (0.5 + random());
        const px = minX - fx + random() * (maxX - minX + 2 * fx), py = minY - fy + random() * (maxY - minY + 2 * fy);
        const box = { x: px - 0.5 * fx, y: py - 0.5 * fy, z: 1 / fx, w: 1 / fy };
        const cells = coverage.heprCellWinding(header, { x: minX, y: minY }, box, { x: fx, y: fy });
        const wgslCells = wgsl.heprCellWinding(header, { x: minX, y: minY }, box, { x: fx, y: fy }, textureA, textureB);
        assert(Math.abs(wgslCells - cells) <= 1e-12, `${name}: WGSL matches GLSL (${wgslCells} vs ${cells})`);
        const plain = scan(box);
        const truth = reference === "fine" ? scan(box, 128) : plain;
        worst = Math.max(worst, Math.abs(cells - truth));
        scanWorst = Math.max(scanWorst, Math.abs(plain - truth));
      }
    }
    assert(worst <= tolerance + scanWorst, `${name}: indexed coverage within ${tolerance} (worst ${worst}, scan ${scanWorst})`);
    return indexed;
  }

  // Exact geometry: every split lands on a representable point.
  fillCase("dyadic staircase", store([staircase(40, 0, 0, 0.25), staircase(64, -8, 2, 0.5)]), { tolerance: 1e-9 });
  // General lines: split points round to Float32, which the scan's own Float32
  // arithmetic on the GPU would exceed at these coordinates.
  fillCase("rings with a hole", merged([ring(200, 40, 3, 5), ring(150, 20, 5, 3).reverse()]), { tolerance: 2e-3 });
  fillCase("far from the origin", store([ring(300, 60, 4096, -2048)]), { tolerance: 5e-3, minFootprint: -2 });
  // Curves: the coverage function flattens pieces that cross a box side, so
  // compare both against a finely subdivided box.
  const curved = fillCase("quadratic rings", store([ring(64, 30), ring(48, 12, 60, 10)], true), { tolerance: 2e-3, reference: "fine", boxes: 150 });
  // Pieces: endpoints in A, a curve's control point and flag in B. A cell with
  // a curve negates its piece count; the others read one texel per line.
  {
    const texel = (data, index) => [...data.subarray(index * 4, index * 4 + 4)];
    const cellCounts = (indexed, pathCount) => {
      const counts = [];
      for (let path = 0; path < pathCount; path++) {
        const header = texel(indexed.dataA, indexed.cellBase + path);
        for (let level = 0; level < header[1]; level++) {
          const grid = texel(indexed.dataA, header[0] + level);
          for (let cell = 0; cell < grid[1] * grid[2]; cell++) counts.push(texel(indexed.dataA, grid[0] + cell));
        }
      }
      return counts;
    };
    const curveCells = cellCounts(curved, 2);
    assert(curveCells.some(cell => cell[1] < 0) && curveCells.some(cell => cell[1] > 0), "curve rings mix curve and line cells");
    for (const cell of curveCells) {
      const flags = Array.from({ length: Math.abs(cell[1]) }, (_, piece) => curved.dataB[(cell[0] + piece) * 4 + 2]);
      assert.equal(cell[1] < 0, flags.some(flag => flag >= 0.5), "negated exactly when the cell holds a curve");
    }
    const lines = vectorIndexedPathStore(store([ring(200, 40)]), null, 4096);
    assert(cellCounts(lines, 1).every(cell => cell[1] >= 0), "a path of lines keeps every count positive");
    const [first] = cellCounts(lines, 1).filter(cell => cell[1] > 0);
    const endpoints = texel(lines.dataA, first[0]);
    assert(endpoints[0] !== endpoints[2] || endpoints[1] !== endpoints[3], "a line piece holds both endpoints in A");
  }

  // The dashed rule: bounded work however far the view zooms out.
  const rule = merged(dashes(400));
  const ruleIndex = fillCase("dashed rule", rule, { tolerance: 1e-9, minFootprint: -3, maxFootprint: 5 });
  {
    const header = fetchFrom(ruleIndex.dataA)(ruleIndex.cellBase);
    const fetchA = fetchFrom(ruleIndex.dataA);
    let worstVisits = 0;
    for (const footprint of [0.25, 1, 4, 16, 64]) {
      // As heprCellWinding: the finest level whose cells span half the footprint.
      const step = header.w, reach = footprint / 2;
      let level = Math.min(Math.max(Math.ceil(Math.log2(Math.max(reach / header.z, 1)) / step), 0), header.y - 1);
      if (header.z * 2 ** (level * step) < reach && level < header.y - 1) level++;
      const size = header.z * 2 ** (level * step), grid = fetchA(header.x + level);
      for (let x = -footprint; x < 1200; x += footprint * 0.37) {
        let visits = 0;
        const c0 = Math.min(Math.max(Math.floor(x / size), 0), grid.y - 1), c1 = Math.min(Math.max(Math.floor((x + footprint) / size), 0), grid.y - 1);
        for (let column = c0; column <= c1; column++) { const cell = fetchA(grid.x + column); visits += Math.abs(cell.y) + cell.w; }
        worstVisits = Math.max(worstVisits, visits);
      }
    }
    assert(worstVisits < 400, `a pixel of the 1,600-segment rule visits ${worstVisits} pieces, not every segment`);
    assert(worstVisits * 4 < rule.segmentCount, "cells bound a pixel's work to a small share of the path");
  }

  // Store layout: bands first, then cells; budgets fall back without losing either.
  {
    const paths = store([ring(200, 40), ring(10, 5, 100), ring(120, 30, 200)]);
    const bands = buildVectorFillBandIndex(paths);
    const full = vectorIndexedPathStore(paths, bands, 4096);
    assert(full.bandBase >= paths.segmentCount && full.cellBase > full.bandBase, "segments, bands, then cells");
    assert.equal(full.dataB.length % 4, 0);
    assert.deepEqual([...full.dataA.subarray(0, paths.segmentCount * 4)], [...paths.segmentsA], "segments stay in place");
    const header = index => [...full.dataA.subarray((full.cellBase + index) * 4, (full.cellBase + index) * 4 + 4)];
    assert(header(0)[1] > 0 && header(2)[1] > 0, "large paths are indexed");
    assert.equal(header(1)[1], 0, "a path of ten segments keeps its scan");
    const tight = vectorPathCellStore(paths, 4096, { budget: 700 }); // The larger path needs 639 texels, the other 161.
    const headers = Array.from({ length: 3 }, (_, index) => tight.dataA[(tight.headerBase - paths.segmentCount + index) * 4 + 1]);
    assert(headers[0] > 0 && headers[2] === 0, "a tight budget indexes the path with the most segments first");
    assert.equal(vectorPathCellStore(paths, 4096, { budget: 10 }).headerBase, -1, "no room: no cell index");
    const cramped = vectorIndexedPathStore(paths, bands, 24);
    assert.equal(cramped.cellBase, -1, "a texture too small for cells keeps the bands");
    assert(buildVectorPathCells(paths.segmentsA, paths.segmentsB, 0, 23, [0, 0, 1, 1]) === null, "tiny paths are not indexed");
  }

  // Clip polygons: a mirror of the GLSL cell branch against brute force.
  function clipWinding(data, header, point, radius) {
    const texel = index => [data[index * 4], data[index * 4 + 1], data[index * 4 + 2], data[index * 4 + 3]];
    const cells = texel(header[1]), origin = texel(header[1] + 1);
    let level = 0;
    if (radius > 0) {
      level = Math.min(Math.max(Math.ceil(Math.log2(Math.max(2 * radius / cells[2], 1)) / cells[3]), 0), cells[1] - 1);
      if (cells[2] * 2 ** (level * cells[3]) < 2 * radius && level < cells[1] - 1) level++;
    }
    const size = cells[2] * 2 ** (level * cells[3]), grid = texel(cells[0] + level);
    const clampCell = (v, last) => Math.min(Math.max(Math.floor(v), 0), last);
    const home = [clampCell((point[0] - origin[0]) / size, grid[1] - 1), clampCell((point[1] - origin[1]) / size, grid[2] - 1)];
    const cell = texel(grid[0] + home[1] * grid[1] + home[0]);
    let winding = 0;
    for (let piece = 0; piece < cell[1]; piece++) {
      const line = texel(cell[0] + piece);
      if ((line[1] > point[1]) !== (line[3] > point[1])) {
        const x = line[0] + (point[1] - line[1]) / (line[3] - line[1]) * (line[2] - line[0]);
        if (x > point[0]) winding += line[3] > line[1] ? 1 : -1;
      }
    }
    for (let closure = 0; closure < cell[3]; closure++) {
      const pair = texel(cell[2] + closure);
      if (pair[0] <= point[1]) winding -= pair[1];
      if (pair[2] <= point[1]) winding -= pair[3];
    }
    let near = Infinity;
    if (radius > 0) {
      const lo = [clampCell((point[0] - radius - origin[0]) / size, grid[1] - 1), clampCell((point[1] - radius - origin[1]) / size, grid[2] - 1)];
      const hi = [clampCell((point[0] + radius - origin[0]) / size, grid[1] - 1), clampCell((point[1] + radius - origin[1]) / size, grid[2] - 1)];
      for (let row = lo[1]; row <= hi[1]; row++) for (let column = lo[0]; column <= hi[0]; column++) {
        const probe = texel(grid[0] + row * grid[1] + column);
        for (let piece = 0; piece < probe[1]; piece++) near = Math.min(near, segmentDistance(point, texel(probe[0] + piece)));
      }
    }
    return { winding, near };
  }
  // A mirror of heprClipPolygonSamples: the 4x4 antialiasing samples' inside
  // bits (4 * row + column) from the cells spanning the samples, or from bands.
  const SAMPLE_OFFSETS = [-0.375, -0.125, 0.125, 0.375];
  function sampleMask(data, node, point, aaWidth) {
    const texel = index => [data[index * 4], data[index * 4 + 1], data[index * 4 + 2], data[index * 4 + 3]];
    const clampCell = (v, last) => Math.min(Math.max(Math.floor(v), 0), last);
    const span = 0.75 * aaWidth;
    const xs = SAMPLE_OFFSETS.map(offset => point[0] + offset * aaWidth);
    const ys = SAMPLE_OFFSETS.map(offset => point[1] + offset * aaWidth);
    const winding = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    const crossings = (line, rows, columns) => {
      for (let row = 0; row < 4; row++) {
        if (!rows[row] || (line[1] > ys[row]) === (line[3] > ys[row])) continue;
        const x = line[0] + (ys[row] - line[1]) / (line[3] - line[1]) * (line[2] - line[0]);
        for (let column = 0; column < 4; column++) if (columns[column] && x > xs[column]) winding[row][column] += line[3] > line[1] ? 1 : -1;
      }
    };
    if (node[3] & 4) {
      const cells = texel(node[1]), origin = texel(node[1] + 1);
      let level = Math.min(Math.max(Math.ceil(Math.log2(Math.max(span / cells[2], 1)) / cells[3]), 0), cells[1] - 1);
      if (cells[2] * 2 ** (level * cells[3]) < span && level < cells[1] - 1) level++;
      const size = cells[2] * 2 ** (level * cells[3]), grid = texel(cells[0] + level);
      const columnOf = xs.map(x => clampCell((x - origin[0]) / size, grid[1] - 1));
      const rowOf = ys.map(y => clampCell((y - origin[1]) / size, grid[2] - 1));
      for (let row = rowOf[0]; row <= rowOf[3]; row++) for (let column = columnOf[0]; column <= columnOf[3]; column++) {
        const rows = rowOf.map(r => r === row), columns = columnOf.map(c => c === column);
        const cell = texel(grid[0] + row * grid[1] + column);
        for (let piece = 0; piece < cell[1]; piece++) crossings(texel(cell[0] + piece), rows, columns);
        for (let closure = 0; closure < cell[3]; closure++) {
          const pair = texel(cell[2] + closure);
          for (let k = 0; k < 4; k++) {
            if (!rows[k]) continue;
            const below = (pair[0] <= ys[k] ? pair[1] : 0) + (pair[2] <= ys[k] ? pair[3] : 0);
            for (let j = 0; j < 4; j++) if (columns[j]) winding[k][j] -= below;
          }
        }
      }
    } else {
      const bands = node[3] & 2 ? texel(node[1]) : null;
      const bandOf = ys.map(y => bands ? clampCell((y - bands[1]) / bands[2], bands[3] - 1) : 0);
      for (let band = bandOf[0]; band <= bandOf[3]; band++) {
        const [first, count] = bands ? texel(bands[0] + band) : [node[1], node[2]];
        for (let edge = 0; edge < count; edge++) crossings(texel(first + edge), bandOf.map(b => b === band), [true, true, true, true]);
      }
    }
    let mask = 0;
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
      const w = winding[row][column];
      if (node[3] & 1 ? Math.abs(w) % 2 === 1 : w !== 0) mask |= 1 << (4 * row + column);
    }
    return mask;
  }
  function segmentDistance([px, py], [x0, y0, x1, y1]) {
    const dx = x1 - x0, dy = y1 - y0, squared = dx * dx + dy * dy;
    const t = squared > 0 ? Math.min(Math.max(((px - x0) * dx + (py - y0) * dy) / squared, 0), 1) : 0;
    return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
  }
  const edgesOf = contours => Float32Array.from(contours.flatMap(points => points.flatMap(([x0, y0], index) => {
    const [x1, y1] = points[(index + 1) % points.length];
    return [x0, y0, x1, y1];
  })));
  const clipFixtures = [
    ["dense oval", edgesOf([ring(2048, 125, 0, 0, v => f32(v)).map(([x, y]) => [x, f32(y * 0.56)])])],
    ["oval with a hole", edgesOf([ring(1024, 90), ring(512, 35).reverse()])],
    ["self-intersecting", edgesOf([Array.from({ length: 1024 }, (_, i) => {
      const t = i * Math.PI * 2 / 1024;
      return [f32(90 * Math.sin(3 * t)), f32(60 * Math.sin(2 * t))];
    })])],
    ["far offsets", edgesOf([ring(1024, 128, 2 ** 20, -(2 ** 20))])],
    ["subdivided rectangle", edgesOf([[...Array.from({ length: 64 }, (_, i) => [f32(-100 + i * 200 / 64), -50]),
      ...Array.from({ length: 64 }, (_, i) => [100, f32(-50 + i * 100 / 64)]),
      ...Array.from({ length: 64 }, (_, i) => [f32(100 - i * 200 / 64), 50]),
      ...Array.from({ length: 64 }, (_, i) => [-100, f32(50 - i * 100 / 64)])]])]
  ];
  let clipPoints = 0, probes = 0, sampledPixels = 0, partialMasks = 0, coarsenedFixtures = 0;
  for (const [name, edges] of clipFixtures) {
    const clips = [{ parent: -1, fillRule: 0, edges }, { parent: -1, fillRule: 1, edges }];
    const packed = packVectorClips(clips, undefined, { cells: true });
    const plain = packVectorClips(clips);
    assert.equal(packed[3] & 4, 4, `${name}: nonzero polygon is cell-indexed`);
    assert.equal(packed[7], 5, `${name}: even-odd keeps its fill rule bit`);
    assert.equal(packed[1], packed[5], `${name}: both fill rules share the cell index`);
    assert.equal(plain[3] & 4, 0, `${name}: the default layout keeps bands for other consumers`);
    if (packed.length > plain.length) {
      let stats;
      const bandFallback = packVectorClips(clips, plain.length / 4,
        { cells: true, onStats: value => { stats = value; } });
      assert.deepEqual(bandFallback, plain, `${name}: keep the band fallback when it fits but the full cell index does not`);
      assert.equal(stats.coarsenedCellNodes, 0);
    }
    const header = [...packed.subarray(0, 4)];
    const layouts = [["cells", packed], ["bands", plain]];
    const texel = index => [...packed.subarray(index * 4, index * 4 + 4)];
    const cells = texel(header[1]);
    if (cells[1] > 1) {
      // Leave exactly enough room for the coarsest complete grid and both
      // node headers. The old all-or-nothing cell allocation lost its index.
      const grid = texel(cells[0] + cells[1] - 1), cellCount = grid[1] * grid[2];
      let capacity = 2 + 3 + cellCount;
      for (let cell = 0; cell < cellCount; cell++) {
        const record = texel(grid[0] + cell);
        capacity += record[1] + record[3];
      }
      let stats;
      const coarsened = packVectorClips(clips, capacity, { cells: true, onStats: value => { stats = value; } });
      assert.equal(coarsened.length / 4, capacity, `${name}: coarsened index obeys the exact budget`);
      assert.equal(coarsened[3], 4); assert.equal(coarsened[7], 5);
      assert.equal(coarsened[1], coarsened[5]);
      const info = [...coarsened.subarray(coarsened[1] * 4, coarsened[1] * 4 + 4)];
      assert.equal(info[1], 1, `${name}: retain the coarsest level`);
      assert.equal(info[2], cells[2] * 2 ** ((cells[1] - 1) * cells[3]), `${name}: update cell size when removing levels`);
      assert.equal(stats.coarsenedCellNodes, 2); assert.equal(stats.cellIndexedNodes, 2);
      assert.equal(stats.uniquePayloads, 1); assert.equal(stats.sharedPayloads, 1);
      layouts.push(["coarsened cells", coarsened]);
      coarsenedFixtures++;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < edges.length; i += 4) {
      minX = Math.min(minX, edges[i], edges[i + 2]); minY = Math.min(minY, edges[i + 1], edges[i + 3]);
      maxX = Math.max(maxX, edges[i], edges[i + 2]); maxY = Math.max(maxY, edges[i + 1], edges[i + 3]);
    }
    const spanX = maxX - minX, spanY = maxY - minY;
    for (let trial = 0; trial < 1500; trial++) {
      const point = [minX - 0.1 * spanX + random() * 1.2 * spanX, minY - 0.1 * spanY + random() * 1.2 * spanY];
      let truth = 0, nearest = Infinity;
      for (let i = 0; i < edges.length; i += 4) {
        const line = [edges[i], edges[i + 1], edges[i + 2], edges[i + 3]];
        nearest = Math.min(nearest, segmentDistance(point, line));
        if ((line[1] > point[1]) !== (line[3] > point[1])) {
          const x = line[0] + (point[1] - line[1]) / (line[3] - line[1]) * (line[2] - line[0]);
          if (x > point[0]) truth += line[3] > line[1] ? 1 : -1;
        }
      }
      // Float32 split points may move an edge by an ulp; keep clear of edges.
      if (nearest < Math.max(spanX, spanY, Math.abs(minX), Math.abs(minY)) * 2 ** -16) continue;
      assert.equal(clipWinding(packed, header, point, 0).winding, truth, `${name}: point winding at ${point}`);
      const radius = 2 ** (random() * 10 - 6) * Math.max(spanX, spanY) / 64;
      const probe = clipWinding(packed, header, point, radius);
      assert.equal(probe.winding, truth, `${name}: probe-level winding at ${point}`);
      assert.equal(probe.near < radius, nearest < radius, `${name}: the probe finds every edge within reach`);
      if (nearest < radius) assert(Math.abs(probe.near - nearest) < 1e-3 * Math.max(1, radius), `${name}: nearest edge distance`);
      for (const [layout, data] of layouts.filter(([layout]) => layout === "coarsened cells")) {
        const limitedHeader = [...data.subarray(0, 4)], limitedProbe = clipWinding(data, limitedHeader, point, radius);
        assert.equal(clipWinding(data, limitedHeader, point, 0).winding, truth, `${name}: ${layout} point winding`);
        assert.equal(limitedProbe.winding, truth, `${name}: ${layout} probe-level winding`);
        assert.equal(limitedProbe.near < radius, nearest < radius, `${name}: ${layout} boundary probe`);
      }
      clipPoints++; probes++;
    }
    // Boundary pixels: every sample's inside bit, for both layouts and rules.
    for (let trial = 0; trial < 300; trial++) {
      const edge = Math.floor(random() * (edges.length / 4)) * 4, t = random();
      const aaWidth = 2 ** (random() * 10 - 6) * Math.max(spanX, spanY) / 48;
      const point = [edges[edge] + t * (edges[edge + 2] - edges[edge]) + (random() * 2 - 1) * aaWidth,
        edges[edge + 1] + t * (edges[edge + 3] - edges[edge + 1]) + (random() * 2 - 1) * aaWidth];
      const tolerance = Math.max(spanX, spanY, Math.abs(minX), Math.abs(minY)) * 2 ** -16;
      let known = 0, evenOdd = 0, nonzero = 0;
      SAMPLE_OFFSETS.forEach((dy, row) => SAMPLE_OFFSETS.forEach((dx, column) => {
        const x = point[0] + dx * aaWidth, y = point[1] + dy * aaWidth;
        let w = 0, nearest = Infinity;
        for (let i = 0; i < edges.length; i += 4) {
          const line = [edges[i], edges[i + 1], edges[i + 2], edges[i + 3]];
          nearest = Math.min(nearest, segmentDistance([x, y], line));
          if ((line[1] > y) !== (line[3] > y) && line[0] + (y - line[1]) / (line[3] - line[1]) * (line[2] - line[0]) > x) w += line[3] > line[1] ? 1 : -1;
        }
        const bit = 1 << (4 * row + column);
        if (nearest < tolerance) return;
        known |= bit;
        if (w !== 0) nonzero |= bit;
        if (Math.abs(w) % 2 === 1) evenOdd |= bit;
      }));
      for (const [layout, data] of layouts) {
        for (const [rule, truth] of [[0, nonzero], [1, evenOdd]]) {
          const mask = sampleMask(data, [...data.subarray(rule * 4, rule * 4 + 4)], point, aaWidth);
          assert.equal(mask & known, truth, `${name}: ${layout} rule ${rule} samples at ${point}, width ${aaWidth}`);
          if (truth !== 0 && truth !== (known & 0xffff)) partialMasks++;
        }
      }
      sampledPixels++;
    }
  }
  assert(partialMasks > 1000, `boundary pixels mix inside and outside samples (${partialMasks})`);
  assert(coarsenedFixtures >= 3, "several polygon types exercise coarser indexes under budget pressure");
  assert(clipPoints > 5000 && probes > 5000, "clip fixtures exercise thousands of points");
  console.log(`Vector cell index: exact dyadic coverage, bounded work, float32 and curve tolerances, store budgets, ${clipPoints} clip winding/probe points and ${sampledPixels} sampled boundary pixels passed`);
} finally { hooks.deregister(); }
