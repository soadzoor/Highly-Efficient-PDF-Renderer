import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const bytes = writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm 14 0 R /OCProperties << /OCGs [10 0 R 11 0 R] /D << /Order [10 0 R 11 0 R] /ON [10 0 R 11 0 R] >> >> >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 60] /Resources << >> /Contents 4 0 R /Annots [5 0 R 6 0 R] >>",
    tinyPdfStream("", ""),
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (First) /V (A) /Rect [10 10 50 30] /F 4 /AP << /N 7 0 R >> >>",
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Second) /V (A) /Rect [60 10 100 30] /F 4 /OC 10 0 R /AP << /N 7 0 R >> >>",
    tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << /XObject << /Original 8 0 R >> /Properties << /Nested 11 0 R >> >>", "/OC /Nested BDC q 1 0 0 1 0 0 cm /Original Do Q EMC"),
    tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << /Font << /F1 9 0 R >> >>", "BT /F1 12 Tf 2 2 Td (A) Tj ET"),
    "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 800] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /A 12 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [600] /Resources << >> /ToUnicode 13 0 R >>",
    "<< /Type /OCG /Name (Parent) >>",
    "<< /Type /OCG /Name (Nested) >>",
    tinyPdfStream("", "600 0 0 0 600 800 d1 0 0 600 800 re f"),
    tinyPdfStream("", "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /A def /CMapType 2 def 1 begincodespacerange <00> <ff> endcodespacerange 1 beginbfchar <41> <0041> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end"),
    "<< /Fields [5 0 R 6 0 R] /DR << /Font << /F1 9 0 R >> >> /DA (/F1 12 Tf 0 g) >>"
  ].map((body, index) => ({ number: index + 1, body })) });
  const parser = await openPdf({ kind: "bytes", bytes });
  try {
    const scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true, retainOptionalContent: true });
    const text = scene.textIndex.pages[0], characters = [...text.text].flatMap((character, index) => character === "A" ? [index] : []);
    assert.equal(characters.length, 2, "each invocation of the shared appearance contributes its text");
    assert(characters.every(index => text.charInstance[index] <= -2), "Type3 text exercises retained fallback quads");
    const catalog = scene.optionalContent;
    const groups = new Map(catalog.groups.map(group => [group.id, group]));
    const conditions = index => {
      const entry = catalog.conditions[index];
      return entry.kind === "group" ? [groups.get(entry.groupId)] : entry.kind === "and" || entry.kind === "or"
        ? entry.operands.flatMap(conditions) : entry.kind === "not" ? conditions(entry.operand) : [];
    };
    const fields = ["First", "Second"].map(name => scene.annotations.find(annotation => annotation.field?.name === name));
    for (let occurrence = 0; occurrence < characters.length; occurrence++) {
      const condition = text.optionalContent[characters[occurrence]];
      assert(condition >= 0, "search fallback retains appearance ownership");
      const memberships = conditions(condition);
      assert(memberships.some(group => group.annotationId === fields[occurrence].id), "shared programs retain each invocation's distinct widget identity");
      assert(!memberships.some(group => group.annotationId === fields[1 - occurrence].id), "other invocations do not leak their widget identity");
      assert(memberships.some(group => group.name === "Nested"), "nested Form layer membership reaches fallback text");
      assert.equal(memberships.some(group => group.name === "Parent"), occurrence === 1, "ancestor annotation layer membership is preserved independently");
    }
  } finally { await parser.close(); }
  console.log("Retained annotation text: shared Type3 appearances keep per-invocation widget ownership and ancestor/nested layers on fallback quads.");
} finally { hooks.deregister(); }
