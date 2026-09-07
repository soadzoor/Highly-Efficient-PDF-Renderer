import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const {
  NATIVE_MAC_EXPERT_ASSIGNED_COUNT,
  NATIVE_MAC_EXPERT_ENCODING_SIZE,
  nativeMacExpertEncodingEntry,
  nativeMacExpertGlyphNameEntry
} = await import("../src/pdf/nativeMacExpertEncoding.ts");

assert.equal(NATIVE_MAC_EXPERT_ENCODING_SIZE, 256);
assert.equal(NATIVE_MAC_EXPERT_ASSIGNED_COUNT, 165);

const entries = Array.from(
  { length: NATIVE_MAC_EXPERT_ENCODING_SIZE },
  (_, code) => nativeMacExpertEncodingEntry(code)
);
assert.equal(entries.filter(Boolean).length, NATIVE_MAC_EXPERT_ASSIGNED_COUNT);
assert.equal(new Set(entries.filter(Boolean).map((entry) => entry.glyphName)).size, 165);

// The digest covers every code, glyph name, and exact AGL scalar. Its input is
// generated from Adobe's pinned `macexprt.h` and `glyphlist.txt` sources named
// in nativeMacExpertEncoding.ts, rather than another PDF implementation.
assert.equal(
  digest(entries, "unicode"),
  "75d010b5d036e01fd00b5be73e6d787c35b3666978162657b5c6ddd85566fc36"
);
assert.equal(
  digest(entries, "selectionUnicode"),
  "c8ae60da0693a574b716f964b9286f2762831189a626d0e5c019b276a89ebac9"
);

assert.deepEqual(nativeMacExpertEncodingEntry(32), {
  glyphName: "space",
  unicode: " ",
  selectionUnicode: " "
});
assert.deepEqual(nativeMacExpertEncodingEntry(33), {
  glyphName: "exclamsmall",
  unicode: "\uf721",
  selectionUnicode: "!"
});
assert.deepEqual(nativeMacExpertEncodingEntry(48), {
  glyphName: "zerooldstyle",
  unicode: "\uf730",
  selectionUnicode: "0"
});
assert.deepEqual(nativeMacExpertEncodingEntry(135), {
  glyphName: "Aacutesmall",
  unicode: "\uf7e1",
  selectionUnicode: "\u00c1"
});
assert.deepEqual(nativeMacExpertEncodingEntry(218), {
  glyphName: "onesuperior",
  unicode: "\u00b9",
  selectionUnicode: "\u00b9"
});
assert.deepEqual(nativeMacExpertEncodingEntry(251), {
  glyphName: "Ringsmall",
  unicode: "\uf6fc",
  selectionUnicode: "\u02da"
});

for (const code of [0, 31, 60, 62, 127, 160, 227, 252, 255]) {
  assert.equal(nativeMacExpertEncodingEntry(code), null, `code ${code} must be .notdef`);
}
for (const code of [-1, 256, 32.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(nativeMacExpertEncodingEntry(code), null, `${code} must be rejected`);
}

assert.strictEqual(
  nativeMacExpertGlyphNameEntry("Aacutesmall.alt"),
  nativeMacExpertEncodingEntry(135),
  "glyph-name lookup must ignore a PDF glyph suffix"
);
assert.equal(nativeMacExpertGlyphNameEntry(".notdef"), null);
assert.equal(nativeMacExpertGlyphNameEntry("not-a-mac-expert-glyph"), null);

for (const entry of entries) {
  if (!entry) continue;
  assert.equal(Array.from(entry.unicode).length, 1, `/${entry.glyphName} AGL mapping`);
  assert.equal(Array.from(entry.selectionUnicode).length, 1, `/${entry.glyphName} selection`);
  const semanticScalar = entry.unicode.codePointAt(0);
  const selectionScalar = entry.selectionUnicode.codePointAt(0);
  if (semanticScalar >= 0xe000 && semanticScalar <= 0xf8ff) {
    assert.ok(
      selectionScalar < 0xe000 || selectionScalar > 0xf8ff,
      `/${entry.glyphName} must not select a substitute through Adobe's historical PUA`
    );
  } else {
    assert.equal(
      entry.selectionUnicode,
      entry.unicode,
      `/${entry.glyphName} does not need a substitute approximation`
    );
  }
}

console.log("native MacExpertEncoding tests passed");

function digest(entries, field) {
  const serialized = entries.map((entry) => entry
    ? `${entry.glyphName};${scalarHex(entry[field])}`
    : ".notdef"
  ).join("\n");
  return createHash("sha256").update(serialized).digest("hex");
}

function scalarHex(value) {
  return Array.from(
    value,
    (character) => character.codePointAt(0).toString(16).toUpperCase()
  ).join("+");
}
