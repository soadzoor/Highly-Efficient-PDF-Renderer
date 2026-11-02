import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const shared = "0 .5 0 rg 2 2 10 10 re f BT /F 8 Tf 5 20 Td (AB) Tj ET";
const untouched = "\n% unrelated source bytes must survive\n0 0 0 RG .5 w 4 8 m 96 8 l S\n";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } = await import("../src/scenePageViews.ts");
  const { createBundledStandardFontResolver } = await import("../src/standardFontResolver.ts");
  const resolver = createBundledStandardFontResolver({ loadAsset: asset => readFile(asset.url) });
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver: resolver });
    try { return await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true, retainOptionalContent: true }); }
    finally { await parser.close(); }
  };
  const rounded = number => Math.round(number * 10000) / 10000;
  const appearance = scene => {
    const counts = scenePrimitiveCounts(scene), result = [], alphas = new Map();
    const scopes = (nodes, alpha) => { for (const node of nodes) {
      if (node.kind === "group") scopes(node.children, alpha * node.alpha);
      else if (node.kind === "draw") { const run = scene.drawRuns[node.runIndex];
        for (let index = run.first; index < run.first + run.count; index++) alphas.set(`${run.kind}:${index}`, alpha); }
    } };
    if (scene.paintGraph) scopes(scene.paintGraph.roots, 1);
    for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < counts[kind]; index++) {
      const primitive = getScenePrimitive(scene, { kind, index }), segments = [];
      for (let segmentIndex = 0; segmentIndex < primitive.segmentCount; segmentIndex++) {
        const segment = primitive.getSegment(segmentIndex);
        segments.push([segment.start, segment.end, ...(segment.control ? [segment.control] : [])].flatMap(point => [rounded(point.x), rounded(point.y)]));
      }
      result.push(JSON.stringify({ kind, color: primitive.color?.map(rounded), opacity: rounded(primitive.opacity * (alphas.get(`${kind}:${index}`) ?? 1)), segments }));
    }
    return result.sort();
  };
  async function edit(content, change, inspect = () => {}, { rotation = 0, annotations = false } = {}) {
    const bytes = fixture(content + untouched, rotation, annotations), source = await compile(bytes);
    const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: url => readFile(url) });
    const session = await openEditorSession(source, services.sessionOptions), diagnostics = [], warnings = [];
    try {
      await change(session, source);
      const expected = await session.getScene(), saved = new Uint8Array(await (await session.savePdf({
        onDiagnostic: diagnostic => diagnostics.push(diagnostic), onWarning: warning => warnings.push(warning)
      })).arrayBuffer());
      assert(!diagnostics.some(diagnostic => diagnostic.code === "editor.pdf-source-operation-fallback"), JSON.stringify(diagnostics));
      assert(!warnings.some(warning => warning.includes("rebuilt as vectors")), "ordinary recoloring never rebuilds the whole page");
      const actual = await compile(saved);
      const counts = scenePrimitiveCounts(actual), refs = PAGE_PRIMITIVE_KINDS.flatMap(kind => Array.from({ length: counts[kind] }, (_, index) => ({ kind, index })));
      const colors = editorSourcePaintColors(actual, refs).color;
      for (const edit of session.getSourceEdits()) if (edit.color) assert(colors.some(color => color.every((channel, index) => Math.abs(channel - edit.color[index]) < .0001)),
        "the saved PDF actually contains the selected replacement RGB, including gradients and Type3 paint");
      assert.deepEqual(appearance(actual), appearance(expected), "saved colors, alpha and vector geometry match the committed editor scene");
      const document = await NativePdfDocument.open({ kind: "bytes", bytes: saved }, { repair: "off" });
      try {
        const content = new TextDecoder().decode(concatenate(await document.getDecodedPageContents(0)));
        assert(content.includes(untouched), "unrelated native source bytes remain untouched");
        assert(!content.includes("HEPRSourceOperation"));
        await inspect({ source, actual, expected, document, content, session, diagnostics });
      } finally { await document.close(); }
    } finally { session.dispose(); services.dispose(); }
  }
  const recolor = (session, ref, color) => {
    session.selectPrimitives([ref]);
    session.updateObject(session.getSelection()[0], { [ref.kind === "fill" || ref.kind === "gradient-fill" ? "fill" : "color"]: color });
  };
  for (const rotation of [0, 90, 180, 270]) await edit("q /Half gs 0 0 1 rg 12 16 20 15 re f Q",
    session => recolor(session, { kind: "fill", index: 0 }, "#e32971"),
    ({ actual }) => assert.equal(rounded(getScenePrimitive(actual, { kind: "fill", index: 0 }).opacity), .25), { rotation });
  await edit("q /Half gs 0 0 1 RG 2 w 12 16 m 40 38 l S Q",
    session => recolor(session, { kind: "stroke", index: 0 }, "#18b432"),
    ({ actual }) => assert.equal(rounded(getScenePrimitive(actual, { kind: "stroke", index: 0 }).opacity), .6));
  // q/Q optimization must not retain the old paint when a transformed scope
  // happens to have a uniform color override.
  await edit("q 0 0 1 rg 12 16 20 15 re f Q", session => {
    recolor(session, { kind: "fill", index: 0 }, "#db8020"); session.transformSelection([1, 0, 0, 1, 4, 6]);
  });
  // Original native glyph codes/fonts and the following show operator survive
  // per-glyph recoloring, including TJ spacing and quote operators.
  for (const show of ["(ABCD) Tj", "[(AB) 40 (CD)] TJ", "(ABCD) '", "2 1 (ABCD) \""]) await edit(
    `BT /F 12 Tf 14 TL 20 70 Td ${show} (EF) Tj ET`,
    session => recolor(session, { kind: "text", index: 1 }, "#3377cc"),
    async ({ actual, document }) => {
      const fonts = await document.resolveDictionary((await document.resolveDictionary(document.getPage(0).resources)).get("Font"));
      assert.deepEqual(fonts.get("F"), { kind: "ref", objectNumber: 5, generation: 0 });
      assert(actual.textIndex.pages[0].text.includes("EF"), "following text retains its original searchable wording");
    });
  // Only the chosen invocation is cloned/recolored; the original shared Form
  // program and other placements keep their own internal color operators.
  await edit("q 1 0 0 1 10 10 cm /Shared Do Q q 1 0 0 1 50 50 cm /Shared Do Q",
    session => recolor(session, { kind: "fill", index: 0 }, "#bb22ee"),
    async ({ content, document }) => {
      assert(content.includes("q 1 0 0 1 50 50 cm /Shared Do Q"));
      const stream = await document.resolveObject({ kind: "ref", objectNumber: 6, generation: 0 });
      assert.equal(new TextDecoder().decode(await document.decodeStream(stream)), shared);
    });
  // A combined fill/stroke path needs independent paints when only one side
  // changes, rather than leaking a color override to its sibling paint.
  await edit("0 0 1 rg 1 0 0 RG 2 w 12 16 20 15 re B",
    session => recolor(session, { kind: "fill", index: 0 }, "#00cc88"),
    ({ diagnostics }) => assert(diagnostics.some(diagnostic => diagnostic.code === "editor.pdf-source-operation-appearance")));
  await edit("q /Half gs /Gradient sh Q",
    session => recolor(session, { kind: "gradient-fill", index: 0 }, "#8844cc"),
    ({ diagnostics }) => assert(diagnostics.some(diagnostic => diagnostic.code === "editor.pdf-source-operation-appearance")));
  await edit("BT /T3 18 Tf 10 40 Td (A) Tj ET",
    (session, source) => {
      const counts = scenePrimitiveCounts(source), kind = counts.fill ? "fill" : "text";
      recolor(session, { kind, index: 0 }, "#00aabb");
    });
  // Rotating a source annotation must not take the Original-AP wrapper shortcut
  // after its native paint was recolored.
  await edit("0 0 1 rg 12 16 20 15 re f", (session, source) => {
    const annotation = source.annotations.find(annotation => annotation.subtype === "Square");
    session.selectAnnotations([annotation.id]); session.updateObject(session.getSelection()[0], { color: "#bb33dd" });
    session.transformSelection([0, 1, -1, 0, 180, 0]);
  }, undefined, { annotations: true });
  console.log("Source color PDF output: fills/strokes/alpha, rotation, glyph codes, shared Forms, split paints, gradients, Type3 and transformed annotations passed.");
} finally { hooks.deregister(); }

function fixture(content, rotation, annotations) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Rotate ${rotation} /Resources << /Font << /F 5 0 R /T3 12 0 R >> /XObject << /Shared 6 0 R >> /ExtGState << /Half 7 0 R >> /Shading << /Gradient 10 0 R >> >> /Contents 4 0 R${annotations ? " /Annots [8 0 R]" : ""} >>` },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 30 30] /Resources << /Font << /F 5 0 R >> >>", shared) },
    { number: 7, body: "<< /Type /ExtGState /ca .25 /CA .6 >>" },
    { number: 8, body: "<< /Type /Annot /Subtype /Square /F 4 /Rect [80 80 95 95] /AP << /N 9 0 R >> >>" },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 15 15]", "0 0 0 RG 1 w 1 1 13 13 re S") },
    { number: 10, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 11 0 R /Extend [true true] >>" },
    { number: 11, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" },
    { number: 12, body: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 500 700] /FontMatrix [.001 0 0 .001 0 0] /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [500] /CharProcs << /A 13 0 R >> /Resources << >> >>" },
    { number: 13, body: tinyPdfStream("", "500 0 d0 1 0 0 rg 0 0 500 700 re f") }
  ] });
}
function concatenate(parts) { const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
