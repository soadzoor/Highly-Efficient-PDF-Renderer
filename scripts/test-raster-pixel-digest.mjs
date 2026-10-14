import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
const nodeProcess = process, originalBuiltin = nodeProcess.getBuiltinModule;
const useBrowser = crypto => {
  Object.defineProperty(globalThis, "process", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: crypto });
};
const useNode = () => Object.defineProperty(globalThis, "process", processDescriptor);

try {
  const [{ rasterPixelDigest }, { createHepRasterPagePreparer }, { preparedRasterSection },
    { createEmptyVectorScene }, { buildHep }, { loadSceneFromHep }, { HepArchive }, rasterLayers] = await Promise.all([
    import("../src/rasterPixelDigest.ts"), import("../src/hepRasterPreparation.ts"), import("../src/preparedRasterSections.ts"),
    import("../src/emptyVectorScene.ts"), import("../src/hepBuilder.ts"), import("../src/hepReader.ts"),
    import("../src/hepContainer.ts"), import("../src/hepRasterLayers.ts")
  ]);
  const padded = new Uint8Array(2 * 1024 * 1024 + 43).fill(99), pixels = padded.subarray(7, padded.length - 12);
  for (let index = 0; index < pixels.length; index++) pixels[index] = (index * 79 + (index >>> 9)) & 255;
  const expectedHash = createHash("sha256").update(pixels).digest("hex");
  const expected = `513x1027:${expectedHash}`, updates = [];
  nodeProcess.getBuiltinModule = id => id === "crypto" ? {
    createHash(algorithm) {
      assert.equal(algorithm, "sha256");
      const hash = createHash(algorithm);
      return { update(view) { updates.push(view); hash.update(view); }, digest: encoding => hash.digest(encoding) };
    }
  } : originalBuiltin(id);
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  assert.equal(await rasterPixelDigest(pixels, 513, 1027), expected, "Node hashing works without browser WebCrypto");
  assert.ok(updates.length > 1, "large inputs are hashed incrementally");
  let covered = 0;
  for (const view of updates) {
    assert.equal(view.buffer, pixels.buffer, "hash updates borrow source storage without a full input snapshot");
    assert.equal(view.byteOffset, pixels.byteOffset + covered); covered += view.byteLength;
  }
  assert.equal(covered, pixels.length);
  assert.equal(padded[6], 99); assert.equal(padded.at(-1), 99);
  assert.notEqual(await rasterPixelDigest(pixels, 1027, 513), expected, "dimensions remain part of the dedup key");
  assert.equal(await rasterPixelDigest(new Uint8Array(), 1, 1), `1x1:${createHash("sha256").digest("hex")}`);
  if (typeof SharedArrayBuffer === "function") {
    const shared = new Uint8Array(new SharedArrayBuffer(17)); shared.set(pixels.subarray(0, 17));
    assert.equal(await rasterPixelDigest(shared, 17, 1), `17x1:${createHash("sha256").update(shared).digest("hex")}`);
  }

  nodeProcess.getBuiltinModule = originalBuiltin;
  useBrowser(webcrypto);
  assert.equal(await rasterPixelDigest(pixels, 513, 1027), expected, "browser WebCrypto and native SHA-256 produce identical keys");
  useBrowser(undefined);
  assert.equal(await rasterPixelDigest(pixels, 513, 1027), undefined, "insecure browsers keep the no-dedup fallback");
  useNode();
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  nodeProcess.getBuiltinModule = () => undefined;
  assert.equal(await rasterPixelDigest(pixels, 513, 1027), expected, "hosts without native crypto capability keep WebCrypto");
  nodeProcess.getBuiltinModule = () => { throw new Error("fixture unavailable builtin"); };
  assert.equal(await rasterPixelDigest(pixels, 513, 1027), expected);

  await assert.rejects(rasterPixelDigest(pixels, 513, 1027, AbortSignal.abort()), error => error.name === "AbortError");
  const during = new AbortController();
  nodeProcess.getBuiltinModule = id => id === "crypto" ? {
    createHash(algorithm) {
      const hash = createHash(algorithm); let updates = 0;
      return { update(view) { hash.update(view); if (++updates === 1) during.abort(); }, digest: encoding => hash.digest(encoding) };
    }
  } : originalBuiltin(id);
  await assert.rejects(rasterPixelDigest(pixels, 513, 1027, during.signal), error => error.name === "AbortError");
  const scheduled = new AbortController();
  nodeProcess.getBuiltinModule = id => id === "crypto" ? {
    createHash(algorithm) {
      const hash = createHash(algorithm); let first = true;
      return { update(view) {
        hash.update(view);
        if (first) {
          first = false; setTimeout(() => scheduled.abort(), 0);
          const until = performance.now() + 12; while (performance.now() < until) { /* force one scheduled yield */ }
        }
      }, digest: encoding => hash.digest(encoding) };
    }
  } : originalBuiltin(id);
  await assert.rejects(rasterPixelDigest(pixels, 513, 1027, scheduled.signal), error => error.name === "AbortError",
    "chunked hashing yields so an event-loop cancellation is observed before completion");

  const width = 256, height = 80;
  const first = new Uint8Array(width * height * 4), second = new Uint8Array(first.length);
  for (let offset = 0; offset < first.length; offset += 4) {
    first.set(offset & 4 ? [31, 83, 143, 255] : [0, 0, 0, 0], offset);
    second.set(offset & 4 ? [90, 160, 240, 255] : [0, 0, 0, 0], offset);
  }
  const layer = (data, paintOrder, imageWidth = width, imageHeight = height) => ({ data, width: imageWidth, height: imageHeight,
    matrix: Float32Array.of(imageWidth, 0, 0, -imageHeight, 0, imageHeight), paintOrder, pageIndex: 0 });
  const scene = { ...createEmptyVectorScene(), rasterLayers: [layer(first, 0), layer(second, 1), layer(first.slice(), 2), layer(first.slice(), 3, 160, 128)],
    rasterLayerWidth: width, rasterLayerHeight: height, rasterLayerData: first, rasterLayerMatrix: Float32Array.of(width, 0, 0, -height, 0, height),
    pageRects: Float32Array.of(0, 0, width, 128), pageTextRanges: Uint32Array.of(0, 0),
    bounds: { minX: 0, minY: 0, maxX: width, maxY: 128 }, pageBounds: { minX: 0, minY: 0, maxX: width, maxY: 128 },
    imagePaintOpCount: 4, drawRuns: [{ kind: "raster", first: 0, count: 4 }] };
  let checkedRelease = false;
  nodeProcess.getBuiltinModule = id => id === "crypto" ? {
    createHash(algorithm) {
      const hash = createHash(algorithm);
      return { update(view) {
        if (view.buffer === second.buffer) {
          checkedRelease = true;
          assert.equal(scene.rasterLayerData, scene.rasterLayers[0].data);
          assert.equal(scene.rasterLayerData.length, 0, "legacy accessor releases the first pixels before hashing/encoding the second image");
          assert.equal(typeof Object.getOwnPropertyDescriptor(scene, "rasterLayerData").get, "function");
        }
        hash.update(view);
      }, digest: encoding => hash.digest(encoding) };
    }
  } : originalBuiltin(id);
  await createHepRasterPagePreparer()(scene);
  assert.ok(checkedRelease);
  const sections = scene.rasterLayers.map(item => preparedRasterSection(item.data));
  assert.ok(sections.every(Boolean));
  assert.equal(sections[0], sections[2], "identical pixels share the same prepared image section");
  assert.notEqual(sections[0], sections[1], "changed pixels keep independent sections");
  assert.notEqual(sections[0], sections[3], "the same bytes at different dimensions do not share a section");
  nodeProcess.getBuiltinModule = originalBuiltin;
  const bytes = await (await buildHep(scene, { withVectorLod: false, withTextLod: false })).arrayBuffer();
  const archive = await HepArchive.loadAsync(bytes);
  const table = rasterLayers.decodeRasterLayerTable(await archive.file(rasterLayers.SCENE_RASTER_LAYERS_PATH).async("uint8array"),
    { maxLayers: 4, maxAtlases: 0, maxDimension: width });
  assert.equal(table.layers[2].source, 0);
  assert.equal(table.layers[3].source, undefined);
  const restored = await loadSceneFromHep(bytes);
  [first, second, first, first].forEach((data, index) => assert.deepEqual(restored.rasterLayers[index].data, data));

  const small = { ...createEmptyVectorScene(), rasterLayers: [layer(first.subarray(0, 16), 0, 2, 2)], rasterLayerData: first.subarray(0, 16) };
  const oldData = small.rasterLayerData;
  await createHepRasterPagePreparer()(small);
  assert.equal(small.rasterLayerData, oldData, "pages without prepared replacements keep their original legacy accessor");
  assert.equal(Object.getOwnPropertyDescriptor(small, "rasterLayerData").get, undefined);

  console.log("Raster pixel digest: native/WebCrypto SHA-256 parity, borrowed chunks, capability fallback, cancellation, exact shared sections and early legacy-pixel release passed.");
} finally {
  nodeProcess.getBuiltinModule = originalBuiltin;
  Object.defineProperty(globalThis, "process", processDescriptor);
  if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor); else delete globalThis.crypto;
  hooks.deregister();
}
