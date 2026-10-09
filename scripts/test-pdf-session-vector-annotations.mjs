import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const options = { missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "annotation-vectors" }) };
  const empty = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R 6 0 R 7 0 R 8 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "10 10 20 20 re f") },
    { number: 5, body: "<< /Type /Annot /Subtype /Link /Rect [40 10 60 30] /AP << /N 9 0 R >> >>" },
    // An empty Rect leaves even a malformed/missing appearance unreachable.
    { number: 6, body: "<< /Type /Annot /Subtype /Link /Rect [0 0 0 10] /AP 999 0 R >>" },
    { number: 7, body: "<< /Type /Annot /Subtype /Link /Rect [40 40 60 60] /AP << /N 10 0 R >> >>" },
    { number: 8, body: "<< /Type /Annot /Subtype /Link /Rect [70 70 80 80] /AP << /N 11 0 R >> >>" },
    // The empty box clips out all paint, including broken resource references.
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 0 0]", "/Missing Do") },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Matrix [0 0 0 1 0 0]", "/Missing Do") },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", "0 0 10 10 re f") }
  ] }) }, options);
  try {
    const scene = await empty.compileVectorPage(0, { vectorFallback: "error" });
    assert.equal(scene.fillPathCount, 2, "page content and the visible annotation survive empty appearances");
    assert.equal(scene.rasterLayers.length, 0);
    assert.equal(scene.annotations.length, 4, "empty annotation metadata remains available");
    const page = await empty.compilePage(0);
    assert.equal(page.annotations.length, 4);
    assert.equal(page.displayProgram.programs.length, 1, "clipped-out appearances are never decoded");
    assert.equal(empty.getDiagnostics().filter(d => d.code === "annotation.empty-appearance").length, 3,
      "empty appearances are diagnosed once across repeated vector and retained compilation");
    assert(!empty.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
  } finally { await empty.close(); }
  for (const [rotation, expectedBounds] of [
    [0, [10, 10, 30, 20]], [90, [10, 50, 20, 70]],
    [180, [50, 40, 70, 50]], [270, [40, 10, 50, 30]]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture({ rotation }) }, options);
    try {
      const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
      assert.equal(scene.rasterLayers.length, 1, "only the original page image stays raster");
      assert.equal(scene.rasterLayers[0].width, 2, "source image resolution is retained");
      assert.equal(scene.rasterLayers[0].height, 2);
      assert.equal(scene.fillPathCount, 3, "page Form and both visible annotation Forms remain vectors");
      assert.equal(scene.textInstanceCount, 3);
      assert.equal(scene.textIndex.pages[0].text.replaceAll(/\s/g, ""), "ABB",
        "annotations remain searchable and hidden appearances stay lazy");
      assert.deepEqual(fillBounds(scene, 1), expectedBounds,
        "annotation Rect mapping composes the appearance Matrix with page rotation and crop");
      assert.deepEqual([
        scene.fillPathMetaB[6], scene.fillPathMetaB[7], scene.fillPathMetaC[6], scene.fillPathMetaC[7]
      ], [0, 0, 0, 1], "annotations do not inherit the page's blue paint, alpha, transform or clip");
      assert.deepEqual(scene.drawRuns.map(run => run.kind),
        ["raster", "fill", "text", "fill", "text", "fill", "text"],
        "annotation appearances paint after page content in Annots order");
      assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
      // The hidden-layer annotation's appearance is missing. Toggleable layers
      // would need it, so the page keeps its default view without PDF layers.
      // Each drawn appearance still has its own annotation layer.
      assert.deepEqual(scene.optionalContent.groups.map(group => group.annotationId), ["ref:5:0", "ref:6:0"]);
      assert(scene.optionalContent.groups.every(group => group.locked && !group.usedInView));
      assert.deepEqual(scene.optionalContent.order, [], "annotation layers stay out of the layer order");
      assert.deepEqual(scene.drawRuns.map(run => run.optionalContent), [undefined, undefined, undefined, 0, 0, 1, 1],
        "page content is unconditioned; each appearance's fill and text use its own layer");
      assert(scene.annotations.every(annotation => annotation.optionalContent === undefined),
        "annotation layers are not PDF layer memberships");
      assert(session.getDiagnostics().some(d => d.code === "optional-content.default-view-fallback"));
      await assert.rejects(session.compileVectorPage(0, { limits: { maxCommandsPerPage: 2 } }),
        error => error.code === "resource-limit");
      await assert.rejects(session.compileVectorPage(0, { signal: AbortSignal.abort() }));
    } finally { await session.close(); }
  }

  // Multiply annotations retain their vectors and source alpha at any sheet size.
  for (const largeSheet of [false, true]) {
    const blended = await openPdf({ kind: "bytes", bytes: fixture({ blended: true, largeSheet }) }, options);
    try {
      const scene = await blended.compileVectorPage(0, { vectorFallback: "error" });
      assert.equal(scene.fillPathCount, 2);
      assert.equal(scene.textInstanceCount, 1);
      assert.equal(scene.rasterLayers.length, 1, "only the source image remains raster");
      assert.equal(scene.drawRuns.at(-1).kind, "fill");
      assert.equal(scene.drawRuns.at(-1).blendMode, "Multiply");
      assert.equal(scene.fillPathMetaC[7], 0.5);
      assert(!blended.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
    } finally { await blended.close(); }
  }

  for (const mode of [1, 2]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture({ outlinedMode: mode }) }, options);
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error" });
      assert.equal(scene.fillPathCount, 3, "surrounding page and annotation geometry stays vector");
      assert.equal(scene.textInstanceCount, mode + 2, "filled and stroked glyphs stay in the vector text store");
      assert.equal(scene.rasterLayers.length, 1, "only the original image stays raster");
      assert.equal(scene.rasterLayers[0].width, 2);
      assert.equal(scene.textIndex.pages[0].text.replaceAll(/\s/g, ""), "ABB");
      const index = scene.textIndex.pages[0];
      assert.notEqual(index.charInstance[index.text.indexOf("A")], -1, "outlined text stays searchable");
      assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
    } finally { await session.close(); }
  }

  const outlinedAnnotation = await openPdf({ kind: "bytes", bytes: fixture({ annotationTextMode: 2 }) }, options);
  try {
    const scene = await outlinedAnnotation.compileVectorPage(0, { vectorFallback: "error" });
    assert.equal(scene.fillPathCount, 3);
    assert.equal(scene.textInstanceCount, 5, "page and outlined annotation text remain vectors");
    assert.equal(scene.rasterLayers.length, 1);
    assert.equal(scene.textIndex.pages[0].text.replaceAll(/\s/g, ""), "ABB");
    assert(!outlinedAnnotation.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
  } finally { await outlinedAnnotation.close(); }

  // A static scene has no viewer transform to counter, so NoZoom/NoRotate
  // appearances keep page geometry, as rasters do, and say so.
  for (const flags of [8, 16, 28]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture({ flags }) }, options);
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error" });
      assert.equal(scene.fillPathCount, 3, "the page and both annotations remain vectors");
      assert.equal(scene.rasterLayers.length, 1, "only the original image stays raster");
      const approximated = session.getDiagnostics().filter(d => d.code === "annotation.view-transform-approximated");
      assert.equal(approximated.length, 1);
      assert.equal(approximated[0].details.annotationCount, 1);
      assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
    } finally { await session.close(); }
  }

  for (const [annotationAppearances, fills, layers] of [["none", 1, []], ["forms", 1, []], ["render", 3, ["ref:5:0", "ref:6:0"]]]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture() }, options);
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error", annotationAppearances });
      assert.equal(scene.fillPathCount, fills, `${annotationAppearances}: only the page Form paints without appearances`);
      const groups = scene.optionalContent?.groups ?? [];
      assert.deepEqual(groups.filter(group => group.annotationId).map(group => group.annotationId), layers);
      // Leaving out the hidden-layer annotation's missing appearance also
      // leaves the PDF layer toggleable instead of falling back to the default view.
      assert.deepEqual(groups.filter(group => !group.annotationId).map(group => group.name),
        annotationAppearances === "render" ? [] : ["Hidden annotations"]);
      assert.equal(scene.annotations.length, 5, "metadata is extracted in every mode");
      assert.equal(scene.annotationAppearances, annotationAppearances === "render" ? undefined : annotationAppearances);
      const page = await session.compilePage(0, { annotationAppearances });
      const tagged = page.stores.markedContent.tags.flatMap((tag, index) => tag === "Annot" ? [page.stores.markedContent.propertyNames[index]] : []);
      assert.deepEqual(tagged, layers, "display-program appearance invocations carry their annotation id");
      if (annotationAppearances !== "render") continue;
      assert.equal(getScenePrimitive(scene, { kind: "fill", index: 0 }).annotationId, undefined, "page content has no annotation");
      assert.equal(getScenePrimitive(scene, { kind: "fill", index: 1 }).annotationId, "ref:5:0");
      assert.equal(getScenePrimitive(scene, { kind: "fill", index: 2 }).annotationId, "ref:6:0");
      // The retained lowering attributes the same appearances through their marked content.
      const retained = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
      assert.deepEqual(retained.optionalContent.groups.map(group => group.annotationId), layers);
      const owners = retained.drawRuns.flatMap(run => run.optionalContent === undefined ? []
        : [retained.optionalContent.conditions[run.optionalContent].groupId]);
      assert.deepEqual([...new Set(owners)], ["annotation:ref:5:0", "annotation:ref:6:0"]);
    } finally { await session.close(); }
  }
  const invalid = await openPdf({ kind: "bytes", bytes: fixture() }, options);
  try {
    await assert.rejects(invalid.compileVectorPage(0, { annotationAppearances: "hidden" }), RangeError);
    assert.throws(() => invalid.compilePages({ annotationAppearances: "hidden" }), RangeError);
  } finally { await invalid.close(); }
  console.log("vector annotation placement, visibility, ordering, text, view flags, appearance modes, layers and selective compositing passed");
} finally { hooks.deregister(); }

function fillBounds(scene, index) {
  return [...scene.fillPathMetaA.slice(index * 4 + 2, index * 4 + 4),
    ...scene.fillPathMetaB.slice(index * 4, index * 4 + 2)];
}

function sample(layer, x, y) {
  const [a, b, c, d, e, f] = layer.matrix;
  assert.equal(b, 0); assert.equal(c, 0);
  const px = Math.floor((x - e) / a * layer.width);
  const py = Math.floor((y - f) / d * layer.height);
  assert(px >= 0 && px < layer.width && py >= 0 && py < layer.height);
  return [...layer.data.slice((py * layer.width + px) * 4, (py * layer.width + px + 1) * 4)];
}

function fixture({ rotation = 0, blended = false, largeSheet = false, flags = 4, outlinedMode = 0, annotationTextMode = 0 } = {}) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [14 0 R] /D << /OFF [14 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R " +
      (largeSheet ? "/MediaBox [0 0 4001 2401] " : "/MediaBox [0 0 100 100] /CropBox [10 20 90 80] ") +
      `/Rotate ${rotation} ` +
      `/Annots [7 0 R 5 0 R ${blended ? "" : "6 0 R"} 8 0 R 15 0 R] ` +
      "/Resources << /XObject << /Im 10 0 R /PageForm 11 0 R >> /Font << /F 12 0 R >> /ExtGState << /Gs 13 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "q 100 0 0 100 0 0 cm /Im Do Q /PageForm Do " +
      `BT /F 10 Tf ${outlinedMode} Tr 15 60 Td (A) Tj 0 Tr ET ` +
      "1 0 0 1 60 50 cm 0 0 1 1 re W n 0 0 1 rg /Gs gs") },
    { number: 5, body: `<< /Subtype /Stamp /F ${flags} /Rect [20 30 40 40] /AP << /N 9 0 R >> >>` },
    { number: 6, body: "<< /Subtype /Stamp /F 4 /Rect [50 60 70 70] /AP << /N 9 0 R >> >>" },
    { number: 7, body: "<< /Subtype /Stamp /F 2 /Rect [0 0 10 10] /AP << /N 999 0 R >> >>" },
    { number: 8, body: "<< /Subtype /Stamp /F 32 /Rect [0 0 10 10] /AP << /N 999 0 R >> >>" },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 20] /Matrix [0 1 -1 0 20 0] " +
      "/Resources << /Font << /F 12 0 R >> /ExtGState << /Blend 16 0 R >> >>",
      blended ? "/Blend gs .5 g 0 0 10 20 re f" :
        `0 0 10 20 re f BT /F 10 Tf ${annotationTextMode} Tr 2 2 Td (B) Tj ET`) },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8",
      Uint8Array.from(Array.from({ length: 4 }, () => [200, 100, 50]).flat())) },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << >>", "1 0 0 rg 15 25 5 5 re f") },
    { number: 12, body: "<< /Type /Font /Subtype /TrueType /BaseFont /AnnotationFixture /Encoding /WinAnsiEncoding >>" },
    { number: 13, body: "<< /ca .25 >>" },
    { number: 14, body: "<< /Type /OCG /Name (Hidden annotations) >>" },
    { number: 15, body: "<< /Subtype /Stamp /F 4 /Rect [0 0 10 10] /OC 14 0 R /AP << /N 999 0 R >> >>" },
    { number: 16, body: "<< /BM /Multiply /ca .5 >>" }
  ] });
}
