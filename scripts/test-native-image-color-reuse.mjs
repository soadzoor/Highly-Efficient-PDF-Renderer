import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const { NativePdfColorRegistry } = await import("../src/pdf/nativeColor.ts");
const { NativePdfImageRegistry, unpackImageSamples } = await import("../src/pdf/nativeImage.ts");
const { createEmptyHeprPageData, HEPR_IMAGE_FORMAT, expandHeprImageToRgba8 } = await import("../src/heprDocumentData.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
const name = value => ({ kind: "name", value });
const dict = value => new Map(Object.entries(value));
const document = await openNativePdfDocument({ kind: "bytes", bytes: writeTinyPdf({ objects: [
  { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
  { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
  { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 40] >>" }
] }) });
const colors = new NativePdfColorRegistry(document, undefined, { iccTransformResolver(request) {
  const samples = new Uint8Array(request.sampleCount * 3);
  for (let pixel = 0; pixel < request.sampleCount; pixel++) for (let channel = 0; channel < 3; channel++) {
    samples[pixel * 3 + channel] = request.inputSamples[pixel * request.inputComponents + channel % request.inputComponents];
  }
  return { samples, sampleCount: request.sampleCount, outputComponents: 3, bitsPerComponent: 8 };
} });
const images = new NativePdfImageRegistry(document, colors);
const scalar = colors.convertToSrgb.bind(colors);
let calls = 0;
colors.convertToSrgb = (...args) => { calls++; return scalar(...args); };

function icc(count, range) {
  const bytes = new Uint8Array(128); new DataView(bytes.buffer).setUint32(0, 128, false); bytes[8] = 4;
  for (const [offset, value] of [[12, "mntr"], [16, count === 1 ? "GRAY" : count === 3 ? "RGB " : "CMYK"], [20, "XYZ "], [36, "acsp"]]) {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  }
  return [name("ICCBased"), { kind: "stream", dictionary: dict({ N: count, ...(range ? { Range: range } : {}) }), bytes }];
}
function image(width, height, bits, colorSpace, bytes, extra = {}) {
  return { kind: "stream", dictionary: dict({ Type: name("XObject"), Subtype: name("Image"),
    Width: width, Height: height, BitsPerComponent: bits, ColorSpace: colorSpace, ...extra }), bytes };
}
function packed(values, width, height, components, bits) {
  const stride = Math.ceil(width * components * bits / 8), bytes = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * components; x++) {
    const value = values[y * width * components + x], bit = x * bits, offset = y * stride + Math.floor(bit / 8);
    if (bits === 16) { bytes[offset] = value >> 8; bytes[offset + 1] = value & 255; }
    else bytes[offset] |= value << (8 - bits - (bit & 7));
  }
  return bytes;
}
function expanded(result) {
  return expandHeprImageToRgba8(result.data, result.format, result.width, result.height);
}

try {
  for (const bits of [1, 2, 4, 8]) {
    const maximum = 2 ** bits - 1, width = 511, height = 3;
    const values = Uint8Array.from({ length: width * height }, (_, i) => (i * 37 + Math.floor(i / 11)) & maximum);
    const source = packed(values, width, height, 1, bits), snapshot = source.slice();
    const spaces = [
      [name("Separation"), name("Black"), name("DeviceCMYK"), dict({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 })],
      [name("Indexed"), name("DeviceRGB"), maximum, { kind: "string", hex: true,
        bytes: Uint8Array.from({ length: (maximum + 1) * 3 }, (_, i) => (i * 73) & 255) }],
      [name("CalGray"), dict({ WhitePoint: [.95047, 1, 1.08883], Gamma: 2 })], icc(1)
    ];
    for (const space of spaces) {
      const decode = space[0].value === "Indexed" ? [maximum, 0] : [.93, .17], mask = [0, 0];
      calls = 0;
      const result = images.describe(await images.add(image(width, height, bits, space, source, { Decode: decode, Mask: mask })));
      assert.equal(calls, new Set(values).size, `${space[0].value}/${bits} resolves each used sample once`);
      const expected = Uint8Array.from([...values].flatMap(raw => [
        ...scalar(result.colorSpaceIndex, [decode[0] + raw / maximum * (decode[1] - decode[0])]).map(v => Math.round(v * 255)),
        raw === 0 ? 0 : 255
      ]));
      assert.deepEqual(expanded(result), expected, "lookup preserves scalar colors, Decode, row padding and raw color-key alpha");
      assert.deepEqual(source, snapshot);
    }
    const unpacked = unpackImageSamples(source, width, height, 1, bits);
    assert(unpacked instanceof Uint8Array, "packed low-bit samples need only byte storage");
    assert.deepEqual(unpacked, values);
  }

  // The function fails at zero, which never appears in this image.
  const lazy = [name("Separation"), name("Spot"), name("DeviceGray"), { kind: "stream",
    dictionary: dict({ FunctionType: 4, Domain: [0, 1], Range: [0, 1] }), bytes: new TextEncoder().encode("{ 1 exch div }") }];
  calls = 0;
  const lazyResult = images.describe(await images.add(image(257, 1, 8, lazy, new Uint8Array(257).fill(255))));
  assert.equal(calls, 1, "unused invalid function inputs remain unevaluated");
  assert.equal(lazyResult.format, HEPR_IMAGE_FORMAT.Gray1);

  for (const bits of [8, 16]) for (const components of [3, 4]) {
    const width = 513, height = 3, maximum = 2 ** bits - 1;
    const values = Uint16Array.from({ length: width * height * components }, (_, i) =>
      (Math.floor(i / components / 32) * 7919 + (i % components) * 37) & maximum);
    const source = packed(values, width, height, components, bits), snapshot = source.slice();
    const decode = Array.from({ length: components }, (_, i) => i % 2 ? [-.2, 1.2] : [1, 0]).flat();
    const mask = Array.from({ length: components }, () => [0, maximum >> 1]).flat();
    calls = 0;
    const result = images.describe(await images.add(image(width, height, bits, icc(components), source, { Decode: decode, Mask: mask })));
    assert.equal(calls, Math.ceil(width * height / 32), "adjacent repeated ICC vectors reuse exactly one previous conversion");
    const expected = new Uint8Array(width * height * (bits === 16 ? 8 : 4)), view = new DataView(expected.buffer);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const raw = Array.from(values.subarray(pixel * components, (pixel + 1) * components));
      const rgb = scalar(result.colorSpaceIndex, raw.map((v, c) => decode[c * 2] + v / maximum * (decode[c * 2 + 1] - decode[c * 2])));
      const alpha = raw.every((v, c) => v >= mask[c * 2] && v <= mask[c * 2 + 1]) ? 0 : maximum;
      [...rgb.map(v => Math.round(v * maximum)), alpha].forEach((v, c) => {
        if (bits === 16) view.setUint16(pixel * 8 + c * 2, v, false); else expected[pixel * 4 + c] = v;
      });
    }
    assert.deepEqual(result.data, expected, "ICC vector reuse preserves all source precision and mask arithmetic");
    assert.deepEqual(source, snapshot);
  }

  // More distinct colors than the conversion memo has slots: collisions and
  // repeats must reproduce the per-pixel scalar conversion exactly.
  for (const components of [3, 4]) {
    const width = 4099, height = 3;
    const values = Uint8Array.from({ length: width * height * components }, (_, i) =>
      (Math.imul((Math.floor(i / components) * 7) % 5000 + 1, 2654435761) >>> (8 * (i % components))) & 255);
    const decode = Array.from({ length: components }, (_, i) => i % 2 ? [-.2, 1.2] : [1, 0]).flat();
    const result = images.describe(await images.add(image(width, height, 8, icc(components), values, { Decode: decode })));
    const expected = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const raw = Array.from(values.subarray(pixel * components, (pixel + 1) * components));
      const rgb = scalar(result.colorSpaceIndex, raw.map((v, c) => decode[c * 2] + v / 255 * (decode[c * 2 + 1] - decode[c * 2])));
      expected.set([...rgb.map(v => Math.round(v * 255)), 255], pixel * 4);
    }
    assert.deepEqual(result.data, expected, `${components}-component ICC memo collisions keep scalar colors`);
  }

  for (const space of [name("DeviceRGB"), icc(3)]) for (const value of [0, 255]) {
    const width = 257, height = 3, source = new Uint8Array(width * height * 3).fill(value);
    const result = images.describe(await images.add(image(width, height, 8, space, source)));
    assert.equal(result.format, HEPR_IMAGE_FORMAT.Gray1);
    assert.equal(result.sourceBitsPerComponent, 8);
    assert.deepEqual(result.decode, [0, 1, 0, 1, 0, 1]);
    assert.equal(result.data.length, Math.ceil(width / 8) * height);
    assert.deepEqual(expanded(result), Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : value));
    if (value === 255) assert.equal(result.data[Math.ceil(width / 8) - 1], 128, "white row padding remains zero");
    const transparent = images.describe(await images.add(image(width, height, 8, space, source, { Mask: [value, value, value, value, value, value] })));
    assert.equal(transparent.format, HEPR_IMAGE_FORMAT.Rgba8, "color-key transparency cannot become an opaque bitmap");
    assert.equal(transparent.data[3], 0);
  }

  const withMask = images.describe(await images.add(image(257, 3, 8, name("DeviceRGB"), new Uint8Array(257 * 3 * 3), {
    SMask: image(1, 1, 8, name("DeviceGray"), Uint8Array.of(128))
  })));
  assert.equal(withMask.format, HEPR_IMAGE_FORMAT.Gray1);
  assert(withMask.softMaskImageIndex >= 0, "compaction preserves independent soft-mask resources");
  const embeddedImages = new NativePdfImageRegistry(document, colors, { codecResolver: request => ({
    samples: Uint8Array.from({ length: request.width * request.height * 4 }, (_, i) => i % 4 === 3 ? 128 : 0),
    width: request.width, height: request.height, components: 4, bitsPerComponent: 8
  }) });
  const embedded = embeddedImages.describe(await embeddedImages.add(image(257, 3, 8, name("DeviceRGB"), Uint8Array.of(0), {
    Filter: name("JPXDecode"), SMaskInData: 1
  })));
  assert.equal(embedded.format, HEPR_IMAGE_FORMAT.Rgba8, "embedded opacity retains an RGBA channel");
  assert(embedded.data.every((value, i) => value === (i % 4 === 3 ? 128 : 0)));

  const convert = colors.convertToSrgb;
  for (const components of [1, 3]) {
    const cancelled = new AbortController();
    colors.convertToSrgb = (...args) => { const rgb = scalar(...args); cancelled.abort(); return rgb; };
    await assert.rejects(images.add(image(8193, 1, 8, icc(components), new Uint8Array(8193 * components)), undefined, cancelled.signal),
      error => error.code === "aborted", "palette and repeated-vector cache hits must not bypass cancellation");
  }
  colors.convertToSrgb = convert;
  const page = createEmptyHeprPageData({ sourcePageIndex: 0, mediaBox: [0, 0, 80, 40], cropBox: [0, 0, 80, 40],
    bleedBox: null, trimBox: null, artBox: null, rotation: 0, userUnit: 1, width: 80, height: 40 });
  page.stores.images = images.buildStore(); page.stores.colors = colors.buildStore(); page.stores.functions = colors.functions.buildStore();
  validateHeprPageData(page);

  const { openPdf } = await import("../src/pdfSession.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 40] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "60 0 0 20 10 10 cm /Im Do") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 257 /Height 3 /BitsPerComponent 8 /ColorSpace /DeviceRGB", new Uint8Array(257 * 3 * 3)) }
  ] }) });
  try {
    const scene = await session.compileVectorPage(0, { vectorFallback: "error" });
    assert.equal(scene.rasterLayers[0].monochrome.data.length, 99);
    const archive = await buildHep(scene, { compression: "store", encodeRasterImages: false });
    const restored = await loadSceneFromHep(await archive.arrayBuffer());
    assert.deepEqual(restored.rasterLayers[0].data, scene.rasterLayers[0].data, "compacted RGB-source pixels survive HEP persistence exactly");
    assert.deepEqual(restored.rasterLayers[0].matrix, scene.rasterLayers[0].matrix);
  } finally { await session.close(); }
  console.log("Native image color reuse: low-bit palettes, scalar ICC equivalence, exact uniform packing, cancellation and HEP passed");
} finally { await document.close(); hooks.deregister(); }
