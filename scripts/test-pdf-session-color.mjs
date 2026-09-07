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
  const [sessionApi, dataApi, validationApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentData.ts"),
    import("../src/heprDocumentDataValidation.ts")
  ]);
  const { openPdf } = sessionApi;
  const { HEPR_COLOR_SPACE_KIND, HEPR_FUNCTION_KIND, HEPR_GRADIENT_KIND } = dataApi;
  const { validateHeprPageData } = validationApi;

  const managedBytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 20]",
          "/Resources << /ColorSpace <<",
          "/CG [/CalGray << /WhitePoint [0.95047 1 1.08883] /Gamma 2 >>]",
          "/CR [/CalRGB << /WhitePoint [0.95047 1 1.08883]",
          "/Gamma [1 1 1]",
          "/Matrix [0.4124564 0.2126729 0.0193339 0.3575761 0.7151522 0.119192 0.1804375 0.072175 0.9503041] >>]",
          "/LAB [/Lab << /WhitePoint [0.95047 1 1.08883] /Range [-128 127 -128 127] >>]",
          "/IDX [/Indexed /DeviceRGB 1 <FF000000FF00>]",
          "/SEP [/Separation /Spot /DeviceRGB 5 0 R]",
          "/DN [/DeviceN [/InkA /InkB] /DeviceRGB 6 0 R]",
          ">> >> /Contents 4 0 R >>"
        ].join(" ")
      },
      {
        number: 4,
        body: tinyPdfStream("", [
          "0 g 0 0 8 8 re f",
          "1 0 0 rg 10 0 8 8 re f",
          "0 1 1 0 k 20 0 8 8 re f",
          "/CG cs 0.5 sc 30 0 8 8 re f",
          "/CR cs 1 0 0 sc 40 0 8 8 re f",
          "/LAB cs 100 0 0 sc 50 0 8 8 re f",
          "/IDX cs 1 sc 60 0 8 8 re f",
          "/SEP cs 1 scn 70 0 8 8 re f",
          "/DN cs 0.25 0.75 scn 80 0 8 8 re f"
        ].join("\n"))
      },
      {
        number: 5,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1 0 1 0 1] /C0 [1 1 1] /C1 [0 0 1] /N 1 >>"
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1]",
          "{ pop dup dup }"
        )
      }
    ]
  });
  const managedSession = await openPdf({ kind: "bytes", bytes: managedBytes });
  try {
    const page = await managedSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.equal(root.commands.length, 9);
    assert(root.commands.every((command) => command.kind === "draw" && command.source === "fill-paths"));
    assert(root.commands.every((command) => command.paintIndex >= 0));

    const colorKinds = new Set(page.stores.colors.spaceKinds);
    for (const kind of [
      HEPR_COLOR_SPACE_KIND.DeviceGray,
      HEPR_COLOR_SPACE_KIND.DeviceRgb,
      HEPR_COLOR_SPACE_KIND.DeviceCmyk,
      HEPR_COLOR_SPACE_KIND.CalGray,
      HEPR_COLOR_SPACE_KIND.CalRgb,
      HEPR_COLOR_SPACE_KIND.Lab,
      HEPR_COLOR_SPACE_KIND.Indexed,
      HEPR_COLOR_SPACE_KIND.Separation,
      HEPR_COLOR_SPACE_KIND.DeviceN
    ]) {
      assert(colorKinds.has(kind), `missing managed color kind ${kind}`);
    }
    assert(new Set(page.stores.functions.kinds).has(HEPR_FUNCTION_KIND.Exponential));
    assert(new Set(page.stores.functions.kinds).has(HEPR_FUNCTION_KIND.Calculator));

    const rgbs = root.commands.map((command) => paintRgb(page, command.paintIndex));
    assertRgb(rgbs[0], [0, 0, 0]);
    assertRgb(rgbs[1], [1, 0, 0]);
    // Frozen uncalibrated DeviceCMYK oracle value, also covered by the color
    // registry tests. DeviceCMYK red is not the same color as DeviceRGB red.
    assertRgb(rgbs[2], [1, 0.17998620773545304, 0.0891440862243233]);
    assert(rgbs[3][0] > 0 && rgbs[3][0] < 1, "CalGray conversion must remain tonal");
    assertRgb(rgbs[4], [1, 0, 0], 2e-4);
    assertRgb(rgbs[5], [1, 1, 1], 2e-4);
    assertRgb(rgbs[6], [0, 1, 0]);
    assertRgb(rgbs[7], [0, 0, 1]);
    assertRgb(rgbs[8], [0.25, 0.25, 0.25]);
  } finally {
    await managedSession.close();
  }

  const stencilBytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Mask 5 0 R >> >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "0.2 0.4 0.6 rg q 10 0 0 10 0 0 cm /Mask Do Q")
      },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true /BitsPerComponent 1",
          new Uint8Array([0x80])
        )
      }
    ]
  });
  const stencilSession = await openPdf({ kind: "bytes", bytes: stencilBytes });
  try {
    const page = await stencilSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const command = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands[0];
    assert.equal(command.kind, "draw");
    assert.equal(command.source, "images");
    assert.equal(page.stores.images.imageMask[command.first], 1);
    assert(command.paintIndex >= 0, "a stencil image must retain the current nonstroking paint");
    assertRgb(paintRgb(page, command.paintIndex), [0.2, 0.4, 0.6]);
  } finally {
    await stencilSession.close();
  }

  const profile = createRgbIccHeader();
  const iccBytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ColorSpace << /ICC [/ICCBased 5 0 R] >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "/ICC cs 1 0 0 sc 0 0 10 10 re f") },
      { number: 5, body: tinyPdfStream("/N 3 /Alternate /DeviceRGB", profile) }
    ]
  });
  await assertCompileCode(openPdf, iccBytes, "unsupported-color");

  const patternBytes = simplePagePdf(
    "/Resources << /ColorSpace << /P [/Pattern /DeviceRGB] >> >>",
    "/P cs 1 0 0 /Tile scn 0 0 10 10 re f"
  );
  await assertCompileCode(openPdf, patternBytes, "unsupported-content");

  const shadingBytes = simplePagePdf(
    "/Resources << /Shading << /Sh1 << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 10 0] /Function 5 0 R >> >> >>",
    "/Sh1 sh",
    [{
      number: 5,
      body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>"
    }]
  );
  const shadingSession = await openPdf({ kind: "bytes", bytes: shadingBytes });
  try {
    const page = await shadingSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.equal(root.commands.length, 1);
    assert.equal(root.commands[0].kind, "draw");
    assert.equal(root.commands[0].source, "gradients");
    assert.equal(page.stores.gradients.kinds[root.commands[0].first], HEPR_GRADIENT_KIND.Axial);
  } finally {
    await shadingSession.close();
  }

  console.log("PDF session managed-color integration tests passed.");
} finally {
  hooks.deregister();
}

function simplePagePdf(resourceEntries, content, extraObjects = []) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] ${resourceEntries} /Contents 4 0 R >>`
      },
      { number: 4, body: tinyPdfStream("", content) },
      ...extraObjects
    ]
  });
}

async function assertCompileCode(openPdf, bytes, code) {
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    await assert.rejects(session.compilePage(0), (error) => error?.code === code);
  } finally {
    await session.close();
  }
}

function paintRgb(page, paintIndex) {
  const colorIndex = page.stores.paints.resourceIndices[paintIndex];
  const first = page.stores.colors.parameterOffsets[colorIndex];
  const limit = page.stores.colors.parameterOffsets[colorIndex + 1];
  const components = [...page.stores.colors.parameters.subarray(first, limit)];
  assert.equal(components.length, 3, "compiled solid paints must carry canonical sRGB");
  return components;
}

function assertRgb(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, 3);
  for (let index = 0; index < 3; index += 1) {
    assert(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${actual[index]} is not within ${tolerance} of ${expected[index]}`
    );
  }
}

function createRgbIccHeader() {
  const profile = new Uint8Array(128);
  const view = new DataView(profile.buffer);
  view.setUint32(0, profile.length, false);
  profile[8] = 4;
  writeAscii(profile, 12, "mntr");
  writeAscii(profile, 16, "RGB ");
  writeAscii(profile, 20, "XYZ ");
  writeAscii(profile, 36, "acsp");
  return profile;
}

function writeAscii(bytes, offset, value) {
  bytes.set(new TextEncoder().encode(value), offset);
}
