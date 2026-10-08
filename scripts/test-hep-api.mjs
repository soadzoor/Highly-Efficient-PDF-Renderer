// Synthetic scenes only: no PDF conversion, corpus assets, or servers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { createLoadProgressReporter } from "../src/loadProgress.ts";
import { registerHooks } from "node:module";
import { HepArchive, hasHepSignature } from "./lib/hepContainer.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  await testPdfColorOptionForwarding();
  await testPdfSizeBudgetForwarding();
  const builder = await import("../src/hepBuilder.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { loadSceneFromHep, prepareSceneForHepRendering } = await import("../src/hep.ts");
  const { VectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
  const importController = new AbortController();
  const importReason = new Error("cancel while loading HEP builder");
  const importEvents = [];
  const coldBuild = builder.buildHep(composeVectorScenesInGrid([], 1), {
    compression: "store", signal: importController.signal,
    onProgress: event => importEvents.push(event)
  });
  importController.abort(importReason);
  await assert.rejects(coldBuild, error => error === importReason);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(importEvents, [], "cancelled imports must not start HEP generation");
  const orderedScene = await testOrderedLodRoundTrip(builder, loadSceneFromHep, prepareSceneForHepRendering, VectorStrokeLodRuntime);
  await testSizeBudget(builder, orderedScene, loadSceneFromHep);
  await testOptionalCacheRemoval();
  assert.equal(builder.buildParsedDataZip, undefined, "the old builder has no compatibility alias");
  const scene = composeVectorScenesInGrid([], 1);
  for (const compression of ["store", "deflate"]) {
    const events = [];
    const blob = await builder.buildHep(scene, {
      compression, sourceLabel: "synthetic.pdf", onProgress: event => events.push(event)
    });
    assert.equal(blob.type, "application/x-hep");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert(hasHepSignature(bytes));
    assert(events.some(event => event.stage === "hep-build"));
    assert.equal(events.at(-1).value, 1);
    for (let i = 1; i < events.length; i++) assert(events[i].value >= events[i - 1].value);

    const base64 = Buffer.from(bytes).toString("base64");
    for (const source of [bytes, bytes.buffer, blob,
      new File([bytes], "synthetic.hep"), base64, `data:application/x-hep;base64,${base64}`]) {
      const loadEvents = [];
      const loaded = await loadPdfSceneFromSource(source, { onProgress: event => loadEvents.push(event) });
      assert.equal(loaded.sourceKind, "hep");
      assert.equal(loaded.scene.segmentCount, 0);
      assert.equal(loaded.scene.textInstanceCount, 0);
      assert.equal(loadEvents.at(-1).value, 1);
      assert(loadEvents.some(event => event.sourceType === "hep"));
      assert(loadEvents.every(event => !event.stage.startsWith("zip-") && event.sourceType !== "zip"));
    }
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(bytes, { headers: { "content-type": "application/x-hep" } });
      assert.equal((await loadPdfSceneFromSource("https://example.invalid/document.hep")).sourceKind, "hep");
    } finally {
      globalThis.fetch = originalFetch;
    }
    await assert.rejects(loadPdfSceneFromSource(bytes, { sourceKind: "parsed-zip" }), /sourceKind/);
  }

  for (const compression of ["store", "deflate"]) {
    for (const compressionLevel of [undefined, 0, 6, 9]) {
      await assert.rejects(builder.buildHep(scene, { compression, compressionLevel }),
        /compressionLevel is no longer supported/);
    }
  }
  await assert.rejects(builder.buildHep(scene, { compression: "gzip" }), /compression must be/);
  await assert.rejects(builder.buildHep(scene, { sourcePdf: new Uint8Array() }), /no longer supported/);
  await assert.rejects(builder.buildHep(scene, { sourcePdfPages: "1" }), /no longer supported/);
  await assert.rejects(builder.buildHep({ ...scene, drawRuns: [{ kind: "raster", first: 0, count: 1 }] }), /raster|drawRun|draw run/i);
  for (const stage of ["hep-build", "complete"]) {
    const lateController = new AbortController();
    const lateReason = new Error(`cancel at ${stage}`);
    await assert.rejects(builder.buildHep(scene, {
      compression: "store", signal: lateController.signal,
      onProgress: event => {
        if (event.stage === stage && event.value === 1) lateController.abort(lateReason);
      }
    }), error => error === lateReason);
  }
  const legacy = Uint8Array.of(0x50, 0x4b, 3, 4);
  for (const source of [legacy, Buffer.from(legacy).toString("base64"),
    `data:application/zip;base64,${Buffer.from(legacy).toString("base64")}`,
    new File([legacy], "legacy.hep"), new File([legacy], "legacy.zip")]) {
    await assert.rejects(loadPdfSceneFromSource(source), /repack-heps\.mjs/);
  }

  const fallback = new HepArchive();
  // The source is only a signature fixture, never passed to a PDF parser.
  fallback.file("source/source.pdf", "%PDF-synthetic-source");
  fallback.file("manifest.json", JSON.stringify({ formatVersion: 6, sourcePdfFile: "source/source.pdf" }));
  const fallbackBytes = await fallback.generateAsync({ type: "uint8array" });
  await assert.rejects(loadSceneFromHep(fallbackBytes), /format v6 is not supported/);
  const controller = new AbortController();
  const reason = new Error("cancel HEP load");
  controller.abort(reason);
  await assert.rejects(loadSceneFromHep(fallbackBytes, { signal: controller.signal }), error => error === reason);
  await assert.rejects(builder.buildHep(scene, { signal: controller.signal }), error => error === reason);
  console.log("HEP API passed: native formats, source forms, size budgets, progress, and cancellation.");
} finally {
  hooks.deregister();
}

async function testPdfColorOptionForwarding() {
  const source = await readFile(new URL("../src/hepBuilderRuntime.ts", import.meta.url), "utf8");
  const stopBeforeConversion = new Error("stop after checking PDF loader options");
  for (const iccEngine of [undefined, "qcms", "lcms", "alternate", "none"]) {
    const iccTransformResolver = () => {};
    const imageCodecResolver = () => {};
    const onDiagnostic = () => {};
    const context = vm.createContext({
      createLoadProgressReporter,
      loadPdfSceneFromSource: async (_source, options) => {
        assert.equal(options.iccEngine, iccEngine);
        assert.equal(options.iccTransformResolver, iccTransformResolver);
        assert.equal(options.imageCodecResolver, imageCodecResolver);
        assert.equal(options.onDiagnostic, onDiagnostic);
        throw stopBeforeConversion;
      }
    });
    vm.runInContext(sourceFunction(source, "buildHepFromPdf"), context);
    await assert.rejects(context.buildHepFromPdf(new Uint8Array(), {
      iccEngine, iccTransformResolver, imageCodecResolver, onDiagnostic
    }), error => error === stopBeforeConversion);
  }
}

async function testPdfSizeBudgetForwarding() {
  const source = await readFile(new URL("../src/hepBuilderRuntime.ts", import.meta.url), "utf8");
  for (const requestedBudget of [undefined, 1, 999_999]) {
    const context = vm.createContext({
      createLoadProgressReporter,
      loadPdfSceneFromSource: async () => ({ scene: {}, sourceKind: "pdf", sourceLabel: "source.pdf", sourceBytes: new Uint8Array(4096) }),
      listSceneRasterLayers: () => [],
      normalizeSourceLabel: (_value, fallback) => fallback,
      buildSceneHep: async (_scene, _label, _raster, options) => {
        assert.equal(options.sourcePdfByteLength, 4096, "the actual loaded PDF determines its size budget");
        return "mock HEP";
      }
    });
    vm.runInContext(sourceFunction(source, "buildHepFromPdf"), context);
    assert.equal(await context.buildHepFromPdf(new Uint8Array(), { sourcePdfByteLength: requestedBudget }), "mock HEP");
  }
  for (const requestedBudget of [undefined, 8192]) {
    const scene = { sourcePdfByteLength: 16_384 };
    const context = vm.createContext({
      createLoadProgressReporter,
      loadPdfSceneFromSource: async () => ({ scene, sourceKind: "hep", sourceLabel: "source.hep", sourceBytes: new Uint8Array(4096) }),
      listSceneRasterLayers: () => [],
      normalizeSourceLabel: (_value, fallback) => fallback,
      buildSceneHep: async (loadedScene, _label, _raster, options) => {
        assert.equal(loadedScene.sourcePdfByteLength, 16_384, "HEP input retains its original PDF provenance");
        assert.equal(options.sourcePdfByteLength, requestedBudget, "HEP bytes are never mistaken for the original PDF length");
        return "mock HEP";
      }
    });
    vm.runInContext(sourceFunction(source, "buildHepFromPdf"), context);
    assert.equal(await context.buildHepFromPdf(new Uint8Array(), { sourcePdfByteLength: requestedBudget }), "mock HEP");
  }
}

async function testSizeBudget(builder, scene, loadScene) {
  for (const value of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1000", null]) {
    await assert.rejects(builder.buildHep(scene, { sourcePdfByteLength: value }),
      error => error instanceof RangeError && /positive safe integer/.test(error.message));
  }
  const options = { compression: "store", sourceLabel: "size-budget.pdf", sourcePdfByteLength: 1_000_000 };
  const base = await builder.buildHep(scene, options);
  const fitting = await builder.buildHep(scene, { ...options, sourcePdfByteLength: base.size + 256 });
  const fittingArchive = await HepArchive.loadAsync(new Uint8Array(await fitting.arrayBuffer()));
  const fittingManifest = JSON.parse(await fittingArchive.file("manifest.json").async("string"));
  assert.equal(fittingManifest.sourcePdfByteLength, base.size + 256, "source size is retained in the manifest");
  assert(fitting.size < fittingManifest.sourcePdfByteLength);
  const reopened = await loadScene(new Uint8Array(await fitting.arrayBuffer()));
  assert.equal(reopened.sourcePdfByteLength, fittingManifest.sourcePdfByteLength, "loading restores the original PDF budget");
  const reexported = await builder.buildHep(reopened, options);
  const reexportedArchive = await HepArchive.loadAsync(new Uint8Array(await reexported.arrayBuffer()));
  const reexportedManifest = JSON.parse(await reexportedArchive.file("manifest.json").async("string"));
  assert.equal(reexportedManifest.sourcePdfByteLength, fittingManifest.sourcePdfByteLength,
    "re-export cannot replace a recorded budget with a larger one");
  for (const value of [0, -1, .5, null, "1000", Number.MAX_SAFE_INTEGER + 1]) {
    fittingArchive.file("manifest.json", JSON.stringify({ ...fittingManifest, sourcePdfByteLength: value }));
    const malformed = await fittingArchive.generateAsync({ type: "uint8array", compression: "STORE" });
    await assert.rejects(loadScene(malformed), /source PDF byte length|sourcePdfByteLength|source PDF.*size/i,
      "malformed persisted source lengths are rejected");
  }
  await assert.rejects(builder.buildHep(scene, { ...options, sourcePdfByteLength: fitting.size }),
    error => error instanceof RangeError && /is not smaller/.test(error.message), "equal-size exports fail");
  await assert.rejects(builder.buildHep(scene, { ...options, sourcePdfByteLength: fitting.size - 1 }),
    /is not smaller/, "oversized canonical exports fail without dropping content");
  await assert.rejects(builder.buildHep({ ...scene, sourcePdfByteLength: fitting.size }, options),
    /is not smaller/, "an explicit option cannot increase the recorded original PDF budget");

  const withLod = await builder.buildHep(scene, { ...options, withVectorLod: true });
  assert(withLod.size > base.size + 512, "the fixture has optional LOD data to omit");
  const budget = Math.floor((withLod.size + base.size) / 2);
  const events = [], warnings = [];
  const originalWarn = console.warn;
  try {
    console.warn = message => warnings.push(message);
    const limited = await builder.buildHep(scene, { ...options, sourcePdfByteLength: budget,
      withVectorLod: true, onProgress: event => events.push(event) });
    assert(limited.size < budget);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Omitted stored LOD caches/);
    const bytes = new Uint8Array(await limited.arrayBuffer());
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(manifest.lod, undefined);
    assert.equal(manifest.sourcePdfByteLength, budget);
    assert(!Object.keys(archive.files).some(name => name.startsWith("lod-")));
    const loaded = await loadScene(bytes);
    for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles", "drawRuns", "clipPaths"]) {
      assert.deepEqual(loaded[field], scene[field], `omitting caches preserves canonical ${field}`);
    }
    assert.equal(events.at(-1).value, 1);
    assert(events.every((event, index) => index === 0 || event.value >= events[index - 1].value));
    assert.equal(events.filter(event => event.stage === "hep-build" && event.value === 1).length, 1,
      "progress completes only after the final archive passes its budget");

    const controller = new AbortController();
    const reason = new Error("cancel between budget attempts");
    console.warn = () => controller.abort(reason);
    await assert.rejects(builder.buildHep(scene, { ...options, sourcePdfByteLength: budget,
      withVectorLod: true, signal: controller.signal }), error => error === reason);
  } finally {
    console.warn = originalWarn;
  }
}

async function testOptionalCacheRemoval() {
  const { omitHepLodForSizeBudget } = await import("../src/hepSizePolicy.ts");
  const archive = new HepArchive();
  archive.file("geometry/canonical.bin", Uint8Array.of(1, 2, 3));
  archive.file("lod-vector/index.json", "{}");
  archive.file("lod-text/index.json", "{}");
  const manifest = { sourceFile: "cache-budget.pdf", sourcePdfByteLength: 1000,
    lod: { vector: { file: "lod-vector/index.json" }, text: { file: "lod-text/index.json" } } };
  archive.file("manifest.json", JSON.stringify(manifest));
  assert.equal(omitHepLodForSizeBudget(archive, manifest, 999, 1000), false);
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    assert.equal(omitHepLodForSizeBudget(archive, manifest, 1000, 1000), true);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(archive.file("lod-vector/index.json"), null);
  assert.equal(archive.file("lod-text/index.json"), null);
  assert.equal(manifest.lod, undefined);
  assert.equal(JSON.parse(await archive.file("manifest.json").async("string")).lod, undefined);
  assert.deepEqual(await archive.file("geometry/canonical.bin").async("uint8array"), Uint8Array.of(1, 2, 3));
  assert.equal(omitHepLodForSizeBudget(archive, manifest, 1000, 1000), false);
}

async function testOrderedLodRoundTrip(builder, loadScene, prepareScene, Runtime) {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const count = 2048;
  const scene = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .1,
    pageCount: 1, pagesPerRow: 1, pageRects: Float32Array.of(0, 0, 100, 100),
    pageTextRanges: Uint32Array.of(0, 0), bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    drawRuns: [{ kind: "stroke", first: 0, count: count / 2 }, { kind: "stroke", first: count / 2, count: count / 2, clipIndex: 0 }],
    clipPaths: [{ parent: -1, fillRule: 0, edges: Float32Array.of(0, 0, 100, 0, 100, 0, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0) }]
  };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x = i % 32 * 2.8, y = Math.floor(i / 32) * 1.4;
    scene.endpoints.set([x, y, x + 2.2, y], i * 4);
    scene.primitiveMeta.set([x + 2.2, y, 0, 9], i * 4);
    scene.primitiveBounds.set([0, 0, 100, 100], i * 4);
    scene.styles.set([.1, 0, 0, 0], i * 4);
  }
  const pdf = prepareScene(scene);
  const hep = await loadScene(await (await builder.buildHep(pdf, { compression: "store" })).arrayBuffer());
  const fields = ["endpoints", "primitiveMeta", "primitiveBounds", "styles", "drawRuns", "clipPaths"];
  for (const key of fields) assert.deepEqual(hep[key], pdf[key], `HEP preserves ordered ${key}`);
  const a = new Runtime(pdf), b = new Runtime(hep);
  assert.deepEqual(a.levels.map(l => [l.tolerance, l.segmentCount]), b.levels.map(l => [l.tolerance, l.segmentCount]));
  for (const units of [.01, .5, 2, 8]) {
    for (const runtime of [a, b]) {
      runtime.updateForLocalUnitsPerPixel(units);
      runtime.update({ cameraCenterX: 50, cameraCenterY: 50, zoom: 1 / units }, { width: 640, height: 480 });
    }
    assert.deepEqual(a.getStats(), b.getStats(), `PDF/HEP choose identical LOD at ${units} units/pixel`);
    for (let level = 0; level < a.levels.length; level++) {
      const left = a.levels[level], right = b.levels[level];
      for (const key of fields.slice(0, 4)) assert.deepEqual(left.scene[key], right.scene[key]);
      assert.deepEqual(left.visibleSegmentIds.subarray(0, left.visibleSegmentCount),
        right.visibleSegmentIds.subarray(0, right.visibleSegmentCount));
    }
  }
  return pdf;
}
