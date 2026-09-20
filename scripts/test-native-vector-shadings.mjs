import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const side = 80, scale = 4;
let sampleSceneGradientChannel;
try {
  ({ sampleSceneGradientChannel } = await import("../src/gradientSampling.ts"));
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { defaultVectorDrawRuns, validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { supportedNativeVectorShadings, buildNativeVectorGradients } = await import("../src/pdf/nativeVectorGradients.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const curve = "10 15 m 10 60 60 70 65 20 c 40 5 20 5 10 15 c h W n";
  const cases = [
    { name: "sheared shading with nested curved and even-odd clips",
      content: `q 4 4 72 72 re 25 25 15 15 re W* n ${curve} 30 12 10 24 15 12 cm /S sh Q` },
    { name: "source order and alpha restored by q/Q",
      content: `0 1 0 rg 0 0 80 80 re f q /A gs 5 5 55 55 re W n 40 0 0 40 10 10 cm /S sh Q ` +
        `0 0 0 rg 28 25 12 12 re f q 45 45 20 20 re W n 20 0 0 20 45 45 cm /S sh Q`,
      order: ["fill", "gradient-fill", "fill", "gradient-fill"] },
    { name: "spot-color stitching function used by the Windows PDF", spot: true,
      content: `q ${curve} 0 -35 -35 0 60 55 cm /S sh Q` },
    { name: "rotated shading retains its own bounding box", bbox: "/BBox [.1 .15 .85 .8]",
      content: "q 35 8 -12 38 25 15 cm /S sh Q" },
    { name: "nonlinear color function and clipped parameter domain", domain: "/Domain [.2 .8]", exponent: 2,
      content: "q 8 10 60 45 re W n 50 0 15 30 12 10 cm /S sh Q" },
    { name: "Form flattening preserves root gradients on either side",
      content: "q 35 0 0 35 10 10 cm /S sh Q /F Do q 45 45 15 15 re W n 15 0 0 15 45 45 cm /S sh Q",
      order: ["gradient-fill", "fill", "gradient-fill"] },
    { name: "radial expanding circles stay vector", shadingType: 3, coords: "0 0 0 0 0 1",
      content: "q 28 0 0 28 40 40 cm /S sh Q" },
    { name: "radial shrinking circles stay vector", shadingType: 3, coords: "0 0 1 0 0 .2",
      content: "q 28 0 0 28 40 40 cm /S sh Q" },
    { name: "radial disabled extensions", shadingType: 3, coords: "0 0 .2 0 0 1", extend: "false false",
      content: "q 28 0 0 28 40 40 cm /S sh Q" },
    { name: "axial disabled start", extend: "false true", content: "q 30 0 0 30 25 10 cm /S sh Q" },
    { name: "axial disabled end", extend: "true false", content: "q 30 0 0 30 25 10 cm /S sh Q" },
    { name: "sh ignores Background while respecting its BBox", extend: "false false", background: "/Background [0 1 0]",
      bbox: "/BBox [-.5 0 1.5 1]", content: "q 30 0 0 30 25 10 cm /S sh Q" },
    { name: "scoped shading in transformed Form", shadingForm: true, content: "q 1 .2 -.1 1 2 1 cm /F Do Q" },
    { name: "annotation flattening preserves the root shading", annotation: true,
      content: "q 50 0 0 50 10 10 cm /S sh Q", order: ["gradient-fill", "fill"], count: 1 }
  ];
  let persisted;
  for (const entry of cases) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(entry) });
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
      assert.equal(scene.rasterLayers.length, 0, entry.name);
      assert.equal(scene.gradientFillPathCount, entry.count ?? (entry.order ? 2 : 1), entry.name);
      validateVectorDrawRuns(scene);
      const runs = scene.drawRuns ?? defaultVectorDrawRuns(scene);
      if (entry.order) assert.deepEqual(runs.map(run => run.kind), entry.order);
      if (entry === cases[0]) assert(scene.clipPaths.length >= 2, "nested curved and even-odd clips survive");
      const reference = await renderHeprPageToCanvas2d(await session.compilePage(0), { scale, surfaceFactory });
      const expected = reference.surface.context.getImageData(0, 0, side * scale, side * scale).data;
      const actual = renderScene(scene, runs);
      assertPixelsClose(actual, expected, entry.name);
      if (entry === cases[0]) persisted = { scene, pixels: actual };
    } finally { await session.close(); }
  }
  const descriptions = [
    { shadingType: 2, coordinates: [0, 0, 1, 0], extend: [true, true], background: null },
    { shadingType: 2, coordinates: [0, 0, 1, 0], extend: [false, true], background: null },
    { shadingType: 2, coordinates: [0, 0, 1, 0], extend: [true, true], background: [0] },
    { shadingType: 2, coordinates: [0, 0, 0, 0], extend: [true, true], background: null },
    { shadingType: 3, coordinates: [0, 0, 0, 1, 1, 2], extend: [true, true], background: null }
  ];
  assert.deepEqual([...supportedNativeVectorShadings({ size: descriptions.length, describe: i => descriptions[i] })], [0, 1, 2, 4],
    "axial/radial domains stay vector; a degenerate axis remains unsupported");
  assert.throws(() => buildNativeVectorGradients(new Array(4097), undefined, 10000), error => error.code === "resource-limit",
    "shading color tables have a bounded allocation independent of the ordinary path limit");
  assert.throws(() => buildNativeVectorGradients(new Array(2), undefined, 100, undefined, 16), error => error.code === "resource-limit",
    "generated shading geometry respects the coordinate budget before allocation");
  const mixed = await openPdf({ kind: "bytes", bytes: fixture({
    content: "q 0 0 35 80 re W n 35 0 0 80 0 0 cm /S sh Q q 45 0 35 80 re W n /R sh Q 0 1 0 rg 0 0 10 10 re f"
  }) });
  try {
    const scene = await mixed.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.gradientFillPathCount, 2, "non-extended shading joins the analytic path");
    assert.equal(scene.rasterLayers.length, 0, "endpoint restrictions do not create raster layers");
    assert.deepEqual(scene.drawRuns.map(run => run.kind), ["gradient-fill", "gradient-fill", "fill"]);
    validateVectorDrawRuns(scene);
  } finally { await mixed.close(); }
  // Tiny synthetic in-memory persistence, never a user-document archive.
  const archive = await buildHep(persisted.scene, { encodeRasterImages: false, compression: "store" });
  const restored = await loadSceneFromHep(await archive.arrayBuffer());
  assert.deepEqual(restored.drawRuns, persisted.scene.drawRuns);
  // v8 stores clip edges on the shared 1/512 fixed-point grid.
  assert.equal(restored.clipPaths.length, persisted.scene.clipPaths.length);
  restored.clipPaths.forEach((clip, index) => {
    const source = persisted.scene.clipPaths[index];
    assert.equal(clip.parent, source.parent);
    assert.equal(clip.fillRule, source.fillRule);
    assert.equal(clip.edges.length, source.edges.length);
    clip.edges.forEach((value, offset) => assert(Math.abs(value - source.edges[offset]) <= 1 / 1024,
      `clip ${index} edge ${offset}: ${value} vs ${source.edges[offset]}`));
  });
  assertPixelsClose(renderScene(restored, restored.drawRuns ?? defaultVectorDrawRuns(restored)), persisted.pixels,
    "gradient HEP roundtrip");
  console.log(`native vector shadings: ${cases.length} independent Canvas comparisons, limits, ordering and HEP roundtrip passed`);
} finally { hooks.deregister(); }

function fixture({ content, spot = false, bbox = "", domain = "", exponent = 1, annotation = false,
  shadingType = 2, coords = "0 0 1 0", extend = "true true", background = "", shadingForm = false }) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${side} ${side}] /Resources << /Shading << /S 5 0 R /R 9 0 R >> /XObject << /F 10 0 R >> /ExtGState << /A << /ca .4 >> >> >> ${annotation ? "/Annots [11 0 R]" : ""} /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: `<< /ShadingType ${shadingType} /Coords [${coords}] /ColorSpace ${spot ? "[/Separation /PANTONE407C /DeviceCMYK 8 0 R]" : "/DeviceRGB"} /Function ${spot ? "7" : "6"} 0 R /Extend [${extend}] ${bbox} ${domain} ${background} >>` },
    { number: 6, body: `<< /FunctionType 2 /Domain [0 1] /C0 ${spot ? "[.15]" : "[1 .1 .2]"} /C1 ${spot ? "[.9]" : "[.1 .4 .9]"} /N ${exponent} >>` },
    { number: 7, body: "<< /FunctionType 3 /Domain [0 1] /Functions [6 0 R] /Bounds [] /Encode [0 1] >>" },
    { number: 8, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 .0800018 .0899963 .259995] /N 1 >>" },
    { number: 9, body: "<< /ShadingType 2 /Coords [45 0 80 0] /ColorSpace /DeviceRGB /Function 6 0 R /Extend [false false] >>" },
    { number: 10, body: tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [20 20 40 40] /Resources << ${shadingForm ? "/Shading << /Inner 5 0 R >>" : ""} >>`,
      shadingForm ? "20 0 0 20 20 20 cm /Inner sh" : "0 0 1 rg 20 20 20 20 re f") },
    { number: 11, body: "<< /Type /Annot /Subtype /Square /Rect [20 20 40 40] /AP << /N 10 0 R >> >>" }
  ] });
}
function surfaceFactory(width, height) {
  const canvas = createCanvas(width, height);
  return { canvas, context: canvas.getContext("2d") };
}
function renderScene(scene, runs) {
  const { context } = surfaceFactory(side * scale, side * scale);
  context.setTransform(scale, 0, 0, -scale, 0, side * scale);
  for (const run of runs) {
    context.save();
    for (let index = run.clipIndex; index !== undefined && index >= 0;) {
      const clip = scene.clipPaths[index];
      context.beginPath();
      let lastX, lastY;
      for (let offset = 0; offset < clip.edges.length; offset += 4) {
        const [x0, y0, x1, y1] = clip.edges.slice(offset, offset + 4);
        if (lastX !== x0 || lastY !== y0) context.moveTo(x0, y0);
        context.lineTo(x1, y1); lastX = x1; lastY = y1;
      }
      context.clip(clip.fillRule ? "evenodd" : "nonzero"); index = clip.parent;
    }
    for (let index = run.first; index < run.first + run.count; index++) {
      const i = index * 4;
      if (run.kind === "fill") {
        const a = scene.fillPathMetaA, b = scene.fillPathMetaB, c = scene.fillPathMetaC;
        context.beginPath();
        for (let segment = a[i]; segment < a[i] + a[i + 1]; segment++) {
          const offset = segment * 4;
          const start = scene.fillSegmentsA.subarray(offset, offset + 2);
          const end = scene.fillSegmentsB.subarray(offset, offset + 2);
          if (segment === a[i]) context.moveTo(...start);
          context.lineTo(...end);
        }
        context.fillStyle = `rgba(${b[i + 2] * 255},${b[i + 3] * 255},${c[i + 2] * 255},${c[i + 3]})`;
        context.fill(c[i] ? "evenodd" : "nonzero");
      } else {
        assert.equal(run.kind, "gradient-fill");
        const layer = surfaceFactory(side * scale, side * scale);
        const image = layer.context.createImageData(side * scale, side * scale);
        const gradient = scene.gradientFillPaintMeta[i];
        const bounds = scene.gradientFillPathMetaA, boundsEnd = scene.gradientFillPathMetaB;
        for (let py = 0; py < side * scale; py++) for (let px = 0; px < side * scale; px++) {
          const x = (px + .5) / scale, y = side - (py + .5) / scale;
          if (x < bounds[i + 2] || y < bounds[i + 3] || x > boundsEnd[i] || y > boundsEnd[i + 1]) continue;
          const offset = (py * side * scale + px) * 4;
          for (let channel = 0; channel < 4; channel++) {
            image.data[offset + channel] = sampleSceneGradientChannel(scene, gradient, x, y, channel) *
              (channel === 3 ? scene.gradientFillPathMetaC[i + 3] : 1) * 255;
          }
        }
        layer.context.putImageData(image, 0, 0);
        context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(layer.canvas, 0, 0); context.restore();
      }
    }
    context.restore();
  }
  return context.getImageData(0, 0, side * scale, side * scale).data;
}
function assertPixelsClose(actual, expected, message) {
  let difference = 0, ink = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    const aa = actual[offset + 3] / 255, ea = expected[offset + 3] / 255;
    for (let channel = 0; channel < 3; channel++) difference += Math.abs(actual[offset + channel] * aa - expected[offset + channel] * ea);
    difference += Math.abs(actual[offset + 3] - expected[offset + 3]);
    ink += expected[offset + 3] * 4;
  }
  assert(ink > 0, `${message}: reference contains visible ink`);
  assert(difference / ink < .025, `${message}: premultiplied pixel error ${difference / ink}`);
}
