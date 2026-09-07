import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !specifier.endsWith(".ts")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { openPdf } = await import("../src/pdfSession.ts");

  await assertVisibleMalformedFormFailsDuringStreamDecode(openPdf);
  await assertHiddenFormStaysLazy(openPdf);
  await assertAnnotationFailsBeforeAppearanceDecode(openPdf);
  await assertShadingKeepsUnusedFontLazy(openPdf);
  await assertReferencedMalformedFontFails(openPdf);
  await assertShadingAfterTextKeepsTextVectors(openPdf);

  console.log("native VectorScene lazy eligibility tests passed");
} finally {
  hooks.deregister();
}

async function assertVisibleMalformedFormFailsDuringStreamDecode(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: formFixture({ hidden: false }),
    label: "visible-poisoned-form.pdf"
  });
  try {
    await assert.rejects(
      session.compileVectorPage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-filter" &&
        error?.details?.filter === "DefinitelyUnsupported",
      "a visible supported Form must decode its stream and surface a typed filter failure"
    );
  } finally {
    await session.close();
  }
}

async function assertHiddenFormStaysLazy(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: formFixture({ hidden: true }),
    label: "hidden-poisoned-form.pdf"
  });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.segmentCount, 0);
    assert.equal(scene.fillPathCount, 0);
    assert.equal(scene.imagePaintOpCount, 0);
  } finally {
    await session.close();
  }
}

async function assertAnnotationFailsBeforeAppearanceDecode(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: annotationFixture(),
    label: "poisoned-annotation-appearance.pdf"
  });
  try {
    await assert.rejects(
      session.compileVectorPage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-content" &&
        error?.details?.reason === "vector-annotation-appearance" &&
        error?.details?.annotationCount === 1,
      "a visible annotation must be rejected without decoding its unusable appearance stream"
    );
  } finally {
    await session.close();
  }
}

async function assertShadingKeepsUnusedFontLazy(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: shadingFixture("/Shade sh"),
    label: "shading-with-unused-poisoned-font.pdf"
  });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assertGradientPixels(scene);
    assert.equal(scene.textInstanceCount, 0);
  } finally {
    await session.close();
  }
}

async function assertReferencedMalformedFontFails(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: shadingFixture("BT /Bad 10 Tf (A) Tj ET /Shade sh"),
    label: "shading-with-referenced-poisoned-font.pdf"
  });
  try {
    await assert.rejects(
      session.compileVectorPage(0, { optimization: "none" }),
      (error) => error?.code === "invalid-object",
      "support for shadings must not hide a malformed font used by visible text"
    );
  } finally {
    await session.close();
  }
}

async function assertShadingAfterTextKeepsTextVectors(openPdf) {
  const session = await openPdf({
    kind: "bytes",
    bytes: shadingFixture("BT /Good 10 Tf 1 18 Td [(A) 20 (B)] TJ ET /Shade sh"),
    label: "shading-after-split-text-runs.pdf"
  }, {
    missingFontResolver() {
      return { sfntBytes: buildTinySfnt(), identifier: "shading-text-fixture" };
    }
  });
  try {
    const scene = await session.compileVectorPage(0, { optimization: "none" });
    assertGradientPixels(scene);
    assert.equal(scene.textInstanceCount, 2, "selecting the shading must retain both vector glyphs");
    assert.equal(scene.textIndex.pages[0].text.replaceAll(" ", ""), "AB");
  } finally {
    await session.close();
  }
}

function assertGradientPixels(scene) {
  assert.equal(scene.rasterLayers.length, 1, "the shading must produce one selective layer");
  const layer = scene.rasterLayers[0];
  const pixel = (fraction) => {
    const offset = (Math.floor(layer.height / 2) * layer.width +
      Math.floor(layer.width * fraction)) * 4;
    return layer.data.subarray(offset, offset + 4);
  };
  const left = pixel(0.25);
  const right = pixel(0.75);
  assert.ok(left[3] >= 250 && right[3] >= 250, "gradient interior must remain opaque");
  assert.ok(left[0] > left[2] && right[2] > right[0], "the red-to-blue shading must retain its colors");
}

function formFixture({ hidden }) {
  const catalog = hidden
    ? "<< /Type /Catalog /Pages 2 0 R /OCProperties 10 0 R >>"
    : "<< /Type /Catalog /Pages 2 0 R >>";
  const formOptionalContent = hidden ? " /OC 11 0 R" : "";
  const objects = [
    { number: 1, body: catalog },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "/Fm Do") },
    {
      number: 5,
      body: tinyPdfStream(
        `/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >>${formOptionalContent} /Filter /DefinitelyUnsupported`,
        "this payload must remain encoded"
      )
    }
  ];
  if (hidden) {
    objects.push(
      { number: 10, body: "<< /OCGs [11 0 R] /D << /BaseState /ON /OFF [11 0 R] >> >>" },
      { number: 11, body: "<< /Type /OCG /Name (Hidden Form) >>" }
    );
  }
  return writeTinyPdf({ objects });
}

function annotationFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Annots [6 0 R] /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "") },
      {
        number: 6,
        body: "<< /Type /Annot /Subtype /Square /Rect [0 0 10 10] /AP << /N 7 0 R >> >>"
      },
      {
        number: 7,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >> /Filter /DefinitelyUnsupported",
          "this appearance must remain encoded"
        )
      }
    ]
  });
}

function shadingFixture(content) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20]",
          "/Resources << /Font << /Bad 90 0 R /Good 5 0 R >> /Shading << /Shade 91 0 R >> >>",
          "/Contents 4 0 R >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
      {
        number: 91,
        body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 20 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>"
      }
    ]
  });
}
