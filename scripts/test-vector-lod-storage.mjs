import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { getSplitVectorStrokeLodStorage, vectorStrokeLodStorageOrigins } = await import("../src/vectorStrokeLodStorage.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { VectorStrokeLodRuntime, storePrebuiltVectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
  const { strokePaintOrigins, setStrokePaintOrigins } = await import("../src/vectorStrokePaintOrder.ts");
  const { ThreeVectorLodStrokeLayer } = await import("../src/vectorStrokeLod.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const fields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];
  const scene = { ...createEmptyVectorScene(), segmentCount: 320, maxHalfWidth: .5,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    drawRuns: [{ kind: "stroke", first: 160, count: 160 }, { kind: "stroke", first: 0, count: 160 }] };
  for (const field of fields) scene[field] = new Float32Array(scene.segmentCount * 4);
  for (let index = 0; index < scene.segmentCount; index++) {
    const y = Math.floor(index / 40) * 10;
    // Overlapping lines in one merge tile become new, longer records.
    const [x0, x1] = index % 2 ? [2, 52] : [0, 50];
    scene.endpoints.set([x0, y, x1, y], index * 4);
    scene.primitiveMeta.set([x1, y, 0, 1], index * 4);
    scene.primitiveBounds.set([x0, y, x1, y], index * 4);
    scene.styles.set([.5, .25, .5, .75], index * 4);
  }
  // One stroke that no level can merge or aggregate: every derived level keeps
  // it unchanged, so every level must reference the canonical record.
  scene.primitiveMeta[3] = 3;
  scene.endpoints.set([10, 5, 10, 5], 0);
  scene.primitiveMeta.set([10, 5.5, 1], 0);
  scene.primitiveBounds.set([10, 5, 10, 5.5], 0);
  const canonical = fields.map(field => scene[field]);
  const original = structuredClone(scene);
  const runtime = new VectorStrokeLodRuntime(scene);
  assert(runtime.levels.length > 1);
  const store = runtime.levels[1].store;
  assert(runtime.levels.every(level => level.store === store), "levels share one record store");
  const literals = store.literals;
  const literalBuffers = new Set(fields.map(field => literals[field].buffer));
  const snapshots = runtime.levels.map(level => fields.map(field => level.scene[field].slice()));
  const origins = runtime.levels.map(level => strokePaintOrigins(level.scene));
  assert.equal(runtime.levels[0].scene, scene, "the canonical level is the caller's scene");
  const storage = getSplitVectorStrokeLodStorage(scene, runtime.levels);
  assert.equal(getSplitVectorStrokeLodStorage(scene, runtime.levels), storage, "one immutable store per hierarchy");
  const count = storage.layout.count;
  assert.equal(count, scene.segmentCount + literals.segmentCount, "canonical strokes, then only LOD-only records");
  const storageOrigins = vectorStrokeLodStorageOrigins(storage.layout);
  // Three uploads one array per texture. The canonical strokes' complete rows
  // stay in the scene's arrays; the tail holds their last row and LOD records.
  const { split, head, tail } = storage.textures;
  const rowWidth = Math.ceil(Math.sqrt(scene.segmentCount));
  assert.equal(split, rowWidth * Math.floor(scene.segmentCount / rowWidth));
  assert(split < scene.segmentCount, "the fixture has a partial canonical row in the tail");
  const texel = (field, id) => id < split ? head[field].data.subarray(id * 4, id * 4 + 4)
    : tail[field].data.subarray((id - split) * 4, (id - split) * 4 + 4);
  const literalUses = new Uint32Array(literals.segmentCount);
  let references = 0;
  runtime.levels.forEach((level, index) => {
    assert.equal(strokePaintOrigins(level.scene), origins[index], "a materialized level keeps its scene identity");
    for (let id = 0; id < level.segmentCount; id++) {
      const stored = level.records ? level.records[id] : id;
      assert.equal(storageOrigins[stored], origins[index][id], "stored records keep each level's paint origin");
      if (level.records && stored < scene.segmentCount) references++;
      if (stored >= scene.segmentCount) literalUses[stored - scene.segmentCount]++;
      fields.forEach((field, component) => assert.deepEqual(
        new Uint32Array(texel(field, stored).slice().buffer),
        new Uint32Array(snapshots[index][component].slice(id * 4, id * 4 + 4).buffer),
        "each level record resolves to its exact bits in the uploaded textures"));
    }
    if (index === 0) fields.forEach((field, component) => assert.equal(level.scene[field], canonical[component],
      "canonical arrays retain their identity"));
  });
  assert(runtime.levels.slice(1).every(level => level.records[0] === 0), "unchanged strokes are references, not copies");
  assert(references >= runtime.levels.length - 1);
  assert(literalUses.every(uses => uses === 1), "each LOD-only record is stored once and used by one level");
  fields.forEach(field => {
    assert.equal(head[field].data.buffer, scene[field].buffer, "canonical texture rows are views of the caller's arrays");
    assert.equal(head[field].data.length, head[field].width * head[field].height * 4);
    assert.equal(head[field].width * head[field].height, split);
    assert.equal(literals[field].buffer, tail[field].data.buffer, "LOD-only records become views of the tail, not retained copies");
    assert(!literalBuffers.has(literals[field].buffer));
    assert.equal(tail[field].data.length, tail[field].width * tail[field].height * 4);
    assert(tail[field].width * tail[field].height >= count - split);
  });
  const buffers = new Set([scene, literals].flatMap(value => fields.map(field => value[field].buffer)));
  assert.equal([...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
    (scene.segmentCount + tail.endpoints.width * tail.endpoints.height) * 64,
    "texture-ready storage copies only the canonical partial row, beside the LOD-only records");

  runtime.levels.forEach((level, index) => {
    level.visibleSegmentCount = index === runtime.levels.length - 1 ? level.segmentCount : 0;
    if (level.visibleSegmentIds.length < level.visibleSegmentCount) level.visibleSegmentIds = new Uint32Array(level.visibleSegmentCount);
    for (let id = 0; id < level.visibleSegmentCount; id++) level.visibleSegmentIds[id] = id;
  });
  const plan = new VectorOrderedBatches(scene, runtime);
  const secondPlan = new VectorOrderedBatches(scene, runtime);
  for (const consumer of [plan, secondPlan]) {
    assert.deepEqual(consumer.strokeRecords.segments.map(segment => segment.scene), [scene, literals],
      "ordered plans read canonical and LOD-only records in place");
  }
  const sourceRuns = new Uint32Array(scene.segmentCount);
  scene.drawRuns.forEach((run, index) => sourceRuns.fill(index, run.first, run.first + run.count));
  const expectedRanks = Array.from({ length: count }, (_, id) => id).sort((a, b) =>
    sourceRuns[storageOrigins[a]] - sourceRuns[storageOrigins[b]] || storageOrigins[a] - storageOrigins[b] || a - b);
  assert.deepEqual([...plan.rankToId], expectedRanks, "linear counting ranks exactly match canonical paint/origin/ID sorting");
  assert.equal(plan.selectedRanks.length, 0, "dormant levels do not reserve selection scratch");
  assert.equal(plan.previousSelectedIds.length, 0);
  assert.equal(plan.redundancyIds.length, 0);
  assert.equal(plan.floatInstanceData.length, 0, "WebGPU does not reserve unused float instances");
  assert.equal(plan.uintInstances.length, 2);
  plan.update(scene.drawRuns);
  secondPlan.update(scene.drawRuns);
  assert(plan.selectedRanks.length < count, "selection scratch follows visible strokes");
  assert.equal(plan.floatInstanceData.length, 0, "integer submission does not generate float instance data");
  assert.deepEqual([...plan.floatInstances.subarray(0, plan.instanceCount * 2)],
    [...plan.uintInstances.subarray(0, plan.instanceCount * 2)], "WebGL lazily gets the same IDs and clips");
  assert(plan.floatInstances.length < count * 2);
  assert.deepEqual(plan.batches, secondPlan.batches);
  assert.deepEqual(plan.uintInstances, secondPlan.uintInstances);
  const firstCapacity = plan.uintInstances.length;
  // An exact frame grows the buffers, then coarse and empty frames must discard
  // stale selection data without changing paint ordering or float conversion.
  plan.setColorCommutationEnabled(false);
  secondPlan.setColorCommutationEnabled(false);
  for (const exact of [true, false, true, false]) {
    runtime.levels.forEach((level, index) => {
      const selected = exact ? index === 0 : index === runtime.levels.length - 1;
      level.visibleSegmentCount = selected ? level.segmentCount : 0;
      if (level.visibleSegmentIds.length < level.visibleSegmentCount) level.visibleSegmentIds = new Uint32Array(level.visibleSegmentCount);
      for (let id = 0; id < level.visibleSegmentCount; id++) level.visibleSegmentIds[id] = id;
    });
    plan.invalidate(); secondPlan.invalidate();
    plan.update(scene.drawRuns); secondPlan.update(scene.drawRuns);
    assert.deepEqual(plan.uintInstances.subarray(0, plan.instanceCount * 2),
      secondPlan.uintInstances.subarray(0, secondPlan.instanceCount * 2));
    assert.deepEqual([...plan.floatInstances.subarray(0, plan.instanceCount * 2)],
      [...plan.uintInstances.subarray(0, plan.instanceCount * 2)]);
    if (exact) {
      assert.equal(plan.instanceCount, scene.segmentCount);
      assert.deepEqual(Array.from({ length: plan.instanceCount }, (_, index) => plan.uintInstances[index * 2]),
        [...Array.from({ length: 160 }, (_, index) => index + 160), ...Array.from({ length: 160 }, (_, index) => index)],
        "growing instance storage retains reversed canonical paint order");
    }
  }
  assert(plan.uintInstances.length > firstCapacity);
  runtime.levels.forEach(level => { level.visibleSegmentCount = 0; });
  plan.invalidate(); plan.update(scene.drawRuns);
  assert.equal(plan.instanceCount, 0, "empty selection discards prior exact IDs");
  assert.deepEqual(scene, original);

  const options = { materialBackend: "webgl", strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] };
  const textureNames = { endpoints: "TextureA", primitiveMeta: "TextureB", styles: "StyleTexture", primitiveBounds: "BoundsTexture" };
  const checkSplitMaterial = (material, expected) => {
    for (const field of fields) {
      assert.equal(material[`segment${textureNames[field]}`].image.data, expected.head[field].data,
        "head textures upload the scene's own arrays");
      assert.equal(material[`segmentTail${textureNames[field]}`].image.data, expected.tail[field].data,
        "tail textures upload the shared tail data");
    }
    const shader = material.mesh.material;
    assert("HEPR_SPLIT_STROKE_STORE" in shader.defines, "the WebGL material opts into the split fetch");
    assert.match(shader.vertexShader, /#ifdef HEPR_SPLIT_STROKE_STORE[\s\S]*index >= uSegmentSplit/);
    assert.equal(shader.uniforms.uSegmentSplit.value, expected.split);
    assert.deepEqual([...shader.uniforms.uSegmentTexSize.value], [expected.head.endpoints.width, expected.head.endpoints.height]);
    assert.deepEqual([...shader.uniforms.uSegmentTailTexSize.value], [expected.tail.endpoints.width, expected.tail.endpoints.height]);
    for (const field of fields) {
      assert.equal(shader.uniforms[`uSegmentTail${textureNames[field].replace("Texture", "Tex")}`].value,
        material[`segmentTail${textureNames[field]}`], "the shader binds each tail texture");
    }
  };
  storePrebuiltVectorStrokeLodRuntime(scene, runtime);
  const layer = new ThreeVectorLodStrokeLayer(scene, options);
  try {
    assert.equal(layer.runtime, runtime);
    const material = layer.layers[0];
    checkSplitMaterial(material, storage.textures);
    assert.equal(material.segmentMarks.length + material.segmentMinX.length + material.segmentMinY.length +
      material.segmentMaxX.length + material.segmentMaxY.length + material.allSegmentIds.length, 0,
      "externally culled LOD does not duplicate unused spatial scratch");
    assert.equal(layer.combinedIds.length, 0, "Three LOD reserves selection IDs on demand");
    // One recolored stroke in each texture set: canonical row 0, and the first
    // canonical stroke of the partial row that lives in the tail.
    const headColors = head.styles.data.slice(), tailColors = tail.styles.data.slice();
    const recolored = [0, split];
    layer.setPrimitiveColorUpdates(recolored.map(index => ({ ref: { kind: "stroke", index }, color: [1, 0, 0] })));
    assert.notEqual(material.segmentStyleTexture.image.data.buffer, scene.styles.buffer,
      "recoloring copies the head style data on first write");
    assert.notEqual(material.segmentTailStyleTexture.image.data.buffer, tail.styles.data.buffer,
      "and the shared tail style data");
    assert.deepEqual([...material.segmentStyleTexture.image.data.subarray(1, 4)], [1, 0, 0]);
    assert.deepEqual([...material.segmentTailStyleTexture.image.data.subarray(1, 4)], [1, 0, 0],
      "a canonical stroke in the partial row is patched in the tail");
    assert.deepEqual(head.styles.data, headColors, "temporary colors do not alter the canonical scene");
    assert.deepEqual(tail.styles.data, tailColors, "temporary colors do not alter shared LOD storage");
    assert.deepEqual(scene, original);
    layer.setPrimitiveColorUpdates(recolored.map(index => ({ ref: { kind: "stroke", index }, color: null })));
    assert.deepEqual(material.segmentStyleTexture.image.data, headColors,
      "clearing a temporary color restores its exact original value");
    assert.deepEqual(material.segmentTailStyleTexture.image.data, tailColors);
  } finally { layer.dispose(); }
  const reopened = new ThreeVectorLodStrokeLayer(scene, options);
  try {
    assert.equal(reopened.runtime, runtime);
    assert.equal(getSplitVectorStrokeLodStorage(scene, reopened.runtime.levels), storage,
      "backend reuse does not retain another texture copy");
  } finally { reopened.dispose(); }

  // Without LOD, Three also uploads the scene's own arrays, copying only its partial row.
  const exact = new ThreeMaterialStrokeLayer(scene, options);
  try {
    const exactTextures = getSplitVectorStrokeLodStorage(scene, [{ scene, segmentCount: scene.segmentCount }]).textures;
    for (const field of fields) {
      assert.equal(exact[`segment${textureNames[field]}`].image.data.buffer, scene[field].buffer);
      assert.equal(exact[`segmentTail${textureNames[field]}`].image.data.length,
        exactTextures.tail[field].width * exactTextures.tail[field].height * 4);
      assert.deepEqual(exact[`segmentTail${textureNames[field]}`].image.data.subarray(0, (scene.segmentCount - split) * 4),
        scene[field].subarray(split * 4));
    }
    assert.equal(exactTextures.tail.endpoints.width * exactTextures.tail.endpoints.height, 16,
      "only the 14-stroke partial row is copied, padded to a square");
  } finally { exact.dispose(); }

  // Typed copies preserve signed zero and NaN payload bits, not just numeric equality.
  const edge = { ...createEmptyVectorScene(), segmentCount: 1 };
  for (const field of fields) edge[field] = new Float32Array(Uint32Array.of(0x80000000, 0x7fc00001, 0x3f800000, 0).buffer);
  const derived = { ...edge };
  setStrokePaintOrigins(derived, Uint32Array.of(0));
  const edgeLevels = [{ scene: edge, segmentCount: 1 }, { scene: derived, segmentCount: 1 }];
  const edgeTextures = getSplitVectorStrokeLodStorage(edge, edgeLevels).textures;
  assert.equal(edgeTextures.split, 1);
  for (const field of fields) {
    assert.equal(edgeTextures.head[field].data.buffer, edge[field].buffer);
    assert.deepEqual(new Uint32Array(edgeTextures.tail[field].data.buffer), Uint32Array.of(0x80000000, 0x7fc00001, 0x3f800000, 0));
  }

  // Preserve the original default-run behavior for holes, overlapping runs,
  // and a simplified level whose paint origins are in arbitrary order.
  const sparse = { ...createEmptyVectorScene(), segmentCount: 9,
    drawRuns: [{ kind: "stroke", first: 4, count: 2 }, { kind: "stroke", first: 1, count: 2 },
      { kind: "stroke", first: 5, count: 1 }] };
  for (const field of fields) sparse[field] = new Float32Array(36);
  const sparseDerived = { ...sparse };
  const shuffled = Uint32Array.of(8, 2, 4, 0, 5, 1, 2, 7, 4);
  setStrokePaintOrigins(sparseDerived, shuffled);
  const sparseLevels = [sparse, sparseDerived].map((source, index) => ({ scene: source,
    segmentCount: source.segmentCount, tolerance: index, visibleSegmentCount: 0, visibleSegmentIds: new Uint32Array(0) }));
  const sparsePlan = new VectorOrderedBatches(sparse, { levels: sparseLevels });
  const sparseRun = new Uint32Array(9);
  sparse.drawRuns.forEach((run, index) => sparseRun.fill(index, run.first, run.first + run.count));
  const sparseOrigins = [...strokePaintOrigins(sparse), ...shuffled];
  const sparseRanks = Array.from({ length: 18 }, (_, id) => id).sort((a, b) =>
    sparseRun[sparseOrigins[a]] - sparseRun[sparseOrigins[b]] || sparseOrigins[a] - sparseOrigins[b] || a - b);
  assert.deepEqual([...sparsePlan.rankToId], sparseRanks, "counting ranks preserve holes, overlap, shuffled origins and ID ties");
  console.log("Shared LOD storage: exact bits, released derived copies, canonical identity, paint metadata, color isolation and reuse passed");
} finally { hooks.deregister(); }
