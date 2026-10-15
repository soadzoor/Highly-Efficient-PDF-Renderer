import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createOcrPdfFixture } from "./lib/ocrPdfFixture.mjs";
import { sceneFingerprint } from "./lib/sceneFingerprint.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const sessions = [];
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { collectPdfTransferables } = await import("../src/pdf/workerProtocol.ts");
  const { renderThumbnailPageCanvas2d } = await import("../src/thumbnailCanvas2d.ts");
  const bytes = createOcrPdfFixture({ pageCount: 2, glyphless: false, scan: false, imageWidth: 2, imageHeight: 2,
    extGState: "/Half << /ca .5 /CA .5 >>",
    content: "q 10 5 180 90 re W n 0 0 1 rg 20 20 50 35 re f " +
      "q /Half gs 0 1 0 rg 40 35 40 30 re f Q .2 w 10 75 m 180 75 l S " +
      "q 20 0 0 20 140 10 cm /Scan Do Q BT /F1 14 Tf 20 65 Td <000100020001> Tj ET " +
      "/OC /Hidden BDC 1 0 0 rg 85 20 35 35 re f EMC Q" });
  const base = { maxDimension: 80, backend: "canvas2d", background: [1, 1, 1, 1] };
  const session = await opened();
  const nativeCompile = session.compilePageUnlocked;
  let preparations = 0, nextFailure, nextAbort;
  session.compilePageUnlocked = async function (page, options, signal, ...rest) {
    if (options.thumbnailScale !== undefined) {
      preparations++;
      if (nextFailure) { const error = nextFailure; nextFailure = undefined; throw error; }
    }
    const result = await nativeCompile.call(this, page, options, signal, ...rest);
    if (options.thumbnailScale !== undefined && nextAbort) {
      const controller = nextAbort; nextAbort = undefined; controller.abort(abortReason);
    }
    return result;
  };

  const initial = await session.renderThumbnailPage(0, base);
  assert.equal(preparations, 1);
  assert.deepEqual([initial.width, initial.height], [80, 40]);
  const firstPage = session.thumbnailPage.page, firstSnapshot = structuredClone(firstPage);
  for (const options of [
    { ...base, background: [0, 0, 0, 0] },
    { ...base, background: [.2, .4, .6, 1] },
    { ...base, vectorOverride: [1, .1, .2, 1] },
    { ...base, background: [0, 0, 0, 0], vectorOverride: [.8, .2, .6, .5] },
    base
  ]) {
    const actual = await session.renderThumbnailPage(0, options);
    assertPixels(actual, await fresh(0, options), "repaint options match fresh native output");
    assert.equal(preparations, 1, "background, alpha and vector color changes do not reinterpret PDF content");
    assert.strictEqual(session.thumbnailPage.page, firstPage);
    assert.deepEqual(firstPage, firstSnapshot, "repainting preserves the unfiltered prepared stores");
  }
  const transparent = await session.renderThumbnailPage(0, { ...base, background: [0, 0, 0, 0] });
  assert(transparent.rgba.some((value, index) => index % 4 === 3 && value === 0), "fixture retains genuinely transparent page pixels");
  assert.notDeepEqual(transparent.rgba, initial.rgba, "fresh parity exercises an actual background change");

  const optional = await session.optionalContent.sceneData(new AbortController().signal);
  const layer = optional.groups.find(group => group.name === "Hidden");
  assert(layer, "fixture exposes its initially hidden optional group");
  const visibility = visible => ({ revision: visible ? 1 : 2, conditions: new Uint8Array(0), layers: [{ id: layer.id, visible }] });
  const shownOptions = { ...base, background: [0, 0, 0, 0], optionalContent: visibility(true) };
  const hiddenOptions = { ...shownOptions, optionalContent: visibility(false) };
  const shown = await session.renderThumbnailPage(0, shownOptions);
  assert.equal(preparations, 2, "retaining toggleable optional content requires a distinct preparation");
  assertPixels(shown, await fresh(0, shownOptions), "shown optional content matches a fresh native session");
  const retainedPage = session.thumbnailPage.page, retainedSnapshot = structuredClone(retainedPage);
  const hidden = await session.renderThumbnailPage(0, hiddenOptions);
  assertPixels(hidden, await fresh(0, hiddenOptions), "hidden optional content matches a fresh native session");
  assert.notDeepEqual(shown.rgba, hidden.rgba, "visibility variants actually paint different pixels");
  assertPixels(await session.renderThumbnailPage(0, shownOptions), shown, "show-hide-show does not cache a visibility-filtered derivative");
  assert.equal(preparations, 2, "visibility revisions repaint the same retained optional-content page");
  assert.strictEqual(session.thumbnailPage.page, retainedPage);
  assert.deepEqual(retainedPage, retainedSnapshot, "visibility overrides never replace stored defaults or commands");

  await session.renderThumbnailPage(0, base);
  assert.equal(preparations, 3, "switching optional-content retention off rebuilds preparation");
  await session.renderThumbnailPage(0, { ...base, maxDimension: 81 });
  assert.equal(preparations, 4, "a different target resolution rebuilds preparation");
  await session.renderThumbnailPage(1, { ...base, maxDimension: 81 });
  assert.equal(preparations, 5, "page selection remains part of the preparation key");
  await session.renderThumbnailPage(0, base);
  assert.equal(preparations, 6, "only the last prepared page is retained");
  const validPixels = await session.renderThumbnailPage(0, base), validEntry = session.thumbnailPage;

  nextFailure = Error("synthetic preparation failed");
  await assert.rejects(session.renderThumbnailPage(0, { ...base, maxDimension: 82 }), /synthetic preparation failed/);
  assert.strictEqual(session.thumbnailPage.page, validEntry.page, "failed preparation leaves the previous valid entry available");
  assert.equal(session.thumbnailPage.key, validEntry.key);
  let beforeReuse = preparations;
  assertPixels(await session.renderThumbnailPage(0, base), validPixels);
  assert.equal(preparations, beforeReuse);

  const abortReason = Error("preview removed after preparation"), cancelled = new AbortController();
  nextAbort = cancelled;
  await assert.rejects(session.renderThumbnailPage(0, { ...base, maxDimension: 83, signal: cancelled.signal }), error => error.code === "aborted");
  assert.strictEqual(session.thumbnailPage.page, validEntry.page, "aborting a compiled candidate never publishes it");
  assert.equal(session.thumbnailPage.key, validEntry.key);
  beforeReuse = preparations;
  assertPixels(await session.renderThumbnailPage(0, base), validPixels);
  assert.equal(preparations, beforeReuse);
  await session.renderThumbnailPage(0, { ...base, maxDimension: 83 });
  assert.equal(preparations, beforeReuse + 1, "the cancelled candidate must compile again on retry");
  const afterAbortEntry = session.thumbnailPage;
  await assert.rejects(session.renderThumbnailPage(0, { ...base, maxDimension: 84, backend: "webgl" }),
    error => error.code === "thumbnail.webgl-unavailable");
  assert.strictEqual(session.thumbnailPage.page, afterAbortEntry.page, "a failed native render never publishes its completed preparation");
  assert.equal(session.thumbnailPage.key, afterAbortEntry.key);
  beforeReuse = preparations;
  await session.renderThumbnailPage(0, { ...base, maxDimension: 84 });
  assert.equal(preparations, beforeReuse + 1, "retry after rendering failure recompiles the unpublished candidate");

  // Match a worker whose host must render the prepared page or scene. Real
  // structured-clone transfers detach the sender's buffers, including scene
  // raster views that alias retained image storage.
  for (const backend of ["auto", "webgl", "canvas2d"]) {
    const fallbackSession = await opened();
    let fallbackPreparations = 0;
    const originalCompile = fallbackSession.compilePageUnlocked;
    fallbackSession.compilePageUnlocked = async function (...args) { fallbackPreparations++; return originalCompile.apply(this, args); };
    const seed = await fallbackSession.renderThumbnailPage(0, base);
    const cachedPage = fallbackSession.thumbnailPage.page;
    const result = await withoutNativeSurfaces(() => fallbackSession.renderThumbnailPage(0, { ...base, backend }));
    assert(!("rgba" in result));
    assert.equal("scene" in result, backend !== "canvas2d");
    assert.equal("page" in result, backend !== "webgl");
    assert.equal(fallbackPreparations, 1, "a capability fallback may start from the previous prepared page");
    assert.equal(fallbackSession.thumbnailPage, undefined, "returning a cached page/scene releases that cache owner before transfer");
    const received = structuredClone(result, { transfer: collectPdfTransferables(result) });
    assert.equal(cachedPage.stores.images.data.byteLength, 0,
      "the actual transfer detaches the page image buffer, including through a scene-only raster alias");
    if ("page" in received) {
      assertPixels(await renderThumbnailPageCanvas2d(received.page, base, undefined, received.limits, undefined, true), seed,
        "transferred fallback data remains usable by its owning host");
    } else assert(received.scene.rasterLayers.some(layer => layer.data?.byteLength > 0));
    assertPixels(await fallbackSession.renderThumbnailPage(0, base), seed, "retry after transferring a fallback reparses intact resources");
    assert.equal(fallbackPreparations, 2, "the sender never reuses a detached fallback page");
    await fallbackSession.close();
  }
  const differentFallback = await opened();
  let differentPreparations = 0;
  const differentCompile = differentFallback.compilePageUnlocked;
  differentFallback.compilePageUnlocked = async function (...args) { differentPreparations++; return differentCompile.apply(this, args); };
  const previousPixels = await differentFallback.renderThumbnailPage(0, base);
  const previousPage = differentFallback.thumbnailPage.page, previousSnapshot = structuredClone(previousPage);
  const otherResult = await withoutNativeSurfaces(() => differentFallback.renderThumbnailPage(0, { ...base, maxDimension: 81, backend: "auto" }));
  structuredClone(otherResult, { transfer: collectPdfTransferables(otherResult) });
  assert.strictEqual(differentFallback.thumbnailPage.page, previousPage, "a new fallback preserves a different valid prepared page");
  assert.deepEqual(previousPage, previousSnapshot, "transferring a different fallback cannot detach the retained page");
  assertPixels(await differentFallback.renderThumbnailPage(0, base), previousPixels);
  assert.equal(differentPreparations, 2, "the previous resolution remains reusable after an uncached capability fallback");
  await differentFallback.close();

  const freshCanonical = await opened();
  const canonical = await session.compilePage(0), canonicalReference = await freshCanonical.compilePage(0);
  assert.deepEqual(canonical.stores, canonicalReference.stores, "thumbnail preparation never replaces canonical fonts, images, paths or clips");
  assert.deepEqual(canonical.displayProgram, canonicalReference.displayProgram);
  assert.deepEqual(canonical.textIndex, canonicalReference.textIndex, "canonical text/index resources remain available after thumbnail reuse");
  assert.equal(canonical.textIndex.text, "ABA");
  const exactScene = await session.compileVectorPage(0), referenceScene = await freshCanonical.compileVectorPage(0);
  assert.equal(sceneFingerprint(exactScene), sceneFingerprint(referenceScene), "canonical renderer data remains independent of prepared thumbnails");
  const exportOptions = { withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store",
    sourceLabel: "thumbnail-cache.pdf", onWarning() {} };
  const exported = await loadSceneFromHep(await (await buildHep(exactScene, exportOptions)).arrayBuffer());
  const referenceExport = await loadSceneFromHep(await (await buildHep(referenceScene, exportOptions)).arrayBuffer());
  assert.equal(sceneFingerprint(exported), sceneFingerprint(referenceExport), "subsequent full-quality HEP output matches a fresh native session");
  await session.close();
  assert.equal(session.thumbnailPage, undefined, "close drops the prepared page owner");
  await assert.rejects(session.renderThumbnailPage(0, base), error => error.code === "closed");
  console.log("Prepared thumbnail pages: native pixel parity across backgrounds/vector/alpha/layers, compile reuse and key isolation, failed/aborted render isolation, canonical/HEP parity and close cleanup passed.");

  async function opened() { const value = await openPdf({ kind: "bytes", bytes }); sessions.push(value); return value; }
  async function fresh(page, options) {
    const value = await opened();
    try { return await value.renderThumbnailPage(page, options); } finally { await value.close(); }
  }
  function assertPixels(actual, expected, message) {
    assert(actual.rgba && expected.rgba, "Canvas2D native calls return pixels directly");
    assert.deepEqual([actual.width, actual.height], [expected.width, expected.height], message);
    assert.deepEqual(actual.rgba, expected.rgba, message);
  }
  async function withoutNativeSurfaces(operation) {
    const originals = new Map(["process", "document", "OffscreenCanvas"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    try {
      for (const name of originals.keys()) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: undefined });
      return await operation();
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  }
} finally { await Promise.all(sessions.map(session => session.close())); hooks.deregister(); }
