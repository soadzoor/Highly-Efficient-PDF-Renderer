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

const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const {
  NativePdfType3Registry,
  parseLeadingType3Metrics
} = await import("../src/pdf/nativeType3.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();
const coloredContent = encoder.encode([
  "% Metrics must remain the first operator.",
  "500 0 d0",
  "1 0 0 rg 0 0 500 700 re f\n".repeat(24)
].join("\n"));
const compressedColoredContent = new Uint8Array(deflateSync(coloredContent));
const uncoloredContent = encoder.encode("600 0 -5 -10 600 700 d1\n0 0 600 700 re f\n");
const secondContent = encoder.encode("501 0 d0\n0 0 m 10 10 l S\n");
assert.ok(compressedColoredContent.byteLength < coloredContent.byteLength);

const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture() });

try {
  const localDictionary = await document.resolveDictionary(ref(10));
  const inheritedDictionary = await document.resolveDictionary(ref(11));
  const pageResources = await document.resolveDictionary(document.getPage(0).resources);
  const localResources = await document.resolveDictionary(localDictionary.get("Resources"));
  const registry = new NativePdfType3Registry(document);
  const local = await registry.prepareFont(localDictionary, {
    fontRef: ref(10),
    inheritedResources: pageResources
  });

  assert.equal(registry.size, 0, "font preparation must not touch unused CharProc streams");
  assert.deepEqual(local.fontMatrix, [0.001, 0, 0, 0.001, 0, 0]);
  assert.deepEqual(local.fontBBox, [-10, -20, 700, 800]);
  assert.equal(local.firstChar, 65);
  assert.equal(local.lastChar, 70);
  assert.deepEqual(local.widths, [500, 600, 500, 800, 900, 501]);
  assert.equal(local.resourceOrigin, "local");
  assert.strictEqual(local.resources, localResources);
  assert.equal(local.charProcNameForCode(65), "Colored");
  assert.equal(local.charProcNameForCode(66), "Uncolored");
  assert.equal(local.charProcNameForCode(67), "Alias");
  assert.equal(local.charProcNameForCode(0), ".notdef");
  assert.equal(local.encodingUnicode[65], null, "custom glyph names have no inferred text value");
  assert.equal(local.toUnicode[65], "Ω", "ToUnicode remains semantic metadata only");
  assert.equal(local.widthForCode(64), null);
  assert.equal(local.widthForCode(65), 500);

  const [colored, alias] = await Promise.all([
    local.resolveGlyph(65),
    local.resolveGlyph(67)
  ]);
  assert.strictEqual(colored.charProc, alias.charProc, "aliases deduplicate by source and scope");
  assert.equal(registry.size, 1);
  assert.equal(colored.charProc.metrics.operator, "d0");
  assert.equal(colored.charProc.metrics.colored, true);
  assert.equal(colored.charProc.metrics.widthX, 500);
  assert.equal(colored.charProc.metrics.boundingBox, null);
  assert.ok(colored.charProc.metrics.contentOffset > 0);
  assert.deepEqual(colored.charProc.decodedBytes, coloredContent);
  assert.equal(colored.charProc.encodedContentBytes, compressedColoredContent.byteLength);
  assert.strictEqual(colored.charProc.resources, localResources);
  assert.equal(colored.charProc.resourceOrigin, "local");
  assert.equal(colored.charProc.ref.objectNumber, 20);
  assert.equal(colored.toUnicode, "Ω");
  assert.equal(colored.charProcName, "Colored", "ToUnicode cannot select the CharProc");
  assert.deepEqual(colored.ancestry, [colored.charProc.id]);

  const uncolored = await local.resolveGlyph(66);
  assert.equal(registry.size, 2);
  assert.equal(uncolored.charProc.metrics.operator, "d1");
  assert.equal(uncolored.charProc.metrics.colored, false);
  assert.deepEqual(uncolored.charProc.metrics.boundingBox, [-5, -10, 600, 700]);
  assert.deepEqual(uncolored.charProc.decodedBytes, uncoloredContent);

  await assert.rejects(
    local.resolveGlyph(68),
    hasPdfError("unsupported-font", "type3-charproc-leading-metrics")
  );
  assert.equal(registry.size, 2, "a malformed used CharProc is never retained");
  assert.ok(local.charProcs.has("UnusedBad"), "the malformed unused fixture remains addressable");
  await assert.rejects(
    local.resolveGlyph(69),
    hasPdfError("unsupported-font", "type3-charproc-missing")
  );
  await assert.rejects(
    local.resolveCharProc("CycleA"),
    hasPdfError("unsupported-font", "type3-charproc-alias-cycle")
  );

  const inherited = await registry.prepareFont(inheritedDictionary, {
    fontRef: ref(11),
    inheritedResources: pageResources
  });
  assert.equal(inherited.resourceOrigin, "inherited");
  assert.strictEqual(inherited.resources, pageResources);
  const inheritedColored = await inherited.resolveGlyph(65);
  assert.notStrictEqual(
    inheritedColored.charProc,
    colored.charProc,
    "one stream under a different effective resource scope is a different reusable program"
  );
  assert.notEqual(inheritedColored.charProc.id, colored.charProc.id);
  assert.strictEqual(inheritedColored.charProc.resources, pageResources);

  const second = await local.resolveGlyph(70);
  const nestedSecond = await registry.resolveNestedGlyph(colored, local, 70);
  assert.strictEqual(nestedSecond.charProc, second.charProc);
  assert.equal(nestedSecond.depth, 2);
  assert.deepEqual(nestedSecond.ancestry, [colored.charProc.id, second.charProc.id]);
  await assert.rejects(
    registry.resolveNestedGlyph(nestedSecond, local, 65),
    hasPdfError("unsupported-font", "type3-resource-cycle")
  );

  await testLimits(document, localDictionary);
  await testDefinitionCountLimit(document);
  await testStructuralValidation(document, localDictionary);

  assert.throws(
    () => parseLeadingType3Metrics(encoder.encode("500 0 q 500 0 d0"), "LateMetrics"),
    hasPdfError("unsupported-font", "type3-charproc-leading-metrics")
  );
  assert.throws(
    () => parseLeadingType3Metrics(encoder.encode("500 1 d0"), "Vertical"),
    hasPdfError("unsupported-font", "type3-charproc-vertical-width")
  );
  assert.throws(
    () => parseLeadingType3Metrics(encoder.encode("500 0 10 0 -10 20 d1"), "Reversed"),
    hasPdfError("unsupported-font", "type3-charproc-bbox-reversed")
  );

  const controller = new AbortController();
  controller.abort("Type3 fixture cancellation");
  await assert.rejects(local.resolveGlyph(65, controller.signal), hasPdfError("aborted"));
  assert.throws(
    () => new NativePdfType3Registry(document, {
      maxCharProcDepth: document.limits.maxRecursionDepth + 1
    }),
    RangeError
  );
} finally {
  await document.close();
  hooks.deregister();
}

console.log("native Type3 preparation tests passed");

async function testLimits(document, localDictionary) {
  const decodedLimited = new NativePdfType3Registry(document, {
    maxDecodedCharProcBytes: 32
  });
  const decodedFont = await decodedLimited.prepareFont(localDictionary, { fontRef: ref(10) });
  await assert.rejects(
    decodedFont.resolveGlyph(65),
    hasPdfError("resource-limit", "type3-charproc-decoded-bytes")
  );

  const cacheLimited = new NativePdfType3Registry(document, {
    maxDecodedCharProcBytes: coloredContent.byteLength,
    maxCachedDecodedCharProcBytes: coloredContent.byteLength
  });
  const cacheFont = await cacheLimited.prepareFont(localDictionary, { fontRef: ref(10) });
  await cacheFont.resolveGlyph(65);
  await assert.rejects(
    cacheFont.resolveGlyph(66),
    hasPdfError("resource-limit", "type3-charproc-cache-bytes")
  );

  const depthLimited = new NativePdfType3Registry(document, { maxCharProcDepth: 1 });
  const depthFont = await depthLimited.prepareFont(localDictionary, { fontRef: ref(10) });
  const depthRoot = await depthFont.resolveGlyph(65);
  await assert.rejects(
    depthLimited.resolveNestedGlyph(depthRoot, depthFont, 70),
    hasPdfError("resource-limit", "type3-charproc-depth")
  );

  const dictionaryLimited = new NativePdfType3Registry(document, { maxCharProcs: 1 });
  await assert.rejects(
    dictionaryLimited.prepareFont(localDictionary, { fontRef: ref(10) }),
    hasPdfError("resource-limit", "type3-charproc-dictionary-count")
  );
}

async function testDefinitionCountLimit(document) {
  const registry = new NativePdfType3Registry(document, { maxCharProcs: 1 });
  const firstDictionary = await document.resolveDictionary(ref(30));
  const secondDictionary = await document.resolveDictionary(ref(31));
  const first = await registry.prepareFont(firstDictionary, { fontRef: ref(30) });
  const second = await registry.prepareFont(secondDictionary, { fontRef: ref(31) });
  await first.resolveGlyph(65);
  await assert.rejects(
    second.resolveGlyph(65),
    hasPdfError("resource-limit", "type3-charproc-count")
  );
}

async function testStructuralValidation(document, validDictionary) {
  const registry = new NativePdfType3Registry(document);
  const missingMatrix = new Map(validDictionary);
  missingMatrix.delete("FontMatrix");
  await assert.rejects(
    registry.prepareFont(missingMatrix),
    hasPdfError("invalid-object", "type3-font-number-array")
  );

  const badWidths = new Map(validDictionary);
  badWidths.set("Widths", [500]);
  await assert.rejects(
    registry.prepareFont(badWidths),
    hasPdfError("invalid-object", "type3-font-number-array")
  );

  const badEncoding = new Map(validDictionary);
  badEncoding.set("Encoding", new Map([
    ["Differences", [{ kind: "name", value: "NoCode" }]]
  ]));
  await assert.rejects(
    registry.prepareFont(badEncoding),
    hasPdfError("invalid-object", "type3-encoding-differences-code")
  );
}

function fixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]",
          "/Resources << /ExtGState << /PageGS << /ca 0.75 >> >>",
          "/Font << /Local 10 0 R /Inherited 11 0 R >> >> >>"
        ].join(" ")
      },
      {
        number: 10,
        body: [
          "<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0]",
          "/FontBBox [-10 -20 700 800] /FirstChar 65 /LastChar 70",
          "/Widths [500 600 500 800 900 501] /Encoding 12 0 R",
          "/CharProcs 13 0 R /Resources 14 0 R /ToUnicode 15 0 R >>"
        ].join(" ")
      },
      {
        number: 11,
        body: [
          "<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0]",
          "/FontBBox [0 0 500 700] /FirstChar 65 /LastChar 65 /Widths [500]",
          "/Encoding << /BaseEncoding /StandardEncoding /Differences [65 /Colored] >>",
          "/CharProcs << /Colored 20 0 R >> >>"
        ].join(" ")
      },
      {
        number: 12,
        body: [
          "<< /Type /Encoding /BaseEncoding /StandardEncoding",
          "/Differences [65 /Colored /Uncolored /Alias /Broken /Absent /Second] >>"
        ].join(" ")
      },
      {
        number: 13,
        body: [
          "<< /Colored 20 0 R /Uncolored 21 0 R /Alias 20 0 R /Broken 22 0 R",
          "/UnusedBad 23 0 R /Second 25 0 R /CycleA /CycleB /CycleB /CycleA >>"
        ].join(" ")
      },
      { number: 14, body: "<< /ExtGState << /LocalGS << /ca 0.5 >> >> /Font << /Self 10 0 R >> >>" },
      {
        number: 15,
        body: tinyPdfStream("", [
          "1 begincodespacerange <00> <ff> endcodespacerange",
          "2 beginbfchar <41> <03a9> <42> <0055> endbfchar"
        ].join("\n"))
      },
      {
        number: 20,
        body: tinyPdfStream("/Filter /FlateDecode", compressedColoredContent)
      },
      { number: 21, body: tinyPdfStream("", uncoloredContent) },
      { number: 22, body: tinyPdfStream("", "q 800 0 d0 Q") },
      { number: 23, body: tinyPdfStream("", "this unused program is deliberately malformed") },
      { number: 25, body: tinyPdfStream("", secondContent) },
      {
        number: 30,
        body: [
          "<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0]",
          "/FontBBox [0 0 300 300] /FirstChar 65 /LastChar 65 /Widths [300]",
          "/Encoding << /Differences [65 /One] >> /CharProcs << /One 40 0 R >> >>"
        ].join(" ")
      },
      {
        number: 31,
        body: [
          "<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0]",
          "/FontBBox [0 0 301 301] /FirstChar 65 /LastChar 65 /Widths [301]",
          "/Encoding << /Differences [65 /Two] >> /CharProcs << /Two 41 0 R >> >>"
        ].join(" ")
      },
      { number: 40, body: tinyPdfStream("", "300 0 d0\n") },
      { number: 41, body: tinyPdfStream("", "301 0 d0\n") }
    ]
  });
}

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function hasPdfError(code, reason) {
  return (error) => error instanceof PdfError && error.code === code &&
    (reason === undefined || error.details?.reason === reason);
}
