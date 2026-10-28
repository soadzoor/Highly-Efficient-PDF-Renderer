import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter, pdfAsciiValue } = await import("../src/pdf/nativeWriter.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { changePdfProtection } = await import("../src/editorApi.ts");
  const firstPassword = "first pässword Ω", ownerPassword = "owner password", secondPassword = "second password";
  const bytes = fixture(), original = bytes.slice();
  const open = (bytes, password) => NativePdfDocument.open({ kind: "bytes", bytes }, { password, repair: "off" });
  const compile = async (bytes, password) => {
    const parser = await openPdf({ kind: "bytes", bytes }, { password });
    try { return await parser.compileVectorPage(0, { optimization: "none", vectorFallback: "error" }); }
    finally { await parser.close(); }
  };
  const output = async (editor, options) => new Uint8Array(await (await editor.savePdf(options)).arrayBuffer());
  const expectPasswordError = async (bytes, password, reason) => assert.rejects(open(bytes, password), error => {
    assert.equal(error.code, "encrypted"); assert.equal(error.details?.reason, reason); return true;
  });
  const encryption = async (bytes, password) => {
    const document = await open(bytes, password);
    try {
      const ref = document.getWriterState().xref.trailers.map(trailer => trailer.get("Encrypt")).find(value => value !== undefined);
      return ref ? await document.resolveDictionary(ref) : undefined;
    } finally { await document.close(); }
  };
  const assertRewrite = (saved, encrypted, prior) => {
    const raw = Buffer.from(saved).toString("latin1");
    assert.equal((raw.match(/%PDF-/g) ?? []).length, 1, "rewrites retain one PDF revision");
    assert.equal((raw.match(/%%EOF/g) ?? []).length, 1, "old revisions are absent");
    assert(!/\/Prev\b|\/ObjStm\b|\/XRefStm\b/.test(raw), "old revision/object-stream containers are absent");
    assert.equal(/\/Encrypt\b/.test(raw), encrypted);
    assert(!raw.includes("OLD_PRIVATE_HISTORY"));
    assert(!raw.toLowerCase().includes(Buffer.from("OLD_PRIVATE_HISTORY").toString("hex")), "unreachable original objects are not copied");
    if (prior) assert(!Buffer.from(saved).includes(Buffer.from(prior)), "a rewrite never prefixes the protected source");
  };
  const assertOldKeysAbsent = (saved, old) => {
    const raw = Buffer.from(saved).toString("latin1").toLowerCase();
    for (const key of ["O", "U", "OE", "UE", "Perms"]) if (old.get(key)?.bytes) {
      assert(!raw.includes(Buffer.from(old.get(key).bytes).toString("hex")), `old ${key} encryption material is absent`);
    }
  };
  const checkSourceStructure = async (saved, password, title = "Current title", sharedResources = false) => {
    const document = await open(saved, password);
    try {
      assert.equal(document.info.metadata.title, title);
      const metadata = await document.resolveValue(document.catalog.get("Metadata"));
      assert.equal(Buffer.from(await document.decodeStream(metadata)).toString(), "<x:xmpmeta>kept metadata</x:xmpmeta>");
      const one = document.catalog.get("Custom"), cycle = await document.resolveDictionary(one);
      const next = await document.resolveDictionary(cycle.get("Peer"));
      assert.equal(next.get("Peer").objectNumber, one.objectNumber, "shared cyclic references survive the rewrite");
      if (sharedResources) {
        const resources = await document.resolveDictionary(document.getPage(0).resources);
        const xObjects = await document.resolveDictionary(resources.get("XObject"));
        assert.equal(xObjects.get("One").objectNumber, xObjects.get("Two").objectNumber, "shared resources retain one identity");
      }
    } finally { await document.close(); }
  };

  const scene = await compile(bytes), initial = await openEditorSession(scene, { sourcePdf: bytes });
  let protectedBytes;
  try {
    const unchanged = await output(initial);
    assert.deepEqual(unchanged.subarray(0, bytes.length), bytes, "default preserve retains the established incremental save");
    protectedBytes = await output(initial, { protection: { mode: "password", password: firstPassword, ownerPassword } });
    assertRewrite(protectedBytes, true, bytes);
    assert.deepEqual(bytes, original, "protecting output leaves caller source bytes unchanged");
  } finally { initial.dispose(); }
  await expectPasswordError(protectedBytes, undefined, "password-required");
  await expectPasswordError(protectedBytes, "wrong", "password-incorrect");
  const protectedDictionary = await encryption(protectedBytes, firstPassword);
  verifyRevision6(protectedDictionary, firstPassword, ownerPassword);
  await checkSourceStructure(protectedBytes, ownerPassword, "Original title", true);

  // Preserve a real superseded encrypted revision before removing or rekeying.
  const document = await open(protectedBytes, firstPassword);
  let revised;
  try {
    const writer = new NativePdfWriter(document), info = document.getWriterState().xref.trailers.map(trailer => trailer.get("Info")).find(Boolean);
    writer.set(info, new Map([["Title", pdfAsciiValue("Current title")]]));
    revised = await writer.save();
    assert.deepEqual(revised.subarray(0, protectedBytes.length), protectedBytes);
  } finally { await document.close(); }
  const protectedOriginal = revised.slice(), protectedScene = await compile(revised, firstPassword);
  const editor = await openEditorSession(protectedScene, { sourcePdf: revised, password: firstPassword });
  let removed, rekeyed, hepScene;
  try {
    editor.selectPrimitives([{ kind: "fill", index: 0 }]); editor.transformSelection([1, 0, 0, 1, 5, 0]);
    const shape = editor.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 10, y: 55, width: 15, height: 10, color: "green", fill: "green" });
    const preserved = await output(editor);
    assert.deepEqual(preserved.subarray(0, revised.length), revised, "default preserve retains the loaded password and old revisions");
    await expectPasswordError(preserved, undefined, "password-required");
    await checkSourceStructure(preserved, firstPassword);
    removed = await output(editor, { protection: { mode: "remove" } });
    assertRewrite(removed, false, revised); assertOldKeysAbsent(removed, protectedDictionary);
    await checkSourceStructure(removed);
    const plainScene = await compile(removed);
    assert(plainScene.annotations.some(annotation => annotation.name === shape), "removal preserves new editable annotations");
    assert.equal(getScenePrimitive(plainScene, { kind: "fill", index: 0 }).bounds.minX, 15, "removal preserves source geometry edits");
    rekeyed = await output(editor, { protection: { mode: "password", password: secondPassword, ownerPassword: "new owner" } });
    assertRewrite(rekeyed, true, revised); assertOldKeysAbsent(rekeyed, protectedDictionary);
    await expectPasswordError(rekeyed, firstPassword, "password-incorrect");
    await expectPasswordError(rekeyed, ownerPassword, "password-incorrect");
    await checkSourceStructure(rekeyed, secondPassword);
    assert((await compile(rekeyed, secondPassword)).annotations.some(annotation => annotation.name === shape));
    verifyRevision6(await encryption(rekeyed, secondPassword), secondPassword, "new owner");
    const flattened = await output(editor, { flatten: true, protection: { mode: "password", password: "flat password" } });
    await expectPasswordError(flattened, undefined, "password-required");
    const flat = await compile(flattened, "flat password");
    assert.equal(flat.annotations?.length ?? 0, 0); assert(flat.fillPathCount >= plainScene.fillPathCount);
    const flatPreserved = await output(editor, { flatten: true });
    await expectPasswordError(flatPreserved, undefined, "password-required");
    assert.equal((await compile(flatPreserved, firstPassword)).annotations?.length ?? 0, 0);
    assert.equal((await compile(flatPreserved, ownerPassword)).fillPathCount, flat.fillPathCount, "default flatten preserves both authenticated source passwords");
    const flatRemoved = await output(editor, { flatten: true, protection: { mode: "remove" } });
    assertRewrite(flatRemoved, false); assert.equal((await compile(flatRemoved)).fillPathCount, flat.fillPathCount);
    const hep = await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    hepScene = await loadSceneFromHep(await hep.arrayBuffer());
    assert.deepEqual(revised, protectedOriginal, "editing, removal and rekeying never mutate the loaded protected source");
  } finally { editor.dispose(); }

  // HEP retains rendered geometry rather than the source security handler.
  for (const flatten of [false, true]) {
    const hepEditor = await openEditorSession(hepScene);
    try {
      const shape = hepEditor.addObject({ kind: "shape", pageIndex: 0, shape: "ellipse", x: 65, y: 55, width: 12, height: 8, color: "blue", fill: "blue" });
      const password = flatten ? "HEP flat password" : "HEP editable password";
      const saved = await output(hepEditor, { flatten, protection: { mode: "password", password } });
      assertRewrite(saved, true);
      await expectPasswordError(saved, undefined, "password-required");
      await expectPasswordError(saved, "wrong", "password-incorrect");
      const loaded = await compile(saved, password);
      assert(loaded.fillPathCount >= hepScene.fillPathCount + 1, "source-free protection preserves original and new geometry");
      assert.equal(loaded.annotations.some(annotation => annotation.name === shape), !flatten);
      const plain = await output(hepEditor, { flatten, protection: { mode: "remove" } });
      assertRewrite(plain, false);
      assert.equal((await compile(plain)).fillPathCount, loaded.fillPathCount);
    } finally { hepEditor.dispose(); }
  }
  assert.deepEqual(bytes, original);
  const direct = new Uint8Array(await (await changePdfProtection(rekeyed, { mode: "remove" }, { password: secondPassword })).arrayBuffer());
  assertRewrite(direct, false, rekeyed); await checkSourceStructure(direct);
  assert.equal((await compile(direct)).fillPathCount, (await compile(removed)).fillPathCount, "the direct public helper preserves edited geometry without scene reconstruction");
  await assert.rejects(changePdfProtection(rekeyed, { mode: "remove" }), error => error?.details?.reason === "password-required");
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(changePdfProtection(bytes, { mode: "password", password: "canceled" }, { signal: canceled.signal }), error => error?.name === "AbortError");
  console.log("Editor PDF protection: preserve, remove, rekey, owner/user passwords, full rewrites, edited geometry, HEP and flattened outputs passed.");
} finally { hooks.deregister(); }

function fixture() {
  return writeTinyPdf({ trailerEntries: "/Info 5 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]", objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /Metadata 7 0 R /Custom 8 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /XObject << /One 10 0 R /Two 10 0 R >> >> >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 10 10 20 20 re f /One Do q 1 0 0 1 0 15 cm /Two Do Q") },
    { number: 5, body: "<< /Title (Original title) >>" },
    { number: 6, body: "<< /Private (OLD_PRIVATE_HISTORY) >>" },
    { number: 7, body: tinyPdfStream("/Type /Metadata /Subtype /XML", "<x:xmpmeta>kept metadata</x:xmpmeta>") },
    { number: 8, body: "<< /Peer 9 0 R /Label (shared object) >>" },
    { number: 9, body: "<< /Peer 8 0 R >>" },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << >>", "0 0 1 rg 45 10 10 10 re f") }
  ] });
}

// Independent node:crypto verification of ISO 32000-2 algorithms 2.B, 8-10.
function verifyRevision6(dictionary, password, ownerPassword) {
  assert.equal(dictionary.get("V"), 5); assert.equal(dictionary.get("R"), 6); assert.equal(dictionary.get("Length"), 256);
  const bytes = key => Buffer.from(dictionary.get(key).bytes), user = bytes("U"), owner = bytes("O");
  const normalized = text => Buffer.from(text.normalize("NFKC")).subarray(0, 127);
  const userPassword = normalized(password), ownerBytes = normalized(ownerPassword);
  assert.equal(user.length, 48); assert.equal(owner.length, 48);
  assert.deepEqual(hash2B(userPassword, user.subarray(32, 40), Buffer.alloc(0)), user.subarray(0, 32));
  assert.deepEqual(hash2B(ownerBytes, owner.subarray(32, 40), user), owner.subarray(0, 32));
  const decrypt = (key, data) => { const cipher = createDecipheriv("aes-256-cbc", key, Buffer.alloc(16)); cipher.setAutoPadding(false); return Buffer.concat([cipher.update(data), cipher.final()]); };
  const fileKey = decrypt(hash2B(userPassword, user.subarray(40, 48), Buffer.alloc(0)), bytes("UE"));
  assert.deepEqual(decrypt(hash2B(ownerBytes, owner.subarray(40, 48), user), bytes("OE")), fileKey);
  const cipher = createDecipheriv("aes-256-ecb", fileKey, null); cipher.setAutoPadding(false);
  const permissions = Buffer.concat([cipher.update(bytes("Perms")), cipher.final()]);
  assert.equal(permissions.readInt32LE(0), dictionary.get("P")); assert.equal(permissions.readUInt32LE(4), 0xffffffff);
  assert.equal(permissions.subarray(8, 12).toString(), "Tadb", "AES-256 permissions and metadata encryption flag are valid");
}
function hash2B(password, salt, userData) {
  let key = createHash("sha256").update(Buffer.concat([password, salt, userData])).digest();
  for (let round = 1; ; round++) {
    const block = Buffer.concat([password, key, userData]), cipher = createCipheriv("aes-128-cbc", key.subarray(0, 16), key.subarray(16, 32));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(Buffer.concat(Array(64).fill(block))), cipher.final()]);
    const sum = encrypted.subarray(0, 16).reduce((a, b) => a + b, 0);
    key = createHash(["sha256", "sha384", "sha512"][sum % 3]).update(encrypted).digest();
    if (round >= 64 && encrypted.at(-1) <= round - 32) return key.subarray(0, 32);
  }
}
