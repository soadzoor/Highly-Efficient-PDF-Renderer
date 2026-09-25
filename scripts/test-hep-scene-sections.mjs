import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const {
    SCENE_CLIP_PATHS_PATH, SCENE_DRAW_RUNS_PATH, SCENE_PAINT_GRAPH_PATH,
    encodeSceneClipPaths, decodeSceneClipPaths,
    encodeSceneDrawRuns, decodeSceneDrawRuns,
    encodeScenePaintGraph, decodeScenePaintGraph
  } = await import("../src/hepSceneSections.ts");

  assert.equal(SCENE_CLIP_PATHS_PATH, "geometry/clip-paths.d512");
  assert.equal(SCENE_DRAW_RUNS_PATH, "geometry/draw-runs.varint");
  assert.equal(SCENE_PAINT_GRAPH_PATH, "geometry/paint-graph.varint");

  // ---------------------------------------------------------- clip paths
  {
    const clipPaths = [
      { parent: -1, fillRule: 0, edges: Float32Array.from([0, 0, 100, 0, 100, 0, 100, 50]) },
      { parent: 0, fillRule: 1, edges: Float32Array.from([-2048.5, 3.25, 4096.75, -1.5]) },
      { parent: 1, fillRule: 0, edges: new Float32Array(0) }
    ];
    const decoded = decodeSceneClipPaths(encodeSceneClipPaths(clipPaths));
    assert.equal(decoded.length, 3);
    decoded.forEach((clip, index) => {
      assert.equal(clip.parent, clipPaths[index].parent);
      assert.equal(clip.fillRule, clipPaths[index].fillRule);
      // Every coordinate above is a multiple of 1/512, so the grid is exact here.
      assert.deepEqual([...clip.edges], [...clipPaths[index].edges], `clip ${index}`);
    });

    // Coordinates off the grid land on the nearest 1/512 step and no further.
    const offGrid = [{ parent: -1, fillRule: 0, edges: Float32Array.from([0.001, 1 / 3, -0.7, 1234.56789]) }];
    const rounded = decodeSceneClipPaths(encodeSceneClipPaths(offGrid))[0].edges;
    rounded.forEach((value, index) => {
      assert(Math.abs(value - offGrid[0].edges[index]) <= 1 / 1024, `edge ${index} within half a step`);
      assert.equal(value * 512, Math.round(value * 512), `edge ${index} lands on the grid`);
    });

    const bytes = encodeSceneClipPaths(clipPaths);
    assert.throws(() => decodeSceneClipPaths(bytes.subarray(0, bytes.length - 1)), /clip path/);
    assert.throws(() => decodeSceneClipPaths(Uint8Array.from([1, 2, 0, 0, 0, 0, 0, 0])),
      /parent must reference an earlier path/);
  }

  // ----------------------------------------------------------- draw runs
  {
    const drawRuns = [
      { kind: "fill", first: 0, count: 3 },
      { kind: "text", first: 0, count: 12, clipIndex: 0 },
      { kind: "fill", first: 3, count: 1, clipIndex: 4, optionalContent: 7 },
      { kind: "raster", first: 0, count: 1, blendMode: "Multiply" },
      { kind: "stroke", first: 9, count: 2, clipIndex: 1, optionalContent: 0, blendMode: "Multiply" },
      { kind: "gradient-fill", first: 0, count: 1 },
      { kind: "gradient-stroke", first: 0, count: 1 }
    ];
    const encoded = encodeSceneDrawRuns(drawRuns);
    assert.deepEqual(decodeSceneDrawRuns(encoded), drawRuns, "draw runs round-trip exactly");
    assert.throws(() => decodeSceneDrawRuns(encoded.subarray(0, encoded.length - 1)), /draw run|length mismatch/);
    assert.throws(() => encodeSceneDrawRuns([{ kind: "bogus", first: 0, count: 1 }]), /unknown kind/);

    // Per-kind delta coding must stay compact for the common consecutive case.
    const consecutive = Array.from({ length: 1000 }, (_, index) => ({ kind: "text", first: index, count: 1 }));
    assert(encodeSceneDrawRuns(consecutive).length < 3100, "a consecutive run costs about two bytes");
    assert.deepEqual(decodeSceneDrawRuns(encodeSceneDrawRuns(consecutive)), consecutive);
  }

  // --------------------------------------------------------- paint graph
  {
    const graph = { roots: [
      { kind: "draw", runIndex: 0 },
      { kind: "draw", runIndex: 1, optionalContent: 3 },
      { kind: "retained", retainedPage: 0, firstCommand: 5, count: 9, rasterIndex: 2 },
      { kind: "group", alpha: 0.8000029921531677, isolated: true, knockout: false, blendMode: "Multiply",
        alphaIsShape: true, bounds: { minX: -1.5, minY: 0.1, maxX: 2.25, maxY: 1 / 3 },
        softMask: { subtype: "Luminosity", transfer: Float32Array.from([0, 0.25, 0.5, 1]),
          backdrop: [0.1, 0.2, 0.3], children: [{ kind: "draw", runIndex: 2 }] },
        children: [
          { kind: "draw", runIndex: 3 },
          { kind: "group", alpha: 1, isolated: false, knockout: true, blendMode: "Normal",
            children: [{ kind: "draw", runIndex: 4 }] }
        ] }
    ] };
    const encoded = encodeScenePaintGraph(graph);
    const decoded = decodeScenePaintGraph(encoded);
    // Float64 for the scene's plain numbers, so nothing is rounded.
    assert.deepEqual(decoded, graph, "the paint graph round-trips exactly");
    assert.equal(decoded.roots[3].alpha, 0.8000029921531677);
    assert.deepEqual([...decoded.roots[3].softMask.transfer], [0, 0.25, 0.5, 1]);
    assert(decoded.roots[3].softMask.transfer instanceof Float32Array, "transfer stays a Float32Array");
    assert.throws(() => decodeScenePaintGraph(encoded.subarray(0, encoded.length - 1)),
      /paint graph|length mismatch|ended early/);
    assert.throws(() => encodeScenePaintGraph({ roots: [{ kind: "group", alpha: 1, isolated: false,
      knockout: false, blendMode: "Nope", children: [] }] }), /unknown blend mode/);

    // A draw-heavy graph is the common shape; it must stay near one byte a node.
    const wide = { roots: Array.from({ length: 5000 }, (_, index) => ({ kind: "draw", runIndex: index })) };
    assert(encodeScenePaintGraph(wide).length < 11_000, "a draw leaf costs about two bytes");
    assert.deepEqual(decodeScenePaintGraph(encodeScenePaintGraph(wide)), wide);

    let deep = { kind: "draw", runIndex: 0 };
    for (let depth = 0; depth < 70; depth += 1) {
      deep = { kind: "group", alpha: 1, isolated: false, knockout: false, blendMode: "Normal", children: [deep] };
    }
    assert.throws(() => encodeScenePaintGraph({ roots: [deep] }), /nesting is too deep/);
  }

  const {
    SCENE_RASTER_LAYERS_PATH, encodeRasterLayerTable, decodeRasterLayerTable
  } = await import("../src/hepRasterLayers.ts");
  const {
    TEXT_GLYPH_SEGMENTS_PATH, TEXT_INSTANCE_POSITIONS_PATH,
    encodeTextGlyphSegments, decodeTextGlyphSegments,
    encodeTextInstancePositions, decodeTextInstancePositionsInto
  } = await import("../src/hepTextSections.ts");
  const { decodeRangeUint16, encodeRangeUint16 } = await import("../src/parsedDataVarint.ts");

  assert.equal(SCENE_RASTER_LAYERS_PATH, "geometry/raster-layers.varint");
  assert.equal(TEXT_GLYPH_SEGMENTS_PATH, "geometry/text-glyph-segments.cq16");
  assert.equal(TEXT_INSTANCE_POSITIONS_PATH, "geometry/text-instance-ef.pd512");

  // ------------------------------------------------------- raster layers
  {
    const limits = { maxLayers: 100, maxAtlases: 4, maxDimension: 4096 };
    const table = {
      atlases: [{ encoding: "png", width: 300, height: 2 }, { encoding: "rgba", width: 8, height: 8 }],
      layers: [
        { width: 200, height: 1, matrix: Float32Array.from([24, 0, 0, -0.12, 100.5, 400.25]), paintOrder: 7, pageIndex: 0,
          storage: "atlas", cell: { atlas: 0, x: 0, y: 0 } },
        { width: 100, height: 1, matrix: Float32Array.from([12, 0, 0, -0.12, 100.5, 400.37]), paintOrder: 8, pageIndex: 0,
          opacity: 0.3, storage: "atlas", cell: { atlas: 0, x: 200, y: 0 } },
        { width: 640, height: 480, matrix: Float32Array.from([320, 10, -5, 240, 0, -1e-7]), paintOrder: 2, pageIndex: 3,
          storage: "webp" },
        { width: 8, height: 8, matrix: Float32Array.from([1, 0, 0, 1, 0, 0]), paintOrder: 0, pageIndex: 3,
          storage: "atlas", cell: { atlas: 1, x: 0, y: 0 } },
        { width: 1, height: 1, matrix: Float32Array.from([1, 0, 0, 1, 2, 3]), paintOrder: 1, pageIndex: 3, storage: "rgba" }
      ]
    };
    const encoded = encodeRasterLayerTable(table);
    // Records, including float32 matrices, round-trip exactly.
    assert.deepEqual(decodeRasterLayerTable(encoded, limits), table);
    assert.throws(() => decodeRasterLayerTable(encoded.subarray(0, encoded.length - 4), limits),
      /matrix data does not fill the section/);
    assert.throws(() => decodeRasterLayerTable(encoded, { ...limits, maxLayers: 4 }), /layer count is out of range/);
    assert.throws(() => decodeRasterLayerTable(encoded, { ...limits, maxDimension: 256 }), /out of range/);
    assert.throws(() => encodeRasterLayerTable({ atlases: [], layers: [{ ...table.layers[4], paintOrder: -1 }] }),
      /paint order is out of range/);
    assert.throws(() => encodeRasterLayerTable({ atlases: [], layers: [{ ...table.layers[4], matrix: Float32Array.from([NaN, 0, 0, 1, 0, 0]) }] }),
      /non-finite matrix/);

    // Thousands of scanline records cost a few bytes each, not a JSON object each.
    const scanlines = {
      atlases: [{ encoding: "png", width: 2048, height: 2048 }],
      layers: Array.from({ length: 5000 }, (_, index) => ({
        width: 20 + index % 400, height: 1, paintOrder: 5000 + index, pageIndex: 0, storage: "atlas",
        cell: { atlas: 0, x: 0, y: index % 2048 },
        matrix: Float32Array.from([(20 + index % 400) * 0.12, 0, 0, -0.12, 535 - (index % 400) * 0.12, 427 + index * 0.12])
      }))
    };
    assert.ok(deflateSync(encodeRasterLayerTable(scanlines)).length < 5000 * 8,
      "a scanline record costs a few bytes, not a ~190-byte JSON object");
    assert.deepEqual(decodeRasterLayerTable(encodeRasterLayerTable(scanlines), { ...limits, maxLayers: 5000 }), scanlines);
  }

  // ------------------------------------------------------ glyph outlines
  {
    // A closed contour of a quadratic, two lines whose control points are not
    // their ends and a plain line, then a second contour that starts elsewhere.
    const segmentsA = Float32Array.from([
      612, 616, 1000, 616,
      1000, 973, 1000, 973,
      1000, 973.5, 800, 1100,
      700, 1251, 612, 616,
      -229, -452, -229, -452
    ]);
    const segmentsB = Float32Array.from([
      1000, 973, 1, 0,
      1000, 973.5, 0, 0,
      700, 1251, 0, 0,
      612, 616, 0, 0,
      2079, 1567, 1, 0
    ]);
    const { bytes, meta } = encodeTextGlyphSegments(segmentsA, segmentsB, 5);
    assert.deepEqual(meta, {
      file: TEXT_GLYPH_SEGMENTS_PATH, segmentCount: 5, quantizationMin: [-229, -452], quantizationMax: [2079, 1567]
    });
    const decoded = decodeTextGlyphSegments(bytes, meta);
    const grid = (value, axis) => decodeRangeUint16(
      encodeRangeUint16(value, meta.quantizationMin[axis], meta.quantizationMax[axis]),
      meta.quantizationMin[axis], meta.quantizationMax[axis]
    );
    for (let index = 0; index < 5; index += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        assert.equal(decoded.segmentsA[index * 4 + channel], Math.fround(grid(segmentsA[index * 4 + channel], channel & 1)),
          `segment ${index} A.${channel} lands on the shared uint16 grid`);
      }
      assert.equal(decoded.segmentsB[index * 4], Math.fround(grid(segmentsB[index * 4], 0)));
      assert.equal(decoded.segmentsB[index * 4 + 1], Math.fround(grid(segmentsB[index * 4 + 1], 1)));
      assert.equal(decoded.segmentsB[index * 4 + 2], segmentsB[index * 4 + 2]);
      assert.equal(decoded.segmentsB[index * 4 + 3], 0);
    }
    // Chained points repeat exactly, so the next segment starts where one ends.
    assert.equal(decoded.segmentsA[4], decoded.segmentsB[0]);
    assert.throws(() => decodeTextGlyphSegments(bytes, { ...meta, segmentCount: 4 }), /segment count/);
    assert.throws(() => decodeTextGlyphSegments(bytes.subarray(0, bytes.length - 1), meta), /column lengths/);
  }

  // ------------------------------------------------------- glyph origins
  {
    // Three lines of sparsely kerned text in two sizes, then a rotated run.
    // Steps are whole 1/512 units so every origin is exactly on the grid.
    const glyphs = [];
    const instanceA = [];
    const instanceB = [];
    const advanceUnits = [0, 3123, 1690, 2816, 1382];
    for (let line = 0; line < 3; line += 1) {
      const scale = line === 1 ? 0.0122 : 0.0098;
      let xUnits = 72 * 512;
      for (let index = 0; index < 400; index += 1) {
        const glyph = 1 + (index * 7 + line) % 4;
        glyphs.push(glyph);
        instanceA.push(scale, 0, 0, scale);
        instanceB.push(xUnits / 512, 700 - line * 14, glyph, 0);
        xUnits += advanceUnits[glyph] * (line === 1 ? 5 : 4) + (index % 5 === 0 ? 21 : 0);
      }
    }
    for (let index = 0; index < 50; index += 1) {
      glyphs.push(3);
      instanceA.push(0, 0.01, -0.01, 0);
      instanceB.push(300, 100 + index * 5.5, 3, 0);
    }
    const count = glyphs.length;
    const a = Float32Array.from(instanceA);
    const b = Float32Array.from(instanceB);
    const { bytes, columnByteLengths } = encodeTextInstancePositions(a, b, Uint16Array.from(glyphs), count);
    assert.equal(columnByteLengths.reduce((sum, length) => sum + length, 0), bytes.length);
    const decoded = new Float32Array(count * 4);
    decodeTextInstancePositionsInto(bytes, columnByteLengths, a, Uint16Array.from(glyphs), decoded, count);
    for (let index = 0; index < count; index += 1) {
      // Origins stay on the 1/512 grid, exactly as before the predictor.
      assert.equal(decoded[index * 4], Math.fround(Math.round(b[index * 4] * 512) / 512), `instance ${index} e`);
      assert.equal(decoded[index * 4 + 1], Math.fround(Math.round(b[index * 4 + 1] * 512) / 512), `instance ${index} f`);
    }
    // Predicted advances leave mostly zero residuals on the baseline stream.
    const advanceBytes = bytes.subarray(columnByteLengths[0], columnByteLengths[0] + columnByteLengths[1]);
    assert.ok(advanceBytes.filter(byte => byte === 0).length > advanceBytes.length * 0.5,
      "repeated glyph advances are predicted");
    // The reader must predict from the same glyphs the writer saw.
    const shifted = Uint16Array.from(glyphs, glyph => glyph === 1 ? 2 : glyph);
    const mispredicted = new Float32Array(count * 4);
    decodeTextInstancePositionsInto(bytes, columnByteLengths, a, shifted, mispredicted, count);
    assert.notDeepEqual(mispredicted, decoded);
    assert.throws(() => decodeTextInstancePositionsInto(bytes, [columnByteLengths[0], columnByteLengths[1]], a,
      Uint16Array.from(glyphs), new Float32Array(count * 4), count), /column lengths/);
    assert.throws(() => decodeTextInstancePositionsInto(bytes, columnByteLengths, a.subarray(0, 8),
      Uint16Array.from(glyphs), new Float32Array(count * 4), count), /instance data is incomplete/);
  }

  console.log("HEP v9 scene section codecs passed.");
} finally { hooks.deregister(); }
