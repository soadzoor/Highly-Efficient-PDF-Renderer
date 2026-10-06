// Synthetic scenes only: no PDF conversion, corpus assets, or servers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { createLoadProgressReporter } from "../src/loadProgress.ts";
import { registerHooks } from "node:module";
import { HepArchive, hasHepSignature } from "../src/hepContainer.ts";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  await testPdfColorOptionForwarding();
  const builder = await import("../src/hepBuilder.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { loadSceneFromHep, prepareSceneForHepRendering } = await import("../src/hep.ts");
  const { VectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
  await testOrderedLodRoundTrip(builder, loadSceneFromHep, prepareSceneForHepRendering, VectorStrokeLodRuntime);
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
  console.log("HEP API passed: native formats, source forms, clean API break, progress, and cancellation.");
} finally {
  hooks.deregister();
}

async function testPdfColorOptionForwarding() {
  const source = await readFile(new URL("../src/hepBuilder.ts", import.meta.url), "utf8");
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
}
