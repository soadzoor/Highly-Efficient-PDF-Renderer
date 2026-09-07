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
  const [{ openPdf }, { validateHeprPageData }] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentDataValidation.ts")
  ]);

  const pageContent = `
/Artifact BMC
0 0 10 10 re f
/OC /Hidden BDC
1 0 0 rg 20 0 10 10 re f
BT /F1 10 Tf 3 Tr 1 0 0 1 5 20 Tm (HIDDEN) Tj ET
EMC
/OC /Visible BDC
0 1 0 rg 30 0 10 10 re f
BT /F1 10 Tf 10 Tc 3 Tr 1 0 0 1 5 40 Tm (A) Tj
/OC /Hidden BDC
(XX) Tj
EMC
(B) Tj ET
EMC
/Span /Meta BDC
40 0 10 10 re f
EMC
EMC
/OC /Hidden DP
/FmVisible Do
/FmHidden Do
`;

  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 10 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]",
          "/Resources <<",
          "/Font << /F1 5 0 R >>",
          "/Properties << /Visible 11 0 R /Hidden 12 0 R /Meta 13 0 R >>",
          "/XObject << /FmVisible 30 0 R /FmHidden 31 0 R >>",
          ">>",
          "/Annots [20 0 R 21 0 R] /Contents 4 0 R >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", pageContent) },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
      },
      { number: 10, body: "<< /OCGs [11 0 R 12 0 R] /D << /BaseState /ON /OFF [12 0 R] >> >>" },
      { number: 11, body: "<< /Type /OCG /Name (Visible Layer) >>" },
      { number: 12, body: "<< /Type /OCG /Name (Hidden Layer) >>" },
      { number: 13, body: "<< /MCID 7 >>" },
      {
        number: 20,
        body: "<< /Type /Annot /Subtype /Stamp /Rect [0 0 10 10] /OC 12 0 R >>"
      },
      {
        number: 21,
        body: "<< /Type /Annot /Subtype /Stamp /Rect [70 70 90 90] /OC 11 0 R /AP << /N 22 0 R >> >>"
      },
      {
        number: 22,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >>",
          "0 0 10 10 re f"
        )
      },
      {
        number: 30,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] /OC 11 0 R /Resources << /Properties << /Hidden 12 0 R >> >>",
          "/OC /Hidden BDC 0 0 10 10 re f EMC 0 0 20 20 re S"
        )
      },
      {
        number: 31,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] /OC 12 0 R /Resources << >>",
          "thisOperatorMustNeverBeCompiled"
        )
      }
    ]
  });

  const progressStages = [];
  const session = await openPdf(
    { kind: "bytes", bytes, label: "optional-content-session.pdf" },
    { onProgress: (progress) => progressStages.push(progress.stage) }
  );
  try {
    assert.deepEqual(
      progressStages.slice(0, 4),
      ["source-read", "xref", "catalog", "page"],
      "document-open progress follows dependency order"
    );
    const page = await session.compilePage(0);
    validateHeprPageData(page);

    assert.deepEqual(page.stores.optionalContent.names, ["Visible Layer", "Hidden Layer"]);
    assert.deepEqual([...page.stores.optionalContent.defaultVisible], [1, 0]);
    assert.ok(
      page.diagnostics.every((diagnostic) => diagnostic.code !== "optional-content.hidden"),
      "session diagnostics remain document-scoped rather than duplicated on the page"
    );
    assert.ok(session.getDiagnostics().some((diagnostic) =>
      diagnostic.code === "optional-content.hidden"
    ));

    assert.equal(page.textIndex.text, "AB", "hidden text is absent from the text index");
    assert.equal(page.stores.glyphs.glyphIds.length, 2, "hidden glyphs are not retained");
    const [firstTransform, secondTransform] = page.stores.glyphs.transformIndices;
    const firstX = page.stores.transforms.values[firstTransform * 6 + 4];
    const secondX = page.stores.transforms.values[secondTransform * 6 + 4];
    assert.ok(
      secondX - firstX > 15,
      `hidden glyph advances still update the live PDF text position (${secondX - firstX})`
    );

    assert.deepEqual(
      page.stores.markedContent.tags,
      ["Artifact", "OC", "OC", "OC", "Span", "OC"]
    );
    assert.deepEqual(
      page.stores.markedContent.propertyNames,
      [null, "Hidden", "Visible", "Hidden", "Meta", "Hidden"]
    );
    assert.deepEqual([...page.stores.markedContent.mcids], [-1, -1, -1, -1, 7, -1]);
    assert.deepEqual([...page.stores.markedContent.parentIndices], [-1, 0, 0, 2, 0, -1]);

    const rootCommands = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands;
    assert.equal(rootCommands.length, 7);
    assert.ok(rootCommands.every((command) => command.optionalContentIndex !== 1));
    assert.deepEqual(
      rootCommands.slice(0, 5).map((command) => command.markedContentIndex),
      [0, 2, 2, 2, 4]
    );
    assert.deepEqual(
      rootCommands.slice(0, 5).map((command) => command.optionalContentIndex),
      [-1, 0, 0, 0, -1]
    );

    const invocations = rootCommands.filter((command) => command.kind === "invoke-program");
    assert.equal(invocations.length, 2, "hidden Form and annotation appearances emit no invocation");
    assert.ok(invocations.every((command) => command.optionalContentIndex === 0));
    assert.ok(page.displayProgram.programs.every((program) =>
      program.commands.every((command) => command.optionalContentIndex !== 1)
    ));

    await assert.rejects(
      session.compilePage(0, { limits: { maxCommandsPerPage: 1 } }),
      (error) => {
        assert.equal(error?.code, "resource-limit");
        assert.match(error.message, /Marked-content node count exceeds limit 1/);
        return true;
      },
      "marked-content ceilings retain the public resource-limit error code"
    );
  } finally {
    await session.close();
  }

  const unresolvedMetadataSession = await openPdf({
    kind: "bytes",
    bytes: unresolvedFormPropertyFixture("Figure"),
    label: "unresolved-non-oc-form-property.pdf"
  });
  try {
    const page = await unresolvedMetadataSession.compilePage(0);
    validateHeprPageData(page);
    const markedIndex = page.stores.markedContent.propertyNames.indexOf("R62");
    assert.notEqual(markedIndex, -1);
    assert.equal(page.stores.markedContent.tags[markedIndex], "Figure");
    assert.equal(page.stores.markedContent.mcids[markedIndex], -1);
    assert.ok(page.displayProgram.programs.some((program) =>
      program.commands.some((command) =>
        command.markedContentIndex === markedIndex && command.optionalContentIndex === -1
      )
    ), "unresolved structural metadata must not hide its visible paint");
    const diagnostics = unresolvedMetadataSession.getDiagnostics().filter((diagnostic) =>
      diagnostic.code === "marked-content.unresolved-property"
    );
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0].details, {
      propertyName: "R62",
      reason: "properties-missing",
      defaultVisible: true
    });
  } finally {
    await unresolvedMetadataSession.close();
  }

  const unresolvedOcSession = await openPdf({
    kind: "bytes",
    bytes: unresolvedFormPropertyFixture("OC"),
    label: "unresolved-oc-form-property.pdf"
  });
  try {
    await assert.rejects(
      unresolvedOcSession.compilePage(0),
      (error) => error?.code === "invalid-object" && /resource dictionary has none/.test(error.message),
      "an unresolved optional-content membership must fail instead of painting"
    );
  } finally {
    await unresolvedOcSession.close();
  }

  console.log("PDF optional-content session integration tests passed.");
} finally {
  hooks.deregister();
}

function unresolvedFormPropertyFixture(tag) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20]",
          "/Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", "/Fm Do") },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /ExtGState << /R9 6 0 R >> >>",
          `/${tag} /R62 BDC /R9 gs 0 0 10 10 re f EMC`
        )
      },
      { number: 6, body: "<< /Type /ExtGState /CA 1 /ca 1 >>" }
    ]
  });
}
