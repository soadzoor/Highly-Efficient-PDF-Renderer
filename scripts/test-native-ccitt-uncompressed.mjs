import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { decodeNativeCcittFax } = await import("../src/pdf/nativeCcitt.ts");
  const { createNativeFontPostScriptFilter: filter, createNativeFontPostScriptMemoryFile: memory,
    cloneNativeFontPostScriptFile: cloneFile } = await import("../src/pdf/nativeFontPostScriptFile.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const bits = source => {
    const clean = source.replace(/\s/g, ""), result = new Uint8Array(Math.ceil(clean.length / 8));
    for (let index = 0; index < clean.length; index++) if (clean[index] === "1") result[index >> 3] |= 1 << (7 - (index & 7));
    return result;
  };
  const decode = (source, columns, parameters = {}, options = {}) => decodeNativeCcittFax(bits(source), {
    Columns: columns, Rows: 1, EndOfBlock: false, BlackIs1: true, ...parameters
  }, options);
  const packed = (pixels, columns) => {
    const result = [];
    for (let row = 0; row < pixels.length / columns; row++) result.push(...bits(pixels.slice(row * columns, (row + 1) * columns)));
    return result;
  };
  const failure = (run, code, reason) => assert.throws(run, error => error instanceof PdfError && error.code === code &&
    (reason === undefined || error.details?.reason === reason));
  const oneD = "000000001111", twoD = "0000001111", eol = "000000000001";
  const exit = (white = 0, black = false) => `${"0".repeat(6 + white)}1${black ? 1 : 0}`;

  // Independently transcribed image-pattern/code-word pairs: ITU-T T.4 table 4
  // and T.6 table 4. The six-zero escape emits five white pixels, not a black pixel.
  for (const [code, pixels] of [["1", "1"], ["01", "01"], ["001", "001"],
    ["0001", "0001"], ["00001", "00001"], ["000001", "00000"]]) {
    for (const [entrance, parameters] of [[oneD, {}], [twoD, { K: -1 }]]) {
      assert.deepEqual([...decode(entrance + code + exit(), pixels.length, parameters).bytes], [...bits(pixels)]);
    }
  }
  // Each exit can emit zero through four final white pixels. Its tag selects
  // the following ordinary run; both colors must work, including black entry.
  for (let white = 0; white <= 4; white++) for (const black of [false, true]) {
    const pixels = `1${"0".repeat(white)}${(black ? "1" : "0").repeat(4)}`;
    const source = `${oneD}1${exit(white, black)}${black ? "011" : "1011"}`;
    assert.deepEqual([...decode(source, pixels.length).bytes], [...bits(pixels)]);
  }
  assert.deepEqual([...decode(`0111 ${oneD}01${exit()} 1011`, 8).bytes], [0x10],
    "uncompressed literals entered during a black run retain their actual colors");
  assert.deepEqual([...decode(`11011 ${oneD}1${exit()}`, 65).bytes], [...bits(`${"0".repeat(64)}1`)],
    "already decoded makeup pixels precede the uncompressed entrance");

  // T.6 section 2.3.1 concatenates patterns across scan lines. This crosses a
  // row in the middle of a literal code, then reuses the last row as a 2-D reference.
  const crossRows = `${twoD}00001 000001 1 ${exit(1)} 111 ${eol.repeat(2)}`;
  const cross = decode(crossRows, 4, { K: -1, Rows: 0, EndOfBlock: true });
  assert.equal(cross.rows, 4);
  assert.deepEqual([...cross.bytes], [0, 0x80, 0x20, 0x20]);
  assert.equal(cross.terminatedBy, "end-of-block");
  const mixed = `${eol}1 ${oneD}00101${exit()} ${eol}0 1111 ${`${eol}1`.repeat(6)}`;
  assert.deepEqual([...decode(mixed, 5, { K: 2, Rows: 0, EndOfBlock: true, EndOfLine: true }).bytes], [0x28, 0x28]);

  const pixels = "0010100001";
  const literal = `${twoD}001 01 00001 ${exit()}`;
  assert.deepEqual([...decode(literal, 5, { K: -1, Rows: 2 }).bytes], packed(pixels, 5));
  assert.deepEqual([...decode(literal, 5, { K: -1, Rows: 2, BlackIs1: false }).bytes], [0xd0, 0xf0],
    "opposite polarity and unused row padding remain correct");

  for (let selector = 0; selector < 7; selector++) failure(() => decode(`0000001${selector.toString(2).padStart(3, "0")}`, 8,
    { K: -1 }), "unsupported-filter", "ccitt-extension-mode");
  failure(() => decode(`${oneD}1 00000000000`, 8), "invalid-object", "ccitt-uncompressed-code");
  failure(() => decode(`${oneD}00001${exit()}`, 4), "invalid-object", "ccitt-uncompressed-cross-line");
  failure(() => decode(literal, 5, { K: -1, Rows: 2 }, { limits: { maxOutputBytes: 1 } }), "resource-limit");
  failure(() => decode(literal, 5, { K: -1, Rows: 2 }, { limits: { maxTransitions: 2 } }), "resource-limit");
  failure(() => decode(literal, 5, { K: -1, Rows: 2 }, { limits: { maxScanBits: 8 } }), "resource-limit");
  const controller = new AbortController(); controller.abort();
  failure(() => decode(literal, 5, { K: -1, Rows: 2 }, { signal: controller.signal }), "aborted");

  const encoded = bits(crossRows), source = memory(Uint8Array.from([...encoded, 88, 89]));
  const original = filter(source, "CCITTFaxDecode", { K: -1, Columns: 4, BlackIs1: true });
  assert.equal(source.tell(), 0);
  const clonedSources = new Map(); const clone = file => {
    if (clonedSources.has(file)) return clonedSources.get(file);
    const value = cloneFile(file, clone); clonedSources.set(file, value); return value;
  };
  const copy = clone(original), all = file => { const result = []; for (let value; (value = file.readByte()) >= 0;) result.push(value); return result; };
  assert.deepEqual(all(original), [0, 0x80, 0x20, 0x20]);
  assert.deepEqual(all(copy), [0, 0x80, 0x20, 0x20]);
  assert.equal(source.tell(), encoded.length, "uncompressed fax source ends exactly after EOFB and byte padding");
  assert.equal(source.readByte(), 88, "following executable font bytes are preserved");
  console.log("CCITT uncompressed mode passed: normative code words, exits, Group 4 cross-row patterns, 2-D references, exact EOD, clone, limits and cancellation.");
} finally { hooks.deregister(); }
