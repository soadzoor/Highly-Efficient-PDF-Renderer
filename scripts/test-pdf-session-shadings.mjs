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
  const [sessionApi, dataApi, validationApi, executorApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentData.ts"),
    import("../src/heprDocumentDataValidation.ts"),
    import("../src/heprDisplayExecutor.ts")
  ]);
  const { openPdf } = sessionApi;
  const { HEPR_GRADIENT_KIND } = dataApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram } = executorApi;

  const session = await openPdf({
    kind: "bytes",
    bytes: shadingFixture(),
    label: "native-session-shadings.pdf"
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);

    assert.deepEqual(
      [...page.stores.gradients.kinds],
      [
        HEPR_GRADIENT_KIND.Axial,
        HEPR_GRADIENT_KIND.Radial,
        HEPR_GRADIENT_KIND.FreeFormMesh,
        HEPR_GRADIENT_KIND.Axial
      ],
      "only source-referenced page/Form shadings are resolved, in deterministic first-use order"
    );
    assert.equal(page.stores.meshes.kinds.length, 1);
    assert.equal(page.stores.meshes.positions.length, 8);
    assert.equal(page.stores.meshes.indices.length, 6);
    assert.ok(page.stores.colors.spaceKinds.length >= 2);
    assert.ok(page.stores.functions.kinds.length >= 2);

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(
      root.commands.map((command) => command.kind === "draw" ? command.source : command.kind),
      ["fill-paths", "gradients", "gradients", "gradients", "invoke-program", "fill-paths"]
    );
    const [axial, radial, mesh] = root.commands.slice(1, 4);
    assert.deepEqual(readTransform(page, axial.transformIndex), [2, 0, 0, 3, 10, 20]);
    assert.deepEqual(readClipBounds(page, axial.clipIndex), []);
    assert.deepEqual(readTransform(page, radial.transformIndex), [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(readClipBounds(page, radial.clipIndex), [5, 5, 25, 15]);
    assert.equal(mesh.optionalContentIndex, 0);
    assert.equal(mesh.markedContentIndex, 2);
    assert.deepEqual(page.stores.markedContent.tags, ["OC", "OC", "Span"]);
    assert.deepEqual(page.stores.markedContent.propertyNames, ["Hidden", "Visible", null]);
    assert.deepEqual([...page.stores.markedContent.parentIndices], [-1, -1, 1]);
    assert.deepEqual([...page.stores.markedContent.mcids], [-1, -1, 7]);
    assert.ok(root.commands.every((command) => command.optionalContentIndex !== 1));

    const formInvocation = root.commands[4];
    const formProgram = page.displayProgram.programs[formInvocation.programIndex];
    assert.equal(formProgram.resourceName, "ShadeForm");
    assert.deepEqual(
      formProgram.commands.map((command) => command.kind === "draw" ? command.source : command.kind),
      ["gradients"]
    );
    const formGradient = formProgram.commands[0];
    assert.equal(formGradient.first, 3);
    assert.deepEqual(readTransform(page, formGradient.transformIndex), [1, 0, 0, 1, 3, 4]);
    assert.deepEqual(readClipBounds(page, formGradient.clipIndex), [3, 4, 9, 11]);

    const draws = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      drawRun(execution) {
        draws.push({
          source: execution.command.source,
          first: execution.command.first,
          transform: [...execution.state.transform]
        });
      },
      endCompositeGroup() {}
    });
    assert.deepEqual(
      draws.map(({ source }) => source),
      ["fill-paths", "gradients", "gradients", "gradients", "gradients", "fill-paths"],
      "the renderer-neutral executor retains shading order across a Form invocation"
    );
    assert.deepEqual(normalizeMatrix(draws[1].transform), [2, 0, 0, 3, 10, 20]);
    assert.deepEqual(normalizeMatrix(draws[4].transform), [1.5, 0, 0, 2, 44.5, 18]);

  } finally {
    await session.close();
  }

  for (const shadingType of [6, 7]) {
    const malformedPatchSession = await openPdf({
      kind: "bytes",
      bytes: malformedPatchShadingFixture(shadingType),
      label: `malformed-patch-mesh-${shadingType}.pdf`
    });
    try {
      await assert.rejects(
        malformedPatchSession.compilePage(0, { optimization: "none" }),
        (error) => error?.code === "invalid-object" &&
          error?.details?.shadingType === shadingType
      );
    } finally {
      await malformedPatchSession.close();
    }
  }

  console.log("PDF session shading display-program tests passed");
} finally {
  hooks.deregister();
}

function shadingFixture() {
  const meshBytes = packRecords(
    [2, 8, 8, 8, 8, 8],
    [
      [0, 0, 0, 255, 0, 0],
      [3, 255, 0, 0, 255, 0],
      [3, 0, 255, 0, 0, 255],
      [1, 255, 255, 255, 255, 255]
    ]
  );
  const content = [
    "0 0 10 10 re f",
    "q 2 0 0 3 10 20 cm /Axial sh Q",
    "q 5 5 20 10 re W n /Radial sh Q",
    "/OC /Hidden BDC /Radial sh EMC",
    "/OC /Visible BDC /Span << /MCID 7 >> BDC /Mesh sh EMC EMC",
    "q 1 0 0 1 40 10 cm /ShadeForm Do Q",
    "1 0 0 rg 80 0 10 10 re f"
  ].join("\n");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 30 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]",
          "/Resources <<",
          "/Properties << /Visible 31 0 R /Hidden 32 0 R >>",
          "/Shading << /Axial 10 0 R /Radial 11 0 R /Mesh 12 0 R",
          "/UnusedPatch 16 0 R /UnusedMalformed 99 0 R >>",
          "/XObject << /ShadeForm 20 0 R >>",
          ">> /Contents 4 0 R >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", content) },
      {
        number: 10,
        body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 10 0] /Function 14 0 R /Extend [true false] >>"
      },
      {
        number: 11,
        body: "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [0 0 0 10 10 8] /Function 14 0 R /Extend [false true] >>"
      },
      {
        number: 12,
        body: tinyPdfStream(
          "/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 2 /Decode [0 10 0 10 0 1 0 1 0 1]",
          meshBytes
        )
      },
      {
        number: 13,
        body: "<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 6 0] /Function 15 0 R >>"
      },
      {
        number: 14,
        body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>"
      },
      {
        number: 15,
        body: "<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>"
      },
      {
        number: 16,
        body: tinyPdfStream(
          "/ShadingType 6 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 2 /Decode [0 1 0 1 0 1 0 1 0 1]",
          Uint8Array.of(0)
        )
      },
      {
        number: 20,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Matrix [1.5 0 0 2 0 0] /Resources << /Shading << /Axial 13 0 R >> >>",
          "q 1 0 0 1 3 4 cm 0 0 6 7 re W n /Axial sh Q"
        )
      },
      { number: 30, body: "<< /OCGs [31 0 R 32 0 R] /D << /BaseState /ON /OFF [32 0 R] >> >>" },
      { number: 31, body: "<< /Type /OCG /Name (Visible shading) >>" },
      { number: 32, body: "<< /Type /OCG /Name (Hidden shading) >>" }
    ]
  });
}

function malformedPatchShadingFixture(shadingType) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /Shading << /Patch 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "/Patch sh") },
      {
        number: 5,
        body: tinyPdfStream(
          `/ShadingType ${shadingType} /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 2 /Decode [0 1 0 1 0 1 0 1 0 1]`,
          Uint8Array.of(0)
        )
      }
    ]
  });
}

function readTransform(page, index) {
  return normalizeMatrix(page.stores.transforms.values.slice(index * 6, index * 6 + 6));
}

function normalizeMatrix(values) {
  return [...values].map((value) => Object.is(value, -0) ? 0 : value);
}

function readClipBounds(page, clipIndex) {
  const pathIndex = page.stores.clips.firstPaths[clipIndex];
  return [...page.stores.paths.bounds.slice(pathIndex * 4, pathIndex * 4 + 4)];
}

function packRecords(widths, records) {
  const strideBytes = Math.ceil(widths.reduce((total, width) => total + width, 0) / 8);
  const output = new Uint8Array(strideBytes * records.length);
  records.forEach((values, recordIndex) => {
    assert.equal(values.length, widths.length);
    let bitOffset = recordIndex * strideBytes * 8;
    values.forEach((value, valueIndex) => {
      const width = widths[valueIndex];
      assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 2 ** width - 1);
      for (let bit = width - 1; bit >= 0; bit -= 1) {
        if (Math.floor(value / 2 ** bit) % 2 === 1) {
          output[Math.floor(bitOffset / 8)] |= 1 << (7 - (bitOffset % 8));
        }
        bitOffset += 1;
      }
    });
  });
  return output;
}
