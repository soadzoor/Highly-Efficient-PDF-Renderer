import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { encryptType1Bytes, concatType1Bytes as concat } from "./lib/type1Fixture.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createNativeFontPostScriptMemoryFile: memory, createNativeFontPostScriptFilter: filter,
    createNativeFontPostScriptEexecFile: eexec, snapshotNativeFontPostScriptMemoryFile: snapshot,
    restoreNativeFontPostScriptMemoryFile: restore } = await import("../src/pdf/nativeFontPostScriptFile.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const bytes = value => new TextEncoder().encode(value);
  const all = input => { const output = []; for (let b; (b = input.readByte()) >= 0;) output.push(b); return Uint8Array.from(output); };
  const text = input => new TextDecoder().decode(all(input));
  const failure = (run, code) => assert.throws(run, error => error instanceof PdfError && error.code === code);

  const input = memory(bytes("ab\r\nc\rd\ne"));
  assert.equal(input.peekByte(), 97); assert.equal(input.tell(), 0);
  assert.equal(input.bytesAvailable(), 9);
  const target = new Uint8Array(2);
  assert.deepEqual(input.readLineInto(target), { length: 2, complete: true });
  assert.deepEqual([...target], [97, 98]); assert.equal(input.tell(), 4);
  assert.deepEqual(input.readLineInto(target), { length: 1, complete: true });
  assert.deepEqual(input.readLineInto(target), { length: 1, complete: true });
  assert.deepEqual(input.readLineInto(target), { length: 1, complete: false });
  assert.equal(input.bytesAvailable(), -1); assert.equal(input.closed, false);
  input.seek(0); assert.equal(input.readByte(), 97); assert.equal(input.bytesAvailable(), 8);
  failure(() => input.seek(10), "unsupported-font");
  failure(() => memory(bytes("abcx\n")).readLineInto(new Uint8Array(3)), "unsupported-font");
  assert.deepEqual(memory(bytes("\n")).readLineInto(new Uint8Array()), { length: 0, complete: true });

  const hexTarget = new Uint8Array(3);
  assert.equal(memory(bytes("A!b / C")).readHexInto(hexTarget), 1);
  assert.deepEqual([...hexTarget], [0xab, 0, 0], "readhexstring skips nonhex and discards a final unmatched nibble");
  const hexSource = memory(bytes(" f 0 1>TAIL"));
  const hex = filter(hexSource, "ASCIIHexDecode");
  assert.deepEqual([...all(hex)], [0xf0, 0x10]);
  assert.equal(text(hexSource), "TAIL"); assert.equal(hex.closed, true);
  failure(() => all(filter(bytes("A!>"), "ASCIIHexDecode")), "unsupported-font");
  const exact = memory(bytes("4142>resume"));
  const decoded = filter(exact, "ASCIIHexDecode");
  assert.equal(decoded.readInto(target), 2); assert.equal(exact.tell(), 4);
  assert.equal(decoded.readByte(), -1); assert.equal(exact.tell(), 5);
  assert.equal(text(exact), "resume", "EOD consumes no bytes from the following executable program");

  const a85Source = memory(bytes("z87cURD]j7BEbo80~>remaining"));
  const a85 = filter(a85Source, "ASCII85Decode");
  assert.deepEqual([...all(a85)], [0, 0, 0, 0, ...bytes("Hello world!")]);
  assert.equal(text(a85Source), "remaining");
  assert.equal(text(filter(bytes("87cURDZ~>"), "ASCII85Decode")), "Hello");
  for (const malformed of ["!~>", "!z~>", "uuuuu~>", "~x"]) failure(() => all(filter(bytes(malformed), "ASCII85Decode")), "unsupported-font");

  const runs = memory(Uint8Array.of(2, 65, 66, 67, 254, 90, 128, 88));
  assert.equal(text(filter(runs, "RunLengthDecode")), "ABCZZZ"); assert.equal(runs.readByte(), 88);
  for (const malformed of [Uint8Array.of(1, 65), Uint8Array.of(255)]) failure(() => all(filter(malformed, "RunLengthDecode")), "unsupported-font");

  const subSource = memory(bytes("abcENDtail"));
  assert.equal(text(filter(subSource, "SubFileDecode", { EODCount: 0, EODString: bytes("END") })), "abc");
  assert.equal(text(subSource), "tail");
  const repeated = memory(bytes("aENDbENDc"));
  assert.equal(text(filter(repeated, "SubFileDecode", { EODCount: 2, EODString: bytes("END") })), "aENDbEND");
  assert.equal(text(repeated), "c");
  const overlap = memory(bytes("XeeeeX"));
  assert.equal(text(filter(overlap, "SubFileDecode", { EODCount: 1, EODString: bytes("eee") })), "Xeee");
  assert.equal(text(overlap), "eX", "SubFileDecode counts nonoverlapping marker occurrences");
  const partial = memory(bytes("aabXaa"));
  assert.equal(text(filter(partial, "SubFileDecode", { EODCount: 0, EODString: bytes("aab") })), "");
  assert.equal(text(partial), "Xaa");
  assert.equal(text(filter(bytes("partialEN"), "SubFileDecode", { EODCount: 0, EODString: bytes("END") })), "partialEN");
  assert.equal(text(filter(bytes("abc"), "SubFileDecode", { EODCount: 0, EODString: new Uint8Array() })), "abc");
  const counted = memory(bytes("abcTAIL"));
  assert.equal(text(filter(counted, "SubFileDecode", { EODCount: 3, EODString: new Uint8Array() })), "abc");
  assert.equal(text(counted), "TAIL");
  failure(() => filter(bytes("a"), "SubFileDecode"), "unsupported-font");

  const ciphertext = encryptType1Bytes(concat(new Uint8Array(4), bytes("/answer 42 def currentfile closefile ")), 55665);
  for (const encrypted of [ciphertext, bytes([...ciphertext].map(value => value.toString(16).padStart(2, "0")).join(""))]) {
    const source = memory(concat(encrypted, bytes("cleartomark")));
    const decrypted = eexec(source);
    const plain = new Uint8Array(bytes("/answer 42 def currentfile closefile ").length);
    assert.equal(decrypted.readInto(plain), plain.length);
    assert.equal(new TextDecoder().decode(plain), "/answer 42 def currentfile closefile ");
    decrypted.close();
    assert.equal(text(source), "cleartomark", "closing eexec leaves the unencrypted trailer available");
  }
  failure(() => all(eexec(Uint8Array.of(1, 2))), "unsupported-font");

  const reusableSource = memory(bytes("4142>tail"));
  const reusable = filter(reusableSource, "ReusableStreamDecode", { Filter: "ASCIIHexDecode" });
  assert.equal(text(reusable), "AB"); assert.equal(reusable.closed, false); assert.equal(reusable.bytesAvailable(), 0);
  reusable.seek(1); assert.equal(reusable.readByte(), 66); reusable.seek(0); assert.equal(text(reusable), "AB");
  assert.equal(text(reusableSource), "tail");
  const savedSource = memory(bytes("xyz")); savedSource.peekByte();
  const saved = snapshot(savedSource), copy = restore({ ...saved, bytes: saved.bytes.slice() });
  assert.equal(copy.tell(), 0); assert.equal(copy.readByte(), 120); assert.equal(savedSource.readByte(), 120);
  savedSource.readByte(); const atTwo = restore(snapshot(savedSource)); assert.equal(atTwo.readByte(), 122);
  savedSource.close(); assert.equal(restore(snapshot(savedSource)).closed, true);
  assert.equal(snapshot(filter(bytes("41>"), "ASCIIHexDecode")), null, "stateful filters remain explicitly uncloneable");

  const closedSource = memory(bytes("41>tail")); all(filter(closedSource, "ASCIIHexDecode", { CloseSource: true }));
  assert.equal(closedSource.closed, true);
  const lazySource = memory(bytes("41>tail")); const lazy = filter(lazySource, "ASCIIHexDecode");
  lazy.close(); assert.equal(lazySource.tell(), 0, "ordinary filter creation and close do not eagerly consume source data");
  assert.deepEqual([...all(filter(bytes("4142>"), "ASCIIHexDecode", {}, { maxDecodedBytes: 2 }))], [65, 66]);
  failure(() => all(filter(bytes("414243>"), "ASCIIHexDecode", {}, { maxDecodedBytes: 2 })), "resource-limit");
  const controller = new AbortController(); controller.abort();
  failure(() => memory(bytes("x"), { signal: controller.signal }).readByte(), "aborted");
  failure(() => filter(bytes("4142>"), "ReusableStreamDecode", {}, { signal: controller.signal }), "aborted");

  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const execute = (source, options = {}) => executeNativeFontPostScript(typeof source === "string" ? bytes(source) : source,
    undefined, { initialDictionary: new Map([["FontType", 1]]), ...options }).dictionary;
  const lexical = execute(`/captured 7 def /bound { //captured } def /captured 9 def /answer bound def
    /a85 <~87cURDZ~> def /zero <~z~> def /emptyName / def
    /brace ({) cvn def /braceValue //brace def /braceProc { //brace } def
    ( 123 xyz) token { /number exch def /remainder exch def } if`);
  assert.equal(lexical.get("answer"), 7, "immediate names bind data while procedures are scanned");
  assert.equal(new TextDecoder().decode(lexical.get("a85")), "Hello");
  assert.deepEqual([...lexical.get("zero")], [0, 0, 0, 0]);
  assert.equal(lexical.get("emptyName").value, "");
  assert.equal(lexical.get("braceValue").value, "{", "immediate name values are substituted objects, not scanner delimiters");
  assert.equal(lexical.get("braceProc").tokens[0].value, "{");
  assert.equal(lexical.get("number"), 123); assert.equal(new TextDecoder().decode(lexical.get("remainder")), "xyz");
  for (const source of ["/s <~!~> def", "/s <~z def", "/answer //missing def"]) failure(() => execute(source), "unsupported-font");
  failure(() => execute("/s <~z~> def", { maxStringBytes: 3 }), "resource-limit");

  const reads = execute(`/f (abc\\r\\ndef\\nX) /ReusableStreamDecode filter def
    /initial f bytesavailable def /peek f fileposition def
    f 3 string readline /lineComplete exch def /line exch def
    /afterLine f fileposition def f read /readComplete exch def /byte exch def
    f 0 setfileposition f 3 string readstring /full exch def /prefix exch def
    f resetfile /resetPosition f fileposition def f flushfile /remaining f bytesavailable def
    /open f status def f closefile /closed f status def
    /hexfile (ABZC) << /EODCount 0 /EODString () >> /SubFileDecode filter def
    hexfile 2 string readhexstring /hexComplete exch def /hexBytes exch def`);
  assert.equal(reads.get("initial"), 10); assert.equal(reads.get("peek"), 0);
  assert.equal(new TextDecoder().decode(reads.get("line")), "abc"); assert.equal(reads.get("lineComplete"), true);
  assert.equal(reads.get("afterLine"), 5); assert.equal(reads.get("byte"), 100); assert.equal(reads.get("readComplete"), true);
  assert.equal(new TextDecoder().decode(reads.get("prefix")), "abc"); assert.equal(reads.get("full"), true);
  assert.equal(reads.get("resetPosition"), 0); assert.equal(reads.get("remaining"), 0);
  assert.equal(reads.get("open"), true); assert.equal(reads.get("closed"), false);
  assert.deepEqual([...reads.get("hexBytes")], [0xab]); assert.equal(reads.get("hexComplete"), false);
  const aliases = execute(`/owner currentfile def /same currentfile owner eq def
    (currentfile owner eq /nestedSame exch def) cvx exec`);
  assert.equal(aliases.get("same"), true, "currentfile references share the underlying file identity");
  assert.equal(aliases.get("nestedSame"), true, "executing a string does not replace the current executable file");
  const caught = execute(`
    { (abc) /ReusableStreamDecode filter 2 string readline } stopped pop
    /lineError $error /errorname get def clear
    { (XX>) /ASCIIHexDecode filter 2 string readstring } stopped pop
    /decodeError $error /errorname get def clear
    { (abc) /ReusableStreamDecode filter 0 string readstring } stopped pop
    /emptyReadError $error /errorname get def clear
  `);
  assert.equal(caught.get("lineError").value, "rangecheck");
  assert.equal(caught.get("decodeError").value, "ioerror");
  assert.equal(caught.get("emptyReadError").value, "rangecheck");

  const inline = concat(bytes("/owner currentdict def /add { pop pop 999 } def currentfile eexec "),
    encryptType1Bytes(concat(new Uint8Array(4), bytes("owner /answer 20 22 add put currentfile closefile ")), 55665),
    bytes("/trailer 3 def"));
  const decrypted = execute(inline);
  assert.equal(decrypted.get("answer"), 42, "eexec temporarily restores system operator lookup");
  assert.equal(decrypted.get("trailer"), 3, "closing encrypted currentfile resumes the cleartext source");
  console.log("Font PostScript file tests passed: reads, lines, hex, cursor/EOD semantics, lazy ASCII85/ASCIIHex/RunLength/SubFile/eexec, reusable files, snapshots, limits and cancellation.");
} finally { hooks.deregister(); }
