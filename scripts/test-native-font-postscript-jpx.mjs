import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildType1Fixture, type1CharString } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createNativeFontPostScriptMemoryFile: memory, createNativeFontPostScriptFilter: filter,
    cloneNativeFontPostScriptFile: cloneFile } = await import("../src/pdf/nativeFontPostScriptFile.ts");
  const { prepareBundledJpxCodec } = await import("../src/pdf/nativeJpxCodec.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/codecs/${name}-8x8.jp2`, import.meta.url)));
  const encoded = fixture("rgb"), hex = Buffer.from(encoded).toString("hex");
  const all = file => { const result = []; for (let value; (value = file.readByte()) >= 0;) result.push(value); return result; };
  const failure = (run, code, reason) => assert.throws(run, error => error instanceof PdfError && error.code === code &&
    (reason === undefined || error.details?.reason === reason));
  if (process.argv.includes("--pdf-preload")) {
    const { openPdf } = await import("../src/pdfSession.ts");
    const fixture = buildType1Fixture({ privateExtra: `/OtherSubrs [{} {} {} {} {
      gsave /DeviceRGB setcolorspace << /ImageType 1 /Width 8 /Height 8 /BitsPerComponent 8 /ImageMatrix [8 0 0 -8 0 8] /Decode [0 1 0 1 0 1] /DataSource <${hex}> /JPXDecode filter >> image grestore
    }] def`, glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(0, 600, "hsbw", 0, 4, "callothersubr", "endchar")]] });
    const pdf = writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>" },
      { number: 4, body: "<< /Type /Font /Subtype /Type1 /BaseFont /JpxFont /FirstChar 65 /LastChar 65 /Widths [600] /Encoding << /Type /Encoding /Differences [65 /A] >> /FontDescriptor 5 0 R >>" },
      { number: 5, body: "<< /Type /FontDescriptor /FontName /JpxFont /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 /FontFile 6 0 R >>" },
      { number: 6, body: tinyPdfStream(`/Length1 ${fixture.length1} /Length2 ${fixture.length2}`, fixture.bytes) },
      { number: 7, body: tinyPdfStream("", "BT /F1 40 Tf 10 10 Td (A) Tj ET") }
    ] });
    const session = await openPdf({ kind: "bytes", bytes: pdf });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      assert(page.stores.images.data.length > 0, "the normal PDF session prepares and retains JPX font imaging");
      assert(!session.getDiagnostics().some(value => value.code?.includes("othersubr-approximated")));
    } finally { await session.close(); }
    const { buildHep } = await import("../src/hepBuilder.ts");
    const { loadSceneFromHep } = await import("../src/hepReader.ts");
    const blob = await buildHep(pdf, { compression: "deflate", encodeRasterImages: false, withVectorLod: true, withTextLod: true });
    const scene = await loadSceneFromHep(new Uint8Array(await blob.arrayBuffer()));
    assert.equal(scene.rasterLayers.length, 1);
    const image = scene.rasterLayers[0], expected = all(filter(encoded, "JPXDecode"));
    assert.equal(image.width, 8); assert.equal(image.height, 8);
    assert(image.data.every((value, i) => value === (i % 4 === 3 ? 255 : expected[Math.floor(i / 4) * 3 + i % 4])),
      "font JPX source pixels survive lossless HEP save/reload");
    console.log("PDF font JPX preparation and HEP pixels passed.");
  } else {
    const retry = filter(encoded, "JPXDecode");
    failure(() => retry.readByte(), "unsupported-font", "font-postscript-codec-not-prepared");
    await prepareBundledJpxCodec();
    const rgb = all(retry); assert.equal(rgb.length, 192);
    const oracle = spawnSync("gs", ["--version"], { encoding: "utf8" });
    const compareGs = (bytes, parameters, expected) => {
      if (oracle.error?.code === "ENOENT") return;
      const program = `<${Buffer.from(bytes).toString("hex")}> << ${parameters} >> /JPXDecode filter ${expected.length + 1} string readstring pop { == } forall`;
      const result = spawnSync("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-c", program], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(result.stdout.trim().split(/\s+/).filter(Boolean).map(Number), expected);
    };
    for (const name of ["gray", "rgb", "graya", "rgba"]) {
      const bytes = fixture(name), samples = all(filter(bytes, "JPXDecode"));
      assert.equal(samples.length, name.startsWith("gray") ? 64 : 192);
      compareGs(bytes, "", samples);
      const alpha = all(filter(bytes, "JPXDecode", { Alpha: true }));
      assert.equal(alpha.length, 64); compareGs(bytes, "/Alpha true", alpha);
      if (!name.endsWith("a")) assert(alpha.every(x => x === 255));
    }
    const gray = fixture("gray");
    compareGs(gray, "/ColorSpace /Indexed", all(filter(gray, "JPXDecode", { ColorSpace: "Indexed" })));
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    let offset = 0; while (view.getUint32(offset + 4) !== 0x6a703263) offset += view.getUint32(offset);
    const raw = encoded.subarray(offset + 8, offset + view.getUint32(offset));
    assert.deepEqual(all(filter(raw, "JPXDecode")), rgb); compareGs(raw, "", rgb);
    const source = memory(Uint8Array.from([...encoded, 116, 97, 105, 108]));
    const bounded = filter(source, "SubFileDecode", { EODCount: encoded.length, EODString: new Uint8Array() });
    const original = filter(bounded, "JPXDecode"); assert.equal(source.tell(), 0);
    const copies = new Map(); const clone = file => {
      if (copies.has(file)) return copies.get(file);
      const result = cloneFile(file, clone); copies.set(file, result); return result;
    };
    const before = clone(original); assert.equal(original.peekByte(), rgb[0]); copies.clear();
    const after = clone(original);
    assert.deepEqual(all(after), rgb); assert.deepEqual(all(before), rgb); assert.deepEqual(all(original), rgb);
    assert.equal(source.tell(), encoded.length); assert.equal(source.readByte(), 116);
    const reusable = filter(encoded, "ReusableStreamDecode", { Filter: "JPXDecode" });
    assert.deepEqual(all(reusable), rgb); reusable.seek(0); assert.deepEqual(all(reusable), rgb);
    const closed = memory(encoded); all(filter(closed, "JPXDecode", { CloseSource: true })); assert(closed.closed);
    failure(() => all(filter(encoded, "JPXDecode", {}, { maxDecodedBytes: 191 })), "resource-limit");
    failure(() => all(filter(fixture("gray16"), "JPXDecode")), "unsupported-font", "font-postscript-image-filter");
    failure(() => all(filter(encoded.subarray(0, 10), "JPXDecode")), "unsupported-font");
    const aborted = new AbortController(); aborted.abort();
    failure(() => filter(encoded, "JPXDecode", {}, { signal: aborted.signal }).readByte(), "aborted");
    assert.deepEqual(all(filter(encoded, "JPXDecode")), rgb);
    const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--pdf-preload"], { encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    console.log("Font PostScript JPX passed: GS color/alpha oracle, boxed/raw, indexed, clone/seek, preparation, errors, limits and PDF/HEP imaging.");
  }
} finally { hooks.deregister(); }
