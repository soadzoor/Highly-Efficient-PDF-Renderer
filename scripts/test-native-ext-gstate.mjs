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

const { NativePdfExtGStateRegistry } = await import("../src/pdf/nativeExtGState.ts");
const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");
const { createEmptyHeprPageData } = await import("../src/heprDocumentData.ts");
const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");

const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture() });
const decoder = new TextDecoder();

try {
  const registry = new NativePdfExtGStateRegistry(document);
  const [fullIndex, aliasIndex] = await Promise.all([
    registry.resolvePageExtGState(0, "Full"),
    registry.resolvePageExtGState(0, "/Alias")
  ]);
  assert.equal(fullIndex, aliasIndex, "one ref in one resource scope is deduplicated");
  const full = registry.describe(fullIndex);
  assert.equal(full.index, fullIndex);
  assert.equal(full.ref.objectNumber, 10);
  assert.equal(full.strokingAlpha, 0.75);
  assert.equal(full.nonstrokingAlpha, 0.25);
  assert.deepEqual(full.blendModeCandidates, ["Multiply", "Screen"]);
  assert.deepEqual(full.blendModes, ["Multiply", "Screen"]);
  assert.equal(full.effectiveBlendMode, "Multiply");
  assert.equal(full.alphaIsShape, true);
  assert.equal(full.textKnockout, false);
  assert.equal(full.strokingOverprint, true);
  assert.equal(full.nonstrokingOverprint, true, "absent /op inherits an explicit /OP");
  assert.equal(full.overprintMode, 1);
  assert.equal(full.renderingIntent, "Perceptual");
  assert.equal(full.flatnessTolerance, 2);
  assert.equal(full.smoothnessTolerance, 0.4);
  assert.equal(full.strokeAdjustment, true);
  assert.equal(full.transferIsIdentity, true);
  assert.equal(full.lineWidth, 2);
  assert.equal(full.lineCap, 1);
  assert.equal(full.lineJoin, 2);
  assert.equal(full.miterLimit, 5);
  assert.deepEqual(full.lineDash, { array: [3, 2], phase: 1 });

  assert.equal(full.softMask.kind, "mask");
  assert.equal(full.softMask.subtype, "Luminosity");
  assert.deepEqual(full.softMask.backdropColor, [0.1, 0.2, 0.3]);
  assert.equal(full.softMask.formHandle.form.resourceOrigin, "local");
  assert.deepEqual(full.softMask.formHandle.form.bbox, [0, 0, 10, 20]);
  assert.deepEqual(full.softMask.formHandle.form.matrix, [1, 0, 0, 1, 2, 3]);
  assert.equal(full.softMask.formHandle.form.group.subtype, "Transparency");
  assert.equal(full.softMask.formHandle.group.isolated, true);
  assert.equal(full.softMask.formHandle.group.knockout, false);
  assert.equal(full.softMask.formHandle.group.colorSpace.kind, "DeviceRGB");
  assert.equal(full.softMask.formHandle.group.colorSpace.componentCount, 3);
  assert.equal(
    registry.functions.evaluate(full.softMask.transferFunctionIndex, [0.375])[0],
    0.375
  );

  const decodedFirst = await registry.decodeSoftMaskFormContent(full.softMask.formHandle.form);
  const decodedSecond = await registry.decodeSoftMaskFormContent(full.softMask.formHandle.form);
  assert.strictEqual(decodedFirst, decodedSecond, "decoded soft-mask Form content is cached");
  assert.equal(decoder.decode(decodedFirst), "q 0 g 0 0 10 20 re f Q");
  await assert.rejects(
    registry.decodeSoftMaskFormContent(Object.freeze({})),
    TypeError
  );

  const allBlendIndex = await registry.resolvePageExtGState(0, "AllBlendModes");
  const allBlend = registry.describe(allBlendIndex);
  assert.deepEqual(allBlend.blendModes, [
    "Normal", "Compatible", "Multiply", "Screen", "Overlay", "Darken", "Lighten",
    "ColorDodge", "ColorBurn", "HardLight", "SoftLight", "Difference", "Exclusion",
    "Hue", "Saturation", "Color", "Luminosity"
  ]);
  assert.equal(allBlend.effectiveBlendMode, "Normal");
  const fallbackBlend = registry.describe(await registry.resolvePageExtGState(0, "FallbackBlend"));
  assert.deepEqual(fallbackBlend.blendModeCandidates, ["VendorBlend", "Screen"]);
  assert.deepEqual(fallbackBlend.blendModes, ["Screen"]);
  assert.equal(fallbackBlend.effectiveBlendMode, "Screen");

  const noneIndex = await registry.resolvePageExtGState(0, "NoneMask");
  const none = registry.describe(noneIndex);
  assert.equal(none.softMask.kind, "none");
  assert.equal(none.strokingOverprint, false);
  assert.equal(none.nonstrokingOverprint, true);
  assert.equal(none.strokingAlpha, null);

  const scopedRgbIndex = await registry.resolvePageExtGState(0, "Scoped");
  const scopedGrayIndex = await registry.resolvePageExtGState(1, "Scoped");
  assert.notEqual(
    scopedRgbIndex,
    scopedGrayIndex,
    "one indirect ExtGState is scoped by the complete enclosing resources"
  );
  const scopedRgb = registry.describe(scopedRgbIndex);
  const scopedGray = registry.describe(scopedGrayIndex);
  assert.equal(scopedRgb.softMask.formHandle.form.resourceOrigin, "inherited");
  assert.equal(scopedRgb.softMask.formHandle.group.colorSpace.kind, "DeviceRGB");
  assert.equal(scopedGray.softMask.formHandle.group.colorSpace.kind, "DeviceGray");
  assert.notEqual(scopedRgb.softMask.formHandle.form.id, scopedGray.softMask.formHandle.form.id);
  assert.equal(scopedRgb.softMask.transferFunctionIndex, -1);

  const identityIndex = await registry.resolvePageExtGState(0, "IdentityTransfer");
  assert.equal(registry.describe(identityIndex).transferIsIdentity, true);
  const deepIndex = await registry.resolvePageExtGState(0, "Deep");
  assert.equal(registry.describe(deepIndex).nonstrokingAlpha, 0.1);

  const sidecars = registry.buildGroupSidecars();
  assert.equal(sidecars.groups.length, registry.size * 2);
  assert.equal(sidecars.strokingGroupIndices[fullIndex], fullIndex * 2);
  assert.equal(sidecars.nonstrokingGroupIndices[fullIndex], fullIndex * 2 + 1);
  assert.equal(sidecars.groups[fullIndex * 2].alpha, 0.75);
  assert.equal(sidecars.groups[fullIndex * 2 + 1].alpha, 0.25);
  assert.equal(sidecars.groups[fullIndex * 2].alphaIsShape, true);
  assert.equal(sidecars.groups[noneIndex * 2].alphaIsShape, false);
  assert.equal(sidecars.groups[fullIndex * 2].blendMode, "Multiply");
  assert.equal(sidecars.alphaSpecified[fullIndex * 2], 1);
  assert.equal(sidecars.alphaSpecified[noneIndex * 2], 0);
  assert.equal(sidecars.alphaIsShapeSpecified[fullIndex], 1);
  assert.equal(sidecars.alphaIsShapeSpecified[noneIndex], 0);
  assert.equal(sidecars.blendModeSpecified[fullIndex], 1);
  assert.equal(sidecars.blendModeSpecified[noneIndex], 0);
  assert.equal(sidecars.softMaskKinds[fullIndex], 3);
  assert.equal(sidecars.softMaskKinds[noneIndex], 1);
  assert.equal(sidecars.softMaskKinds[scopedRgbIndex], 2);
  assert.equal(sidecars.softMaskProgramIndices[fullIndex], -1);
  assert.equal(sidecars.softMaskGroupIndices[fullIndex], -1);
  assert.equal(sidecars.backdropPaintIndices[fullIndex], -1);
  assert.equal(sidecars.blendingColorSpaceIndices[fullIndex], -1);
  assert.equal(
    sidecars.sourceColorSpaceIndices[fullIndex],
    full.softMask.formHandle.group.colorSpaceIndex
  );
  assert.equal(sidecars.transferFunctionIndices[fullIndex], full.softMask.transferFunctionIndex);
  assert.equal(sidecars.softMaskFormIds[fullIndex], full.softMask.formHandle.form.id);
  assert.ok(sidecars.groups.every((group) =>
    group.softMaskGroupIndex === -1 && group.backdropPaintIndex === -1 &&
    group.blendingColorSpaceIndex === -1 && group.clipIndex === -1
  ));

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
  page.displayProgram.rootGroupIndex = 0;
  page.displayProgram.groups = sidecars.groups;
  validateHeprPageData(page);

  await assert.rejects(
    registry.resolvePageExtGState(0, "CycleA"),
    hasPdfError("unsupported-content", "extgstate-resource-cycle")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "RefCycle"),
    hasPdfError("unsupported-content", "extgstate-reference-cycle")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadBlend"),
    hasPdfError("unsupported-content", "extgstate-blend-mode-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadAlpha"),
    hasPdfError("invalid-object", "extgstate-number-invalid")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadFont"),
    hasPdfError("unsupported-font", "extgstate-font-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadHalftone"),
    hasPdfError("unsupported-content", "extgstate-halftone-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadBlackGeneration"),
    hasPdfError("unsupported-content", "extgstate-black-generation-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadUndercolor"),
    hasPdfError("unsupported-content", "extgstate-undercolor-removal-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadTransfer"),
    hasPdfError("unsupported-content", "extgstate-transfer-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadMaskSubtype"),
    hasPdfError("unsupported-content", "soft-mask-subtype-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadGroup"),
    hasPdfError("unsupported-content", "soft-mask-group-subtype-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadBackdrop"),
    hasPdfError("invalid-object", "soft-mask-backdrop-arity")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadMaskTransfer"),
    hasPdfError("unsupported-content", "soft-mask-transfer-arity")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadColorSpace"),
    hasPdfError("unsupported-content", "soft-mask-group-color-space-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadUnknown"),
    hasPdfError("unsupported-content", "extgstate-entry-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "EmptyBlend"),
    hasPdfError("invalid-object", "extgstate-blend-mode-invalid")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadIntent"),
    hasPdfError("unsupported-content", "extgstate-rendering-intent-unsupported")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "BadDash"),
    hasPdfError("invalid-object", "extgstate-line-dash-invalid")
  );
  await assert.rejects(
    registry.resolvePageExtGState(0, "Missing"),
    hasPdfError("unsupported-content", "missing-extgstate-resource")
  );

  const countLimited = new NativePdfExtGStateRegistry(document, undefined, { maxExtGStates: 1 });
  await countLimited.resolvePageExtGState(0, "NoneMask");
  await assert.rejects(
    countLimited.resolvePageExtGState(0, "AllBlendModes"),
    hasPdfError("resource-limit", "extgstate-count")
  );

  const depthLimited = new NativePdfExtGStateRegistry(document, undefined, { maxExtGStateDepth: 2 });
  await assert.rejects(
    depthLimited.resolvePageExtGState(0, "Deep"),
    hasPdfError("resource-limit", "extgstate-depth")
  );

  const controller = new AbortController();
  controller.abort("ExtGState fixture cancellation");
  await assert.rejects(
    registry.resolvePageExtGState(0, "Full", controller.signal),
    hasPdfError("aborted")
  );
  assert.throws(() => registry.describe(-1), RangeError);
  assert.throws(
    () => new NativePdfExtGStateRegistry(document, undefined, {
      maxExtGStateDepth: document.limits.maxRecursionDepth + 1
    }),
    RangeError
  );
} finally {
  await document.close();
  hooks.deregister();
}

console.log("native ExtGState/compositing registry tests passed");

function fixture() {
  const allBlendModes = [
    "Normal", "Compatible", "Multiply", "Screen", "Overlay", "Darken", "Lighten",
    "ColorDodge", "ColorBurn", "HardLight", "SoftLight", "Difference", "Exclusion",
    "Hue", "Saturation", "Color", "Luminosity"
  ].map((name) => `/${name}`).join(" ");
  const pageZeroStates = [
    "/Full 10 0 R /Alias 10 0 R /AllBlendModes 11 0 R /NoneMask 12 0 R /Scoped 13 0 R",
    "/IdentityTransfer 14 0 R /CycleA /CycleB /CycleB /CycleA /Deep 80 0 R /RefCycle 82 0 R",
    "/BadBlend 40 0 R /BadAlpha 41 0 R /BadFont 42 0 R /BadTransfer 43 0 R",
    "/BadMaskSubtype 44 0 R /BadGroup 45 0 R /BadBackdrop 46 0 R",
    "/BadMaskTransfer 47 0 R /BadColorSpace 48 0 R /BadUnknown 49 0 R",
    "/EmptyBlend 50 0 R /BadIntent 51 0 R /BadDash 52 0 R /FallbackBlend 54 0 R",
    "/BadHalftone 55 0 R /BadBlackGeneration 56 0 R /BadUndercolor 57 0 R"
  ].join(" ");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources 5 0 R >>" },
      { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources 6 0 R >>" },
      {
        number: 5,
        body: `<< /ExtGState << ${pageZeroStates} >> /ColorSpace << /Blend /DeviceRGB >> >>`
      },
      {
        number: 6,
        body: "<< /ExtGState << /Scoped 13 0 R >> /ColorSpace << /Blend /DeviceGray >> >>"
      },
      {
        number: 10,
        body: [
          "<< /Type /ExtGState /CA .75 /ca .25 /BM [/Multiply /Screen] /AIS true /TK false",
          "/OP true /OPM 1 /RI /Perceptual /FL 2 /SM .4 /SA true",
          "/LW 2 /LC 1 /LJ 2 /ML 5 /D [[3 2] 1] /TR /Identity /TR2 /Default /SMask 30 0 R >>"
        ].join(" ")
      },
      { number: 11, body: `<< /BM [${allBlendModes}] >>` },
      { number: 12, body: "<< /SMask /None /OP false /op true >>" },
      { number: 13, body: "<< /ca .5 /SMask << /S /Alpha /G 33 0 R /TR /Identity >> >>" },
      { number: 14, body: "<< /TR /Identity /TR2 /Identity >>" },
      { number: 30, body: "<< /Type /Mask /S /Luminosity /G 31 0 R /BC [.1 .2 .3] /TR 32 0 R >>" },
      {
        number: 31,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 10 20] /Matrix [1 0 0 1 2 3] " +
          "/Resources << /ColorSpace << /Blend /DeviceRGB >> >> " +
          "/Group << /Type /Group /S /Transparency /I true /K false /CS /Blend >>",
          "q 0 g 0 0 10 20 re f Q"
        )
      },
      { number: 32, body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0] /C1 [1] /N 1 >>" },
      {
        number: 33,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 2 2] /Group << /S /Transparency /CS /Blend >>",
          "0 0 2 2 re f"
        )
      },
      {
        number: 34,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 2 2] /Group << /S /NotTransparency >>",
          ""
        )
      },
      {
        number: 35,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 2 2] " +
          "/Group << /S /Transparency /CS [/Indexed /DeviceRGB 0 <000000>] >>",
          ""
        )
      },
      { number: 40, body: "<< /BM /Alien >>" },
      { number: 41, body: "<< /CA 1.5 >>" },
      { number: 42, body: "<< /Font [/F1 12] >>" },
      { number: 43, body: "<< /TR 32 0 R >>" },
      { number: 44, body: "<< /SMask << /S /Color /G 31 0 R >> >>" },
      { number: 45, body: "<< /SMask << /S /Alpha /G 34 0 R >> >>" },
      { number: 46, body: "<< /SMask << /S /Luminosity /G 31 0 R /BC [0 0] >> >>" },
      { number: 47, body: "<< /SMask << /S /Alpha /G 31 0 R /TR 53 0 R >> >>" },
      { number: 48, body: "<< /SMask << /S /Luminosity /G 35 0 R >> >>" },
      { number: 49, body: "<< /Foo 1 >>" },
      { number: 50, body: "<< /BM [] >>" },
      { number: 51, body: "<< /RI /Bogus >>" },
      { number: 52, body: "<< /D [[0 0] 0] >>" },
      {
        number: 53,
        body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1 0 1 0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>"
      },
      { number: 54, body: "<< /BM [/VendorBlend /Screen] >>" },
      { number: 55, body: "<< /HT /Default >>" },
      { number: 56, body: "<< /BG /Identity >>" },
      { number: 57, body: "<< /UCR /Identity >>" },
      { number: 80, body: "81 0 R" },
      { number: 81, body: "<< /ca .1 >>" },
      { number: 82, body: "83 0 R" },
      { number: 83, body: "82 0 R" }
    ]
  });
}

function hasPdfError(code, reason) {
  return (error) => {
    assert.ok(error instanceof PdfError, `expected PdfError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (reason !== undefined) assert.equal(error.details?.reason, reason);
    return true;
  };
}
