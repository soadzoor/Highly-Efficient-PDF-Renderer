import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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

  console.log("HEP v8 scene section codecs passed.");
} finally { hooks.deregister(); }
