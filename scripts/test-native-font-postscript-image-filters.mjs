import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { buildType1Fixture, type1CharString, concatType1Bytes as concat } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createNativeFontPostScriptMemoryFile: memory, createNativeFontPostScriptFilter: filter,
    cloneNativeFontPostScriptFile: cloneFile, sourceNativeFontPostScriptFile: sourceFile } = await import("../src/pdf/nativeFontPostScriptFile.ts");
  const { prepareBundledJpegCodec, decodeBundledJpegSync } = await import("../src/pdf/nativeJpegCodec.ts");
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { nativeCffUsesPostScript } = await import("../src/pdf/nativeCffPostScriptProbe.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const bytes = text => new TextEncoder().encode(text);
  const all = file => { const output = []; for (let value; (value = file.readByte()) >= 0;) output.push(value); return Uint8Array.from(output); };
  const bits = text => { const clean = text.replace(/\s/g, ""), result = new Uint8Array(Math.ceil(clean.length / 8));
    for (let i = 0; i < clean.length; i++) if (clean[i] === "1") result[i >> 3] |= 1 << (7 - (i & 7)); return result; };
  const failure = (run, code) => assert.throws(run, error => error instanceof PdfError && error.code === code);
  const deepClone = original => { const cloned = new Map(); const clone = file => {
    if (cloned.has(file)) return cloned.get(file); const result = cloneFile(file, clone); assert(result); cloned.set(file, result); return result;
  }; return clone(original); };
  const jpeg = new Uint8Array(await readFile(new URL("./fixtures/jpeg/rgb-8x8.jpg", import.meta.url)));
  const jpegHex = Buffer.from(jpeg).toString("hex");
  const cffIndex = (objects, cff2 = false) => {
    const count = cff2 ? Uint8Array.of(0, 0, 0, objects.length) : Uint8Array.of(0, objects.length);
    if (!objects.length) return count;
    const offsets = [1]; for (const object of objects) offsets.push(offsets.at(-1) + object.length);
    return concat(count, Uint8Array.of(1, ...offsets), ...objects);
  };
  const probeCff = (dict, cff2 = false, suffix = new Uint8Array()) => cff2
    ? concat(Uint8Array.of(2, 0, 5, 0, dict.length), dict, suffix)
    : concat(Uint8Array.of(1, 0, 4, 4), cffIndex([bytes("F")]), cffIndex([dict]), suffix);
  assert.equal(nativeCffUsesPostScript(probeCff(Uint8Array.of(139, 12, 21))), true);
  assert.equal(nativeCffUsesPostScript(probeCff(Uint8Array.of(139, 12, 21), true)), true);
  for (const cff2 of [false, true]) {
    const fdOffset = probeCff(Uint8Array.of(29, 0, 0, 0, 0, 12, 36), cff2).length;
    const top = Uint8Array.of(29, 0, 0, 0, fdOffset, 12, 36);
    assert.equal(nativeCffUsesPostScript(probeCff(top, cff2, cffIndex([Uint8Array.of(139, 12, 21)], cff2))), true,
      "Font DICT loading programs also prepare the codec without parsing outlines");
  }
  assert.equal(nativeCffUsesPostScript(probeCff(Uint8Array.of(29, 0, 0, 12, 21, 17))), false,
    "PostScript operator bytes within a numeric operand are not a loading program");
  assert.equal(nativeCffUsesPostScript(Uint8Array.of(1, 0, 4, 4, 255)), false,
    "the presence probe defers malformed program validation to the lazy parser");
  const fixture = buildType1Fixture({ privateExtra: `/OtherSubrs [{} {} {} {} {
      gsave 1 0 0 setrgbcolor 8 8 8 [8 0 0 -8 0 8] <${jpegHex}> /DCTDecode filter false 3 colorimage grestore
    }] def`, glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(0, 600, "hsbw", 0, 0, "rmoveto", 100, 0, "rlineto", 0, 4, "callothersubr", "endchar")]] });

  // A fresh process proves that normal PDF preparation supplies the module,
  // rather than accidentally inheriting a preceding standalone codec decode.
  if (process.argv.includes("--pdf-preload")) {
    const { openPdf } = await import("../src/pdfSession.ts");
    const pdf = writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>" },
      { number: 4, body: "<< /Type /Font /Subtype /Type1 /BaseFont /CodecFixture /FirstChar 65 /LastChar 65 /Widths [600] /Encoding << /Type /Encoding /Differences [65 /A] >> /FontDescriptor 5 0 R >>" },
      { number: 5, body: "<< /Type /FontDescriptor /FontName /CodecFixture /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 /FontFile 6 0 R >>" },
      { number: 6, body: tinyPdfStream(`/Length1 ${fixture.length1} /Length2 ${fixture.length2}`, fixture.bytes) },
      { number: 7, body: tinyPdfStream("", "BT /F1 40 Tf 10 10 Td (A) Tj ET") }
    ] });
    const session = await openPdf({ kind: "bytes", bytes: pdf });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      assert(page.stores.images.data.length > 0, "font image can be compiled through the normal PDF session");
      const diagnostics = session.getDiagnostics();
      assert(!diagnostics.some(value => value.code?.includes("othersubr-approximated") || value.details?.postScriptReason === "font-postscript-codec-not-prepared"));
    } finally { await session.close(); }
    console.log("PDF font DCT preparation passed.");
  } else {
    const lazySource = memory(concat(jpeg, "tail")); const lazy = filter(lazySource, "DCTDecode");
    assert.equal(lazySource.tell(), 0); lazy.close(); assert.equal(lazySource.tell(), 0);
    const unprepared = filter(memory(concat(jpeg, "tail")), "DCTDecode");
    assert.throws(() => unprepared.readByte(), error => error instanceof PdfError && error.code === "unsupported-font" &&
      error.details?.reason === "font-postscript-codec-not-prepared", "standalone sync callers get a precise preparation diagnostic");
    await prepareBundledJpegCodec(); 
    assert.equal(all(unprepared).length, 192, "a prepared retry reuses encoded bytes rather than draining the source again");

    const oracle = spawnSync("gs", ["--version"], { encoding: "utf8" });
    const compareGhostscript = (encoded, name, parameters, expected) => {
      if (oracle.error?.code === "ENOENT") return;
      assert.equal(oracle.status, 0);
      const dictionary = Object.entries(parameters).map(([key, value]) => `/${key} ${value}`).join(" ");
      const program = `<${Buffer.from(encoded).toString("hex")}> << ${dictionary} >> /${name} filter ${Math.max(1024, expected.length + 1)} string readstring pop { == } forall
`;
      const result = spawnSync("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-c", program], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr); assert.deepEqual([...expected], result.stdout.trim().split(/\s+/).filter(Boolean).map(Number), `${name} agrees with Ghostscript samples`);
    };
    for (const [filename, pixel] of [["rgb-8x8.jpg", [16, 85, 204]], ["gray-8x8.jpg", [64]],
      ["cmyk-8x8.jpg", [191, 127, 65, 223]], ["app14-cmyk-8x8.jpg", [191, 128, 64, 230]],
      ["markerless-cmyk-8x8.jpg", [191, 128, 64, 230]], ["progressive-rgb-8x8.jpg", [16, 85, 204]]]) {
      const encoded = new Uint8Array(await readFile(new URL(`./fixtures/jpeg/${filename}`, import.meta.url)));
      const source = memory(concat(encoded, "tail")), decoded = all(filter(source, "DCTDecode"));
      assert.equal(decoded.length, 64 * pixel.length);
      for (let offset = 0; offset < decoded.length; offset += pixel.length) assert.deepEqual([...decoded.subarray(offset, offset + pixel.length)], pixel);
      assert.equal(source.tell(), encoded.length); assert.equal(source.readByte(), 116, "JPEG leaves source immediately after EOI");
      compareGhostscript(encoded, "DCTDecode", {}, decoded);
    }
    // Fake EOI inside APP15 data must not truncate the actual encoded image.
    const appJpeg = concat(jpeg.subarray(0, 2), Uint8Array.of(255, 239, 0, 6, 255, 217, 255, 0), jpeg.subarray(2));
    const appSource = memory(concat(appJpeg, "Z")); assert.equal(all(filter(appSource, "DCTDecode")).length, 192);
    assert.equal(appSource.readByte(), 90);
    failure(() => all(filter(jpeg.subarray(0, jpeg.length - 2), "DCTDecode")), "unsupported-font");
    failure(() => all(filter(Uint8Array.of(255, 216, 255, 239, 0, 1), "DCTDecode")), "unsupported-font");
    failure(() => all(filter(jpeg, "DCTDecode", { ColorTransform: 2 })), "unsupported-font");
    failure(() => all(filter(jpeg, "DCTDecode", {}, { maxDecodedBytes: 191 })), "resource-limit");
    assert.equal(decodeBundledJpegSync(jpeg, {}, { maxOutputBytes: 192 }).samples.length, 192);

    const eol = "000000000001";
    for (const [encoded, parameters, expected] of [
      [bits("10011 00110101 000101"), { Columns: 8, Rows: 2, EndOfBlock: false }, [255, 0]],
      [bits("10011000 00110101 00010100"), { Columns: 8, Rows: 2, EndOfBlock: false, EncodedByteAlign: true }, [255, 0]],
      [bits("10011 00110101 000101"), { Columns: 8, Rows: 2, EndOfBlock: false, BlackIs1: true }, [0, 255]],
      [bits(`10011 ${eol.repeat(6)}`), { Columns: 8 }, [255]],
      [bits(`1 ${eol.repeat(2)}`), { Columns: 8, K: -1 }, [255]],
      [bits(`${eol}1 10011 ${eol}0 1 ${`${eol}1`.repeat(6)}`), { Columns: 8, K: 2, EndOfLine: true }, [255, 255]]
    ]) {
      const source = memory(concat(encoded, "tail")), decoded = filter(source, "CCITTFaxDecode", parameters);
      assert.equal(source.tell(), 0, "fax decoding starts on the first pull");
      const output = all(decoded); assert.deepEqual([...output], expected);
      assert.equal(source.tell(), encoded.length, "fax filter consumes only its terminating encoded byte");
      assert.equal(source.readByte(), 116); compareGhostscript(encoded, "CCITTFaxDecode", parameters, output);
    }
    failure(() => all(filter(Uint8Array.of(0), "CCITTFaxDecode", { Columns: 8, Rows: 1, EndOfBlock: false })), "unsupported-font");
    failure(() => all(filter(bits("10011"), "CCITTFaxDecode", { Columns: 0, Rows: 1, EndOfBlock: false })), "unsupported-font");
    failure(() => all(filter(bits("10011 10011"), "CCITTFaxDecode", { Columns: 8, Rows: 2, EndOfBlock: false }, { maxDecodedBytes: 1 })), "resource-limit");

    for (const [name, encoded, parameters, expected] of [["DCTDecode", jpeg, {}, 192],
      ["CCITTFaxDecode", bits("10011 00110101 000101"), { Columns: 8, Rows: 2, EndOfBlock: false }, 2]]) {
      const original = filter(memory(concat(encoded, "tail")), name, parameters), before = deepClone(original);
      assert.equal(sourceFile(before).tell(), 0); assert.equal(original.peekByte(), before.peekByte());
      const after = deepClone(original); assert.deepEqual(all(after), all(original));
      assert.equal(sourceFile(after).readByte(), 116); assert.equal(all(before).length, expected);
      assert.equal(sourceFile(before).readByte(), 116, "cloned codecs own independent underlying cursors");
      const reusable = filter(memory(concat(encoded, "tail")), "ReusableStreamDecode", { Filter: name, DecodeParms: parameters });
      const output = all(reusable); reusable.seek(0); assert.deepEqual(all(reusable), output);
      const closeSource = memory(encoded); all(filter(closeSource, name, { ...parameters, CloseSource: true })); assert(closeSource.closed);
    }
    const controller = new AbortController(); controller.abort();
    failure(() => filter(jpeg, "DCTDecode", {}, { signal: controller.signal }).readByte(), "aborted");
    failure(() => filter(bits("10011"), "CCITTFaxDecode", { Columns: 8 }, { signal: controller.signal }).readByte(), "aborted");
    const vm = executeNativeFontPostScript(bytes(`/fax <98> << /Columns 8 /Rows 1 /EndOfBlock false >> /CCITTFaxDecode filter def
      fax read /ok exch def /sample exch def`), undefined, { initialDictionary: new Map([["FontType", 1]]) });
    assert.equal(vm.dictionary.get("ok"), true); assert.equal(vm.dictionary.get("sample"), 255, "VM passes fax DecodeParms rather than silently dropping them");
    const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--pdf-preload"], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    console.log("Font PostScript image filters passed: JPEG/fax samples, exact source EOD, lazy clone/seek, limits, cancellation and PDF preparation.");
  }
} finally { hooks.deregister(); }
