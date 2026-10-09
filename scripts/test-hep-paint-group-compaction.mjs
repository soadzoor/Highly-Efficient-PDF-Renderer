// Synthetic scenes only: no PDF conversion, browser, or development server.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const {
    encodeScenePaintGraph, encodeScenePaintGraphForStorage, decodeScenePaintGraph,
    encodeSceneDrawRuns, encodeSceneDrawRunsForStorage, decodeSceneDrawRuns,
    SCENE_PAINT_GRAPH_PATH, SCENE_DRAW_RUNS_PATH
  } = await import("../src/hepSceneSections.ts");
  const { ByteWriter } = await import("../src/parsedDataVarint.ts");
  const { PDF_BLEND_MODES, normalizeScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const group = (runIndex, state = {}, drawState = {}) => ({
    kind: "group", alpha: 1, isolated: false, knockout: false, blendMode: "Darken",
    ...state, children: [{ kind: "draw", runIndex, ...drawState }]
  });

  // Wire repetition preserves every canonical group boundary. It is separate
  // from the color-dependent graph used by a renderer to batch composites.
  {
    const graph = { roots: Array.from({ length: 4096 }, (_, index) => group(index, { alphaIsShape: false })) };
    const legacy = encodeScenePaintGraph(graph);
    const stored = encodeScenePaintGraphForStorage(graph, 4096);
    assert(stored.repeatedGroups);
    assert(stored.bytes.length < legacy.length / 100, "repeated wrappers use one stored template and run range");
    assert(deflateSync(stored.bytes).length < deflateSync(legacy).length, "the repetitive graph also shrinks on disk");
    const decoded = decodeScenePaintGraph(stored.bytes, 4096);
    assert.deepEqual(decoded, graph);
    assert.throws(() => decodeScenePaintGraph(stored.bytes), /paint graph|node kind/,
      "the legacy codec cannot silently interpret the new repeat record");
    assert.notEqual(decoded.roots[0], decoded.roots[1]);
    assert.notEqual(decoded.roots[0].children, decoded.roots[1].children);
    assert.notEqual(decoded.roots[0].children[0], decoded.roots[1].children[0]);
    decoded.roots[0].alpha = 0.5;
    decoded.roots[0].children[0].runIndex = 99;
    assert.equal(decoded.roots[1].alpha, 1, "expanded siblings own independent state");
    assert.equal(decoded.roots[1].children[0].runIndex, 1);
    assert.deepEqual(decodeScenePaintGraph(legacy), graph, "the original section codec is unchanged");
  }

  {
    const states = [
      { alpha: 0.37500000000000006 },
      { isolated: true, knockout: true, blendMode: "Multiply", alphaIsShape: true, optionalContent: 4 },
      { bounds: { minX: -0, minY: 0.1, maxX: 123.456789, maxY: 1 / 3 }, alphaIsShape: false },
      { alpha: -0, blendMode: "Screen" }
    ];
    const roots = states.flatMap((state, block) => [group(block * 2, state, { optionalContent: 7 }),
      group(block * 2 + 1, state, { optionalContent: 7 })]);
    const graph = { roots };
    const stored = encodeScenePaintGraphForStorage(graph, 8);
    assert(stored.repeatedGroups);
    const decoded = decodeScenePaintGraph(stored.bytes, 8);
    assert.deepEqual(decoded, graph, "alpha, blend, isolation, knockout, bounds and both conditions remain exact");
    assert(Object.is(decoded.roots[4].bounds.minX, -0));
    assert(Object.is(decoded.roots[6].alpha, -0));
    assert.notEqual(decoded.roots[4].bounds, decoded.roots[5].bounds);
    decoded.roots[4].bounds.maxX = 1;
    assert.equal(decoded.roots[5].bounds.maxX, 123.456789);

    // Presence and signed zero are state, so neither can share a template with
    // an otherwise equal adjacent wrapper.
    for (const [left, right, childLeft, childRight] of [
      [{}, { alphaIsShape: false }, {}, {}],
      [{ optionalContent: 0 }, {}, {}, {}],
      [{ alpha: 0 }, { alpha: -0 }, {}, {}],
      [{ bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
        { bounds: { minX: -0, minY: 0, maxX: 1, maxY: 1 } }, {}, {}],
      [{}, {}, { optionalContent: 0 }, {}]
    ]) {
      const different = { roots: [group(0, left, childLeft), group(1, right, childRight)] };
      const encoded = encodeScenePaintGraphForStorage(different, 2);
      assert.equal(Boolean(encoded.repeatedGroups), false, "different group/draw states stay literal");
      assert.deepEqual(decodeScenePaintGraph(encoded.bytes), different);
    }
  }

  {
    const mask = { subtype: "Luminosity", transfer: Float32Array.of(0, 0.5, 1),
      backdrop: [0.1, 0.2, 0.3], children: [{ kind: "draw", runIndex: 3 }] };
    const graph = { roots: [group(0), group(1),
      { ...group(2), softMask: mask },
      { ...group(4), children: [] },
      group(6), group(5),
      { kind: "retained", retainedPage: 0, firstCommand: 2, count: 3, rasterIndex: 0 }
    ] };
    const stored = encodeScenePaintGraphForStorage(graph, 7);
    assert(stored.repeatedGroups);
    assert.deepEqual(decodeScenePaintGraph(stored.bytes, 7), graph,
      "mask subtrees, empty groups, retained leaves and backwards run references remain literal");
    const backwards = { roots: [group(1), group(0)] };
    const literal = encodeScenePaintGraphForStorage(backwards, 2);
    assert.equal(Boolean(literal.repeatedGroups), false);
    assert.deepEqual(decodeScenePaintGraph(literal.bytes), backwards);
    const masked = { roots: [group(0, { softMask: mask }), group(1, { softMask: {
      ...mask, children: [{ kind: "draw", runIndex: 4 }]
    } })] };
    const maskedBytes = encodeScenePaintGraphForStorage(masked, 5);
    assert.equal(Boolean(maskedBytes.repeatedGroups), false, "masked wrappers are never encoded as repeated groups");
    assert.deepEqual(decodeScenePaintGraph(maskedBytes.bytes), masked);
    const outOfRange = encodeScenePaintGraphForStorage({ roots: [group(0), group(1)] }, 1);
    assert.equal(Boolean(outOfRange.repeatedGroups), false, "source range cannot authorize a larger expansion");
    assert.throws(() => encodeScenePaintGraphForStorage({ roots: [group(0), group(1)] }, -1), /paint graph|range/);
    const cyclic = [];
    cyclic.push({ ...group(0), children: cyclic });
    assert.throws(() => encodeScenePaintGraphForStorage({ roots: cyclic }, 1), /cyclic/);
  }

  // Construct repeat records directly to exercise expansion validation before
  // the decoder creates the corresponding group/draw objects.
  const repeatedWire = ({ logical = 2, count = 2, first = 0, header = 1, childHeader = 0 } = {}) => {
    const writer = new ByteWriter(32);
    writer.writeVarUint32(logical); writer.writeByte(3); writer.writeVarUint32(count);
    writer.writeByte(header); writer.writeByte(PDF_BLEND_MODES.indexOf("Darken")); writer.writeFloat64(1);
    writer.writeByte(childHeader); writer.writeZigzagVarint(first);
    return writer.toUint8Array();
  };
  for (const [wire, sourceCount] of [
    [repeatedWire({ count: 0 }), 2], [repeatedWire({ count: 1 }), 2],
    [repeatedWire({ logical: 1 }), 2], [repeatedWire(), 1],
    [repeatedWire({ first: -1 }), 2], [repeatedWire({ first: 1 }), 2],
    [repeatedWire({ header: 65 }), 2], [repeatedWire({ childHeader: 1 }), 2],
    [repeatedWire({ childHeader: 4 }), 2],
    [repeatedWire({ logical: 0xffffffff, count: 0xffffffff }), 8]
  ]) assert.throws(() => decodeScenePaintGraph(wire, sourceCount), /paint graph|ended early|truncated|range|repeat/);
  {
    const bytes = repeatedWire();
    assert.throws(() => decodeScenePaintGraph(bytes.subarray(0, bytes.length - 1), 2), /paint graph|ended early|length mismatch/);
    const writer = new ByteWriter(64);
    writer.writeVarUint32(4);
    writer.writeBytes(bytes.subarray(1));
    writer.writeBytes(repeatedWire({ first: -1 }).subarray(1));
    assert.throws(() => decodeScenePaintGraph(writer.toUint8Array(), 2), /paint graph|repeat|range/,
      "repeated blocks together cannot exceed the canonical source run count");
  }

  {
    const runs = [
      ...Array.from({ length: 128 }, (_, index) => ({ kind: "stroke", first: index * 2, count: 2, clipIndex: 0 })),
      { kind: "stroke", first: 260, count: 3, clipIndex: 1, optionalContent: 2, blendMode: "Multiply" },
      { kind: "stroke", first: 263, count: 1, clipIndex: 1, optionalContent: 2, blendMode: "Multiply" },
      { kind: "fill", first: 9, count: 0, clipIndex: 0 },
      { kind: "fill", first: 9, count: 2, clipIndex: 0 },
      { kind: "stroke", first: 1, count: 2 },
      { kind: "text", first: 0x7ffffffe, count: 1 },
      { kind: "text", first: 0x7fffffff, count: 1 },
      { kind: "text", first: 0x80000000, count: 1 }
    ];
    const stored = encodeSceneDrawRunsForStorage(runs);
    assert(stored.groupedRuns);
    assert(stored.bytes.length < encodeSceneDrawRuns(runs).length / 2);
    assert.deepEqual(decodeSceneDrawRuns(stored.bytes, true), runs,
      "grouped runs preserve counts, gaps, backwards ranges, zero counts and optional state");
    assert.deepEqual(decodeSceneDrawRuns(encodeSceneDrawRuns(runs)), runs);
    assert.throws(() => decodeSceneDrawRuns(stored.bytes.subarray(0, stored.bytes.length - 1), true),
      /draw run|truncated|ended early|length mismatch/);
    assert.throws(() => encodeSceneDrawRunsForStorage([{ kind: "bogus", first: 0, count: 1 }]), /unknown kind/);
  }
  const groupedWire = ({ total = 2, groups = 1, flags = 65, length = 2, counts = [1, 1] } = {}) => {
    const writer = new ByteWriter(16);
    writer.writeVarUint32(total); writer.writeVarUint32(groups);
    writer.writeByte(flags); writer.writeVarUint32(length);
    for (const count of counts) writer.writeVarUint32(count);
    return writer.toUint8Array();
  };
  for (const bytes of [
    groupedWire({ groups: 3 }), groupedWire({ length: 3, counts: [1, 1, 1] }),
    groupedWire({ length: 0 }), groupedWire({ total: 3 }), groupedWire({ flags: 193 }),
    groupedWire({ counts: [0xffffffff, 2] }), Uint8Array.of(255, 255, 255, 255, 15, 1, 65, 2, 1, 1)
  ]) assert.throws(() => decodeSceneDrawRuns(bytes, true), /draw run|truncated|range|length|ended early/);

  const makeScene = count => {
    const scene = { ...createEmptyVectorScene(), segmentCount: count, sourceSegmentCount: count,
      pageCount: 1, pageRects: Float32Array.of(0, 0, 256, 16), maxHalfWidth: 0.25,
      bounds: { minX: 0, minY: 0, maxX: 256, maxY: 16 }, pageBounds: { minX: 0, minY: 0, maxX: 256, maxY: 16 },
      drawRuns: Array.from({ length: count }, (_, index) => ({ kind: "stroke", first: index, count: 1 })),
      paintGraph: { roots: Array.from({ length: count }, (_, index) => group(index, { alphaIsShape: false })) }
    };
    for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[field] = new Float32Array(count * 4);
    for (let index = 0; index < count; index++) {
      scene.endpoints.set([index, 1, index + 0.5, 1], index * 4);
      scene.primitiveMeta.set([index + 0.5, 1, 0, 1], index * 4);
      scene.primitiveBounds.set([index, 1, index + 0.5, 1], index * 4);
      scene.styles.set([0.25, 0.5, 0.5, 0.5], index * 4);
    }
    return scene;
  };
  const writeOptions = { withVectorLod: false, withTextLod: false };
  const rewritten = async (bytes, edit) => {
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    edit(manifest, archive);
    archive.file("manifest.json", JSON.stringify(manifest));
    return archive.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  };
  {
    const scene = makeScene(128);
    const originalGraph = structuredClone(scene.paintGraph);
    const bytes = await (await buildHep(scene, writeOptions)).arrayBuffer();
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(manifest.formatVersion, 13);
    assert.equal(manifest.scene.paintGraph.encoding, "group-runs-v1");
    assert.equal(manifest.scene.drawRuns.encoding, "grouped-v1");
    const loaded = await loadSceneFromHep(bytes);
    assert.deepEqual(loaded.drawRuns, scene.drawRuns);
    assert.deepEqual(loaded.paintGraph, originalGraph);
    assert.deepEqual(scene.paintGraph, originalGraph, "export does not replace the canonical graph with a render graph");
    assert.equal(normalizeScenePaintGraph(loaded).length, 1, "equal source colors can still batch during rendering");
    loaded.styles[64 * 4 + 1] = 1;
    assert.equal(normalizeScenePaintGraph(loaded, false).length, 128,
      "recoloring can recover all original Darken boundaries after compact storage");
    const recolored = { ...loaded, styles: new Float32Array(loaded.styles) };
    assert.equal(normalizeScenePaintGraph(recolored).length, 3, "a changed source color splits the compatible render span");
    assert.equal(loaded.paintGraph.roots.length, 128);

    for (const edit of [
      manifest => { manifest.formatVersion = 12; },
      manifest => { manifest.scene.paintGraph.encoding = "unknown"; },
      manifest => { manifest.scene.drawRuns.encoding = "unknown"; },
      manifest => { manifest.scene.paintGraph.rootCount--; },
      manifest => { manifest.scene.drawRuns.count--; },
      manifest => { delete manifest.scene.paintGraph.encoding; },
      manifest => { delete manifest.scene.drawRuns.encoding; }
    ]) await assert.rejects(loadSceneFromHep(await rewritten(bytes, edit)), /HEP|paint graph|draw run|manifest|encoding|node kind/);

    // A v13 descriptor may still use an ordinary draw-run section when grouping
    // would not save bytes; graph repetition is the scene-version trigger.
    const legacyRuns = await rewritten(bytes, (manifest, archive) => {
      delete manifest.scene.drawRuns.encoding;
      archive.file(SCENE_DRAW_RUNS_PATH, encodeSceneDrawRuns(scene.drawRuns));
    });
    assert.deepEqual((await loadSceneFromHep(legacyRuns)).drawRuns, scene.drawRuns);
  }
  {
    const scene = makeScene(1);
    const bytes = await (await buildHep(scene, writeOptions)).arrayBuffer();
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(manifest.formatVersion, 9, "ordinary exports keep their existing scene schema");
    assert.equal(manifest.scene.paintGraph.encoding, undefined);
    assert.equal(manifest.scene.drawRuns.encoding, undefined);
    for (const version of [9, 10, 11, 12]) {
      const loaded = await loadSceneFromHep(await rewritten(bytes, manifest => { manifest.formatVersion = version; }));
      assert.deepEqual(loaded.drawRuns, scene.drawRuns, `scene v${version} draw runs remain readable`);
      assert.deepEqual(loaded.paintGraph, scene.paintGraph, `scene v${version} paint graph remains readable`);
    }
    assert(archive.file(SCENE_PAINT_GRAPH_PATH));
  }
  console.log("HEP paint group compaction tests passed.");
} finally { hooks.deregister(); }
