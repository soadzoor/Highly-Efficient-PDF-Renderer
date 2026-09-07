import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { registerHooks } from "node:module";
import { writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  hasNativeInlineImageCandidate,
  prepareNativeInlineImages
} = await import("../src/pdf/nativeInlineImage.ts");
const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const { NativePdfImageRegistry, unpackNativeImageCodecRequest } = await import("../src/pdf/nativeImage.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");
const { createEmptyHeprPageData } = await import("../src/heprDocumentData.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");

const encoder = new TextEncoder();

function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

function concat(...parts) {
  const normalized = parts.map(bytes);
  const output = new Uint8Array(normalized.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of normalized) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function inline(dictionary, payload, suffix = " EI") {
  return concat(`BI ${dictionary} ID `, payload, suffix);
}

function name(value) {
  return { kind: "name", value };
}

function expectPdfError(run, code, reason) {
  assert.throws(
    run,
    (error) => error instanceof PdfError &&
      error.code === code &&
      (reason === undefined || error.details?.reason === reason),
    `expected PdfError(${code}${reason ? `, ${reason}` : ""})`
  );
}

function makeDocument() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" }
    ]
  });
}

// The prefilter only returns false when a delimiter-bounded BI token is
// impossible. Hidden BI-shaped bytes remain safe false positives and are left
// to the structural parser; ordinary word fragments are rejected cheaply.
assert.equal(hasNativeInlineImageCandidate(bytes("q 0 0 m 1 1 l S Q")), false);
assert.equal(hasNativeInlineImageCandidate(bytes("BI /W 1 /H 1 ID x EI")), true);
assert.equal(hasNativeInlineImageCandidate(bytes("q\nBI% dictionary follows\n/W 1")), true);
assert.equal(hasNativeInlineImageCandidate(bytes("q/BI Q")), true, "a name is a safe false positive");
assert.equal(hasNativeInlineImageCandidate(bytes("q (BI) Q")), true, "a string is a safe false positive");
assert.equal(hasNativeInlineImageCandidate(bytes("q % BI in a comment\nQ")), true, "a comment is a safe false positive");
assert.equal(hasNativeInlineImageCandidate(bytes("q <4249> Q")), false, "hex text is not raw BI bytes");
assert.equal(hasNativeInlineImageCandidate(bytes("q XBI BIX XBIY Q")), false);
assert.equal(hasNativeInlineImageCandidate(bytes("BI")), true, "stream edges are token boundaries");
assert.equal(hasNativeInlineImageCandidate(bytes("\0BI\t")), true, "PDF whitespace bounds a token");

const contentOnlyBytes = bytes("q 0 0 m 1 1 l S Q");
const contentOnly = prepareNativeInlineImages(contentOnlyBytes, { sourceOffset: 41 });
assert.equal(contentOnly.images.length, 0);
assert.equal(contentOnly.segments.length, 1);
assert.equal(contentOnly.segments[0].bytes, contentOnlyBytes, "the fast path keeps the input view");
assert.equal(contentOnly.segments[0].sourceOffset, 41);

// Exact raw length wins over binary bytes that resemble an EI delimiter. The
// unknown entry deliberately exercises strings, hex strings, arrays, nested
// dictionaries, name escapes, and the spec rule that non-inline keys are ignored.
const rawPayload = Uint8Array.of(0x20, 0x45, 0x49, 0x20, 0x00, 0xff);
const rawContent = concat(
  "q ",
  inline(
    "/W 2 /H 1 /BPC 8 /CS /RGB /D [0 1 0 1 0 1] /I true " +
      "/Intent /RelativeColorimetric /Type /Bogus /Subtype /Bogus /Length 999 " +
      "/Ignored [(literal\\) value) <0f> << /N /A#20B >>]",
    rawPayload
  ),
  " Q"
);
const raw = prepareNativeInlineImages(rawContent, { sourceOffset: 1_000 });
assert.equal(raw.images.length, 1);
assert.equal(raw.contentSpans.length, 2);
assert.deepEqual(raw.segments.map((segment) => segment.kind), ["content", "image", "content"]);
assert.equal(raw.contentSpans[0].bytes.buffer, rawContent.buffer, "content spans remain zero-copy views");
assert.equal(raw.sourceOffset, 1_000);
assert.equal(raw.images[0].sourceOffset, 1_002);
assert.deepEqual([...raw.images[0].stream.bytes], [...rawPayload]);
assert.equal(raw.images[0].stream.bytes.buffer, rawContent.buffer, "encoded payloads remain zero-copy views");
assert.equal(raw.images[0].stream.dictionary.get("Width"), 2);
assert.equal(raw.images[0].stream.dictionary.get("Height"), 1);
assert.equal(raw.images[0].stream.dictionary.get("BitsPerComponent"), 8);
assert.deepEqual(raw.images[0].stream.dictionary.get("ColorSpace"), name("DeviceRGB"));
assert.equal(raw.images[0].stream.dictionary.get("Ignored"), undefined);
assert.equal(raw.images[0].stream.dictionary.get("Length"), undefined);
assert.deepEqual(raw.images[0].stream.dictionary.get("Type"), name("XObject"));
assert.deepEqual(raw.images[0].stream.dictionary.get("Subtype"), name("Image"));
assert.deepEqual(raw.images[0].filterNames, []);
assert.ok(raw.images[0].dictionaryLength > 0);
assert.equal(raw.images[0].dataLength, rawPayload.length);
assert.equal(raw.images[0].eiOffset, raw.images[0].dataOffset + rawPayload.length + 1);

const indexed = prepareNativeInlineImages(
  inline("/W 1 /H 1 /BPC 1 /CS [/I /RGB 1 <FF000000FF00>]", Uint8Array.of(0x80))
);
assert.deepEqual(indexed.images[0].stream.dictionary.get("ColorSpace"), [
  name("Indexed"),
  name("DeviceRGB"),
  1,
  { kind: "string", bytes: Uint8Array.of(0xff, 0x00, 0x00, 0x00, 0xff, 0x00), hex: true }
]);

const imageMask = prepareNativeInlineImages(
  inline("/W 2 /H 1 /IM true /D [1 0]", Uint8Array.of(0x80))
);
assert.equal(imageMask.images[0].stream.dictionary.get("ImageMask"), true);

const resourceColor = prepareNativeInlineImages(
  inline("/W 1 /H 1 /BPC 8 /CS /Al#69as", Uint8Array.of(255, 0, 0))
);
assert.deepEqual(resourceColor.images[0].stream.dictionary.get("ColorSpace"), name("Alias"));

const compressed = deflateSync(Uint8Array.of(127));
const compressedHex = `${Buffer.from(compressed).toString("hex")}>`;
const predictor = prepareNativeInlineImages(
  inline(
    "/W 1 /H 1 /BPC 8 /CS /G /F [/AHx /Fl] " +
      "/DP [null << /Predictor 2 /Colors 1 /BitsPerComponent 8 /Columns 1 >>]",
    compressedHex
  )
);
assert.deepEqual(predictor.images[0].filterNames, ["ASCIIHexDecode", "FlateDecode"]);
assert.equal(predictor.images[0].decodeParameters.length, 2);
assert.equal(predictor.images[0].decodeParameters[1].get("Predictor"), 2);
assert.deepEqual([...predictor.images[0].stream.bytes], [...encoder.encode(compressedHex)]);

const ascii85 = prepareNativeInlineImages(
  inline("/W 4 /H 1 /BPC 8 /CS /G /F /A85", "z~>")
);
assert.deepEqual(ascii85.images[0].filterNames, ["ASCII85Decode"]);
assert.equal(new TextDecoder().decode(ascii85.images[0].stream.bytes), "z~>");

// A false EOI in an APP segment must not terminate JPEG data; the actual EOI
// occurs after an SOS entropy section with byte stuffing.
const jpegPayload = Uint8Array.of(
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x06, 0xff, 0xd9, 0x00, 0x00,
  0xff, 0xda, 0x00, 0x02,
  0x11, 0xff, 0x00, 0x22,
  0xff, 0xd9
);
const jpeg = prepareNativeInlineImages(
  inline("/W 1 /H 1 /BPC 8 /CS /RGB /F /DCT", jpegPayload)
);
assert.deepEqual(jpeg.images[0].filterNames, ["DCTDecode"]);
assert.deepEqual([...jpeg.images[0].stream.bytes], [...jpegPayload]);

// RunLength has no intrinsic content terminator. The embedded " EI " candidate
// is rejected because its following binary byte is not valid content syntax.
const runLengthPayload = Uint8Array.of(5, 1, 0x20, 0x45, 0x49, 0x20, 0xff, 128);
const generic = prepareNativeInlineImages(
  concat("q ", inline("/W 6 /H 1 /BPC 8 /CS /G /F /RL", runLengthPayload), " Q")
);
assert.deepEqual(generic.images[0].filterNames, ["RunLengthDecode"]);
assert.deepEqual([...generic.images[0].stream.bytes], [...runLengthPayload]);

const delimiterAfterEi = prepareNativeInlineImages(
  inline("/W 1 /H 1 /BPC 8 /CS /G /F /RL", Uint8Array.of(128), " EI/Q Do")
);
assert.equal(delimiterAfterEi.images.length, 1, "a PDF delimiter may follow EI without whitespace");

// Exercise every remaining standard filter/value abbreviation structurally.
const abbreviationOnly = prepareNativeInlineImages(
  concat(
    inline("/W 1 /H 1 /BPC 8 /CS /CMYK /F [/LZW /CCF]", Uint8Array.of(0x80)),
    " q"
  )
);
assert.deepEqual(abbreviationOnly.images[0].filterNames, ["LZWDecode", "CCITTFaxDecode"]);
assert.deepEqual(abbreviationOnly.images[0].stream.dictionary.get("ColorSpace"), name("DeviceCMYK"));

const multipleContent = concat(
  "q ",
  inline("/W 1 /H 1 /BPC 8 /CS /G", Uint8Array.of(1)),
  " Q q ",
  inline("/W 1 /H 1 /BPC 8 /CS /G /F /AHx", "7f>"),
  " Q"
);
const multiple = prepareNativeInlineImages(multipleContent);
assert.equal(multiple.images.length, 2);
assert.equal(multiple.contentSpans.length, 3);
assert.deepEqual(
  multiple.segments.map((segment) => segment.kind),
  ["content", "image", "content", "image", "content"]
);
assert.deepEqual(multiple.images.map((record) => record.imageIndex), [0, 1]);

const hiddenKeywords = encoder.encode(
  "q (BI ID EI) <4249> [/BI << /Label (EI) >>] Do % BI /W 9 ID x EI\nQ"
);
const hidden = prepareNativeInlineImages(hiddenKeywords);
assert.equal(hidden.images.length, 0, "strings, names, arrays, dictionaries, and comments are lexed exactly");
assert.equal(hidden.contentSpans.length, 1);
assert.equal(hidden.contentSpans[0].bytes.buffer, hiddenKeywords.buffer);

// Two generic candidates both admit exact continuation syntax. Failing closed
// is deterministic and avoids payload corruption.
const ambiguous = concat(
  inline("/W 1 /H 1 /BPC 8 /CS /G /F /RL", Uint8Array.of(128)),
  " ",
  inline("/W 1 /H 1 /BPC 8 /CS /G /F /RL", Uint8Array.of(128)),
  " Q"
);
expectPdfError(
  () => prepareNativeInlineImages(ambiguous),
  "unsupported-image",
  "inline-image-ambiguous-boundary"
);

expectPdfError(
  () => prepareNativeInlineImages(encoder.encode("BI /W 1 /H 1 ID> EI")),
  "unsupported-image",
  "inline-image-id-whitespace"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /Width 1 /H 1 /BPC 8 /CS /G", Uint8Array.of(0))),
  "unsupported-image",
  "inline-image-duplicate-key"
);
expectPdfError(
  () => prepareNativeInlineImages(encoder.encode("BI /W 1 /H 1 /D [0 1 ID x EI")),
  "unsupported-image"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /H 1 /Unknown 99 0 R /BPC 8 /CS /G", Uint8Array.of(0))),
  "unsupported-image"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /H 1 /BPC 8 /CS /G /F /JPXDecode", Uint8Array.of(0))),
  "unsupported-image",
  "inline-image-forbidden-filter"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /H 1 /BPC 8 /CS /G /F /JBIG2Decode", Uint8Array.of(0))),
  "unsupported-image",
  "inline-image-forbidden-filter"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /H 1 /BPC 8 /CS /G /F /BogusDecode", Uint8Array.of(0))),
  "unsupported-image",
  "inline-image-unsupported-filter"
);
expectPdfError(
  () => prepareNativeInlineImages(concat("BI /W 1 /H 1 /BPC 8 /CS /G ID ", Uint8Array.of(0))),
  "unsupported-image",
  "inline-image-ei-whitespace"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /H 1 /BPC 8 /CS /G /F /AHx", "00")),
  "unsupported-image",
  "inline-image-asciihex-terminator"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /H 1 /BPC 8 /CS /G /F /A85", "z~x")),
  "unsupported-image",
  "inline-image-ascii85-terminator"
);
expectPdfError(
  () => prepareNativeInlineImages(inline("/W 1 /H 1 /BPC 8 /CS /RGB /F /DCT", Uint8Array.of(0xff, 0xd8))),
  "unsupported-image",
  "inline-image-dct-structure"
);
expectPdfError(() => prepareNativeInlineImages(encoder.encode("ID x")), "unsupported-content");
expectPdfError(() => prepareNativeInlineImages(encoder.encode("EI")), "unsupported-content");

expectPdfError(
  () => prepareNativeInlineImages(multipleContent, { limits: { maxImages: 1 } }),
  "resource-limit",
  "inline-image-count"
);
expectPdfError(
  () => prepareNativeInlineImages(rawContent, { limits: { maxDictionaryEntries: 1 } }),
  "resource-limit",
  "inline-image-dictionary-entries"
);
expectPdfError(
  () => prepareNativeInlineImages(rawContent, { limits: { maxDictionaryBytes: 8 } }),
  "resource-limit",
  "inline-image-dictionary-bytes"
);
expectPdfError(
  () => prepareNativeInlineImages(rawContent, { limits: { maxPayloadBytes: 5 } }),
  "resource-limit",
  "inline-image-payload"
);
expectPdfError(
  () => prepareNativeInlineImages(rawContent, { limits: { maxScanBytes: 4 } }),
  "resource-limit",
  "inline-image-scan"
);
const cancelled = new AbortController();
cancelled.abort("fixture cancellation");
expectPdfError(() => prepareNativeInlineImages(rawContent, { signal: cancelled.signal }), "aborted");

// Prepared streams feed the existing native image/color stores without a
// serializer round-trip or an external resource lookup.
const document = await openNativePdfDocument({ kind: "bytes", bytes: makeDocument() });
try {
  const registry = new NativePdfImageRegistry(document);
  const aliasResources = new Map([["Alias", name("DeviceRGB")]]);
  const rawIndex = await registry.add(raw.images[0].stream);
  const indexedIndex = await registry.add(indexed.images[0].stream);
  const maskIndex = await registry.add(imageMask.images[0].stream);
  const aliasIndex = await registry.add(resourceColor.images[0].stream, aliasResources);
  const predictorIndex = await registry.add(predictor.images[0].stream);
  const ascii85Index = await registry.add(ascii85.images[0].stream);
  const genericIndex = await registry.add(generic.images[0].stream);
  const jpegIndex = await registry.add(jpeg.images[0].stream);

  assert.deepEqual([...registry.describe(rawIndex).data], [32, 69, 73, 255, 32, 0, 255, 255]);
  assert.equal(registry.describe(indexedIndex).width, 1);
  assert.equal(registry.describe(maskIndex).sourceBitsPerComponent, 1);
  assert.equal(registry.describe(aliasIndex).colorSpaceIndex >= 0, true);
  assert.deepEqual([...registry.describe(predictorIndex).data], [127, 127, 127, 255]);
  assert.deepEqual([...registry.describe(ascii85Index).data], [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual([...registry.describe(genericIndex).data], [1, 1, 1, 255, 32, 32, 32, 255, 69, 69, 69, 255, 73, 73, 73, 255, 32, 32, 32, 255, 255, 255, 255, 255]);
  const jpegRequest = unpackNativeImageCodecRequest(registry.describe(jpegIndex).data);
  assert.equal(jpegRequest.codec, "jpeg");
  assert.deepEqual([...jpegRequest.encoded], [...jpegPayload]);

  const page = createEmptyHeprPageData({
    sourcePageIndex: 0,
    mediaBox: [0, 0, 10, 10],
    cropBox: [0, 0, 10, 10],
    bleedBox: null,
    trimBox: null,
    artBox: null,
    rotation: 0,
    userUnit: 1,
    width: 10,
    height: 10
  });
  page.stores.colors = registry.colors.buildStore();
  page.stores.images = registry.buildStore();
  validateHeprPageData(page);
} finally {
  await document.close();
}

hooks.deregister();
console.log("native inline-image tests passed");
