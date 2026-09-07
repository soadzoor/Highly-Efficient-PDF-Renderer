import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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
const { PdfError } = await import("../src/pdf/nativeTypes.ts");
const {
  NativePdfImageRegistry,
  packNativeImageCodecRequest,
  unpackImageSamples,
  unpackNativeImageCodecRequest
} = await import("../src/pdf/nativeImage.ts");
const { createEmptyHeprPageData, HEPR_IMAGE_FORMAT } = await import("../src/heprDocumentData.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function name(value) {
  return { kind: "name", value };
}

function image(entries, bytes) {
  return tinyPdfStream(`/Type /XObject /Subtype /Image ${entries}`, bytes);
}

function buildFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
      {
        number: 10,
        body: image(
          "/Width 2 /Height 1 /ImageMask true /Decode [1 0] /Interpolate true " +
          "/Alternates 997 0 R /OPI 998 0 R /Metadata 999 0 R",
          Uint8Array.of(0x80)
        )
      },
      { number: 11, body: image("/Width 1 /Height 1 /ImageMask true /ColorSpace /DeviceGray", Uint8Array.of(0)) },
      { number: 12, body: image("/Width 1 /Height 1 /ImageMask true /Mask [0 0]", Uint8Array.of(0)) },
      { number: 13, body: image("/Width 1 /Height 1 /ImageMask true /Decode [0 .5]", Uint8Array.of(0)) },
      {
        number: 14,
        body: image(
          "/Width 2 /Height 1 /ColorSpace [/Indexed /DeviceRGB 1 <FF000000FF00>] " +
          "/BitsPerComponent 16 /Mask [65535 65535]",
          Uint8Array.of(0, 0, 0xff, 0xff)
        )
      },
      {
        number: 15,
        body: image(
          "/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Mask [0]",
          Uint8Array.of(0, 0, 0)
        )
      },
      {
        number: 16,
        body: image(
          "/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 17 0 R /Mask 999 0 R",
          Uint8Array.of(1, 2, 3)
        )
      },
      {
        number: 17,
        body: image(
          "/Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 " +
          "/Alternates 999 0 R /OPI 998 0 R /Metadata 997 0 R",
          Uint8Array.of(0, 255)
        )
      },
      {
        number: 18,
        body: image(
          "/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 19 0 R",
          Uint8Array.of(1, 2, 3)
        )
      },
      {
        number: 19,
        body: image(
          "/Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Matte [0 0 0]",
          Uint8Array.of(0, 255)
        )
      },
      { number: 20, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 21 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 21, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray", Uint8Array.of(0)) },
      { number: 22, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 23 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 23, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(0, 0, 0)) },
      { number: 24, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 25 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 25, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask null", Uint8Array.of(0)) },
      { number: 26, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Mask 27 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 27, body: image("/Width 2 /Height 1 /ImageMask true", Uint8Array.of(0x40)) },
      { number: 28, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Mask 29 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 29, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(0)) },
      {
        number: 30,
        body: image(
          "/Width 1 /Height 1 /Filter /JPXDecode /BitsPerComponent /Ignored " +
          "/Decode 999 0 R /SMaskInData 2 /SMask 998 0 R /Mask true",
          Uint8Array.of(0xff, 0x4f, 0xff, 0xd9)
        )
      },
      { number: 31, body: image("/Width 1 /Height 1 /Filter /JPXDecode /SMaskInData 3", Uint8Array.of(0xff, 0x4f)) },
      { number: 32, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 4 /Filter /DCTDecode", Uint8Array.of(0xff, 0xd8)) },
      { number: 33, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JBIG2Decode", Uint8Array.of(0x97, 0x4a)) },
      { number: 34, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /CCITTFaxDecode", Uint8Array.of(0x80)) },
      {
        number: 35,
        body: image(
          "/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 " +
          "/Filter [/ASCIIHexDecode /DCTDecode] " +
          "/DecodeParms [null << /ColorTransform 1 /Nested << /Intent /RelativeColorimetric /Range [0 1] /Label <00FF> >> >>]",
          "FFD8FFD9>"
        )
      },
      {
        number: 36,
        body: image(
          "/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode " +
          "/DecodeParms << /Bad 37 0 R >>",
          Uint8Array.of(0xff, 0xd8)
        )
      },
      { number: 37, body: tinyPdfStream("", Uint8Array.of(1)) },
      { number: 38, body: image("/Width 0 /Height /Bad /ColorSpace 999 0 R /BitsPerComponent 3", Uint8Array.of()) },
      { number: 39, body: tinyPdfStream("/Type /Pattern /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(0)) },
      { number: 40, body: image("/Width 0 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(0)) },
      { number: 41, body: image("/Width 1 /Height 1.5 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(0)) },
      { number: 42, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 3", Uint8Array.of(0)) },
      { number: 43, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /F /DCTDecode", Uint8Array.of(1, 2, 3)) },
      { number: 44, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask true", Uint8Array.of(0)) },
      { number: 45, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /ImageMask false /Matte [0 0 0]", Uint8Array.of(128)) },
      { number: 46, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 45 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 47, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 48 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 48, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode /SMaskInData 1", Uint8Array.of(0xff, 0x4f)) },
      { number: 49, body: image("/Width 1 /Height 1 /ColorSpace /Alias /BitsPerComponent 8", Uint8Array.of(255, 0, 0)) },
      { number: 50, body: image("/Width 1000 /Height 1 /ImageMask true", new Uint8Array(125)) },
      { number: 51, body: image("/Width 5 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", new Uint8Array(5)) },
      { number: 52, body: image("/Width 3 /Height 3 /ColorSpace /DeviceGray /BitsPerComponent 8", new Uint8Array(9)) },
      { number: 53, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(0, 1)) },
      { number: 54, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of()) },
      { number: 55, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /SMaskInData 999 0 R", Uint8Array.of(0xff, 0xd8)) },
      { number: 56, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate 1", Uint8Array.of(0)) },
      { number: 60, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 61 0 R", Uint8Array.of(0)) },
      { number: 61, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 62 0 R", Uint8Array.of(0)) },
      { number: 62, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 63 0 R", Uint8Array.of(0)) },
      { number: 63, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 64 0 R", Uint8Array.of(0)) },
      { number: 64, body: image("/Width 1 /Height 1 /ImageMask true", Uint8Array.of(0)) },
      { number: 65, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 66 0 R", Uint8Array.of(0)) },
      { number: 66, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 65 0 R", Uint8Array.of(0)) },
      { number: 67, body: image("/Width 1 /Height 1 /Filter /JPXDecode /SMaskInData 0 /Mask [0 65535]", Uint8Array.of(0xff, 0x4f)) },
      { number: 72, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /RunLengthDecode", Uint8Array.of(0, 0, 128)) },
      { number: 73, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 2 /BitsPerComponent 4 /Columns 1 >>", Uint8Array.of(0)) },
      { number: 74, body: image("/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /RunLengthDecode", Uint8Array.of(0, 127, 128)) },
      { number: 75, body: image("/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 76 0 R", Uint8Array.of(1, 2, 3)) },
      { number: 76, body: image("/Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Matte []", Uint8Array.of(0, 255)) }
    ]
  });
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof PdfError && error.code === code,
    `expected PdfError(${code})`
  );
}

const fixture = buildFixture();
const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture });

try {
  const images = new NativePdfImageRegistry(document);

  // Exercise the byte-image shortcut against the general color evaluator,
  // including every byte value, component order, Decode, and raw-sample masks.
  for (const [device, count] of [["DeviceGray", 1], ["DeviceRGB", 3], ["DeviceCMYK", 4]]) {
    const width = 2053;
    const height = 3;
    const samples = Uint8Array.from({ length: width * height * count }, (_, offset) =>
      (Math.floor(offset / count) * (offset % count * 2 + 1) + offset % count * 37) & 255);
    const snapshot = samples.slice();
    for (const decode of [undefined, Array.from({ length: count }, (_, component) =>
      component % 2 ? [-0.5, 1.5] : [1, 0]).flat()]) {
      for (const mask of [[], Array.from({ length: count }, () => [16, 239]).flat()]) {
        const dictionary = new Map(Object.entries({
          Type: name("XObject"), Subtype: name("Image"), Width: width, Height: height,
          BitsPerComponent: 8, ColorSpace: name(device)
        }));
        if (decode) dictionary.set("Decode", decode);
        if (mask.length) dictionary.set("Mask", mask);
        const result = images.describe(await images.add({ kind: "stream", dictionary, bytes: samples }));
        const expected = new Uint8Array(width * height * 4);
        let transparentCount = 0;
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          const raw = samples.subarray(pixel * count, (pixel + 1) * count);
          const components = Array.from(raw, (value, component) => {
            const minimum = result.decode[component * 2];
            return minimum + value / 255 * (result.decode[component * 2 + 1] - minimum);
          });
          const rgb = images.colors.convertToSrgb(result.colorSpaceIndex, components);
          const transparent = mask.length > 0 && raw.every((value, component) =>
            value >= mask[component * 2] && value <= mask[component * 2 + 1]);
          if (transparent) transparentCount += 1;
          expected.set([...rgb.map(value => Math.round(value * 255)), transparent ? 0 : 255], pixel * 4);
        }
        assert.equal(result.format, HEPR_IMAGE_FORMAT.Rgba8);
        assert.deepEqual(result.data, expected, `${device} byte conversion, Decode=${decode}, Mask=${mask}`);
        assert.deepEqual(samples, snapshot, "color conversion preserves borrowed samples");
        if (mask.length) assert(transparentCount > 0 && transparentCount < width * height);
      }
    }
  }

  const grayStream = (decode) => ({
    kind: "stream",
    dictionary: new Map(Object.entries({
      Type: name("XObject"), Subtype: name("Image"), Width: 1, Height: 1,
      BitsPerComponent: 8, ColorSpace: name("DeviceGray"), Decode: decode
    })),
    bytes: Uint8Array.of(128)
  });
  const calibratedScope = new Map([["DefaultGray", [name("CalGray"), new Map([
    ["WhitePoint", [0.95047, 1, 1.08883]], ["Gamma", 2]
  ])]]]);
  const calibrated = images.describe(await images.add(grayStream([0, 1]), calibratedScope));
  assert.equal(images.colors.describe(calibrated.colorSpaceIndex).kind, "CalGray");
  assert.deepEqual([...calibrated.data], [
    ...images.colors.convertToSrgb(calibrated.colorSpaceIndex, [128 / 255]).map(value => Math.round(value * 255)),
    255
  ], "device image shortcuts must not bypass a scoped calibrated default");
  await rejectsCode(images.add(grayStream([-Number.MAX_VALUE, Number.MAX_VALUE])), "unsupported-image");

  const stencil = images.describe(await images.add(ref(10)));
  assert.equal(stencil.sourceBitsPerComponent, 1, "ImageMask BPC defaults to one");
  assert.equal(stencil.interpolate, true);
  assert.deepEqual(stencil.decode, [1, 0]);
  assert.deepEqual([...stencil.data], [255, 0]);

  for (const objectNumber of [11, 12, 13]) {
    await rejectsCode(images.add(ref(objectNumber)), "unsupported-image");
  }

  const indexed = images.describe(await images.add(ref(14)));
  assert.equal(indexed.format, HEPR_IMAGE_FORMAT.Rgba16);
  assert.equal(indexed.sourceBitsPerComponent, 16);
  assert.deepEqual(indexed.colorKeyMask, [65535, 65535]);
  const indexedView = new DataView(indexed.data.buffer, indexed.data.byteOffset, indexed.data.byteLength);
  assert.equal(indexedView.getUint16(6, false), 65535);
  assert.equal(indexedView.getUint16(14, false), 0, "the second indexed sample is color-key transparent");
  await rejectsCode(images.add(ref(15)), "unsupported-image");

  const soft = images.describe(await images.add(ref(16)));
  assert.equal(soft.maskKind, "soft", "SMask takes precedence over an unused malformed Mask");
  assert.deepEqual(images.describe(soft.softMaskImageIndex).data, Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255));
  await rejectsCode(images.add(ref(18)), "unsupported-image");
  await rejectsCode(images.add(ref(20)), "unsupported-image");
  await rejectsCode(images.add(ref(22)), "unsupported-image");
  await rejectsCode(images.add(ref(24)), "unsupported-image");

  const explicit = images.describe(await images.add(ref(26)));
  assert.equal(explicit.maskKind, "explicit");
  assert.equal(images.describe(explicit.softMaskImageIndex).width, 2, "explicit masks map through the unit square and may differ in size");
  await rejectsCode(images.add(ref(28)), "unsupported-image");

  const jpx = images.describe(await images.add(ref(30)));
  assert.equal(jpx.sourceBitsPerComponent, 0, "JPX precision is carried by the codestream");
  assert.deepEqual(jpx.decode, [], "a non-stencil JPX Decode entry is ignored without resolving it");
  assert.equal(jpx.maskKind, "none", "embedded JPX opacity overrides dictionary masks");
  assert.equal(unpackNativeImageCodecRequest(jpx.data).decodeParameters.SMaskInData, 2);
  await rejectsCode(images.add(ref(31)), "unsupported-image");
  for (const objectNumber of [32, 33, 34]) {
    await rejectsCode(images.add(ref(objectNumber)), "unsupported-image");
  }
  await rejectsCode(images.add(ref(72)), "unsupported-image");
  await rejectsCode(images.add(ref(73)), "unsupported-image");
  assert.deepEqual(
    [...images.describe(await images.add(ref(74))).data],
    [127, 127, 127, 255],
    "RunLengthDecode delivers eight-bit image samples"
  );

  const chained = unpackNativeImageCodecRequest(images.describe(await images.add(ref(35))).data);
  assert.deepEqual([...chained.encoded], [0xff, 0xd8, 0xff, 0xd9]);
  assert.deepEqual(chained.decodeParameters, {
    ColorTransform: 1,
    Nested: {
      Intent: "/RelativeColorimetric",
      Label: { $pdfStringHex: "00ff" },
      Range: [0, 1]
    }
  });
  await rejectsCode(images.add(ref(36)), "unsupported-image");

  const beforeUnused = images.size;
  assert.equal(images.buildStore().widths.length, beforeUnused, "unused malformed XObjects remain lazy");
  for (const objectNumber of [38, 39, 40, 41, 42, 43, 44, 47, 53, 54, 56, 75]) {
    await rejectsCode(images.add(ref(objectNumber)), "unsupported-image");
  }

  const matte = images.describe(await images.add(ref(46)));
  assert.equal(matte.maskKind, "soft");
  assert.deepEqual(matte.matte, [0, 0, 0]);
  const nonJpxSmaskInData = unpackNativeImageCodecRequest(images.describe(await images.add(ref(55))).data);
  assert.equal("SMaskInData" in nonJpxSmaskInData.decodeParameters, false);

  const unknownJpxPrecision = images.describe(await images.add(ref(67)));
  assert.equal(unknownJpxPrecision.maskKind, "color-key");
  assert.deepEqual(unknownJpxPrecision.colorKeyMask, [0, 65535]);
  assert.equal(unpackNativeImageCodecRequest(unknownJpxPrecision.data).decodeParameters.SMaskInData, 0);

  const aliasScopeA = new Map([["Alias", name("DeviceRGB")]]);
  const aliasScopeB = new Map([["Alias", name("DeviceRGB")]]);
  const [scopedA, deduplicatedA] = await Promise.all([
    images.add(ref(49), aliasScopeA),
    images.add(ref(49), aliasScopeA)
  ]);
  assert.equal(scopedA, deduplicatedA, "overlapping image resolution is deduplicated per resource scope");
  assert.notEqual(await images.add(ref(49), aliasScopeB), scopedA, "resource scopes are part of image identity");

  const cancelled = new AbortController();
  cancelled.abort("fixture cancellation");
  const sizeBeforeAbort = images.size;
  await rejectsCode(images.add(ref(50), undefined, cancelled.signal), "aborted");
  assert.equal(images.size, sizeBeforeAbort);
  assert.equal(images.describe(await images.add(ref(50))).width, 1000, "an aborted add does not poison its cache");
  await rejectsCode(images.add(ref(65)), "unsupported-image");

  const store = images.buildStore();
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
  page.stores.colors = images.colors.buildStore();
  page.stores.images = store;
  validateHeprPageData(page);
  assert.equal(store.dataOffsets.at(-1), store.data.length);

  assert.throws(
    () => unpackImageSamples(Uint8Array.of(0, 1), 1, 1, 1, 8),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );
  assert.throws(
    () => unpackImageSamples(Uint8Array.of(), 1, 1, 1, 8),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );
  assert.throws(
    () => unpackImageSamples(Uint8Array.of(0), Number.MAX_SAFE_INTEGER, 2, 1, 8),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );

  for (const precision of [8, 16]) {
    for (const components of [1, 3, 4]) {
      const width = 2053;
      const height = 3;
      const count = width * height * components;
      const expected = Uint16Array.from({ length: count }, (_, index) =>
        (index * 7919 + 255) & ((2 ** precision) - 1));
      const owned = new Uint8Array(count * precision / 8 + 6).fill(0xaa);
      const bytes = owned.subarray(3, owned.length - 3);
      if (precision === 8) bytes.set(expected);
      else {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let index = 0; index < count; index += 1) view.setUint16(index * 2, expected[index], false);
      }
      const snapshot = owned.slice();
      const actual = unpackImageSamples(bytes, width, height, components, precision);
      assert.deepEqual(actual, expected, `${precision}-bit samples across chunk/row boundaries`);
      assert.deepEqual(owned, snapshot, "sample expansion must preserve borrowed byte slices");
      actual[0] = 0;
      assert.deepEqual(owned, snapshot, "expanded samples must own their storage");
      assert.throws(
        () => unpackImageSamples(bytes.subarray(1), width, height, components, precision),
        (error) => error?.code === "unsupported-image"
      );
      const aborted = new AbortController();
      aborted.abort();
      assert.throws(
        () => unpackImageSamples(bytes, width, height, components, precision, aborted.signal),
        (error) => error?.code === "aborted"
      );
    }
  }

  const firstEnvelope = packNativeImageCodecRequest("jpeg", Uint8Array.of(1), Uint8Array.of(2), { Z: 3, A: [1, true] });
  const secondEnvelope = packNativeImageCodecRequest("jpeg", Uint8Array.of(1), Uint8Array.of(2), { A: [1, true], Z: 3 });
  assert.deepEqual(firstEnvelope, secondEnvelope, "codec envelopes canonicalize metadata key order");
  const reserved = firstEnvelope.slice();
  reserved[6] = 1;
  assert.throws(
    () => unpackNativeImageCodecRequest(reserved),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );
  const invalidRoot = firstEnvelope.slice();
  const metadataLength = new DataView(invalidRoot.buffer).getUint32(8, true);
  invalidRoot.set(new TextEncoder().encode("[]".padEnd(metadataLength, " ")), 16);
  assert.throws(
    () => unpackNativeImageCodecRequest(invalidRoot),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );
  assert.throws(
    () => packNativeImageCodecRequest("jpeg", Uint8Array.of(), Uint8Array.of(), { Bad: Number.NaN }),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );
} finally {
  await document.close();
}

for (const [limits, objectNumber] of [
  [{ maxDecodedStreamBytes: 512 }, 50],
  [{ maxImageDimension: 4 }, 51],
  [{ maxImagePixels: 8 }, 52],
  [{ maxRecursionDepth: 3 }, 60]
]) {
  const limited = await openNativePdfDocument({ kind: "bytes", bytes: fixture }, { limits });
  try {
    await rejectsCode(new NativePdfImageRegistry(limited).add(ref(objectNumber)), "resource-limit");
  } finally {
    await limited.close();
  }
}

console.log("native PDF image semantics tests passed");
hooks.deregister();
