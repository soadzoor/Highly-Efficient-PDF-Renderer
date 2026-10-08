import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const {
    expandMonochromeRaster, createMonochromeRasterLayer, copyRasterLayer,
    detectMonochromeRaster, monochromeRasterTile, buildMonochromeMipChain,
    buildPackedMonochromeMipAtlas, buildPackedMonochromeMipAtlasAsync,
    prepareMonochromeSceneTransfer, restoreMonochromeSceneTransfer
  } = await import("../src/monochromeRaster.ts");
  const { buildSingleChannelUint8MipChain } = await import("../src/singleChannelMipChain.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { collectPdfTransferables } = await import("../src/pdf/workerProtocol.ts");
  const { packedMonochromeCoverageLayout } = await import("../src/packedMonochromeCoverage.ts");
  const { estimateRasterTextureBytes } = await import("../src/rasterMemoryBudget.ts");

  // Odd rows have their own padding, and palette entries preserve straight alpha.
  const colors = Uint8Array.of(13, 23, 31, 0, 97, 131, 173, 128);
  const simple = { data: Uint8Array.of(0x80, 0xff, 0x55, 0x7f), colors };
  const simpleRgba = expandMonochromeRaster(simple, 9, 2);
  for (const [index, bit] of [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0].entries()) {
    assert.deepEqual(simpleRgba.subarray(index * 4, index * 4 + 4), colors.subarray(bit * 4, bit * 4 + 4));
  }

  // Metadata copies must never read the legacy getter or force RGBA allocation.
  let packedReads = 0;
  const lazy = { get data() { packedReads++; return simple.data; }, colors };
  const layer = createMonochromeRasterLayer({ width: 9, height: 2, matrix: Float32Array.of(1, 0, 0, 1, 3, 4),
    pageIndex: 0, paintOrder: 17, opacity: 0.75 }, lazy);
  const readsAfterCreation = packedReads;
  const placed = copyRasterLayer(layer, { matrix: Float32Array.of(1, 0, 0, 1, 30, 40), pageIndex: 2 });
  assert.equal(packedReads, readsAfterCreation, "copying a layer does not expand its packed source");
  assert.equal(placed.monochrome, lazy);
  assert.equal(placed.pageIndex, 2);
  assert.equal(placed.opacity, 0.75);
  assert(Object.keys(placed).includes("data"), "legacy data stays enumerable for ordinary consumers");
  assert.equal(typeof Object.getOwnPropertyDescriptor(placed, "data").get, "function");
  assert.deepEqual(placed.data, simpleRgba);
  assert.equal(placed.data, layer.data, "RGBA materialization is cached and shared across placement copies");
  const readsAfterExpansion = packedReads;
  assert.equal(layer.data, placed.data);
  assert.equal(packedReads, readsAfterExpansion, "cached reads do not revisit the packed image");

  // Worker transport must never invoke RGBA getters while collecting or cloning buffers.
  for (const primaryMonochrome of [true, false]) {
    const transferMono = primaryMonochrome ? { data: simple.data.slice(), colors: colors.slice() } :
      { data: Buffer.from(simple.data), colors: Buffer.from(colors) };
    const transferLayer = createMonochromeRasterLayer({ width: 9, height: 2, matrix: Float32Array.of(1, 0, 0, 1, 0, 0),
      pageIndex: 0, paintOrder: 0 }, transferMono);
    Object.defineProperty(transferLayer, "data", { enumerable: true, configurable: true,
      get() { throw new Error("Worker transport expanded a packed image."); } });
    const sourceScene = createEmptyVectorScene();
    const rgbaLayer = { width: 1, height: 1, data: Uint8Array.of(29, 31, 37, 41),
      matrix: Float32Array.of(1, 0, 0, 1, 0, 0), pageIndex: 0, paintOrder: 1 };
    sourceScene.rasterLayers = primaryMonochrome ? [transferLayer, rgbaLayer] : [rgbaLayer, transferLayer];
    if (primaryMonochrome) Object.defineProperty(sourceScene, "rasterLayerData", { enumerable: true, configurable: true,
      get() { throw new Error("Worker transport read the packed primary image's legacy data."); } });
    else sourceScene.rasterLayerData = rgbaLayer.data;
    const transport = prepareMonochromeSceneTransfer(sourceScene);
    assert.notEqual(transport, sourceScene);
    const packedIndex = primaryMonochrome ? 0 : 1;
    assert.equal(transport.rasterLayers[packedIndex].data.length, 0);
    if (primaryMonochrome) assert.equal(transport.rasterLayerData.length, 0);
    const buffers = collectPdfTransferables(transport);
    assert(buffers.includes(transport.rasterLayers[packedIndex].monochrome.data.buffer),
      "only an owned packed base buffer is transferred for a monochrome image");
    assert(!buffers.includes(transferMono.data.buffer));
    assert(!buffers.includes(transferMono.colors.buffer));
    const received = structuredClone(transport, { transfer: buffers });
    assert.deepEqual([...transferMono.data], [...simple.data], "transport never detaches packed bytes retained by the worker session");
    assert.deepEqual([...transferMono.colors], [...colors], "transport never detaches the retained color palette");
    const restored = restoreMonochromeSceneTransfer(received);
    assert.equal(typeof Object.getOwnPropertyDescriptor(restored.rasterLayers[packedIndex], "data").get, "function");
    if (primaryMonochrome) assert.equal(typeof Object.getOwnPropertyDescriptor(restored, "rasterLayerData").get, "function");
    assert.deepEqual(restored.rasterLayers[packedIndex].data, simpleRgba);
    if (primaryMonochrome) assert.equal(restored.rasterLayerData, restored.rasterLayers[0].data);
    else assert.deepEqual(restored.rasterLayerData, Uint8Array.of(29, 31, 37, 41));
    assert.throws(() => sourceScene.rasterLayers[packedIndex].data, /Worker transport expanded/,
      "transport preparation does not replace the source's getter");
  }
  const emptyScene = createEmptyVectorScene();
  assert.equal(prepareMonochromeSceneTransfer(emptyScene), emptyScene);
  assert.equal(restoreMonochromeSceneTransfer(emptyScene), emptyScene);

  // Exact two-color recovery distinguishes alpha and preserves color hidden by transparency.
  for (const [width, height, endpoints] of [
    [17, 17, colors],
    [32, 8, Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 255)],
    [256, 1, Uint8Array.of(25, 35, 45, 0, 25, 35, 45, 255)]
  ]) {
    const original = rgbaPattern(width, height, endpoints);
    const detected = detectMonochromeRaster(original, width, height);
    assert(detected);
    assert.equal(detected.data.length, Math.ceil(width / 8) * height);
    assert.deepEqual(expandMonochromeRaster(detected, width, height), original);
    const third = original.slice();
    third.set([19, 27, 38, 67], third.length - 4);
    assert.equal(detectMonochromeRaster(third, width, height), null);
  }
  const solid = new Uint8Array(16 * 16 * 4);
  for (let offset = 0; offset < solid.length; offset += 4) solid.set([17, 29, 43, 59], offset);
  const solidPacked = detectMonochromeRaster(solid, 16, 16);
  assert.deepEqual(expandMonochromeRaster(solidPacked, 16, 16), solid);
  assert.deepEqual(solidPacked.colors, Uint8Array.of(17, 29, 43, 59, 17, 29, 43, 59));
  assert.equal(detectMonochromeRaster(solid.subarray(0, 60), 5, 3), null, "tiny images keep their simpler RGBA storage");
  assert.equal(detectMonochromeRaster(solid.subarray(0, solid.length - 1), 16, 16), null);

  // Tile extraction handles all bit alignments and clears padding even when source padding is set.
  const width = 67, height = 19;
  const fullRgba = rgbaPattern(width, height, colors);
  const packed = detectMonochromeRaster(fullRgba, width, height);
  const fullTile = tile(0, 0, width, height);
  assert.equal(monochromeRasterTile(packed, width, height, fullTile), packed);
  for (let row = 0; row < height; row++) packed.data[row * Math.ceil(width / 8) + Math.ceil(width / 8) - 1] |= 31;
  for (let x = 0; x < 16; x++) {
    for (const tileWidth of [1, 7, 8, 9, 17, width - x]) {
      const rect = tile(x, 3, tileWidth, 13);
      const extracted = monochromeRasterTile(packed, width, height, rect);
      assert.equal(extracted.colors, packed.colors);
      const expected = new Uint8Array(tileWidth * 13 * 4);
      for (let y = 0; y < 13; y++) {
        const from = ((3 + y) * width + x) * 4;
        expected.set(fullRgba.subarray(from, from + tileWidth * 4), y * tileWidth * 4);
      }
      assert.deepEqual(expandMonochromeRaster(extracted, tileWidth, 13), expected, `tile x=${x}, width=${tileWidth}`);
      if (tileWidth % 8) {
        const stride = Math.ceil(tileWidth / 8), unusedMask = (1 << (8 - tileWidth % 8)) - 1;
        for (let y = 0; y < 13; y++) assert.equal(extracted.data[y * stride + stride - 1] & unusedMask, 0);
      }
    }
  }

  // Every mip covers the entire source extent, including odd-edge pixels at later levels.
  for (const [mipWidth, mipHeight] of [[1, 1], [1, 32], [32, 1], [1, 35], [35, 1], [2, 2], [3, 3],
    [9, 13], [32, 16], [64, 16], [65, 17], [34, 70]]) {
    const stride = Math.ceil(mipWidth / 8), bitData = new Uint8Array(stride * mipHeight);
    const coverage = new Uint8Array(mipWidth * mipHeight);
    for (let y = 0; y < mipHeight; y++) {
      for (let x = 0; x < mipWidth; x++) {
        if ((x * 11 + y * 7 + x * y) % 5 < 2) {
          coverage[y * mipWidth + x] = 255;
          bitData[y * stride + (x >> 3)] |= 128 >> (x & 7);
        }
      }
    }
    const actual = buildMonochromeMipChain({ data: bitData, colors }, mipWidth, mipHeight);
    assert.deepEqual(actual, referenceAreaMipChain(coverage, mipWidth, mipHeight), `${mipWidth}x${mipHeight} area coverage mip chain`);
    const atlas = buildPackedMonochromeMipAtlas({ data: bitData, colors }, mipWidth, mipHeight);
    assert.deepEqual(await buildPackedMonochromeMipAtlasAsync({ data: bitData, colors }, mipWidth, mipHeight), atlas);
    const layout = packedMonochromeCoverageLayout(mipWidth, mipHeight);
    const reference = actual.length ? actual : [{ width: 1, height: 1, data: coverage }];
    for (const [index, level] of reference.entries()) {
      const stored = layout.levels[index];
      assert.equal(stored.width, level.width); assert.equal(stored.height, level.height);
      for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
        const packedByte = atlas.data[stored.byteOffset + y * stored.rowBytes + (x >> 1)];
        const decoded = ((packedByte >> (x % 2 ? 0 : 4)) & 15) * 17;
        const expected = level.data[y * level.width + x];
        assert(Math.abs(decoded - expected) <= 8, "each mip retains gray coverage within half a four-bit step");
      }
      if (level.width % 2) for (let y = 0; y < level.height; y++) {
        assert.equal(atlas.data[stored.byteOffset + (y + 1) * stored.rowBytes - 1] & 15, 0,
          "odd rows do not sample unused neighboring coverage values");
      }
    }
    assert.equal(estimateRasterTextureBytes(mipWidth, mipHeight, true), bitData.byteLength + atlas.data.byteLength,
      "memory planning charges the exact atlas allocation, including row and terminal padding");
    assert(Math.max(atlas.width, atlas.height) <= Math.max(mipWidth, mipHeight), "atlas fits the original tile's device limit");
    if ((mipWidth === 1 || mipWidth % 2 === 0) && (mipHeight === 1 || mipHeight % 2 === 0)) {
      assert.deepEqual(actual[0], buildSingleChannelUint8MipChain(coverage, mipWidth, mipHeight)[1],
        `${mipWidth}x${mipHeight} even first level keeps established bytes before any odd later level`);
    }
    const powerOfTwo = value => (value & (value - 1)) === 0;
    if (powerOfTwo(mipWidth) && powerOfTwo(mipHeight)) {
      assert.deepEqual(actual, buildSingleChannelUint8MipChain(coverage, mipWidth, mipHeight).slice(1),
        `${mipWidth}x${mipHeight} even levels preserve established box-filter bytes`);
    }
  }
  for (const [edgeWidth, edgeHeight] of [[257, 1], [1, 257]]) {
    const stride = Math.ceil(edgeWidth / 8), edgeBits = new Uint8Array(stride * edgeHeight);
    const edgeX = edgeWidth - 1, edgeY = edgeHeight - 1;
    edgeBits[edgeY * stride + (edgeX >> 3)] |= 128 >> (edgeX & 7);
    const edgeChain = buildMonochromeMipChain({ data: edgeBits, colors }, edgeWidth, edgeHeight);
    assert.equal(edgeChain[0].data.at(-1), 127, "the last source texel contributes to the first reduced level");
    assert.equal(edgeChain.at(-1).data[0], 1, "thin ink on the last row or column remains in final average coverage");
  }
  const large = { data: new Uint8Array(1024 * 1024 / 8), colors };
  const chain = buildMonochromeMipChain(large, 1024, 1024);
  const packedAtlas = buildPackedMonochromeMipAtlas(large, 1024, 1024);
  assert(packedAtlas.data.byteLength < chain.reduce((sum, level) => sum + level.data.byteLength, 0) * .501,
    "four-bit coverage mips use approximately half the previous GPU mip bytes");
  assert(large.data.byteLength + packedAtlas.data.byteLength < 1024 * 1024 * .293,
    "packed base and four-bit mips approach seven twenty-fourths of a byte per source pixel");
  assert.equal(chain[0].data.length, 512 * 512, "the largest unpacked coverage allocation is a quarter of full resolution");
  assert(large.data.byteLength + chain.reduce((sum, level) => sum + level.data.byteLength, 0) < 1024 * 1024 / 2,
    "packed base plus coverage mipmaps stays below half a byte per source pixel");

  const controller = new AbortController();
  controller.abort();
  for (const operation of [
    () => expandMonochromeRaster(simple, 9, 2, controller.signal),
    () => monochromeRasterTile(simple, 9, 2, tile(0, 0, 1, 1), controller.signal),
    () => buildMonochromeMipChain(simple, 9, 2, controller.signal),
    () => buildPackedMonochromeMipAtlas(simple, 9, 2, controller.signal)
  ]) assert.throws(operation, error => error.code === "aborted");
  assert.throws(() => expandMonochromeRaster(simple, 0, 2), RangeError);
  assert.throws(() => expandMonochromeRaster({ data: new Uint8Array(1), colors }, 9, 2), RangeError);
  assert.throws(() => monochromeRasterTile(simple, 9, 2, tile(8, 0, 2, 1)), RangeError);

  // Exercise the actual Node worker runtime/client with a tiny one-bit PDF image.
  const { openPdfInNodeWorker } = await import("../src/pdf/workerClient.ts");
  const workerWidth = 17, workerHeight = 17;
  const workerBits = Uint8Array.from({ length: Math.ceil(workerWidth / 8) * workerHeight }, (_, index) => (index * 37 + 17) & 255);
  const workerPdf = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 17 17] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "17 0 0 17 0 0 cm /Im Do") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 17 /Height 17 /BitsPerComponent 1 /ColorSpace /DeviceGray", workerBits) }
  ] });
  const workerSession = await openPdfInNodeWorker({ kind: "bytes", bytes: workerPdf });
  try {
    const workerScene = await workerSession.compileVectorPage(0, { optimization: "none" });
    assert.equal(workerScene.rasterLayers.length, 1);
    const workerLayer = workerScene.rasterLayers[0];
    assert(workerLayer.monochrome, "native compilation keeps one-bit images packed through worker transport");
    assert.equal(workerLayer.monochrome.data.length, Math.ceil(workerWidth / 8) * workerHeight);
    assert.equal(typeof Object.getOwnPropertyDescriptor(workerLayer, "data").get, "function");
    assert.equal(typeof Object.getOwnPropertyDescriptor(workerScene, "rasterLayerData").get, "function");
    assert.deepEqual(workerLayer.data, expandMonochromeRaster({ data: workerBits,
      colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255) }, workerWidth, workerHeight));
    assert.equal(workerScene.rasterLayerData, workerLayer.data);
    const repeated = await workerSession.compileVectorPage(0, { optimization: "none" });
    assert.deepEqual(repeated.rasterLayers[0].data, workerLayer.data,
      "transferring a packed image does not detach the worker session's cached image bytes");
  } finally {
    await workerSession.close();
  }
  console.log("Monochrome raster: exact RGBA fallback, lazy copies, worker transport, alpha palettes, bit-aligned tiles, coverage mip parity, memory bounds and cancellation passed.");
} finally {
  hooks.deregister();
}

function rgbaPattern(width, height, colors) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = ((x * 13 + y * 17 + x * y) % 7 < 3) ? 1 : 0;
      out.set(colors.subarray(bit * 4, bit * 4 + 4), (y * width + x) * 4);
    }
  }
  return out;
}

function tile(x, y, width, height) {
  return { x, y, width, height, quad: [0, 0, 1, 1], uv: [0, 0, 1, 1] };
}

// Independent reference: distribute each source texel's area into the target cells it intersects.
function referenceAreaMipChain(source, width, height) {
  const chain = [];
  while (width > 1 || height > 1) {
    const nextWidth = Math.max(1, Math.floor(width / 2)), nextHeight = Math.max(1, Math.floor(height / 2));
    const sums = new Float64Array(nextWidth * nextHeight);
    for (let y = 0; y < height; y++) {
      const top = y * nextHeight, bottom = top + nextHeight;
      for (let x = 0; x < width; x++) {
        const left = x * nextWidth, right = left + nextWidth;
        for (let outputY = Math.floor(top / height); outputY < Math.ceil(bottom / height); outputY++) {
          const overlapY = Math.min(bottom, (outputY + 1) * height) - Math.max(top, outputY * height);
          for (let outputX = Math.floor(left / width); outputX < Math.ceil(right / width); outputX++) {
            const overlapX = Math.min(right, (outputX + 1) * width) - Math.max(left, outputX * width);
            sums[outputY * nextWidth + outputX] += source[y * width + x] * overlapX * overlapY;
          }
        }
      }
    }
    const data = Uint8Array.from(sums, sum => Math.round(sum / (width * height)));
    chain.push({ width: nextWidth, height: nextHeight, data });
    source = data;
    width = nextWidth;
    height = nextHeight;
  }
  return chain;
}
