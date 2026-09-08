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

const { PdfError, openNativePdfDocument } = await import("../src/pdf/nativePdf.ts");
const { NativePdfFunctionRegistry } = await import("../src/pdf/nativeFunctions.ts");
const { NativePdfColorRegistry } = await import("../src/pdf/nativeColor.ts");
const {
  NativePdfImageRegistry,
  unpackImageSamples,
  unpackNativeImageCodecRequest
} = await import("../src/pdf/nativeImage.ts");
const {
  createEmptyHeprPageData,
  HEPR_IMAGE_FORMAT
} = await import("../src/heprDocumentData.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");

const encoder = new TextEncoder();

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

async function resourceFixture() {
  const profile = new Uint8Array(128);
  const profileView = new DataView(profile.buffer);
  profileView.setUint32(0, profile.length, false);
  profile[8] = 4;
  writeAscii(profile, 12, "mntr");
  writeAscii(profile, 16, "RGB ");
  writeAscii(profile, 20, "XYZ ");
  writeAscii(profile, 36, "acsp");
  const flatePixels = new Uint8Array(await new Response(
    new Blob([Uint8Array.of(0, 255)]).stream().pipeThrough(new CompressionStream("deflate"))
  ).arrayBuffer());
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
      {
        number: 4,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1 0 1 0 1] /C0 [1 1 1] /C1 [0 0 1] /N 1 >>"
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/FunctionType 0 /Domain [0 1] /Range [0 1] /Size [2] /BitsPerSample 8",
          Uint8Array.of(0, 255)
        )
      },
      {
        number: 6,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [1] /C1 [0] /N 1 >>"
      },
      {
        number: 7,
        body: "<< /FunctionType 3 /Domain [0 1] /Range [0 1] /Functions [5 0 R 6 0 R] /Bounds [0.5] /Encode [0 1 0 1] >>"
      },
      {
        number: 8,
        body: tinyPdfStream(
          "/FunctionType 4 /Domain [0 1] /Range [0 1]",
          "{ dup 0.5 gt { dup mul } { 2 mul } ifelse }"
        )
      },
      { number: 9, body: "[/Indexed /DeviceRGB 1 <FF000000FF00>]" },
      { number: 10, body: "[/Separation /Spot /DeviceRGB 4 0 R]" },
      {
        number: 11,
        body: tinyPdfStream("/N 3 /Alternate /DeviceRGB", profile)
      },
      {
        number: 12,
        body: "[/CalGray << /WhitePoint [0.95047 1 1.08883] /Gamma 2 >>]"
      },
      {
        number: 13,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 2 /Mask [3 3 0 0 0 0]",
          Uint8Array.of(0xc0, 0xc0, 0x0f, 0xf0)
        )
      },
      {
        number: 14,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ImageMask true /BitsPerComponent 1",
          Uint8Array.of(0x40)
        )
      },
      {
        number: 15,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 16 0 R",
          Uint8Array.of(64, 128, 255)
        )
      },
      {
        number: 16,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Matte [1 1 1]",
          Uint8Array.of(128)
        )
      },
      {
        number: 17,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /DecodeParms << /ColorTransform 1 >>",
          Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
        )
      },
      {
        number: 18,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 70000 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8",
          Uint8Array.of(0)
        )
      },
      {
        number: 19,
        body: tinyPdfStream(
          "/FunctionType 4 /Domain [0 1] /Range [0 1]",
          "{ 1 unsupportedOperator }"
        )
      },
      {
        number: 20,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
          flatePixels
        )
      },
      {
        number: 21,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /LZWDecode",
          packNineBitCodes([256, 0, 255, 257])
        )
      },
      {
        number: 22,
        body: "[/CalRGB << /WhitePoint [0.95047 1 1.08883] /Gamma [1 1 1] /Matrix [0.4124564 0.2126729 0.0193339 0.3575761 0.7151522 0.119192 0.1804375 0.072175 0.9503041] >>]"
      },
      {
        number: 23,
        body: "[/Lab << /WhitePoint [0.95047 1 1.08883] /Range [-128 127 -128 127] >>]"
      },
      {
        number: 24,
        body: tinyPdfStream(
          "/FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1]",
          "{ pop dup dup }"
        )
      },
      {
        number: 25,
        body: "[/DeviceN [/InkA /InkB] /DeviceRGB 24 0 R]"
      },
      {
        number: 26,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Decode [1 0]",
          Uint8Array.of(0, 255)
        )
      },
      {
        number: 27,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Mask 14 0 R",
          Uint8Array.of(255, 0, 0, 0, 255, 0)
        )
      },
      {
        number: 28,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 29 0 R",
          Uint8Array.of(0)
        )
      },
      {
        number: 29,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 28 0 R",
          Uint8Array.of(0)
        )
      },
      {
        number: 30,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /JPXDecode",
          Uint8Array.of(0xff, 0x4f, 0xff, 0xd9)
        )
      },
      {
        number: 31,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /JBIG2Decode /DecodeParms << /JBIG2Globals 33 0 R >>",
          Uint8Array.of(0x97, 0x4a, 0x42, 0x32)
        )
      },
      {
        number: 32,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 1 /Rows 1 /EndOfBlock false /BlackIs1 true >>",
          Uint8Array.of(0x80)
        )
      },
      {
        number: 33,
        body: tinyPdfStream("", Uint8Array.of(1, 2, 3))
      },
      {
        number: 34,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8",
          Uint8Array.of(0, 0, 0)
        )
      },
      {
        number: 35,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 34 0 R",
          Uint8Array.of(0, 0, 0)
        )
      },
      {
        number: 36,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8",
          Uint8Array.of(0)
        )
      },
      {
        number: 37,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Mask 36 0 R",
          Uint8Array.of(0, 0, 0)
        )
      },
      {
        number: 38,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Matte [1 1]",
          Uint8Array.of(0)
        )
      },
      {
        number: 39,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 38 0 R",
          Uint8Array.of(0, 0, 0)
        )
      }
    ]
  });
}

function writeAscii(bytes, offset, value) {
  bytes.set(encoder.encode(value), offset);
}

function packNineBitCodes(codes) {
  const output = new Uint8Array(Math.ceil(codes.length * 9 / 8));
  let bitOffset = 0;
  for (const code of codes) {
    for (let bit = 8; bit >= 0; bit -= 1) {
      if (code & (1 << bit)) output[bitOffset >>> 3] |= 1 << (7 - (bitOffset & 7));
      bitOffset += 1;
    }
  }
  return output;
}

function closeTo(actual, expected, tolerance = 1e-6) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

const document = await openNativePdfDocument({ kind: "bytes", bytes: await resourceFixture() });

async function testFunctions() {
  const functions = new NativePdfFunctionRegistry(document);
  const sampled = await functions.add(ref(5));
  closeTo(functions.evaluate(sampled, [0.25])[0], 0.25, 1 / 255);
  const stitching = await functions.add(ref(7));
  closeTo(functions.evaluate(stitching, [0.25])[0], 0.5, 1 / 255);
  closeTo(functions.evaluate(stitching, [0.75])[0], 0.5, 1 / 255);
  const calculator = await functions.add(ref(8));
  closeTo(functions.evaluate(calculator, [0.25])[0], 0.5);
  closeTo(functions.evaluate(calculator, [0.75])[0], 0.5625);
  assert.equal(await functions.add(ref(8)), calculator, "function references must deduplicate");
  const store = functions.buildStore();
  assert.equal(store.kinds.length, 4, "stitching reuses an already-registered child function");
  assert.equal(store.domainOffsets.length, store.kinds.length + 1);
  assert.equal(store.domains.length, store.kinds.length * 2, "each one-input domain is stored once");
  assert(store.calculatorBytecode.length > 0);
  await assert.rejects(
    functions.add(ref(19)),
    (error) => error instanceof PdfError && error.code === "unsupported-content"
  );
  return functions;
}

async function testColors(functions) {
  const colors = new NativePdfColorRegistry(document, functions);
  const indexed = await colors.add(ref(9));
  assert.deepEqual(colors.convertToSrgb(indexed, [0]), [1, 0, 0]);
  assert.deepEqual(colors.convertToSrgb(indexed, [1]), [0, 1, 0]);
  assert.deepEqual(colors.defaultDecode(indexed), [0, 1]);
  const separation = await colors.add(ref(10));
  assert.deepEqual(colors.convertToSrgb(separation, [0]), [1, 1, 1]);
  assert.deepEqual(colors.convertToSrgb(separation, [1]), [0, 0, 1]);
  const calGray = await colors.add(ref(12));
  const calibrated = colors.convertToSrgb(calGray, [0.5]);
  closeTo(calibrated[0], 0.5371, 0.002);
  closeTo(calibrated[1], 0.5371, 0.002);
  closeTo(calibrated[2], 0.5371, 0.002);
  const deviceCmyk = await colors.add({ kind: "name", value: "DeviceCMYK" });
  const deviceCmykRed = colors.convertToSrgb(deviceCmyk, [0, 1, 1, 0]);
  closeTo(deviceCmykRed[0], 1);
  closeTo(deviceCmykRed[1], 0.17998620773545304);
  closeTo(deviceCmykRed[2], 0.0891440862243233);
  const calRgb = await colors.add(ref(22));
  const calibratedRed = colors.convertToSrgb(calRgb, [1, 0, 0]);
  closeTo(calibratedRed[0], 1, 0.0001);
  closeTo(calibratedRed[1], 0, 0.0001);
  closeTo(calibratedRed[2], 0, 0.0001);
  const lab = await colors.add(ref(23));
  const labWhite = colors.convertToSrgb(lab, [100, 0, 0]);
  labWhite.forEach((component) => closeTo(component, 1, 0.0001));
  const deviceN = await colors.add(ref(25));
  const deviceNColor = colors.convertToSrgb(deviceN, [0.25, 0.9]);
  deviceNColor.forEach((component) => closeTo(component, 0.25));
  const icc = await colors.add([{ kind: "name", value: "ICCBased" }, ref(11)]);
  assert.equal(colors.describe(icc).iccMetadata.dataColorSpace, "RGB ");
  // With no ICC resolver configured, 8.6.5.5 hands the conversion to the
  // alternate space rather than failing the page.
  assert.deepEqual(colors.convertToSrgb(icc, [0.25, 0.5, 0.75]), [0.25, 0.5, 0.75]);
  const kernelColors = new NativePdfColorRegistry(document, undefined, {
    iccKernel: {
      convertToSrgb(_profile, components) {
        return [components[0], components[1], components[2]];
      }
    }
  });
  const kernelIcc = await kernelColors.add([{ kind: "name", value: "ICCBased" }, ref(11)]);
  assert.deepEqual(kernelColors.convertToSrgb(kernelIcc, [0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
  const colorStore = colors.buildStore();
  assert.equal(colorStore.spaceKinds.length, colors.size);
  assert.equal(colorStore.profileOffsets.at(-1), 128);

  const scopedColors = new NativePdfColorRegistry(document);
  const sharedIndexed = [
    { kind: "name", value: "Indexed" },
    { kind: "name", value: "DeviceRGB" },
    0,
    { kind: "string", bytes: Uint8Array.of(255, 0, 0), hex: true }
  ];
  const calibratedScope = new Map([
    ["DefaultRGB", [
      { kind: "name", value: "CalRGB" },
      new Map([
        ["WhitePoint", [0.95047, 1, 1.08883]],
        ["Gamma", [1, 1, 1]],
        ["Matrix", [
          0.4124564, 0.2126729, 0.0193339,
          0.3575761, 0.7151522, 0.119192,
          0.1804375, 0.072175, 0.9503041
        ]]
      ])
    ]]
  ]);
  const deviceScope = new Map();
  const calibratedIndexed = await scopedColors.add(sharedIndexed, calibratedScope);
  const deviceIndexed = await scopedColors.add(sharedIndexed, deviceScope);
  assert.notEqual(
    calibratedIndexed,
    deviceIndexed,
    "direct color spaces shared across resource scopes must not alias"
  );
  assert.notEqual(
    scopedColors.describe(calibratedIndexed).alternateSpaceIndex,
    scopedColors.describe(deviceIndexed).alternateSpaceIndex,
    "DefaultRGB must be resolved in the caller's resource scope"
  );
  const calibratedIndirect = await scopedColors.add(ref(9), calibratedScope);
  const deviceIndirect = await scopedColors.add(ref(9), deviceScope);
  assert.notEqual(
    calibratedIndirect,
    deviceIndirect,
    "indirect color spaces shared across resource scopes must not alias"
  );
  return colors;
}

async function testImages(colors, functions) {
  assert.deepEqual(
    [...unpackImageSamples(Uint8Array.of(0xc0, 0xc0, 0x0f, 0xf0), 2, 2, 3, 2)],
    [3, 0, 0, 0, 3, 0, 0, 0, 3, 3, 3, 3]
  );
  assert.deepEqual([...unpackImageSamples(Uint8Array.of(0x50), 4, 1, 1, 1)], [0, 1, 0, 1]);
  assert.deepEqual([...unpackImageSamples(Uint8Array.of(0x1b), 4, 1, 1, 2)], [0, 1, 2, 3]);
  assert.deepEqual([...unpackImageSamples(Uint8Array.of(0x1f), 2, 1, 1, 4)], [1, 15]);
  assert.deepEqual([...unpackImageSamples(Uint8Array.of(1, 255), 2, 1, 1, 8)], [1, 255]);
  assert.deepEqual([...unpackImageSamples(Uint8Array.of(0x12, 0x34), 1, 1, 1, 16)], [0x1234]);
  const requests = [];
  const images = new NativePdfImageRegistry(document, colors, {
    onCodecRequest(request) { requests.push(request); }
  });
  const raw = await images.add(ref(13));
  assert.equal(await images.add(ref(13)), raw, "image references must deduplicate");
  const rawImage = images.describe(raw);
  assert.equal(rawImage.format, HEPR_IMAGE_FORMAT.Rgba8);
  assert.deepEqual([...rawImage.data], [
    255, 0, 0, 0,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255
  ]);
  const stencil = await images.add(ref(14));
  assert.deepEqual([...images.describe(stencil).data], [255, 0]);
  const softMasked = await images.add(ref(15));
  assert.equal(images.describe(softMasked).maskKind, "soft");
  assert(images.describe(softMasked).softMaskImageIndex >= 0);
  assert.deepEqual(images.describe(softMasked).matte, [1, 1, 1]);
  const jpeg = await images.add(ref(17));
  assert.equal(images.describe(jpeg).format, HEPR_IMAGE_FORMAT.Jpeg);
  assert.equal(requests.length, 1);
  const unpacked = unpackNativeImageCodecRequest(images.describe(jpeg).data);
  assert.equal(unpacked.codec, "jpeg");
  assert.deepEqual([...unpacked.encoded], [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(unpacked.decodeParameters.ColorTransform, 1);
  const flate = images.describe(await images.add(ref(20)));
  const lzw = images.describe(await images.add(ref(21)));
  const grayscalePixels = [0, 0, 0, 255, 255, 255, 255, 255];
  assert.deepEqual([...flate.data], grayscalePixels);
  assert.deepEqual([...lzw.data], grayscalePixels);
  const decoded = images.describe(await images.add(ref(26)));
  assert.deepEqual(decoded.decode, [1, 0]);
  assert.deepEqual([...decoded.data], [255, 255, 255, 255, 0, 0, 0, 255]);
  const explicitMask = images.describe(await images.add(ref(27)));
  assert.equal(explicitMask.maskKind, "explicit");
  assert.equal(explicitMask.softMaskImageIndex, stencil);
  await assert.rejects(
    images.add(ref(28)),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );
  for (const invalidMaskObject of [35, 37, 39]) {
    await assert.rejects(
      images.add(ref(invalidMaskObject)),
      (error) => error instanceof PdfError && error.code === "unsupported-image"
    );
  }
  const jpx = images.describe(await images.add(ref(30)));
  const jbig2 = unpackNativeImageCodecRequest(images.describe(await images.add(ref(31))).data);
  const ccitt = images.describe(await images.add(ref(32)));
  assert.equal(unpackNativeImageCodecRequest(jpx.data).codec, "jpeg2000");
  assert.equal(jbig2.codec, "jbig2");
  assert.deepEqual([...jbig2.globals], [1, 2, 3]);
  assert.equal(ccitt.format, HEPR_IMAGE_FORMAT.Rgba8);
  assert.equal(ccitt.codecRequest, null, "supported CCITT is decoded without an external codec request");
  assert.deepEqual([...ccitt.data], [255, 255, 255, 255]);
  assert.equal(requests.length, 3, "only external image codecs are surfaced");
  await assert.rejects(
    images.add(ref(18)),
    (error) => error instanceof PdfError && error.code === "resource-limit"
  );

  const strictCodecs = new NativePdfImageRegistry(document, colors, { codecPolicy: "error" });
  assert.deepEqual(
    [...strictCodecs.describe(await strictCodecs.add(ref(32))).data],
    [255, 255, 255, 255],
    "the strict external-codec policy still accepts native CCITT"
  );
  await assert.rejects(
    strictCodecs.add(ref(17)),
    (error) => error instanceof PdfError && error.code === "unsupported-image"
  );

  const scopedImages = new NativePdfImageRegistry(document);
  const sharedImage = {
    kind: "stream",
    dictionary: new Map([
      ["Type", { kind: "name", value: "XObject" }],
      ["Subtype", { kind: "name", value: "Image" }],
      ["Width", 1],
      ["Height", 1],
      ["ColorSpace", { kind: "name", value: "DeviceRGB" }],
      ["BitsPerComponent", 8]
    ]),
    bytes: Uint8Array.of(255, 0, 0)
  };
  const calibratedScope = new Map([
    ["DefaultRGB", [
      { kind: "name", value: "CalRGB" },
      new Map([
        ["WhitePoint", [0.95047, 1, 1.08883]],
        ["Gamma", [1, 1, 1]],
        ["Matrix", [
          0.4124564, 0.2126729, 0.0193339,
          0.3575761, 0.7151522, 0.119192,
          0.1804375, 0.072175, 0.9503041
        ]]
      ])
    ]]
  ]);
  const calibratedImage = await scopedImages.add(sharedImage, calibratedScope);
  const deviceImage = await scopedImages.add(sharedImage, new Map());
  assert.notEqual(
    calibratedImage,
    deviceImage,
    "an image shared across resource scopes must resolve its color space per scope"
  );
  assert.notEqual(
    scopedImages.describe(calibratedImage).colorSpaceIndex,
    scopedImages.describe(deviceImage).colorSpaceIndex
  );
  const calibratedIndirectImage = await scopedImages.add(ref(13), calibratedScope);
  const deviceIndirectImage = await scopedImages.add(ref(13), new Map());
  assert.notEqual(
    calibratedIndirectImage,
    deviceIndirectImage,
    "an indirect image shared across resource scopes must not alias"
  );
  assert.notEqual(
    scopedImages.describe(calibratedIndirectImage).colorSpaceIndex,
    scopedImages.describe(deviceIndirectImage).colorSpaceIndex
  );

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
  page.stores.functions = functions.buildStore();
  page.stores.colors = colors.buildStore();
  page.stores.images = images.buildStore();
  validateHeprPageData(page);
}

const functions = await testFunctions();
const colors = await testColors(functions);
await testImages(colors, functions);
await document.close();
console.log("native PDF function/color/image tests passed");
hooks.deregister();
