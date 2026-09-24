import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")
    ? `${specifier}.ts` : specifier, context);
} });
const groups = scene => {
  const result = [];
  const visit = nodes => { for (const node of nodes) if (node.kind === "group") {
    result.push(node); visit(node.children); if (node.softMask) visit(node.softMask.children);
  } };
  visit(scene.paintGraph.roots); return result;
};
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

try {
  const [{ openPdf }, { lowerRetainedPageToVectorScene }, { sceneRequiresPaintCompositing },
    { validateScenePaintGraph }, { OptionalContentController }, { isScenePrimitiveVisible }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/retainedVectorPage.ts"), import("../src/scenePaintVisibility.ts"),
    import("../src/scenePaintGraph.ts"), import("../src/optionalContent.ts"), import("../src/scenePrimitives.ts")
  ]);
  const fixture = (content, { state = "/ca .4 /CA .4", resources = "", objects = [], layers = false } = {}) => writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R ${layers ? "/OCProperties << /OCGs [8 0 R] /D << /BaseState /OFF >> >>" : ""} >>` },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /Alpha << ${state} >> >> /Font << /F 5 0 R >> /Properties << /Layer 8 0 R >> ${resources} >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /OpacityFixture /Encoding /WinAnsiEncoding >>" },
    { number: 8, body: "<< /Type /OCG /Name (Opacity layer) >>" }, ...objects
  ] });
  const compile = async (content, options = {}) => {
    const session = await openPdf({ kind: "bytes", bytes: fixture(content, options) }, {
      missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "single-paint-opacity-fixture" })
    });
    try {
      const optionalContent = options.layers
        ? (await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" })).optionalContent : undefined;
      const page = await session.compilePage(0, { retainOptionalContent: true, optimization: "none" });
      return { page, optionalContent };
    } finally { await session.close(); }
  };
  const lower = async ({ page, optionalContent }) => {
    const original = structuredClone(page);
    const scene = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal, optionalContent });
    assert.deepEqual(page, original, "opacity folding never changes reusable source stores or group metadata");
    validateScenePaintGraph(scene);
    assert.equal(scene.rasterLayers.length, 0);
    return scene;
  };
  const fillFixture = await compile("/Alpha gs .2 .4 .6 rg 10 10 25 25 re 20 20 25 25 re f*");
  {
    const scene = await lower(fillFixture);
    assert.equal(scene.fillPathCount, 1, "multiple contours remain one analytic paint");
    close(scene.fillPathMetaC[3], .4, "single fill owns its former group opacity");
    assert(groups(scene).every(group => group.alpha === 1), "group node survives with unit opacity");
    assert.equal(sceneRequiresPaintCompositing(scene), false);
    compareCanvasPixels(scene.fillPathMetaC[3]);
  }
  {
    const scene = await lower(await compile("/Alpha gs .2 .4 .6 rg BT /F 40 Tf 10 20 Td (A) Tj ET"));
    assert.equal(scene.textInstanceCount, 1);
    close(scene.textInstanceC[3], .4, "a single analytic glyph owns its group opacity");
    assert.equal(sceneRequiresPaintCompositing(scene), false);
    assert.match(scene.textIndex.pages[0].text, /A/);
  }
  {
    const scene = await lower(await compile("/OC /Layer BDC q 0 0 30 30 re W n /Alpha gs 10 10 40 40 re f Q EMC", { layers: true }));
    close(scene.fillPathMetaC[3], .4, "layered fill opacity folds");
    assert(scene.drawRuns[0].clipIndex >= 0, "the exact clipping scope survives");
    assert(groups(scene).some(group => group.optionalContent !== undefined), "the group visibility scope survives");
    const controller = new OptionalContentController(scene);
    try {
      const visible = condition => controller.isVisible(condition);
      assert.equal(isScenePrimitiveVisible(scene, { kind: "fill", index: 0 }, visible), false);
      await controller.setLayerVisibility(scene.optionalContent.groups[0].id, true);
      assert.equal(isScenePrimitiveVisible(scene, { kind: "fill", index: 0 }, visible), true);
    } finally { controller.dispose(); }
  }
  for (const [name, mutate] of [
    ["blend mode", group => { group.blendMode = "Multiply"; }],
    ["knockout", group => { group.knockout = true; }],
    ["alpha-as-shape", group => { group.alphaIsShape = true; }]
  ]) {
    const input = structuredClone(fillFixture);
    const effect = input.page.displayProgram.groups.find(group => Math.abs(group.alpha - .4) < 1e-6);
    assert(effect); mutate(effect);
    const scene = await lower(input);
    assert(groups(scene).some(group => Math.abs(group.alpha - .4) < 1e-6), `${name} keeps its group opacity`);
    assert.equal(scene.fillPathMetaC[3], 1, `${name} leaves primitive alpha alone`);
  }
  for (const property of ["knockout", "alphaIsShape"]) {
    const input = structuredClone(fillFixture);
    input.page.displayProgram.groups[input.page.displayProgram.rootGroupIndex][property] = true;
    const scene = await lower(input);
    assert(groups(scene).some(group => Math.abs(group.alpha - .4) < 1e-6), `${property} ancestor prevents opacity folding`);
    assert.equal(scene.fillPathMetaC[3], 1);
  }
  {
    const scene = await lower(await compile("/Alpha gs /Form Do", {
      resources: "/XObject << /Form 10 0 R >>",
      objects: [{ number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] " +
        "/Group << /S /Transparency /I true >> /Resources << >>", "1 0 0 rg 10 10 30 30 re f 20 20 30 30 re f") }]
    }));
    assert.equal(scene.fillPathCount, 2);
    assert(groups(scene).some(group => Math.abs(group.alpha - .4) < 1e-6), "overlapping paints keep their shared opacity boundary");
    assert.equal(scene.fillPathMetaC[3], 1);
    assert.equal(scene.fillPathMetaC[7], 1, "opacity is not distributed over overlapping siblings");
    assert.equal(sceneRequiresPaintCompositing(scene), true);
  }
  {
    const scene = await lower(await compile("/Alpha gs 10 10 30 30 re f", {
      state: "/ca .4 /SMask << /S /Alpha /G 10 0 R >>",
      objects: [{ number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] " +
        "/Group << /S /Transparency /I true /CS /DeviceRGB >> /Resources << >>", "1 1 1 rg 0 0 20 100 re f") }]
    }));
    assert(groups(scene).some(group => group.softMask && Math.abs(group.alpha - .4) < 1e-6),
      "masked paint keeps the opacity on its mask/composite boundary");
    assert.equal(sceneRequiresPaintCompositing(scene), true);
  }
  {
    const scene = await lower(await compile("/Alpha gs 1 J 1 j 0 w BT /F 40 Tf 1 Tr 10 20 Td (A) Tj ET"));
    assert(scene.segmentCount > 1);
    assert(groups(scene).some(group => Math.abs(group.alpha - .4) < 1e-6), "hairline contours keep opacity on their union");
    for (let index = 3; index < scene.primitiveMeta.length; index += 4) {
      const encoded = scene.primitiveMeta[index];
      assert.equal(encoded - 2 * Math.floor(encoded / 2), 1, "individual hairline edges remain opaque");
    }
  }
  console.log("Single-paint opacity folding passed: Canvas pixels, glyphs, layers/clips, immutable stores and composite refusal guards.");
} finally { hooks.deregister(); }

function compareCanvasPixels(foldedAlpha) {
  const shape = context => {
    context.beginPath();
    context.rect(2.25, 2.375, 8.5, 8.25);
    context.rect(6.5, 5.125, 7.125, 8.5);
    context.fillStyle = "rgb(51,102,153)";
    context.fill("evenodd");
  };
  for (const backdropAlpha of [0, .35, 1]) {
    const image = direct => {
      const canvas = createCanvas(16, 16), context = canvas.getContext("2d");
      context.fillStyle = `rgba(180,80,40,${backdropAlpha})`; context.fillRect(0, 0, 16, 16);
      if (direct) { context.globalAlpha = foldedAlpha; shape(context); }
      else {
        const layer = createCanvas(16, 16); shape(layer.getContext("2d"));
        context.globalAlpha = .4; context.drawImage(layer, 0, 0);
      }
      return context.getImageData(0, 0, 16, 16).data;
    };
    const expected = image(false), actual = image(true);
    for (let offset = 0; offset < actual.length; offset += 4) {
      // Compare premultiplied pixels: unassociated RGB is unstable at tiny AA alpha.
      for (let channel = 0; channel < 3; channel += 1) {
        const a = actual[offset + channel] * actual[offset + 3] / 255;
        const b = expected[offset + channel] * expected[offset + 3] / 255;
        assert(Math.abs(a - b) <= 2, `single-paint opacity changes no antialiased Canvas color: ${a} != ${b}`);
      }
      assert(Math.abs(actual[offset + 3] - expected[offset + 3]) <= 1);
    }
  }
}
