import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const scale = 6;
const side = 80;
const rgba = (color) => `rgba(${color[0] * 255},${color[1] * 255},${color[2] * 255},${color[3]})`;
const triangle = (x, y, size = 8) => `${x} ${y} m ${x + size} ${y} l ${x} ${y + size} l h`;

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { defaultVectorDrawRuns, validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { computeCharQuad } = await import("../src/sceneTextGeometry.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfSource.ts");
  const { visitHeprPath } = await import("../src/heprPathGeometry.ts");
  const options = { missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "outlined-text-integration" }) };
  const cases = [
    {
      name: "stroke-only text retains its hollow shape and search reference", text: "A", instances: 1,
      content: "0 0 1 RG 2 w BT /F 80 Tf 1 Tr 10 10 Td (A) Tj ET",
      reference: `0 0 1 RG 2 w ${triangle(10, 10)} S`
    },
    {
      name: "overlapping glyphs fill then stroke individually with distinct alpha", text: "AA", instances: 4,
      content: "/Outer gs 1 0 0 rg 0 0 1 RG 2 w BT /F 80 Tf 2 Tr -44 Tc 10 10 Td (AA) Tj ET",
      reference: `/Outer gs 1 0 0 rg 0 0 1 RG 2 w ${triangle(10, 10)} B ${triangle(14, 10)} B`,
      check(scene) {
        const sequence = scene.drawRuns.flatMap(run => Array.from({ length: run.count }, (_, i) => run.first + i));
        assert.deepEqual(sequence, [0, 2, 1, 3], "second glyph fill must cover the preceding glyph's stroke");
      }
    },
    {
      name: "line width and dashes follow CTM independently of Tf, Tm and Tz", text: "A", instances: 2,
      content: "q 1.6 .2 .35 .7 6 12 cm /Outer gs 1 0 0 rg 0 0 1 RG 2 w 1 j 1 J [2 1] .4 d " +
        "BT /F 60 Tf 65 Tz 2 Tr .8 .25 -.1 1.2 7 8 Tm (A) Tj ET Q",
      reference: "q 1.6 .2 .35 .7 6 12 cm /Outer gs 1 0 0 rg 0 0 1 RG 2 w 1 j 1 J [2 1] .4 d " +
        "7 8 m 10.12 8.975 l 6.4 15.2 l h B Q"
    },
    {
      name: "q/Q restores stroke colors, alpha and line width", text: "ABA", instances: 3,
      content: "/Outer gs 0 0 1 RG 2 w BT /F 80 Tf 1 Tr 10 10 Td (A) Tj ET " +
        "q /Inner gs 0 1 0 RG 3 w BT /F 80 Tf 1 Tr 28 10 Td (B) Tj ET Q " +
        "BT /F 80 Tf 1 Tr 50 10 Td (A) Tj ET",
      reference: `/Outer gs 0 0 1 RG 2 w ${triangle(10, 10)} S ` +
        `q /Inner gs 0 1 0 RG 3 w ${triangle(32, 10)} S Q ${triangle(50, 10)} S`,
      check(scene) {
        const colors = [...scene.textInstanceC];
        assert.deepEqual(colors.slice(0, 3), [0, 0, 1]);
        assert.deepEqual(colors.slice(4, 7), [0, 1, 0]);
        assert.deepEqual(colors.slice(8, 11), [0, 0, 1]);
        assert.equal(colors[3], colors[11]);
        assert(colors[7] < colors[3]);
      }
    },
    {
      name: "Form matrix and exact caller clip cover fill and stroke", text: "A", instances: 2, form: true,
      content: "/Outer gs 1 0 0 rg 0 0 1 RG 2 w BT /F 80 Tf 2 Tr 8 8 Td (A) Tj ET",
      reference: `/Outer gs 1 0 0 rg 0 0 1 RG 2 w ${triangle(8, 8)} B`,
      check(scene) {
        assert(scene.clipPaths.length >= 2, "caller triangle and transformed Form BBox both survive");
        assert(scene.drawRuns.every(run => run.clipIndex !== undefined));
      }
    },
    {
      name: "translated strokes share outlines across colors and independent clips", text: "AA", instances: 2,
      content: "q 10 10 4 8 re W n 0 0 1 RG 2 w BT /F 80 Tf 1 Tr 10 10 Td (A) Tj ET Q " +
        "q 30 10 8 4 re W n 1 0 0 RG 2 w BT /F 80 Tf 1 Tr 30 10 Td (A) Tj ET Q",
      reference: `q 10 10 4 8 re W n 0 0 1 RG 2 w ${triangle(10, 10)} S Q ` +
        `q 30 10 8 4 re W n 1 0 0 RG 2 w ${triangle(30, 10)} S Q`,
      check(scene) {
        assert.equal(scene.textInstanceB[2], scene.textInstanceB[6], "color, placement and clips do not duplicate the outline");
        assert.notEqual(scene.textInstanceB[0], scene.textInstanceB[4], "placement stays on the instance");
        assert.notEqual(scene.textInstanceB[3], scene.textInstanceB[7], "each instance preserves its own clip rectangle");
      }
    },
    {
      name: "different pen widths retain different outlines", text: "AA", instances: 2,
      content: "0 0 1 RG 1 w BT /F 80 Tf 1 Tr 10 10 Td (A) Tj ET " +
        "3 w BT /F 80 Tf 1 Tr 30 10 Td (A) Tj ET",
      reference: `0 0 1 RG 1 w ${triangle(10, 10)} S 3 w ${triangle(30, 10)} S`,
      check(scene) { assert.notEqual(scene.textInstanceB[2], scene.textInstanceB[6]); }
    },
    {
      name: "invisible fill leaves a searchable visible outline", text: "A", instances: 1,
      state: "/ca 0 /CA .5",
      content: "/Outer gs 1 0 0 rg 0 0 1 RG 2 w BT /F 80 Tf 2 Tr 10 10 Td (A) Tj ET",
      reference: `/Outer gs 1 0 0 rg 0 0 1 RG 2 w ${triangle(10, 10)} B`
    },
    {
      name: "invisible stroke keeps the ordinary fill", text: "A", instances: 1,
      state: "/ca .5 /CA 0",
      content: "/Outer gs 1 0 0 rg 0 0 1 RG 2 w BT /F 80 Tf 2 Tr 10 10 Td (A) Tj ET",
      reference: `/Outer gs 1 0 0 rg 0 0 1 RG 2 w ${triangle(10, 10)} B`
    }
  ];
  let persisted;
  for (const entry of cases) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(entry) }, options);
    const reference = await openPdf({ kind: "bytes", bytes: fixture({ ...entry, content: entry.reference }) });
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
      assert.equal(scene.rasterLayers.length, 0, entry.name);
      assert.equal(scene.textInstanceCount, entry.instances, entry.name);
      assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")), entry.name);
      validateVectorDrawRuns(scene);
      const index = scene.textIndex.pages[0];
      assert.equal(index.text.replaceAll(/\s/g, ""), entry.text, entry.name);
      for (let char = 0; char < index.text.length; char++) {
        if (/\s/.test(index.text[char])) continue;
        assert.notEqual(index.charInstance[char], -1, `${entry.name}: search retains the outlined glyph`);
        const bounds = new Float32Array(4);
        assert(computeCharQuad(scene, index, char, bounds, 0));
        assert(bounds[2] > bounds[0] && bounds[3] > bounds[1]);
      }
      entry.check?.(scene);
      // The independent oracle draws this fixture font's known triangular
      // contours as PDF paths. Canvas text itself would scale stroke widths by
      // the glyph transform; path stroking keeps widths in graphics-state space.
      const expected = await renderHeprPageToCanvas2d(await reference.compilePage(0), { scale, surfaceFactory });
      const actual = renderVectorText(scene, defaultVectorDrawRuns);
      assertPixelsClose(actual, expected.surface.context.getImageData(0, 0, side * scale, side * scale).data, entry.name);
      if (entry === cases[0]) {
        await assert.rejects(session.compileVectorPage(0, {
          vectorFallback: "error", limits: { maxPathCoordinatesPerPage: 24 }
        }), error => error.code === "resource-limit" && error.details?.reason === "vector-glyph-stroke-limit",
        "expanded glyph outlines count toward the geometry budget");
      }
      if (entry.form) persisted = { scene, pixels: actual };
    } finally { await reference.close(); await session.close(); }
  }

  // A curved font with miter limit 1 used to exhaust the stroke edge budget
  // even at ordinary text sizes. Compare its vector outline with Canvas
  // stroking the retained font curves, without depending on a user PDF.
  for (const renderingMode of [1, 2]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture({
      fontName: "Courier",
      content: `/Outer gs 1 0 0 rg 0 0 1 RG .16 w 1 M BT /F 12 Tf ${renderingMode} Tr 10 10 Td (S) Tj ET`
    }) }, { missingFontResolver: createNodeBundledStandardFontResolver() });
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
      assert.equal(scene.rasterLayers.length, 0, "thin curved glyphs stay vector at miter limit 1");
      assert.equal(scene.textInstanceCount, renderingMode === 1 ? 1 : 2);
      assert.equal(scene.textIndex.pages[0].text, "S");
      const bounds = new Float32Array(4);
      assert(computeCharQuad(scene, scene.textIndex.pages[0], 0, bounds, 0));
      assert(bounds[2] > bounds[0] && bounds[3] > bounds[1], "search retains the curved glyph bounds");
      assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
      assert(session.getDiagnostics().some(d => d.code === "glyph-stroke-curve-approximation"));
      validateVectorDrawRuns(scene);
      // At high zoom, subpixel stroke/fill antialiasing differences do not
      // dominate the comparison of these thin geometric outlines.
      const curveScale = 48, curveSide = 24;
      const expected = renderCurvedGlyphReference(await session.compilePage(0), renderingMode, visitHeprPath,
        curveScale, curveSide);
      assertPixelsClose(renderVectorText(scene, defaultVectorDrawRuns, curveScale, curveSide),
        expected,
        `curved glyph with miter limit 1, rendering mode ${renderingMode}`);
    } finally { await session.close(); }
  }

  // A tiny in-memory synthetic scene exercises HEP persistence without
  // converting a user document or writing an archive to disk.
  const archive = await buildHep(persisted.scene, { encodeRasterImages: false, compression: "store" });
  const restored = await loadSceneFromHep(await archive.arrayBuffer());
  assert.deepEqual(restored.drawRuns, persisted.scene.drawRuns);
  assert.deepEqual(restored.clipPaths, persisted.scene.clipPaths);
  assert.deepEqual(restored.textIndex, persisted.scene.textIndex);
  assertPixelsClose(renderVectorText(restored, defaultVectorDrawRuns), persisted.pixels, "HEP outlined text roundtrip");
  console.log(`outlined text integration: ${cases.length + 2} independent Canvas comparisons, search and HEP roundtrip passed`);
} finally { hooks.deregister(); }

function surfaceFactory(width, height) {
  const canvas = createCanvas(width, height);
  return { canvas, context: canvas.getContext("2d") };
}

function renderCurvedGlyphReference(page, renderingMode, visitPath, renderScale, renderSide) {
  const { context } = surfaceFactory(renderSide * renderScale, renderSide * renderScale);
  context.setTransform(renderScale, 0, 0, -renderScale, 0, renderSide * renderScale);
  const { fonts, glyphs, transforms, paths } = page.stores;
  const font = glyphs.fontIndices[0];
  let record = fonts.glyphOffsets[font];
  while (record < fonts.glyphOffsets[font + 1] && fonts.glyphIds[record] !== glyphs.glyphIds[0]) record++;
  assert(record < fonts.glyphOffsets[font + 1]);
  const [a, b, c, d, e, f] = transforms.values.subarray(glyphs.transformIndices[0] * 6, glyphs.transformIndices[0] * 6 + 6);
  const point = (x, y) => [a * x + c * y + e, b * x + d * y + f];
  const visitor = {
    moveTo: (x, y) => context.moveTo(...point(x, y)),
    lineTo: (x, y) => context.lineTo(...point(x, y)),
    quadraticTo: (cx, cy, x, y) => context.quadraticCurveTo(...point(cx, cy), ...point(x, y)),
    cubicTo: (c1x, c1y, c2x, c2y, x, y) => context.bezierCurveTo(...point(c1x, c1y), ...point(c2x, c2y), ...point(x, y)),
    close: () => context.closePath()
  };
  context.beginPath();
  for (let path = fonts.outlinePathStarts[record]; path < fonts.outlinePathStarts[record] + fonts.outlinePathCounts[record]; path++) {
    visitPath(paths, path, visitor);
  }
  if (renderingMode === 2) { context.fillStyle = rgba([1, 0, 0, .45]); context.fill("nonzero"); }
  context.strokeStyle = rgba([0, 0, 1, .65]);
  context.lineWidth = .16;
  context.lineJoin = "miter";
  context.miterLimit = 1;
  context.stroke();
  return context.getImageData(0, 0, renderSide * renderScale, renderSide * renderScale).data;
}

function renderVectorText(scene, defaultRuns, renderScale = scale, renderSide = side) {
  const { context } = surfaceFactory(renderSide * renderScale, renderSide * renderScale);
  context.setTransform(renderScale, 0, 0, -renderScale, 0, renderSide * renderScale);
  for (const run of scene.drawRuns ?? defaultRuns(scene)) {
    assert.equal(run.kind, "text", "this oracle only renders text-filled vector paths");
    context.save();
    for (let clipIndex = run.clipIndex; clipIndex !== undefined && clipIndex >= 0;) {
      const clip = scene.clipPaths[clipIndex];
      context.beginPath();
      let lastX, lastY;
      for (let offset = 0; offset < clip.edges.length; offset += 4) {
        const [x0, y0, x1, y1] = clip.edges.slice(offset, offset + 4);
        if (x0 !== lastX || y0 !== lastY) context.moveTo(x0, y0);
        context.lineTo(x1, y1); lastX = x1; lastY = y1;
      }
      context.clip(clip.fillRule ? "evenodd" : "nonzero");
      clipIndex = clip.parent;
    }
    for (let instance = run.first; instance < run.first + run.count; instance++) {
      const offset = instance * 4;
      context.save();
      const clipOffset = (scene.textInstanceB[offset + 3] - 1) * 4;
      if (clipOffset >= 0) {
        const [x0, y0, x1, y1] = scene.textClipRects.slice(clipOffset, clipOffset + 4);
        context.beginPath(); context.rect(x0, y0, x1 - x0, y1 - y0); context.clip();
      }
      context.transform(...scene.textInstanceA.slice(offset, offset + 4), ...scene.textInstanceB.slice(offset, offset + 2));
      context.fillStyle = rgba(scene.textInstanceC.slice(offset, offset + 4));
      const glyph = scene.textInstanceB[offset + 2] * 4;
      const first = scene.textGlyphMetaA[glyph];
      const end = first + scene.textGlyphMetaA[glyph + 1];
      context.beginPath();
      let startX, startY, lastX, lastY;
      for (let segment = first; segment < end; segment++) {
        const i = segment * 4;
        const [x0, y0, controlX, controlY] = scene.textGlyphSegmentsA.slice(i, i + 4);
        const [x1, y1, curved] = scene.textGlyphSegmentsB.slice(i, i + 3);
        if (lastX === undefined || x0 !== lastX || y0 !== lastY) {
          if (startX !== undefined) context.closePath();
          context.moveTo(x0, y0); startX = x0; startY = y0;
        }
        if (curved >= 1) context.quadraticCurveTo(controlX, controlY, x1, y1);
        else context.lineTo(x1, y1);
        lastX = x1; lastY = y1;
        if (x1 === startX && y1 === startY) {
          context.closePath(); startX = startY = lastX = lastY = undefined;
        }
      }
      if (startX !== undefined) context.closePath();
      context.fill("nonzero"); context.restore();
    }
    context.restore();
  }
  return context.getImageData(0, 0, renderSide * renderScale, renderSide * renderScale).data;
}

function assertPixelsClose(actual, expected, message) {
  let difference = 0, ink = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    const aa = actual[offset + 3] / 255, ea = expected[offset + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      difference += Math.abs(actual[offset + channel] * aa - expected[offset + channel] * ea);
    }
    difference += Math.abs(actual[offset + 3] - expected[offset + 3]);
    ink += expected[offset + 3] * 4;
  }
  assert(ink > 0, `${message}: oracle contains visible ink`);
  assert(difference / ink < .025, `${message}: premultiplied pixel error ${difference / ink}`);
}

function fixture({ content, form = false, state = "/ca .45 /CA .65", fontName = "OutlinedFixture" }) {
  const resources = "/Font << /F 5 0 R >> /ExtGState << /Outer 6 0 R /Inner 7 0 R >>";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${side} ${side}] /Resources << ${resources} /XObject << /Form 8 0 R >> >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", form ? "q 5 0 m 25 0 l 5 35 l h W n /Form Do Q" : content) },
    { number: 5, body: `<< /Type /Font /Subtype /TrueType /BaseFont /${fontName} /Encoding /WinAnsiEncoding >>` },
    { number: 6, body: `<< ${state} >>` },
    { number: 7, body: "<< /ca .2 /CA .35 >>" },
    { number: 8, body: tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [0 0 50 50] /Matrix [1 .2 .15 1 5 7] /Resources << ${resources} >>`, content) }
  ] });
}
