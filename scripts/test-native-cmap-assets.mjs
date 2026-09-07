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
    NATIVE_CMAP_SOURCE_ARCHIVE_SHA256,
    NATIVE_CMAP_SOURCE_TREE_SHA256,
    NATIVE_CMAP_SOURCE_TAG,
    NATIVE_PREDEFINED_CMAP_NAMES,
    importNativePredefinedCMapShard
  } = await import("../src/pdf/cmaps/generated/registry.ts");
  const { loadNativePredefinedCMap } = await import("../src/pdf/nativeCMaps.ts");
  const { parseNativePdfFont } = await import("../src/pdf/nativeFont.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");

  assert.equal(NATIVE_CMAP_SOURCE_TAG, "20231115");
  assert.equal(
    NATIVE_CMAP_SOURCE_ARCHIVE_SHA256,
    "a88c3beee8d2f139b47f9d7e932ec198be24991dd46fcaef2961b4b5ea855ea2"
  );
  assert.equal(
    NATIVE_CMAP_SOURCE_TREE_SHA256,
    "94d706b3864e4d596a81389e9edbab69b42cd969a872ee5b74c7ee49b7148f76"
  );
  assert.equal(NATIVE_PREDEFINED_CMAP_NAMES.length, 202);

  const manifest = JSON.parse(await readFile(
    new URL("../src/pdf/cmaps/generated/manifest.json", import.meta.url),
    "utf8"
  ));
  assert.equal(manifest.format, "HEPR-CMap-3");
  assert.equal(manifest.sourceTag, NATIVE_CMAP_SOURCE_TAG);
  assert.equal(manifest.sourceArchiveSha256, NATIVE_CMAP_SOURCE_ARCHIVE_SHA256);
  assert.equal(manifest.sourceTreeSha256, NATIVE_CMAP_SOURCE_TREE_SHA256);
  assert.equal(manifest.resources.length, NATIVE_PREDEFINED_CMAP_NAMES.length);
  const manifestByName = new Map(manifest.resources.map((resource) => [resource.name, resource]));
  assert.deepEqual(
    [...NATIVE_PREDEFINED_CMAP_NAMES].sort(),
    [...manifestByName.keys()].sort(),
    "the compact runtime registry and provenance manifest cover the same resources"
  );
  const entries = NATIVE_PREDEFINED_CMAP_NAMES.map((name) => [name, manifestByName.get(name)]);

  let totalBytes = 0;
  const loadedShards = new Map();
  for (const [name, metadata] of entries) {
    assert.ok(metadata, `${name} is present in the provenance manifest`);
    assert.match(metadata.sourcePath, /\/CMap\//);
    assert.match(metadata.sourceSha256, /^[0-9a-f]{64}$/);
    assert.match(metadata.shardSha256, /^[0-9a-f]{64}$/);
    const encoded = await importNativePredefinedCMapShard(name);
    const bytes = Buffer.from(encoded, "base64");
    assert.equal(bytes.byteLength, metadata.shardByteLength, name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.shardSha256, name);
    totalBytes += bytes.byteLength;

    const shard = await loadNativePredefinedCMap(name);
    loadedShards.set(name, shard);
    assert.equal(shard.name, name);
    assert.equal(shard.baseName, metadata.baseName);
    assert.equal(shard.writingMode, metadata.writingMode);
    assert.equal(shard.codeSpaces.length, metadata.codeSpaceCount);
    assert.equal(shard.cidRanges.reduce((sum, ranges) => sum + ranges.length, 0), metadata.rangeCount);
    assert.equal(shard.mappingCount, metadata.mappingCount);
    assert.equal(shard.notdefRanges.reduce((sum, ranges) => sum + ranges.length, 0), metadata.notdefRangeCount);
    assert.equal(shard.notdefMappingCount, metadata.notdefMappingCount);
    assert.deepEqual(shard.systemInfo, {
      registry: metadata.registry,
      ordering: metadata.ordering,
      supplement: metadata.supplement
    });
    assert.ok(Object.isFrozen(shard));
    assert.ok(Object.isFrozen(shard.cidRanges));
    assert.ok(Object.isFrozen(shard.notdefRanges));
    for (let length = 0; length < 4; length += 1) {
      let previousEnd = -1;
      for (const range of shard.cidRanges[length]) {
        assert.ok(range.start > previousEnd, `${name} byte-${length + 1} ranges overlap`);
        assert.ok(range.end >= range.start);
        assert.ok(range.firstCid + range.end - range.start <= 0xffff);
        previousEnd = range.end;
      }
      previousEnd = -1;
      for (const range of shard.notdefRanges[length]) {
        assert.ok(range.start > previousEnd, `${name} byte-${length + 1} notdef ranges overlap`);
        assert.ok(range.end >= range.start);
        assert.ok(range.cid >= 0 && range.cid <= 0xffff);
        previousEnd = range.end;
      }
    }
  }
  assert.equal(totalBytes, 1_699_404);

  const identityResolver = {
    async resolveValue(value) { return value; },
    async decodeStream(value) { return value.bytes; }
  };
  for (const [name] of entries) {
    const expected = firstEffectiveMapping(name, loadedShards);
    const systemInfo = effectiveSystemInfo(name, loadedShards);
    assert.ok(expected, `/${name} has no effective CID mapping`);
    let font;
    try {
      font = await parseNativePdfFont(new Map([
        ["Subtype", pdfName("Type0")],
        ["BaseFont", pdfName("CMapFixture")],
        ["Encoding", pdfName(name)],
        ["DescendantFonts", [new Map([
          ["Subtype", pdfName("CIDFontType2")],
          ["CIDSystemInfo", pdfCidSystemInfo(systemInfo)]
        ])]]
      ]), identityResolver);
    } catch (error) {
      error.message = `/${name}: ${error.message}`;
      throw error;
    }
    const mapped = font.decode(codeBytes(expected.code, expected.byteLength));
    assert.equal(mapped.cid, expected.cid, `/${name} maps the selected source code`);
    assert.equal(font.writingMode, loadedShards.get(name).writingMode, `/${name} writing mode`);
  }

  for (const [name, code, expectedCid] of [
    ["GBT-EUC-H", 0x00, 7716],
    ["KSC-EUC-H", 0x1f, 8094]
  ]) {
    const systemInfo = effectiveSystemInfo(name, loadedShards);
    const font = await parseNativePdfFont(new Map([
      ["Subtype", pdfName("Type0")],
      ["BaseFont", pdfName("NotdefFixture")],
      ["Encoding", pdfName(name)],
      ["DescendantFonts", [new Map([
        ["Subtype", pdfName("CIDFontType2")],
        ["CIDSystemInfo", pdfCidSystemInfo(systemInfo)]
      ])]]
    ]), identityResolver);
    assert.equal(font.decode(Uint8Array.of(code)).cid, expectedCid, `/${name} notdef CID`);
  }

  const cachedLeft = await loadNativePredefinedCMap("90ms-RKSJ-H");
  const cachedRight = await loadNativePredefinedCMap("90ms-RKSJ-H");
  assert.equal(cachedLeft, cachedRight);
  const controller = new AbortController();
  controller.abort("fixture cancellation");
  await assert.rejects(
    loadNativePredefinedCMap("90ms-RKSJ-H", controller.signal),
    (error) => error instanceof PdfError && error.code === "aborted"
  );
  await assert.rejects(
    loadNativePredefinedCMap("Definitely-Not-A-CMap"),
    (error) => error instanceof PdfError && error.code === "unsupported-font"
  );
} finally {
  hooks.deregister();
}

console.log("native generated CMap asset tests passed");

function firstEffectiveMapping(name, shards, seen = new Set()) {
  assert.equal(seen.has(name), false, `CMap inheritance cycle through /${name}`);
  seen.add(name);
  const shard = shards.get(name);
  for (let byteLength = 1; byteLength <= 4; byteLength += 1) {
    const range = shard.cidRanges[byteLength - 1][0];
    if (range) return { code: range.start, byteLength, cid: range.firstCid };
  }
  return shard.baseName === null ? null : firstEffectiveMapping(shard.baseName, shards, seen);
}

function effectiveSystemInfo(name, shards, seen = new Set()) {
  assert.equal(seen.has(name), false, `CMap inheritance cycle through /${name}`);
  seen.add(name);
  const shard = shards.get(name);
  if (shard.baseName === null || shard.systemInfo.ordering === "Identity") {
    return shard.systemInfo;
  }
  const inherited = effectiveSystemInfo(shard.baseName, shards, seen);
  assert.equal(inherited.registry, shard.systemInfo.registry);
  assert.equal(inherited.ordering, shard.systemInfo.ordering);
  return inherited.supplement >= shard.systemInfo.supplement ? inherited : shard.systemInfo;
}

function codeBytes(code, byteLength) {
  const result = new Uint8Array(byteLength);
  let remaining = code;
  for (let offset = byteLength - 1; offset >= 0; offset -= 1) {
    result[offset] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return result;
}

function pdfName(value) {
  return { kind: "name", value };
}

function pdfCidSystemInfo({ registry, ordering, supplement }) {
  return new Map([
    ["Registry", pdfString(registry)],
    ["Ordering", pdfString(ordering)],
    ["Supplement", supplement]
  ]);
}

function pdfString(value) {
  return { kind: "string", bytes: new TextEncoder().encode(value), hex: false };
}
