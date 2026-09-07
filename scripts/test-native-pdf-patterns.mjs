import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  NativePdfPatternRegistry,
  NativePdfShadingRegistry,
  PdfError,
  openNativePdfDocument
} = await import("../src/pdf/nativePdf.ts");
const {
  HEPR_PATTERN_KIND,
  createEmptyHeprPageData
} = await import("../src/heprDocumentData.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");

const encoder = new TextEncoder();
const coloredContent = encoder.encode("0 0 m 1 1 l S\n".repeat(32));
const compressedColoredContent = new Uint8Array(deflateSync(coloredContent));
assert.ok(compressedColoredContent.byteLength < coloredContent.byteLength);
const uncoloredContent = encoder.encode("0 0 2 2 re f\n");
const tilingTwoContent = encoder.encode("0 0 m 3 3 l S\n");

const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture() });

try {
  const shadings = new NativePdfShadingRegistry(document);
  const registry = new NativePdfPatternRegistry(document, shadings);
  const [colored, coloredAlias] = await Promise.all([
    registry.resolvePagePattern(0, "Colored"),
    registry.resolvePagePattern(0, "/ColoredAlias")
  ]);
  assert.equal(colored.pattern.index, coloredAlias.pattern.index);
  assert.equal(colored.depth, 1);
  assert.deepEqual(colored.ancestry, [colored.pattern.id]);
  assert.equal(colored.pattern.patternType, 1);
  assert.equal(colored.pattern.kind, "colored-tiling");
  assert.equal(colored.pattern.paintType, 1);
  assert.equal(colored.pattern.tilingType, 1);
  assert.deepEqual(colored.pattern.boundingBox, [1, 2, 10, 8]);
  assert.deepEqual(colored.pattern.matrix, [2, 0, 0, 3, 4, 5]);
  assert.equal(colored.pattern.xStep, 12);
  assert.equal(colored.pattern.yStep, 9);
  assert.equal(colored.pattern.resourceOrigin, "local");
  assert.equal(colored.pattern.encodedContentBytes, compressedColoredContent.byteLength);

  const decodedFirst = await registry.decodeTilingContent(colored.pattern.index);
  const decodedSecond = await registry.decodeTilingContent(colored.pattern.index);
  assert.strictEqual(decodedFirst, decodedSecond, "decoded pattern streams are cached by definition");
  assert.deepEqual(decodedFirst, coloredContent);

  const uncolored = await registry.resolvePagePattern(0, "Uncolored");
  assert.equal(uncolored.pattern.patternType, 1);
  assert.equal(uncolored.pattern.kind, "uncolored-tiling");
  assert.equal(uncolored.pattern.paintType, 2);
  assert.equal(uncolored.pattern.tilingType, 3);
  assert.equal(uncolored.pattern.xStep, -4);
  assert.equal(uncolored.pattern.yStep, 5);
  assert.equal(uncolored.pattern.resourceOrigin, "inherited");

  const tilingTwo = await registry.resolvePagePattern(0, "TilingTwo");
  assert.equal(tilingTwo.pattern.patternType, 1);
  assert.equal(tilingTwo.pattern.tilingType, 2);
  assert.deepEqual(tilingTwo.pattern.matrix, [1, 0, 0, 1, 0, 0]);

  const shading = await registry.resolvePagePattern(0, "ShadingPattern");
  assert.equal(shading.pattern.patternType, 2);
  assert.equal(shading.pattern.kind, "shading");
  assert.equal(shading.pattern.shading.kind, "axial");
  assert.equal(shading.pattern.shadingIndex, 0);
  assert.deepEqual(shading.pattern.matrix, [1, 0, 0, 1, 6, 7]);
  assert.equal(shading.pattern.extGState.get("ca"), 0.5);
  assert.equal(shading.pattern.resourceOrigin, "inherited");

  const nested = await registry.resolveNestedPattern(colored, "Nested");
  assert.equal(nested.depth, 2);
  assert.equal(nested.pattern.patternType, 1);
  assert.equal(nested.pattern.resourceOrigin, "inherited");
  assert.notEqual(
    nested.pattern.index,
    uncolored.pattern.index,
    "one inherited pattern stream is scoped by its enclosing resource dictionary"
  );
  assert.notEqual(nested.pattern.id, uncolored.pattern.id);
  await assert.rejects(
    registry.resolveNestedPattern(colored, "Self"),
    hasPdfError("unsupported-content", "pattern-cycle")
  );
  await assert.rejects(
    registry.resolveNestedPattern(nested, "Self"),
    hasPdfError("unsupported-content", "pattern-cycle")
  );

  const sidecars = await registry.buildSidecars();
  assert.equal(sidecars.patterns.kinds.length, registry.size);
  assert.equal(sidecars.matrices.length, registry.size * 6);
  assert.equal(sidecars.contentOffsets.length, registry.size + 1);
  assert.equal(sidecars.contentOffsets.at(-1), sidecars.decodedContent.length);
  assert.equal(sidecars.patterns.kinds[colored.pattern.index], HEPR_PATTERN_KIND.ColoredTiling);
  assert.equal(sidecars.patterns.kinds[uncolored.pattern.index], HEPR_PATTERN_KIND.UncoloredTiling);
  assert.equal(sidecars.patterns.kinds[shading.pattern.index], HEPR_PATTERN_KIND.Shading);
  assert.equal(sidecars.patterns.programIndices[colored.pattern.index], -1);
  assert.equal(sidecars.patterns.gradientIndices[shading.pattern.index], shading.pattern.shadingIndex);
  assert.equal(sidecars.patterns.gradientIndices[colored.pattern.index], -1);
  assert.equal(sidecars.resourceOrigins[colored.pattern.index], 2);
  assert.equal(sidecars.resourceOrigins[uncolored.pattern.index], 1);
  assert.strictEqual(sidecars.extGStates[shading.pattern.index], shading.pattern.extGState);
  assert.deepEqual(
    [...sidecars.decodedContent.subarray(
      sidecars.contentOffsets[colored.pattern.index],
      sidecars.contentOffsets[colored.pattern.index + 1]
    )],
    [...coloredContent]
  );
  const repeatedSidecars = await registry.buildSidecars();
  assert.deepEqual(repeatedSidecars.patternIds, sidecars.patternIds);
  assert.deepEqual(repeatedSidecars.patterns, sidecars.patterns);
  assert.deepEqual(repeatedSidecars.matrices, sidecars.matrices);
  assert.deepEqual(repeatedSidecars.contentOffsets, sidecars.contentOffsets);
  assert.deepEqual(repeatedSidecars.decodedContent, sidecars.decodedContent);

  const page = createEmptyHeprPageData({
    sourcePageIndex: 0,
    mediaBox: [0, 0, 20, 20],
    cropBox: [0, 0, 20, 20],
    bleedBox: null,
    trimBox: null,
    artBox: null,
    rotation: 0,
    userUnit: 1,
    width: 20,
    height: 20
  });
  page.stores.transforms.values = sidecars.matrices;
  page.stores.patterns = sidecars.patterns;
  page.stores.functions = registry.shadings.functions.buildStore();
  page.stores.colors = registry.shadings.colors.buildStore();
  page.stores.gradients = registry.shadings.buildGradientStore();
  page.stores.meshes = registry.shadings.buildMeshStore();
  validateHeprPageData(page);

  await assert.rejects(
    registry.resolvePagePattern(0, "CycleA"),
    hasPdfError("unsupported-content", "pattern-resource-cycle")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "Unsupported"),
    hasPdfError("unsupported-content", "unsupported-pattern-type")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "BadPaint"),
    hasPdfError("invalid-object", "invalid-pattern-paint-type")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "BadTiling"),
    hasPdfError("invalid-object", "invalid-pattern-tiling-type")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "ZeroStep"),
    hasPdfError("invalid-object", "zero-pattern-step")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "NonStream"),
    hasPdfError("invalid-object", "tiling-pattern-not-stream")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "StreamShading"),
    hasPdfError("invalid-object", "shading-pattern-is-stream")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "MissingShading"),
    hasPdfError("invalid-object", "missing-pattern-shading")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "BadMarker"),
    hasPdfError("invalid-object", "invalid-pattern-marker")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "BadExtGState"),
    hasPdfError("invalid-object", "invalid-pattern-extgstate")
  );
  await assert.rejects(
    registry.resolvePagePattern(0, "BadBBox"),
    hasPdfError("invalid-object", "degenerate-pattern-bbox")
  );

  const countLimited = new NativePdfPatternRegistry(document, undefined, { maxPatterns: 1 });
  await countLimited.resolvePagePattern(0, "Colored");
  await assert.rejects(
    countLimited.resolvePagePattern(0, "Uncolored"),
    hasPdfError("resource-limit", "pattern-count")
  );

  const depthLimited = new NativePdfPatternRegistry(document, undefined, { maxPatternDepth: 1 });
  const depthRoot = await depthLimited.resolvePagePattern(0, "Colored");
  await assert.rejects(
    depthLimited.resolveNestedPattern(depthRoot, "Nested"),
    hasPdfError("resource-limit", "pattern-depth")
  );

  const decodedLimited = new NativePdfPatternRegistry(document, undefined, {
    maxDecodedPatternBytes: compressedColoredContent.byteLength + 1
  });
  const decodedLimitedPattern = await decodedLimited.resolvePagePattern(0, "Colored");
  await assert.rejects(
    decodedLimited.decodeTilingContent(decodedLimitedPattern.pattern.index),
    hasPdfError("resource-limit", "pattern-decoded-bytes")
  );

  const cacheLimited = new NativePdfPatternRegistry(document, undefined, {
    maxDecodedPatternBytes: coloredContent.byteLength,
    maxCachedDecodedPatternBytes: coloredContent.byteLength
  });
  const cacheColored = await cacheLimited.resolvePagePattern(0, "Colored");
  const cacheUncolored = await cacheLimited.resolvePagePattern(0, "Uncolored");
  await cacheLimited.decodeTilingContent(cacheColored.pattern.index);
  await assert.rejects(
    cacheLimited.decodeTilingContent(cacheUncolored.pattern.index),
    hasPdfError("resource-limit", "pattern-cache-bytes")
  );

  const controller = new AbortController();
  controller.abort("pattern fixture cancellation");
  await assert.rejects(
    registry.resolvePagePattern(0, "Colored", controller.signal),
    hasPdfError("aborted")
  );

  assert.throws(
    () => new NativePdfPatternRegistry(document, undefined, {
      maxPatternDepth: document.limits.maxRecursionDepth + 1
    }),
    RangeError
  );
  assert.throws(
    () => new NativePdfPatternRegistry(document, { document: {} }),
    TypeError
  );
} finally {
  await document.close();
  hooks.deregister();
}

console.log("native PDF pattern registry tests passed");

function fixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources <<",
          "/Pattern << /Colored 10 0 R /ColoredAlias 10 0 R /Uncolored 11 0 R",
          "/ShadingPattern 12 0 R /TilingTwo 13 0 R /Unsupported 14 0 R",
          "/BadPaint 15 0 R /BadTiling 16 0 R /ZeroStep 17 0 R /NonStream 18 0 R",
          "/StreamShading 19 0 R /MissingShading 20 0 R /BadMarker 23 0 R",
          "/BadExtGState 24 0 R /BadBBox 25 0 R /CycleA /CycleB /CycleB /CycleA >>",
          "/Shading << /S1 21 0 R >> >> >>"
        ].join(" ")
      },
      {
        number: 10,
        body: tinyPdfStream(
          [
            "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1",
            "/BBox [10 8 1 2] /XStep 12 /YStep 9 /Matrix [2 0 0 3 4 5]",
            "/Resources << /Pattern << /Nested 11 0 R /Self 10 0 R >> >>",
            "/Filter /FlateDecode"
          ].join(" "),
          compressedColoredContent
        )
      },
      {
        number: 11,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 3 /BBox [0 0 2 2] /XStep -4 /YStep 5",
          uncoloredContent
        )
      },
      {
        number: 12,
        body: [
          "<< /Type /Pattern /PatternType 2 /Shading /S1 /Matrix [1 0 0 1 6 7]",
          "/ExtGState << /ca 0.5 /CA 0.75 /BM /Multiply >> >>"
        ].join(" ")
      },
      {
        number: 13,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 2 /BBox [0 0 3 3] /XStep 3 /YStep 3",
          tilingTwoContent
        )
      },
      { number: 14, body: "<< /Type /Pattern /PatternType 7 >>" },
      {
        number: 15,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 3 /TilingType 1 /BBox [0 0 1 1] /XStep 1 /YStep 1",
          ""
        )
      },
      {
        number: 16,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 4 /BBox [0 0 1 1] /XStep 1 /YStep 1",
          ""
        )
      },
      {
        number: 17,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 1 1] /XStep 0 /YStep 1",
          ""
        )
      },
      {
        number: 18,
        body: "<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 1 1] /XStep 1 /YStep 1 >>"
      },
      {
        number: 19,
        body: tinyPdfStream("/Type /Pattern /PatternType 2 /Shading 21 0 R", "q Q")
      },
      { number: 20, body: "<< /Type /Pattern /PatternType 2 >>" },
      {
        number: 21,
        body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 10 0] /Function 22 0 R >>"
      },
      {
        number: 22,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1 0 1 0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>"
      },
      {
        number: 23,
        body: tinyPdfStream(
          "/Type /XObject /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 1 1] /XStep 1 /YStep 1",
          ""
        )
      },
      { number: 24, body: "<< /Type /Pattern /PatternType 2 /Shading 21 0 R /ExtGState 7 >>" },
      {
        number: 25,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [1 1 1 2] /XStep 1 /YStep 1",
          ""
        )
      }
    ]
  });
}

function hasPdfError(code, reason) {
  return (error) => {
    assert.ok(error instanceof PdfError, `expected PdfError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (reason !== undefined) assert.equal(error.details?.reason, reason);
    return true;
  };
}
