import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { deflateSync, inflateSync } from "node:zlib";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
const CONTENT = "1 0 0 rg 5 5 20 20 re f\n", METADATA = "<xmp>private metadata</xmp>", EXTRA = "q Q\n";
try {
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter, pdfAsciiValue } = await import("../src/pdf/nativeWriter.ts");
  const { PdfCosParser } = await import("../src/pdf/nativeCos.ts");
  const { validatePdfOutputProtection } = await import("../src/pdf/pdfProtection.ts");
  assert.deepEqual(validatePdfOutputProtection(), { mode: "preserve" });
  for (const invalid of [null, false, "remove", [], {}, { mode: "unknown" }, { mode: "password" },
    { mode: "password", password: "" }, { mode: "password", password: 123 }, { mode: "password", password: "x", ownerPassword: "" },
    { mode: "password", password: "x", ownerPassword: null }, { mode: "password", password: "x".repeat(128) }, { mode: "password", password: "Ω".repeat(64) }]) {
    assert.throws(() => validatePdfOutputProtection(invalid), /PDF|password/);
  }
  assert.equal(validatePdfOutputProtection({ mode: "password", password: "x".repeat(127) }).password.length, 127);
  const open = (bytes, password) => NativePdfDocument.open({ kind: "bytes", bytes }, { password, repair: "off" });
  const source = legacyFixture(), before = Buffer.from(source), document = await open(source, "legacy user");
  let plain, protectedBytes;
  const user = "ｓecret Ω e\u0301", owner = "owner ♫";
  try {
    const writer = new NativePdfWriter(document), page = document.getPage(0), changed = new Map(page.dictionary);
    changed.set("Edited", pdfAsciiValue("current secret")); changed.set("Repeated", pdfAsciiValue("current secret")); writer.set(page.ref, changed);
    plain = await writer.save(undefined, { protection: { mode: "remove" } });
    protectedBytes = await writer.save(undefined, { protection: { mode: "password", password: user, ownerPassword: owner } });
    assert.deepEqual(source, before, "protection changes leave source bytes untouched");
    assert(!page.dictionary.has("Edited"), "parser dictionaries stay immutable");
    // Default preserve still writes a true encrypted incremental revision.
    const preserved = await writer.save();
    assert.deepEqual(Buffer.from(preserved.subarray(0, source.length)), source);
    const preservedDocument = await open(preserved, "legacy owner"); await preservedDocument.close();
    await assert.rejects(writer.save(AbortSignal.abort(), { protection: { mode: "password", password: "canceled" } }), { name: "AbortError" });
  } finally { await document.close(); }
  for (const [bytes, password] of [[plain, undefined], [protectedBytes, user], [protectedBytes, owner], [protectedBytes, user.normalize("NFKC")]]) {
    const reopened = await open(bytes, password);
    try {
      assert.equal(reopened.info.metadata.title, "Secret title");
      assert.equal(Buffer.from(reopened.getPage(0).dictionary.get("Private").bytes).toString(), "nested secret");
      assert.equal(Buffer.from(reopened.getPage(0).dictionary.get("Edited").bytes).toString(), "current secret");
      const contents = await reopened.getDecodedPageContents(0);
      assert.equal(Buffer.from(contents[0]).toString(), CONTENT); assert.equal(Buffer.from(contents[1]).toString(), EXTRA);
      const metadata = await reopened.resolveValue(reopened.catalog.get("Metadata"));
      assert.equal(Buffer.from(await reopened.decodeStream(metadata)).toString(), METADATA);
      assert.deepEqual(metadata.dictionary.get("DP"), [null], "only the remaining Flate filter's parameter is retained");
      assert.equal(reopened.getWriterState().xref.repaired, false);
    } finally { await reopened.close(); }
    const raw = Buffer.from(bytes).toString("latin1");
    assert.equal((raw.match(/%PDF-/g) ?? []).length, 1); assert.equal((raw.match(/%%EOF/g) ?? []).length, 1);
    assert(!/\/Prev\b|\/ObjStm\b|\/Type\s*\/XRef\b|\/Crypt\b/.test(raw));
    assert(!raw.includes("ORPHAN_SECRET")); assert(!raw.includes(Buffer.from("ORPHAN_SECRET").toString("hex")));
  }
  assert(!Buffer.from(plain).includes(Buffer.from("/Encrypt")));
  for (const password of [undefined, "wrong", "legacy user", "legacy owner"]) {
    await assert.rejects(open(protectedBytes, password), error => error?.code === "encrypted");
  }
  const protectedDocument = await open(protectedBytes, user);
  try {
    const state = protectedDocument.getWriterState(), trailer = state.xref.trailers[0], dictionary = await protectedDocument.resolveDictionary(trailer.get("Encrypt"));
    const key = verifyR6(dictionary, user, owner), contentRef = protectedDocument.getPage(0).contents[0];
    const readRaw = ref => new PdfCosParser(protectedBytes, { position: state.xref.entries.get(ref.objectNumber).offset }).parseIndirectObject().value;
    const encryptedStream = readRaw(contentRef), decrypted = decryptCbc(key, encryptedStream.bytes);
    assert.equal(inflateSync(decrypted).toString(), CONTENT, "Node independently decrypts an actual AES256 content stream");
    const encryptedPage = readRaw(protectedDocument.getPage(0).ref);
    assert.equal(decryptCbc(key, encryptedPage.get("Private").bytes).toString(), "nested secret", "Node independently decrypts PDF strings");
    assert.notDeepEqual(encryptedPage.get("Edited").bytes, encryptedPage.get("Repeated").bytes, "equal strings receive independent random IVs");
    const encryptedMetadata = readRaw(protectedDocument.catalog.get("Metadata"));
    assert.equal(inflateSync(decryptCbc(key, encryptedMetadata.bytes)).toString(), METADATA, "Node independently decrypts metadata under the new handler");
    assert(!Buffer.from(protectedBytes).includes(Buffer.from(METADATA)), "new output also encrypts metadata");
    const writer = new NativePdfWriter(protectedDocument), another = await writer.save(undefined, { protection: { mode: "password", password: user, ownerPassword: owner } });
    const next = await open(another, user);
    try {
      const encryption = await next.resolveDictionary(next.getWriterState().xref.trailers[0].get("Encrypt"));
      assert.notDeepEqual(encryption.get("U").bytes, dictionary.get("U").bytes, "each output gets new salts");
      assert.notDeepEqual(encryption.get("UE").bytes, dictionary.get("UE").bytes, "each output gets a new random file key");
      assert.notDeepEqual(next.getWriterState().xref.trailers[0].get("ID"), trailer.get("ID"), "each protected rewrite gets fresh IDs");
    } finally { await next.close(); }
    const target = await open(plain);
    try {
      assert.equal(target.info.version, "1.7");
      const detached = await new NativePdfWriter(target).save(undefined, { encryptionSource: protectedDocument });
      assert.match(Buffer.from(detached.subarray(0, 9)).toString(), /^%PDF-2\.0/, "detached AES256 protection raises a fresh PDF1.7 header to PDF2.0");
      const reopened = await open(detached, user);
      try { assert.equal(reopened.info.version, "2.0"); assert.equal(Buffer.from((await reopened.getDecodedPageContents(0))[0]).toString(), CONTENT); }
      finally { await reopened.close(); }
    } finally { await target.close(); }
  } finally { await protectedDocument.close(); }

  // Retaining a legacy source handler on a fresh flattened PDF must use the
  // authenticated ID, not a conflicting newest trailer ID. Object 7 is the
  // legacy Encrypt dictionary, but ordinary content in the fresh target.
  const legacy = await open(source, "legacy user"), fresh = await open(writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /References [5 2 R 5 0 R] >>" }, { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 7 0 R >>" },
    { number: 5, generation: 2, body: "<< /Value (valid generation) >>" },
    { number: 7, body: tinyPdfStream("", "0 1 0 rg 10 10 20 20 re f\n") }
  ] }));
  try {
    const writer = new NativePdfWriter(fresh), detached = await writer.save(undefined, { encryptionSource: legacy });
    assert(!Buffer.from(detached).includes(Buffer.from("0 1 0 rg")), "old Encrypt object number never exempts new page content");
    for (const password of ["legacy user", "legacy owner"]) {
      const reopened = await open(detached, password);
      try {
        assert.equal(Buffer.from((await reopened.getDecodedPageContents(0))[0]).toString(), "0 1 0 rg 10 10 20 20 re f\n");
        const refs = reopened.catalog.get("References");
        assert.equal(Buffer.from((await reopened.resolveDictionary(refs[0])).get("Value").bytes).toString(), "valid generation");
        assert.equal(await reopened.resolveValue(refs[1]), null, "stale-generation references never shadow a valid shared resource");
      }
      finally { await reopened.close(); }
    }
    const policy = { mode: "password", password: "snapshot before" }, saving = writer.save(undefined, { protection: policy });
    policy.password = "mutated after"; policy.mode = "remove";
    const snapshot = await saving, opened = await open(snapshot, "snapshot before"); await opened.close();
    await assert.rejects(open(snapshot, "mutated after"), error => error?.code === "encrypted");
  } finally { await fresh.close(); await legacy.close(); }
  console.log("Native PDF protection: legacy compressed/Identity/metadata rewrites, independent R6 crypto, fresh salts/keys/IDs, handler preservation and cancellation passed.");
} finally { hooks.deregister(); }

function verifyR6(dictionary, password, ownerPassword) {
  assert.equal(dictionary.get("V"), 5); assert.equal(dictionary.get("R"), 6); assert.equal(dictionary.get("Length"), 256);
  const user = Buffer.from(dictionary.get("U").bytes), owner = Buffer.from(dictionary.get("O").bytes), empty = Buffer.alloc(0);
  const normalize = text => Buffer.from(text.normalize("NFKC")).subarray(0, 127), userPassword = normalize(password), ownerBytes = normalize(ownerPassword);
  assert.deepEqual(hash2B(userPassword, user.subarray(32, 40), empty), user.subarray(0, 32));
  assert.deepEqual(hash2B(ownerBytes, owner.subarray(32, 40), user), owner.subarray(0, 32));
  const key = decryptCbc(hash2B(userPassword, user.subarray(40, 48), empty), dictionary.get("UE").bytes, false);
  assert.deepEqual(decryptCbc(hash2B(ownerBytes, owner.subarray(40, 48), user), dictionary.get("OE").bytes, false), key);
  const cipher = createDecipheriv("aes-256-ecb", key, null); cipher.setAutoPadding(false);
  const perms = Buffer.concat([cipher.update(dictionary.get("Perms").bytes), cipher.final()]);
  assert.equal(perms.readInt32LE(0), dictionary.get("P")); assert.equal(perms.readUInt32LE(4), 0xffffffff); assert.equal(perms.subarray(8, 12).toString(), "Tadb");
  return key;
}
function hash2B(password, salt, user) {
  let key = createHash("sha256").update(Buffer.concat([password, salt, user])).digest();
  for (let round = 1; ; round++) {
    const block = Buffer.concat([password, key, user]), cipher = createCipheriv("aes-128-cbc", key.subarray(0, 16), key.subarray(16, 32));
    cipher.setAutoPadding(false); const data = Buffer.concat([cipher.update(Buffer.concat(Array(64).fill(block))), cipher.final()]);
    key = createHash(["sha256", "sha384", "sha512"][data.subarray(0, 16).reduce((a, b) => a + b, 0) % 3]).update(data).digest();
    if (round >= 64 && data.at(-1) <= round - 32) return key.subarray(0, 32);
  }
}
function decryptCbc(key, bytes, padding = true) {
  const data = Buffer.from(bytes), cipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, padding ? data.subarray(0, 16) : Buffer.alloc(16));
  cipher.setAutoPadding(padding); return Buffer.concat([cipher.update(padding ? data.subarray(16) : data), cipher.final()]);
}
function legacyFixture() {
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex"), id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const pad = text => Buffer.concat([Buffer.from(text), padding]).subarray(0, 32), md5 = (...parts) => createHash("md5").update(Buffer.concat(parts)).digest();
  let ownerKey = md5(pad("legacy owner")); for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  let owner = rc4(ownerKey, pad("legacy user")); for (let i = 1; i < 20; i++) owner = rc4(ownerKey.map(byte => byte ^ i), owner);
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  let key = md5(pad("legacy user"), owner, permissions, id, Buffer.alloc(4, 255)); for (let i = 0; i < 50; i++) key = md5(key);
  let user = rc4(key, md5(padding, id)); for (let i = 1; i < 20; i++) user = rc4(key.map(byte => byte ^ i), user);
  user = Buffer.concat([user, Buffer.alloc(16)]);
  const encrypted = (number, data) => {
    const suffix = Buffer.from([number & 255, number >> 8 & 255, number >> 16 & 255, 0, 0]), objectKey = md5(key, suffix, Buffer.from("sAlT"));
    const iv = Buffer.alloc(16, number), cipher = createCipheriv("aes-128-cbc", objectKey, iv);
    return Buffer.concat([iv, cipher.update(data), cipher.final()]);
  };
  const stream = (number, dictionary, data, encrypt = true) => {
    const bytes = encrypt ? encrypted(number, data) : data;
    return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from("\nendstream")]);
  };
  const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents [4 0 R 8 0 R] /Private (nested secret) >>", info = "<< /Title (Secret title) >>";
  const header = `3 0 5 ${Buffer.byteLength(page + "\n")} `;
  const objects = new Map([
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>")], [2, Buffer.from("<< /Type /Pages /Count 1 /Kids [3 0 R] >>")],
    [4, stream(4, "/Filter /FlateDecode", deflateSync(CONTENT))],
    [6, stream(6, "/Type /Metadata /Subtype /XML /Filter [/Crypt /FlateDecode] /DP [<< /Name /Identity >> null]", deflateSync(METADATA), false)],
    [7, Buffer.from(`<< /Filter /Standard /V 4 /R 4 /Length 128 /P -4 /EncryptMetadata false /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /CF << /StdCF << /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF >>`)],
    [8, stream(8, "/Filter /Crypt /DecodeParms << /Name /Identity >>", Buffer.from(EXTRA), false)],
    [9, stream(9, `/Type /ObjStm /N 2 /First ${Buffer.byteLength(header)} /Filter /FlateDecode`, deflateSync(header + page + "\n" + info))],
    [11, stream(11, "", Buffer.from("ORPHAN_SECRET"))]
  ]);
  const parts = [Buffer.from("%PDF-1.7\n")], offsets = new Map(); let length = parts[0].length;
  for (const [number, body] of objects) { const bytes = Buffer.concat([Buffer.from(`${number} 0 obj\n`), body, Buffer.from("\nendobj\n")]); offsets.set(number, length); parts.push(bytes); length += bytes.length; }
  offsets.set(10, length); const rows = [];
  for (let number = 0; number < 12; number++) {
    const row = Buffer.alloc(7), compressed = number === 3 || number === 5;
    row[0] = compressed ? 2 : offsets.has(number) ? 1 : 0; row.writeUInt32BE(compressed ? 9 : offsets.get(number) ?? 0, 1); row.writeUInt16BE(compressed ? number === 3 ? 0 : 1 : number === 0 ? 65535 : 0, 5); rows.push(row);
  }
  const xref = Buffer.concat(rows);
  parts.push(Buffer.from(`10 0 obj\n<< /Type /XRef /Size 12 /W [1 4 2] /Root 1 0 R /Info 5 0 R /Encrypt 7 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] /Length ${xref.length} >>\nstream\n`), xref, Buffer.from(`\nendstream\nendobj\nstartxref\n${length}\n%%EOF\n`));
  const bytes = Buffer.concat(parts), appended = Buffer.from(`xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 12 /Prev ${length} /ID [<deadbeef> <deadbeef>] >>\nstartxref\n${bytes.length}\n%%EOF\n`);
  return Buffer.concat([bytes, appended]);
}
function rc4(key, input) {
  const state = Array.from({ length: 256 }, (_, index) => index), result = Buffer.alloc(input.length);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]]; }
  for (let n = 0, i = 0, j = 0; n < input.length; n++) { i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]]; result[n] = input[n] ^ state[(state[i] + state[j]) & 255]; }
  return result;
}
