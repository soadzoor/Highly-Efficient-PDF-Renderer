import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const surfaceFactory = (width, height) => {
    const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
  };
  async function compile(bytes) {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { return await parser.compileVectorPage(0, { optimization: "none" }); }
    finally { await parser.close(); }
  }
  async function render(bytes) {
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const original = await parser.compilePage(0, { optimization: "none" });
      // The reference canvas operates in sRGB. It rejects even explicit
      // DeviceRGB group spaces, so use its equivalent implicit RGB setting.
      const page = { ...original, displayProgram: { ...original.displayProgram,
        groups: original.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
      const result = await renderHeprPageToCanvas2d(page, { surfaceFactory, scale: 2, background: [1, 1, 1, 1] });
      return (x, y) => Array.from(result.surface.context.getImageData(Math.floor(x * 2), result.height - 1 - Math.floor(y * 2), 1, 1).data);
    } finally { await parser.close(); }
  }
  const near = (actual, expected, label) => assert(actual.every((value, channel) => Math.abs(value - expected[channel]) <= 4),
    `${label}: expected ${expected}, got ${actual}`);
  for (const masked of [false, true]) for (const opacity of [1, .5]) {
    const bytes = fixture(masked, opacity), scene = await compile(bytes);
    const original = await render(bytes), services = await createEditorAppServices({ sourcePdf: bytes });
    const editor = await openEditorSession(scene, services.sessionOptions);
    try {
      editor.setFieldValue("Field", "B");
      const preview = await editor.getScene(); validateVectorDrawRuns(preview); validateScenePaintGraph(preview);
      assert.deepEqual([...getSceneAnnotationRuns(preview).keys()], ["ref:11:0", "ref:12:0", "ref:13:0"],
        "filled widgets keep their original position before later Square and Ink annotations");
      const previewPixels = await render(new Uint8Array(await (await writeScenePdf(preview)).arrayBuffer()));
      const nativePixels = await render(new Uint8Array(await (await editor.savePdf()).arrayBuffer()));
      const hep = await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
      const reopened = await loadSceneFromHep(await hep.arrayBuffer()); validateVectorDrawRuns(reopened); validateScenePaintGraph(reopened);
      const hepPixels = await render(new Uint8Array(await (await writeScenePdf(reopened)).arrayBuffer()));
      for (const [x, y] of [[15, 35], [30, 50], [50, 50], [95, 5]]) {
        const expected = original(x, y);
        near(nativePixels(x, y), expected, `native PDF retains annotation order, mask=${masked}, opacity=${opacity}`);
        near(previewPixels(x, y), expected, `filled preview retains annotation order, mask=${masked}, opacity=${opacity}`);
        near(hepPixels(x, y), expected, `HEP roundtrip retains annotation order, mask=${masked}, opacity=${opacity}`);
      }
      if (masked) {
        const hasMask = nodes => nodes.some(node => node.kind === "group" && (node.softMask || hasMask(node.children)));
        assert(hasMask(preview.paintGraph.roots), "field extraction keeps complete soft-mask subtrees");
      }
    } finally { editor.dispose(); services.dispose(); }
  }
  console.log("Field paint order: opaque/translucent later markups, complete soft masks, preview, HEP and native PDF parity passed.");
} finally { hooks.deregister(); }

function fixture(masked, opacity) {
  const form = (bbox, content, resources = "") => tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [${bbox}] /Resources << ${resources} >>`, content);
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Group << /S /Transparency /CS /DeviceRGB /I true /K false >> /Resources << >> /Contents 4 0 R /Annots [11 0 R 12 0 R 13 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "1 1 1 rg 0 0 100 100 re f") },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>" },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>" },
    { number: 7, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 8, body: form("0 0 80 80", `${masked ? "q /Mask gs " : "q "}0 0 1 rg 0 0 80 80 re f Q BT /F 12 Tf 1 0 0 1 4 8 Tm (A) Tj ET`,
      `/Font << /F 5 0 R >>${masked ? " /ExtGState << /Mask << /SMask << /S /Luminosity /G 9 0 R >> >> >>" : ""}`) },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 80 80] /Group << /S /Transparency /CS /DeviceGray /I true >> /Resources << >>", ".5 g 0 0 80 80 re f") },
    { number: 10, body: "<< /Fields [11 0 R] /DA (/F 12 Tf 0 g) /DR << /Font << /F 5 0 R >> >> >>" },
    { number: 11, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Field) /V (A) /Rect [10 10 90 90] /AP << /N 8 0 R >> >>" },
    { number: 12, body: "<< /Type /Annot /Subtype /Square /Rect [25 25 75 75] /AP << /N 14 0 R >> >>" },
    { number: 13, body: "<< /Type /Annot /Subtype /Ink /Rect [0 0 100 100] /InkList [[0 0 100 100]] /AP << /N 15 0 R >> >>" },
    { number: 14, body: form("0 0 50 50", "/Alpha gs 0 1 0 rg 0 0 50 50 re f", `/ExtGState << /Alpha << /ca ${opacity} >> >>`) },
    { number: 15, body: form("0 0 100 100", "/Half gs 1 0 0 RG 10 w 1 J 0 0 m 100 100 l S", "/ExtGState << /Half << /CA .5 >> >>") }
  ] });
}
