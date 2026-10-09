// Tagged-PDF attribution: MCID content items, structure elements and user properties.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(s, c, next) {
  return c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? next(`${s}.ts`, c) : next(s, c);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { getScenePrimitive, getPrimitiveMarkedContent } = await import("../src/scenePrimitives.ts");
  const { findStructureElement, validateSceneStructure } = await import("../src/structureData.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { readHepStructure, writeHepStructure } = await import("../src/hepStructure.ts");

  const compile = async (bytes, pageIndex = 0) => {
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      return { scene: await session.compileVectorPage(pageIndex, {}), page: await session.compilePage(pageIndex, {}),
        diagnostics: session.getDiagnostics() };
    } finally { await session.close(); }
  };
  const itemOf = (scene, kind, index) => getScenePrimitive(scene, { kind, index }).markedContent;

  // The integrator's sample: two walls and a door, each an MCID; the border is an artifact.
  const { scene, page, diagnostics } = await compile(bimSample());
  validateSceneStructure(scene);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(scene.markedContent.items, [
    { pageIndex: 0, sourcePageIndex: 0, mcid: 0, tag: "Figure", elementId: "ref:7:0" },
    { pageIndex: 0, sourcePageIndex: 0, mcid: 1, tag: "Figure", elementId: "ref:8:0" },
    { pageIndex: 0, sourcePageIndex: 0, mcid: 2, tag: "Figure", elementId: "ref:9:0" }]);
  assert.equal(itemOf(scene, "fill", 0).mcid, 0, "load-bearing wall");
  assert.equal(itemOf(scene, "fill", 1).mcid, 1, "partition");
  assert.equal(scene.segmentCount, 9);
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => itemOf(scene, "stroke", index)?.mcid),
    [undefined, undefined, undefined, undefined, 2, 2, 2, 2, 2], "the artifact border has no item; the door's line and arc do");
  assert.deepEqual(getPrimitiveMarkedContent(scene, { kind: "fill", index: 0 }), scene.markedContent.items[0]);
  assert.equal(scene.drawRuns.filter(run => run.kind === "fill").length, 1, "attribution never splits draw runs");
  const wall = findStructureElement(scene, itemOf(scene, "fill", 0).elementId);
  assert.deepEqual(wall, { id: "ref:7:0", type: "Figure", parentId: "ref:6:0", alt: "Mur", userProperties: [
    { name: "IfcGuid", value: "202Fr$t4X7Zf8NOew3FLOH" }, { name: "IfcType", value: "IfcWall" },
    { name: "Nom", value: "Mur porteur 20 cm" }, { name: "Materiau", value: "Beton arme" }] });
  assert.deepEqual(findStructureElement(scene, "ref:6:0"), { id: "ref:6:0", type: "Document" }, "ancestors are included");
  assert.deepEqual(findStructureElement(scene, itemOf(scene, "stroke", 6).elementId).userProperties[1], { name: "IfcType", value: "IfcDoor" });
  assert.deepEqual(scene.structureElements.map(element => element.id), ["ref:7:0", "ref:8:0", "ref:9:0", "ref:6:0"]);

  // Cancelling the first structure read must not poison later page compilations.
  const cancelled = await openPdf({ kind: "bytes", bytes: bimSample() });
  try {
    const controller = new AbortController(), document = cancelled.document;
    const root = document.catalog.get("StructTreeRoot"), resolveValue = document.resolveValue.bind(document);
    let rootReads = 0;
    // Abort precisely when the lazy structure reader first resolves the root.
    document.resolveValue = async (value, signal) => {
      if (value === root && ++rootReads === 1) controller.abort();
      return resolveValue(value, signal);
    };
    await assert.rejects(cancelled.compileVectorPage(0, { signal: controller.signal }), error => error.code === "aborted");
    for (let retry = 0; retry < 2; retry++) {
      const recovered = await cancelled.compileVectorPage(0, { signal: new AbortController().signal });
      assert.deepEqual(recovered.markedContent, scene.markedContent);
      assert.deepEqual(recovered.structureElements, scene.structureElements);
    }
    assert.equal(rootReads, 2, "the cancelled root is retried, then the successful result stays cached");
  } finally { await cancelled.close(); }

  // The retained lowering attributes only the page's own marked content, and only when told where it ends.
  assert.equal((await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal })).markedContent, undefined);
  const retained = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal,
    pageMarkedContentCount: page.stores.markedContent.tags.length });
  assert.deepEqual(retained.markedContent.items.map(item => item.mcid), [0, 1, 2]);
  assert.deepEqual([0, 1, 2, 3].map(index => itemOf(retained, "fill", index)?.mcid), [undefined, 0, 1, 2]);

  // HEP keeps the attribution and the elements.
  for (const compression of ["store", "deflate"]) {
    const loaded = await loadSceneFromHep(new Uint8Array(await (await buildHep(scene, { compression })).arrayBuffer()));
    assert.deepEqual(loaded.markedContent, scene.markedContent);
    assert.deepEqual(loaded.structureElements, scene.structureElements);
    assert.equal(itemOf(loaded, "stroke", 8).elementId, "ref:9:0");
  }
  const archive = new HepArchive(), descriptor = writeHepStructure(archive, scene);
  assert.deepEqual(descriptor, { file: "structure/structure.json", rangesFile: "structure/content-ranges.varint", version: 1,
    itemCount: 3, elementCount: 4, rangeCount: 3 });
  const target = () => ({ ...scene, markedContent: undefined, structureElements: undefined });
  await assert.rejects(readHepStructure(archive, { ...descriptor, itemCount: 2 }, target()), /manifest/);
  await assert.rejects(readHepStructure(archive, { ...descriptor, version: 2 }, target()), /descriptor/);
  await assert.rejects(readHepStructure(archive, descriptor, { ...target(), fillPathCount: 1 }), /ranges/);
  await assert.rejects(readHepStructure(new HepArchive(), descriptor, target()), /Missing/);
  await readHepStructure(archive, undefined, target());
  const truncated = new HepArchive();
  truncated.file(descriptor.file, await archive.file(descriptor.file).async("uint8array"));
  truncated.file(descriptor.rangesFile, Uint8Array.of(255,255,255,255,15));
  await assert.rejects(readHepStructure(truncated, { ...descriptor, rangeCount: 0xffffffff }, target()), /ranges/,
    "declared counts must fit actual range bytes before allocating");

  // Composition shifts primitives, items and page slots; element ids are shared.
  const composed = composeVectorScenesInGrid([scene, scene], 2);
  validateSceneStructure(composed);
  assert.deepEqual(composed.markedContent.items.map(item => [item.pageIndex, item.mcid]), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
  assert.equal(itemOf(composed, "fill", 3).mcid, 1);
  assert.equal(itemOf(composed, "fill", 3).pageIndex, 1);
  assert.equal(itemOf(composed, "stroke", 17).mcid, 2);
  assert.equal(composed.structureElements.length, 4);

  // A Form painted inside an item belongs to it; the Form's own MCIDs are not attributed.
  const form = await compile(formSample());
  validateSceneStructure(form.scene);
  assert.deepEqual([0, 1].map(index => itemOf(form.scene, "fill", index)?.mcid), [4, undefined]);
  assert.equal(itemOf(form.scene, "fill", 0).elementId, "ref:21:0");
  assert(form.diagnostics.some(d => d.code === "structure.form-content-items"));

  // Lexical BMC parents and invocation parents both preserve the innermost page MCID.
  for (const retained of [false, true]) {
    const nested = await compile(nestedSample(retained));
    validateSceneStructure(nested.scene);
    assert.equal(nested.scene.rasterLayers.length, 0);
    assert.deepEqual(Array.from({ length: nested.scene.fillPathCount }, (_, index) => itemOf(nested.scene, "fill", index)?.mcid),
      [0, 1, 0, 0, undefined], `${retained ? "retained" : "direct"}: nested tags preserve page items and Form-local MCIDs stay ignored`);
    assert.equal(itemOf(nested.scene, "fill", 0).elementId, "ref:7:0");
    assert.equal(itemOf(nested.scene, "fill", 1).elementId, "ref:8:0");
    assert(nested.diagnostics.some(d => d.code === "structure.form-content-items"));
  }

  // Number-tree kids, role maps, attribute classes, titles and typed values.
  const rich = await compile(richSample());
  const element = findStructureElement(rich.scene, itemOf(rich.scene, "fill", 0).elementId);
  assert.deepEqual(element, { id: "ref:30:0", type: "Mur", standardType: "Figure", title: "Wall A", actualText: "Wall",
    userProperties: [{ name: "Fire", value: "REI 60" }, { name: "Width", value: 0.2, formattedValue: "20 cm" },
      { name: "Structural", value: true, hidden: true }, { name: "Kind", value: "Exterior" }, { name: "Nested", value: null }] });

  // Untagged content carries nothing; broken structure keeps the MCIDs and says why.
  const untagged = await compile(writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }, { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Span BMC 0 g 10 10 20 20 re f EMC") }] }));
  assert.equal(untagged.scene.markedContent, undefined);
  assert.equal(untagged.scene.structureElements, undefined);
  const broken = await compile(bimSample({ parentTree: "<< /Nums [0 42] >>" }));
  assert.deepEqual(broken.scene.markedContent.items.map(item => [item.mcid, item.elementId]), [[0, undefined], [1, undefined], [2, undefined]]);
  assert(broken.diagnostics.some(d => d.code === "structure.invalid"));
  console.log("Structure content: MCID attribution, structure elements, user properties, forms, retained pages, composition and HEP passed.");
} finally { hooks.deregister(); }

function userProperties(guid, type, name, material) {
  return `/A << /O /UserProperties /P [<< /N (IfcGuid) /V (${guid}) >> << /N (IfcType) /V (${type}) >> ` +
    `<< /N (Nom) /V (${name}) >>${material ? ` << /N (Materiau) /V (${material}) >>` : ""}] >>`;
}

/** Reconstruction of the integrator's hepr-mcid-bim-sample.pdf. */
function bimSample({ parentTree = "<< /Nums [0 [7 0 R 8 0 R 9 0 R]] >>" } = {}) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /StructParents 0 /Resources << >> >>" },
    { number: 4, body: tinyPdfStream("", ["/Artifact BMC", "0.8 0.8 0.8 RG 0.5 w 20 20 802 555 re S", "EMC",
      "/Figure <</MCID 0>> BDC", "0.6 g 100 400 400 20 re f", "EMC",
      "/Figure <</MCID 1>> BDC", "0.6 g 480 150 20 270 re f", "EMC",
      "/Figure <</MCID 2>> BDC", "0 0 1 RG 1.5 w 300 400 m 300 340 l S", "300 400 m 336 400 360 376 360 340 c S", "EMC"].join("\n")) },
    { number: 5, body: "<< /Type /StructTreeRoot /K 6 0 R /ParentTree 10 0 R /ParentTreeNextKey 1 >>" },
    { number: 6, body: "<< /Type /StructElem /S /Document /P 5 0 R /K [7 0 R 8 0 R 9 0 R] >>" },
    { number: 7, body: `<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 0 /Alt (Mur) ${userProperties("202Fr$t4X7Zf8NOew3FLOH", "IfcWall", "Mur porteur 20 cm", "Beton arme")} >>` },
    { number: 8, body: `<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 1 /Alt (Mur) ${userProperties("1hOSvn6df7F8_7GcBWlRGQ", "IfcWall", "Cloison 7 cm", "Platre")} >>` },
    { number: 9, body: `<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 2 /Alt (Porte) ${userProperties("3cUkl32yn9qRSPvBJVyWYp", "IfcDoor", "Porte 90x210")} >>` },
    { number: 10, body: parentTree }
  ] });
}

function formSample() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /StructParents 0 " +
      "/Resources << /XObject << /Fm 11 0 R /Tagged 12 0 R >> >> >>" },
    { number: 4, body: tinyPdfStream("", "/Figure <</MCID 4>> BDC /Fm Do EMC /Tagged Do") },
    { number: 5, body: "<< /Type /StructTreeRoot /K 21 0 R /ParentTree 10 0 R >>" },
    { number: 10, body: "<< /Nums [0 [null null null null 21 0 R]] >>" },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100]", "0 g 10 10 20 20 re f") },
    { number: 12, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /StructParents 1",
      "/P <</MCID 0>> BDC 0 g 50 50 20 20 re f EMC") },
    { number: 21, body: "<< /Type /StructElem /S /Figure /P 5 0 R /K 4 >>" }
  ] });
}

function richSample() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /StructParents 7 >>" },
    { number: 4, body: tinyPdfStream("", "/Mur <</MCID 0>> BDC 0 g 10 10 20 20 re f EMC") },
    { number: 5, body: "<< /Type /StructTreeRoot /K 30 0 R /ParentTree 10 0 R /RoleMap << /Mur /Wall /Wall /Figure >> " +
      "/ClassMap << /Fire << /O /UserProperties /P [<< /N (Fire) /V (REI 60) >>] >> >> >>" },
    { number: 10, body: "<< /Kids [11 0 R 12 0 R] >>" },
    { number: 11, body: "<< /Limits [0 3] /Nums [0 [] 3 []] >>" },
    { number: 12, body: "<< /Limits [5 9] /Nums [7 [30 0 R]] >>" },
    { number: 30, body: "<< /Type /StructElem /S /Mur /P 5 0 R /K 0 /T (Wall A) /ActualText <feff00570061006c006c> /C /Fire " +
      "/A [<< /O /UserProperties /P [<< /N (Width) /V .2 /F (20 cm) >> << /N (Structural) /V true /H true >> " +
      "<< /N (Kind) /V /Exterior >> << /N (Nested) /V [1 2] >>] >> 0] >>" }
  ] });
}

function nestedSample(retained) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /StructParents 0 " +
      "/Resources << /ExtGState << /GS << /BM /Screen >> >> /XObject << /Fm 9 0 R >> >> >>" },
    { number: 4, body: tinyPdfStream("", [retained ? "/GS gs" : "", "/Figure <</MCID 0>> BDC /Span BMC",
      "0.5 g 0 0 10 10 re f", "/Figure <</MCID 1>> BDC /Span BMC 20 0 10 10 re f EMC EMC",
      "40 0 10 10 re f", "/Fm Do", "EMC EMC", "/Fm Do"].join("\n")) },
    { number: 5, body: "<< /Type /StructTreeRoot /ParentTree << /Nums [0 [7 0 R 8 0 R]] >> >>" },
    { number: 7, body: "<< /Type /StructElem /S /Figure /P 5 0 R /K 0 >>" },
    { number: 8, body: "<< /Type /StructElem /S /Figure /P 5 0 R /K 1 >>" },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /StructParents 1",
      "/Figure <</MCID 2>> BDC /Span BMC 0.5 g 60 0 10 10 re f EMC EMC") }
  ] });
}
