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
let PdfErrorClass;

try {
  const [{ openNativePdfDocument }, { PdfError }, imageApi, dataApi, validationApi] = await Promise.all([
    import("../src/pdf/nativeDocument.ts"),
    import("../src/pdf/nativeTypes.ts"),
    import("../src/pdf/nativeImage.ts"),
    import("../src/heprDocumentData.ts"),
    import("../src/heprDocumentDataValidation.ts")
  ]);
  const {
    NativePdfImageRegistry,
    unpackNativeImageCodecRequest
  } = imageApi;
  const { createEmptyHeprPageData, HEPR_IMAGE_FORMAT } = dataApi;
  const { validateHeprPageData } = validationApi;
  PdfErrorClass = PdfError;

  const fixture = ccittImageFixture();
  const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture });
  try {
    const codecRequests = [];
    const images = new NativePdfImageRegistry(document, undefined, {
      onCodecRequest(request) { codecRequests.push(request); }
    });

    const g3Index = await images.add(ref(10));
    assert.equal(await images.add(ref(10)), g3Index, "indirect CCITT aliases deduplicate");
    const g3 = images.describe(g3Index);
    assert.equal(g3.format, HEPR_IMAGE_FORMAT.Rgba8);
    assert.equal(g3.codecRequest, null);
    assert.deepEqual([...g3.data], rgbaBits([1, 1, 0, 0, 0, 0, 1, 1]));

    const blackIsOne = images.describe(await images.add(ref(11)));
    assert.deepEqual(
      [...blackIsOne.data],
      [...g3.data],
      "/BlackIs1 changes fax polarity without changing visible DeviceGray colours"
    );
    const inverted = images.describe(await images.add(ref(12)));
    assert.deepEqual([...inverted.data], rgbaBits([0, 0, 1, 1, 1, 1, 0, 0]));
    const blackIsOneInverted = images.describe(await images.add(ref(39)));
    assert.deepEqual(
      [...blackIsOneInverted.data],
      [...inverted.data],
      "/BlackIs1 is normalized before the independent image /Decode mapping"
    );

    const stencilIndex = await images.add(ref(13));
    const stencil = images.describe(stencilIndex);
    assert.equal(stencil.format, HEPR_IMAGE_FORMAT.Gray8);
    assert.equal(stencil.imageMask, true);
    assert.deepEqual([...stencil.data], [0, 0, 255, 255, 255, 255, 0, 0]);

    const mixed = images.describe(await images.add(ref(14)));
    assert.equal(mixed.height, 2);
    assert.deepEqual(
      [...mixed.data],
      [...rgbaBits([1, 1, 0, 0, 0, 0, 1, 1]), ...rgbaBits([1, 1, 0, 0, 0, 0, 1, 1])]
    );
    const group4 = images.describe(await images.add(ref(15)));
    assert.deepEqual([...group4.data], rgbaBits(Array(16).fill(0)));

    const chained = images.describe(await images.add(ref(16)));
    assert.deepEqual([...chained.data], [...g3.data], "simple filters preceding CCITT decode first");
    const alias = images.describe(await images.add(ref(30)));
    assert.deepEqual([...alias.data], [...g3.data], "/CCF is the exact CCITTFaxDecode alias");
    const indirectParameters = images.describe(await images.add(ref(31)));
    assert.deepEqual([...indirectParameters.data], [...g3.data]);

    const explicit = images.describe(await images.add(ref(27)));
    assert.equal(explicit.maskKind, "explicit");
    assert.equal(explicit.softMaskImageIndex, stencilIndex);
    const soft = images.describe(await images.add(ref(28)));
    assert.equal(soft.maskKind, "soft");
    assert.deepEqual(soft.matte, [1]);
    assert.deepEqual([...images.describe(soft.softMaskImageIndex).data], [...g3.data]);

    const colorKey = images.describe(await images.add(ref(26)));
    assert.deepEqual(
      alphaBytes(colorKey.data),
      [255, 255, 0, 0, 0, 0, 255, 255],
      "color-key masking observes normalized CCITT samples"
    );

    const defaultRows = images.describe(await images.add(ref(33)));
    assert.deepEqual([...defaultRows.data], rgbaBits(Array(8).fill(1)));
    const byteAligned = images.describe(await images.add(ref(37)));
    assert.deepEqual([...byteAligned.data], rgbaBits([1, 1]));
    const damaged = images.describe(await images.add(ref(38)));
    assert.deepEqual(
      [...damaged.data],
      [...rgbaBits(Array(8).fill(1)), ...rgbaBits(Array(8).fill(0))],
      "/DamagedRowsBeforeError performs only its explicitly bounded EOL recovery"
    );

    await rejectsCode(images.add(ref(21)), "invalid-object");
    await rejectsCode(images.add(ref(23)), "unsupported-image");
    await rejectsCode(images.add(ref(24)), "unsupported-image");
    await rejectsCode(images.add(ref(29)), "unsupported-image");

    const extension = images.describe(await images.add(ref(22)));
    assert.equal(extension.format, HEPR_IMAGE_FORMAT.Ccitt);
    assert.equal(extension.codecRequest?.codec, "ccitt");
    assert.equal(unpackNativeImageCodecRequest(extension.data).codec, "ccitt");
    const unknownParameter = images.describe(await images.add(ref(34)));
    assert.equal(unknownParameter.codecRequest?.codec, "ccitt");
    assert.equal(codecRequests.length, 2, "only explicitly unsupported fax capabilities use envelopes");

    const strict = new NativePdfImageRegistry(document, undefined, { codecPolicy: "error" });
    assert.deepEqual([...strict.describe(await strict.add(ref(10))).data], [...g3.data]);
    await rejectsCode(strict.add(ref(22)), "unsupported-filter");
    await rejectsCode(strict.add(ref(34)), "unsupported-filter");

    const beforeUnused = images.size;
    // Object 35 is deliberately malformed but is never requested. Building a
    // store must not resolve or decode unused XObjects.
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
    page.stores.images = images.buildStore();
    assert.equal(page.stores.images.widths.length, beforeUnused);
    assert.ok(
      [...page.stores.images.formats].every((format) =>
        format === HEPR_IMAGE_FORMAT.Rgba8 ||
        format === HEPR_IMAGE_FORMAT.Gray8 ||
        format === HEPR_IMAGE_FORMAT.Ccitt
      )
    );
    for (let index = 0; index < page.stores.images.formats.length; index += 1) {
      if (page.stores.images.formats[index] === HEPR_IMAGE_FORMAT.Ccitt) continue;
      const start = page.stores.images.dataOffsets[index];
      const end = page.stores.images.dataOffsets[index + 1];
      assert.notDeepEqual(
        [...page.stores.images.data.slice(start, Math.min(end, start + 4))],
        [0x48, 0x49, 0x43, 0x31],
        "supported CCITT stores lossless pixels, not the HIC1 source envelope"
      );
    }
    validateHeprPageData(page);
  } finally {
    await document.close();
  }

  const cancelledDocument = await openNativePdfDocument({ kind: "bytes", bytes: fixture });
  try {
    const controller = new AbortController();
    controller.abort();
    await rejectsCode(
      new NativePdfImageRegistry(cancelledDocument).add(ref(10), undefined, controller.signal),
      "aborted"
    );
  } finally {
    await cancelledDocument.close();
  }

  for (const [limits, objectNumber] of [
    [{ maxDecodedStreamBytes: 512 }, 36],
    [{ maxImagePixels: 7 }, 10],
    [{ maxImageDimension: 7 }, 10]
  ]) {
    const limited = await openNativePdfDocument({ kind: "bytes", bytes: fixture }, { limits });
    try {
      await rejectsCode(new NativePdfImageRegistry(limited).add(ref(objectNumber)), "resource-limit");
    } finally {
      await limited.close();
    }
  }

  console.log("native CCITT image-registry tests passed");
} finally {
  hooks.deregister();
}

function ccittImageFixture() {
  const pattern = packBits("0111 011 0111"); // white(2), black(4), white(2)
  const eol = "000000000001";
  const rtc = `${eol}1`.repeat(6);
  const mixed = packBits(`${eol}1 0111 011 0111 ${eol}0 1 1 1 ${rtc}`);
  const eofb = `${eol}${eol}`;
  const group4Black = packBits(`001 00110101 000101 1 1 ${eofb}`);
  const group4White = packBits(`1 ${eofb}`);
  const extension = packBits("000000001 111");
  const defaultColumnsWhite = packBits("010011011 00110101"); // white makeup(1728) + term(0)
  const byteAligned = packBits(`1 0000000 1 0000000 ${eofb}`);
  const damaged = packBits(`${eol} 00000000 ${eol} 00110101 000101`);
  const hexPattern = `${[...pattern].map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
  const image = (entries, bytes) => tinyPdfStream(
    `/Type /XObject /Subtype /Image ${entries}`,
    bytes
  );
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
    { number: 10, body: image(g3Entries(), pattern) },
    {
      number: 11,
      body: image(
        g3Entries().replace("/EndOfBlock false", "/EndOfBlock false /BlackIs1 true"),
        pattern
      )
    },
    { number: 12, body: image(`${g3Entries()} /Decode [1 0]`, pattern) },
    { number: 13, body: image(maskEntries(), pattern) },
    {
      number: 14,
      body: image(
        "/Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K 2 /Columns 8 /EndOfLine true /EndOfBlock true >>",
        mixed
      )
    },
    {
      number: 15,
      body: image(
        "/Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K -1 /Columns 8 /EndOfBlock true >>",
        group4Black
      )
    },
    {
      number: 16,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 " +
        "/Filter [/ASCIIHexDecode /CCITTFaxDecode] " +
        "/DecodeParms [null << /K 0 /Columns 8 /Rows 1 /EndOfBlock false >>]",
        hexPattern
      )
    },
    { number: 17, body: image("/Width 8 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Mask 13 0 R", new Uint8Array(24).fill(64)) },
    {
      number: 20,
      body: image(
        `${g3Entries()} /Matte [1]`,
        pattern
      )
    },
    { number: 21, body: image(g3Entries(), Uint8Array.of(0)) },
    {
      number: 22,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K 0 /Columns 8 /Rows 1 /EndOfBlock false >>",
        extension
      )
    },
    {
      number: 23,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /Rows 1 /EndOfBlock false >>",
        defaultColumnsWhite
      )
    },
    {
      number: 24,
      body: image(
        "/Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false >>",
        pattern
      )
    },
    { number: 26, body: image(`${g3Entries()} /Mask [0 0]`, pattern) },
    { number: 27, body: image(`${g3Entries()} /Mask 13 0 R`, pattern) },
    { number: 28, body: image(`${g3Entries()} /SMask 20 0 R`, pattern) },
    {
      number: 29,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false >>",
        pattern
      )
    },
    {
      number: 30,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCF " +
        "/DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false >>",
        pattern
      )
    },
    {
      number: 31,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms 40 0 R",
        pattern
      )
    },
    {
      number: 33,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K -1 /Columns 8 >>",
        group4White
      )
    },
    {
      number: 34,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false /Uncompressed true >>",
        pattern
      )
    },
    { number: 35, body: image("/Height 1 /Filter /CCITTFaxDecode /DecodeParms << /K /Bad >>", Uint8Array.of()) },
    {
      number: 36,
      body: image(
        "/Width 129 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /Columns 129 /Rows 1 /EndOfBlock false >>",
        packBits("10010 000111") // white makeup(128) + terminating(1)
      )
    },
    {
      number: 37,
      body: image(
        "/Width 1 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K -1 /Columns 1 /EncodedByteAlign true /EndOfBlock true >>",
        byteAligned
      )
    },
    {
      number: 38,
      body: image(
        "/Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K 0 /Columns 8 /Rows 2 /EndOfLine true /EndOfBlock false /DamagedRowsBeforeError 1 >>",
        damaged
      )
    },
    {
      number: 39,
      body: image(
        `${g3Entries().replace("/EndOfBlock false", "/EndOfBlock false /BlackIs1 true")} /Decode [1 0]`,
        pattern
      )
    },
    { number: 40, body: "<< /K 0 /Columns 8 /Rows 1 /EndOfBlock false >>" }
  ] });
}

function g3Entries() {
  return "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
    "/DecodeParms << /K 0 /Columns 8 /Rows 1 /EndOfBlock false >>";
}

function maskEntries() {
  return "/Width 8 /Height 1 /ImageMask true /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
    "/DecodeParms << /K 0 /Columns 8 /Rows 1 /EndOfBlock false >>";
}

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function packBits(source) {
  const compact = source.replace(/\s+/g, "");
  assert.match(compact, /^[01]*$/);
  const output = new Uint8Array(Math.ceil(compact.length / 8));
  for (let index = 0; index < compact.length; index += 1) {
    if (compact.charCodeAt(index) === 49) output[index >>> 3] |= 1 << (7 - (index & 7));
  }
  return output;
}

function rgbaBits(values) {
  return values.flatMap((value) => value ? [255, 255, 255, 255] : [0, 0, 0, 255]);
}

function alphaBytes(rgba) {
  const output = [];
  for (let offset = 3; offset < rgba.length; offset += 4) output.push(rgba[offset]);
  return output;
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof PdfErrorClass && error.code === code,
    `expected PdfError(${code})`
  );
}
