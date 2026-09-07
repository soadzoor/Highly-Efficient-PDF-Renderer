import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { createCanvas } from "@napi-rs/canvas";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !specifier.endsWith(".ts")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [sessionApi, canvasApi, dataApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprCanvas2dRenderer.ts"),
    import("../src/heprDocumentData.ts")
  ]);
  const { openPdf } = sessionApi;
  const {
    HEPR_CANVAS_2D_ERROR_CODES,
    HeprCanvas2dError,
    computeHeprCanvas2dSize,
    renderHeprPageToCanvas2d
  } = canvasApi;
  const {
    HEPR_FONT_KIND,
    HEPR_IMAGE_FORMAT,
    HEPR_PATH_FLAG,
    HEPR_PATH_VERB,
    HEPR_VIEW_TRANSFORM_FLAG
  } = dataApi;

  const session = await openPdf({
    kind: "bytes",
    bytes: canvasFixture(),
    label: "canvas2d-reference.pdf"
  });
  let page;
  try {
    page = await session.compilePage(0, { optimization: "none" });
  } finally {
    await session.close();
  }
  addGlyphFixture(page, {
    HEPR_FONT_KIND,
    HEPR_PATH_FLAG,
    HEPR_PATH_VERB
  });

  assert.deepEqual(computeHeprCanvas2dSize(page, 2), { width: 24, height: 20, scale: 2 });
  const result = await renderHeprPageToCanvas2d(page, {
    scale: 2,
    background: [1, 1, 1, 1],
    surfaceFactory
  });
  assert.equal(result.surface.canvas.width, 24);
  assert.equal(result.surface.canvas.height, 20);
  assert.ok(result.stats.drawRuns >= 7);

  assertPixelNear(pagePixel(result, 1, 5), [0, 0, 255, 255], 2, "persistent clip");
  assertPixelNear(pagePixel(result, 4, 4), [128, 128, 0, 255], 3, "group alpha");
  assertPixelNear(pagePixel(result, 7, 5), [0, 0, 0, 255], 3, "Multiply blend");
  assertPixelNear(pagePixel(result, 10, 3), [0, 255, 0, 255], 2, "image top row");
  assertPixelNear(pagePixel(result, 10, 1), [0, 0, 255, 255], 2, "image bottom row");
  assertPixelNear(pagePixel(result, 10, 8), [0, 0, 0, 255], 8, "ordered stroke");
  assert.ok(
    countDarkPixels(result, 4, 0, 8, 4) > 0,
    "derived glyph outlines must paint without a platform font lookup"
  );

  const shadingSession = await openPdf({
    kind: "bytes",
    bytes: shadingFixture(),
    label: "canvas2d-shadings.pdf"
  });
  let shadingPage;
  try {
    shadingPage = await shadingSession.compilePage(0, { optimization: "none" });
  } finally {
    await shadingSession.close();
  }
  const shadingResult = await renderHeprPageToCanvas2d(shadingPage, {
    scale: 2,
    background: [1, 1, 1, 1],
    surfaceFactory,
    meshColorTolerance: 0.2
  });
  assert.ok(shadingResult.stats.drawRuns >= 5, "all ordered shading runs execute");
  assertDominant(pagePixel(shadingResult, 0.35, 5), 0, "nonlinear axial start");
  assertDominant(pagePixel(shadingResult, 3.65, 5), 2, "nonlinear axial end");
  assertDominant(pagePixel(shadingResult, 6, 5), 0, "radial center");
  assertPixelNear(pagePixel(shadingResult, 10, 5), [0, 255, 0, 255], 2, "ordered solid overlay");
  assert.equal(pagePixel(shadingResult, 14, 5)[3], 255, "triangle mesh remains visible");
  assert.equal(pagePixel(shadingResult, 18, 5)[3], 255, "Coons patch tessellation remains visible");

  const gradientPaintPage = structuredClone(shadingPage);
  const greenCommand = gradientPaintPage.displayProgram.groups[
    gradientPaintPage.displayProgram.rootGroupIndex
  ].commands.find((command) =>
    command.kind === "draw" &&
      (command.source === "fill-paths" || command.source === "paths") &&
      (command.source === "fill-paths" ? command.paintIndex >= 0 : command.fillPaintIndex >= 0)
  );
  assert.ok(greenCommand, "shading fixture contains a generic solid path");
  const gradientPaintIndex = greenCommand.source === "fill-paths"
    ? greenCommand.paintIndex
    : greenCommand.fillPaintIndex;
  gradientPaintPage.stores.paints.kinds[gradientPaintIndex] = dataApi.HEPR_PAINT_KIND.Gradient;
  gradientPaintPage.stores.paints.resourceIndices[gradientPaintIndex] = 0;
  const gradientPaintResult = await renderHeprPageToCanvas2d(gradientPaintPage, {
    background: [1, 1, 1, 1],
    surfaceFactory,
    meshColorTolerance: 0.2
  });
  assertDominant(pagePixel(gradientPaintResult, 8.2, 5), 2, "gradient path paint executes in source order");

  await assert.rejects(
    renderHeprPageToCanvas2d(shadingPage, {
      surfaceFactory,
      maxGradientStops: 2,
      meshColorTolerance: 0.2
    }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit)
  );

  const patternSession = await openPdf({
    kind: "bytes",
    bytes: canvasPatternFixture(),
    label: "canvas2d-patterns.pdf"
  });
  let patternPage;
  try {
    patternPage = await patternSession.compilePage(0, { optimization: "none" });
  } finally {
    await patternSession.close();
  }
  const patternResult = await renderHeprPageToCanvas2d(patternPage, {
    scale: 4,
    background: [1, 1, 1, 1],
    surfaceFactory
  });
  assertDominant(pagePixel(patternResult, 0.5, 5), 0, "colored tiling cell");
  assertPixelNear(pagePixel(patternResult, 1.5, 5), [255, 255, 255, 255], 3, "colored tiling gap");
  assertDominant(pagePixel(patternResult, 4.5, 5), 2, "negative-step uncolored base paint");
  assertPixelNear(pagePixel(patternResult, 5.5, 5), [255, 255, 255, 255], 3, "uncolored tiling gap");
  assertDominant(pagePixel(patternResult, 8.3, 5), 0, "shading pattern start");
  assertDominant(pagePixel(patternResult, 11.7, 5), 2, "shading pattern end");
  assertDominant(pagePixel(patternResult, 12.5, 5), 0, "nested tiling pattern cell");
  assertPixelNear(pagePixel(patternResult, 13.5, 5), [255, 255, 255, 255], 3, "nested tiling gap");
  assertPixelNear(pagePixel(patternResult, 3, 3), [0, 255, 0, 255], 3, "ordered paint after pattern");

  await assert.rejects(
    renderHeprPageToCanvas2d(patternPage, { surfaceFactory, maxPatternDepth: 1 }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit)
  );
  await assert.rejects(
    renderHeprPageToCanvas2d(patternPage, { surfaceFactory, maxPatternCells: 1 }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit)
  );
  await assert.rejects(
    renderHeprPageToCanvas2d(patternPage, { surfaceFactory, maxPatternPixels: 1 }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit)
  );
  const patternController = new AbortController();
  const patternReason = new Error("cancel Canvas2D pattern render");
  patternController.abort(patternReason);
  await assert.rejects(
    renderHeprPageToCanvas2d(patternPage, {
      surfaceFactory,
      signal: patternController.signal
    }),
    (error) => error === patternReason
  );
  await assert.rejects(
    renderHeprPageToCanvas2d(shadingPage, {
      surfaceFactory,
      maxMeshTriangles: 1,
      meshColorTolerance: 0.2
    }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit)
  );

  const softMaskPage = buildSoftMaskPage(page);
  const softMaskResult = await renderHeprPageToCanvas2d(softMaskPage, {
    background: [1, 1, 1, 1],
    surfaceFactory
  });
  assertPixelNear(pagePixel(softMaskResult, 1, 5), [255, 0, 0, 255], 2, "alpha soft mask inside");
  assertPixelNear(pagePixel(softMaskResult, 5, 5), [255, 255, 255, 255], 2, "alpha soft mask outside");

  const shapeAlphaPage = buildSoftMaskPage(page);
  shapeAlphaPage.displayProgram.groups[2].alphaIsShape = true;
  await assert.rejects(
    renderHeprPageToCanvas2d(shapeAlphaPage, { surfaceFactory }),
    (error) => error instanceof HeprCanvas2dError &&
      error.code === HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite &&
      error.path === "displayProgram.groups[2].alphaIsShape",
    "active /AIS must fail explicitly until Canvas2D has separate shape accumulation"
  );

  const discardedSoftMasks = buildSoftMaskPage(page);
  const discardedRoot = discardedSoftMasks.displayProgram.groups[
    discardedSoftMasks.displayProgram.rootGroupIndex
  ];
  const discardedGroup = discardedSoftMasks.displayProgram.groups[2];
  discardedGroup.alpha = 0;
  discardedRoot.commands.push(structuredClone(discardedRoot.commands[0]));
  const discardedResult = await renderHeprPageToCanvas2d(discardedSoftMasks, {
    surfaceFactory,
    maxWorkingPixels: discardedSoftMasks.pageInfo.width * discardedSoftMasks.pageInfo.height
  });
  assert.equal(discardedResult.stats.softMaskExecutions, 2,
    "discarded consumers release each completed mask surface before the next invocation");

  const viewDependent = buildViewTransformPage(page, HEPR_VIEW_TRANSFORM_FLAG.NoZoom);
  await assert.rejects(
    renderHeprPageToCanvas2d(viewDependent, { surfaceFactory }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.UnsupportedViewTransform),
    "viewer-dependent annotation transforms must not be silently rendered at the wrong scale"
  );

  const encodedPage = structuredClone(page);
  const imageIndex = firstImageIndex(encodedPage);
  const originalImageBytes = encodedPage.stores.images.data.slice(
    encodedPage.stores.images.dataOffsets[imageIndex],
    encodedPage.stores.images.dataOffsets[imageIndex + 1]
  );
  encodedPage.stores.images.formats[imageIndex] = HEPR_IMAGE_FORMAT.Jpeg;
  await assert.rejects(
    renderHeprPageToCanvas2d(encodedPage, { surfaceFactory }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage)
  );
  let decoderCalls = 0;
  const decodedResult = await renderHeprPageToCanvas2d(encodedPage, {
    surfaceFactory,
    imageDecoder(request) {
      decoderCalls += 1;
      assert.equal(request.imageIndex, imageIndex);
      assert.deepEqual(request.data, originalImageBytes);
      return { width: request.width, height: request.height, rgba: request.data };
    }
  });
  assert.equal(decoderCalls, 1, "an encoded resource is decoded once and cached");
  assertPixelNear(pagePixel(decodedResult, 10, 3), [0, 255, 0, 255], 2, "decoded image");

  const knockoutPage = structuredClone(page);
  const invoked = knockoutPage.displayProgram.groups.find((group, index) =>
    index !== knockoutPage.displayProgram.rootGroupIndex && group.alpha < 1
  );
  assert.ok(invoked);
  invoked.knockout = true;
  await assert.rejects(
    renderHeprPageToCanvas2d(knockoutPage, { surfaceFactory }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite)
  );

  const overprintPage = structuredClone(page);
  const firstPaint = firstSolidPaint(overprintPage);
  overprintPage.stores.paints.overprint[firstPaint] = 1;
  await assert.rejects(
    renderHeprPageToCanvas2d(overprintPage, { surfaceFactory }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint)
  );

  await assert.rejects(
    renderHeprPageToCanvas2d(page, { surfaceFactory, maxCanvasPixels: 10 }),
    isCanvasError(HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit)
  );
  const controller = new AbortController();
  const reason = new Error("cancel Canvas2D reference render");
  controller.abort(reason);
  await assert.rejects(
    renderHeprPageToCanvas2d(page, { surfaceFactory, signal: controller.signal }),
    (error) => error === reason
  );

  assert.throws(
    () => computeHeprCanvas2dSize(page, 0),
    (error) => error instanceof HeprCanvas2dError &&
      error.code === HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions
  );

  console.log("Dependency-free page-native Canvas2D reference backend tests passed.");
} finally {
  hooks.deregister();
}

function canvasFixture() {
  const content = [
    "1 0 0 rg 0 0 12 10 re f",
    "q 0 0 2 10 re W n 0 0 1 rg 0 0 12 10 re f Q",
    "q /Half gs 0 1 0 rg 2 2 4 4 re f Q",
    "q /Mul gs 0 0 1 rg 6 4 2 2 re f Q",
    "q 4 0 0 4 8 0 cm /Im Do Q",
    "0 0 0 RG 1 w 0 8 m 12 8 l S"
  ].join("\n");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 12 10] " +
          "/Resources << /ExtGState << /Half 5 0 R /Mul 6 0 R >> " +
          "/XObject << /Im 7 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", `${content}\n`) },
      { number: 5, body: "<< /Type /ExtGState /ca 0.5 >>" },
      { number: 6, body: "<< /Type /ExtGState /BM /Multiply >>" },
      {
        number: 7,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 2 " +
            "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false",
          Uint8Array.of(0, 255, 0, 0, 0, 255)
        )
      }
    ]
  });
}

function shadingFixture() {
  const freeFormBytes = packRecords(
    [2, 8, 8, 8, 8, 8],
    [
      [0, 0, 0, 255, 0, 0],
      [3, 255, 0, 0, 255, 0],
      [3, 0, 255, 0, 0, 255],
      [1, 255, 255, 255, 255, 255]
    ]
  );
  const patchBytes = packPatchRecord({
    points: [
      [0, 0], [0, 85], [0, 170], [0, 255],
      [85, 255], [170, 255], [255, 255],
      [255, 170], [255, 85], [255, 0],
      [170, 0], [85, 0]
    ],
    colors: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]
  });
  const content = [
    "q 0 0 4 10 re W n /Ax sh Q",
    "q 1 0 0 1 4 0 cm 0 0 4 10 re W n /Rad sh Q",
    "0 1 0 rg 8 0 4 10 re f",
    "q 1 0 0 1 12 0 cm 0 0 4 10 re W n /Mesh sh Q",
    "q 1 0 0 1 16 0 cm 0 0 4 10 re W n /Patch sh Q"
  ].join("\n");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 10] " +
        "/Resources << /Shading << /Ax 5 0 R /Rad 6 0 R /Mesh 7 0 R /Patch 8 0 R >> >> " +
        "/Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", `${content}\n`) },
    {
      number: 5,
      body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 4 0] " +
        "/Function 9 0 R /Extend [true true] >>"
    },
    {
      number: 6,
      body: "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [2 5 0 2 5 2] " +
        "/Function 9 0 R /Extend [true true] >>"
    },
    {
      number: 7,
      body: tinyPdfStream(
        "/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 " +
          "/BitsPerComponent 8 /BitsPerFlag 2 " +
          "/Decode [0 4 0 10 0 1 0 1 0 1]",
        freeFormBytes
      )
    },
    {
      number: 8,
      body: tinyPdfStream(
        "/ShadingType 6 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 " +
          "/BitsPerComponent 8 /BitsPerFlag 8 " +
          "/Decode [0 4 0 10 0 1 0 1 0 1]",
        patchBytes
      )
    },
    {
      number: 9,
      body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1 0 1 0 1] " +
        "/C0 [1 0 0] /C1 [0 0 1] /N 2 >>"
    }
  ] });
}

function canvasPatternFixture() {
  const content = [
    "/Pattern cs /C scn 0 0 4 8 re f",
    "/UPat cs 0 0 1 /U scn 4 0 4 8 re f",
    "/Pattern cs /S scn 8 0 4 8 re f",
    "/Pattern CS /S SCN 8.5 1 m 11.5 7 l 0.5 w S",
    "/Pattern cs /Outer scn 12 0 4 8 re f",
    "0 1 0 rg 2 2 2 2 re f"
  ].join("\n");
  const colored = (extra, body) => tinyPdfStream(
    `/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 ${extra}`,
    body
  );
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 16 8] " +
        "/Resources << /ColorSpace << /Pattern /Pattern /UPat [/Pattern /DeviceRGB] >> " +
        "/Pattern << /C 5 0 R /U 6 0 R /S 7 0 R /Outer 8 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", `${content}\n`) },
    {
      number: 5,
      body: colored(
        "/BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << >>",
        "1 0 0 rg 0 0 1 2 re f"
      )
    },
    {
      number: 6,
      body: tinyPdfStream(
        "/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 3 " +
          "/BBox [0 0 2 2] /XStep -2 /YStep 2 /Resources << >>",
        "0 0 1 2 re f"
      )
    },
    {
      number: 7,
      body: "<< /Type /Pattern /PatternType 2 /Matrix [1 0 0 1 8 0] /Shading 10 0 R >>"
    },
    {
      number: 8,
      body: colored(
        "/BBox [0 0 4 4] /XStep 4 /YStep 4 /Matrix [1 0 0 1 12 0] " +
          "/Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /Inner 9 0 R >> >>",
        "/Pattern cs /Inner scn 0 0 4 4 re f"
      )
    },
    {
      number: 9,
      body: colored(
        "/BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << >>",
        "1 0 0 rg 0 0 1 2 re f"
      )
    },
    {
      number: 10,
      body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 4 0] " +
        "/Function 11 0 R /Extend [true true] >>"
    },
    {
      number: 11,
      body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>"
    }
  ] });
}

function packRecords(widths, records) {
  const strideBytes = Math.ceil(widths.reduce((total, width) => total + width, 0) / 8);
  const output = new Uint8Array(strideBytes * records.length);
  records.forEach((values, recordIndex) => {
    let bitOffset = recordIndex * strideBytes * 8;
    values.forEach((value, valueIndex) => {
      const width = widths[valueIndex];
      for (let bit = width - 1; bit >= 0; bit -= 1) {
        if (Math.floor(value / 2 ** bit) % 2 === 1) {
          output[Math.floor(bitOffset / 8)] |= 1 << (7 - (bitOffset % 8));
        }
        bitOffset += 1;
      }
    });
  });
  return output;
}

function packPatchRecord({ points, colors }) {
  const bits = [];
  writeBits(bits, 0, 8);
  for (const [x, y] of points) {
    writeBits(bits, x, 8);
    writeBits(bits, y, 8);
  }
  for (const color of colors) {
    for (const component of color) writeBits(bits, component, 8);
  }
  const output = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => {
    if (bit) output[index >>> 3] |= 1 << (7 - (index & 7));
  });
  return output;
}

function writeBits(bits, value, width) {
  for (let bit = width - 1; bit >= 0; bit -= 1) {
    bits.push(Math.floor(value / 2 ** bit) % 2);
  }
}

function addGlyphFixture(page, constants) {
  const paths = page.stores.paths;
  const pathIndex = paths.pathVerbOffsets.length - 1;
  const verbStart = paths.verbs.length;
  const coordinateStart = paths.coordinates.length;
  paths.pathVerbOffsets = appendTyped(paths.pathVerbOffsets, Uint32Array.of(verbStart + 5));
  paths.verbs = appendTyped(paths.verbs, Uint8Array.of(
    constants.HEPR_PATH_VERB.MoveTo,
    constants.HEPR_PATH_VERB.LineTo,
    constants.HEPR_PATH_VERB.LineTo,
    constants.HEPR_PATH_VERB.LineTo,
    constants.HEPR_PATH_VERB.Close
  ));
  paths.verbCoordinateOffsets = appendTyped(paths.verbCoordinateOffsets, Uint32Array.of(
    coordinateStart + 2,
    coordinateStart + 4,
    coordinateStart + 6,
    coordinateStart + 8,
    coordinateStart + 8
  ));
  paths.coordinates = appendTyped(paths.coordinates, Float32Array.of(
    0, 0,
    1000, 0,
    1000, 1000,
    0, 1000
  ));
  paths.bounds = appendTyped(paths.bounds, Float32Array.of(0, 0, 1000, 1000));
  paths.flags = appendTyped(paths.flags, Uint8Array.of(constants.HEPR_PATH_FLAG.Closed));

  const transformIndex = page.stores.transforms.values.length / 6;
  page.stores.transforms.values = appendTyped(
    page.stores.transforms.values,
    Float32Array.of(0.004, 0, 0, 0.004, 4, 0)
  );
  page.stores.glyphs = {
    fontIndices: Uint32Array.of(0),
    characterCodes: Uint32Array.of(65),
    glyphIds: Uint32Array.of(65),
    transformIndices: Uint32Array.of(transformIndex),
    advances: Float32Array.of(4, 0),
    flags: Uint8Array.of(0)
  };
  page.stores.fonts = {
    names: ["CanvasFixture"],
    kinds: Uint8Array.of(constants.HEPR_FONT_KIND.TrueType),
    unitsPerEm: Uint32Array.of(1000),
    ascents: Float32Array.of(1000),
    descents: Float32Array.of(0),
    glyphOffsets: Uint32Array.of(0, 1),
    glyphIds: Uint32Array.of(65),
    outlinePathStarts: Uint32Array.of(pathIndex),
    outlinePathCounts: Uint32Array.of(1),
    type3ProgramIndices: Int32Array.of(-1)
  };
  page.textIndex = {
    version: 1,
    text: "A",
    charGlyphIndices: Int32Array.of(0),
    fallbackQuads: new Float32Array(0)
  };
  page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands.push({
    kind: "draw",
    source: "glyphs",
    transformIndex: 0,
    clipIndex: -1,
    optionalContentIndex: -1,
    markedContentIndex: -1,
    sourceOffset: -1,
    sourceLength: -1,
    first: 0,
    count: 1,
    fillPaintIndex: findBlackPaint(page),
    strokePaintIndex: -1,
    strokeStyleIndex: -1,
    renderingMode: 0
  });
}

function appendTyped(first, second) {
  const output = new first.constructor(first.length + second.length);
  output.set(first);
  output.set(second, first.length);
  return output;
}

function findBlackPaint(page) {
  const colors = page.stores.colors;
  const paints = page.stores.paints;
  for (let paintIndex = 0; paintIndex < paints.kinds.length; paintIndex += 1) {
    const colorIndex = paints.resourceIndices[paintIndex];
    const start = colors.parameterOffsets[colorIndex];
    const end = colors.parameterOffsets[colorIndex + 1];
    if (
      end - start === 3 &&
      colors.parameters[start] === 0 &&
      colors.parameters[start + 1] === 0 &&
      colors.parameters[start + 2] === 0
    ) {
      return paintIndex;
    }
  }
  throw new Error("fixture has no black paint");
}

function surfaceFactory(width, height) {
  const canvas = createCanvas(width, height);
  return { canvas, context: canvas.getContext("2d") };
}

function pagePixel(result, x, y) {
  const deviceX = Math.max(0, Math.min(result.width - 1, Math.floor(x * result.scale)));
  const deviceY = Math.max(
    0,
    Math.min(result.height - 1, result.height - 1 - Math.floor(y * result.scale))
  );
  return [...result.surface.context.getImageData(deviceX, deviceY, 1, 1).data];
}

function countDarkPixels(result, minX, minY, maxX, maxY) {
  let count = 0;
  const x0 = Math.floor(minX * result.scale);
  const x1 = Math.ceil(maxX * result.scale);
  const y0 = result.height - Math.ceil(maxY * result.scale);
  const y1 = result.height - Math.floor(minY * result.scale);
  const pixels = result.surface.context.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 40 && pixels[offset + 1] < 40 && pixels[offset + 2] < 40 && pixels[offset + 3] > 200) {
      count += 1;
    }
  }
  return count;
}

function assertPixelNear(actual, expected, tolerance, label) {
  assert.equal(actual.length, 4);
  for (let component = 0; component < 4; component += 1) {
    assert.ok(
      Math.abs(actual[component] - expected[component]) <= tolerance,
      `${label} component ${component}: expected ${expected}, received ${actual}`
    );
  }
}

function assertDominant(pixel, component, label) {
  const other = [0, 1, 2].filter((index) => index !== component);
  assert.ok(
    pixel[component] >= pixel[other[0]] + 40 && pixel[component] >= pixel[other[1]] + 40,
    `${label}: expected component ${component} to dominate, received ${pixel}`
  );
  assert.equal(pixel[3], 255, `${label}: expected opaque paint`);
}

function buildSoftMaskPage(source) {
  const page = structuredClone(source);
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  const red = root.commands.find((command) =>
    command.kind === "draw" &&
    (command.source === "fill-paths" || command.source === "paths") &&
    command.clipIndex < 0
  );
  const clipped = root.commands.find((command) =>
    command.kind === "draw" && command.clipIndex >= 0
  );
  assert.ok(red && clipped);
  const base = {
    isolated: true,
    knockout: false,
    blendMode: "Normal",
    alpha: 1,
    alphaIsShape: false,
    softMaskGroupIndex: -1,
    softMaskSubtype: null,
    softMaskTransferFunctionIndex: -1,
    backdropPaintIndex: -1,
    blendingColorSpaceIndex: -1,
    clipIndex: -1
  };
  page.displayProgram.groups = [
    {
      ...base,
      commands: [{
        kind: "invoke-group",
        transformIndex: 0,
        clipIndex: -1,
        optionalContentIndex: -1,
        markedContentIndex: -1,
        sourceOffset: -1,
        sourceLength: -1,
        groupIndex: 2
      }]
    },
    { ...base, commands: [clipped] },
    {
      ...base,
      commands: [red],
      softMaskGroupIndex: 1,
      softMaskSubtype: "Alpha"
    }
  ];
  page.displayProgram.rootGroupIndex = 0;
  return page;
}

function buildViewTransformPage(source, viewTransformFlags) {
  const page = structuredClone(source);
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  const draw = root.commands.find((command) => command.kind === "draw" && command.count > 0);
  assert.ok(draw);
  page.displayProgram.programs = [{
    kind: "form",
    commands: [draw],
    matrixIndex: 0,
    bounds: null,
    clipToBounds: false,
    resourceName: "viewer-dependent annotation"
  }];
  root.commands = [{
    kind: "invoke-program",
    transformIndex: 0,
    clipIndex: -1,
    optionalContentIndex: -1,
    markedContentIndex: -1,
    sourceOffset: -1,
    sourceLength: -1,
    programIndex: 0,
    type3PaintIndex: -1,
    viewTransformFlags
  }];
  return page;
}

function firstImageIndex(page) {
  for (const group of page.displayProgram.groups) {
    for (const command of group.commands) {
      if (command.kind === "draw" && command.source === "images") return command.first;
    }
  }
  throw new Error("fixture has no image command");
}

function firstSolidPaint(page) {
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  for (const command of root.commands) {
    if (command.kind !== "draw") continue;
    if (command.source === "fill-paths" || command.source === "stroke-segments") {
      return command.paintIndex;
    }
    if (command.source === "paths" && command.fillPaintIndex >= 0) {
      return command.fillPaintIndex;
    }
  }
  throw new Error("fixture has no root solid paint");
}

function isCanvasError(code) {
  return (error) => error instanceof Error && error.name === "HeprCanvas2dError" && error.code === code;
}
