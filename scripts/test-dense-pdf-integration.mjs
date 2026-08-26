import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  degrees,
  rgb
} from "pdf-lib";

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

try {
  const [compilerModule, documentModule, workerModule, extractorModule] = await Promise.all([
    import("../src/densePdfContentCompiler.ts"),
    import("../src/densePdfDocument.ts"),
    import("../src/densePdfFastWorker.ts"),
    import("../src/pdfVectorExtractor.ts")
  ]);
  const { compileDensePdfContent } = compilerModule;
  const { buildDenseTextMiniPdf, preflightDensePdfDocument } = documentModule;
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

  const preflight = await preflightDensePdfDocument(pdfBytes);
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
    compiledPages.push({ selectedPage, geometry, compiled });
  }
  const mini = await buildDenseTextMiniPdf(
    preflight.document,
    compiledPages.map(({ selectedPage, compiled }) => ({
      sourcePageIndex: selectedPage.sourcePageIndex,
      retainedTextContent: compiled.retainedTextContent,
      referencedFonts: new Set(compiled.referencedFonts),
      referencedProperties: new Set(compiled.referencedProperties),
      referencedExtGStates: new Set(compiled.referencedExtGStates),
      referencedXObjects: new Set(compiled.referencedXObjects)
    }))
  );

  const workerResult = {
    kind: "success",
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
    textMiniPdfBytes: mini.bytes,
    timing: {
      preflightMs: preflight.timing.totalMs,
      decodeMs: compiledPages.reduce(
        (total, { selectedPage }) => total + selectedPage.decodeTiming.elapsedMs,
        0
      ),
      compileMs: 0,
      textMiniPdfMs: mini.timing.totalMs,
      totalMs: 0
    }
  };

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
  const fastScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
    pdfFastPath: "auto",
    enableSegmentMerge: true,
    enableInvisibleCull: true,
    extractTextContent: true,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(workers.length, 1);
  assert.equal(fastScenes.length, 5);
  assert.deepEqual(fastScenes, forcedScenes);
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
  const fallbackScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
    pdfFastPath: "auto",
    enableSegmentMerge: true,
    enableInvisibleCull: true,
    extractTextContent: true,
    onProgress: (event) => fallbackProgress.push(event)
  });
  assert.deepEqual(fallbackScenes, forcedScenes);
  assert.ok(
    fallbackProgress.some((event) => event.executionPath === "main-thread-fallback"),
    "fallback progress must identify the PDF.js execution path"
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
    preflightDensePdfDocument
  });

  console.log("Dense PDF end-to-end differential test passed.");
} finally {
  if (originalWorker) {
    Object.defineProperty(globalThis, "Worker", originalWorker);
  } else {
    delete globalThis.Worker;
  }
  hooks.deregister();
}

async function testRawStateDifferentials({
  compileDensePdfContent,
  computeDensePdfPageGeometry,
  extractPdfPageScenes,
  preflightDensePdfDocument
}) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const negativeWidthPage = document.addPage([100, 80]);
  negativeWidthPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(
      new TextEncoder().encode("-2 w 5 10 m 75 10 l S\n")
    ))
  );
  const tinyDashPage = document.addPage([100, 80]);
  tinyDashPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode(
      "q 10 0 0 10 0 0 cm [0.0000000005 0.0000000005] 0 d 1 2 m 7 2 l S Q\n"
    )))
  );
  const clippedPathWidthPage = document.addPage([100, 80]);
  clippedPathWidthPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode([
      "40 40 20 20 re W n",
      "1 w 45 50 m 55 50 l S",
      "20 w 10 50 m 20 50 l 80 50 m 90 50 l S",
      ""
    ].join("\n"))))
  );
  const degeneratePathWidthPage = document.addPage([100, 80]);
  degeneratePathWidthPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode(
      "1 w 10 10 m 20 10 l S 20 w 50 50 m 50 50 l S\n"
    )))
  );
  const inertStateClipPage = document.addPage([100, 80]);
  const inertState = document.context.register(document.context.obj({
    Type: "ExtGState",
    OPM: 1,
    OP: false,
    op: false
  }));
  inertStateClipPage.node.Resources().set(
    PDFName.ExtGState,
    document.context.obj({ R10: inertState })
  );
  inertStateClipPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode(
      "/R10 gs q 10 10 m 70 10 l 40 60 l h W* n 10 10 60 50 re f Q\n"
    )))
  );
  const rectangleMaskPage = document.addPage([100, 80]);
  rectangleMaskPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode(
      "q 10 10 60 50 re 25 20 20 15 re W* n 10 10 60 50 re f Q\n"
    )))
  );
  const alphaPage = document.addPage([100, 80]);
  const alphaState = document.context.register(document.context.obj({
    Type: "ExtGState",
    BM: "Normal",
    CA: 0.4,
    ca: 0.2
  }));
  alphaPage.node.Resources().set(
    PDFName.ExtGState,
    document.context.obj({ Alpha: alphaState })
  );
  alphaPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode(
      "/Alpha gs 2 w 10 10 m 70 10 l S 70 10 m 10 10 l S 20 20 30 20 re f\n"
    )))
  );
  const optionalContentPage = document.addPage([100, 80]);
  const visibleGroup = document.context.register(document.context.obj({
    Type: "OCG",
    Name: PDFHexString.fromText("Visible layer")
  }));
  document.catalog.set(PDFName.of("OCProperties"), document.context.obj({
    OCGs: [visibleGroup],
    D: { Order: [visibleGroup], OFF: [] }
  }));
  optionalContentPage.node.Resources().set(
    PDFName.of("Properties"),
    document.context.obj({ Visible: visibleGroup })
  );
  optionalContentPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode(
      "/OC /Visible BDC 10 10 m 70 10 l S EMC\n"
    )))
  );
  const bytes = new Uint8Array(await document.save({ useObjectStreams: false }));

  for (const enableInvisibleCull of [false, true]) {
    const forced = await extractPdfPageScenes(toArrayBuffer(bytes), {
      pdfFastPath: "off",
      enableSegmentMerge: true,
      enableInvisibleCull
    });
    const preflight = await preflightDensePdfDocument(bytes);
    assert.equal(preflight.eligible, true);
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
      assertPackedGeometryParity(compiled, forced[index], `raw state page ${index + 1}`);
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
    assert.equal(forced[4].fillPathCount, 1, "irregular W* must retain its clipped fill");
    assert.equal(forced[5].fillPathCount, 1, "rectangle exclusion mask must retain its fill");
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
    "operatorCount",
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

async function createFixture() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([220, 140]);
  page.setCropBox(5, 7, 205, 125);
  page.setRotation(degrees(90));
  const font = await document.embedFont(StandardFonts.Helvetica);
  const formFont = await document.embedFont(StandardFonts.CourierBold);
  page.drawText("Dense floorplan text", {
    font,
    x: 25,
    y: 90,
    size: 13,
    color: rgb(0.15, 0.25, 0.35)
  });

  const existingContents = page.node.get(PDFName.Contents);
  assert.ok(existingContents);
  const extraContents = document.context.register(document.context.stream(
    new TextEncoder().encode([
      "q",
      "10 12 190 105 re W n",
      "/Span BMC",
      "0.2 0.4 0.6 RG 2 w 0 0 m 210 130 l S",
      "0.8 g 20 20 35 25 re f",
      "EMC",
      "Q",
      ""
    ].join("\n"))
  ));
  const formFonts = document.context.obj({ FLocal: formFont.ref });
  const formResources = document.context.obj({ Font: formFonts });
  const textForm = document.context.flateStream(new TextEncoder().encode([
    "q",
    "0 0 120 24 re W n",
    "BT /FLocal 9 Tf 1 0 0 1 4 8 Tm (FORM TEXT) Tj ET",
    "Q",
    ""
  ].join("\n")));
  textForm.dict.set(PDFName.Type, PDFName.XObject);
  textForm.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  textForm.dict.set(PDFName.of("FormType"), document.context.obj(1));
  textForm.dict.set(PDFName.of("BBox"), document.context.obj([0, 0, 120, 24]));
  textForm.dict.set(PDFName.of("Matrix"), document.context.obj([1, 0, 0, 1, 12, 16]));
  textForm.dict.set(PDFName.Resources, formResources);
  const textFormRef = document.context.register(textForm);
  const xObjects = document.context.obj({
    FmText: textFormRef,
    FmAlias: textFormRef
  });
  page.node.Resources().set(PDFName.XObject, xObjects);
  const formInvocation = document.context.register(document.context.stream(
    new TextEncoder().encode([
      "q 1 0 0 1 20 10 cm /FmText Do Q",
      "q 1 0 0 1 55 32 cm /FmAlias Do Q",
      ""
    ].join("\n"))
  ));
  const contents = document.context.obj([]);
  assert.ok(contents instanceof PDFArray);
  const resolvedExistingContents = document.context.lookup(existingContents);
  if (resolvedExistingContents instanceof PDFArray) {
    for (const entry of resolvedExistingContents.asArray()) {
      contents.push(entry);
    }
  } else {
    contents.push(existingContents);
  }
  contents.push(extraContents);
  contents.push(formInvocation);
  page.node.set(PDFName.Contents, contents);

  const textOnlyPage = document.addPage([180, 100]);
  textOnlyPage.drawText("Text-only bounds", {
    font,
    x: 30,
    y: 45,
    size: 11,
    color: rgb(0.2, 0.1, 0.4)
  });
  const nonVisualLink = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [10, 10, 40, 25],
    Border: [0, 0, 0]
  }));
  const nonVisualSquare = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Square",
    Rect: [50, 10, 80, 25],
    Border: [0, 0, 0],
    Contents: PDFHexString.fromText("Nonvisual regression annotation")
  }));
  textOnlyPage.node.set(
    PDFName.Annots,
    document.context.obj([nonVisualLink, nonVisualSquare])
  );

  const postClipPage = document.addPage([100, 90]);
  const postClipFonts = document.context.obj({ FClip: font.ref });
  postClipPage.node.Resources().set(PDFName.Font, postClipFonts);
  const postClipContents = document.context.register(document.context.stream(
    new TextEncoder().encode([
      "10 10 m 75 10 l W 75 75 l 10 75 l h n",
      "BT /FClip 12 Tf 1 0 0 1 20 35 Tm (POST-W CLIP) Tj ET",
      ""
    ].join("\n"))
  ));
  postClipPage.node.set(PDFName.Contents, postClipContents);

  const operatorPage = document.addPage([160, 120]);
  const operatorFonts = document.context.obj({ FClip: font.ref });
  operatorPage.node.Resources().set(PDFName.Font, operatorFonts);
  const operatorContents = document.context.register(document.context.stream(
    new TextEncoder().encode([
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
  ));
  operatorPage.node.set(PDFName.Contents, operatorContents);

  const groupedPage = document.addPage([150, 100]);
  const visibleGroup = document.context.register(document.context.obj({
    Type: "OCG",
    Name: PDFHexString.fromText("Visible grouped content")
  }));
  document.catalog.set(
    PDFName.of("OCProperties"),
    document.context.obj({
      OCGs: [visibleGroup],
      D: { Order: [visibleGroup], OFF: [] }
    })
  );
  groupedPage.node.set(
    PDFName.of("Group"),
    document.context.obj({
      Type: "Group",
      S: "Transparency",
      CS: "DeviceRGB",
      I: false,
      K: false
    })
  );
  groupedPage.node.Resources().set(
    PDFName.Font,
    document.context.obj({ FGroup: font.ref })
  );
  groupedPage.node.Resources().set(
    PDFName.of("Properties"),
    document.context.obj({ Visible: visibleGroup })
  );
  groupedPage.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(new TextEncoder().encode([
      "q",
      "/OC /Visible BDC",
      "0.1 0.2 0.3 0.1 K 2 w 10 20 m 135 20 l S",
      "0.2 0.1 0.3 0.05 k 20 35 55 25 re f",
      "BT /FGroup 10 Tf 1 0 0 1 15 78 Tm (VISIBLE OCG TEXT) Tj ET",
      "EMC",
      "Q",
      "BT /FGroup 8 Tf 1 0 0 1 15 8 Tm (OUTSIDE OCG) Tj ET",
      ""
    ].join("\n"))))
  );
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

function boxArray(box) {
  return [box.left, box.bottom, box.right, box.top];
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
