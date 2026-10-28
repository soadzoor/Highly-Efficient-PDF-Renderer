import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter, pdfAsciiValue, pdfTextValue, pdfStreamValue, pdfNameValue, serializePdfValue, pdfNumberValue } = await import("../src/pdf/nativeWriter.ts");
  const open = (bytes, options = {}) => openNativePdfDocument({ kind: "bytes", bytes }, options);
  const original = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /Private (Keep catalog data) >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 2 R] /Count 1 >>" },
    { number: 3, generation: 2, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 0 0 100 100 re f\n") },
    { number: 5, body: "<< /Title (Original title) >>" }
  ], trailerEntries: "/Info 5 0 R /ID [<010203> <040506>]" });
  const before = original.slice(), document = await open(original);
  let saved;
  try {
    const writer = new NativePdfWriter(document), page = document.getPage(0);
    const added = writer.add(pdfStreamValue("0 0 1 rg 10 10 20 20 re f\n"));
    const changed = new Map(page.dictionary);
    changed.set("Contents", [page.contents, added]);
    changed.set("My /Name", pdfTextValue("Café 𝄞"));
    changed.set("PrivateArray", [true, null, -1.25e-10, pdfNameValue("A /Name"), pdfAsciiValue("literal ()\\ bytes")]);
    writer.set(page.ref, changed);
    saved = await writer.save();
    assert.deepEqual(original, before, "input bytes are never changed");
    assert.deepEqual(saved.subarray(0, original.length), original, "incremental output preserves original bytes exactly");
    assert.equal(page.dictionary.has("My /Name"), false, "copy-on-write leaves the live parser dictionary intact");
    assert.equal(page.ref.generation, 2, "fixture exercises a nonzero object generation");
  } finally { await document.close(); }
  const appended = await open(saved, { repair: "off" });
  let twice;
  try {
    assert.equal(appended.info.repaired, false);
    assert.equal(appended.info.metadata.title, "Original title");
    assert.equal(new TextDecoder().decode(appended.catalog.get("Private").bytes), "Keep catalog data");
    assert.equal(appended.getPage(0).ref.generation, 2);
    const values = appended.getPage(0).dictionary.get("PrivateArray");
    assert.deepEqual(values.slice(0, 3), [true, null, -1.25e-10]);
    assert.equal(values[3].value, "A /Name");
    assert.equal(new TextDecoder().decode(values[4].bytes), "literal ()\\ bytes");
    const text = appended.getPage(0).dictionary.get("My /Name").bytes;
    assert.equal(new TextDecoder("utf-16be").decode(text), "Café 𝄞");
    const contents = await appended.getDecodedPageContents(0);
    assert.equal(contents.length, 2);
    assert.match(new TextDecoder().decode(contents[1]), /0 0 1 rg/);
    const writer = new NativePdfWriter(appended), page = appended.getPage(0), changed = new Map(page.dictionary);
    changed.set("SecondSave", true); writer.set(page.ref, changed); twice = await writer.save();
    assert.deepEqual(twice.subarray(0, saved.length), saved, "a second incremental save preserves the previous revision");
    await assert.rejects(writer.save(AbortSignal.abort()), { name: "AbortError" });
  } finally { await appended.close(); }
  const reopened = await open(twice, { repair: "off" });
  try { assert.equal(reopened.getPage(0).dictionary.get("SecondSave"), true); }
  finally { await reopened.close(); }

  const damaged = new TextEncoder().encode(new TextDecoder().decode(original).replace(/startxref\n\d+/, "startxref\n999999999"));
  const repaired = await open(damaged, { repair: "safe" });
  let rebuilt;
  try {
    assert.equal(repaired.info.repaired, true);
    const writer = new NativePdfWriter(repaired), page = repaired.getPage(0), changed = new Map(page.dictionary);
    changed.set("Rebuilt", true); writer.set(page.ref, changed); rebuilt = await writer.save();
    assert.equal(new TextDecoder().decode(rebuilt).includes("/Prev"), false, "rewritten repaired sources do not link an invalid xref");
  } finally { await repaired.close(); }
  const strict = await open(rebuilt, { repair: "off" });
  try {
    assert.equal(strict.getPage(0).dictionary.get("Rebuilt"), true);
    assert.equal(strict.info.metadata.title, "Original title");
    assert.equal((await strict.getDecodedPageContents(0)).length, 1);
  } finally { await strict.close(); }
  assert.equal(pdfNumberValue(1e-12), "0.000000000001");
  assert.throws(() => serializePdfValue(NaN), /finite/);
  console.log("Native PDF writer: incremental revisions, generations, strings, immutable input, repaired rewrite and cancellation passed.");
} finally { hooks.deregister(); }
