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

try {
  const [sessionApi, validationApi, executorApi, dataApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentDataValidation.ts"),
    import("../src/heprDisplayExecutor.ts"),
    import("../src/heprDocumentData.ts")
  ]);
  const { openPdf } = sessionApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram } = executorApi;
  const { HEPR_IMAGE_FORMAT } = dataApi;

  const bytes = validSessionFixture();
  const session = await openPdf({ kind: "bytes", bytes, label: "ccitt-images.pdf" });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const imageCommands = flattenCommands(
      page,
      page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands
    )
      .filter((command) => command.kind === "draw" && command.source === "images");
    assert.equal(imageCommands.length, 8);
    assert.equal(imageCommands[0].first, imageCommands[1].first, "resource aliases share one decoded image");

    const referenced = new Set(imageCommands.map((command) => command.first));
    for (const imageIndex of referenced) {
      assert.ok(
        page.stores.images.formats[imageIndex] === HEPR_IMAGE_FORMAT.Rgba8 ||
        page.stores.images.formats[imageIndex] === HEPR_IMAGE_FORMAT.Gray8,
        "supported CCITT must be stored as lossless pixels"
      );
      assert.notDeepEqual(imagePrefix(page, imageIndex), [0x48, 0x49, 0x43, 0x31]);
    }
    assert.deepEqual(
      imageBytes(page, imageCommands[0].first),
      rgbaBits([1, 1, 0, 0, 0, 0, 1, 1])
    );
    assert.equal(page.stores.images.imageMask[imageCommands[4].first], 1);
    assert.ok(imageCommands[4].paintIndex >= 0, "a fax stencil retains its live fill paint");
    assert.equal(page.stores.images.imageMask[imageCommands[7].first], 1, "Group 4 stencil is native");
    assert.ok(page.stores.images.softMaskImageIndices[imageCommands[6].first] >= 0);

    const executed = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(execution) {
        if (execution.command.source === "images") executed.push(execution.command.first);
      }
    });
    assert.deepEqual(executed, imageCommands.map((command) => command.first));

  } finally {
    await session.close();
  }

  for (const [fixture, code] of [
    [singleImageFixture(malformedCcittImage()), "invalid-object"],
    [singleImageFixture(extensionCcittImage()), "unsupported-image"]
  ]) {
    const failing = await openPdf({ kind: "bytes", bytes: fixture });
    try {
      await assert.rejects(
        failing.compilePage(0, { optimization: "none" }),
        (error) => error?.code === code,
        `expected PdfError(${code})`
      );
    } finally {
      await failing.close();
    }
  }

  const limited = await openPdf(
    { kind: "bytes", bytes },
    { limits: { maxImagePixels: 7 } }
  );
  try {
    await assert.rejects(
      limited.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "resource-limit"
    );
  } finally {
    await limited.close();
  }

  const cancelled = await openPdf({ kind: "bytes", bytes });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      cancelled.compilePage(0, { optimization: "none", signal: controller.signal }),
      (error) => error?.code === "aborted"
    );
  } finally {
    await cancelled.close();
  }

  console.log("PDF session CCITT image tests passed");
} finally {
  hooks.deregister();
}

function validSessionFixture() {
  const pattern = packBits("0111 011 0111");
  const eol = "000000000001";
  const rtc = `${eol}1`.repeat(6);
  const mixed = packBits(`${eol}1 0111 011 0111 ${eol}0 1 1 1 ${rtc}`);
  const eofb = `${eol}${eol}`;
  const group4 = packBits(`001 00110101 000101 1 1 ${eofb}`);
  const hexPattern = `${[...pattern].map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
  const content = [
    "q 8 0 0 1 0 0 cm /G3 Do Q",
    "q 8 0 0 1 0 2 cm /Alias Do Q",
    "q 8 0 0 2 0 4 cm /Mixed Do Q",
    "q 8 0 0 2 0 7 cm /G4 Do Q",
    "1 0 0 rg q 8 0 0 1 0 10 cm /Stencil Do Q",
    "q 8 0 0 1 0 12 cm /Chained Do Q",
    "q 8 0 0 1 0 14 cm /Soft Do Q",
    "0 0 1 rg q 8 0 0 2 0 16 cm /G4Mask Do Q"
  ].join("\n");
  const image = (entries, data) => tinyPdfStream(`/Type /XObject /Subtype /Image ${entries}`, data);
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] " +
        "/Resources << /XObject << /G3 10 0 R /Alias 10 0 R /Mixed 11 0 R /G4 12 0 R " +
        "/Stencil 13 0 R /Chained 14 0 R /Soft 15 0 R /Unused 16 0 R /G4Mask 18 0 R >> >> " +
        "/Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 10, body: image(g3Entries(), pattern) },
    {
      number: 11,
      body: image(
        "/Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K 2 /Columns 8 /EndOfLine true /EndOfBlock true >>",
        mixed
      )
    },
    {
      number: 12,
      body: image(
        "/Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K -1 /Columns 8 >>",
        group4
      )
    },
    {
      number: 13,
      body: image(
        "/Width 8 /Height 1 /ImageMask true /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false >>",
        pattern
      )
    },
    {
      number: 14,
      body: image(
        "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 " +
        "/Filter [/ASCIIHexDecode /CCF] " +
        "/DecodeParms [null << /Columns 8 /Rows 1 /EndOfBlock false >>]",
        hexPattern
      )
    },
    { number: 15, body: image(`${g3Entries()} /SMask 17 0 R`, pattern) },
    // Deliberately invalid and unused: resource dictionaries remain lazy.
    { number: 16, body: image("/Height /Bad /Filter /CCITTFaxDecode", Uint8Array.of()) },
    { number: 17, body: image(`${g3Entries()} /Matte [1]`, pattern) },
    {
      number: 18,
      body: image(
        "/Width 8 /Height 2 /ImageMask true /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
        "/DecodeParms << /K -1 /Columns 8 >>",
        group4
      )
    }
  ] });
}

function singleImageFixture(image) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Im Do") },
    { number: 5, body: image }
  ] });
}

function malformedCcittImage() {
  return tinyPdfStream(`/Type /XObject /Subtype /Image ${g3Entries()}`, Uint8Array.of(0));
}

function extensionCcittImage() {
  return tinyPdfStream(
    `/Type /XObject /Subtype /Image ${g3Entries()}`,
    packBits("000000001 111")
  );
}

function g3Entries() {
  return "/Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
    "/DecodeParms << /K 0 /Columns 8 /Rows 1 /EndOfBlock false >>";
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

function flattenCommands(page, commands, active = new Set()) {
  const output = [];
  for (const command of commands) {
    if (command.kind !== "invoke-group") {
      output.push(command);
      continue;
    }
    if (active.has(command.groupIndex)) continue;
    active.add(command.groupIndex);
    output.push(...flattenCommands(page, page.displayProgram.groups[command.groupIndex].commands, active));
    active.delete(command.groupIndex);
  }
  return output;
}

function imageBytes(page, imageIndex) {
  const start = page.stores.images.dataOffsets[imageIndex];
  const end = page.stores.images.dataOffsets[imageIndex + 1];
  return [...page.stores.images.data.slice(start, end)];
}

function imagePrefix(page, imageIndex) {
  return imageBytes(page, imageIndex).slice(0, 4);
}

function rgbaBits(values) {
  return values.flatMap((value) => value ? [255, 255, 255, 255] : [0, 0, 0, 255]);
}
