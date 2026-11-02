import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { editorTextEditingFamily, editorTextEditingSourceFontId, editorTextEditingDescriptors } = await import("../src/editorTextEditingMetrics.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { layoutEditorText } = await import("../src/editorText.ts");
  assert.deepEqual(editorTextEditingDescriptors(), { ascentOverride: "96%", descentOverride: "24%", lineGapOverride: "0%" });
  for (const id of ["font-a", "font-with:colon", "font-line-1.2", "font_002e", "font.\"quoted\"", "font--hyphen", "Árvíztűrő 😀"]) for (const height of [0.75, 1.2, 1.3333333333333333, 2, 1e6, 1e-7, 1e21]) {
    const family = editorTextEditingFamily(id, height);
    assert.match(family, /^[a-zA-Z][a-zA-Z0-9_-]*$/, "editing families are valid unquoted CSS identifiers for consistent browser font matching");
    assert.equal(editorTextEditingSourceFontId(family), id);
    assert.notEqual(family, id);
    assert.notEqual(family, editorTextEditingFamily(id, height * 2));
  }
  assert.notEqual(editorTextEditingFamily("font_002e"), editorTextEditingFamily("font."), "literal escape sequences and escaped punctuation have distinct aliases");
  assert.equal(editorTextEditingSourceFontId("hepr-text-input:1.2:font-with:colon"), "font-with:colon", "older editing aliases still decode to the portable font identity");
  assert.equal(editorTextEditingSourceFontId("font-a"), undefined);
  for (const invalid of ["hepr-text-input:", "hepr-text-input:0:font-a", "hepr-text-input:NaN:font-a", "hepr-text-input:1.2:", "hepr-text-input:01.2:font-a",
    "hepr-text-input--", "hepr-text-input--0--font-a", "hepr-text-input--NaN--font-a", "hepr-text-input--1_002e2--", "hepr-text-input--01_002e2--font-a", "hepr-text-input--1_002e2--font_zzzz", "hepr-text-input--1.2--font-a"]) assert.equal(editorTextEditingSourceFontId(invalid), undefined);
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => editorTextEditingDescriptors(invalid), /line height/);
    assert.throws(() => editorTextEditingFamily("font-a", invalid), /line height/);
  }
  assert.throws(() => editorTextEditingFamily(""), /font ID/);

  const fonts = createEditorFontRegistry({ loadAsset: async url => new Uint8Array(await readFile(url)) });
  try {
    const sans = await fonts.loadBundled("Liberation Sans"), serif = await fonts.loadBundled("Liberation Serif", { fontStyle: "italic" }), mono = await fonts.loadBundled("Liberation Mono", { fontWeight: 700 });
    const originalIds = fonts.list().map(font => font.id);
    // CSS line boxes combine each inline run's ascent/descent plus half-leading,
    // and a root strut. Compare that independent calculation to the actual
    // portable compiler on successive mixed-size/mixed-font lines.
    for (const lineHeight of [.75, 1.2, 1.5, 2]) {
      const descriptors = editorTextEditingDescriptors(lineHeight), ascent = parseFloat(descriptors.ascentOverride) / 100,
        descent = parseFloat(descriptors.descentOverride) / 100, lineGap = parseFloat(descriptors.lineGapOverride) / 100;
      const rootSize = 12, lines = [[{ text: "A", size: 18, font: sans }, { text: "B", size: 8, font: serif }],
        [{ text: "C", size: 24, font: mono }, { text: "D", size: 10, font: sans }], [{ text: "E", size: 6, font: serif }]];
      const runs = lines.flatMap((line, index) => [...(index ? [{ text: "\n" }] : []), ...line.map(run => ({ text: run.text, fontId: run.font.id, fontSize: run.size }))]);
      const object = { id: "aligned-editor-text", kind: "text", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0],
        x: 15, y: 20, width: 1000, height: 300, fontId: sans.id, fontSize: rootSize, lineHeight, text: runs.map(run => run.text).join(""), runs };
      const layout = await layoutEditorText(object, fonts); let top = object.y + object.height;
      for (const line of lines) {
        const boxes = [rootSize, ...line.map(run => run.size)].map(size => {
          const leading = size * lineHeight - size * (ascent + descent + lineGap);
          return { above: size * ascent + leading / 2, below: size * descent + leading / 2 };
        });
        const above = Math.max(...boxes.map(box => box.above)), below = Math.max(...boxes.map(box => box.below));
        for (const run of line) {
          const glyph = layout.glyphs.find(glyph => glyph.unicode === run.text);
          assert(glyph);
          assert(Math.abs(glyph.y - (top - above)) < 1e-9, `${run.text}: edited CSS baseline matches committed baseline at line height ${lineHeight}`);
          assert.equal(glyph.font.id, run.font.id, "font metrics aliases never replace the portable rendering font");
        }
        top -= above + below;
      }
    }
    assert.deepEqual(fonts.list().map(font => font.id), originalIds, "editing aliases remain outside the portable font registry");
  } finally { fonts.dispose(); }
  console.log("Textbox editing metrics: mixed-font/mixed-size multiline CSS baselines match portable text layout, custom spacing, private aliases and validation passed.");
} finally { hooks.deregister(); }
