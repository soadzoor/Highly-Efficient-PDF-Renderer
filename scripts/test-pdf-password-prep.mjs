import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { preparePdfPassword } = await import("../src/pdf/pdfPasswordPrep.ts");
  const { validatePdfOutputProtection } = await import("../src/pdf/pdfProtection.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  // RFC 4013 examples plus Unicode-3.2 mapping, prohibited-output and D.1/D.2
  // boundaries. Query-string behavior deliberately permits unassigned emoji.
  const examples = [
    ["I\u00adX", "IX"], ["user", "user"], ["USER", "USER"], ["\u00aa", "a"], ["\u2168", "IX"],
    ["a\u00a0b\u1680c\u2000d\u202fe\u205ff\u3000g", "a b c d e f g"],
    ["a\u034fb\u1806c\u180bd\u200ce\u200df\u2060g\ufe0fh\ufeffi", "abcdefghi"],
    ["left\u200bright", "left right"], ["e\u0301", "é"], ["😀🫠", "😀🫠"],
    ["ا123ب", "ا123ب"], ["ا١٢٣ب", "ا١٢٣ب"], ["א 1 ב", "א 1 ב"]
  ];
  for (const [input, expected] of examples) assert.equal(preparePdfPassword(input), expected, JSON.stringify(input));
  for (const input of ["\u0007", "\u007f", "\u0085", "\ue000", "\u{f0000}", "\ufdd0", "\u{1fffe}",
    "\ud800", "\udfff", "\ufff9", "\u2ff0", "\u2028", "\u202d", "\u{e0001}", "\u{e0020}",
    "ا1", "1ا", "اaب", "אΩב", "ا\u0301"]) {
    assert.throws(() => preparePdfPassword(input), /prohibited|bidirectional/, JSON.stringify(input));
    assert.throws(() => validatePdfOutputProtection({ mode: "password", password: input }), /prohibited|bidirectional/);
  }
  assert.equal(preparePdfPassword("\u00ad\ufe0f"), "");
  assert.throws(() => validatePdfOutputProtection({ mode: "password", password: "\u00ad\ufe0f" }), /empty/);
  assert.throws(() => validatePdfOutputProtection({ mode: "password", password: "x", ownerPassword: "\u00ad" }), /empty/);
  assert.doesNotThrow(() => validatePdfOutputProtection({ mode: "password", password: "x".repeat(127) + "\u00ad" }));

  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }, { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0 0 m 10 10 l S\n") }
  ] });
  const open = (bytes, password) => NativePdfDocument.open({ kind: "bytes", bytes }, { password, repair: "off" });
  const document = await open(bytes), ownerPassword = "owner\u00ad\u00a0\u2168", preparedOwner = "owner IX";
  try {
    for (const [password, prepared] of [["I\u00adX\u200cZ", "IXZ"], ["left\u00a0right\u200bend", "left right end"], ["ا123ب", "ا123ب"], ["emoji 😀🫠", "emoji 😀🫠"]]) {
      const saved = await new NativePdfWriter(document).save(undefined, { protection: { mode: "password", password, ownerPassword } });
      for (const candidate of [password, prepared, ownerPassword, preparedOwner]) {
        const reopened = await open(saved, candidate);
        try {
          assert.equal(Buffer.from((await reopened.getDecodedPageContents(0))[0]).toString(), "0 0 m 10 10 l S\n");
          const encrypt = await reopened.resolveDictionary(reopened.getWriterState().xref.trailers[0].get("Encrypt"));
          const user = Buffer.from(encrypt.get("U").bytes), owner = Buffer.from(encrypt.get("O").bytes);
          assert.deepEqual(hash2B(Buffer.from(prepared), user.subarray(32, 40), Buffer.alloc(0)), user.subarray(0, 32), "Node authenticates the literal prepared user password");
          assert.deepEqual(hash2B(Buffer.from(preparedOwner), owner.subarray(32, 40), user), owner.subarray(0, 32), "Node authenticates the literal prepared owner password");
        } finally { await reopened.close(); }
      }
    }
  } finally { await document.close(); }
  console.log("PDF password preparation: RFC4013 examples, Unicode mappings/prohibitions/bidi, modern emoji and prepared user/owner authentication passed.");
} finally { hooks.deregister(); }

function hash2B(password, salt, user) {
  let key = createHash("sha256").update(Buffer.concat([password, salt, user])).digest();
  for (let round = 1; ; round++) {
    const sequence = Buffer.concat([password, key, user]), cipher = createCipheriv("aes-128-cbc", key.subarray(0, 16), key.subarray(16, 32));
    cipher.setAutoPadding(false); const data = Buffer.concat([cipher.update(Buffer.concat(Array(64).fill(sequence))), cipher.final()]);
    key = createHash(["sha256", "sha384", "sha512"][data.subarray(0, 16).reduce((a, b) => a + b, 0) % 3]).update(data).digest();
    if (round >= 64 && data.at(-1) <= round - 32) return key.subarray(0, 32);
  }
}
