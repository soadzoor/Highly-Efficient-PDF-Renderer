import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const formContent = "0 .5 0 rg 2 2 10 10 re f BT /F 8 Tf 5 20 Td (AB) Tj ET";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { getScenePrimitive, getPrimitiveClipChain } = await import("../src/scenePrimitives.ts");
  const { editorPoint } = await import("../src/editorScene.ts");
  const { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } = await import("../src/scenePageViews.ts");
  const { createBundledStandardFontResolver } = await import("../src/standardFontResolver.ts");
  const resolver = createBundledStandardFontResolver({ loadAsset: asset => readFile(asset.url) });
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver: resolver });
    try { return await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true, retainOptionalContent: true }); }
    finally { await parser.close(); }
  };
  const signature = (scene, ref) => {
    const primitive = getScenePrimitive(scene, ref), values = [ref.kind, ...(primitive.color ?? []), primitive.segmentCount];
    for (let index = 0; index < primitive.segmentCount; index++) {
      const segment = primitive.getSegment(index);
      for (const point of [segment.start, segment.end, ...(segment.control ? [segment.control] : [])]) values.push(...editorPoint([1, 0, 0, 1, 0, 0], point.x, point.y).map(value => Math.round(value * 1000) / 1000));
    }
    return JSON.stringify(values);
  };
  const geometry = scene => {
    const counts = scenePrimitiveCounts(scene), result = [];
    for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
      const ref = { kind, index }, bounds = getScenePrimitive(scene, ref).bounds, clip = getPrimitiveClipChain(scene, ref), boxes = clip.rect ? [clip.rect] : [];
      for (let clipIndex = clip.clipIndex; clipIndex >= 0; clipIndex = scene.clipPaths[clipIndex].parent) {
        const edges = scene.clipPaths[clipIndex].edges, xs = [], ys = [];
        for (let offset = 0; offset < edges.length; offset += 2) { xs.push(edges[offset]); ys.push(edges[offset + 1]); }
        boxes.push({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
      }
      if (!boxes.some(clip => bounds.maxX < clip.minX || bounds.minX > clip.maxX || bounds.maxY < clip.minY || bounds.minY > clip.maxY)) result.push(signature(scene, ref));
    }
    return result.sort();
  };
  async function edit(content, action, check, extra = {}) {
    const bytes = fixture(content, extra), source = await compile(bytes), services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: url => readFile(url) });
    const session = await openEditorSession(source, services.sessionOptions), diagnostics = [], warnings = [];
    try {
      await action(session, source);
      const expected = await session.getScene(), saved = new Uint8Array(await (await session.savePdf({ onDiagnostic: value => diagnostics.push(value), onWarning: value => warnings.push(value) })).arrayBuffer());
      assert(!diagnostics.some(item => item.code === "editor.pdf-source-operation-fallback"), JSON.stringify(diagnostics));
      assert(!warnings.some(message => /rebuilt as vectors/.test(message)), "the page body was not rebuilt");
      const actual = await compile(saved);
      assert.deepEqual(geometry(actual), geometry(expected), "saved source geometry matches the editor's canonical result");
      const document = await NativePdfDocument.open({ kind: "bytes", bytes: saved }, { repair: "off" });
      try {
        const content = new TextDecoder().decode(concatenate(await document.getDecodedPageContents(0)));
        assert(!content.includes("HEPRSourceOperation"), "temporary provenance tags never reach output");
        await check?.({ document, content, saved, source, actual, diagnostics, session });
      } finally { await document.close(); }
    } finally { session.dispose(); services.dispose(); }
  }
  const tail = "\n% unrelated source bytes remain unchanged\n0 0 0 RG 0.5 w 4 8 m 96 8 l S\n";
  for (const rotation of [0, 90, 180, 270]) await edit("0 0 1 rg 12 16 20 15 re f" + tail,
    session => { session.selectPrimitives([{ kind: "fill", index: 0 }]); session.transformSelection([.9, .15, -.25, 1.1, 5, -2]); },
    ({ content, document }) => { assert(content.includes(tail)); assert.equal(document.getPage(0).rotation, rotation); },
    { rotation, crop: [5, 6, 95, 96] });
  await edit("0 0 1 rg 12 16 20 15 re f" + tail,
    session => { session.selectPrimitives([{ kind: "fill", index: 0 }]); session.deleteSelection(); },
    ({ content }) => assert(content.includes(tail)));
  // Native character codes, original font resources and subsequent text advances
  // survive per-glyph transforms/deletion, including TJ gaps and quote operators.
  for (const show of ["(ABCD) Tj", "[(AB) 40 (CD)] TJ", "(ABCD) '", "2 1 (ABCD) \""]) {
    await edit(`BT /F 12 Tf 14 TL 20 70 Td ${show} (EF) Tj T* (GH) Tj ET` + tail,
      session => { session.selectPrimitives([{ kind: "text", index: 0 }]); session.transformSelection([1, .2, 0, 1, 3, -4]); session.selectPrimitives([{ kind: "text", index: 2 }]); session.deleteSelection(); },
      async ({ content, document, actual }) => {
        assert(content.includes(tail)); const fonts = await document.resolveDictionary((await document.resolveDictionary(document.getPage(0).resources)).get("Font"));
        assert.deepEqual(fonts.get("F"), { kind: "ref", objectNumber: 5, generation: 0 }, "the original font resource is retained");
        assert(!content.includes("(ABCD)")); assert(actual.textIndex.pages[0].text.includes("EF"));
      });
  }
  await edit("q 1 0 0 1 10 10 cm /Shared Do Q q 1 0 0 1 50 50 cm /Shared Do Q" + tail,
    session => { session.selectPrimitives([{ kind: "text", index: 0 }]); session.transformSelection([1, 0, 0, 1, 4, -3]); },
    async ({ content, document }) => {
      assert(content.includes("q 1 0 0 1 50 50 cm /Shared Do Q"));
      assert.equal(new TextDecoder().decode(await document.decodeStream(await document.resolveObject({ kind: "ref", objectNumber: 6, generation: 0 }))), formContent);
    });
  await edit("q 18 0 0 12 12 40 cm /Image Do Q" + tail,
    session => { session.selectPrimitives([{ kind: "raster", index: 0 }]); session.transformSelection([1, .2, -.1, 1, 5, 2]); },
    async ({ document }) => assert.deepEqual(await document.decodeStream(await document.resolveObject({ kind: "ref", objectNumber: 7, generation: 0 })), Uint8Array.of(255, 0, 0)));
  await edit("1 0 0 RG 1 w 10 10 m q 18 0 0 12 12 40 cm BI /W 1 /H 1 /BPC 8 /CS /RGB /F /AHx ID ff0000> EI Q 60 30 l S" + tail,
    session => { session.selectPrimitives([{ kind: "raster", index: 0 }]); session.transformSelection([1, 0, 0, 1, 5, 3]); });
  await edit("0 0 1 rg 10 10 m 15 20 20 25 30 30 c 40 40 50 35 v 60 40 60 50 y h f" + tail,
    session => { session.selectPrimitives([{ kind: "fill", index: 0 }]); session.transformSelection([1, 0, 0, 1, 5, 3]); });
  await edit("q 10 10 30 30 re W n 0 .5 1 rg 0 0 60 60 re f Q" + tail,
    session => { session.selectPrimitives([{ kind: "fill", index: 0 }]); session.transformSelection([1, 0, 0, 1, 8, 6]); });
  await edit("q 10 10 30 30 re W n 1 0 0 RG 2 w 0 0 m 20 20 l 55 55 l S Q" + tail,
    session => { session.selectPrimitives([{ kind: "stroke", index: 0 }]); session.transformSelection([1, 0, 0, 1, 8, 6]); },
    ({ diagnostics, content }) => { assert(diagnostics.some(item => /owning graphics-state scope/.test(item.message))); assert(content.includes(tail)); });
  await edit("q 1 0 0 1 10 10 cm /Shared Do Q q 1 0 0 1 50 50 cm /Shared Do Q" + tail,
    session => { session.selectPrimitives([{ kind: "text", index: 0 }]); session.transformSelection([1, 0, 0, 1, 35, 0]); },
    ({ diagnostics, content }) => { assert(!diagnostics.some(item => item.code === "editor.pdf-source-operation-appearance")); assert(content.includes("q 1 0 0 1 50 50 cm /Shared Do Q")); });
  // Separate q/Q units retain native operators when reordered, even though their
  // source colors differ; implicit-state paints use a bounded vector appearance.
  for (const scoped of [true, false]) {
    const paints = ["1 0 0 rg 10 10 30 30 re f", "0 0 1 rg 20 20 30 30 re f", "0 1 0 rg 30 30 30 30 re f"];
    await edit(tail + paints.map(paint => scoped ? `q ${paint} Q` : paint).join("\n"),
      session => { session.selectPrimitives([{ kind: "fill", index: 0 }]); session.reorderSelection("bring-to-front"); },
      ({ content, diagnostics }) => { assert(content.includes(tail)); assert.equal(diagnostics.some(item => item.code === "editor.pdf-source-operation-appearance"), !scoped); });
  }
  await edit("1 0 0 RG 2 w 10 10 m 30 20 l 45 12 l 60 30 l S" + tail,
    session => { session.selectPrimitives([{ kind: "stroke", index: 1 }]); session.transformSelection([1, 0, 0, 1, 2, 4]); },
    ({ diagnostics, content }) => { assert(diagnostics.some(item => item.code === "editor.pdf-source-operation-appearance")); assert(content.includes(tail)); });
  await edit("0 0 1 rg 12 16 20 15 re f" + tail,
    session => { const id = session.createLayer({ name: "Assigned source" }); session.selectPrimitives([{ kind: "fill", index: 0 }]); session.assignSelectionToLayer(id); },
    ({ actual }) => assert(getScenePrimitive(actual, { kind: "fill", index: 0 }).optionalContent.layerIds.length));
  // Metadata-only edits keep the exact original appearance stream and rectangle.
  await edit(tail, session => { session.updateAnnotation("ref:9:0", { contents: "Discussion", author: "Reviewer" }); session.setObjectsLocked(["annotation:ref:9:0"], true); },
    async ({ document }) => { const value = await document.resolveDictionary({ kind: "ref", objectNumber: 9, generation: 0 }); assert.equal(value.get("F"), 132); assert.deepEqual(value.get("AP"), new Map([["N", { kind: "ref", objectNumber: 10, generation: 0 }]])); });
  console.log("PDF source operations: exact operators/resources, cropped/rotated pages, native text codes/advances, shared Forms, images, clips, native/bounded reorder, partial paths, layers and metadata-only annotations passed.");
} finally { hooks.deregister(); }

function fixture(content, { rotation = 0, crop = [0, 0, 100, 100] } = {}) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /CropBox [${crop.join(" ")}] /Rotate ${rotation} /Resources << /Font << /F 5 0 R >> /XObject << /Shared 6 0 R /Image 7 0 R >> >> /Contents 4 0 R /Annots [9 0 R] >>` },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 30 30] /Resources << /Font << /F 5 0 R >> >>", formContent) },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(255, 0, 0)) },
    { number: 9, body: "<< /Type /Annot /Subtype /Square /F 4 /Rect [80 80 95 95] /AP << /N 10 0 R >> >>" },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 15 15]", "0 0 0 RG 1 w 1 1 13 13 re S") }
  ] });
}
function concatenate(parts) { const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
