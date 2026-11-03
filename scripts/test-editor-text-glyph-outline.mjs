import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { editorTextGlyphOutline } = await import("../src/editorTextGlyphOutline.ts");
  const outline = [
    { type: "M", values: [3, 6] }, { type: "L", values: [6, 9] },
    { type: "Q", values: [12, 18, 21, 12] }, { type: "Q", values: [27, 6, 30, 15] },
    { type: "C", values: [33, 18, 36, 21, 39, 24] }, { type: "Q", values: [45, 30, 48, 21] },
    { type: "Z", values: [] }, { type: "Q", values: [9, 12, 15, 6] },
    { type: "M", values: [-3, -6] }, { type: "Q", values: [3, 0, 9, -6] }, { type: "Z", values: [] }
  ];
  const original = structuredClone(outline), font = { glyphToJson(glyph) { assert.equal(glyph, 707); return outline; } };
  assert.equal(editorTextGlyphOutline(font, 707), [
    "3 6 m", "6 9 l", "10 15 15 16 21 12 c", "25 8 28 9 30 15 c", "33 18 36 21 39 24 c",
    "43 28 46 27 48 21 c", "h", "7 10 11 10 15 6 c", "-3 -6 m", "1 -2 5 -2 9 -6 c", "h"
  ].join("\n"), "quadratic conversion follows the current point through lines, curves, closes and new contours");
  assert.deepEqual(outline, original, "conversion leaves the canonical HarfBuzz outline untouched");
  assert.equal(editorTextGlyphOutline({ glyphToJson: () => [] }, 3), "", "empty glyphs need no path or paint");
  assert.equal(editorTextGlyphOutline({ glyphToJson: () => [{ type: "M", values: [1e-8, -0] }] }, 0), "0.00000001 0 m",
    "PDF coordinates preserve small values without exponent syntax or negative zero");
  assert.throws(() => editorTextGlyphOutline({ glyphToJson: () => [{ type: "M", values: [NaN, 0] }] }, 0), RangeError);
  assert.throws(() => editorTextGlyphOutline({ glyphToJson: () => [{ type: "A", values: [] }] }, 0), TypeError);
  assert.throws(() => editorTextGlyphOutline({ glyphToJson: () => assert.fail("pre-aborted extraction cannot read the font") }, 0, AbortSignal.abort()), { name: "AbortError" });
  const duringExtraction = new AbortController();
  assert.throws(() => editorTextGlyphOutline({ glyphToJson() { duringExtraction.abort(); return []; } }, 0, duringExtraction.signal), { name: "AbortError" });
  const duringCommands = new AbortController(); let checks = 0;
  assert.throws(() => editorTextGlyphOutline(font, 707, { throwIfAborted() {
    if (++checks === 5) duringCommands.abort(); duringCommands.signal.throwIfAborted();
  } }), { name: "AbortError" });
  assert.equal(checks, 5, "long outlines observe cancellation during conversion");
  console.log("Editor glyph outlines preserve font-unit geometry, exact quadratic contours and cancellation.");
} finally { hooks.deregister(); }
