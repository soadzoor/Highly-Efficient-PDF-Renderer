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
  const {
    HEPR_GRADIENT_KIND,
    HEPR_MESH_KIND
  } = dataApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram } = executorApi;

  const bytes = patchSessionFixture();
  const session = await openPdf({ kind: "bytes", bytes, label: "patch-shadings.pdf" });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.deepEqual(
      [...page.stores.gradients.kinds],
      [HEPR_GRADIENT_KIND.CoonsPatchMesh, HEPR_GRADIENT_KIND.TensorPatchMesh]
    );
    assert.deepEqual(
      [...page.stores.meshes.kinds],
      [HEPR_MESH_KIND.CoonsPatch, HEPR_MESH_KIND.TensorPatch]
    );
    assert.deepEqual([...page.stores.meshes.vertexOffsets], [0, 12, 28]);
    assert.deepEqual([...page.stores.meshes.indexOffsets], [0, 12, 28]);
    assert.deepEqual([...page.stores.meshes.indices], Array.from({ length: 28 }, (_, index) => index));

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const gradients = root.commands.filter(
      (command) => command.kind === "draw" && command.source === "gradients"
    );
    assert.equal(gradients.length, 2);
    assert.deepEqual(gradients.map((command) => command.first), [0, 1]);
    const draws = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(execution) {
        if (execution.command.source === "gradients") draws.push(execution.command.first);
      }
    });
    assert.deepEqual(draws, [0, 1]);

  } finally {
    await session.close();
  }

  const malformed = await openPdf({ kind: "bytes", bytes: malformedPatchSessionFixture() });
  try {
    await assert.rejects(
      malformed.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "invalid-object"
    );
  } finally {
    await malformed.close();
  }

  const limited = await openPdf(
    { kind: "bytes", bytes },
    { limits: { maxPathsPerPage: 11 } }
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

  console.log("PDF session Coons/tensor patch shading tests passed");
} finally {
  hooks.deregister();
}

function patchSessionFixture() {
  const coons = packRecord({
    flag: 0,
    points: pointSeries(0, 12, 8),
    colors: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]],
    bitsPerFlag: 8,
    bitsPerCoordinate: 8,
    bitsPerComponent: 8,
    componentCount: 3
  });
  const tensor = packRecord({
    flag: 0,
    points: pointSeries(0, 16, 100),
    colors: [[0], [5], [10], [15]],
    bitsPerFlag: 4,
    bitsPerCoordinate: 12,
    bitsPerComponent: 4,
    componentCount: 1,
    paddingBit: 1
  });
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] " +
        "/Resources << /Shading << /Coons 10 0 R /Tensor 11 0 R /Unused 12 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "q /Coons sh Q\nq 1 0 0 1 20 0 cm /Tensor sh Q") },
    {
      number: 10,
      body: tinyPdfStream(
        "/ShadingType 6 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 " +
        "/Decode [0 255 0 255 0 1 0 1 0 1]",
        coons
      )
    },
    {
      number: 11,
      body: tinyPdfStream(
        "/ShadingType 7 /ColorSpace /DeviceRGB /BitsPerCoordinate 12 /BitsPerComponent 4 /BitsPerFlag 4 " +
        "/Decode [0 4095 0 4095 0 1] /Function 13 0 R",
        tensor
      )
    },
    // Missing required entries is intentional; unused shading remains lazy.
    { number: 12, body: tinyPdfStream("/ShadingType 6 /ColorSpace /Bad", Uint8Array.of(0xff)) },
    { number: 13, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" }
  ] });
}

function malformedPatchSessionFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /Shading << /Bad 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Bad sh") },
    {
      number: 5,
      body: tinyPdfStream(
        "/ShadingType 6 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 " +
        "/Decode [0 255 0 255 0 1 0 1 0 1]",
        Uint8Array.of(0)
      )
    }
  ] });
}

function pointSeries(start, count, step) {
  return Array.from({ length: count }, (_, index) => [start + index * step, start + index * step + 1]);
}

function packRecord({
  flag,
  points,
  colors,
  bitsPerFlag,
  bitsPerCoordinate,
  bitsPerComponent,
  componentCount,
  paddingBit = 0
}) {
  const bits = [];
  writeBits(bits, flag, bitsPerFlag);
  for (const [x, y] of points) {
    writeBits(bits, x, bitsPerCoordinate);
    writeBits(bits, y, bitsPerCoordinate);
  }
  for (const color of colors) {
    assert.equal(color.length, componentCount);
    for (const component of color) writeBits(bits, component, bitsPerComponent);
  }
  while (bits.length % 8 !== 0) bits.push(paddingBit);
  const output = new Uint8Array(bits.length / 8);
  bits.forEach((bit, index) => {
    if (bit) output[index >>> 3] |= 1 << (7 - (index & 7));
  });
  return output;
}

function writeBits(bits, value, width) {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 2 ** width - 1);
  for (let bit = width - 1; bit >= 0; bit -= 1) {
    bits.push(Math.floor(value / 2 ** bit) % 2);
  }
}
