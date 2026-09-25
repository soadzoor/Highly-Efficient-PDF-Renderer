import assert from "node:assert/strict";

import { createCanvas, ImageData as NodeImageData } from "@napi-rs/canvas";
import { HepArchive, crc32 } from "../src/hepContainer.ts";
import { registerHooks } from "node:module";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

// Change declared decoded length without allocating an oversized raster payload.
function patchHepEntryUncompressedSize(buffer, filePath, byteLength) {
  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  const entryCount = view.getUint32(8, true);
  const chunkCount = view.getUint32(12, true);
  const indexLength = view.getUint32(16, true);
  let offset = 32 + chunkCount * 20;
  let patchedCount = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = view.getUint16(offset, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 16, offset + 16 + nameLength));
    if (name === filePath) {
      const chunkOffset = 32 + view.getUint32(offset + 4, true) * 20;
      view.setUint32(chunkOffset + 8, byteLength, true);
      // Allow different stored/decoded lengths; the loader must reject the
      // declared raster size before trying to decompress this payload.
      view.setUint8(chunkOffset + 16, 1);
      view.setUint32(offset + 12, byteLength, true);
      patchedCount += 1;
    }
    offset = Math.ceil((offset + 16 + nameLength) / 4) * 4;
  }
  assert.equal(patchedCount, 1, `expected one HEP entry for ${filePath}`);
  view.setUint32(20, crc32(bytes.subarray(32, 32 + indexLength)), true);
  return bytes.buffer;
}

function createRasterScene(seedScene, width, height, data) {
  const matrix = new Float32Array([width, 0, 0, height, 2, 3]);
  return {
    ...seedScene,
    imagePaintOpCount: 1,
    rasterLayers: [{
      width,
      height,
      data,
      matrix,
      paintOrder: 4,
      pageIndex: 0
    }],
    rasterLayerWidth: width,
    rasterLayerHeight: height,
    rasterLayerData: data,
    rasterLayerMatrix: matrix
  };
}

async function assertRasterWebpQualityParity(rasterImageCodec) {
  const width = 192;
  const height = 128;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = (x * 3 + y * 2 + (x * y) % 17) & 0xff;
      rgba[offset + 1] = (x + y * 5 + (x * y) % 31) & 0xff;
      rgba[offset + 2] = (x * 7 + y * 3 + (x ^ y)) & 0xff;
      rgba[offset + 3] = 0xff;
    }
  }

  const canvas = createCanvas(width, height);
  let quality80Webp;
  let quality92Webp;
  let png;
  try {
    const context = canvas.getContext("2d");
    context.putImageData(
      new NodeImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0
    );
    [quality80Webp, quality92Webp, png] = await Promise.all([
      canvas.encode("webp", 80),
      canvas.encode("webp", 92),
      canvas.encode("png")
    ]);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }

  const nodeEncoded = await rasterImageCodec.encodeRasterRgbaAsBestImage(
    width,
    height,
    rgba
  );
  assert.equal(rasterImageCodec.RASTER_WEBP_QUALITY, 0.8);
  assert.equal(nodeEncoded?.encoding, "webp");
  assert.deepEqual(nodeEncoded?.bytes, new Uint8Array(quality80Webp));
  assert.ok(
    nodeEncoded.bytes.byteLength < quality92Webp.byteLength,
    "the parity quality must avoid @napi-rs/canvas's larger quality-92 default"
  );

  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
  const browserCalls = [];
  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement(tagName) {
          assert.equal(tagName, "canvas");
          return {
            width: 0,
            height: 0,
            getContext: () => ({ putImageData() {} }),
            toBlob(callback, mimeType, quality) {
              browserCalls.push({ mimeType, quality });
              const bytes = mimeType === "image/webp" ? quality80Webp : png;
              callback(new Blob([bytes], { type: mimeType }));
            }
          };
        }
      }
    });
    Object.defineProperty(globalThis, "ImageData", {
      configurable: true,
      value: class SyntheticBrowserImageData {
        constructor(data, imageWidth, imageHeight) {
          this.data = data;
          this.width = imageWidth;
          this.height = imageHeight;
        }
      }
    });

    const browserEncoded = await rasterImageCodec.encodeRasterRgbaAsBestImage(
      width,
      height,
      rgba
    );
    assert.equal(browserEncoded?.encoding, "webp");
    assert.deepEqual(browserCalls, [
      { mimeType: "image/webp", quality: 0.8 },
      { mimeType: "image/png", quality: undefined }
    ]);
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete globalThis.document;
    }
    if (previousImageData) {
      Object.defineProperty(globalThis, "ImageData", previousImageData);
    } else {
      delete globalThis.ImageData;
    }
  }
}

/**
 * A picture sliced into one-pixel scanlines, as map PDFs paint inline images,
 * plus one large layer. The scanlines must share an atlas yet come back as the
 * same separate layers; the large layer keeps its own section.
 */
async function assertRasterAtlasRoundTrip(seedScene, zipBuilder, parsedData, rasterSections, readRasterTable) {
  const packed = rasterSections.packRasterAtlases(Array.from({ length: 5_000 }, () => ({ width: 1_000, height: 1 })));
  assert.deepEqual(packed.atlases, [{ width: 2_000, height: 2_048 }, { width: 2_000, height: 452 }]);
  assert.deepEqual(packed.cells[4_095], { atlas: 0, x: 1_000, y: 2_047 });
  assert.deepEqual(packed.cells[4_096], { atlas: 1, x: 0, y: 0 });
  assert.throws(() => rasterSections.encodeRasterLayerTable({
    atlases: [{ encoding: "png", width: 4, height: 1 }],
    layers: [{
      width: 3, height: 1, matrix: new Float32Array([1, 0, 0, 1, 0, 0]), paintOrder: 0, pageIndex: 0,
      storage: "atlas", cell: { atlas: 0, x: 2, y: 0 }
    }]
  }), /cell x is out of range/, "cells must lie inside their atlas");

  const layers = [];
  for (let row = 0; row < 300; row += 1) {
    // Every third scanline repeats the pixels of one painted earlier.
    const repeated = row % 3 === 2 ? layers[row - 2] : null;
    const width = repeated?.width ?? 20 + (row * 7) % 180;
    const data = repeated ? repeated.data.slice() : new Uint8Array(width * 4);
    // Flat runs, like a map's scanlines; lossy coding gains nothing here.
    for (let x = 0; x < width && !repeated; x += 1) {
      data.set([((x >> 4) * 40 + (row >> 3) * 16) & 255, (row >> 3) * 8 & 255, (x >> 4) * 90 & 255, 255], x * 4);
    }
    layers.push({
      width,
      height: 1,
      data,
      matrix: new Float32Array([width * 0.12, 0, 0, -0.12, 100 - row * 0.12, 400 + row * 0.12]),
      paintOrder: 10 + row,
      pageIndex: 0,
      ...(row === 7 ? { opacity: 0.5 } : {})
    });
  }
  const photo = new Uint8Array(200 * 150 * 4);
  for (let offset = 0; offset < photo.length; offset += 4) {
    photo.set([offset % 251, offset % 241, offset % 239, 255], offset);
  }
  layers.push({
    width: 200, height: 150, data: photo, matrix: new Float32Array([200, 0, 0, 150, 5, 6]), paintOrder: 400, pageIndex: 0
  }, {
    width: 200, height: 150, data: photo.slice(), matrix: new Float32Array([200, 0, 0, 150, 5, 600]), paintOrder: 401, pageIndex: 0
  });
  const scene = {
    ...createRasterScene(seedScene, layers[0].width, 1, layers[0].data),
    imagePaintOpCount: layers.length,
    rasterLayers: layers
  };

  for (const encodeRasterImages of [true, false]) {
    const bytes = await (await zipBuilder.buildHep(scene, { compression: "store", encodeRasterImages })).arrayBuffer();
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    const table = await readRasterTable(archive);
    const atlasEncoding = encodeRasterImages ? "png" : "rgba";
    assert.deepEqual(manifest.scene.rasterLayers, {
      file: rasterSections.SCENE_RASTER_LAYERS_PATH, count: 302, atlasCount: 1
    });
    assert.deepEqual(table.atlases.map(atlas => atlas.encoding), [atlasEncoding]);
    assert.ok(table.layers.slice(0, 300).every(layer => layer.storage === "atlas"), "scanlines share the atlas");
    for (let row = 2; row < 300; row += 3) {
      assert.deepEqual(table.layers[row].cell, table.layers[row - 2].cell, `repeated scanline ${row} shares its cell`);
    }
    const distinctCells = new Set(table.layers.slice(0, 300).map(({ cell }) => `${cell.atlas}:${cell.x}:${cell.y}`));
    assert.equal(distinctCells.size, 200, "each distinct scanline is packed once");
    const distinctSizes = layers.slice(0, 300).filter((_, row) => row % 3 !== 2);
    assert.deepEqual(
      table.atlases.map(({ width, height }) => ({ width, height })),
      rasterSections.packRasterAtlases(distinctSizes).atlases,
      "the atlas holds only the distinct scanlines"
    );
    assert.notEqual(table.layers[300].storage, "atlas", "large layers keep their own section");
    assert.equal(table.layers[301].storage, table.layers[300].storage, "a repeated large image reuses its encoding");
    assert.deepEqual(
      await archive.file(rasterSections.rasterLayerFile(301, table.layers[301].storage)).async("uint8array"),
      await archive.file(rasterSections.rasterLayerFile(300, table.layers[300].storage)).async("uint8array"),
      "a repeated large image is encoded once"
    );
    assert.deepEqual(
      Object.keys(archive.files).filter(name => name.startsWith("raster/")).sort(),
      [
        `raster/atlas-0.${atlasEncoding}`,
        rasterSections.rasterLayerFile(300, table.layers[300].storage),
        rasterSections.rasterLayerFile(301, table.layers[301].storage)
      ].sort(),
      "atlas members have no sections of their own"
    );

    const roundTrip = await parsedData.loadSceneFromHep(bytes);
    assert.equal(roundTrip.rasterLayers.length, 302);
    for (let index = 0; index < 300; index += 1) {
      const source = layers[index];
      const loaded = roundTrip.rasterLayers[index];
      assert.equal(loaded.width, source.width);
      assert.equal(loaded.height, 1);
      assert.deepEqual(loaded.data, source.data, `scanline ${index} pixels`);
      assert.deepEqual(Array.from(loaded.matrix), Array.from(source.matrix), `scanline ${index} matrix`);
      assert.equal(loaded.paintOrder, source.paintOrder);
      assert.equal(loaded.pageIndex, 0);
      assert.equal(loaded.opacity, source.opacity);
    }
    assert.equal(roundTrip.rasterLayers[300].width, 200);
    assert.equal(roundTrip.rasterLayers[300].height, 150);
    assert.deepEqual(roundTrip.rasterLayers[301].data, roundTrip.rasterLayers[300].data);
    assert.notEqual(roundTrip.rasterLayers[301].data, roundTrip.rasterLayers[300].data,
      "repeated layers still own separate pixel buffers");
    assert.equal(roundTrip.rasterLayers[301].matrix[5], 600);
  }
}

// Resolve TypeScript imports directly; no Vite middleware or server is needed.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const [zipBuilder, parsedData, rasterImageCodec, rasterSections] = await Promise.all([
    import("../src/hepBuilder.ts"),
    import("../src/hep.ts"),
    import("../src/rasterImageCodec.ts"),
    import("../src/hepRasterLayers.ts")
  ]);
  const readRasterTable = async (archive) => rasterSections.decodeRasterLayerTable(
    await archive.file(rasterSections.SCENE_RASTER_LAYERS_PATH).async("uint8array"),
    { maxLayers: 262_144, maxAtlases: 4_096, maxDimension: 16_384 }
  );

  await assertRasterWebpQualityParity(rasterImageCodec);

  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const seedScene = createEmptyVectorScene();

  const width = 64;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 220;
    rgba[offset + 1] = 80;
    rgba[offset + 2] = 30;
    rgba[offset + 3] = 255;
  }
  const scene = createRasterScene(seedScene, width, height, rgba);
  const progress = [];
  const encodedBlob = await zipBuilder.buildHep(scene, {
    compression: "store",
    onProgress: (event) => progress.push({ ...event })
  });
  const encodedBytes = await encodedBlob.arrayBuffer();
  const encodedArchive = await HepArchive.loadAsync(encodedBytes);
  const encodedManifest = JSON.parse(
    await encodedArchive.file("manifest.json").async("string")
  );
  const encodedTable = await readRasterTable(encodedArchive);
  const encodedEntry = encodedTable.layers[0];
  const encodedFile = rasterSections.rasterLayerFile(0, encodedEntry.storage);

  assert.equal(encodedManifest.formatVersion, 9);
  assert.deepEqual(encodedManifest.scene.rasterLayers, {
    file: rasterSections.SCENE_RASTER_LAYERS_PATH,
    count: 1,
    atlasCount: 0
  });
  assert.ok(encodedEntry.storage === "webp" || encodedEntry.storage === "png",
    "a lone small layer keeps its own encoded section");
  assert.ok(encodedArchive.file(encodedFile));
  assert.deepEqual(Array.from(encodedEntry.matrix), [64, 0, 0, 64, 2, 3]);
  assert.equal(encodedEntry.paintOrder, 4);
  assert.equal(encodedEntry.pageIndex, 0);
  assert.ok(progress.some((event) => event.stage === "raster-encode"));
  assert.ok(progress.some((event) => event.stage === "hep-build"));

  const roundTrip = await parsedData.loadSceneFromHep(encodedBytes);
  assert.equal(roundTrip.rasterLayers.length, 1);
  assert.equal(roundTrip.rasterLayers[0].width, width);
  assert.equal(roundTrip.rasterLayers[0].height, height);
  assert.equal(roundTrip.rasterLayers[0].data.byteLength, rgba.byteLength);
  assert.deepEqual(Array.from(roundTrip.rasterLayers[0].matrix), [64, 0, 0, 64, 2, 3]);

  const tinyRgba = new Uint8Array([12, 34, 56, 78]);
  const rawBlob = await zipBuilder.buildHep(
    createRasterScene(seedScene, 1, 1, tinyRgba),
    { compression: "store" }
  );
  const rawArchive = await HepArchive.loadAsync(await rawBlob.arrayBuffer());
  assert.equal((await readRasterTable(rawArchive)).layers[0].storage, "rgba");
  assert.ok(rawArchive.file("raster/layer-0.rgba"));

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    zipBuilder.buildHep(scene, { signal: controller.signal }),
    (error) => error?.name === "AbortError"
  );

  await assert.rejects(
    parsedData.loadSceneFromHep(
      patchHepEntryUncompressedSize(
        encodedBytes,
        encodedFile,
        768 * 1024 * 1024 + 1
      )
    ),
    /section .* exceeds its decoded byte limit|HEP section size is invalid or exceeds the memory budget/
  );

  const mismatchedArchive = await HepArchive.loadAsync(encodedBytes);
  mismatchedArchive.file(rasterSections.SCENE_RASTER_LAYERS_PATH, rasterSections.encodeRasterLayerTable({
    atlases: encodedTable.atlases,
    layers: [{ ...encodedEntry, width: encodedEntry.width + 1 }]
  }));
  await assert.rejects(
    parsedData.loadSceneFromHep(
      await mismatchedArchive.generateAsync({ type: "arraybuffer", compression: "STORE" })
    ),
    /header dimensions do not match its metadata/
  );

  await assertRasterAtlasRoundTrip(seedScene, zipBuilder, parsedData, rasterSections, readRasterTable);

  console.log("Synthetic v9 raster archive smoke test passed.");
} finally {
  hooks.deregister();
}
