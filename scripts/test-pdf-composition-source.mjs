import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createPdfDocument } = await import("../src/pdfComposition.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { createNativeOptionalContentRegistry } = await import("../src/pdf/nativeOptionalContent.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const loadFontAsset = async url => new Uint8Array(await readFile(url));
  const fixture = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [7 0 R] >> /OCProperties << /OCGs [9 0 R] /D << /OFF [9 0 R] /Order [9 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] /Resources << /XObject << /Im 8 0 R >> /Properties << /Hidden 9 0 R >> >> >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [-10 -20 110 100] /CropBox [0 0 100 90] /Rotate 90 /UserUnit 2 /Group << /S /Transparency /CS /DeviceRGB /I true >> /Contents 5 0 R /Annots [7 0 R 10 0 R 11 0 R] >>" },
    { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [10 20 210 120] /Contents 6 0 R >>" },
    { number: 5, body: tinyPdfStream("", "0.8 g 0 0 100 90 re f /OC /Hidden BDC 1 0 0 rg 0 0 100 90 re f EMC") },
    { number: 6, body: tinyPdfStream("", "0 0 1 rg 10 20 200 100 re f") },
    { number: 7, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /T (Button) /V /Yes /AS /Yes /Rect [10 10 30 30] /AP << /N << /Yes 12 0 R >> >> >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(255, 0, 255)) },
    { number: 9, body: "<< /Type /OCG /Name (Hidden red source paint) >>" },
    { number: 10, body: "<< /Type /Annot /Subtype /Link /Rect [5 10 15 20] /Border [0 0 0] /A << /S /URI /URI (https://example.com/source) >> >>" },
    { number: 11, body: "<< /Type /Annot /Subtype /Link /Rect [20 10 30 20] /Border [0 0 0] /Dest [4 0 R /XYZ 12 34 1] >>" },
    { number: 12, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Matrix [2 0 0 2 0 0]", "0 1 0 rg 0 0 10 10 re f") }
  ] });
  async function render(bytes, pageIndex) {
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const original = await parser.compilePage(pageIndex, { optimization: "none" });
      const page = { ...original, displayProgram: { ...original.displayProgram, groups: original.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
      const result = await renderHeprPageToCanvas2d(page, { scale: 1, background: [1, 1, 1, 1], surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      const pixels = result.surface.context.getImageData(0, 0, result.width, result.height).data;
      return (x, y) => Array.from(pixels.subarray(((result.height - 1 - y) * result.width + x) * 4, ((result.height - 1 - y) * result.width + x) * 4 + 4));
    } finally { await parser.close(); }
  }
  const composer = await createPdfDocument({ loadFontAsset });
  try {
    const source = await composer.importPdf(fixture);
    assert.deepEqual(source.pages, [{ width: 180, height: 200 }, { width: 200, height: 100 }]);
    composer.addSourcePage(source, 1);
    const painted = composer.addSourcePage(source, 0);
    painted.drawRectangle({ x: 20, y: 140, width: 40, height: 40, fill: "black" });
    const rgba = await composer.registerImage({ width: 2, height: 2, data: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255) });
    painted.drawImage(rgba, { x: 80, y: 140, width: 20, height: 20 });
    composer.addSourcePage(source, 0, { background: false }).drawRectangle({ x: 20, y: 140, width: 40, height: 40, fill: "black" });
    composer.addSourcePage(source, 0);
    const bytes = new Uint8Array(await (await composer.save()).arrayBuffer());
    const output = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      assert(!output.catalog.has("AcroForm"));
      assert.equal(output.pages[1].rotation, 90); assert.equal(output.pages[1].userUnit, 2);
      assert.deepEqual(output.pages[1].cropBox, [0, 0, 100, 90]);
      const annotations = await output.resolveValue(output.pages[1].annotations);
      assert.equal(annotations.length, 2, "source widgets are static paint while safe links remain interactive");
      const dictionaries = await Promise.all(annotations.map(value => output.resolveDictionary(value)));
      assert(dictionaries.every(value => value.get("Subtype").value === "Link"));
      const goTo = await Promise.all(dictionaries.map(value => output.resolveDictionary(value.get("A"))));
      const target = goTo.find(value => value.get("S").value === "GoTo").get("D");
      assert.deepEqual(target[0], output.pages[0].ref, "source destination is remapped to the reordered output page");
      assert.equal(target[1].value, "XYZ"); assert.deepEqual(target.slice(2), [12, 34, 1], "native destination coordinates remain native");
      const sourceUri = dictionaries[goTo.findIndex(value => value.get("S").value === "URI")];
      assert.deepEqual(sourceUri.get("Rect"), [5, 10, 15, 20], "display hotspot is converted back to native geometry exactly once");
      assert.equal(output.pages[2].annotations, undefined, "a hidden source does not preserve invisible source hotspots");
      const resourceRefs = [];
      for (const index of [0, 1, 3]) {
        const resources = await output.resolveDictionary(output.pages[index].resources), objects = await output.resolveDictionary(resources.get("XObject"));
        resourceRefs.push(objects.get("Im"));
      }
      assert.deepEqual(resourceRefs[0], resourceRefs[1]); assert.deepEqual(resourceRefs[1], resourceRefs[2], "all source pages share imported image identity");
      const layers = await createNativeOptionalContentRegistry(output);
      assert.equal(layers.listGroups().length, 1); assert.equal(layers.listGroups()[0].defaultVisible, false);
    } finally { await output.close(); }
    const visible = await render(bytes, 1), hidden = await render(bytes, 2), original = await render(bytes, 3);
    assert.deepEqual(visible(30, 150), [0, 0, 0, 255], "overlay stays above baked widget after rotation and UserUnit");
    assert.deepEqual(original(30, 150), [0, 255, 0, 255], "uncovered source widget paints green");
    assert.deepEqual(original(100, 50), [204, 204, 204, 255], "hidden source OCG stays hidden");
    assert.deepEqual(hidden(100, 50), [255, 255, 255, 255], "background:false emits no original source paint");
    assert.deepEqual(visible(84, 155), [255, 0, 0, 255], "registered image top row stays at top");
    assert.deepEqual(visible(84, 144), [0, 0, 255, 255], "registered image bottom row stays at bottom");
  } finally { await composer.dispose(); }
  const diagnostics = [], omitted = await createPdfDocument({ loadFontAsset, onDiagnostic: value => diagnostics.push(value) });
  try {
    const source = await omitted.importPdf(fixture); omitted.addSourcePage(source, 0);
    const output = await NativePdfDocument.open({ kind: "bytes", bytes: new Uint8Array(await (await omitted.save()).arrayBuffer()) });
    try { assert.equal((await output.resolveValue(output.pages[0].annotations)).length, 1); }
    finally { await output.close(); }
    assert(diagnostics.some(value => value.code === "composition.link-target-missing"));
  } finally { await omitted.dispose(); }
  const scene = buildStrokeScene([{ points: [[5, 10], [45, 10]], width: 2, color: "red" }]);
  scene.pageRects = Float32Array.of(0, 0, 50, 50); scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
  const adapted = await createPdfDocument({ loadFontAsset });
  try {
    const source = await adapted.importScene(scene); adapted.addSourcePage(source, 0).drawRectangle({ x: 20, y: 5, width: 10, height: 10, fill: "blue" });
    const bytes = new Uint8Array(await (await adapted.save()).arrayBuffer()), pixels = await render(bytes, 0);
    assert.deepEqual(pixels(10, 10), [255, 0, 0, 255]); assert.deepEqual(pixels(25, 10), [0, 0, 255, 255]);
  } finally { await adapted.dispose(); }
  console.log("PDF composition sources: native geometry, AP stacking, remapped links, shared resources, hidden backgrounds/layers, image rows and scene adapter passed.");
} finally { hooks.deregister(); }
