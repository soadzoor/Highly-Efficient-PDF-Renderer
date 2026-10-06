// Synthetic scenes only: no PDF conversion, browser, server, or corpus work.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerHooks } from "node:module";
import { repackHepLodBytes } from "./repack-hep-lods.mjs";
import { parsePdfToHepArguments, pdfToHepWorkerArguments } from "../PDFtoHEP.js";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { prepareSceneForHepRendering, loadSceneFromHep } = await import("../src/hep.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const vector = await import("../src/vectorStrokeLodCore.ts");
  const text = await import("../src/textLodCore.ts");
  const { strokePaintOrigins } = await import("../src/vectorStrokePaintOrder.ts");
  const { createOrthographicLocalToClip } = await import("../src/planarProjection.ts");
  const geometryFields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles"];
  const withForbiddenWorker = async (action, label) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    let starts = 0;
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true,
      value: class { constructor() { starts++; throw new Error("Stored HEP LOD must not start a worker"); } } });
    try {
      const result = await action();
      assert.equal(starts, 0, `${label}: stored HEP LOD adoption must bypass worker startup and copying`);
      return result;
    } finally {
      if (previous) Object.defineProperty(globalThis, "Worker", previous);
      else delete globalThis.Worker;
    }
  };
  const reserveWithoutGeometryReads = async (loaded, label) => {
    const stored = vector.getStoredVectorStrokeLod(loaded);
    assert(stored);
    const originals = [], targets = new WeakMap();
    const runtimes = [];
    let reads = 0;
    // Spreading the scene legitimately reads array references. Trap element
    // access instead, while preserving TypedArray length/buffer/method access.
    for (const owner of [loaded, stored.literals]) for (const field of geometryFields) {
      const array = owner[field];
      const probe = new Proxy(array, { get(target, key) {
        if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) {
          reads++;
          throw new Error(`${label}: reread ${field}[${key}] after preparing stored bounds`);
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      targets.set(probe, array);
      originals.push([owner, field, array]);
      owner[field] = probe;
    }
    try {
      const reservations = await Promise.all([
        vector.reserveVectorStrokeLodRuntime(loaded, "force", "webgl"),
        vector.reserveVectorStrokeLodRuntime(loaded, "force", "webgpu")
      ]);
      for (const reservation of reservations) runtimes.push(reservation.take(loaded));
      runtimes.push(new vector.VectorStrokeLodRuntime(loaded));
      assert.equal(reads, 0, `${label}: canonical and derived ink bounds are reused`);
      for (const runtime of runtimes) {
        assert.equal(runtime.levels[0].scene, loaded);
        assert(runtime.levels.every(level => level.store.canonical === loaded));
      }
      for (const runtime of runtimes.slice(1)) {
        assert.notEqual(runtime.levels[0].segmentMarks, runtimes[0].levels[0].segmentMarks,
          `${label}: every viewer owns independent selection state`);
        assert.equal(runtime.levels[0].segmentMinX, runtimes[0].levels[0].segmentMinX,
          `${label}: viewers share prepared bounds`);
      }
      return runtimes;
    } finally {
      for (const [owner, field, array] of originals) owner[field] = array;
      // Restored literal scenes copy field references; remove probes there too
      // before the existing geometry/selection parity assertions inspect them.
      for (const runtime of runtimes) for (const level of runtime.levels) {
        for (const field of geometryFields) {
          const value = level.store.literals[field];
          if (targets.has(value)) level.store.literals[field] = targets.get(value);
        }
      }
    }
  };
  const count = 512, glyphs = 50_000;
  const scene = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .1,
    pageCount: 1, pagesPerRow: 1, pageRects: Float32Array.of(0, 0, 1000, 1000),
    pageTextRanges: Uint32Array.of(0, glyphs), bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    pageBounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    drawRuns: [{ kind: "stroke", first: 0, count }, { kind: "text", first: 0, count: glyphs }],
    textInstanceCount: glyphs, textGlyphCount: 1, textGlyphSegmentCount: 4,
    textGlyphMetaA: Float32Array.of(0, 4, 0, 0), textGlyphMetaB: Float32Array.of(1, 1, 1, 0),
    textGlyphSegmentsA: Float32Array.of(0,0,0,0, 1,0,0,0, 1,1,0,0, 0,1,0,0),
    textGlyphSegmentsB: Float32Array.of(1,0,0,0, 1,1,0,0, 0,1,0,0, 0,0,0,0)
  };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    scene.endpoints.set([i, 0, i + 1, 0], i * 4);
    scene.primitiveMeta.set([i + 1, 0, 0, 1], i * 4);
    scene.primitiveBounds.set([i, 0, i + 1, 0], i * 4);
    scene.styles.set([.1, 0, 0, 0], i * 4);
  }
  for (const key of ["textInstanceA", "textInstanceB", "textInstanceC"]) scene[key] = new Float32Array(glyphs * 4);
  for (let i = 0; i < glyphs; i++) {
    scene.textInstanceA.set([1, 0, 0, 1], i * 4);
    scene.textInstanceB.set([i % 100 * 1.1, Math.floor(i / 100) * 2, 0, 0], i * 4);
    scene.textInstanceC.set([.1, .1, .1, 1], i * 4);
  }
  scene.textInstanceA.fill(0, 0, 4); // Exact-only text uses an Infinity sentinel.
  const canonical = prepareSceneForHepRendering(scene);
  const originalVector = new vector.VectorStrokeLodRuntime(canonical);
  const originalText = await text.prebuildTextLod(canonical);
  assert(originalVector.levels.length > 1);
  assert(originalText.data);
  const options = parsePdfToHepArguments(["--with-vector-lod", "--with-text-lod", "input.pdf"]);
  assert.equal(options.withVectorLod, true); assert.equal(options.withTextLod, true);
  const args = pdfToHepWorkerArguments("input.pdf", false, 2048, undefined, undefined, undefined, false, true, true);
  assert(args.includes("--with-vector-lod") && args.includes("--with-text-lod"));
  let storedBytes;
  for (const [withVectorLod, withTextLod] of [[false, false], [true, false], [false, true], [true, true]]) {
    vector.resetVectorStrokeLodBuildTiming();
    const progress = [];
    const blob = await buildHep(canonical, { withVectorLod, withTextLod, vectorLodPrecision: "lossless", onProgress: e => progress.push(e.value) });
    assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0, "export reuses active geometry");
    assert(progress.every((v, i) => i === 0 || v >= progress[i - 1]));
    assert.equal(progress.at(-1), 1);
    const bytes = await blob.arrayBuffer();
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(Boolean(manifest.lod?.vector), withVectorLod);
    assert.equal(Boolean(manifest.lod?.text), withTextLod);
    let restoredViewers;
    const loaded = await withForbiddenWorker(async () => {
      const loaded = await loadSceneFromHep(bytes);
      if (withVectorLod) restoredViewers = await reserveWithoutGeometryReads(loaded, "v3 lossless round trip");
      return loaded;
    }, "v3 round trip");
    assert.equal(Boolean(vector.getStoredVectorStrokeLod(loaded)), withVectorLod);
    assert.equal(Boolean(text.getCachedTextLod(loaded)), withTextLod);
    if (withVectorLod) {
      assert.equal(manifest.lod.vector.version, 3);
      const disk = JSON.parse(await archive.file("lod-vector/index.json").async("string"));
      assert.equal(disk.tileIndexes, "rebuild");
      for (const level of disk.levels) for (const key of ["tileOffsets", "tileCounts", "tileSegmentIds"]) assert(!(key in level));
      const [a, b] = restoredViewers;
      assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0, "all viewers skip simplification");
      assert.notEqual(a.levels[0].segmentMarks, b.levels[0].segmentMarks);
      for (let i = 0; i < a.levels.length; i++) {
        assert.deepEqual(strokePaintOrigins(a.levels[i].scene), strokePaintOrigins(originalVector.levels[i].scene));
        for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
          assert.deepEqual(a.levels[i].scene[key], originalVector.levels[i].scene[key], key);
        }
      }
      for (const units of [.01, .5, 2, 8]) {
        for (const runtime of [a, originalVector]) {
          runtime.updateForLocalUnitsPerPixel(units);
          runtime.update({ cameraCenterX: 100, cameraCenterY: 1, zoom: 1 / units }, { width: 640, height: 480 });
        }
        assert.deepEqual(a.getStats(), originalVector.getStats());
        a.levels.forEach((level, i) => assert.deepEqual(level.visibleSegmentIds.subarray(0, level.visibleSegmentCount),
          originalVector.levels[i].visibleSegmentIds.subarray(0, originalVector.levels[i].visibleSegmentCount)));
      }
      const selected = a.levels.map(level => level.visibleSegmentIds.slice(0, level.visibleSegmentCount));
      b.updateForLocalUnitsPerPixel(8);
      b.update({ cameraCenterX: 1e6, cameraCenterY: 1e6, zoom: 1 / 8 }, { width: 640, height: 480 });
      a.levels.forEach((level, i) => assert.deepEqual(level.visibleSegmentIds.subarray(0, level.visibleSegmentCount),
        selected[i], "another viewer's selection cannot mutate the first viewer"));
    }
    if (withTextLod) {
      const result = await text.prebuildTextLod(loaded);
      assert.equal(result.buildTimeMs, 0);
      assert.deepEqual(result.data, originalText.data);
      const a = new text.TextLodRuntime(result), b = new text.TextLodRuntime(originalText);
      for (const scale of [.1, 1, 10]) {
        const update = { localToClip: createOrthographicLocalToClip(100, 100, scale, 640, 480), viewportWidth: 640, viewportHeight: 480 };
        assert.deepEqual(a.update(update).instanceIds, b.update(update).instanceIds);
      }
    }
    if (withVectorLod && withTextLod) storedBytes = bytes;
  }
  // Cross the worker threshold with a bounded scene so the no-worker assertion
  // is meaningful even when the small forced round trips would stay local.
  const denseCount = 150_000;
  const dense = { ...createEmptyVectorScene(), segmentCount: denseCount, maxHalfWidth: .1,
    pageCount: 1, pagesPerRow: 1, pageRects: Float32Array.of(0, 0, 1000, 1000),
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    pageBounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    drawRuns: [{ kind: "stroke", first: 0, count: denseCount }] };
  for (const field of geometryFields) {
    dense[field] = new Float32Array(denseCount * 4);
    for (let i = 0; i < denseCount; i++) dense[field].set(scene[field].subarray((i % count) * 4, (i % count) * 4 + 4), i * 4);
  }
  const denseCanonical = prepareSceneForHepRendering(dense);
  const denseOriginal = new vector.VectorStrokeLodRuntime(denseCanonical);
  const denseBytes = await (await buildHep(denseCanonical, { withVectorLod: true, vectorLodPrecision: "lossless" })).arrayBuffer();
  await withForbiddenWorker(async () => {
    const loaded = await loadSceneFromHep(denseBytes);
    const [restored] = await reserveWithoutGeometryReads(loaded, "worker-sized v3 round trip");
    assert.deepEqual(restored.levels[0].segmentMinX, denseOriginal.levels[0].segmentMinX);
    for (const runtime of [restored, denseOriginal]) {
      runtime.updateForLocalUnitsPerPixel(2);
      runtime.update({ cameraCenterX: 100, cameraCenterY: 1, zoom: .5 }, { width: 640, height: 480 });
    }
    assert.deepEqual(restored.getStats(), denseOriginal.getStats());
    restored.levels.forEach((level, i) => assert.deepEqual(level.visibleSegmentIds.subarray(0, level.visibleSegmentCount),
      denseOriginal.levels[i].visibleSegmentIds.subarray(0, denseOriginal.levels[i].visibleSegmentCount)));
  }, "worker-sized v3 round trip");
  // Compact positions are bounded; exact geometry, styles and clip windows stay intact.
  const { compactVectorLod, deduplicateVectorLod, packVectorLod, unpackVectorLod } =
    await import("../src/hepLodEncoding.ts");
  const snapshot = structuredClone(vector.getStoredVectorStrokeLod(canonical));
  snapshot.literals.endpoints[0] += .00071;
  snapshot.literals.primitiveMeta[0] += .00031;
  snapshot.literals.primitiveMeta[3] = 9; // Clipped stroke, retain the clip rectangle bit-for-bit.
  snapshot.literals.styles[1] = -0;
  const compact = compactVectorLod(snapshot);
  assert(compact.positionQuanta instanceof Float32Array);
  assert.equal(compactVectorLod(compact), compact, "re-export never accumulates rounding/bounds growth");
  for (const field of ["endpoints", "primitiveMeta"]) for (let i = 0; i < snapshot.literals[field].length; i++) {
    const error = Math.abs(compact.literals[field][i] - snapshot.literals[field][i]);
    assert(error <= compact.positionQuanta[Math.floor(i / 4)] / 2, `${field}[${i}] exceeds its rounding bound`);
    if (field === "primitiveMeta" && i % 4 >= 2) assert.equal(error, 0);
  }
  assert.notEqual(compact.literals.endpoints[0], snapshot.literals.endpoints[0]);
  assert.deepEqual(compact.literals.styles, snapshot.literals.styles);
  assert.deepEqual(compact.literals.primitiveBounds.subarray(0, 4), snapshot.literals.primitiveBounds.subarray(0, 4));
  for (const data of [snapshot, compact]) {
    const restored = unpackVectorLod(canonical, packVectorLod(canonical, data));
    for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
      assert.deepEqual(new Uint8Array(restored.literals[key].buffer), new Uint8Array(data.literals[key].buffer));
    }
  }
  // Duplicate records preserve order, origins, styles, and signed-zero distinctions.
  const sharedFixture = structuredClone(snapshot);
  const literalCount = sharedFixture.literals.segmentCount;
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
    const values = sharedFixture.literals[key];
    sharedFixture.literals[key] = new Float32Array(values.length * 3);
    for (let i = 0; i < 3; i++) sharedFixture.literals[key].set(values, i * values.length);
  }
  sharedFixture.literals.segmentCount *= 3;
  sharedFixture.origins = Uint32Array.from({ length: literalCount * 3 }, (_, i) =>
    i < literalCount * 2 ? snapshot.origins[i % literalCount] : (snapshot.origins[i % literalCount] + 1) % count);
  sharedFixture.levels[1].records = Uint32Array.of(count, count + literalCount, count + literalCount * 2);
  sharedFixture.levels[1].segmentCount = 3;
  const shared = deduplicateVectorLod(sharedFixture);
  assert.equal(shared.literals.segmentCount, literalCount * 2, "only identical records with identical origins are shared");
  assert.deepEqual(shared.levels[1].records, Uint32Array.of(count, count, count + literalCount));
  assert.deepEqual(shared.literals.styles.subarray(0, literalCount * 4), snapshot.literals.styles);
  assert.equal(deduplicateVectorLod(shared), shared);

  // A shared record takes the finest referencing level's precision; a coarse-only
  // record can use a larger grid. Include a negative coordinate that rounds to zero.
  const adaptive = structuredClone(sharedFixture);
  adaptive.levels = [adaptive.levels[0], { ...adaptive.levels[1], tolerance: .5, segmentCount: 1, records: Uint32Array.of(count) },
    { ...adaptive.levels[1], tolerance: 32, segmentCount: 2, records: Uint32Array.of(count, count + 1) }];
  adaptive.literals.endpoints[0] = -.0001;
  const rounded = compactVectorLod(adaptive);
  assert.equal(rounded.positionQuanta[0], 1 / 64);
  assert.equal(rounded.positionQuanta[1], 1);
  assert.equal(rounded.levels[0], adaptive.levels[0]);
  assert(rounded.levels[1].tolerance > adaptive.levels[1].tolerance, "rounding is included in the selection error budget");
  for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
    assert.deepEqual(unpackVectorLod(canonical, packVectorLod(canonical, rounded)).literals[field], rounded.literals[field]);
  }
  const huge = structuredClone(snapshot); huge.literals.endpoints[0] = 1e20;
  const savedWarn = console.warn; console.warn = () => {};
  try { assert.equal(compactVectorLod(huge), huge, "overflow falls back without modifying geometry"); }
  finally { console.warn = savedWarn; }

  const compactBlob = await buildHep(canonical, { withVectorLod: true }); // Compact is the API/CLI default.
  const compactScene = await withForbiddenWorker(async () => {
    const loaded = await loadSceneFromHep(await compactBlob.arrayBuffer());
    await reserveWithoutGeometryReads(loaded, "v3 compact round trip");
    return loaded;
  }, "v3 compact round trip");
  assert(vector.getStoredVectorStrokeLod(compactScene).positionQuanta);
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) assert.deepEqual(compactScene[key], canonical[key]);
  assert.equal(parsePdfToHepArguments(["--with-vector-lod", "--vector-lod-precision=compact", "input.pdf"]).vectorLodPrecision, "compact");
  assert.throws(() => parsePdfToHepArguments(["--vector-lod-precision=bad", "input.pdf"]), /precision/);
  assert(pdfToHepWorkerArguments("input.pdf", false, 2048, undefined, undefined, undefined, false, true, false, "compact")
    .includes("--vector-lod-precision=compact"));
  await assert.rejects(buildHep(canonical, { vectorLodPrecision: "bad" }), /vectorLodPrecision/);

  // Independent v1 fixture, including JSON's null encoding of exact-only Infinity.
  const legacy = await HepArchive.loadAsync(await (await buildHep(canonical)).arrayBuffer());
  const legacyManifest = JSON.parse(await legacy.file("manifest.json").async("string"));
  legacyManifest.lod = {};
  for (const [kind, data] of [["vector", vector.getStoredVectorStrokeLod(canonical)], ["text", originalText.data]]) {
    let index = 0;
    const prefix = `lod-${kind}`;
    legacy.file(`${prefix}/index.json`, JSON.stringify(data, (_key, value) => {
      if (!ArrayBuffer.isView(value)) return value;
      const file = `${prefix}/${index++}.bin`, bytes = new Uint8Array(value.byteLength);
      const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength), width = value.BYTES_PER_ELEMENT;
      for (let i = 0; i < value.length; i++) for (let byte = 0; byte < width; byte++) bytes[byte * value.length + i] = raw[i * width + byte];
      legacy.file(file, bytes);
      return { array: value instanceof Float64Array ? "f64" : value instanceof Float32Array ? "f32" : "u32", file, length: value.length };
    }));
    legacyManifest.lod[kind] = { version: 1, file: `${prefix}/index.json` };
  }
  legacy.file("manifest.json", JSON.stringify(legacyManifest));
  const legacyBytes = await legacy.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await withForbiddenWorker(async () => {
    const loaded = await loadSceneFromHep(legacyBytes);
    const first = new vector.VectorStrokeLodRuntime(loaded); // Legacy indexes may prepare bounds once.
    const [second] = await reserveWithoutGeometryReads(loaded, "legacy v1 adoption");
    assert.deepEqual(second.levels[0].segmentMinX, first.levels[0].segmentMinX);
  }, "legacy v1 adoption");
  vector.resetVectorStrokeLodBuildTiming();
  for (const precision of ["lossless", "compact"]) {
    const repacked = await repackHepLodBytes(legacyBytes, { vectorLodPrecision: precision });
    const restored = await loadSceneFromHep(repacked);
    const result = text.getCachedTextLod(restored);
    assert.equal(result.buildTimeMs, 0);
    assert.deepEqual(result.data, originalText.data, "legacy exact-only sentinels and text nodes survive repacking");
    assert.equal(Boolean(vector.getStoredVectorStrokeLod(restored).positionQuanta), precision === "compact");
    assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0, "repack must not build LODs");
  }

  const v2 = await HepArchive.loadAsync(legacyBytes);
  const v2Manifest = JSON.parse(await v2.file("manifest.json").async("string"));
  const legacyPacked = packVectorLod(canonical, vector.getStoredVectorStrokeLod(canonical), true);
  let v2Index = 0;
  v2.file("lod-vector/index.json", JSON.stringify(legacyPacked, (_key, value) => {
    if (!ArrayBuffer.isView(value)) return value;
    const file = `lod-vector/${v2Index++}.bin`, raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < value.length; i++) for (let c = 0; c < value.BYTES_PER_ELEMENT; c++) bytes[c * value.length + i] = raw[i * value.BYTES_PER_ELEMENT + c];
    v2.file(file, bytes);
    return { array: value instanceof Float64Array ? "f64" : value instanceof Float32Array ? "f32" : "u32", file, length: value.length };
  }));
  v2Manifest.lod.vector.version = 2;
  v2.file("manifest.json", JSON.stringify(v2Manifest));
  const v2Bytes = await v2.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const v2Scene = await withForbiddenWorker(async () => {
    const loaded = await loadSceneFromHep(v2Bytes);
    const first = new vector.VectorStrokeLodRuntime(loaded);
    const [second] = await reserveWithoutGeometryReads(loaded, "legacy v2 adoption");
    assert.deepEqual(second.levels[0].segmentMinX, first.levels[0].segmentMinX);
    return loaded;
  }, "legacy v2 adoption");
  const v2Expected = structuredClone(vector.getStoredVectorStrokeLod(canonical));
  for (const level of v2Expected.levels) for (const key of ["overview", "records"]) if (level[key] === undefined) delete level[key];
  assert.deepEqual(vector.getStoredVectorStrokeLod(v2Scene), v2Expected);
  const upgraded = await repackHepLodBytes(v2Bytes); // Compact is also the repacker default.
  assert.deepEqual(await repackHepLodBytes(upgraded, { vectorLodPrecision: "compact" }), upgraded, "v3 repacking is idempotent");
  assert(vector.getStoredVectorStrokeLod(await loadSceneFromHep(upgraded)).positionQuanta);

  // Rebuilding indexes yields to the event loop and cancels without installing a partial cache.
  const interrupted = new AbortController();
  interrupted.abort();
  await assert.rejects(vector.rebuildStoredVectorStrokeLodIndexes(canonical, snapshot, interrupted.signal), { name: "AbortError" });
  const duringRebuild = new AbortController();
  const abortTimer = setTimeout(() => duringRebuild.abort(), 0);
  try { await assert.rejects(vector.rebuildStoredVectorStrokeLodIndexes(canonical, snapshot, duringRebuild.signal)); }
  finally { clearTimeout(abortTimer); }
  const reindexed = await vector.rebuildStoredVectorStrokeLodIndexes(canonical, vector.getStoredVectorStrokeLod(canonical));
  assert.deepEqual(reindexed, vector.getStoredVectorStrokeLod(canonical), "lossless reconstruction reproduces all buckets");

  const directory = await mkdtemp(path.join(tmpdir(), "hep-lod-repack-"));
  try {
    const input = path.join(directory, "fixture.hep");
    await writeFile(input, legacyBytes);
    const run = promisify(execFile);
    const args = ["scripts/repack-hep-lods.mjs", input];
    await run(process.execPath, args);
    assert.deepEqual(new Uint8Array(await readFile(input)), legacyBytes, "measurement never changes the input");
    await run(process.execPath, [args[0], "--write", ...args.slice(1)]);
    const written = await readFile(input);
    assert(written.length < legacyBytes.length);
    const saved = await loadSceneFromHep(written);
    assert(vector.getStoredVectorStrokeLod(saved).positionQuanta);
  } finally { await rm(directory, { recursive: true, force: true }); }

  // Unprepared API scenes must generate against the same quantized canonical
  // geometry the reader sees. Empty pages must not discard a valid text cache.
  const mixed = { ...scene, pageCount: 2,
    pageRects: Float32Array.of(0, 0, 1000, 1000, 1000, 0, 2000, 1000),
    pageTextRanges: Uint32Array.of(0, glyphs, glyphs, 0) };
  vector.resetVectorStrokeLodBuildTiming();
  const buildProgress = [];
  const generated = await buildHep(mixed, { withVectorLod: true, withTextLod: true,
    onProgress: e => buildProgress.push(e) });
  assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 1);
  assert(buildProgress.some(e => e.stage === "vector-lod" && e.value > 0 && e.value < 1));
  assert(buildProgress.every((e, i) => i === 0 || e.value >= buildProgress[i - 1].value));
  const reloaded = await loadSceneFromHep(await generated.arrayBuffer());
  assert(text.getCachedTextLod(reloaded)?.data, "an empty second page preserves the text cache");
  assert(vector.getStoredVectorStrokeLod(reloaded));
  await buildHep(reloaded, { withVectorLod: true, withTextLod: true });
  assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0, "re-export reuses loaded caches");
  assert.equal(await vector.prebuildVectorStrokeLodRuntime(reloaded, "off", "webgl"), null);

  // Independently reject stale/invalid sections, retain the other cache and canonical scene.
  const warnings = [], warn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    for (const corruption of ["version", "records", "indexes", "precision", "text"]) {
      const archive = await HepArchive.loadAsync(storedBytes);
      if (corruption === "version") {
        const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
        manifest.lod.vector.version = 0;
        archive.file("manifest.json", JSON.stringify(manifest));
      } else {
        const path = corruption === "text" ? "lod-text/index.json" : "lod-vector/index.json";
        const index = JSON.parse(await archive.file(path).async("string"));
        if (corruption === "text") index.clusters.count = -1;
        else if (corruption === "indexes") delete index.tileIndexes;
        else if (corruption === "precision") index.positionQuanta = index.origins; // Wrong array type.
        else index.levels[1].records.length = 0xffffffff;
        archive.file(path, JSON.stringify(index));
      }
      const loaded = await loadSceneFromHep(await (await archive.generateAsync({ type: "blob", compression: "STORE" })).arrayBuffer());
      assert.equal(loaded.segmentCount, count);
      assert.equal(Boolean(vector.getStoredVectorStrokeLod(loaded)), corruption === "text");
      assert.equal(Boolean(text.getCachedTextLod(loaded)), corruption !== "text");
      if (corruption !== "text") {
        vector.resetVectorStrokeLodBuildTiming();
        await vector.prebuildVectorStrokeLodRuntime(loaded, "force", "webgl");
        assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 1);
      } else assert((await text.prebuildTextLod(loaded)).data);
    }
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 5);
  assert(warnings.every(message => /Regenerate/.test(message)));
  const empty = await buildHep(createEmptyVectorScene(), { withVectorLod: true, withTextLod: true });
  const emptyArchive = await HepArchive.loadAsync(await empty.arrayBuffer());
  assert.equal(JSON.parse(await emptyArchive.file("manifest.json").async("string")).lod, undefined);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildHep(canonical, { withVectorLod: true, signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(buildHep(canonical, { withVectorLod: "yes" }), /boolean/);
  console.log("HEP LOD: v3 shared geometry, adaptive precision, reconstructed indexes, legacy compatibility, selection parity, corruption, and cancellation passed.");
} finally { hooks.deregister(); }
