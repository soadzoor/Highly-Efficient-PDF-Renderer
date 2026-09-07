import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const {
    importNativeCidToUnicodeShard,
    NATIVE_CID_TO_UNICODE_COLLECTIONS,
    NATIVE_CID_TO_UNICODE_METADATA,
    NATIVE_CID_TO_UNICODE_SOURCE_COMMIT,
    NATIVE_CID_TO_UNICODE_SOURCE_TREE_SHA256
  } = await import("../src/pdf/cmaps/unicodeGenerated/registry.ts");
  const {
    loadNativeCidToUnicode,
    nativeCidToUnicodeCollection
  } = await import("../src/pdf/nativeCidUnicode.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");

  assert.equal(NATIVE_CID_TO_UNICODE_SOURCE_COMMIT, "2dd5e53fb74a01718b9dfd448a0d1cce6fff2aa5");
  assert.equal(
    NATIVE_CID_TO_UNICODE_SOURCE_TREE_SHA256,
    "464f4a9f43cc340dc0d03df28ccab42202a7e12f302813d4519e1572607c6be7"
  );
  assert.deepEqual(
    [...NATIVE_CID_TO_UNICODE_COLLECTIONS],
    ["CNS1", "GB1", "Japan1", "KR", "Korea1"]
  );

  const manifest = JSON.parse(await readFile(
    new URL("../src/pdf/cmaps/unicodeGenerated/manifest.json", import.meta.url),
    "utf8"
  ));
  assert.equal(manifest.format, "HEPR-CID-Unicode-1");
  assert.equal(manifest.sourceCommit, NATIVE_CID_TO_UNICODE_SOURCE_COMMIT);
  assert.equal(manifest.sourceTreeSha256, NATIVE_CID_TO_UNICODE_SOURCE_TREE_SHA256);
  assert.equal(manifest.license, "BSD-3-Clause");
  assert.equal(
    manifest.licenseSha256,
    "feb8b068a417681821823ef2e8995072aa111121fa11f8664038f78717f4497c"
  );
  const manifestByCollection = new Map(
    manifest.resources.map((resource) => [resource.collection, resource])
  );
  assert.deepEqual(
    [...manifestByCollection.keys()],
    [...NATIVE_CID_TO_UNICODE_COLLECTIONS]
  );

  let totalBytes = 0;
  for (const collection of NATIVE_CID_TO_UNICODE_COLLECTIONS) {
    const metadata = NATIVE_CID_TO_UNICODE_METADATA[collection];
    assert.ok(Object.isFrozen(metadata));
    const manifestEntry = manifestByCollection.get(collection);
    assert.ok(manifestEntry, `${collection} is present in the HCU1 manifest`);
    for (const field of [
      "registry", "ordering", "supplement", "maxCid", "mappingCount", "shardByteLength"
    ]) {
      assert.equal(metadata[field], manifestEntry[field], `${collection} ${field}`);
    }
    assert.match(manifestEntry.sourceSha256, /^[0-9a-f]{64}$/);
    assert.match(manifestEntry.shardSha256, /^[0-9a-f]{64}$/);
    assert.equal(
      manifestEntry.scalarMappingCount + manifestEntry.sequenceMappingCount,
      manifestEntry.mappingCount
    );
    const encoded = await importNativeCidToUnicodeShard(collection);
    const bytes = Buffer.from(encoded, "base64");
    totalBytes += bytes.byteLength;
    assert.equal(bytes.byteLength, metadata.shardByteLength, collection);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      manifestEntry.shardSha256,
      collection
    );
    const shard = await loadNativeCidToUnicode(collection);
    assert.ok(Object.isFrozen(shard));
    assert.ok(Object.isFrozen(shard.systemInfo));
    assert.deepEqual(shard.systemInfo, {
      registry: "Adobe",
      ordering: collection,
      supplement: metadata.supplement
    });
    assert.equal(shard.maxCid, metadata.maxCid);
    assert.equal(shard.mappingCount, metadata.mappingCount);
    assert.equal(shard.unicodeForCid(0) !== null, true, `${collection} maps CID 0`);
    assert.throws(() => shard.unicodeForCid(-1), RangeError);
    assert.throws(() => shard.unicodeForCid(0x1_0000), RangeError);
  }
  assert.equal(totalBytes, 470_324);

  const japan = await loadNativeCidToUnicode("Japan1");
  assert.equal(japan.unicodeForCid(633), "\u3000");
  assert.equal(japan.unicodeForCid(8295), "XIII", "multi-scalar mappings remain sequences");
  assert.equal(
    japan.unicodeForCid(1133),
    "\u9022\uDB40\uDD00",
    "supplementary variation selectors remain paired"
  );
  assert.equal(japan.unicodeForCid(23_060), null);

  const gb = await loadNativeCidToUnicode("GB1");
  assert.notEqual(gb.unicodeForCid(30_283), null);
  assert.equal(gb.unicodeForCid(30_284), null, "the official Supplement 5 tail remains uncovered");

  const korea = await loadNativeCidToUnicode("Korea1");
  assert.equal(korea.unicodeForCid(8_193), null, "official sparse collection holes stay unmapped");

  assert.equal(await loadNativeCidToUnicode("Japan1"), japan, "decoded shards are cached");
  assert.equal(
    nativeCidToUnicodeCollection({ registry: "Adobe", ordering: "Japan1", supplement: 7 }),
    "Japan1"
  );
  assert.equal(
    nativeCidToUnicodeCollection({ registry: "Adobe", ordering: "Manga1", supplement: 0 }),
    null
  );
  assert.equal(
    nativeCidToUnicodeCollection({ registry: "Other", ordering: "Japan1", supplement: 7 }),
    null
  );
  const controller = new AbortController();
  controller.abort("fixture cancellation");
  await assert.rejects(
    loadNativeCidToUnicode("CNS1", controller.signal),
    (error) => error instanceof PdfError && error.code === "aborted"
  );
  await assert.rejects(
    loadNativeCidToUnicode("Manga1"),
    (error) => error instanceof PdfError &&
      error.code === "unsupported-font" &&
      error.details?.reason === "font-cid-unicode-not-bundled"
  );
} finally {
  hooks.deregister();
}

console.log("native CID-to-Unicode asset tests passed");
