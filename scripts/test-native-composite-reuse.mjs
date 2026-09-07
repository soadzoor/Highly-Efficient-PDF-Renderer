import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { sceneFingerprint } from "./lib/sceneFingerprint.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { findRgbaAlphaBounds } = await import("../src/rgbaBounds.ts");
  const { HeprCanvas2dImageSurfaceCache, renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  checkBounds(findRgbaAlphaBounds);

  for (const mode of ["multiply", "Alpha", "Luminosity", "empty"]) {
    const bytes = fixture(mode);
    const snapshot = bytes.slice();
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      const baseline = await session.compileVectorPageWithTimings(0, {}, {
        reuseCompositeSurfaces: false, boundCompositeWork: false
      });
      const expected = sceneFingerprint(baseline.scene);
      for (const reuseCompositeSurfaces of [false, true]) {
        for (const boundCompositeWork of [false, true]) {
          const result = await session.compileVectorPageWithTimings(0, {}, {
            reuseCompositeSurfaces, boundCompositeWork
          });
          assert.equal(sceneFingerprint(result.scene), expected, `${mode}: all scene bytes must match`);
          assert.deepEqual(bytes, snapshot);
          const before = baseline.timings.selectiveCompositing;
          const after = result.timings.selectiveCompositing;
          if (mode === "multiply") {
            assert.equal(before.renders, 3, "exercise standalone selection and both backdrop passes");
            if (reuseCompositeSurfaces) {
              assert(after.imageSurfaceHits > 0);
              assert(after.imageSurfaces < before.imageSurfaces);
            }
            if (boundCompositeWork) assert(after.readbackPixels < before.readbackPixels / 2);
          } else if (boundCompositeWork) {
            assert(after.softMaskPixels < before.softMaskPixels / 2);
          }
        }
      }
      const nextPage = await session.compileVectorPageWithTimings(1);
      assert.equal(sceneFingerprint(await session.compileVectorPage(0)), expected);
      assert.equal(sceneFingerprint(baseline.scene), expected, "later calls cannot mutate returned pixels");
      assert.equal(nextPage.timings.selectiveCompositing.imageSurfaces,
        (await session.compileVectorPageWithTimings(0)).timings.selectiveCompositing.imageSurfaces,
        "surface caches cannot survive into another page operation");
    } finally {
      await session.close();
    }
  }

  // Exercise the surface budget directly, including unused entries from a
  // previous pass. A cache must not turn a previously valid render into OOM.
  const session = await openPdf({ kind: "bytes", bytes: fixture("multiply") });
  try {
    const page = await session.compilePage(0);
    const rootIndex = page.displayProgram.rootGroupIndex;
    const imageCommand = page.displayProgram.groups[rootIndex].commands.find(
      command => command.kind === "draw" && command.source === "images");
    assert(imageCommand);
    const imagePage = {
      ...page,
      displayProgram: { ...page.displayProgram, groups: page.displayProgram.groups.map((group, index) => ({
        ...group, blendingColorSpaceIndex: -1, backdropPaintIndex: -1,
        ...(index === rootIndex ? { commands: [imageCommand] } : {})
      })) }
    };
    const retained = new Set();
    const surfaces = [];
    const factory = (width, height) => {
      const canvas = createCanvas(width, height);
      const surface = { canvas, context: canvas.getContext("2d") };
      surfaces.push(surface);
      return surface;
    };
    const release = surface => {
      retained.delete(surface);
      surface.canvas.width = surface.canvas.height = 1;
    };
    const cache = new HeprCanvas2dImageSurfaceCache(imagePage, factory,
      surface => retained.add(surface), release, 4);
    const render = (candidate = imagePage, options = {}) => renderHeprPageToCanvas2d(candidate,
      { surfaceFactory: factory, ...options }, { imageSurfaces: cache });
    await render();
    assert.equal(cache.pixelCount, 4);
    assert.equal(retained.size, 1);
    const canvasCount = surfaces.length;
    await render();
    assert.equal(surfaces.length, canvasCount + 1, "a cache hit allocates only the output canvas");
    const emptyPage = { ...imagePage, displayProgram: { ...imagePage.displayProgram,
      groups: imagePage.displayProgram.groups.map((group, index) => index === rootIndex
        ? { ...group, commands: [] } : group) } };
    await render(emptyPage, { maxWorkingPixels: 1 });
    assert.equal(cache.pixelCount, 0, "a lower budget evicts unused retained images");
    assert.equal(retained.size, 0);
    await assert.rejects(render(imagePage, { maxWorkingPixels: 3 }),
      error => error.code === "canvas2d.resource-limit");
    await render();
    await assert.rejects(render({ ...imagePage, stores: { ...imagePage.stores,
      images: { ...imagePage.stores.images } } }), error => error.code === "canvas2d.invalid-options");
    await assert.rejects(render(imagePage, { maxCanvasPixels: 1, scale: 0.01 }),
      error => error.code === "canvas2d.resource-limit");
    cache.dispose();
    cache.dispose();
    assert.equal(retained.size, 0);
    assert.equal(cache.pixelCount, 0);
    await assert.rejects(render(), error => error.code === "canvas2d.invalid-options");
    const tinyCache = new HeprCanvas2dImageSurfaceCache(imagePage, factory,
      surface => retained.add(surface), release, 1);
    const countBeforeAdmission = surfaces.length;
    for (let pass = 0; pass < 2; pass += 1) {
      await renderHeprPageToCanvas2d(imagePage, { surfaceFactory: factory }, { imageSurfaces: tinyCache });
    }
    assert.equal(tinyCache.pixelCount, 0, "oversized images bypass cache admission, not rendering");
    assert.equal(surfaces.length, countBeforeAdmission + 4, "uncached passes each materialize the image");
    tinyCache.dispose();
    for (const surface of surfaces) release(surface);
  } finally {
    await session.close();
  }

  if (process.argv[2]) {
    // Optional bounded corpus check, never writes HEP or changes tracked assets.
    const bytes = new Uint8Array(await readFile(process.argv[2]));
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      for (let pageIndex = 0; pageIndex < session.info.pageCount; pageIndex += 1) {
        const before = await session.compileVectorPageWithTimings(pageIndex, {}, {
          reuseCompositeSurfaces: false, boundCompositeWork: false
        });
        const after = await session.compileVectorPageWithTimings(pageIndex);
        assert.equal(sceneFingerprint(after.scene), sceneFingerprint(before.scene), `source page ${pageIndex}`);
        console.log(`Page ${pageIndex + 1}/${session.info.pageCount}: exact scene/pixel match; surfaces ` +
          `${before.timings.selectiveCompositing?.imageSurfaces ?? 0} -> ${after.timings.selectiveCompositing?.imageSurfaces ?? 0}`);
      }
    } finally {
      await session.close();
    }
  }
  console.log("native composite reuse, bounds, and budget tests passed");
} finally {
  hooks.deregister();
}

function checkBounds(findBounds) {
  let seed = 123456;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const width = 1 + random() % 81;
    const height = 1 + random() % 53;
    const storage = new Uint8Array(width * height * 4 + 16);
    const rgba = storage.subarray(8, storage.length - 8);
    const points = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (iteration % 5 === 0 || random() % 17 !== 0) continue;
        rgba[(y * width + x) * 4 + 3] = 1 + random() % 255;
        points.push([x, y]);
      }
    }
    const minX = Math.min(...points.map(point => point[0]));
    const minY = Math.min(...points.map(point => point[1]));
    const maxX = Math.max(...points.map(point => point[0]));
    const maxY = Math.max(...points.map(point => point[1]));
    assert.deepEqual(findBounds(rgba, width, height), points.length === 0 ? null
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
    assert.deepEqual(storage.subarray(0, 8), new Uint8Array(8));
  }
  const signal = AbortSignal.abort(new Error("bounds cancelled"));
  assert.throws(() => findBounds(new Uint8Array(4), 1, 1, signal), /bounds cancelled/);
}

function fixture(mode) {
  const masked = mode !== "multiply";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 9 0 R] >>" },
    ...[3, 9].map(number => ({ number, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] " +
      "/Resources << /XObject << /Bg 5 0 R /Fm 6 0 R >> >> /Contents 4 0 R >>" })),
    { number: 4, body: tinyPdfStream("", "q 100 0 0 100 0 0 cm /Bg Do Q q 1 0 0 1 31.25 40.5 cm /Fm Do Q") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 " +
      "/ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(200, 100, 50, 200, 100, 50, 200, 100, 50, 200, 100, 50)) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] " +
      "/Resources << /ExtGState << /Gs 7 0 R >> >>",
    `/Gs gs ${mode === "empty" ? "0 0 0 0 re" : "0.5 0.5 0.5 rg 0.25 0.5 8.75 9 re"} f`) },
    { number: 7, body: masked ? `<< /Type /ExtGState /SMask << /S /${mode === "empty" ? "Alpha" : mode} /G 8 0 R >> >>`
      : "<< /Type /ExtGState /BM /Multiply /ca 0.5 >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] " +
      "/Group << /S /Transparency /I true /CS /DeviceRGB >> /Resources << >>",
    "0.2 0.5 0.8 rg 0 0 5 10 re f 1 0 0 rg 5 0 5 10 re f") }
  ] });
}
