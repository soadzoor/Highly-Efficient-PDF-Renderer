import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { OptionalContentController } = await import("../src/optionalContent.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter, pdfNameValue } = await import("../src/pdf/nativeWriter.ts");
  const { createNativeOptionalContentRegistry } = await import("../src/pdf/nativeOptionalContent.ts");
  const { importEditorPdfPage } = await import("../src/editorNativePdf.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const bytes = fixture(), originalBytes = bytes.slice();
  const read = async (bytes, index = 0) => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { return { scene: await parser.compileVectorPage(index, { optimization: "none", vectorFallback: "error" }),
      page: await parser.compilePage(index, { optimization: "none", retainOptionalContent: true }) }; }
    finally { await parser.close(); }
  };
  async function sample(input, values) {
    let page = input.page;
    if (input.scene.optionalContent) {
      // Lock and radio metadata are checked separately; these comparisons
      // exercise every Boolean state of the retained visibility expression.
      const layers = { ...input.scene.optionalContent, radioGroups: [], groups: input.scene.optionalContent.groups.map(group => ({ ...group, locked: false, usedInView: true })) };
      const controller = new OptionalContentController({ ...input.scene, optionalContent: layers });
      try {
        if (values) await controller.setLayerVisibilities(layers.groups.map(group => ({ id: group.id, visible: values[group.name] ?? group.defaultVisible })));
        const defaults = controller.getSnapshot().conditions.slice(0, page.stores.optionalContent.defaultVisible.length);
        page = { ...page, stores: { ...page.stores, optionalContent: { ...page.stores.optionalContent, defaultVisible: defaults } } };
      } finally { controller.dispose(); }
    }
    page = { ...page, displayProgram: { ...page.displayProgram, groups: page.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
    const rendered = await renderHeprPageToCanvas2d(page, { scale: 1, background: [1, 1, 1, 1], surfaceFactory(width, height) {
      const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
    } });
    const data = rendered.surface.context.getImageData(0, 0, rendered.width, rendered.height).data;
    return (x, y) => Array.from(data.subarray(((rendered.height - 1 - y) * rendered.width + x) * 4, ((rendered.height - 1 - y) * rendered.width + x) * 4 + 4));
  }
  const before = await read(bytes);
  assert.equal(before.scene.fillPathCount, 4, "the hidden layer remains canonical vector geometry");
  const hep = await buildHep(before.scene, { withVectorLod: false, withTextLod: false, encodeRasterImages: false });
  const hepScene = await loadSceneFromHep(await hep.arrayBuffer());
  const pdf = new Uint8Array(await (await writeScenePdf(hepScene)).arrayBuffer()), after = await read(pdf);
  assert.equal(after.scene.fillPathCount, 4, "HEP-to-PDF retains default-hidden geometry");
  assert.deepEqual(after.scene.optionalContent.groups.map(group => [group.name, group.defaultVisible]), [["A", true], ["B", false]]);
  assert(after.scene.optionalContent.groups.find(group => group.name === "B").locked);
  assert.equal(after.scene.optionalContent.radioGroups.length, 1);
  assert.equal(after.scene.optionalContent.order[0].kind, "label");
  for (const values of [{ A: true, B: false }, { A: false, B: true }, { A: true, B: true }, { A: false, B: false }]) {
    const source = await sample(before, values), saved = await sample(after, values);
    for (const [x, y] of [[20, 20], [50, 20], [80, 20], [15, 65]]) assert.deepEqual(saved(x, y), source(x, y), `HEP-to-PDF layer state ${JSON.stringify(values)} at ${x},${y}`);
    assert.deepEqual(saved(20, 20), values.A ? [255, 0, 0, 255] : [255, 255, 255, 255]);
    assert.deepEqual(saved(50, 20), values.B ? [0, 0, 255, 255] : [255, 255, 255, 255]);
    assert.deepEqual(saved(80, 20), values.A && !values.B ? [0, 255, 0, 255] : [255, 255, 255, 255], "nested A and Not B survives as an OCMD visibility expression");
  }
  const flattened = await read(new Uint8Array(await (await writeScenePdf(hepScene, { flatten: true })).arrayBuffer()));
  assert.equal(flattened.scene.fillPathCount, 3, "flattening omits hidden geometry");
  assert.equal(flattened.scene.optionalContent?.groups.length ?? 0, 0);
  const flatPixels = await sample(flattened), defaultPixels = await sample(before);
  for (const [x, y] of [[20, 20], [50, 20], [80, 20]]) assert.deepEqual(flatPixels(x, y), defaultPixels(x, y));

  // Imported Form resources must register the exact same imported OCG refs
  // in the destination catalog, retaining pending form/catalog writes.
  const renameId = id => `foreign:${id}`;
  const renameOrder = node => ({ ...node, ...(node.groupId ? { groupId: renameId(node.groupId) } : {}), ...(node.children ? { children: node.children.map(renameOrder) } : {}) });
  const foreignScene = { ...hepScene, optionalContent: { ...hepScene.optionalContent,
    groups: hepScene.optionalContent.groups.map(group => ({ ...group, id: renameId(group.id) })),
    conditions: hepScene.optionalContent.conditions.map(condition => condition.kind === "group" ? { ...condition, groupId: renameId(condition.groupId) } : condition),
    order: hepScene.optionalContent.order.map(renameOrder), radioGroups: hepScene.optionalContent.radioGroups.map(group => group.map(renameId)) } };
  const foreignPdf = new Uint8Array(await (await writeScenePdf(foreignScene)).arrayBuffer());
  const destination = await NativePdfDocument.open({ kind: "bytes", bytes: fixture({ design: true }) });
  let mergedBytes;
  try {
    const writer = new NativePdfWriter(destination), root = destination.getWriterState().xref.trailers[0].get("Root");
    const catalog = new Map(destination.catalog); catalog.set("PageMode", pdfNameValue("UseOC"));
    catalog.set("AcroForm", new Map([["Fields", []], ["NeedAppearances", false]])); writer.set(root, catalog);
    await importEditorPdfPage(foreignPdf, writer); mergedBytes = await writer.save();
  } finally { await destination.close(); }
  const merged = await NativePdfDocument.open({ kind: "bytes", bytes: mergedBytes }, { repair: "off" });
  try {
    const registry = await createNativeOptionalContentRegistry(merged), groups = registry.listGroups();
    assert.deepEqual(groups.map(group => [group.name, group.defaultVisible]), [["A", true], ["B", false], ["A", true], ["B", false]], "imported visible groups explicitly remain ON under destination BaseState OFF");
    assert.equal(merged.catalog.get("PageMode").value, "UseOC", "pending catalog entries survive imported layers");
    assert.equal((await merged.resolveDictionary(merged.catalog.get("AcroForm"))).get("NeedAppearances"), false);
    const properties = await merged.resolveDictionary(merged.catalog.get("OCProperties")), defaults = await merged.resolveDictionary(properties.get("D"));
    for (const ref of properties.get("OCGs")) {
      const intent = (await merged.resolveDictionary(ref)).get("Intent");
      assert((Array.isArray(intent) ? intent : [intent]).some(name => name?.value === "Design"), "unmatched imports participate in the destination Design intent");
    }
    assert.equal(defaults.get("BaseState").value, "OFF");
    assert.equal(defaults.get("Locked").length, 2); assert.equal(defaults.get("RBGroups").length, 2);
  } finally { await merged.close(); }

  const editor = await openEditorSession(before.scene, { sourcePdf: bytes });
  try {
    editor.selectPrimitives([{ kind: "fill", index: 0 }]); editor.transformSelection([1, 0, 0, 1, 5, 0]);
    const rebuilt = await read(new Uint8Array(await (await editor.savePdf()).arrayBuffer()));
    assert(rebuilt.scene.optionalContent.groups.filter(group => group.name === "B").every(group => !group.defaultVisible));
    const defaults = await sample(rebuilt); assert.deepEqual(defaults(12, 20), [255, 255, 255, 255]);
    assert.deepEqual(defaults(32, 20), [255, 0, 0, 255]); assert.deepEqual(defaults(50, 20), [255, 255, 255, 255]);
    const toggled = await sample(rebuilt, { A: false, B: true });
    assert.deepEqual(toggled(32, 20), [255, 255, 255, 255]); assert.deepEqual(toggled(50, 20), [0, 0, 255, 255]);
    assert.deepEqual(toggled(80, 20), [255, 255, 255, 255]);
  } finally { editor.dispose(); }

  const sharedBytes = fixture({ twoPages: true }), first = await read(sharedBytes), second = await read(sharedBytes, 1);
  const sharedEditor = await openEditorSession(composeVectorScenesInGrid([first.scene, second.scene], 1), { sourcePdf: sharedBytes });
  try {
    sharedEditor.selectPrimitives([{ kind: "fill", index: 0 }]); sharedEditor.transformSelection([1, 0, 0, 1, 5, 0]);
    const saved = new Uint8Array(await (await sharedEditor.savePdf()).arrayBuffer());
    for (const index of [0, 1]) {
      const page = await read(saved, index);
      assert.deepEqual(page.scene.optionalContent.groups.map(group => [group.name, group.defaultVisible]), [["A", true], ["B", false]], "rebuilt and untouched pages share the original global groups");
      const defaults = await sample(page), toggled = await sample(page, { A: false, B: true });
      assert.deepEqual(defaults(20, 20), [255, 0, 0, 255]); assert.deepEqual(defaults(50, 20), [255, 255, 255, 255]);
      assert.deepEqual(toggled(20, 20), [255, 255, 255, 255]); assert.deepEqual(toggled(50, 20), [0, 0, 255, 255]);
    }
    const parsed = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
    try {
      const properties = await parsed.resolveDictionary(parsed.catalog.get("OCProperties")), defaults = await parsed.resolveDictionary(properties.get("D"));
      assert.equal(properties.get("OCGs").length, 2); assert.equal(defaults.get("Locked").length, 1); assert.equal(defaults.get("RBGroups").length, 1);
    } finally { await parsed.close(); }
  } finally { sharedEditor.dispose(); }
  assert.deepEqual(bytes, originalBytes);
  console.log("PDF layers: HEP round trip, nested visibility expressions, flattening, native catalog imports and edited-source toggles passed.");
} finally { hooks.deregister(); }

function fixture({ design = false, twoPages = false } = {}) {
  const intent = design ? " /Intent /Design" : "";
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /BaseState /OFF /ON [5 0 R] /OFF [6 0 R] /Order [[(Layers) 5 0 R 6 0 R]] /Locked [6 0 R] /RBGroups [[5 0 R 6 0 R]]${intent} >> >> >>` },
    { number: 2, body: `<< /Type /Pages /Count ${twoPages ? 2 : 1} /Kids [3 0 R${twoPages ? " 8 0 R" : ""}] >>` },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Properties << /A 5 0 R /B 6 0 R /Both 7 0 R >> >> >>" },
    { number: 4, body: tinyPdfStream("", "/OC /A BDC 1 0 0 rg 10 10 20 20 re f EMC /OC /B BDC 0 0 1 rg 40 10 20 20 re f EMC /OC /Both BDC 0 1 0 rg 70 10 20 20 re f EMC 0 0 0 rg 10 60 10 10 re f") },
    { number: 5, body: `<< /Type /OCG /Name (A)${intent} >>` }, { number: 6, body: `<< /Type /OCG /Name (B)${intent} >>` },
    { number: 7, body: "<< /Type /OCMD /OCGs [5 0 R 6 0 R] /VE [/And 5 0 R [/Not 6 0 R]] >>" },
    ...(twoPages ? [{ number: 8, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Properties << /A 5 0 R /B 6 0 R /Both 7 0 R >> >> >>" }] : [])
  ] });
}
