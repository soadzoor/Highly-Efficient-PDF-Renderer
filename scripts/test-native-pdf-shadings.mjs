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

const {
  NATIVE_PDF_SHADING_STORE_FLAGS,
  NativePdfShadingRegistry
} = await import("../src/pdf/nativeShadings.ts");
const {
  HEPR_GRADIENT_KIND,
  createEmptyHeprPageData
} = await import("../src/heprDocumentData.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
const { PdfError, openNativePdfDocument } = await import("../src/pdf/nativePdf.ts");

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function name(value) {
  return { kind: "name", value };
}

function fixture() {
  const freeFormBytes = packRecords(
    [2, 8, 8, 8, 8, 8],
    [
      [0, 0, 0, 255, 0, 0],
      [3, 255, 0, 0, 255, 0],
      [3, 0, 255, 0, 0, 255],
      [1, 255, 255, 255, 255, 255]
    ]
  );
  const latticeBytes = packRecords(
    [8, 8, 8],
    [
      [0, 0, 0],
      [255, 0, 85],
      [0, 255, 170],
      [255, 255, 255]
    ]
  );
  const truncatedMesh = freeFormBytes.subarray(0, freeFormBytes.length - 1);

  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20]",
          "/Resources << /Shading <<",
          "/Axial 10 0 R /AxialAlias 10 0 R /Radial 11 0 R /FunctionBased 12 0 R",
          "/FreeForm 13 0 R /Lattice 14 0 R /BadArray 15 0 R /BadRadius 16 0 R",
          "/MalformedPatch 17 0 R /Truncated 18 0 R /NarrowDomain 19 0 R /A /B /B /A",
          ">> >> >>"
        ].join(" ")
      },
      {
        number: 4,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1 0 1 0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>"
      },
      {
        number: 5,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0] /C1 [1] /N 1 >>"
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1]",
          "{ pop dup dup }"
        )
      },
      {
        number: 7,
        body: "<< /FunctionType 2 /Domain [0.2 0.8] /Range [0 1 0 1 0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>"
      },
      {
        number: 10,
        body: [
          "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 10 0] /Domain [0 1]",
          "/Function 4 0 R /Extend [true false] /BBox [9 8 1 2]",
          "/Background [0.25 0.5 0.75] /AntiAlias true >>"
        ].join(" ")
      },
      {
        number: 11,
        body: "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [0 0 0 10 10 8] /Function [5 0 R 5 0 R 5 0 R] /Extend [false true] >>"
      },
      {
        number: 12,
        body: "<< /ShadingType 1 /ColorSpace /DeviceRGB /Domain [0 1 0 1] /Matrix [2 0 0 3 4 5] /Function 6 0 R >>"
      },
      {
        number: 13,
        body: tinyPdfStream(
          "/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 2 /Decode [0 10 0 10 0 1 0 1 0 1]",
          freeFormBytes
        )
      },
      {
        number: 14,
        body: tinyPdfStream(
          "/ShadingType 5 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /VerticesPerRow 2 /Decode [0 10 0 10 0 1] /Function 4 0 R /BBox [0 0 10 10]",
          latticeBytes
        )
      },
      {
        number: 15,
        body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 1] /Function [5 0 R 5 0 R] >>"
      },
      {
        number: 16,
        body: "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [0 0 -1 1 1 2] /Function 4 0 R >>"
      },
      {
        number: 17,
        body: tinyPdfStream(
          "/ShadingType 6 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 2 /Decode [0 1 0 1 0 1 0 1 0 1]",
          Uint8Array.of(0)
        )
      },
      {
        number: 18,
        body: tinyPdfStream(
          "/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 2 /Decode [0 10 0 10 0 1 0 1 0 1]",
          truncatedMesh
        )
      },
      {
        number: 19,
        body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 1] /Function 7 0 R >>"
      }
    ]
  });
}

const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture() });

try {
  const registry = new NativePdfShadingRegistry(document);
  const [axialIndex, axialAliasIndex] = await Promise.all([
    registry.resolvePageShading(0, "Axial"),
    registry.resolvePageShading(0, "/AxialAlias")
  ]);
  assert.equal(axialIndex, axialAliasIndex, "aliases of one indirect shading are deduplicated");
  const axial = registry.describe(axialIndex);
  assert.equal(axial.shadingType, 2);
  assert.deepEqual(axial.coordinates, [0, 0, 10, 0]);
  assert.deepEqual(axial.domain, [0, 1]);
  assert.deepEqual(axial.boundingBox, [1, 2, 9, 8]);
  assert.deepEqual(axial.background, [0.25, 0.5, 0.75]);
  assert.deepEqual(axial.extend, [true, false]);
  assert.equal(axial.antiAlias, true);
  assert.equal(axial.functionIndices.length, 1);

  const radialIndex = await registry.resolvePageShading(0, "Radial");
  const radial = registry.describe(radialIndex);
  assert.equal(radial.functionIndex, -1, "function arrays use the coordinate sidecar convention");
  assert.equal(radial.functionIndices.length, 3);
  assert.deepEqual(radial.functionIndices, [radial.functionIndices[0], radial.functionIndices[0], radial.functionIndices[0]]);
  assert.deepEqual(radial.extend, [false, true]);

  const functionIndex = await registry.resolvePageShading(0, "FunctionBased");
  assert.deepEqual(registry.describe(functionIndex).matrix, [2, 0, 0, 3, 4, 5]);

  const freeFormIndex = await registry.resolvePageShading(0, "FreeForm");
  const latticeIndex = await registry.resolvePageShading(0, "Lattice");
  assert.equal(registry.describe(freeFormIndex).meshIndex, 0);
  assert.equal(registry.describe(latticeIndex).meshIndex, 1);
  assert.equal(registry.describe(latticeIndex).functionIndex, axial.functionIndex);

  const gradients = registry.buildGradientStore();
  assert.equal(gradients.kinds[axialIndex], HEPR_GRADIENT_KIND.Axial);
  assert.equal(gradients.kinds[radialIndex], HEPR_GRADIENT_KIND.Radial);
  assert.equal(gradients.kinds[functionIndex], HEPR_GRADIENT_KIND.Function);
  assert.equal(gradients.kinds[freeFormIndex], HEPR_GRADIENT_KIND.FreeFormMesh);
  assert.equal(gradients.kinds[latticeIndex], HEPR_GRADIENT_KIND.LatticeMesh);
  assert.equal(
    gradients.extendFlags[axialIndex],
    NATIVE_PDF_SHADING_STORE_FLAGS.ExtendStart |
      NATIVE_PDF_SHADING_STORE_FLAGS.AntiAlias |
      NATIVE_PDF_SHADING_STORE_FLAGS.HasBoundingBox |
      NATIVE_PDF_SHADING_STORE_FLAGS.HasBackground
  );
  assert.ok(
    gradients.extendFlags[radialIndex] & NATIVE_PDF_SHADING_STORE_FLAGS.HasFunctionArray
  );
  const axialCoordinates = [...gradients.coordinates.subarray(
    gradients.coordinateOffsets[axialIndex],
    gradients.coordinateOffsets[axialIndex + 1]
  )];
  assert.deepEqual(axialCoordinates, [0, 0, 10, 0, 0, 1, 1, 2, 9, 8, 0.25, 0.5, 0.75]);
  const radialCoordinates = [...gradients.coordinates.subarray(
    gradients.coordinateOffsets[radialIndex],
    gradients.coordinateOffsets[radialIndex + 1]
  )];
  assert.deepEqual(radialCoordinates.slice(0, 8), [0, 0, 0, 10, 10, 8, 0, 1]);
  assert.deepEqual(radialCoordinates.slice(8), radial.functionIndices);

  const meshes = registry.buildMeshStore();
  assert.deepEqual([...meshes.vertexOffsets], [0, 4, 8]);
  assert.deepEqual([...meshes.indexOffsets], [0, 6, 12]);
  assert.deepEqual([...meshes.indices], [0, 1, 2, 1, 2, 3, 4, 5, 6, 5, 6, 7]);
  assert.deepEqual([...meshes.positions.subarray(0, 8)], [0, 0, 10, 0, 0, 10, 10, 10]);
  assert.deepEqual([...meshes.colors.subarray(0, 16)], [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 1, 1, 0
  ]);
  assert.ok(Math.abs(meshes.colors[16 + 4] - 1 / 3) < 1e-6);
  assert.ok(Math.abs(meshes.colors[16 + 8] - 2 / 3) < 1e-6);
  assert.deepEqual([...meshes.colors.subarray(16 + 1, 16 + 4)], [0, 0, 0]);

  const page = createEmptyHeprPageData({
    sourcePageIndex: 0,
    mediaBox: [0, 0, 20, 20],
    cropBox: [0, 0, 20, 20],
    bleedBox: null,
    trimBox: null,
    artBox: null,
    rotation: 0,
    userUnit: 1,
    width: 20,
    height: 20
  });
  page.stores.functions = registry.functions.buildStore();
  page.stores.colors = registry.colors.buildStore();
  page.stores.gradients = gradients;
  page.stores.meshes = meshes;
  validateHeprPageData(page);

  const resources = await document.resolveDictionary(document.getPage(0).resources);
  const direct = new Map([
    ["ShadingType", 2],
    ["ColorSpace", name("DeviceGray")],
    ["Coords", [0, 0, 2, 0]],
    ["Function", new Map([
      ["FunctionType", 2],
      ["Domain", [0, 1]],
      ["C0", [0]],
      ["C1", [1]],
      ["N", 1]
    ])]
  ]);
  const firstDirect = await registry.add(direct, resources);
  assert.equal(await registry.add(direct, resources), firstDirect, "direct dictionaries are cached");

  const sharedNamedShading = new Map([
    ["ShadingType", 2],
    ["ColorSpace", name("Custom")],
    ["Coords", [0, 0, 3, 0]],
    ["Function", ref(4)]
  ]);
  const sharedShadingResources = new Map([["Shared", sharedNamedShading]]);
  const rgbScope = new Map([
    ["Shading", sharedShadingResources],
    ["ColorSpace", new Map([["Custom", name("DeviceRGB")]])]
  ]);
  const calibratedScope = new Map([
    ["Shading", sharedShadingResources],
    ["ColorSpace", new Map([[
      "Custom",
      [name("CalRGB"), new Map([["WhitePoint", [0.95047, 1, 1.08883]]])]
    ]])]
  ]);
  const rgbScopedIndex = await registry.add(name("Shared"), rgbScope);
  const calibratedScopedIndex = await registry.add(name("Shared"), calibratedScope);
  assert.notEqual(rgbScopedIndex, calibratedScopedIndex, "named shading caches retain resource scope");
  assert.notEqual(
    registry.describe(rgbScopedIndex).colorSpaceIndex,
    registry.describe(calibratedScopedIndex).colorSpaceIndex
  );

  await assert.rejects(
    registry.add(name("A"), resources),
    (error) => error instanceof PdfError && error.code === "unsupported-content" &&
      error.details?.reason === "shading-resource-cycle"
  );
  await assert.rejects(
    registry.resolvePageShading(0, "BadArray"),
    hasPdfError("unsupported-content", "shading-function-arity")
  );
  await assert.rejects(
    registry.resolvePageShading(0, "BadRadius"),
    hasPdfError("invalid-object")
  );
  await assert.rejects(
    registry.resolvePageShading(0, "MalformedPatch"),
    hasPdfError("invalid-object")
  );
  await assert.rejects(
    registry.resolvePageShading(0, "Truncated"),
    hasPdfError("invalid-object")
  );
  await assert.rejects(
    registry.resolvePageShading(0, "NarrowDomain"),
    hasPdfError("unsupported-content", "shading-function-domain")
  );

  const limited = new NativePdfShadingRegistry(document, undefined, { maxMeshVertices: 3 });
  await assert.rejects(
    limited.resolvePageShading(0, "FreeForm"),
    hasPdfError("resource-limit")
  );

  const controller = new AbortController();
  controller.abort("fixture cancellation");
  await assert.rejects(
    registry.resolvePageShading(0, "Axial", controller.signal),
    hasPdfError("aborted")
  );
} finally {
  await document.close();
  hooks.deregister();
}

console.log("native PDF shading registry tests passed");

function hasPdfError(code, reason) {
  return (error) => {
    assert.ok(error instanceof PdfError, `expected PdfError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (reason !== undefined) assert.equal(error.details?.reason, reason);
    return true;
  };
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
