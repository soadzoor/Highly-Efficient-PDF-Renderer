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

const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const {
  NativePdfFormAppearanceRegistry
} = await import("../src/pdf/nativeForms.ts");
const {
  computeNativePdfAnnotationPlacement,
  multiplyNativePdfMatrices,
  transformNativePdfRectangle
} = await import("../src/pdf/nativeFormGeometry.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();

function mainFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 30 0 R /OCProperties 62 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [10 20 210 120]",
          "/CropBox [20 30 180 100] /Rotate 90 /UserUnit 2",
          "/Resources << /XObject << /Inherited 40 0 R /Local 41 0 R /UnusedBad 42 0 R >>",
          "/Font << /PageFont << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>",
          "/Annots [10 0 R 11 0 R 12 0 R 13 0 R 14 0 R 10 0 R",
          "15 0 R 16 0 R 17 0 R 18 0 R 19 0 R 20 0 R 21 0 R",
          "22 0 R 23 0 R 24 0 R 25 0 R 26 0 R 27 0 R 28 0 R 29 0 R] >>"
        ].join(" ")
      },
      {
        number: 10,
        body: "<< /Type /Annot /Subtype /Link /Rect [40 30 20 10] /OC 60 0 R /AP << /N 50 0 R >> >>"
      },
      { number: 11, body: "<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /F 1 >>" },
      { number: 12, body: "<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /F 2 >>" },
      { number: 13, body: "<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /F 32 >>" },
      { number: 14, body: "<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /F 4 /AP << /N 50 0 R >> >>" },
      {
        number: 15,
        body: "<< /Type /Annot /Subtype /Widget /Parent 31 0 R /Rect [0 0 10 10] /AP << /N << /Off 51 0 R /ChoiceB 52 0 R >> >> >>"
      },
      {
        number: 16,
        body: "<< /Type /Annot /Subtype /Widget /Parent 31 0 R /Rect [10 0 20 10] /AP << /N << /Off 51 0 R /ChoiceA 53 0 R >> >> >>"
      },
      {
        number: 17,
        body: "<< /Type /Annot /Subtype /Widget /Parent 32 0 R /T (Child) /Ff null /V null /DV null /DA null /Q null /Rect [0 20 30 30] /AP << /N << /Only 55 0 R >> >> >>"
      },
      {
        number: 18,
        body: "<< /Type /Annot /Subtype /Widget /Parent 33 0 R /Rect [0 30 30 40] /AP << /N 54 0 R >> >>"
      },
      { number: 19, body: "<< /Type /Annot /Subtype /Text /Rect [0 40 10 50] >>" },
      {
        number: 20,
        body: "<< /Type /Annot /Subtype /Link /Rect [0 50 10 60] /OC 61 0 R /AP << /N 50 0 R >> >>"
      },
      {
        number: 21,
        body: "<< /Type /Annot /Subtype /Link /Rect [0 60 10 70] /AS /Good /AP << /N << /Good 50 0 R /Bad 999 0 R >> >> >>"
      },
      { number: 22, body: "<< /Type /Annot /Subtype /Link /Rect [0 70 10 80] /AP << /N 56 0 R >> >>" },
      {
        number: 23,
        body: "<< /Type /Annot /Subtype /Link /Rect [10 70 20 80] /AS /Missing /AP << /N << /Good 50 0 R >> >> >>"
      },
      { number: 24, body: "<< /Type /Annot /Subtype /Link /Rect [20 70 30 80] /AP << /N 57 0 R >> >>" },
      { number: 25, body: "<< /Type /Annot /Subtype /Link /Rect [30 70 40 80] /AP << /N 58 0 R >> >>" },
      { number: 26, body: "<< /Type /Annot /Subtype /Link /Rect [40 70 50 80] /AP << /N 59 0 R >> >>" },
      { number: 27, body: "<< /Type /Annot /Subtype /Link /Rect [50 70 60 80] /AP << /N 7 >> >>" },
      { number: 28, body: "<< /Type /Annot /Subtype /Link /Rect [60 70 70 80] /AP 50 0 R >>" },
      {
        number: 29,
        body: "<< /Type /Annot /Subtype /Widget /Parent 31 0 R /Rect [20 0 30 10] /AS /ChoiceB /AP << /N << /Off 51 0 R /ChoiceB 52 0 R >> >> >>"
      },
      {
        number: 30,
        body: [
          "<< /Fields [31 0 R 32 0 R 33 0 R 999 0 R]",
          "/DR << /Font << /AcroFont << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>",
          "/DA (/AcroFont 9 Tf 0 g) /NeedAppearances true /SigFlags 3 /Q 2 >>"
        ].join(" ")
      },
      {
        number: 31,
        body: "<< /FT /Btn /T (Choices) /V /ChoiceA /DV /Off /Ff 32768 /DA (/AcroFont 7 Tf 0 g) /Q 1 /Kids [15 0 R 16 0 R 29 0 R] >>"
      },
      {
        number: 32,
        body: "<< /FT /Tx /T (Parent) /V (inherited value) /DV (inherited default) /Ff 4096 /DA (/AcroFont 8 Tf 0 g) /Q 0 /Kids [17 0 R] >>"
      },
      { number: 33, body: "<< /FT /Sig /T (Signature) /V 34 0 R /Kids [18 0 R] >>" },
      {
        number: 34,
        body: "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Contents <00> >>"
      },
      {
        number: 40,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 2 2] /Matrix null /Resources null",
          "/Local Do"
        )
      },
      {
        number: 41,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << >> " +
            "/Group << /S /Transparency /I true /K true /CS /DeviceRGB >>",
          "q Q"
        )
      },
      {
        number: 42,
        body: tinyPdfStream("/Type /XObject /Subtype /Form /Resources 7", "unused malformed form")
      },
      {
        number: 50,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [10 20 0 -5] /Matrix [2 0 0 3 4 5] " +
            "/Resources << /Font << >> >> /OC 60 0 R",
          "q Q"
        )
      },
      { number: 51, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", "off") },
      { number: 52, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", "choice b") },
      { number: 53, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", "choice a") },
      { number: 54, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 30 10]", "signature") },
      { number: 55, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 30 10]", "only") },
      { number: 56, body: tinyPdfStream("/Type /XObject /Subtype /Image /BBox [0 0 1 1]", "bad subtype") },
      {
        number: 57,
        body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources 999 0 R", "bad resources")
      },
      {
        number: 58,
        body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Matrix [1 0 0 1 0]", "bad matrix")
      },
      { number: 59, body: tinyPdfStream("/Type /XObject /Subtype /Form /Resources << >>", "missing bbox") },
      { number: 60, body: "<< /Type /OCG /Name (Visible) >>" },
      { number: 61, body: "<< /Type /OCG /Name (Hidden) >>" },
      { number: 62, body: "<< /OCGs [60 0 R 61 0 R] /D << /BaseState /ON /OFF [61 0 R] >> >>" }
    ]
  });
}

function fieldFixture({ widget, field, fields = "[5 0 R]", extraObjects = [] }) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Annots [4 0 R] >>" },
      { number: 4, body: widget },
      { number: 5, body: field },
      { number: 6, body: `<< /Fields ${fields} >>` },
      ...extraObjects
    ]
  });
}

function directAnnotationFixture(annotationArray) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Annots ${annotationArray} >>`
      }
    ]
  });
}

function acroFormFixture(acroFormBody) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 4 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>" },
      { number: 4, body: acroFormBody }
    ]
  });
}

function pdfError(code, reason) {
  return (error) => {
    assert.ok(error instanceof PdfError, `expected PdfError, received ${String(error)}`);
    assert.equal(error.code, code);
    if (reason !== undefined) assert.equal(error.details?.reason, reason);
    return true;
  };
}

function decodeString(value) {
  assert.equal(value?.kind, "string");
  return new TextDecoder().decode(value.bytes);
}

const document = await openNativePdfDocument({ kind: "bytes", bytes: mainFixture() });
try {
  const optionalContent = {
    async resolvePropertyValue(value) {
      const objectNumber = value?.kind === "ref" ? value.objectNumber : -1;
      if (objectNumber === 60) return { index: 0, defaultVisible: true };
      if (objectNumber === 61) return { index: 1, defaultVisible: false };
      return null;
    }
  };
  const cancelled = new AbortController();
  cancelled.abort("fixture cancellation");
  await assert.rejects(
    new NativePdfFormAppearanceRegistry(document).listPageAnnotations(0, cancelled.signal),
    pdfError("aborted")
  );
  const emittedDiagnostics = [];
  const registry = new NativePdfFormAppearanceRegistry(document, {
    optionalContent,
    onDiagnostic: (diagnostic) => emittedDiagnostics.push(diagnostic)
  });

  const acroForm = await registry.getAcroFormMetadata();
  assert(acroForm);
  assert.equal(acroForm.needAppearances, true);
  assert.equal(acroForm.signatureFlags, 3);
  assert.equal(acroForm.quadding, 2);
  assert.equal(acroForm.fieldCount, 4);
  assert.deepEqual(acroForm.fields.slice(0, 3).map((value) => value.objectNumber), [31, 32, 33]);
  assert.equal(acroForm.fields[3].objectNumber, 999, "unused malformed field roots remain lazy");
  assert.equal(decodeString(acroForm.defaultAppearance), "/AcroFont 9 Tf 0 g");
  assert(acroForm.defaultResources instanceof Map);

  const annotations = await registry.listPageAnnotations(0);
  assert.equal(annotations.length, 21);
  assert.deepEqual(annotations.map((annotation) => annotation.annotationIndex), [...annotations.keys()]);
  assert.equal(annotations[0].id, annotations[5].id, "duplicate /Annots entries retain source positions and identity");
  assert.notEqual(annotations[0], annotations[5]);
  assert.deepEqual(annotations[0].rectangle, [20, 10, 40, 30]);
  assert.deepEqual(
    annotations.slice(0, 5).map((annotation) => annotation.visibleInDefaultView),
    [true, false, false, false, true],
    "/Print does not hide an annotation in the default View"
  );
  for (const hidden of annotations.slice(1, 4)) {
    assert.equal(await registry.resolveAnnotationAppearance(hidden), null);
  }

  const link = await registry.resolveAnnotationAppearance(annotations[0]);
  const duplicateLink = await registry.resolveAnnotationAppearance(annotations[5]);
  assert(link && duplicateLink);
  assert.equal(link.normalAppearance.form, duplicateLink.normalAppearance.form);
  assert.equal(link.optionalContentIndex >= 0, true);
  assert.deepEqual(link.normalAppearance.form.bbox, [0, -5, 10, 20]);
  assert.deepEqual(link.normalAppearance.form.matrix, [2, 0, 0, 3, 4, 5]);
  assert.equal(link.normalAppearance.form.resourceOrigin, "local");
  assert.equal(link.normalAppearance.form.optionalContent.objectNumber, 60);
  assert.deepEqual(await registry.decodeFormContent(link.normalAppearance.form), encoder.encode("q Q"));

  const printed = await registry.resolveAnnotationAppearance(annotations[4]);
  assert(printed);

  const radioB = annotations[6];
  const radioA = annotations[7];
  assert.equal(radioB.widget.fieldType, "Btn");
  assert.equal(radioB.widget.fullyQualifiedName, "Choices");
  assert.equal(radioB.widget.fieldFlags, 32768);
  assert.deepEqual(radioB.widget.value, { kind: "name", value: "ChoiceA" });
  assert.equal((await registry.resolveAnnotationAppearance(radioB)).stateName, "Off");
  assert.equal((await registry.resolveAnnotationAppearance(radioA)).stateName, "ChoiceA");
  assert.equal(
    (await registry.resolveAnnotationAppearance(annotations[20])).stateName,
    "ChoiceB",
    "an explicit Widget /AS takes precedence over its inherited field /V"
  );

  const textWidget = annotations[8];
  assert.deepEqual(textWidget.widget.partialNames, ["Parent", "Child"]);
  assert.equal(textWidget.widget.fullyQualifiedName, "Parent.Child");
  assert.equal(decodeString(textWidget.widget.value), "inherited value");
  assert.equal(decodeString(textWidget.widget.defaultValue), "inherited default");
  assert.equal(textWidget.widget.fieldFlags, 4096);
  assert.equal(decodeString(textWidget.widget.defaultAppearance), "/AcroFont 8 Tf 0 g");
  assert.equal(textWidget.widget.quadding, 0);
  const inferred = await registry.resolveAnnotationAppearance(textWidget);
  assert.equal(inferred.stateName, "Only");
  assert.equal(inferred.normalAppearance.form.resourceOrigin, "inherited");
  await registry.resolveAnnotationAppearance(textWidget);
  assert.equal(registry.getDiagnostics().length, 1, "sole-state inference is diagnosed once per annotation");
  assert.equal(emittedDiagnostics.length, 1);
  assert.equal(emittedDiagnostics[0].code, "annotation.appearance-state-inferred");

  const signature = annotations[9];
  assert.equal(signature.widget.fieldType, "Sig");
  assert(signature.widget.value instanceof Map, "signature dictionaries are retained without validation");
  const signatureAppearance = await registry.resolveAnnotationAppearance(signature);
  assert(signatureAppearance);
  assert.equal(signatureAppearance.stateName, undefined);
  assert.deepEqual(
    await registry.decodeFormContent(signatureAppearance.normalAppearance.form),
    encoder.encode("signature")
  );

  await assert.rejects(
    registry.resolveAnnotationAppearance(annotations[10]),
    pdfError("unsupported-content", "appearance-synthesis-not-implemented")
  );
  assert.equal(await registry.resolveAnnotationAppearance(annotations[11]), null, "default-hidden /OC suppresses placement");
  assert.equal((await registry.resolveAnnotationAppearance(annotations[12])).stateName, "Good");
  await assert.rejects(
    registry.resolveAnnotationAppearance(annotations[13]),
    pdfError("unsupported-content", "xobject-not-form")
  );
  await assert.rejects(
    registry.resolveAnnotationAppearance(annotations[14]),
    pdfError("unsupported-content", "annotation-appearance-state-missing")
  );
  for (const index of [15, 16, 17, 18, 19]) {
    await assert.rejects(
      registry.resolveAnnotationAppearance(annotations[index]),
      pdfError("invalid-object")
    );
  }

  const withoutOc = new NativePdfFormAppearanceRegistry(document);
  const withoutOcAnnotations = await withoutOc.listPageAnnotations(0);
  await assert.rejects(
    withoutOc.resolveAnnotationAppearance(withoutOcAnnotations[0]),
    pdfError("unsupported-content", "annotation-optional-content")
  );

  const inheritedForm = await registry.resolvePageForm(0, "Inherited");
  assert.equal(inheritedForm.form.resourceOrigin, "inherited");
  assert.deepEqual(inheritedForm.form.matrix, [1, 0, 0, 1, 0, 0]);
  const nested = await registry.resolveNestedForm(inheritedForm, "Local");
  assert.equal(nested.form.resourceOrigin, "local");
  assert.deepEqual(nested.form.group, {
    subtype: "Transparency",
    isolated: true,
    knockout: true,
    colorSpace: { kind: "name", value: "DeviceRGB" }
  });
  const limited = new NativePdfFormAppearanceRegistry(document, { maxFormDepth: 1 });
  const limitedRoot = await limited.resolvePageForm(0, "Inherited");
  await assert.rejects(
    limited.resolveNestedForm(limitedRoot, "Local"),
    pdfError("resource-limit", "form-depth")
  );
  await assert.rejects(registry.resolvePageForm(0, "UnusedBad"), PdfError);

  const page = document.getPage(0);
  assert.deepEqual(page.cropBox, [20, 30, 180, 100]);
  assert.equal(page.rotation, 90);
  assert.equal(page.userUnit, 2);
  // This is the exact page matrix for the fixture crop under Rotate=90 and
  // UserUnit=2. The placement helper deliberately does not depend on session code.
  const pageMatrix = [0, -2, 2, 0, -60, 360];
  const placement = computeNativePdfAnnotationPlacement(
    annotations[0],
    link.normalAppearance.form,
    pageMatrix
  );
  assertArrayClose(placement.invocationMatrix, [0, -2, 8 / 15, 0, -104 / 3, 328]);
  assert.deepEqual(placement.pageBounds, { minX: -40, minY: 280, maxX: 0, maxY: 320 });
  const completeAppearanceMatrix = multiplyNativePdfMatrices(
    placement.invocationMatrix,
    link.normalAppearance.form.matrix
  );
  assertBoundsClose(
    transformNativePdfRectangle(link.normalAppearance.form.bbox, completeAppearanceMatrix),
    placement.pageBounds
  );
} finally {
  await document.close();
}

await withDocument(
  acroFormFixture("<< /NeedAppearances false >>"),
  async (malformed) => {
    await assert.rejects(
      new NativePdfFormAppearanceRegistry(malformed).getAcroFormMetadata(),
      pdfError("invalid-object")
    );
  }
);

for (const malformedAcroForm of [
  "<< /Fields [] /NeedAppearances 1 >>",
  "<< /Fields [] /SigFlags -1 >>",
  "<< /Fields [] /SigFlags 4294967296 >>",
  "<< /Fields [] /DR 7 >>",
  "<< /Fields [] /DA /Bad >>",
  "<< /Fields [] /Q 3 >>"
]) {
  await withDocument(acroFormFixture(malformedAcroForm), async (malformed) => {
    await assert.rejects(
      new NativePdfFormAppearanceRegistry(malformed).getAcroFormMetadata(),
      pdfError("invalid-object")
    );
  });
}

await withDocument(acroFormFixture("<< /Fields [] /DR null >>"), async (nullDefaults) => {
  assert.equal(
    (await new NativePdfFormAppearanceRegistry(nullDefaults).getAcroFormMetadata()).defaultResources,
    undefined
  );
});

for (const malformedField of [
  "<< /FT (Tx) /Kids [4 0 R] >>",
  "<< /FT /Tx /Ff -1 /Kids [4 0 R] >>",
  "<< /FT /Tx /Ff 4294967296 /Kids [4 0 R] >>",
  "<< /FT /Tx /DA /Bad /Kids [4 0 R] >>",
  "<< /FT /Tx /Q 3 /Kids [4 0 R] >>",
  "<< /FT /Tx /V /Bad /Kids [4 0 R] >>",
  "<< /FT /Btn /DV (Bad) /Kids [4 0 R] >>",
  "<< /FT /Ch /V [(Good) /Bad] /Kids [4 0 R] >>",
  "<< /FT /Sig /V (Bad) /Kids [4 0 R] >>"
]) {
  await withDocument(
    fieldFixture({
      widget: "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [0 0 1 1] >>",
      field: malformedField
    }),
    async (malformed) => {
      await assert.rejects(
        new NativePdfFormAppearanceRegistry(malformed).listPageAnnotations(0),
        pdfError("invalid-object")
      );
    }
  );
}

for (const [encodedName, expectedName] of [
  ["(A\\200B)", "A•B"],
  ["<FFFE4100>", "A"]
]) {
  await withDocument(
    fieldFixture({
      widget: "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [0 0 1 1] >>",
      field: `<< /FT /Tx /T ${encodedName} /Kids [4 0 R] >>`
    }),
    async (encodedField) => {
      const [annotation] = await new NativePdfFormAppearanceRegistry(encodedField).listPageAnnotations(0);
      assert.equal(annotation.widget.fullyQualifiedName, expectedName);
    }
  );
}

for (const malformedName of ["(Bad.Name)", "<FEFF00>", "<FEFFD800>"]) {
  await withDocument(
    fieldFixture({
      widget: "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [0 0 1 1] >>",
      field: `<< /FT /Tx /T ${malformedName} /Kids [4 0 R] >>`
    }),
    async (malformed) => {
      await assert.rejects(
        new NativePdfFormAppearanceRegistry(malformed).listPageAnnotations(0),
        pdfError("invalid-object")
      );
    }
  );
}

await withDocument(
  fieldFixture({
    widget: "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [0 0 1 1] >>",
    field: "<< /FT /Tx /Parent 4 0 R /Kids [4 0 R] >>"
  }),
  async (cyclic) => {
    await assert.rejects(
      new NativePdfFormAppearanceRegistry(cyclic).listPageAnnotations(0),
      pdfError("invalid-object", "field-cycle")
    );
  }
);

await withDocument(
  fieldFixture({
    widget: "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [0 0 1 1] >>",
    field: "<< /FT /Tx /Kids [4 0 R 5 0 R] >>"
  }),
  async (cyclicKids) => {
    await assert.rejects(
      new NativePdfFormAppearanceRegistry(cyclicKids).listPageAnnotations(0),
      pdfError("invalid-object", "field-kids-cycle")
    );
  }
);

await withDocument(
  fieldFixture({
    widget: "<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [0 0 1 1] >>",
    field: "<< /FT /Tx /Kids [7 0 R] >>",
    extraObjects: [{ number: 7, body: "<< /FT /Tx >>" }]
  }),
  async (mismatch) => {
    await assert.rejects(
      new NativePdfFormAppearanceRegistry(mismatch).listPageAnnotations(0),
      pdfError("invalid-object", "field-parent-child-mismatch")
    );
  }
);

await withDocument(
  directAnnotationFixture(
    "[<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] >> " +
      "<< /Type /Annot /Subtype /Link /Rect [1 0 2 1] >>]"
  ),
  async (limitedDocument) => {
    const registry = new NativePdfFormAppearanceRegistry(limitedDocument);
    await assert.rejects(registry.listPageAnnotations(0), pdfError("resource-limit", "annotation-count"));
  },
  { maxCommandsPerPage: 1 }
);

for (const annotationArray of [
  "[<< /Type /Annot /Subtype /Link /Rect [0 0 1] >>]",
  "[<< /Type /XObject /Subtype /Link /Rect [0 0 1 1] >>]",
  "[<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /F -1 >>]",
  "[<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /F 4294967296 >>]",
  "[<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /AS (bad) >>]"
]) {
  await withDocument(directAnnotationFixture(annotationArray), async (malformed) => {
    await assert.rejects(
      new NativePdfFormAppearanceRegistry(malformed).listPageAnnotations(0),
      pdfError("invalid-object")
    );
  });
}

await withDocument(
  directAnnotationFixture("[<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /F 24 >>]"),
  async (viewFlags) => {
    const registry = new NativePdfFormAppearanceRegistry(viewFlags);
    const [annotation] = await registry.listPageAnnotations(0);
    assert.equal(annotation.flags, 24, "NoZoom/NoRotate remain explicit placement metadata");
    assert.equal(annotation.visibleInDefaultView, true);
  }
);

await withDocument(
  directAnnotationFixture("[<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /OC 9 0 R >>]"),
  async (invalidOc) => {
    const registry = new NativePdfFormAppearanceRegistry(invalidOc, {
      optionalContent: { async resolvePropertyValue() { return null; } }
    });
    const [annotation] = await registry.listPageAnnotations(0);
    await assert.rejects(
      registry.resolveAnnotationAppearance(annotation),
      pdfError("invalid-object", "annotation-optional-content-invalid")
    );
  }
);

const geometryAnnotation = { pageIndex: 7, annotationIndex: 3, rectangle: [0, 0, 10, 10] };
assert.throws(
  () => computeNativePdfAnnotationPlacement(
    geometryAnnotation,
    { bbox: [0, 0, 0, 1], matrix: [1, 0, 0, 1, 0, 0] },
    [1, 0, 0, 1, 0, 0]
  ),
  pdfError("invalid-object", "annotation-appearance-empty-bounds")
);
assert.throws(
  () => computeNativePdfAnnotationPlacement(
    geometryAnnotation,
    { bbox: [0, 0, 1, 1], matrix: [1, 0, 0, 1, 0, 0] },
    [1, 0, 0, 1, Number.NaN, 0]
  ),
  pdfError("invalid-object", "annotation-appearance-invalid-geometry")
);
assert.throws(() => multiplyNativePdfMatrices([1, 0, 0, 1, 0], [1, 0, 0, 1, 0, 0]), TypeError);
assert.throws(
  () => multiplyNativePdfMatrices([Number.MAX_VALUE, 0, 0, 1, 0, 0], [2, 0, 0, 1, 0, 0]),
  RangeError
);
assert.throws(
  () => transformNativePdfRectangle([0, 0, 1, 1], [1, 0, 0, 1, Number.POSITIVE_INFINITY, 0]),
  TypeError
);

hooks.deregister();
console.log("native static Form/annotation semantics tests passed");

async function withDocument(pdfBytes, callback, limits) {
  const opened = await openNativePdfDocument({ kind: "bytes", bytes: pdfBytes }, { limits });
  try {
    return await callback(opened);
  } finally {
    await opened.close();
  }
}

function assertBoundsClose(actual, expected) {
  for (const key of ["minX", "minY", "maxX", "maxY"]) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} != ${expected[key]}`);
  }
}

function assertArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 1e-9,
      `${index}: ${actual[index]} != ${expected[index]}`
    );
  }
}
