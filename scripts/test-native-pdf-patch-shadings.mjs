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
  const [{ openNativePdfDocument }, { PdfError }, shadingApi, dataApi, validationApi] = await Promise.all([
    import("../src/pdf/nativeDocument.ts"),
    import("../src/pdf/nativeTypes.ts"),
    import("../src/pdf/nativeShadings.ts"),
    import("../src/heprDocumentData.ts"),
    import("../src/heprDocumentDataValidation.ts")
  ]);
  const { NativePdfShadingRegistry } = shadingApi;
  const {
    createEmptyHeprPageData,
    HEPR_GRADIENT_KIND,
    HEPR_MESH_KIND
  } = dataApi;
  const { validateHeprPageData } = validationApi;

  const bytes = patchFixture();
  const document = await openNativePdfDocument({ kind: "bytes", bytes });
  try {
    const registry = new NativePdfShadingRegistry(document);
    const coonsIndex = await registry.add(ref(10));
    assert.equal(await registry.add(ref(10)), coonsIndex, "patch references deduplicate");
    const tensorIndex = await registry.add(ref(11));
    const coons = registry.describe(coonsIndex);
    const tensor = registry.describe(tensorIndex);
    assert.equal(coons.kind, "coons-patch-mesh");
    assert.equal(tensor.kind, "tensor-patch-mesh");
    assert.equal(coons.meshIndex, 0);
    assert.equal(tensor.meshIndex, 1);
    assert.ok(tensor.functionIndex >= 0);

    const gradients = registry.buildGradientStore();
    assert.equal(gradients.kinds[coonsIndex], HEPR_GRADIENT_KIND.CoonsPatchMesh);
    assert.equal(gradients.kinds[tensorIndex], HEPR_GRADIENT_KIND.TensorPatchMesh);
    const meshes = registry.buildMeshStore();
    assert.deepEqual([...meshes.kinds], [HEPR_MESH_KIND.CoonsPatch, HEPR_MESH_KIND.TensorPatch]);
    assert.deepEqual([...meshes.vertexOffsets], [0, 48, 80]);
    assert.deepEqual([...meshes.indexOffsets], [0, 48, 80]);
    assert.deepEqual([...meshes.indices], Array.from({ length: 80 }, (_, index) => index));

    const coonsPatches = Array.from({ length: 4 }, (_, patch) =>
      readPatchPositions(meshes, 0, patch, 12)
    );
    assert.deepEqual(coonsPatches[1].slice(0, 8), coonsPatches[0].slice(3 * 2, 7 * 2));
    assert.deepEqual(coonsPatches[2].slice(0, 8), coonsPatches[1].slice(6 * 2, 10 * 2));
    assert.deepEqual(
      coonsPatches[3].slice(0, 8),
      [
        ...coonsPatches[2].slice(9 * 2, 12 * 2),
        ...coonsPatches[2].slice(0, 2)
      ],
      "flag 3 reuses points 10, 11, 12, and 1 in specification order"
    );
    const coonsColors = Array.from({ length: 4 }, (_, patch) =>
      readPatchCorners(meshes, 0, patch, 12)
    );
    assert.deepEqual(coonsColors[1].slice(0, 8), coonsColors[0].slice(4, 12));
    assert.deepEqual(coonsColors[2].slice(0, 8), coonsColors[1].slice(8, 16));
    assert.deepEqual(
      coonsColors[3].slice(0, 8),
      [...coonsColors[2].slice(12, 16), ...coonsColors[2].slice(0, 4)]
    );
    assert.deepEqual(
      readControlColor(meshes, 0, 0, 12, 1),
      [0, 0, 0, 0],
      "non-corner patch control points have no ambiguous colour payload"
    );

    const tensorPatches = Array.from({ length: 2 }, (_, patch) =>
      readPatchPositions(meshes, 1, patch, 16)
    );
    assert.deepEqual(tensorPatches[1].slice(0, 8), tensorPatches[0].slice(6, 14));
    const tensorCorners = Array.from({ length: 2 }, (_, patch) =>
      readPatchCorners(meshes, 1, patch, 16)
    );
    closeArray(tensorCorners[0].filter((_, index) => index % 4 === 0), [0, 1 / 3, 2 / 3, 1]);
    closeArray(tensorCorners[1].slice(0, 8), tensorCorners[0].slice(4, 12));
    closeArray(tensorCorners[1].slice(8).filter((_, index) => index % 4 === 0), [0.2, 0.8]);

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
    page.stores.colors = registry.colors.buildStore();
    page.stores.functions = registry.functions.buildStore();
    page.stores.gradients = gradients;
    page.stores.meshes = meshes;
    validateHeprPageData(page);

    const secondControlIndex = meshes.indexOffsets[0] + 1;
    const originalSecondControl = meshes.indices[secondControlIndex];
    meshes.indices[secondControlIndex] = meshes.indices[meshes.indexOffsets[0]];
    assert.throws(
      () => validateHeprPageData(page),
      hasValidationCode("hepr.invalid-reference"),
      "patch controls cannot be reordered or shared implicitly"
    );
    meshes.indices[secondControlIndex] = originalSecondControl;

    const nonCornerColorOffset = (meshes.vertexOffsets[0] + 1) * 4;
    meshes.colors[nonCornerColorOffset] = 0.5;
    assert.throws(
      () => validateHeprPageData(page),
      hasValidationCode("hepr.invalid-number"),
      "non-corner control points cannot carry ambiguous color data"
    );
    meshes.colors[nonCornerColorOffset] = 0;

    gradients.kinds[coonsIndex] = HEPR_GRADIENT_KIND.TensorPatchMesh;
    assert.throws(
      () => validateHeprPageData(page),
      hasValidationCode("hepr.invalid-reference"),
      "a patch gradient cannot reference the other patch-net kind"
    );
    gradients.kinds[coonsIndex] = HEPR_GRADIENT_KIND.CoonsPatchMesh;
    validateHeprPageData(page);

    const widthRegistry = new NativePdfShadingRegistry(document);
    const coordinateWidths = [1, 2, 4, 8, 12, 16, 24, 32];
    const componentWidths = [1, 2, 4, 8, 12, 16, 1, 16];
    const flagWidths = [2, 4, 8, 2, 4, 8, 2, 8];
    for (let fixtureIndex = 0; fixtureIndex < coordinateWidths.length; fixtureIndex += 1) {
      const coordinateBits = coordinateWidths[fixtureIndex];
      const componentBits = componentWidths[fixtureIndex];
      const flagBits = flagWidths[fixtureIndex];
      const shadingType = fixtureIndex & 1 ? 7 : 6;
      const pointCount = shadingType === 6 ? 12 : 16;
      const coordinateMaximum = 2 ** coordinateBits - 1;
      const componentMaximum = 2 ** componentBits - 1;
      const payload = packPatchRecords({
        records: [{
          flag: 2 ** flagBits - 4,
          points: Array.from({ length: pointCount }, () => [coordinateMaximum, 0]),
          colors: [[componentMaximum], [0], [componentMaximum], [0]],
          paddingBit: 1
        }],
        bitsPerFlag: flagBits,
        bitsPerCoordinate: coordinateBits,
        bitsPerComponent: componentBits,
        componentCount: 1
      });
      await widthRegistry.add({
        kind: "stream",
        dictionary: new Map([
          ["ShadingType", shadingType],
          ["ColorSpace", { kind: "name", value: "DeviceGray" }],
          ["BitsPerCoordinate", coordinateBits],
          ["BitsPerComponent", componentBits],
          ["BitsPerFlag", flagBits],
          ["Decode", [-10, 10, -20, 20, 0, 1]]
        ]),
        bytes: payload
      });
    }
    const widthMeshes = widthRegistry.buildMeshStore();
    assert.equal(widthMeshes.kinds.length, coordinateWidths.length);
    for (let meshIndex = 0; meshIndex < widthMeshes.kinds.length; meshIndex += 1) {
      const start = widthMeshes.vertexOffsets[meshIndex] * 2;
      closeArray([...widthMeshes.positions.slice(start, start + 2)], [10, -20]);
    }

    for (const [objectNumber, code, reason] of [
      [12, "invalid-object", undefined],
      [13, "invalid-object", undefined],
      [14, "invalid-object", undefined],
      [15, "invalid-object", undefined],
      [16, "invalid-object", undefined],
      [19, "unsupported-content", "shading-function-domain"],
      [20, "unsupported-content", "indexed-mesh-function"],
      [21, "invalid-object", undefined]
    ]) {
      await assert.rejects(
        registry.add(ref(objectNumber)),
        hasPdfError(PdfError, code, reason),
        `object ${objectNumber}`
      );
    }

    const limited = new NativePdfShadingRegistry(document, undefined, { maxMeshVertices: 11 });
    await assert.rejects(limited.add(ref(10)), hasPdfError(PdfError, "resource-limit"));

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      new NativePdfShadingRegistry(document).add(ref(10), undefined, controller.signal),
      hasPdfError(PdfError, "aborted")
    );

    assert.equal(registry.size, 2, "failed and unused malformed patches never append records");
  } finally {
    await document.close();
  }

  console.log("native PDF Coons/tensor patch shading tests passed");
} finally {
  hooks.deregister();
}

function patchFixture() {
  const coonsRecords = [
    {
      flag: 0xfc,
      points: pointSeries(0, 12),
      colors: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]
    },
    {
      flag: 0xfd,
      points: pointSeries(64, 8),
      colors: [[0, 0, 0], [255, 255, 0]]
    },
    {
      flag: 0xfe,
      points: pointSeries(112, 8),
      colors: [[255, 0, 255], [0, 255, 255]]
    },
    {
      flag: 0xff,
      points: pointSeries(160, 8),
      colors: [[64, 128, 192], [192, 128, 64]]
    }
  ];
  const tensorRecords = [
    {
      flag: 0,
      points: pointSeries(0, 16, 100),
      colors: [[0], [5], [10], [15]],
      paddingBit: 1
    },
    {
      flag: 1,
      points: pointSeries(2000, 12, 50),
      colors: [[3], [12]],
      paddingBit: 1
    }
  ];
  const coons = packPatchRecords({
    records: coonsRecords,
    bitsPerFlag: 8,
    bitsPerCoordinate: 8,
    bitsPerComponent: 8,
    componentCount: 3
  });
  const tensor = packPatchRecords({
    records: tensorRecords,
    bitsPerFlag: 4,
    bitsPerCoordinate: 12,
    bitsPerComponent: 4,
    componentCount: 1
  });
  const firstContinuation = packPatchRecords({
    records: [{ flag: 1, points: pointSeries(0, 8), colors: [[0, 0, 0], [0, 0, 0]] }],
    bitsPerFlag: 8,
    bitsPerCoordinate: 8,
    bitsPerComponent: 8,
    componentCount: 3
  });
  const truncated = coons.subarray(0, coons.length - 1);
  const common = "/ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 " +
    "/Decode [0 255 0 255 0 1 0 1 0 1]";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] >>" },
    { number: 10, body: tinyPdfStream(`/ShadingType 6 ${common}`, coons) },
    {
      number: 11,
      body: tinyPdfStream(
        "/ShadingType 7 /ColorSpace /DeviceRGB /BitsPerCoordinate 12 /BitsPerComponent 4 /BitsPerFlag 4 " +
        "/Decode [0 4095 0 4095 0 1] /Function 17 0 R",
        tensor
      )
    },
    { number: 12, body: tinyPdfStream(`/ShadingType 6 ${common}`, firstContinuation) },
    { number: 13, body: tinyPdfStream(`/ShadingType 6 ${common}`, truncated) },
    { number: 14, body: tinyPdfStream(`/ShadingType 6 ${common}`, new Uint8Array(0)) },
    {
      number: 15,
      body: tinyPdfStream(
        "/ShadingType 6 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 /Decode [0 1]",
        coons
      )
    },
    {
      number: 16,
      body: tinyPdfStream(
        "/ShadingType 6 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 1 /Decode [0 255 0 255 0 1 0 1 0 1]",
        coons
      )
    },
    { number: 17, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" },
    { number: 18, body: "<< /FunctionType 2 /Domain [.25 .75] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" },
    {
      number: 19,
      body: tinyPdfStream(
        "/ShadingType 7 /ColorSpace /DeviceRGB /BitsPerCoordinate 12 /BitsPerComponent 4 /BitsPerFlag 4 " +
        "/Decode [0 4095 0 4095 0 1] /Function 18 0 R",
        tensor
      )
    },
    {
      number: 20,
      body: tinyPdfStream(
        "/ShadingType 6 /ColorSpace [/Indexed /DeviceRGB 0 <000000>] /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 " +
        "/Decode [0 255 0 255 0 1] /Function 23 0 R",
        coons
      )
    },
    { number: 21, body: `<< /ShadingType 6 ${common} >>` },
    // Object 22 is intentionally malformed and never resolved.
    { number: 22, body: tinyPdfStream("/ShadingType 7 /ColorSpace /Bad", Uint8Array.of(0xff)) },
    { number: 23, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>" }
  ] });
}

function readPatchPositions(meshes, meshIndex, patchIndex, pointsPerPatch) {
  const meshBase = meshes.vertexOffsets[meshIndex];
  const start = (meshBase + patchIndex * pointsPerPatch) * 2;
  return [...meshes.positions.slice(start, start + pointsPerPatch * 2)];
}

function readPatchCorners(meshes, meshIndex, patchIndex, pointsPerPatch) {
  return [0, 3, 6, 9].flatMap((point) =>
    readControlColor(meshes, meshIndex, patchIndex, pointsPerPatch, point)
  );
}

function readControlColor(meshes, meshIndex, patchIndex, pointsPerPatch, pointIndex) {
  const meshBase = meshes.vertexOffsets[meshIndex];
  const start = (meshBase + patchIndex * pointsPerPatch + pointIndex) * 4;
  return [...meshes.colors.slice(start, start + 4)];
}

function pointSeries(start, count, step = 2) {
  return Array.from({ length: count }, (_, index) => [start + index * step, start + index * step + 1]);
}

function packPatchRecords({
  records,
  bitsPerFlag,
  bitsPerCoordinate,
  bitsPerComponent,
  componentCount
}) {
  const bytes = [];
  for (const record of records) {
    const bits = [];
    writeRecordBits(bits, record.flag, bitsPerFlag);
    for (const [x, y] of record.points) {
      writeRecordBits(bits, x, bitsPerCoordinate);
      writeRecordBits(bits, y, bitsPerCoordinate);
    }
    for (const color of record.colors) {
      assert.equal(color.length, componentCount);
      for (const component of color) writeRecordBits(bits, component, bitsPerComponent);
    }
    while (bits.length % 8 !== 0) bits.push(record.paddingBit ?? 0);
    const packed = new Uint8Array(bits.length / 8);
    bits.forEach((bit, index) => {
      if (bit) packed[index >>> 3] |= 1 << (7 - (index & 7));
    });
    bytes.push(...packed);
  }
  return Uint8Array.from(bytes);
}

function writeRecordBits(bits, value, width) {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 2 ** width - 1);
  for (let bit = width - 1; bit >= 0; bit -= 1) {
    bits.push(Math.floor(value / 2 ** bit) % 2);
  }
}

function ref(objectNumber) {
  return { kind: "ref", objectNumber, generation: 0 };
}

function closeArray(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `${value} != ${expected[index]}`);
  });
}

function hasPdfError(PdfError, code, reason) {
  return (error) => {
    assert.ok(error instanceof PdfError);
    assert.equal(error.code, code);
    if (reason !== undefined) assert.equal(error.details?.reason, reason);
    return true;
  };
}

function hasValidationCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}
