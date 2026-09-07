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
  const [{ scanDensePdfResourceReferences }, { openPdf }, { validateHeprPageData }] =
    await Promise.all([
      import("../src/pdf/nativeContentCompiler.ts"),
      import("../src/pdfSession.ts"),
      import("../src/heprDocumentDataValidation.ts")
    ]);

  const encoder = new TextEncoder();
  const references = scanDensePdfResourceReferences(encoder.encode([
    "/Im#20One Do",
    "BT /F#31 12 Tf ET",
    "/GS gs",
    "/Spot cs /Spot CS",
    "/Pattern cs /P1 scn",
    "/Shade sh",
    "/Span /Meta BDC EMC",
    "/Span /Meta DP",
    "/Im#20One Do"
  ].join("\n")));
  assert.deepEqual(references, {
    xObjects: ["Im One"],
    properties: ["Meta"],
    optionalContentProperties: [],
    fonts: ["F1"],
    extGStates: ["GS"],
    colorSpaces: ["Spot", "Pattern"],
    shadings: ["Shade"],
    patterns: ["P1"]
  });
  assert.throws(
    () => scanDensePdfResourceReferences(encoder.encode("/F1 /Bad Tf")),
    /Tf requires a numeric font-size operand/
  );

  const unusedSession = await openPdf({
    kind: "bytes",
    bytes: lazyResourceFixture("0 0 10 10 re f"),
    label: "unused-malformed-resources.pdf"
  });
  try {
    const page = await unusedSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands.length, 1);
    assert.equal(page.stores.fonts.names.length, 0);
    assert.equal(page.stores.images.widths.length, 0);
  } finally {
    await unusedSession.close();
  }

  const mixedSession = await openPdf({
    kind: "bytes",
    bytes: mixedLazyResourceFixture(),
    label: "used-good-unused-malformed-resources.pdf"
  });
  try {
    const page = await mixedSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.deepEqual(page.stores.fonts.names, ["Helvetica"]);
    assert.equal(page.stores.images.widths.length, 1);
    assert.equal(page.textIndex.text, "A");
  } finally {
    await mixedSession.close();
  }

  for (const [label, content, code] of [
    ["font", "BT /BadFont 10 Tf ET", "invalid-object"],
    ["ExtGState", "/BadGS gs", "invalid-object"],
    ["color space", "/BadCS cs", "unsupported-color"],
    ["image", "/BadImage Do", "unsupported-content"],
    ["visibility property", "/OC /BadProp BDC EMC", "invalid-object"],
    ["shading", "/BadShading sh", "invalid-object"]
  ]) {
    await assertDeterministicCompileFailure(
      openPdf,
      lazyResourceFixture(content),
      code,
      label
    );
  }

  for (const [label, content, code] of [
    ["font", "BT /MissingFont 10 Tf ET", "unsupported-font"],
    ["ExtGState", "/MissingGS gs", "unsupported-content"],
    ["color space", "/MissingCS cs", "unsupported-color"],
    ["XObject", "/MissingImage Do", "unsupported-content"],
    ["visibility property", "/OC /MissingProp BDC EMC", "invalid-object"],
    ["shading", "/MissingShading sh", "unsupported-content"]
  ]) {
    await assertDeterministicCompileFailure(
      openPdf,
      lazyResourceFixture(content),
      code,
      `missing ${label}`
    );
  }

  // Non-visual /Span metadata may be absent with a diagnostic. /OC above is
  // deliberately strict because an unresolved membership could hide paint.
  for (const property of ["BadProp", "MissingProp"]) {
    const session = await openPdf({
      kind: "bytes",
      bytes: lazyResourceFixture(`/Span /${property} BDC 0 0 10 10 re f EMC`)
    });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      validateHeprPageData(page);
      assert.equal(page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands.length, 1);
      assert.ok(session.getDiagnostics().some(({ code }) => code === "marked-content.unresolved-property"));
    } finally {
      await session.close();
    }
  }

  await assertDeterministicCompileFailure(
    openPdf,
    lazyResourceFixture("BT /BadFont /NotANumber Tf ET"),
    "invalid-object",
    "malformed resource operator"
  );

  console.log("PDF session lazy-resource tests passed.");
} finally {
  hooks.deregister();
}

function lazyResourceFixture(content) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10]",
          "/Resources <<",
          "/Font << /BadFont 90 0 R >>",
          "/ExtGState << /BadGS 91 0 R >>",
          "/ColorSpace << /BadCS 92 0 R >>",
          "/XObject << /BadImage 93 0 R >>",
          "/Properties << /BadProp 94 0 R >>",
          "/Shading << /BadShading 95 0 R >>",
          ">> /Contents 4 0 R >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", content) }
    ]
  });
}

function mixedLazyResourceFixture() {
  const resources = [
    "/Font << /GoodFont 5 0 R /BadFont 90 0 R >>",
    "/ExtGState << /GoodGS << /ca 1 >> /BadGS 91 0 R >>",
    "/ColorSpace << /GoodCS /DeviceRGB /BadCS 92 0 R >>",
    "/XObject << /GoodImage 6 0 R /BadImage 93 0 R >>",
    "/Properties << /GoodProp << /MCID 3 >> /BadProp 94 0 R >>",
    "/Shading << /BadShading 95 0 R >>"
  ].join(" ");
  const content = [
    "/GoodGS gs",
    "/GoodCS cs 0.2 0.4 0.6 sc 0 0 2 2 re f",
    "/Span /GoodProp BDC 2 0 2 2 re f EMC",
    "BT /GoodFont 10 Tf 3 Tr 1 0 0 1 1 5 Tm (A) Tj ET",
    "q 1 0 0 1 5 0 cm /GoodImage Do Q"
  ].join("\n");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << ${resources} >> /Contents 4 0 R >>`
      },
      { number: 4, body: tinyPdfStream("", content) },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8",
          Uint8Array.of(127)
        )
      }
    ]
  });
}

async function assertDeterministicCompileFailure(openPdf, bytes, expectedCode, label) {
  const session = await openPdf({ kind: "bytes", bytes, label: `${label}.pdf` });
  try {
    const failures = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await session.compilePage(0, { optimization: "none" });
        assert.fail(`${label} unexpectedly compiled`);
      } catch (error) {
        failures.push({ code: error?.code, message: error?.message });
      }
    }
    assert.equal(failures[0].code, expectedCode, `${label} returned the wrong typed code`);
    assert.deepEqual(failures[1], failures[0], `${label} did not fail deterministically`);
  } finally {
    await session.close();
  }
}
