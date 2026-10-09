// Synthetic scene round trips only: no PDF conversion or generated files.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, next) {
  return c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? next(`${s}.ts`, c) : next(s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { readHepAnnotations, writeHepAnnotations } = await import("../src/hepAnnotations.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { validateAnnotations, validateScenePdfPages } = await import("../src/annotationData.ts");
  const scene = { ...createEmptyVectorScene(), pageCount: 1, pageRects: Float32Array.of(0, 0, 100, 100),
    pdfPages: [{ pageIndex: 0, sourcePageIndex: 3, pdfToScene: [0, -2, 2, 0, -40, 120] }],
    pageTextRanges: Uint32Array.of(0, 0), optionalContent: { groups: [], conditions: [{ kind: "constant", value: true }], order: [], radioGroups: [] },
    annotations: [{ id: "ref:7:0", sourcePageIndex: 3, pageIndex: 0, annotationIndex: 0, subtype: "Ink", flags: 0,
      visibleInDefaultView: true, hasAppearance: true, optionalContent: 0, contents: "Café 📝",
      pdfGeometry: { rect: [10, 20, 30, 40], inkList: [[10, 20, 30, 40]] },
      bounds: { minX: 10, minY: 20, maxX: 30, maxY: 40 }, inkList: [[10, 20, 30, 40]],
      action: { type: "GoTo", destination: { name: "Elsewhere", sourcePageIndex: 9, fit: "XYZ", parameters: [null, 4, null] } } }] };
  for (const compression of ["store", "deflate"]) {
    const blob = await buildHep(scene, { compression });
    const loaded = await loadSceneFromHep(new Uint8Array(await blob.arrayBuffer()));
    assert.deepEqual(loaded.annotations, scene.annotations);
    assert.deepEqual(loaded.pdfPages, scene.pdfPages);
    const previous = { ...scene }; delete previous.pdfPages;
    const previousBlob = await buildHep(previous, { compression });
    const previousLoaded = await loadSceneFromHep(new Uint8Array(await previousBlob.arrayBuffer()));
    assert.deepEqual(previousLoaded.annotations, scene.annotations);
    assert.equal(previousLoaded.pdfPages, undefined);
    const old = { ...scene }; delete old.annotations; delete old.pdfPages;
    const oldBlob = await buildHep(old, { compression });
    assert.deepEqual((await loadSceneFromHep(new Uint8Array(await oldBlob.arrayBuffer()))).annotations, []);
  }
  const combined = composeVectorScenesInGrid([scene, { ...scene, annotations: scene.annotations.map(a => ({ ...a, id: "ref:8:0", sourcePageIndex: 4 })) }], 2);
  assert.equal(combined.annotations[1].pageIndex, 1);
  assert.equal(combined.annotations[1].optionalContent, 1, "layer conditions are remapped during composition");
  validateAnnotations(combined.annotations, { pageCount: 2, conditionCount: 2 });
  const archive = new HepArchive(), descriptor = writeHepAnnotations(archive, scene);
  await assert.rejects(readHepAnnotations(archive, { ...descriptor, count: 99 }, scene), /annotations.*manifest/);
  await assert.rejects(readHepAnnotations(archive, { ...descriptor, file: "wrong.json" }, scene), /descriptor/);
  await assert.rejects(readHepAnnotations(new HepArchive(), descriptor, scene), /Missing/);
  await assert.rejects(readHepAnnotations(archive, descriptor, scene, AbortSignal.abort()));
  for (const update of [{ pageIndex: 4 }, { optionalContent: 99 }, { bounds: { minX: 4, minY: 0, maxX: 1, maxY: 1 } },
    { quadPoints: [0, 0, 2, 2] }, { opacity: Infinity }, { contents: {} }, { action: { type: "GoTo", destination: { parameters: ["bad"] } } }]) {
    assert.throws(() => validateAnnotations([{ ...scene.annotations[0], ...update }], { pageCount: 1, conditionCount: 1 }), /annotation/);
  }
  for (const pdfPages of [null, [null], [{ ...scene.pdfPages[0], pageIndex: 1 }], [...scene.pdfPages, ...scene.pdfPages],
    [{ ...scene.pdfPages[0], pdfToScene: [0, 0, 0, 0, 0, 0] }], [{ ...scene.pdfPages[0], sourcePageIndex: -1 }]]) {
    assert.throws(() => validateScenePdfPages(pdfPages, 1), /page mapping/);
  }
  assert.equal(combined.pdfPages[1].pageIndex, 1);
  assert.equal(combined.pdfPages[1].pdfToScene[4] - scene.pdfPages[0].pdfToScene[4], combined.pageRects[4]);
  for (const pdfToScene of [[1, 0, 0, 1, null, 0], [1, 0, 0, 1, 0]]) {
    archive.file(descriptor.file, new TextEncoder().encode(JSON.stringify({ version: 1, annotations: scene.annotations,
      pdfPages: [{ ...scene.pdfPages[0], pdfToScene }] })));
    await assert.rejects(readHepAnnotations(archive, descriptor, scene), /page mapping/);
  }
  const cyclic = { type: "Named" }; cyclic.next = [cyclic];
  assert.throws(() => validateAnnotations([{ ...scene.annotations[0], action: cyclic }], { pageCount: 1, conditionCount: 1 }), /annotation/);
  let action = { type: "Named", name: "LastPage" };
  for (let depth = 0; depth < 70; depth++) action = { type: "Named", next: [action] };
  const deepScene = { ...scene, annotations: [{ ...scene.annotations[0], action }] };
  const deepBlob = await buildHep(deepScene, { compression: "store" });
  const deepLoaded = await loadSceneFromHep(new Uint8Array(await deepBlob.arrayBuffer()));
  assert.deepEqual(deepLoaded.annotations, deepScene.annotations, "valid action chains beyond the former nesting limit round trip");
  console.log("HEP annotation sections: round trips, older files, placement, layers, corruption and cancellation passed.");
} finally { hooks.deregister(); }
