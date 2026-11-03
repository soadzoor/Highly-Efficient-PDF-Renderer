import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  const { decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const compile = async bytes => {
    const document = await openPdf({ kind: "bytes", bytes });
    try {
      const pages = []; for (let index = 0; index < document.info.pageCount; index++) pages.push(await document.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true }));
      return composeVectorScenesInGrid(pages, 1);
    } finally { await document.close(); }
  };
  const save = async (editor, options) => new Uint8Array(await (await editor.savePdf(options)).arrayBuffer());
  async function pixels(bytes) {
    const document = await openPdf({ kind: "bytes", bytes });
    try {
      const page = await document.compilePage(0, { optimization: "none" });
      const rgb = { ...page, displayProgram: { ...page.displayProgram,
        groups: page.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
      const result = await renderHeprPageToCanvas2d(rgb, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      return (x, y) => [...result.surface.context.getImageData(x * 2, (100 - y) * 2, 1, 1).data];
    } finally { await document.close(); }
  }
  async function inspect(bytes) {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      const annotations = await document.resolveValue(document.getPage(0).dictionary.get("Annots"));
      const ids = [];
      for (const value of Array.isArray(annotations) ? annotations : []) {
        const dictionary = await document.resolveDictionary(value), name = dictionary.get("NM");
        ids.push(name ? decodePdfString(name, 0, 0) : "");
      }
      return { ids, contents: await document.getDecodedPageContents(0), second: document.pages.length > 1 ? await document.getDecodedPageContents(1) : undefined };
    } finally { await document.close(); }
  }
  async function pageBody(bytes) {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      const writer = new NativePdfWriter(document), page = document.getPage(0), dictionary = new Map(page.dictionary);
      dictionary.delete("Annots"); writer.set(page.ref, dictionary); return await writer.save();
    } finally { await document.close(); }
  }
  const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], green = [0, 255, 0, 255];
  const sourceBytes = fixture("/OC /A BDC 1 0 0 rg 10 10 60 60 re f 0 0 1 rg 25 25 60 60 re f 0 1 0 rg 40 40 50 50 re f EMC");
  const source = await openEditorSession(await compile(sourceBytes), { sourcePdf: sourceBytes });
  try {
    source.selectPrimitives([{ kind: "fill", index: 0 }]);
    for (const [action, near, center] of [["bring-forward", red, green], ["bring-to-front", red, red],
      ["send-backward", red, green], ["send-to-back", blue, green]]) {
      source.reorderSelection(action);
      const exported = await save(source), sample = await pixels(exported);
      assert.deepEqual(sample(30, 30), near, `${action}: native PDF source order at first overlap`);
      assert.deepEqual(sample(50, 50), center, `${action}: native PDF source order at common overlap`);
      assert.deepEqual((await inspect(exported)).second, (await inspect(sourceBytes)).second, "unaffected source pages keep original operations");
    }
    source.reorderSelection("bring-to-front");
    const saved = await save(source), reopened = await openEditorSession(await compile(saved), { sourcePdf: saved });
    try {
      const alpha = reopened.getLayers().find(layer => layer.name === "A").id;
      assert.equal(reopened.getLayerObjects(alpha).length, 3, "saved/reopened original paints retain ordinary OCG membership");
      assert.deepEqual((await pixels(await save(reopened)))(50, 50), red, "native source order survives another save");
    } finally { reopened.dispose(); }
    const hep = await loadSceneFromHep(await (await source.saveHep()).arrayBuffer());
    assert.deepEqual((await pixels(new Uint8Array(await (await writeScenePdf(hep)).arrayBuffer())))(50, 50), red,
      "within-layer order is baked into normal HEP paint data");
  } finally { source.dispose(); }

  let annotatedExport;
  const blank = fixture("q Q"), authored = await openEditorSession(await compile(blank), { sourcePdf: blank });
  try {
    const a = authored.getLayers().find(layer => layer.name === "A").id;
    const b = authored.getLayers().find(layer => layer.name === "B").id;
    const shape = (id, color, layerId) => authored.addObject({ id, kind: "shape", shape: "rectangle", pageIndex: 0,
      x: 10, y: 10, width: 60, height: 60, color, fill: color, strokeWidth: 0, layerId });
    const first = shape("red", "red", a), fixed = shape("fixed-other-layer", "#00ff00", b), last = shape("blue", "blue", a);
    authored.select([last]); authored.reorderSelection("send-to-back");
    const exported = await save(authored), data = await inspect(exported);
    assert.deepEqual(data.ids, [last, fixed, first], "native Annots obey within-layer order and keep another layer's slot fixed");
    assert.deepEqual(data.contents, (await inspect(blank)).contents, "authored-only arranging leaves original page drawing streams untouched");
    assert.deepEqual((await pixels(exported))(40, 40), red);
    authored.reorderSelection("bring-to-front");
    annotatedExport = await save(authored);
    assert.deepEqual((await inspect(annotatedExport)).ids, [first, fixed, last]);
  } finally { authored.dispose(); }

  const annotatedScene = await compile(annotatedExport), hepAnnotated = await openEditorSession(annotatedScene);
  try {
    const redFill = Array.from({ length: annotatedScene.fillPathCount }, (_, index) => ({ kind: "fill", index })).find(ref => {
      const color = getScenePrimitive(annotatedScene, ref).color; return color[0] === 1 && color[1] === 0 && color[2] === 0;
    });
    hepAnnotated.selectPrimitives([redFill]); hepAnnotated.reorderSelection("bring-to-front");
    const exported = await save(hepAnnotated);
    assert.deepEqual((await pixels(exported))(40, 40), red, "HEP-origin annotation appearances become ordinary retained page graphics without being dropped on rebuild");
    assert((await compile(exported)).fillPathCount >= 3, "HEP-origin appearances retain every object's vector fill");
  } finally { hepAnnotated.dispose(); }

  const mixedBytes = fixture("/OC /A BDC 1 0 0 rg 10 10 60 60 re f EMC 0 0 1 rg 25 25 60 60 re f"), mixed = await openEditorSession(await compile(mixedBytes), { sourcePdf: mixedBytes });
  try {
    const a = mixed.getLayers().find(layer => layer.name === "A").id;
    const added = mixed.addObject({ id: "authored-front", kind: "shape", shape: "rectangle", pageIndex: 0,
      x: 40, y: 40, width: 50, height: 50, color: "#00ff00", fill: "#00ff00", strokeWidth: 0, layerId: a });
    mixed.select([added]); mixed.reorderSelection("send-to-back");
    const warnings = [], diagnostics = [], exported = await save(mixed, { onWarning: message => warnings.push(message), onDiagnostic: value => diagnostics.push(value) });
    assert.deepEqual((await pixels(await pageBody(exported)))(50, 50), red,
      "source-body projection retains an unlayered crossing caused by an authored layer slot");
    assert.deepEqual((await pixels(exported))(50, 50), green, "editable standard annotations still paint in their separate PDF plane");
    assert(diagnostics.some(value => value.code === "editor.pdf-layer-stacking")); assert(warnings.some(value => /flattened/i.test(value)));
    assert.deepEqual((await pixels(await save(mixed, { flatten: true })))(50, 50), red, "flattened copy preserves complete mixed source/authored stacking");
  } finally { mixed.dispose(); }

  const globalBytes = fixture("/OC /A BDC 1 0 0 rg 10 10 60 60 re f EMC 0 0 1 rg 25 25 60 60 re f"), global = await openEditorSession(await compile(globalBytes), { sourcePdf: globalBytes });
  try {
    const a = global.getLayers().find(layer => layer.name === "A").id, b = global.getLayers().find(layer => layer.name === "B").id;
    global.addObject({ id: "global-authored", kind: "shape", shape: "rectangle", pageIndex: 0,
      x: 40, y: 40, width: 50, height: 50, color: "#00ff00", fill: "#00ff00", strokeWidth: 0, layerId: b });
    global.setLayerOrder([{ kind: "group", groupId: b }, { kind: "group", groupId: a }]);
    global.setLayerOrder([{ kind: "group", groupId: a }, { kind: "group", groupId: b }]);
    assert(!global.getLayerEdits().objectOrderChanged, "this regression changes only global layer order");
    const exported = await save(global);
    assert.deepEqual((await pixels(await pageBody(exported)))(50, 50), red,
      "global-only layer restacking projects the full authored slot before filtering page body paints");
    assert.deepEqual((await pixels(await save(global, { flatten: true })))(50, 50), red);
  } finally { global.dispose(); }

  const globalAnnotationsBytes = fixture("/OC /A BDC 1 1 0 rg 10 10 60 60 re f EMC"), globalAnnotations = await openEditorSession(await compile(globalAnnotationsBytes), { sourcePdf: globalAnnotationsBytes });
  try {
    const a = globalAnnotations.getLayers().find(layer => layer.name === "A").id, b = globalAnnotations.getLayers().find(layer => layer.name === "B").id;
    const c = globalAnnotations.createLayer({ name: "Middle" });
    for (const [id, fill, layerId] of [["layer-back", "red", b], ["unlayered", "blue", null], ["layer-middle", "#00ff00", c]]) {
      globalAnnotations.addObject({ id, kind: "shape", shape: "rectangle", pageIndex: 0,
        x: 10, y: 10, width: 60, height: 60, color: fill, fill, strokeWidth: 0, layerId });
    }
    globalAnnotations.setLayerOrder([{ kind: "group", groupId: a }, { kind: "group", groupId: c }, { kind: "group", groupId: b }]);
    const exported = await save(globalAnnotations);
    assert.deepEqual((await inspect(exported)).ids, ["layer-back", "layer-middle", "unlayered"],
      "global-only /Annots order projects the full schedule rather than sorting annotation-only layer slots");
    assert.deepEqual((await pixels(exported))(50, 50), blue);
    assert.deepEqual((await pixels(await save(globalAnnotations, { flatten: true })))(50, 50), [255, 255, 0, 255]);
  } finally { globalAnnotations.dispose(); }
  console.log("PDF within-layer object order: all commands, source preservation, Annots slots, mixed-plane diagnostics, flatten and HEP passed.");
} finally { hooks.deregister(); }

function fixture(content) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 8 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Properties << /A 5 0 R /B 6 0 R >> >> >>" },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /OCG /Name (A) >>" }, { number: 6, body: "<< /Type /OCG /Name (B) >>" },
    { number: 7, body: tinyPdfStream("", "0.5 g 5 5 10 10 re f") },
    { number: 8, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 7 0 R /Resources << >> >>" }
  ] });
}
