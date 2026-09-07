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

const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
const { PdfError, openNativePdfDocument } = await import("../src/pdf/nativePdf.ts");

const encoder = new TextEncoder();

function fixture() {
  return writeTinyPdf({
    objects: [
      {
        number: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 9 0 R >>"
      },
      {
        number: 2,
        body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>"
      },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100]",
          "/Resources << /XObject << /RootForm 5 0 R /Alias 5 0 R /Nested 6 0 R /Cycle 13 0 R /Bad 15 0 R >> >>",
          "/Contents 4 0 R /Annots [7 0 R 8 0 R 14 0 R] >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", "") },
      {
        number: 5,
        body: tinyPdfStream(
          [
            "/Type /XObject /Subtype /Form /FormType 1 /BBox [10 20 0 -5]",
            "/Matrix [2 0 0 2 3 4]",
            "/Resources << /XObject << /Nested 6 0 R >> >>",
            "/Group << /S /Transparency /I true /K false /CS /DeviceRGB >>"
          ].join(" "),
          "/Nested Do"
        )
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 2 2]",
          "q Q"
        )
      },
      {
        number: 7,
        body: "<< /Type /Annot /Subtype /Widget /Parent 10 0 R /Rect [20 10 40 30] /AS /On /AP << /N << /Off 11 0 R /On 12 0 R >> >> >>"
      },
      {
        number: 8,
        body: "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /F 2 >>"
      },
      {
        number: 9,
        body: "<< /Fields [10 0 R] /DR << /Font << >> >> /DA (/Helv 10 Tf 0 g) /NeedAppearances false /SigFlags 3 /Q 1 >>"
      },
      {
        number: 10,
        body: "<< /FT /Btn /T (Agree) /V /On /Ff 1 /Kids [7 0 R] >>"
      },
      {
        number: 11,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>",
          "off"
        )
      },
      {
        number: 12,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20]",
          "on"
        )
      },
      {
        number: 13,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /Self 13 0 R >> >>",
          "/Self Do"
        )
      },
      {
        number: 14,
        body: "<< /Type /Annot /Subtype /Link /Rect [50 10 80 20] >>"
      },
      {
        number: 15,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /FormType 2 /BBox [0 0 1 1] /Resources << >>",
          ""
        )
      }
    ]
  });
}

const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture() });

try {
  await testForms(document);
  await testAnnotations(document);
  await testFailures(document);
  console.log("native Form/annotation registry tests passed");
} finally {
  await document.close();
  hooks.deregister();
}

async function testForms(nativeDocument) {
  const registry = new NativePdfFormAppearanceRegistry(nativeDocument);
  const root = await registry.resolvePageForm(0, "/RootForm");
  const alias = await registry.resolvePageForm(0, "Alias");
  assert.equal(root.form, alias.form, "indirect aliases must reuse one Form definition");
  assert.equal(root.depth, 1);
  assert.deepEqual(root.ancestry, ["ref:5:0"]);
  assert.deepEqual(root.form.bbox, [0, -5, 10, 20]);
  assert.deepEqual(root.form.matrix, [2, 0, 0, 2, 3, 4]);
  assert.equal(root.form.resourceOrigin, "local");
  assert.deepEqual(root.form.group, {
    subtype: "Transparency",
    isolated: true,
    knockout: false,
    colorSpace: { kind: "name", value: "DeviceRGB" }
  });
  assert.deepEqual(await registry.decodeFormContent(root.form), encoder.encode("/Nested Do"));
  assert.equal(await registry.decodeFormContent(root.form), await registry.decodeFormContent(alias.form));

  const nested = await registry.resolveNestedForm(root, "Nested");
  assert.equal(nested.depth, 2);
  assert.equal(nested.form.resourceOrigin, "inherited");
  assert.deepEqual(await registry.decodeFormContent(nested.form), encoder.encode("q Q"));

  const depthLimited = new NativePdfFormAppearanceRegistry(nativeDocument, { maxFormDepth: 1 });
  const limitedRoot = await depthLimited.resolvePageForm(0, "RootForm");
  await assert.rejects(
    depthLimited.resolveNestedForm(limitedRoot, "Nested"),
    (error) => error instanceof PdfError && error.code === "resource-limit" &&
      error.details?.reason === "form-depth"
  );
}

async function testAnnotations(nativeDocument) {
  const diagnostics = [];
  const registry = new NativePdfFormAppearanceRegistry(nativeDocument, {
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });
  const acroForm = await registry.getAcroFormMetadata();
  assert(acroForm);
  assert.equal(acroForm.needAppearances, false);
  assert.equal(acroForm.signatureFlags, 3);
  assert.equal(acroForm.fieldCount, 1);
  assert.equal(acroForm.quadding, 1);
  assert(acroForm.defaultResources instanceof Map);

  const annotations = await registry.listPageAnnotations(0);
  assert.equal(annotations.length, 3);
  const [widget, hidden, missing] = annotations;
  assert.equal(widget.subtype, "Widget");
  assert.equal(widget.visibleInDefaultView, true);
  assert.equal(widget.appearanceState, "On");
  assert.equal(widget.widget?.fieldType, "Btn");
  assert.equal(widget.widget?.fullyQualifiedName, "Agree");
  assert.equal(widget.widget?.fieldFlags, 1);
  assert.deepEqual(widget.widget?.value, { kind: "name", value: "On" });

  const appearance = await registry.resolveAnnotationAppearance(widget);
  assert(appearance);
  assert.equal(appearance.stateName, "On");
  assert.equal(appearance.normalAppearance.form.id, "ref:12:0");
  assert.equal(
    appearance.normalAppearance.form.resourceOrigin,
    "inherited",
    "a widget appearance without local resources must inherit AcroForm /DR"
  );
  assert.deepEqual(
    await registry.decodeFormContent(appearance.normalAppearance.form),
    encoder.encode("on")
  );

  assert.equal(hidden.visibleInDefaultView, false);
  assert.equal(await registry.resolveAnnotationAppearance(hidden), null);
  assert.equal(missing.visibleInDefaultView, true);
  assert.equal(diagnostics.length, 0);
}

async function testFailures(nativeDocument) {
  const registry = new NativePdfFormAppearanceRegistry(nativeDocument);
  const cycle = await registry.resolvePageForm(0, "Cycle");
  await assert.rejects(
    registry.resolveNestedForm(cycle, "Self"),
    (error) => error instanceof PdfError && error.code === "unsupported-content" &&
      error.details?.reason === "form-cycle"
  );
  await assert.rejects(
    registry.resolvePageForm(0, "Bad"),
    (error) => error instanceof PdfError && error.code === "unsupported-content" &&
      error.details?.reason === "unsupported-form-type"
  );
  const annotations = await registry.listPageAnnotations(0);
  await assert.rejects(
    registry.resolveAnnotationAppearance(annotations[2]),
    (error) => error instanceof PdfError && error.code === "unsupported-content" &&
      error.details?.reason === "appearance-synthesis-not-implemented"
  );
}

