import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

// The fixtures below are encrypted by an independent reference of the ISO
// 32000-2 Standard security handler built on node:crypto, so the parser's own
// MD5/RC4/AES/SHA-2 code is never used to produce its expected input.
const PADDING = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
const FILE_ID = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const CONTENT = "0 0 m 50 50 l S\n";
const EXTRA_CONTENT = "BT ET\n";
const METADATA = "<?xpacket begin=''?><x:xmpmeta xmlns:x='adobe:ns:meta/'/><?xpacket end='r'?>";

try {
  const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { isPdfStream } = await import("../src/pdf/nativeCos.ts");

  const open = (bytes) => openNativePdfDocument({ kind: "bytes", bytes });

  async function expectPlaintext(bytes, algorithm, password = "user") {
    const document = await open(bytes);
    try {
      assert.equal(document.info.metadata.title, "Secret Title", `${algorithm} decrypts Info strings`);
      const contents = (await document.getDecodedPageContents(0)).map((part) => Buffer.from(part).toString("latin1"));
      assert.equal(contents[0], CONTENT, `${algorithm} decrypts content streams`);
      const pieceInfo = document.getPage(0).dictionary.get("PieceInfo");
      assert.equal(
        Buffer.from(pieceInfo.get("Data").get("Private")[0].bytes).toString("latin1"),
        "nested secret",
        `${algorithm} decrypts strings nested in arrays and dictionaries`
      );
      const metadata = await document.resolveValue(document.catalog.get("Metadata"));
      assert.equal(isPdfStream(metadata), true);
      assert.equal(Buffer.from(await document.decodeStream(metadata)).toString("latin1"), METADATA);
      const diagnostic = document.getDiagnostics().find((entry) => entry.code === "document.decrypted");
      assert.equal(diagnostic?.severity, "info");
      assert.equal(diagnostic?.details?.algorithm, algorithm);
      assert.equal(diagnostic?.details?.password, password);
      return contents;
    } finally {
      await document.close();
    }
  }

  await expectPlaintext(legacyPdf({ version: 1, revision: 2, keyBytes: 5 }), "RC4 40-bit");
  await expectPlaintext(legacyPdf({ version: 2, revision: 3, keyBytes: 16 }), "RC4 128-bit");

  // AESV2 with an encrypted object stream, a stream-level Identity crypt
  // filter and unencrypted metadata.
  const aes128 = await expectPlaintext(legacyPdf({
    version: 4,
    revision: 4,
    keyBytes: 16,
    method: "aes128",
    encryptMetadata: false,
    objectStream: true,
    identityStream: true
  }), "AES 128-bit");
  assert.equal(aes128[1], EXTRA_CONTENT, "a /Crypt /Identity stream is read without decryption");

  await expectPlaintext(aes256Pdf({}), "AES 256-bit");

  // Only the owner password is empty: Algorithm 7 recovers the user password.
  await expectPlaintext(
    legacyPdf({ version: 2, revision: 3, keyBytes: 16, userPassword: "secret", ownerPassword: "" }),
    "RC4 128-bit",
    "owner"
  );

  // A rewritten file can carry a different /ID beside a newer trailer; the
  // /ID written next to /Encrypt is the one used for key derivation.
  await expectPlaintext(
    legacyPdf({ version: 2, revision: 3, keyBytes: 16, objectStream: true, appendedId: "ffeeddccbbaa99887766554433221100" }),
    "RC4 128-bit"
  );

  for (const bytes of [
    legacyPdf({ version: 2, revision: 3, keyBytes: 16, userPassword: "secret" }),
    aes256Pdf({ userPassword: "secret" })
  ]) {
    await assert.rejects(open(bytes), (error) =>
      error?.code === "encrypted" && error.details?.reason === "password-required");
  }
  await assert.rejects(
    open(legacyPdf({ version: 2, revision: 3, keyBytes: 16, handler: "Adobe.PubSec" })),
    (error) => error?.code === "encrypted" && error.details?.reason === "security-handler"
  );
  console.log("Native PDF encryption tests passed.");
} finally {
  hooks.deregister();
}

function legacyPdf({
  version,
  revision,
  keyBytes,
  method = "rc4",
  userPassword = "",
  ownerPassword = "owner",
  encryptMetadata = true,
  objectStream = false,
  identityStream = false,
  appendedId = null,
  handler = "Standard"
}) {
  const permissions = -3904;
  let ownerKey = md5(pad(ownerPassword));
  if (revision >= 3) for (let round = 0; round < 50; round += 1) ownerKey = md5(ownerKey);
  ownerKey = ownerKey.subarray(0, keyBytes);
  let owner = rc4(ownerKey, pad(userPassword));
  if (revision >= 3) for (let round = 1; round <= 19; round += 1) owner = rc4(xorKey(ownerKey, round), owner);

  const permissionBytes = Buffer.alloc(4);
  permissionBytes.writeInt32LE(permissions);
  let fileKey = md5(
    pad(userPassword),
    owner,
    permissionBytes,
    FILE_ID,
    revision >= 4 && !encryptMetadata ? Buffer.from([0xff, 0xff, 0xff, 0xff]) : Buffer.alloc(0)
  );
  if (revision >= 3) for (let round = 0; round < 50; round += 1) fileKey = md5(fileKey.subarray(0, keyBytes));
  fileKey = fileKey.subarray(0, keyBytes);
  let user;
  if (revision === 2) {
    user = rc4(fileKey, PADDING);
  } else {
    user = rc4(fileKey, md5(PADDING, FILE_ID));
    for (let round = 1; round <= 19; round += 1) user = rc4(xorKey(fileKey, round), user);
    user = Buffer.concat([user, Buffer.alloc(16, 0x5a)]);
  }

  const cryptFilters = version === 4
    ? `/CF << /StdCF << /CFM /${method === "aes128" ? "AESV2" : "V2"} /AuthEvent /DocOpen /Length 16 >> >> ` +
      "/StmF /StdCF /StrF /StdCF "
    : "";
  const encrypt = `<< /Filter /${handler} /V ${version} /R ${revision} /Length ${keyBytes * 8} ${cryptFilters}` +
    `/O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P ${permissions}` +
    `${encryptMetadata ? "" : " /EncryptMetadata false"} >>`;
  const encryptor = (number, plain) => encryptLegacy(method, fileKey, number, plain);
  return documentBytes({ encryptor, encrypt, encryptMetadata, objectStream, identityStream, appendedId });
}

function aes256Pdf({ userPassword = "", ownerPassword = "owner" }) {
  const fileKey = createHash("sha256").update("file key").digest();
  const userBytes = Buffer.from(userPassword, "utf8");
  const ownerBytes = Buffer.from(ownerPassword, "utf8");
  // With an empty password these user salts pin Algorithm 2.B's termination:
  // the validation hash ends at round 64 on a final byte of exactly 32; the
  // key-salt hash would pass the byte test at round 63 and narrowly fails it
  // (33) at round 64. Any off-by-one in the round count or the comparison then
  // derives a different hash.
  const [userValidation, userKeySalt, ownerValidation, ownerKeySalt] =
    ["uv92", "uk3072", "ov", "ok"].map((label) => createHash("md5").update(label).digest().subarray(0, 8));
  const user = Buffer.concat([hash2B(userBytes, userValidation, Buffer.alloc(0)), userValidation, userKeySalt]);
  const userEncrypted = aesNoPadding(hash2B(userBytes, userKeySalt, Buffer.alloc(0)), fileKey);
  const owner = Buffer.concat([hash2B(ownerBytes, ownerValidation, user), ownerValidation, ownerKeySalt]);
  const ownerEncrypted = aesNoPadding(hash2B(ownerBytes, ownerKeySalt, user), fileKey);
  const encrypt = "<< /Filter /Standard /V 5 /R 6 /Length 256 " +
    "/CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF " +
    `/O <${owner.toString("hex")}> /U <${user.toString("hex")}> ` +
    `/OE <${ownerEncrypted.toString("hex")}> /UE <${userEncrypted.toString("hex")}> /P -3904 >>`;
  const encryptor = (number, plain) => aesCbc("aes-256-cbc", fileKey, number, plain);
  return documentBytes({ encryptor, encrypt, encryptMetadata: true, compressContent: true });
}

/**
 * One page, an Info title, nested page strings and an XMP stream. Encrypted
 * objects are written with an xref stream so an object stream can be used.
 */
function documentBytes({
  encryptor,
  encrypt,
  encryptMetadata,
  objectStream = false,
  identityStream = false,
  compressContent = false,
  appendedId = null
}) {
  const string = (number, text) => `<${encryptor(number, Buffer.from(text, "latin1")).toString("hex")}>`;
  const stream = (number, entries, payload) => {
    const encrypted = encryptor(number, payload);
    return Buffer.concat([
      Buffer.from(`<< ${entries} /Length ${encrypted.length} >>\nstream\n`),
      encrypted,
      Buffer.from("\nendstream")
    ]);
  };
  const contents = identityStream ? "[4 0 R 8 0 R]" : "4 0 R";
  const pageBody = (number) => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] " +
    `/Contents ${contents} /PieceInfo << /Data << /Private [${string(number, "nested secret")}] >> >> >>`;
  const infoBody = (number) => `<< /Title ${string(number, "Secret Title")} >>`;
  const content = compressContent
    ? stream(4, "/Filter /FlateDecode", deflateSync(Buffer.from(CONTENT)))
    : stream(4, "", Buffer.from(CONTENT));
  const metadata = encryptMetadata
    ? stream(6, "/Type /Metadata /Subtype /XML", Buffer.from(METADATA))
    : Buffer.from(`<< /Type /Metadata /Subtype /XML /Length ${METADATA.length} >>\nstream\n${METADATA}\nendstream`);

  const objects = new Map([
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>")],
    [2, Buffer.from("<< /Type /Pages /Count 1 /Kids [3 0 R] >>")],
    [4, content],
    [6, metadata],
    [7, Buffer.from(encrypt)]
  ]);
  if (identityStream) {
    objects.set(8, Buffer.from(
      `<< /Filter [/Crypt] /DecodeParms [<< /Name /Identity >>] /Length ${EXTRA_CONTENT.length} >>\n` +
      `stream\n${EXTRA_CONTENT}\nendstream`
    ));
  }
  const compressed = new Map();
  if (objectStream) {
    // Objects inside the stream are plain text; only the stream is encrypted.
    const members = [[3, pageBody(3).replace(/<[0-9a-f]+>/, "(nested secret)")],
      [5, infoBody(5).replace(/<[0-9a-f]+>/, "(Secret Title)")]];
    let header = "";
    let body = "";
    for (const [number, text] of members) {
      header += `${number} ${body.length} `;
      body += `${text}\n`;
      compressed.set(number, { stream: 9, index: compressed.size });
    }
    objects.set(9, stream(9, `/Type /ObjStm /N ${members.length} /First ${header.length}`, Buffer.from(header + body)));
  } else {
    objects.set(3, Buffer.from(pageBody(3)));
    objects.set(5, Buffer.from(infoBody(5)));
  }
  const trailer = `/Root 1 0 R /Info 5 0 R /Encrypt 7 0 R /ID [<${FILE_ID.toString("hex")}> <${FILE_ID.toString("hex")}>]`;
  const base = writeXrefStreamPdf(objects, compressed, trailer);
  return appendedId ? appendIdRevision(base, appendedId) : base.bytes;
}

function writeXrefStreamPdf(objects, compressed, trailer) {
  const parts = [Buffer.from("%PDF-1.7\n%\x80\x81\x82\x83\n", "latin1")];
  let length = parts[0].length;
  const offsets = new Map();
  for (const number of [...objects.keys()].sort((a, b) => a - b)) {
    offsets.set(number, length);
    const object = Buffer.concat([Buffer.from(`${number} 0 obj\n`), objects.get(number), Buffer.from("\nendobj\n")]);
    parts.push(object);
    length += object.length;
  }
  const xrefNumber = Math.max(...objects.keys(), ...compressed.keys()) + 1;
  offsets.set(xrefNumber, length);
  const rows = [];
  for (let number = 0; number <= xrefNumber; number += 1) {
    const entry = compressed.get(number);
    if (entry) rows.push(xrefRow(2, entry.stream, entry.index));
    else if (offsets.has(number)) rows.push(xrefRow(1, offsets.get(number), 0));
    else rows.push(xrefRow(0, 0, number === 0 ? 65_535 : 0));
  }
  const data = Buffer.concat(rows);
  parts.push(
    Buffer.from(`${xrefNumber} 0 obj\n<< /Type /XRef /Size ${xrefNumber + 1} /W [1 4 2] ${trailer} ` +
      `/Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${length}\n%%EOF\n`)
  );
  return { bytes: Buffer.concat(parts), xrefOffset: length, size: xrefNumber + 1 };
}

function appendIdRevision(base, id) {
  const offset = base.bytes.length;
  const row = xrefRow(1, offset, 0);
  const update = Buffer.concat([
    Buffer.from(`${base.size} 0 obj\n<< /Type /XRef /Size ${base.size + 1} /Index [${base.size} 1] /W [1 4 2] ` +
      `/Root 1 0 R /Prev ${base.xrefOffset} /ID [<${id}> <${id}>] /Length ${row.length} >>\nstream\n`),
    row,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${offset}\n%%EOF\n`)
  ]);
  return Buffer.concat([base.bytes, update]);
}

function xrefRow(type, field1, field2) {
  const row = Buffer.alloc(7);
  row.writeUInt8(type, 0);
  row.writeUInt32BE(field1, 1);
  row.writeUInt16BE(field2, 5);
  return row;
}

function encryptLegacy(method, fileKey, number, plain) {
  const suffix = Buffer.from([number & 0xff, (number >> 8) & 0xff, (number >> 16) & 0xff, 0, 0]);
  const aes = method === "aes128";
  const key = md5(fileKey, suffix, aes ? Buffer.from("sAlT") : Buffer.alloc(0))
    .subarray(0, Math.min(fileKey.length + 5, 16));
  return aes ? aesCbc("aes-128-cbc", key, number, plain) : rc4(key, plain);
}

function aesCbc(algorithm, key, number, plain) {
  const iv = createHash("md5").update(`iv ${number} ${plain.length}`).digest();
  const cipher = createCipheriv(algorithm, key, iv);
  return Buffer.concat([iv, cipher.update(plain), cipher.final()]);
}

function aesNoPadding(key, plain) {
  const cipher = createCipheriv("aes-256-cbc", key, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

/** ISO 32000-2 Algorithm 2.B. */
function hash2B(password, salt, userData) {
  let key = createHash("sha256").update(Buffer.concat([password, salt, userData])).digest();
  for (let round = 1; ; round += 1) {
    const block = Buffer.concat([password, key, userData]);
    const cipher = createCipheriv("aes-128-cbc", key.subarray(0, 16), key.subarray(16, 32));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(Buffer.concat(Array(64).fill(block))), cipher.final()]);
    let sum = 0;
    for (const byte of encrypted.subarray(0, 16)) sum += byte;
    key = createHash(["sha256", "sha384", "sha512"][sum % 3]).update(encrypted).digest();
    if (round >= 64 && encrypted.at(-1) <= round - 32) return key.subarray(0, 32);
  }
}

function md5(...parts) {
  return createHash("md5").update(Buffer.concat(parts)).digest();
}

function pad(password) {
  return Buffer.concat([Buffer.from(password, "latin1"), PADDING]).subarray(0, 32);
}

function xorKey(key, value) {
  return Buffer.from(key.map((byte) => byte ^ value));
}

function rc4(key, data) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(data.length);
  for (let index = 0, i = 0, j = 0; index < data.length; index += 1) {
    i = (i + 1) % 256;
    j = (j + state[i]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
    output[index] = data[index] ^ state[(state[i] + state[j]) % 256];
  }
  return output;
}
