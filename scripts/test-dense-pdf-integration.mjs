import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const originalProcess = Object.getOwnPropertyDescriptor(globalThis, "process");

try {
  const [
    compilerModule,
    documentModule,
    textModule,
    workerModule,
    extractorModule,
    standardFontModule
  ] = await Promise.all([
    import("../src/densePdfContentCompiler.ts"),
    import("../src/nativeDensePdfDocument.ts"),
    import("../src/nativeDenseRetainedTextCompiler.ts"),
    import("../src/densePdfFastWorker.ts"),
    import("../src/pdfVectorExtractor.ts"),
    import("../src/standardFontResolver.ts")
  ]);
  const { compileDensePdfContent } = compilerModule;
  const {
    closeNativeDensePdfDocument,
    getNativeDenseSourceDocument,
    preflightNativeDensePdfDocument
  } = documentModule;
  const { compileNativeDenseRetainedTextPage } = textModule;
  const missingFontResolver = standardFontModule.createBundledStandardFontResolver({
    async loadAsset(asset, signal) {
      signal?.throwIfAborted();
      const url = new URL(asset.url);
      url.search = "";
      const bytes = await readFile(url);
      signal?.throwIfAborted();
      return bytes;
    }
  });
  const {
    classifyDensePdfTextFormXObjects,
    computeDensePdfPageGeometry
  } = workerModule;
  const { extractPdfPageScenes } = extractorModule;

  const pdfBytes = await createFixture();
  const forcedScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
    pdfFastPath: "off",
    enableSegmentMerge: true,
    enableInvisibleCull: true,
    extractTextContent: true
  });
  assert.equal(forcedScenes.length, 5);

  const preflight = await preflightNativeDensePdfDocument(pdfBytes);
  assert.equal(
    preflight.eligible,
    true,
    preflight.eligible ? undefined : `${preflight.reason}: ${preflight.message}`
  );
  const compiledPages = [];
  for (const selectedPage of preflight.document.pages) {
    const geometry = computeDensePdfPageGeometry(selectedPage);
    const availableTextFormXObjects = await classifyDensePdfTextFormXObjects(
      selectedPage
    );
    const compiled = await compileDensePdfContent(selectedPage.decodedContentChunks(), {
      ...geometry,
      fontDependencyKeys: new Map(selectedPage.fontDependencies.map(
        ({ resourceName, dependencyKey }) => [resourceName, dependencyKey]
      )),
      availableExtGStates: selectedPage.availableExtGStates,
      extGStates: selectedPage.extGStates,
      alwaysVisibleOptionalContentProperties:
        selectedPage.alwaysVisibleOptionalContentProperties,
      availableTextFormXObjects,
      enableSegmentMerge: true,
      enableInvisibleCull: true
    });
    compiledPages.push({
      selectedPage,
      geometry,
      compiled,
      formSummaries: availableTextFormXObjects
    });
  }
  const sourceDocument = getNativeDenseSourceDocument(preflight.document);
  assert.ok(sourceDocument, "native preflight must retain its source document");
  const nativeTextScenes = [];
  for (const { selectedPage, compiled, formSummaries } of compiledPages) {
    nativeTextScenes.push(await compileNativeDenseRetainedTextPage(
      sourceDocument,
      sourceDocument.getPage(selectedPage.sourcePageIndex),
      compiled.retainedTextContent,
      compiled.referencedFonts,
      {
        missingFontResolver,
        formSummaries,
        extGStates: selectedPage.extGStates,
        alwaysVisibleOptionalContentProperties:
          selectedPage.alwaysVisibleOptionalContentProperties
      }
    ));
  }

  const workerResult = {
    kind: "success",
    structureBackend: "hepr-native",
    sourcePageCount: preflight.document.sourcePageCount,
    pages: compiledPages.map(({ selectedPage, geometry, compiled }) => ({
      sourcePageIndex: selectedPage.sourcePageIndex,
      mediaBox: boxArray(selectedPage.mediaBox),
      cropBox: boxArray(selectedPage.cropBox),
      rotation: selectedPage.rotation,
      userUnit: selectedPage.userUnit,
      pageMatrix: geometry.pageMatrix,
      pageBounds: geometry.pageBounds,
      encodedContentBytes: selectedPage.encodedContentBytes,
      decodedContentBytes: selectedPage.decodeTiming.decodedBytes,
      decodeMs: selectedPage.decodeTiming.elapsedMs,
      compileMs: 0,
      compiled
    })),
    textMiniPdfBytes: new Uint8Array(0),
    nativeTextScenes,
    timing: {
      preflightMs: preflight.timing.totalMs,
      decodeMs: compiledPages.reduce(
        (total, { selectedPage }) => total + selectedPage.decodeTiming.elapsedMs,
        0
      ),
      compileMs: 0,
      textMiniPdfMs: 0,
      nativeTextMs: 0,
      totalMs: 0
    }
  };
  await closeNativeDensePdfDocument(preflight.document);

  let activeWorkerResult = workerResult;
  const workers = [];
  class MockWorker {
    listeners = new Map();

    constructor() {
      workers.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    postMessage() {
      queueMicrotask(() => {
        // This mock exercises the browser Worker branch. Restore Node before
        // resolving so a subsequent full-tier fallback still uses its real
        // worker_threads launcher.
        restoreGlobal("process", originalProcess);
        this.emit("message", {
          data: {
            type: "progress",
            progress: {
              value: 1,
              stage: "compile",
              executionPath: "dense-vector-worker",
              sourceType: "pdf"
            }
          }
        });
        this.emit("message", { data: { type: "result", result: activeWorkerResult } });
      });
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }

    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: MockWorker
  });

  const progress = [];
  maskNodeRuntime();
  const fastScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
    pdfFastPath: "auto",
    enableSegmentMerge: true,
    enableInvisibleCull: true,
    extractTextContent: true,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(workers.length, 1);
  assert.equal(fastScenes.length, 5);
  for (let index = 0; index < fastScenes.length; index += 1) {
    assertPackedGeometryParity(
      compiledPages[index].compiled,
      fastScenes[index],
      `integrated native page ${index + 1}`
    );
    assertIntegratedTextParity(
      fastScenes[index],
      forcedScenes[index],
      `integrated native page ${index + 1}`
    );
  }
  assert.equal(fastScenes[1].segmentCount, 0);
  assert.equal(fastScenes[1].fillPathCount, 0);
  assert.notDeepEqual(fastScenes[1].bounds, fastScenes[1].pageBounds);
  assert.ok(
    progress.some((event) => event.executionPath === "dense-vector-worker"),
    "the integrated fast path must expose its execution path"
  );
  for (let index = 1; index < progress.length; index += 1) {
    assert.ok(progress[index].value >= progress[index - 1].value, "progress must be monotonic");
  }

  activeWorkerResult = {
    kind: "fallback",
    reason: "unsupported-content",
    message: "integration fallback"
  };
  const fallbackProgress = [];
  maskNodeRuntime();
  const fallbackScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
    pdfFastPath: "auto",
    enableSegmentMerge: true,
    enableInvisibleCull: true,
    extractTextContent: true,
    onProgress: (event) => fallbackProgress.push(event)
  });
  assert.deepEqual(fallbackScenes, forcedScenes);
  assert.ok(
    fallbackProgress.some((event) => event.executionPath === "worker"),
    "fallback progress must identify the full native worker path"
  );
  for (let index = 1; index < fallbackProgress.length; index += 1) {
    assert.ok(
      fallbackProgress[index].value >= fallbackProgress[index - 1].value,
      "fallback progress must remain monotonic"
    );
  }

  await testRawStateDifferentials({
    compileDensePdfContent,
    computeDensePdfPageGeometry,
    extractPdfPageScenes,
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });

  console.log("Dense PDF end-to-end differential test passed.");
} finally {
  restoreGlobal("Worker", originalWorker);
  restoreGlobal("process", originalProcess);
  hooks.deregister();
}

function maskNodeRuntime() {
  Object.defineProperty(globalThis, "process", {
    configurable: true,
    writable: true,
    value: undefined
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

async function testRawStateDifferentials({
  compileDensePdfContent,
  computeDensePdfPageGeometry,
  extractPdfPageScenes,
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const bytes = createRawStateFixture();

  for (const enableInvisibleCull of [false, true]) {
    const forced = await extractPdfPageScenes(toArrayBuffer(bytes), {
      pdfFastPath: "off",
      enableSegmentMerge: true,
      enableInvisibleCull
    });
    const preflight = await preflightNativeDensePdfDocument(bytes);
    assert.equal(preflight.eligible, true);
    try {
      assert.equal(forced.length, preflight.document.pages.length);
      for (let index = 0; index < forced.length; index += 1) {
        const page = preflight.document.pages[index];
        const compiled = await compileDensePdfContent(page.decodedContentChunks(), {
          ...computeDensePdfPageGeometry(page),
          fontDependencyKeys: new Map(page.fontDependencies.map(
            ({ resourceName, dependencyKey }) => [resourceName, dependencyKey]
          )),
          availableExtGStates: page.availableExtGStates,
          extGStates: page.extGStates,
          alwaysVisibleOptionalContentProperties:
            page.alwaysVisibleOptionalContentProperties,
          enableSegmentMerge: true,
          enableInvisibleCull
        });
        if (index === 4 || index === 5) {
          assertSelectiveClipReplacement(
            compiled,
            forced[index],
            `raw state page ${index + 1}`
          );
        } else {
          assertPackedGeometryParity(compiled, forced[index], `raw state page ${index + 1}`);
        }
      }
    } finally {
      await closeNativeDensePdfDocument(preflight.document);
    }
    assert.equal(forced[0].styles[0], 1, "PDF.js must normalize -2 w to +2");
    assert.equal(forced[1].sourceSegmentCount, 1, "a summed 1e-9 dash pattern is solid");
    assert.equal(forced[1].segmentCount, 1, "tiny dashes must not expand after CTM scaling");
    assert.equal(
      forced[2].maxHalfWidth,
      enableInvisibleCull ? 0.5 : 10,
      "path-level width metadata must match PDF.js before primitive clip rejection"
    );
    assert.equal(
      forced[3].maxHalfWidth,
      enableInvisibleCull ? 0.5 : 10,
      "simple degenerate paths must contribute PDF.js-compatible no-cull width metadata"
    );
    assertExactTriangleClipRaster(forced[4]);
    assertExactRectangleHoleRaster(forced[5]);
    assert.ok(
      Math.abs(forced[6].primitiveMeta[3] - 0.4) < 1e-6,
      "Normal-blend stroking opacity must survive packed geometry"
    );
    assert.ok(
      Math.abs(forced[6].fillPathMetaC[3] - 0.2) < 1e-6,
      "Normal-blend fill opacity must survive packed geometry"
    );
    assert.equal(
      forced[6].segmentCount,
      2,
      "repeated translucent strokes must retain their accumulated opacity"
    );
    assert.equal(forced[6].discardedDuplicateCount, 0);
    assert.equal(forced[7].segmentCount, 1, "default-visible OCG content must be flattened");
  }
}

function assertSelectiveClipReplacement(compiled, scene, label) {
  for (const key of [
    "endpoints",
    "primitiveMeta",
    "primitiveBounds",
    "styles"
  ]) {
    assert.deepEqual(compiled[key], scene[key], `${label} ${key}`);
  }
  for (const key of [
    "pathCount",
    "sourceSegmentCount",
    "mergedSegmentCount",
    "segmentCount",
    "discardedTransparentCount",
    "discardedDegenerateCount",
    "discardedDuplicateCount",
    "discardedContainedCount",
    "maxHalfWidth"
  ]) {
    assert.equal(compiled[key], scene[key], `${label} ${key}`);
  }
  assert.equal(compiled.fillPathCount, 1, `${label}: compact reference fill`);
  assert.equal(scene.fillPathCount, 0, `${label}: exact fill leaves packed vector stores`);
  assert.equal(scene.fillSegmentCount, 0, `${label}: no stale packed fill segments`);
  assert.equal(scene.rasterLayers.length, 1, `${label}: one source-ordered exact clip layer`);
  assert.equal(scene.rasterLayers[0].paintOrder, 0, `${label}: source paint order`);
  assert.ok(countVisibleRasterPixels(scene.rasterLayers[0]) > 0, `${label}: visible paint retained`);
}

function assertExactTriangleClipRaster(scene) {
  const layer = scene.rasterLayers[0];
  assert.ok(rasterAlphaAtPagePoint(layer, 40, 20) >= 250, "triangle interior must be painted");
  assert.ok(rasterAlphaAtPagePoint(layer, 40, 55) >= 250, "triangle apex interior must be painted");
  assert.equal(
    rasterAlphaAtPagePoint(layer, 12, 55),
    0,
    "the irregular W* clip must exclude its AABB-only corner"
  );
  assert.equal(rasterAlphaAtPagePoint(layer, 68, 55), 0);
}

function assertExactRectangleHoleRaster(scene) {
  const layer = scene.rasterLayers[0];
  assert.ok(rasterAlphaAtPagePoint(layer, 15, 15) >= 250, "outer clip region must be painted");
  assert.equal(
    rasterAlphaAtPagePoint(layer, 30, 25),
    0,
    "the even-odd rectangle exclusion must remain transparent"
  );
  assert.equal(rasterAlphaAtPagePoint(layer, 5, 5), 0);
}

function countVisibleRasterPixels(layer) {
  let count = 0;
  for (let offset = 3; offset < layer.data.length; offset += 4) {
    if (layer.data[offset] !== 0) count += 1;
  }
  return count;
}

function rasterAlphaAtPagePoint(layer, pageX, pageY) {
  const [a, b, c, d, e, f] = layer.matrix;
  const determinant = a * d - b * c;
  assert.ok(Number.isFinite(determinant) && Math.abs(determinant) > 1e-12);
  const unitX = (d * (pageX - e) - c * (pageY - f)) / determinant;
  const unitY = (-b * (pageX - e) + a * (pageY - f)) / determinant;
  if (unitX < 0 || unitX >= 1 || unitY < 0 || unitY >= 1) return 0;
  const pixelX = Math.min(layer.width - 1, Math.floor(unitX * layer.width));
  const pixelY = Math.min(layer.height - 1, Math.floor(unitY * layer.height));
  return layer.data[(pixelY * layer.width + pixelX) * 4 + 3];
}

function assertPackedGeometryParity(compiled, forced, label) {
  for (const key of [
    "endpoints",
    "primitiveMeta",
    "primitiveBounds",
    "styles",
    "fillPathMetaA",
    "fillPathMetaB",
    "fillPathMetaC",
    "fillSegmentsA",
    "fillSegmentsB"
  ]) {
    assert.deepEqual(compiled[key], forced[key], `${label} ${key}`);
  }
  for (const key of [
    "pathCount",
    "sourceSegmentCount",
    "mergedSegmentCount",
    "segmentCount",
    "fillPathCount",
    "fillSegmentCount",
    "discardedTransparentCount",
    "discardedDegenerateCount",
    "discardedDuplicateCount",
    "discardedContainedCount",
    "maxHalfWidth"
  ]) {
    assert.equal(compiled[key], forced[key], `${label} ${key}`);
  }
}

function assertIntegratedTextParity(actual, expected, label) {
  assert.equal(actual.textInstanceCount, expected.textInstanceCount, `${label}: text instances`);
  assert.equal(
    actual.textGlyphCount > 0,
    expected.textGlyphCount > 0,
    `${label}: visible glyph-outline presence`
  );
  assert.equal(
    actual.textIndex?.pages[0]?.text ?? "",
    expected.textIndex?.pages[0]?.text ?? "",
    `${label}: searchable text`
  );
  assert.equal(
    normalizeTextContent(actual.textContent),
    normalizeTextContent(expected.textContent),
    `${label}: extracted text content`
  );
  const actualBounds = textContentBounds(actual.textContent);
  const expectedBounds = textContentBounds(expected.textContent);
  if (actualBounds && expectedBounds) {
    for (const key of ["minX", "minY", "maxX", "maxY"]) {
      assert.ok(
        Math.abs(actualBounds[key] - expectedBounds[key]) <= 4.5,
        `${label}: text ${key} differs (${actualBounds[key]} versus ${expectedBounds[key]})`
      );
    }
  } else {
    assert.equal(actualBounds, expectedBounds, `${label}: text bounds presence`);
  }
}

function normalizeTextContent(items) {
  return (items ?? []).map(({ text }) => text.trim()).filter(Boolean).join(" ");
}

function textContentBounds(items) {
  if (!items || items.length === 0) return null;
  return items.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, item.minX),
    minY: Math.min(bounds.minY, item.minY),
    maxX: Math.max(bounds.maxX, item.maxX),
    maxY: Math.max(bounds.maxY, item.maxY)
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });
}

async function createFixture() {
  return writeTinyPdf({
    objects: [
      {
        number: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [40 0 R] " +
          "/D << /Order [40 0 R] /OFF [] >> >> >>"
      },
      { number: 2, body: "<< /Type /Pages /Count 5 /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 140] " +
          "/CropBox [5 7 210 132] /Rotate 90 /Resources << /Font << /FMain 10 0 R >> " +
          "/XObject << /FmText 30 0 R /FmAlias 30 0 R >> >> /Contents [20 0 R 21 0 R 22 0 R] >>"
      },
      {
        number: 4,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 180 100] " +
          "/Resources << /Font << /FMain 10 0 R >> >> /Contents 23 0 R " +
          "/Annots [31 0 R] >>"
      },
      {
        number: 5,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 90] " +
          "/Resources << /Font << /FClip 10 0 R >> >> /Contents 24 0 R >>"
      },
      {
        number: 6,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 160 120] " +
          "/Resources << /Font << /FClip 10 0 R >> >> /Contents 25 0 R >>"
      },
      {
        number: 7,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 150 100] " +
          "/Group << /Type /Group /S /Transparency /CS /DeviceRGB /I false /K false >> " +
          "/Resources << /Font << /FGroup 10 0 R >> /Properties << /Visible 40 0 R >> >> " +
          "/Contents 26 0 R >>"
      },
      {
        number: 10,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      },
      {
        number: 11,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>"
      },
      {
        number: 20,
        body: tinyPdfStream(
          "",
          "BT /FMain 13 Tf 0.15 0.25 0.35 rg 1 0 0 1 25 90 Tm (Dense floorplan text) Tj ET\n"
        )
      },
      {
        number: 21,
        body: tinyPdfStream("", [
          "q",
          "10 12 190 105 re W n",
          "/Span BMC",
          "0.2 0.4 0.6 RG 2 w 0 0 m 210 130 l S",
          "0.8 g 20 20 35 25 re f",
          "EMC",
          "Q",
          ""
        ].join("\n"))
      },
      {
        number: 22,
        body: tinyPdfStream("", [
          "q 1 0 0 1 20 10 cm /FmText Do Q",
          "q 1 0 0 1 55 32 cm /FmAlias Do Q",
          ""
        ].join("\n"))
      },
      {
        number: 23,
        body: tinyPdfStream(
          "",
          "BT /FMain 11 Tf 0.2 0.1 0.4 rg 1 0 0 1 30 45 Tm (Text-only bounds) Tj ET\n"
        )
      },
      {
        number: 24,
        body: tinyPdfStream("", [
          "10 10 m 95 10 l W 95 75 l 10 75 l h n",
          "BT /FClip 8 Tf 1 0 0 1 20 35 Tm (POST-W CLIP) Tj ET",
          ""
        ].join("\n"))
      },
      {
        number: 25,
        body: tinyPdfStream("", [
          "q 1 0.1 -0.2 1.5 3 4 cm 2 w 1 J 2 j 9 M [3 1] 0.5 d /Perceptual ri 1 i",
          "0.4 G 0 10 m 10 30 25 -10 40 15 c S",
          "/DeviceRGB CS 0.1 0.2 0.3 SC 5 45 m 55 45 l S",
          "/RGB cs 0.2 0.3 0.4 scn 5 55 20 12 re f",
          "0.1 0.2 0.3 0.1 K 0 75 m 35 75 l S",
          "0.2 0.1 0.3 0.05 k 45 55 18 10 re f*",
          "[0.0000000005 0.0000000005] 0 d -2 w 70 20 m 120 20 l S",
          "Q",
          "/Span BMC BT /FClip 9 Tf 1 0 0 1 8 100 Tm (OPERATOR PAGE) Tj ET EMC",
          "/Point MP /Point << /MCID 2 >> DP",
          ""
        ].join("\n"))
      },
      {
        number: 26,
        body: tinyPdfStream("", [
          "q",
          "/OC /Visible BDC",
          "0.1 0.2 0.3 0.1 K 2 w 10 20 m 135 20 l S",
          "0.2 0.1 0.3 0.05 k 20 35 55 25 re f",
          "BT /FGroup 10 Tf 1 0 0 1 15 78 Tm (VISIBLE OCG TEXT) Tj ET",
          "EMC",
          "Q",
          "BT /FGroup 8 Tf 1 0 0 1 15 8 Tm (OUTSIDE OCG) Tj ET",
          ""
        ].join("\n"))
      },
      {
        number: 30,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 120 24] " +
            "/Matrix [1 0 0 1 12 16] /Resources << /Font << /FLocal 11 0 R >> >>",
          [
            "q",
            "0 0 120 24 re W n",
            "BT /FLocal 9 Tf 1 0 0 1 4 8 Tm (FORM TEXT) Tj ET",
            "Q",
            ""
          ].join("\n")
        )
      },
      { number: 31, body: "<< /Type /Annot /Subtype /Link /Rect [10 10 40 25] /Border [0 0 0] >>" },
      { number: 40, body: "<< /Type /OCG /Name (Visible grouped content) >>" }
    ]
  });
}

function createRawStateFixture() {
  return writeTinyPdf({
    objects: [
      {
        number: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [32 0 R] " +
          "/D << /Order [32 0 R] /OFF [] >> >> >>"
      },
      {
        number: 2,
        body: "<< /Type /Pages /Count 8 /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R 9 0 R 10 0 R] >>"
      },
      { number: 3, body: rawStatePage(20) },
      { number: 4, body: rawStatePage(21) },
      { number: 5, body: rawStatePage(22) },
      { number: 6, body: rawStatePage(23) },
      {
        number: 7,
        body: rawStatePage(24, "/Resources << /ExtGState << /R10 30 0 R >> >>")
      },
      { number: 8, body: rawStatePage(25) },
      {
        number: 9,
        body: rawStatePage(26, "/Resources << /ExtGState << /Alpha 31 0 R >> >>")
      },
      {
        number: 10,
        body: rawStatePage(27, "/Resources << /Properties << /Visible 32 0 R >> >>")
      },
      { number: 20, body: tinyPdfStream("", "-2 w 5 10 m 75 10 l S\n") },
      {
        number: 21,
        body: tinyPdfStream(
          "",
          "q 10 0 0 10 0 0 cm [0.0000000005 0.0000000005] 0 d 1 2 m 7 2 l S Q\n"
        )
      },
      {
        number: 22,
        body: tinyPdfStream("", [
          "40 40 20 20 re W n",
          "1 w 45 50 m 55 50 l S",
          "20 w 10 50 m 20 50 l 80 50 m 90 50 l S",
          ""
        ].join("\n"))
      },
      {
        number: 23,
        body: tinyPdfStream("", "1 w 10 10 m 20 10 l S 20 w 50 50 m 50 50 l S\n")
      },
      {
        number: 24,
        body: tinyPdfStream(
          "",
          "/R10 gs q 10 10 m 70 10 l 40 60 l h W* n 10 10 60 50 re f Q\n"
        )
      },
      {
        number: 25,
        body: tinyPdfStream("", "q 10 10 60 50 re 25 20 20 15 re W* n 10 10 60 50 re f Q\n")
      },
      {
        number: 26,
        body: tinyPdfStream(
          "",
          "/Alpha gs 2 w 10 10 m 70 10 l S 70 10 m 10 10 l S 20 20 30 20 re f\n"
        )
      },
      {
        number: 27,
        body: tinyPdfStream("", "/OC /Visible BDC 10 10 m 70 10 l S EMC\n")
      },
      { number: 30, body: "<< /Type /ExtGState /OPM 1 /OP false /op false >>" },
      { number: 31, body: "<< /Type /ExtGState /BM /Normal /CA 0.4 /ca 0.2 >>" },
      { number: 32, body: "<< /Type /OCG /Name (Visible layer) >>" }
    ]
  });
}

function rawStatePage(contentsObject, extraEntries = "/Resources << >>") {
  return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] ${extraEntries} ` +
    `/Contents ${contentsObject} 0 R >>`;
}

function boxArray(box) {
  return [box.left, box.bottom, box.right, box.top];
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
