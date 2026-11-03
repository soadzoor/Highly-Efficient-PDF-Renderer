import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createPdfDocument } = await import("../src/pdfComposition.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { extractPdfPageScenes } = await import("../src/pdfVectorExtractor.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const loadFontAsset = async url => new Uint8Array(await readFile(url));
  const bytes = async composer => new Uint8Array(await (await composer.save()).arrayBuffer());
  const near = (actual, expected, tolerance = 3, label = "pixel") => assert(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `${label}: expected ${expected}, got ${actual}`);
  const rect = (x, y, width, height) => [["M", x, y], ["L", x + width, y], ["L", x + width, y + height], ["L", x, y + height], ["Z"]];
  async function render(data, pageIndex = 0) {
    const session = await openPdf({ kind: "bytes", bytes: data });
    try {
      const original = await session.compilePage(pageIndex, { optimization: "none" });
      const page = { ...original, displayProgram: { ...original.displayProgram, groups: original.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
      const image = await renderHeprPageToCanvas2d(page, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      const pixels = image.surface.context.getImageData(0, 0, image.width, image.height).data;
      return { width: image.width / 2, height: image.height / 2, pixel(x, y) {
        const offset = ((image.height - 1 - Math.floor(y * 2)) * image.width + Math.floor(x * 2)) * 4;
        return Array.from(pixels.subarray(offset, offset + 4));
      } };
    } finally { await session.close(); }
  }
  const metadata = { title: "Composed Ω", author: "Export fixture", creator: "Composition test" };
  const composer = await createPdfDocument({ metadata, loadFontAsset }); metadata.title = "Changed after creation";
  try {
    const size = { width: 120, height: 100 }, page = composer.addPage(size); size.width = 999;
    const commands = rect(0, 0, 100, 100), color = [1, 0, 0], paint = { fill: color };
    page.drawPath(commands, paint); commands[0][1] = 999; color[0] = 0; paint.fill = "black";
    page.drawRectangle({ x: 20, y: 20, width: 40, height: 40, fill: "blue", fillOpacity: .5, stroke: "black", strokeOpacity: .25, strokeWidth: 8 });
    page.drawRectangle({ x: 80, y: 0, width: 20, height: 20, fill: "green" });
    page.drawRectangle({ x: 90, y: 5, width: 20, height: 20, fill: "yellow" });
    page.saveState(); page.clipPath([...rect(5, 65, 60, 30), ...rect(20, 70, 20, 20)], "evenodd");
    page.drawRectangle({ x: 0, y: 60, width: 70, height: 40, fill: [0, 1, 0] }); page.restoreState();
    page.saveState(); const translation = [1, 0, 0, 1, 70, 40]; page.transform(translation); translation[4] = 999;
    page.drawRectangle({ x: 0, y: 0, width: 20, height: 15, fill: "magenta" }); page.restoreState();
    page.drawSvgPath("M0 0L10 0L0 10Z", { fill: "cyan", transform: [1, 0, 0, 1, 100, 90] });
    page.drawPath([["M", 70, 70], ["L", 110, 70]], { stroke: "yellow", strokeWidth: 4, dashArray: [6, 6], lineCap: "butt" });
    const rgba = { width: 1, height: 1, data: Uint8Array.of(0, 255, 0, 128) }, pendingImage = composer.registerImage(rgba);
    rgba.data.fill(0); const image = await pendingImage;
    const png = createCanvas(1, 1), pngContext = png.getContext("2d"), pngPixels = pngContext.createImageData(1, 1);
    pngPixels.data.set([0, 255, 0, 128]); pngContext.putImageData(pngPixels, 0, 0);
    const pngImage = await composer.registerImage({ encoding: "png", bytes: png.toBuffer("image/png") });
    assert.equal(pngImage, image, "decoded PNG and raw RGBA share the same registered pixels");
    const jpeg = createCanvas(2, 2); jpeg.getContext("2d").fillStyle = "cyan"; jpeg.getContext("2d").fillRect(0, 0, 2, 2);
    const jpegImage = await composer.registerImage({ encoding: "jpeg", bytes: jpeg.toBuffer("image/jpeg") });
    page.drawImage(image, { x: 100, y: 30, width: 10, height: 10 });
    const second = composer.addPage({ width: 200, height: 80 }); second.drawImage(image, { x: 0, y: 0, width: 10, height: 10 });
    second.saveState(); second.clipRectangle({ x: 30, y: 20, width: 10, height: 10 });
    second.drawEllipse({ x: 20, y: 10, width: 30, height: 30, fill: "blue" }); second.restoreState();
    const textPage = composer.addPage({ width: 360, height: 240 });
    textPage.drawImage(jpegImage, { x: 320, y: 10, width: 15, height: 15 });
    textPage.drawText("Baseline Ω café", { x: 12, y: 210, fontSize: 18, color: "black" });
    textPage.drawRectangle({ x: 15, y: 75, width: 290, height: 85, fill: "red", fillOpacity: .15 });
    const runs = [{ text: "Bold ", fontWeight: "bold", backgroundColor: "yellow", backgroundOpacity: 1 }, { text: "italic Ω", fontStyle: "italic", underline: true, color: "blue" }];
    textPage.drawTextBox({ x: 15, y: 75, width: 290, height: 85, text: "Bold italic Ω", fontSize: 18, runs, align: "right", verticalAlignment: "middle" });
    runs[0].text = "MUTATED"; runs[1].color = "red";
    textPage.drawText("H", { x: 100, y: 35, fontSize: 30, fontFamily: "Liberation Mono", opacity: .5,
      runs: [{ text: "H", color: "blue", opacity: .5, backgroundColor: "red", backgroundOpacity: .5 }] });
    textPage.addLink({ x: 10, y: 10, width: 40, height: 15 }, { type: "url", url: "https://example.com/export" });
    textPage.saveState(); textPage.transform([1, 0, 0, 1, 50, 0]);
    textPage.addLink({ x: 10, y: 10, width: 40, height: 15 }, { type: "page", pageIndex: 0, x: 20, y: 30 }); textPage.restoreState();
    const metricStyle = { fontSize: 18 }, pendingMetrics = composer.measureText("Baseline Ω café", metricStyle); metricStyle.fontSize = 99;
    const metrics = await pendingMetrics;
    assert(metrics.width > 80 && metrics.width < 200); assert(metrics.height > 0 && metrics.ascent > 0 && metrics.descent <= 0);

    const inputPdf = sourceFixture(), pendingImport = composer.importPdf(inputPdf); inputPdf.fill(0);
    const imported = await pendingImport; assert.deepEqual(imported.pages.map(({ width, height }) => [width, height]), [[60, 140]]);
    const sourcePage = composer.addSourcePage(imported, 0); assert.deepEqual([sourcePage.width, sourcePage.height], [60, 140]);
    sourcePage.drawRectangle({ x: 0, y: 0, width: 10, height: 10, fill: "red" });
    const hiddenBackground = composer.addSourcePage(imported, 0, { background: false });
    hiddenBackground.drawRectangle({ x: 20, y: 20, width: 10, height: 10, fill: "green" });
    const cropped = composer.addSourcePage(imported, 0); cropped.setViewport({ x: -5, y: -6, width: 70, height: 155 });

    const data = await bytes(composer), native = await NativePdfDocument.open({ kind: "bytes", bytes: data }, { repair: "off" });
    try {
      assert.equal(native.pages.length, 6); assert.equal(native.info.metadata.title, "Composed Ω"); assert.equal(native.info.metadata.author, "Export fixture");
      assert.deepEqual(native.pages.slice(0, 3).map(p => p.mediaBox), [[0, 0, 120, 100], [0, 0, 200, 80], [0, 0, 360, 240]]);
      for (const index of [3, 4, 5]) { assert.deepEqual(native.pages[index].mediaBox, [10, 20, 90, 60]); assert.equal(native.pages[index].rotation, 90); assert.equal(native.pages[index].userUnit, 2); }
      assert.deepEqual(native.pages[3].cropBox, [15, 25, 85, 55]);
      for (const name of ["CropBox", "TrimBox", "BleedBox", "ArtBox"]) assert.deepEqual(await native.resolveValue(native.pages[5].dictionary.get(name)), [10.5, 22.5, 88, 57.5], `${name} expands the previous visible viewport without rebasing`);
      const images = [];
      for (const index of [0, 1]) {
        const resources = await native.resolveDictionary(native.pages[index].resources), objects = await native.resolveDictionary(resources.get("XObject"));
        const refs = [];
        for (const value of objects.values()) {
          const object = await native.resolveObject(value);
          if (object?.kind === "stream" && object.dictionary.get("Subtype")?.value === "Image") refs.push(value);
        }
        assert.equal(refs.length, 1, "each page refers to its one registered image"); images.push(refs[0]);
      }
      assert.deepEqual(images[0], images[1], "image placements on different pages share one indirect image resource");
      const annotations = await native.resolveValue(native.pages[2].annotations); assert.equal(annotations.length, 2);
      const first = await native.resolveDictionary(annotations[0]), secondLink = await native.resolveDictionary(annotations[1]);
      const uri = await native.resolveDictionary(first.get("A")); assert.equal(uri.get("S").value, "URI"); assert.equal(decodePdfString(uri.get("URI"), 2, 0), "https://example.com/export");
      assert.deepEqual(await native.resolveValue(secondLink.get("Rect")), [60, 10, 100, 25], "link hotspots follow the graphics transform");
      const goto = await native.resolveDictionary(secondLink.get("A")), destination = await native.resolveValue(goto.get("D"));
      assert.equal(goto.get("S").value, "GoTo"); assert.deepEqual(destination[0], native.pages[0].ref); assert.equal(destination[1].value, "XYZ"); assert.deepEqual(destination.slice(2, 4), [20, 30]);
      const visited = new Set(), fontFiles = new Set();
      async function inspect(value) {
        if (value?.kind === "ref") {
          const key = `${value.objectNumber}:${value.generation}`; if (visited.has(key)) return; visited.add(key);
          return inspect(await native.resolveObject(value));
        }
        if (value?.kind === "stream") return inspect(value.dictionary);
        if (value instanceof Map) for (const [key, child] of value) {
          if (key === "FontFile2" || key === "FontFile3") { assert.equal(child.kind, "ref"); fontFiles.add(`${child.objectNumber}:${child.generation}`); }
          await inspect(child);
        }
        else if (Array.isArray(value)) for (const child of value) await inspect(child);
      }
      await inspect(native.catalog);
      assert.equal(fontFiles.size, composer.fonts.list().length, "repeated captions and text forms embed each used font face only once");
    } finally { await native.close(); }
    const rendered = await render(data);
    assert.deepEqual([rendered.width, rendered.height], [120, 100]);
    for (const [x, y, expected, label] of [[2, 2, [255, 0, 0, 255], "snapshotted path and color"], [40, 40, [128, 0, 128, 255], "translucent fill"], [18, 40, [191, 0, 0, 255], "independent stroke alpha"], [95, 10, [255, 255, 0, 255], "later paint overlaps earlier paint"], [10, 80, [0, 255, 0, 255], "clip interior"], [30, 80, [255, 0, 0, 255], "evenodd clip hole"], [70, 80, [255, 0, 0, 255], "restored clip"], [75, 45, [255, 0, 255, 255], "transformed rectangle"], [102, 88, [0, 255, 255, 255], "SVG reflected Y"], [102, 92, [255, 255, 255, 255], "SVG stays below origin"], [73, 70, [255, 255, 0, 255], "dash paint"], [79, 70, [255, 0, 0, 255], "dash gap"], [105, 35, [127, 255, 127, 255], "image alpha and input snapshot"]]) near(rendered.pixel(x, y), expected, 3, label);
    const secondPixels = await render(data, 1); near(secondPixels.pixel(5, 5), [127, 255, 127, 255]); near(secondPixels.pixel(35, 25), [0, 0, 255, 255]); near(secondPixels.pixel(25, 25), [255, 255, 255, 255]);
    const visibleSource = await render(data, 3); near(visibleSource.pixel(5, 5), [255, 0, 0, 255]); near(visibleSource.pixel(30, 70), [0, 0, 255, 255]);
    const hiddenSource = await render(data, 4); near(hiddenSource.pixel(5, 5), [255, 255, 255, 255]); near(hiddenSource.pixel(25, 25), [0, 128, 0, 255]);
    const scenes = await extractPdfPageScenes(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), { pages: "3", extractTextContent: true });
    const text = scenes.flatMap(scene => scene.textContent ?? []).map(item => item.text).join(" ");
    for (const expected of ["Baseline", "Ω", "café", "Bold", "italic"]) assert(text.includes(expected), `searchable text retains ${expected}: ${text}`);
    assert(!text.includes("MUTATED"), "text runs are copied before asynchronous font loading");
    const textPixels = await render(data, 2);
    near(textPixels.pixel(327, 17), [0, 255, 255, 255], 4, "JPEG image pixels");
    near(textPixels.pixel(20, 80), [255, 217, 217, 255], 3, "text box translucent background");
    let blue = 0, yellow = 0, firstBlueX = Infinity;
    for (let y = 75; y < 160; y++) for (let x = 15; x < 305; x++) {
      const [r, g, b] = textPixels.pixel(x, y);
      if (b > 180 && r < 80 && g < 80) { blue++; firstBlueX = Math.min(firstBlueX, x); }
      if (r > 220 && g > 220 && b < 80) yellow++;
    }
    assert(blue > 100 && yellow > 100, "styled text retains its blue run and yellow run background");
    assert(firstBlueX > 200, "right-aligned styled text occupies the right side of the text box");
    assert(composer.fonts.list().some(font => font.fontWeight >= 600), "bold text resolves a bold outline face");
    assert(composer.fonts.list().some(font => font.fontStyle === "italic"), "italic text resolves an italic outline face");
    let translucentBackground = 0, translucentInk = 0;
    for (let y = 25; y < 65; y++) for (let x = 100; x < 122; x++) {
      const actual = textPixels.pixel(x, y);
      if (actual.every((value, index) => Math.abs(value - [255, 191, 191, 255][index]) <= 3)) translucentBackground++;
      if (actual.every((value, index) => Math.abs(value - [191, 143, 207, 255][index]) <= 3)) translucentInk++;
    }
    assert(translucentBackground > 30 && translucentInk > 10, "text and run alpha multiply independently over the translucent run background");
    // Baseline text must paint immediately above its requested baseline.
    let ink = 0; for (let y = 210; y < 226; y++) for (let x = 12; x < 170; x++) if (textPixels.pixel(x, y).slice(0, 3).some(v => v < 160)) ink++;
    assert(ink > 100, "baseline text is positioned above the baseline");
    await assert.rejects(async () => composer.save({ signal: AbortSignal.abort() }), error => error.name === "AbortError" || error.code === "aborted");
    assert((await composer.save()).size > 0, "a cancelled save does not corrupt the composer");
    assert.throws(() => page.restoreState(), /state|restore|stack/i);
    assert.throws(() => page.drawPath([["L", 0, 0]], { stroke: "black" }));
    assert.throws(() => page.drawRectangle({ x: 0, y: 0, width: -1, height: 2, fill: "black" }));
    await assert.rejects(composer.registerImage({ width: 2, height: 2, data: Uint8Array.of(0, 0, 0, 255) }));
    await assert.rejects(composer.registerImage({ encoding: "png", bytes: Uint8Array.of(1, 2, 3) }));
    assert.throws(() => page.drawImage({ id: "missing", width: 1, height: 1 }, { x: 0, y: 0, width: 10, height: 10 }));
    assert.throws(() => composer.addSourcePage(imported, 1));
  } finally { await composer.dispose(); }
  await assert.rejects(async () => composer.save(), /disposed|closed/i);
  assert.throws(() => composer.addPage({ width: 10, height: 10 }), /disposed|closed/i);
  await composer.dispose();
  await assert.rejects(async () => createPdfDocument({ signal: AbortSignal.abort() }), error => error.name === "AbortError" || error.code === "aborted");
  const snapshot = await createPdfDocument();
  try {
    snapshot.addPage({ width: 100, height: 80 }); const saving = snapshot.save(); snapshot.addPage({ width: 200, height: 90 });
    const native = await NativePdfDocument.open({ kind: "bytes", bytes: new Uint8Array(await (await saving).arrayBuffer()) });
    try { assert.equal(native.pages.length, 1, "save snapshots the page list before yielding"); } finally { await native.close(); }
  } finally { await snapshot.dispose(); }
  const disposing = await createPdfDocument(), cancelledImage = disposing.registerImage({ width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 255) });
  const cancelledImageCheck = assert.rejects(cancelledImage, error => error.name === "AbortError" || error.code === "aborted");
  await disposing.dispose(); await cancelledImageCheck;
  let fontStarted, releaseFont;
  const started = new Promise(resolve => { fontStarted = resolve; }), fontGate = new Promise(resolve => { releaseFont = resolve; });
  const blockedFont = await createPdfDocument({ loadFontAsset: async url => { fontStarted(); await fontGate; return loadFontAsset(url); } });
  try {
    blockedFont.addPage({ width: 100, height: 100 }).drawText("Loading", { x: 10, y: 20, fontSize: 12 });
    const saving = blockedFont.save(), rejected = assert.rejects(saving, error => error.name === "AbortError" || error.code === "aborted");
    await started; await blockedFont.dispose(); await rejected;
  } finally { releaseFont(); await blockedFont.dispose(); }
  const [scene] = await extractPdfPageScenes(sourceFixture().buffer), hep = await buildHep(scene, { withVectorLod: false, withTextLod: false });
  const hepScene = await loadSceneFromHep(await hep.arrayBuffer()), sceneComposer = await createPdfDocument();
  try {
    const source = await sceneComposer.importScene(hepScene), page = sceneComposer.addSourcePage(source, 0);
    assert.deepEqual([page.width, page.height], [60, 140]);
    page.drawEllipse({ x: 20, y: 60, width: 20, height: 20, fill: "red" });
    const image = await render(await bytes(sceneComposer)); near(image.pixel(5, 5), [0, 0, 255, 255]); near(image.pixel(30, 70), [255, 0, 0, 255]);
  } finally { await sceneComposer.dispose(); }
  const missingFont = await createPdfDocument({ loadFontAsset: async () => { throw new Error("Synthetic font read failure"); } });
  try { missingFont.addPage({ width: 100, height: 100 }).drawText("Required text", { x: 10, y: 10, fontSize: 12 }); await assert.rejects(missingFont.save(), /Synthetic font read failure/); }
  finally { await missingFont.dispose(); }
  console.log("PDF composition: ordered vectors, independent alpha, clipping, transforms, shared images, Unicode text, links, source page geometry, crop, snapshots and lifecycle passed.");
} finally { hooks.deregister(); }

function sourceFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [10 20 90 60] /CropBox [15 25 85 55] /TrimBox [16 26 84 54] /BleedBox [14 24 86 56] /ArtBox [17 27 83 53] /Rotate 90 /UserUnit 2 /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0 0 1 rg 10 20 80 40 re f") }
  ] });
}
