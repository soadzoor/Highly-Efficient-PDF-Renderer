import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { packVectorLod, unpackVectorLod, packVectorLodWithPointRecipes } = await import("../src/hepLodEncoding.ts");
  const { decodeVectorLodPointRecipes, pointRecipeStorageBytes } = await import("../src/hepLodPointRecipes.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { writeHepLod, readHepLod } = await import("../src/hepLod.ts");
  const { storeVectorStrokeLod, getStoredVectorStrokeLod, resetVectorStrokeLodBuildTiming,
    consumeVectorStrokeLodBuildTiming } = await import("../src/vectorStrokeLodCore.ts");
  const fields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];
  const words = array => new Uint32Array(array.buffer, array.byteOffset, array.length);
  let random = 123456789;
  const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0; };
  const make = precision => {
    const count = 8192, scene = { ...createEmptyVectorScene(), segmentCount: count };
    for (const field of fields) scene[field] = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const start = [(next() % 500000) / 512, (next() % 500000) / 512];
      const end = [(next() % 500000) / 512, (next() % 500000) / 512];
      scene.endpoints.set([...start, ...end], i * 4);
      scene.primitiveMeta.set([...end, 0, 1], i * 4);
      scene.styles.set([.25, .5, .25, .75], i * 4);
    }
    scene.endpoints[0] = -0; scene.endpoints[1] = 0;
    const literals = { segmentCount: count };
    for (const field of fields) literals[field] = new Float32Array(count * 4);
    const origins = Uint32Array.from({ length: count }, (_v, i) => i);
    const data = { literals, origins, levels: [{ segmentCount: count, tolerance: 0 },
      { segmentCount: count, tolerance: 1, records: Uint32Array.from({ length: count }, (_v, i) => count + i) }] };
    if (precision === "compact") data.positionQuanta = Float32Array.from({ length: count }, (_v, i) => 2 ** (-9 + i % 3));
    if (precision === "legacy") data.positionQuantum = 1 / 512;
    for (let i = 0; i < count; i++) {
      const q = data.positionQuanta?.[i] ?? data.positionQuantum;
      const grid = value => q === undefined ? value : (Math.round(value / q) || 0) * q;
      const first = ((i + 1 + next() % 32) % count) * 4, last = ((i + 33 + next() % 32) % count) * 4;
      const start = [grid(scene.endpoints[first]), grid(scene.endpoints[first + 1])];
      const end = [grid(scene.primitiveMeta[last]), grid(scene.primitiveMeta[last + 1])];
      if (i % 17 === 0) start[0] += 10000;
      if (i % 23 === 0) end[1] -= 10000;
      const control = i % 13 === 0 ? [grid((start[0] + end[0]) / 2), grid((start[1] + end[1]) / 2)] : end;
      literals.endpoints.set([...start, ...control], i * 4);
      literals.primitiveMeta.set([...end, i % 13 === 0 ? 1 : -(i % 4), i % 5 === 0 ? .5 : 1], i * 4);
      literals.primitiveBounds.set([Math.min(...[start[0], end[0], control[0]]), Math.min(...[start[1], end[1], control[1]]),
        Math.max(...[start[0], end[0], control[0]]), Math.max(...[start[1], end[1], control[1]])], i * 4);
      literals.styles.set(scene.styles.subarray(i * 4, i * 4 + 4), i * 4);
    }
    if (precision === "lossless") literals.endpoints.set([-0, 0], 4);
    return { scene, data };
  };
  for (const precision of ["compact", "lossless", "legacy"]) {
    const { scene, data } = make(precision), packed = packVectorLod(scene, data), snapshot = structuredClone(packed);
    const recipes = await packVectorLodWithPointRecipes(scene, packed);
    assert(recipes.pointRecipes, `${precision}: source-point references should reduce this geometry`);
    assert.deepEqual(packed, snapshot, "encoding does not mutate the original cache");
    assert.deepEqual(decodeVectorLodPointRecipes(scene, recipes), packed, "recipes recover every original residual word");
    const restored = unpackVectorLod(scene, recipes);
    for (const field of fields) assert.deepEqual(words(restored.literals[field]), words(data.literals[field]),
      `${precision}: ${field} keeps exact Float32 bits, curves and density weights`);
    assert.deepEqual(restored.origins, data.origins);
    assert.deepEqual(restored.levels.map(level => level.records), data.levels.map(level => level.records));
    assert(await pointRecipeStorageBytes(recipes) < await pointRecipeStorageBytes(packed));
    assert.equal(await packVectorLodWithPointRecipes(scene, recipes), recipes, "already-packed data stays unchanged");
    const invalid = structuredClone(recipes);
    invalid.pointRecipes.start.references[0] = 0xffffffff;
    assert.throws(() => unpackVectorLod(scene, invalid), /invalid vector LOD point recipe/);
    for (const damage of [cache => cache.pointRecipes.version = 2,
      cache => cache.pointRecipes.end.references = new Uint32Array(1),
      cache => cache.pointRecipes.end.residuals = new Uint32Array(1),
      cache => delete cache.origins,
      cache => cache.origins[0] = scene.segmentCount,
      cache => cache.literals.endpoints = new Uint32Array(0)]) {
      const bad = structuredClone(recipes); damage(bad);
      assert.throws(() => unpackVectorLod(scene, bad), /invalid vector LOD point recipe/);
    }
    const controller = new AbortController(); controller.abort(new Error("recipe cancelled"));
    await assert.rejects(packVectorLodWithPointRecipes(scene, packed, controller.signal), /recipe cancelled/);
  }
  const { scene, data } = make("lossless");
  delete data.origins;
  const absent = packVectorLod(scene, data);
  assert.equal(await packVectorLodWithPointRecipes(scene, absent), absent, "caches without origins retain the old representation");
  const tiny = { ...data, origins: Uint32Array.of(0), literals: { segmentCount: 1 } };
  for (const field of fields) tiny.literals[field] = data.literals[field].slice(0, 4);
  const small = packVectorLod(scene, tiny);
  assert.equal(await packVectorLodWithPointRecipes(scene, small), small, "descriptor and section overhead must not grow small caches");

  const offsetScene = { ...createEmptyVectorScene(), segmentCount: 2 };
  for (const field of fields) {
    const allocation = new Float32Array(4 + 8 + 4);
    offsetScene[field] = allocation.subarray(4);
  }
  offsetScene.endpoints.set([-0, 0, 10, 20, 30, 40, 50, 60]);
  offsetScene.primitiveMeta.set([10, 20, 0, 1, 50, 60, 0, 1]);
  const offsetData = { origins: Uint32Array.of(0), levels: [{ segmentCount: 2 }],
    literals: { segmentCount: 1, endpoints: Float32Array.of(10, 20, 30, 40),
      primitiveMeta: Float32Array.of(30, 40, 0, 1), primitiveBounds: Float32Array.of(10, 20, 30, 40),
      styles: new Float32Array(4) } };
  const offsetPacked = packVectorLod(offsetScene, offsetData);
  const offsetRecipes = { ...offsetPacked, literals: { ...offsetPacked.literals,
    endpoints: offsetPacked.literals.endpoints.slice(2), primitiveMeta: offsetPacked.literals.primitiveMeta.slice(2) },
    pointRecipes: { version: 1, start: { references: Uint32Array.of(3), residuals: new Uint32Array() },
      end: { references: Uint32Array.of(3), residuals: new Uint32Array() } } };
  assert(offsetScene.endpoints.byteOffset > 0 && offsetScene.endpoints.length > offsetScene.segmentCount * 4);
  assert.deepEqual(decodeVectorLodPointRecipes(offsetScene, offsetRecipes), offsetPacked,
    "source references respect Float32 subarray offsets and ignore trailing texture padding");
  for (const field of fields) assert.deepEqual(words(unpackVectorLod(offsetScene, offsetRecipes).literals[field]),
    words(offsetData.literals[field]));

  const integration = make("compact"), count = integration.scene.segmentCount;
  integration.scene.bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  integration.scene.maxHalfWidth = .25;
  integration.data.tileGrid = { minX: -10000, minY: -10000, maxX: 20000, maxY: 20000,
    columns: 1, rows: 1, tileWidth: 30000, tileHeight: 30000,
    xEdges: Float64Array.of(-10000, 20000), yEdges: Float64Array.of(-10000, 20000) };
  for (const level of integration.data.levels) Object.assign(level, {
    sceneBounds: { ...integration.data.tileGrid }, maxHalfWidth: .25,
    tileOffsets: Uint32Array.of(0, count), tileCounts: Uint32Array.of(count),
    tileSegmentIds: Uint32Array.from({ length: count }, (_v, i) => i) });
  storeVectorStrokeLod(integration.scene, integration.data);
  resetVectorStrokeLodBuildTiming();
  const archive = new HepArchive(), manifest = await writeHepLod(archive, integration.scene, { withTextLod: false });
  assert.equal(manifest.vector.version, 5, "exports advertise v5 only when source-point recipes shrink the cache");
  const restoredScene = structuredClone(integration.scene), disk = await HepArchive.loadAsync(await archive.generateAsync({ type: "uint8array" }));
  await readHepLod(disk, restoredScene, manifest);
  const cache = getStoredVectorStrokeLod(restoredScene);
  assert(cache, "the v5 reader must adopt the stored hierarchy");
  for (const field of fields) assert.deepEqual(words(cache.literals[field]), words(integration.data.literals[field]));
  assert.deepEqual(cache.origins, integration.data.origins);
  assert.equal(consumeVectorStrokeLodBuildTiming().buildCount, 0, "export and read reuse all generated levels");
  const index = JSON.parse(await disk.file(manifest.vector.file).async("string"));
  index.pointRecipes.version = 2;
  disk.file(manifest.vector.file, JSON.stringify(index));
  const corruptScene = structuredClone(integration.scene);
  const warnings = [], originalWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  try { await readHepLod(disk, corruptScene, manifest); } finally { console.warn = originalWarn; }
  assert.equal(getStoredVectorStrokeLod(corruptScene), null);
  assert(warnings.some(message => message.includes("invalid vector LOD point recipe")), "corrupt optional recipes retain canonical rendering with diagnostics");
  console.log("HEP source-point recipes: compact/lossless/legacy bit parity, origins, curves, density, size selection and validation passed.");
} finally { hooks.deregister(); }
