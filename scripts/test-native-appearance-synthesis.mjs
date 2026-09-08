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
  NativePdfAppearanceSynthesizer,
  PdfError,
  openNativePdfDocument,
  resolveNativePdfAnnotationAppearanceWithSynthesis
} = await import("../src/pdf/nativePdf.ts");
const {
  NativePdfFormAppearanceRegistry
} = await import("../src/pdf/nativeForms.ts");
const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
const decoder = new TextDecoder();
const NOOP_TEXT_SINK = Object.freeze({ applyOperator() {} });
const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture() });

try {
  const emitted = [];
  const registry = new NativePdfFormAppearanceRegistry(document);
  const synthesizer = new NativePdfAppearanceSynthesizer(document, {
    onDiagnostic: (diagnostic) => emitted.push(diagnostic)
  });
  const annotations = await registry.listPageAnnotations(0);
  assert.equal(annotations.length, 16);

  const text = await synthesizer.synthesize(annotations[0]);
  assert(text?.synthesized);
  assert.equal(text.optionalContentIndex, -1);
  assert.deepEqual(text.normalAppearance.form.bbox, [0, 0, 120, 24]);
  assert.deepEqual(text.normalAppearance.form.matrix, [1, 0, 0, 1, 0, 0]);
  assert.equal(text.normalAppearance.form.resourceOrigin, "inherited");
  assert.equal(text.normalAppearance.form.resources, annotations[0].widget.acroForm.defaultResources);
  assert.equal(text.formResources.size, 0);
  assert.equal(synthesizer.ownsForm(text.normalAppearance.form), true);
  assert.equal(synthesizer.getDecodedFormContent(text.normalAppearance.form), text.decodedContent);
  const textContent = decoder.decode(text.decodedContent);
  assert.match(textContent, /0 0 1 RG/);
  assert.match(textContent, /BT\n\/Helv [0-9.]+ Tf\n0 g/);
  assert.match(textContent, /<48656C6C6F> Tj/);
  assert.match(textContent, / re W n/);
  assert.equal(await synthesizer.synthesize(annotations[0]), text, "completed synthesis is cached");
  assert.equal(emitted.length, 1, "a cached appearance emits one diagnostic");

  const multiline = await synthesizer.synthesize(annotations[1]);
  const multilineContent = decoder.decode(multiline.decodedContent);
  assert.match(multilineContent, /\[2 1\] 0 d/);
  assert.ok((multilineContent.match(/ Tj/g) ?? []).length >= 2, "multiline text emits separate positioned lines");

  const checkbox = await synthesizer.synthesize(annotations[2]);
  const checkboxContent = decoder.decode(checkbox.decodedContent);
  assert.equal(checkbox.stateName, "Yes");
  assert.doesNotMatch(checkboxContent, / Tf/);
  assert.match(checkboxContent, / m .* l .* l S/);

  const radio = await synthesizer.synthesize(annotations[3]);
  assert.equal(radio.stateName, "Choice");
  assert.match(decoder.decode(radio.decodedContent), / c .* c .* c .* c h f/);

  const push = await synthesizer.synthesize(annotations[4]);
  assert.deepEqual(push.normalAppearance.form.bbox, [0, 0, 50, 30]);
  assert.deepEqual(push.normalAppearance.form.matrix, [0, 1, -1, 0, 30, 0]);
  assert.match(decoder.decode(push.decodedContent), /<476F> Tj/);

  const combo = await synthesizer.synthesize(annotations[13]);
  assert.match(decoder.decode(combo.decodedContent), /<477265656E> Tj/);

  const list = await synthesizer.synthesize(annotations[14]);
  const listContent = decoder.decode(list.decodedContent);
  assert.equal((listContent.match(/0\.153 0\.376 0\.616 rg/g) ?? []).length, 2);
  assert.match(listContent, /<54776F> Tj/);
  assert.match(listContent, /<466F7572> Tj/);

  const password = await synthesizer.synthesize(annotations[5]);
  assert.match(decoder.decode(password.decodedContent), /<2A2A2A2A2A2A> Tj/);
  assert.doesNotMatch(decoder.decode(password.decodedContent), /736563726574/i);

  const comb = await synthesizer.synthesize(annotations[15]);
  const combContent = decoder.decode(comb.decodedContent);
  assert.equal((combContent.match(/ Tj/g) ?? []).length, 3);
  assert.match(combContent, /<31> Tj/);
  assert.match(combContent, /<33> Tj/);

  for (const appearance of [text, multiline, checkbox, radio, push, combo, list, password, comb]) {
    const [left, bottom, right, top] = appearance.normalAppearance.form.bbox;
    await compileDensePdfContent(appearance.decodedContent, {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: { minX: left, minY: bottom, maxX: right, maxY: top },
      preservePaintOrder: true,
      enableSegmentMerge: false,
      enableInvisibleCull: false,
      textOperatorSink: NOOP_TEXT_SINK
    });
  }

  const resolved = await resolveNativePdfAnnotationAppearanceWithSynthesis(
    registry,
    synthesizer,
    annotations[0]
  );
  assert.equal(resolved, text, "the integration hook synthesizes only the registry's explicit missing case");

  const sourceBacked = await resolveNativePdfAnnotationAppearanceWithSynthesis(
    registry,
    synthesizer,
    annotations[10]
  );
  assert(sourceBacked);
  assert.equal(synthesizer.ownsForm(sourceBacked.normalAppearance.form), false);
  assert.equal(synthesizer.getDecodedFormContent(sourceBacked.normalAppearance.form), null);

  await assert.rejects(
    synthesizer.synthesize(annotations[6]),
    hasPdfError("unsupported-font", "appearance-font-missing")
  );
  await assert.rejects(
    synthesizer.synthesize(annotations[7]),
    hasPdfError("unsupported-content", "appearance-radio-state-ambiguous")
  );
  await assert.rejects(
    synthesizer.synthesize(annotations[8]),
    hasPdfError("unsupported-content", "appearance-button-icon-unsupported")
  );
  await assert.rejects(
    synthesizer.synthesize(annotations[9]),
    hasPdfError("unsupported-content", "appearance-signature-unsupported")
  );
  await assert.rejects(
    synthesizer.synthesize(annotations[10]),
    hasPdfError("unsupported-content", "appearance-normal-present")
  );
  await assert.rejects(
    synthesizer.synthesize(annotations[11]),
    hasPdfError("unsupported-content", "appearance-da-operator-unsupported")
  );
  await assert.rejects(
    synthesizer.synthesize(annotations[12]),
    hasPdfError("unsupported-content", "appearance-border-style-unsupported")
  );

  const controller = new AbortController();
  controller.abort("fixture cancellation");
  await assert.rejects(
    synthesizer.synthesize(annotations[1], controller.signal),
    hasPdfError("aborted")
  );

  assert.equal(synthesizer.getDiagnostics().length, 9);
  assert.ok(synthesizer.getDiagnostics().every((diagnostic) =>
    diagnostic.code === "annotation.appearance-synthesized"
  ));
  await testLinkAppearanceSynthesis();
  await testSquareAppearanceSynthesis();
} finally {
  await document.close();
  hooks.deregister();
}

console.log("native annotation appearance synthesis tests passed");

async function testLinkAppearanceSynthesis() {
  const linkDocument = await openNativePdfDocument({
    kind: "bytes",
    bytes: linkFixture()
  });
  try {
    const emitted = [];
    const registry = new NativePdfFormAppearanceRegistry(linkDocument);
    const synthesizer = new NativePdfAppearanceSynthesizer(linkDocument, {
      onDiagnostic: (diagnostic) => emitted.push(diagnostic)
    });
    const annotations = await registry.listPageAnnotations(0);
    assert.equal(annotations.length, 8);

    assert.equal(
      await resolveNativePdfAnnotationAppearanceWithSynthesis(
        registry,
        synthesizer,
        annotations[0]
      ),
      null,
      "an explicit zero-width Link border is semantically non-painting"
    );

    const roundedDashed = await resolveNativePdfAnnotationAppearanceWithSynthesis(
      registry,
      synthesizer,
      annotations[1]
    );
    assert(roundedDashed?.synthesized);
    const roundedContent = decoder.decode(roundedDashed.decodedContent);
    assert.match(roundedContent, /1 0 0 RG/);
    assert.match(roundedContent, /2 w/);
    assert.match(roundedContent, /\[3 2\] 0 d/);
    assert.match(roundedContent, / c .* c .* c .* c h S/);

    const underline = await resolveNativePdfAnnotationAppearanceWithSynthesis(
      registry,
      synthesizer,
      annotations[2]
    );
    assert(underline?.synthesized);
    const underlineContent = decoder.decode(underline.decodedContent);
    assert.match(underlineContent, /0\.5 G/);
    assert.match(underlineContent, /3 w/);
    assert.match(underlineContent, /1\.5 1\.5 m 38\.5 1\.5 l S/);
    assert.doesNotMatch(underlineContent, / re S/);

    assert.equal(
      await resolveNativePdfAnnotationAppearanceWithSynthesis(
        registry,
        synthesizer,
        annotations[3]
      ),
      null,
      "an empty Link /C is transparent and contributes no display command"
    );

    const defaults = await resolveNativePdfAnnotationAppearanceWithSynthesis(
      registry,
      synthesizer,
      annotations[4]
    );
    assert(defaults?.synthesized);
    assert.match(decoder.decode(defaults.decodedContent), /0 G\n1 w/);

    for (const appearance of [roundedDashed, underline, defaults]) {
      const [left, bottom, right, top] = appearance.normalAppearance.form.bbox;
      await compileDensePdfContent(appearance.decodedContent, {
        pageMatrix: [1, 0, 0, 1, 0, 0],
        pageBounds: { minX: left, minY: bottom, maxX: right, maxY: top },
        preservePaintOrder: true,
        enableSegmentMerge: false,
        enableInvisibleCull: false,
        textOperatorSink: NOOP_TEXT_SINK
      });
    }

    await assert.rejects(
      resolveNativePdfAnnotationAppearanceWithSynthesis(
        registry,
        synthesizer,
        annotations[5]
      ),
      hasPdfError("unsupported-content", "appearance-border-style-unsupported")
    );
    await assert.rejects(
      resolveNativePdfAnnotationAppearanceWithSynthesis(
        registry,
        synthesizer,
        annotations[6]
      ),
      hasPdfError("unsupported-content", "appearance-link-opacity-unsupported")
    );
    assert.equal(
      await resolveNativePdfAnnotationAppearanceWithSynthesis(
        registry,
        synthesizer,
        annotations[7]
      ),
      null,
      "a zero-width /BS takes precedence over otherwise painting or unsupported border entries"
    );

    assert.equal(emitted.length, 3);
    assert.ok(emitted.every((diagnostic) =>
      diagnostic.code === "annotation.appearance-synthesized" &&
      diagnostic.details?.subtype === "Link"
    ));
  } finally {
    await linkDocument.close();
  }
}

function linkFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Resources << >>",
          "/Annots [10 0 R 11 0 R 12 0 R 13 0 R 14 0 R 15 0 R 16 0 R 17 0 R] >>"
        ].join(" ")
      },
      { number: 10, body: "<< /Type /Annot /Subtype /Link /Rect [0 0 40 20] /Border [0 0 0] >>" },
      { number: 11, body: "<< /Type /Annot /Subtype /Link /Rect [45 0 85 20] /Border [4 5 2 [3 2]] /C [1 0 0] >>" },
      {
        number: 12,
        body: "<< /Type /Annot /Subtype /Link /Rect [90 0 130 20] /Border [0 0 0] /BS << /Type /Border /W 3 /S /U >> /C [0.5] >>"
      },
      { number: 13, body: "<< /Type /Annot /Subtype /Link /Rect [135 0 175 20] /Border [0 0 1] /C [] >>" },
      { number: 14, body: "<< /Type /Annot /Subtype /Link /Rect [180 0 220 20] >>" },
      { number: 15, body: "<< /Type /Annot /Subtype /Link /Rect [0 30 40 50] /BS << /W 1 /S /B >> /C [0 0 1] >>" },
      { number: 16, body: "<< /Type /Annot /Subtype /Link /Rect [45 30 85 50] /Border [0 0 1] /C [0 0 1] /CA 0.5 >>" },
      { number: 17, body: "<< /Type /Annot /Subtype /Link /Rect [90 30 130 50] /Border [0 0 2] /BS << /W 0 /S /B >> /C [2] >>" }
    ]
  });
}

function fixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 40 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << >>",
          "/Annots [10 0 R 11 0 R 12 0 R 13 0 R 14 0 R 15 0 R 16 0 R",
          "17 0 R 18 0 R 19 0 R 20 0 R 21 0 R 22 0 R 23 0 R 24 0 R 25 0 R] >>"
        ].join(" ")
      },
      {
        number: 10,
        body: "<< /Type /Annot /Subtype /Widget /Parent 50 0 R /Rect [0 0 120 24] /MK << /BG [1] /BC [0 0 1] >> /BS << /W 1 /S /S >> >>"
      },
      {
        number: 11,
        body: "<< /Type /Annot /Subtype /Widget /Parent 51 0 R /Rect [0 30 80 70] /MK << /BG [0.9] /BC [0] >> /Border [0 0 1 [2 1]] >>"
      },
      {
        number: 12,
        body: "<< /Type /Annot /Subtype /Widget /Parent 52 0 R /Rect [130 0 150 20] /AS /Yes /MK << /CA (4) /BG [1] /BC [0] >> /Border [0 0 1] >>"
      },
      {
        number: 13,
        body: "<< /Type /Annot /Subtype /Widget /Parent 53 0 R /Rect [160 0 180 20] /AS /Choice /MK << /CA (l) /BG [1] /BC [0] >> /BS << /W 1 /S /S >> >>"
      },
      {
        number: 14,
        body: "<< /Type /Annot /Subtype /Widget /Parent 54 0 R /Rect [190 0 220 50] /MK << /R 90 /CA (Go) /BG [0.5 0.7 1] /BC [0] >> /BS << /W 1 /S /S >> >>"
      },
      { number: 15, body: "<< /Type /Annot /Subtype /Widget /Parent 55 0 R /Rect [0 80 100 100] >>" },
      { number: 16, body: "<< /Type /Annot /Subtype /Widget /Parent 56 0 R /Rect [0 110 100 130] >>" },
      { number: 17, body: "<< /Type /Annot /Subtype /Widget /Parent 57 0 R /Rect [110 80 130 100] >>" },
      { number: 18, body: "<< /Type /Annot /Subtype /Widget /Parent 58 0 R /Rect [140 80 200 105] /MK << /CA (Icon) /I 99 0 R >> >>" },
      { number: 19, body: "<< /Type /Annot /Subtype /Widget /Parent 59 0 R /Rect [0 140 100 160] >>" },
      { number: 20, body: "<< /Type /Annot /Subtype /Widget /Parent 60 0 R /Rect [0 170 20 190] /AP << /N 61 0 R >> >>" },
      { number: 21, body: "<< /Type /Annot /Subtype /Widget /Parent 62 0 R /Rect [0 200 100 220] >>" },
      { number: 22, body: "<< /Type /Annot /Subtype /Widget /Parent 63 0 R /Rect [0 230 100 250] /MK << /BC [0] >> /BS << /W 1 /S /B >> >>" },
      { number: 23, body: "<< /Type /Annot /Subtype /Widget /Parent 64 0 R /Rect [230 0 330 24] /MK << /BG [1] /BC [0] >> >>" },
      { number: 24, body: "<< /Type /Annot /Subtype /Widget /Parent 65 0 R /Rect [230 30 330 90] /MK << /BG [1] /BC [0] >> >>" },
      { number: 25, body: "<< /Type /Annot /Subtype /Widget /Parent 66 0 R /Rect [230 100 330 124] /MK << /BG [1] /BC [0] >> >>" },
      {
        number: 40,
        body: "<< /Fields [50 0 R 51 0 R 52 0 R 53 0 R 54 0 R 55 0 R 56 0 R 57 0 R 58 0 R 59 0 R 60 0 R 62 0 R 63 0 R 64 0 R 65 0 R 66 0 R] /DR << /Font << /Helv 41 0 R >> >> /DA (/Helv 0 Tf 0 g) /Q 0 >>"
      },
      {
        number: 41,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FontDescriptor 42 0 R >>"
      },
      {
        number: 42,
        body: "<< /Type /FontDescriptor /FontName /Helvetica /Flags 32 /Ascent 800 /Descent -200 /CapHeight 700 /ItalicAngle 0 /StemV 80 /MissingWidth 500 >>"
      },
      { number: 50, body: "<< /FT /Tx /T (Name) /V (Hello) /Q 1 /Kids [10 0 R] >>" },
      { number: 51, body: "<< /FT /Tx /T (Notes) /V (One two three\nFour five) /Ff 4096 /DA (/Helv 8 Tf 0 g) /Kids [11 0 R] >>" },
      { number: 52, body: "<< /FT /Btn /T (Check) /V /Yes /Kids [12 0 R] >>" },
      { number: 53, body: "<< /FT /Btn /T (Radio) /V /Choice /Ff 32768 /Kids [13 0 R] >>" },
      { number: 54, body: "<< /FT /Btn /T (Push) /Ff 65536 /DA (/Helv 10 Tf 1 1 1 rg) /Kids [14 0 R] >>" },
      { number: 55, body: "<< /FT /Tx /T (Password) /V (secret) /Ff 8192 /Kids [15 0 R] >>" },
      { number: 56, body: "<< /FT /Tx /T (MissingFont) /V (text) /DA (/Nope 10 Tf 0 g) /Kids [16 0 R] >>" },
      { number: 57, body: "<< /FT /Btn /T (AmbiguousRadio) /V /Choice /Ff 32768 /Kids [17 0 R] >>" },
      { number: 58, body: "<< /FT /Btn /T (IconPush) /Ff 65536 /Kids [18 0 R] >>" },
      { number: 59, body: "<< /FT /Sig /T (Signature) /Kids [19 0 R] >>" },
      { number: 60, body: "<< /FT /Btn /T (Existing) /Kids [20 0 R] >>" },
      {
        number: 61,
        body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "0 0 20 20 re f")
      },
      { number: 62, body: "<< /FT /Tx /T (BadDA) /V (text) /DA (/Helv 10 Tf 2 Tr) /Kids [21 0 R] >>" },
      { number: 63, body: "<< /FT /Tx /T (BadBorder) /V (text) /Kids [22 0 R] >>" },
      { number: 64, body: "<< /FT /Ch /T (Combo) /Ff 131072 /Opt [(Red) [(g) (Green)]] /V (g) /Kids [23 0 R] >>" },
      { number: 65, body: "<< /FT /Ch /T (List) /Ff 2097152 /Opt [(One) (Two) (Three) (Four)] /V [(Two) (Four)] /I [1 3] /TI 1 /DA (/Helv 9 Tf 0 g) /Kids [24 0 R] >>" },
      { number: 66, body: "<< /FT /Tx /T (Comb) /Ff 16777216 /MaxLen 4 /V (123) /Q 2 /Kids [25 0 R] >>" },
      { number: 99, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 1 1]", "") }
    ]
  });
}

async function testSquareAppearanceSynthesis() {
  const squareDocument = await openNativePdfDocument({
    kind: "bytes",
    bytes: squareFixture()
  });
  try {
    const registry = new NativePdfFormAppearanceRegistry(squareDocument);
    const synthesizer = new NativePdfAppearanceSynthesizer(squareDocument);
    const annotations = await registry.listPageAnnotations(0);
    assert.equal(annotations.length, 6);
    const resolve = (annotation) =>
      resolveNativePdfAnnotationAppearanceWithSynthesis(registry, synthesizer, annotation);

    // A zero-width border with no interior colour paints nothing at all. Such
    // an annotation must not fail the page: real drawings carry these as pure
    // metadata markers.
    assert.equal(await resolve(annotations[0]), null);

    // /C is absent, so the border takes the interoperable black default, and
    // the stroked rectangle is inset by half the border width.
    const defaulted = await resolve(annotations[1]);
    assert(defaulted?.synthesized);
    const defaultedContent = decoder.decode(defaulted.decodedContent);
    assert.match(defaultedContent, /0 G/);
    assert.match(defaultedContent, /2 w/);
    assert.match(defaultedContent, /1 1 38 18 re S/);

    // An interior colour paints even when the border width is zero.
    const filledOnly = await resolve(annotations[2]);
    assert(filledOnly?.synthesized);
    const filledOnlyContent = decoder.decode(filledOnly.decodedContent);
    assert.match(filledOnlyContent, /1 0 0 rg/);
    assert.match(filledOnlyContent, /0 0 40 20 re f/);
    assert.doesNotMatch(filledOnlyContent, / S/);

    // Border and interior together fill and stroke the same inset rectangle.
    const both = await resolve(annotations[3]);
    assert(both?.synthesized);
    const bothContent = decoder.decode(both.decodedContent);
    assert.match(bothContent, /1 1 0 rg/);
    assert.match(bothContent, /0 0 1 RG/);
    assert.match(bothContent, /1 1 38 18 re B/);

    // An empty /C is transparent, so the interior is painted on its own. The
    // declared border width still positions the path: colour decides what is
    // painted, width decides where the path runs, so the fill stays inset.
    const transparentBorder = await resolve(annotations[4]);
    assert(transparentBorder?.synthesized);
    const transparentContent = decoder.decode(transparentBorder.decodedContent);
    assert.match(transparentContent, /0 1 0 rg/);
    assert.match(transparentContent, /1 1 38 18 re f/);
    assert.doesNotMatch(transparentContent, / re B/);

    // A fully transparent annotation contributes no display command.
    assert.equal(await resolve(annotations[5]), null);
  } finally {
    await squareDocument.close();
  }
}

function squareFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Resources << >>",
          "/Annots [10 0 R 11 0 R 12 0 R 13 0 R 14 0 R 15 0 R] >>"
        ].join(" ")
      },
      { number: 10, body: "<< /Type /Annot /Subtype /Square /Rect [0 0 40 20] /Border [0 0 0] >>" },
      { number: 11, body: "<< /Type /Annot /Subtype /Square /Rect [45 0 85 20] /Border [0 0 2] >>" },
      { number: 12, body: "<< /Type /Annot /Subtype /Square /Rect [90 0 130 20] /Border [0 0 0] /IC [1 0 0] >>" },
      {
        number: 13,
        body: "<< /Type /Annot /Subtype /Square /Rect [135 0 175 20] /Border [0 0 2] /C [0 0 1] /IC [1 1 0] >>"
      },
      { number: 14, body: "<< /Type /Annot /Subtype /Square /Rect [180 0 220 20] /Border [0 0 2] /C [] /IC [0 1 0] >>" },
      { number: 15, body: "<< /Type /Annot /Subtype /Square /Rect [0 30 40 50] /Border [0 0 2] /C [0 0 1] /CA 0 >>" }
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
