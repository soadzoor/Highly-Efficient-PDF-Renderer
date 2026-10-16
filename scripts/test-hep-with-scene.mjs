// Synthetic scenes and a tiny generated PDF only; no corpus, browser or server.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const sessions = [];
try {
  const { buildHep, buildHepWithScene } = await import("../src/hepBuilder.ts");
  const { openDocumentSession } = await import("../src/documentSession.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { prepareSceneForHepRendering } = await import("../src/hepShared.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const vector = await import("../src/vectorStrokeLodCore.ts");
  const text = await import("../src/textLodCore.ts");
  const source = combinedScene(createEmptyVectorScene());
  vector.resetVectorStrokeLodBuildTiming();
  const events = [];
  const result = await buildHepWithScene(source, { compression: "store", onProgress: event => events.push(event) });
  assert(result.blob instanceof Blob);
  assert.equal(result.blob.type, "application/x-hep");
  assert.notEqual(result.scene, source, "return the writer's prepared scene, where the LOD caches live");
  assert.equal(prepareSceneForHepRendering(result.scene), result.scene, "canonical preparation is preserved");
  assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 1, "build the vector hierarchy once");
  const stored = vector.getStoredVectorStrokeLod(result.scene);
  assert(stored?.levels.length > 1);
  assert(stored.levels.every(level => level.tileOffsets.length > 0 && level.tileCounts.length > 0),
    "retained geometry has the spatial indexes omitted by blob-only export");
  const cachedText = text.getCachedTextLod(result.scene);
  assert(cachedText?.data, "retain eligible text LOD, including coarse text geometry");
  const runtime = new vector.VectorStrokeLodRuntime(result.scene);
  assert(runtime.levels.length > 1);
  assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0, "viewer adoption does not simplify again");
  assert.equal(text.getOrBuildTextLod(result.scene), cachedText, "viewer text preparation reuses the same cache");
  assert(events.every((event, index) => index === 0 || event.value >= events[index - 1].value));
  assert.equal(events.at(-1).value, 1);

  // The returned canonical data matches a real reload, but is already usable
  // before that reload. Archive decoding is used only as a parity reference.
  const decoded = await loadSceneFromHep(await result.blob.arrayBuffer());
  for (const key of ["endpoints", "primitiveMeta", "styles", "textInstanceA", "textInstanceB", "textInstanceC", "pageRects"]) {
    assert.deepEqual(result.scene[key], decoded[key], `returned canonical ${key} matches the HEP`);
  }
  const again = await buildHepWithScene(result.scene, { compression: "store" });
  assert.equal(again.scene, result.scene, "an already prepared scene keeps its cache identity");
  assert.equal(vector.getStoredVectorStrokeLod(again.scene), stored);
  assert.equal(text.getCachedTextLod(again.scene), cachedText);
  assert.equal(vector.consumeVectorStrokeLodBuildTiming().buildCount, 0);

  const viewerScene = prepareSceneForHepRendering(combinedScene(createEmptyVectorScene()));
  const existingRuntime = new vector.VectorStrokeLodRuntime(viewerScene);
  assert(existingRuntime.levels.length > 1);
  assert.equal(vector.hasStoredVectorStrokeLod(viewerScene), false);
  const fromViewer = await buildHepWithScene(viewerScene, { compression: "store" });
  assert.equal(fromViewer.scene, viewerScene);
  assert(vector.hasStoredVectorStrokeLod(fromViewer.scene),
    "a retained scene keeps geometry independently of the original viewer's weak runtime reference");

  const noLod = await buildHepWithScene(combinedScene(createEmptyVectorScene()), {
    compression: "store", withVectorLod: false, withTextLod: false
  });
  assert.equal(vector.getStoredVectorStrokeLod(noLod.scene), null);
  assert.equal(text.getCachedTextLod(noLod.scene), null, "explicit LOD opt-outs stay effective");
  const noLodArchive = await HepArchive.loadAsync(await noLod.blob.arrayBuffer());
  assert.equal(JSON.parse(await noLodArchive.file("manifest.json").async("string")).lod, undefined);

  const pdf = rasterPdf(), original = pdf.slice();
  const oneShot = await buildHepWithScene(pdf, { compression: "store" });
  assert.deepEqual(pdf, original, "caller PDF bytes remain attached and unchanged");
  assert.equal(oneShot.scene.pageCount, 2);
  assert.equal(oneShot.scene.sourcePdfByteLength, pdf.byteLength);
  assertPixels(oneShot.scene);
  const session = await openDocumentSession(pdf); sessions.push(session);
  await session.renderThumbnail({ maxDimension: 16, backend: "canvas2d", format: "png" });
  // A prior streaming export must not leave placeholders in a later viewer result.
  assert((await session.buildHep({ compression: "store" })) instanceof Blob);
  const progress = [];
  const retained = await session.buildHepWithScene({ compression: "store", pages: "2", maxPagesPerRow: 1,
    onProgress: event => progress.push(event) });
  assert.equal(retained.scene.pageCount, 1, "selection applies to both artifacts");
  assert.equal(retained.scene.sourcePdfByteLength, pdf.byteLength, "returned session scenes retain PDF provenance for re-export");
  assert.equal(progress.filter(event => event.stage === "pdf-page").length, 1, "compile each selected page once");
  assert.equal(progress.find(event => event.stage === "pdf-page").sourcePageIndex, 1);
  assert(progress.every((event, index) => index === 0 || event.value >= progress[index - 1].value));
  assert.equal(progress.at(-1).value, 1);
  await session.close();
  assertPixels(retained.scene);
  assert(vector.getStoredVectorStrokeLod(retained.scene), "closing the parser does not drop returned LOD data");
  const reexported = await buildHep(retained.scene, { compression: "store" });
  assert(reexported.size > 0, "returned scenes remain usable after close");
  await assert.rejects(session.buildHepWithScene(), error => error.code === "closed");

  const hepSession = await openDocumentSession(oneShot.blob); sessions.push(hepSession);
  const fromHep = await hepSession.buildHepWithScene({ compression: "store" });
  await hepSession.close();
  assert.equal(fromHep.scene.pageCount, 2);
  assertPixels(fromHep.scene, false);

  const live = await openDocumentSession(pdf); sessions.push(live);
  await assert.rejects(live.buildHepWithScene({ password: "changed" }), /fixed when opening/);
  await assert.rejects(live.buildHepWithScene({ maxPagesPerRow: 0 }), RangeError);
  await assert.rejects(buildHepWithScene(source, { compression: "gzip" }), /compression must be/);
  const cancelled = new AbortController(), reason = Error("generation cancelled"); cancelled.abort(reason);
  await assert.rejects(buildHepWithScene(pdf, { signal: cancelled.signal }), error => error === reason);
  await assert.rejects(live.buildHepWithScene({ signal: cancelled.signal }), error => error === reason);
  const late = new AbortController();
  await assert.rejects(live.buildHepWithScene({ compression: "store", signal: late.signal,
    onProgress(event) { if (event.value === 1) late.abort(reason); } }), error => error === reason);
  assertPixels((await live.buildHepWithScene({ compression: "store" })).scene);
  const closing = await openDocumentSession(pdf); sessions.push(closing);
  let closePending;
  await assert.rejects(closing.buildHepWithScene({
    onProgress(event) { if (event.stage === "pdf-page") closePending = closing.close(); }
  }), /closed/i);
  await closePending;
  console.log("HEP with scene: full-quality pixels, scene identity, LOD reuse, selection, lifetime and cancellation passed.");
} finally {
  await Promise.all(sessions.map(session => session.close()));
  hooks.deregister();
}

function assertPixels(scene, exact = true) {
  assert(scene.rasterLayers.length > 0);
  for (const layer of scene.rasterLayers) {
    assert.equal(layer.data.length, layer.width * layer.height * 4, "renderable pixels replace export placeholders");
    if (exact) assert.deepEqual([...layer.data.subarray(0, 8)], [0, 17, 34, 255, 51, 68, 85, 255],
      "retain original pixels without an image encoding/decoding round trip");
  }
}

function rasterPdf() {
  const pixels = Uint8Array.from({ length: 240 * 180 * 3 }, (_, index) => index * 17 & 255);
  const resources = "/Resources << /XObject << /Im1 6 0 R >> >>";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] ${resources} /Contents 5 0 R >>` },
    { number: 4, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] ${resources} /Contents 5 0 R >>` },
    { number: 5, body: tinyPdfStream("", "q 240 0 0 180 10 10 cm /Im1 Do Q 1 w 10 300 m 200 400 l S") },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 240 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8", pixels) }
  ] });
}

function combinedScene(empty) {
  const count = 512, glyphs = 50_000;
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const scene = { ...empty, segmentCount: count, maxHalfWidth: .1, pageCount: 1,
    pageRects: Float32Array.of(0, 0, 1000, 1000), pageTextRanges: Uint32Array.of(0, glyphs), bounds, pageBounds: bounds,
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
  return scene;
}
