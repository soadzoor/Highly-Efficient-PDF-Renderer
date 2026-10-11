import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { tinyJbig2, tinySymbolJbig2 } from "./lib/imageCodecFixtures.mjs";
import { buildType1Fixture, type1CharString } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createNativeFontPostScriptMemoryFile: memory, createNativeFontPostScriptFilter: filter,
    cloneNativeFontPostScriptFile: cloneFile } = await import("../src/pdf/nativeFontPostScriptFile.ts");
  const { prepareBundledJbig2Codec, decodeBundledJbig2Sync } = await import("../src/pdf/nativeJbig2Codec.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const encoded = tinyJbig2(), hex = Buffer.from(encoded).toString("hex");
  const all = file => { const result = []; for (let value; (value = file.readByte()) >= 0;) result.push(value); return result; };
  const failure = (run, code, reason) => assert.throws(run, error => error instanceof PdfError && error.code === code &&
    (reason === undefined || error.details?.reason === reason));
  const request = (bytes = encoded) => ({ codec: "jbig2", encoded: bytes, globals: new Uint8Array(), width: 8, height: 2,
    components: 1, bitsPerComponent: 1, imageMask: false, decodeParameters: {} });

  if (process.argv.includes("--pdf-preload")) {
    const { openPdf } = await import("../src/pdfSession.ts");
    const fixture = buildType1Fixture({ privateExtra: `/OtherSubrs [{} {} {} {} {
      gsave 8 2 1 [8 0 0 -2 0 2] <${hex}> /JBIG2Decode filter image grestore
    }] def`, glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(0, 600, "hsbw", 0, 4, "callothersubr", "endchar")]] });
    const pdf = writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>" },
      { number: 4, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Jbig2Font /FirstChar 65 /LastChar 65 /Widths [600] /Encoding << /Type /Encoding /Differences [65 /A] >> /FontDescriptor 5 0 R >>" },
      { number: 5, body: "<< /Type /FontDescriptor /FontName /Jbig2Font /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 /FontFile 6 0 R >>" },
      { number: 6, body: tinyPdfStream(`/Length1 ${fixture.length1} /Length2 ${fixture.length2}`, fixture.bytes) },
      { number: 7, body: tinyPdfStream("", "BT /F1 40 Tf 10 10 Td (A) Tj ET") }
    ] });
    const session = await openPdf({ kind: "bytes", bytes: pdf });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      assert(page.stores.images.data.length > 0, "the normal PDF session prepares and retains JBIG2 font imaging");
      assert(!session.getDiagnostics().some(value => value.code?.includes("othersubr-approximated")));
    } finally { await session.close(); }
    console.log("PDF font JBIG2 preparation passed.");
  } else {
    const retry = filter(encoded, "JBIG2Decode");
    failure(() => retry.readByte(), "unsupported-font", "font-postscript-codec-not-prepared");
    await prepareBundledJbig2Codec();
    assert.deepEqual(all(retry), [255, 0], "a prepared retry retains the previously consumed encoded buffer");
    assert.deepEqual([...decodeBundledJbig2Sync(request(), Number.MAX_SAFE_INTEGER).samples], [255, 0]);
    failure(() => decodeBundledJbig2Sync(request(), 32), "resource-limit");

    const oracle = spawnSync("gs", ["--version"], { encoding: "utf8" });
    const compareGs = (bytes, expected) => {
      if (oracle.error?.code === "ENOENT") return;
      const program = `<${Buffer.from(bytes).toString("hex")}> /JBIG2Decode filter ${expected.length + 1} string readstring pop { == } forall`;
      const result = spawnSync("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-c", program], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(result.stdout.trim().split(/\s+/).filter(Boolean).map(Number), expected, "extension samples agree with Ghostscript");
    };
    compareGs(encoded, [255, 0]);
    assert.deepEqual(all(filter(Uint8Array.from([0x97, 0x4a, 0x42, 0x32, 13, 10, 26, 10, 3, ...encoded]), "JBIG2Decode")),
      [255, 0], "standalone sequential headers are also tolerated by the shared codec");
    const symbols = tinySymbolJbig2({ width: 8, height: 2, placements: [[2, 1]] }).encoded;
    const symbolSamples = all(filter(symbols, "JBIG2Decode"));
    assert.deepEqual(symbolSamples, [255, 223]); compareGs(symbols, symbolSamples);

    // JBIG2Decode is an EOF-bounded extension in Ghostscript. A byte-count
    // SubFileDecode prevents its source from consuming the following font code.
    const source = memory(Uint8Array.from([...encoded, 116, 97, 105, 108]));
    const bounded = filter(source, "SubFileDecode", { EODCount: encoded.length, EODString: new Uint8Array() });
    const original = filter(bounded, "JBIG2Decode");
    assert.equal(source.tell(), 0, "construction is lazy");
    const copies = new Map(); const clone = file => {
      if (copies.has(file)) return copies.get(file);
      const result = cloneFile(file, clone); copies.set(file, result); return result;
    };
    const before = clone(original); assert.equal(original.peekByte(), 255);
    copies.clear();
    const after = clone(original); assert.deepEqual(all(after), [255, 0]);
    assert.deepEqual(all(original), [255, 0]); assert.deepEqual(all(before), [255, 0]);
    assert.equal(source.tell(), encoded.length); assert.equal(source.readByte(), 116);
    const reusable = filter(encoded, "ReusableStreamDecode", { Filter: "JBIG2Decode" });
    assert.deepEqual(all(reusable), [255, 0]); reusable.seek(0); assert.deepEqual(all(reusable), [255, 0]);
    const closed = memory(encoded); all(filter(closed, "JBIG2Decode", { CloseSource: true })); assert(closed.closed);

    failure(() => all(filter(encoded, "JBIG2Decode", {}, { maxDecodedBytes: 1 })), "resource-limit");
    failure(() => all(filter(encoded.subarray(0, 10), "JBIG2Decode")), "unsupported-font");
    const invalid = encoded.slice(); invalid.fill(255, 15, 19);
    failure(() => all(filter(invalid, "JBIG2Decode")), "unsupported-font");
    const aborted = new AbortController(); aborted.abort();
    failure(() => filter(encoded, "JBIG2Decode", {}, { signal: aborted.signal }).readByte(), "aborted");
    assert.deepEqual(all(filter(encoded, "JBIG2Decode")), [255, 0], "malformed inputs do not poison fresh decoder instances");
    const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--pdf-preload"], { encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    console.log("Font PostScript JBIG2 passed: GS sample oracle, sequential pages/symbols, EOF-bounded source, independent clone/seek, preparation, errors, limits and PDF imaging.");
  }
} finally { hooks.deregister(); }
