import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, ImageData as NodeImageData } from "@napi-rs/canvas";
import JSZip from "jszip";
import { createServer } from "vite";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

function patchZipEntryUncompressedSize(buffer, filePath, byteLength) {
  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  const encodedPath = new TextEncoder().encode(filePath);
  let patchedCount = 0;
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      continue;
    }
    const fileNameLength = view.getUint16(offset + 28, true);
    if (
      fileNameLength !== encodedPath.byteLength ||
      offset + 46 + fileNameLength > bytes.byteLength
    ) {
      continue;
    }
    let matches = true;
    for (let index = 0; index < fileNameLength; index += 1) {
      if (bytes[offset + 46 + index] !== encodedPath[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      view.setUint32(offset + 24, byteLength, true);
      patchedCount += 1;
    }
  }
  assert.equal(patchedCount, 1, `expected one central-directory entry for ${filePath}`);
  return bytes;
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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const seedHepPath = path.join(
  repoRootDir,
  "public/examples/heps/LK_Office_Level_1-parsed-data.hep"
);

// Middleware mode only transforms TypeScript modules; it does not listen on a
// port or start the application's development server.
const viteServer = await createServer({
  configFile: false,
  root: repoRootDir,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
  appType: "custom"
});

try {
  const [zipBuilder, parsedData, rasterImageCodec] = await Promise.all([
    viteServer.ssrLoadModule("/src/parsedDataZipBuilder.ts"),
    viteServer.ssrLoadModule("/src/parsedDataZip.ts"),
    viteServer.ssrLoadModule("/src/rasterImageCodec.ts")
  ]);

  await assertRasterWebpQualityParity(rasterImageCodec);

  const seedBytes = await readFile(seedHepPath);
  const seedScene = await parsedData.loadSceneFromParsedDataZip(
    seedBytes.buffer.slice(seedBytes.byteOffset, seedBytes.byteOffset + seedBytes.byteLength)
  );

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
  const encodedBlob = await zipBuilder.buildParsedDataZip(scene, {
    compression: "store",
    onProgress: (event) => progress.push({ ...event })
  });
  const encodedBytes = await encodedBlob.arrayBuffer();
  const encodedArchive = await JSZip.loadAsync(encodedBytes);
  const encodedManifest = JSON.parse(
    await encodedArchive.file("manifest.json").async("string")
  );
  const encodedEntry = encodedManifest.scene.rasterLayers[0];

  assert.equal(encodedManifest.formatVersion, 6);
  assert.equal(encodedManifest.scene.rasterLayers.length, 1);
  assert.ok(encodedEntry.encoding === "webp" || encodedEntry.encoding === "png");
  assert.equal("textureWidth" in encodedEntry, false);
  assert.deepEqual(encodedEntry.matrix, [64, 0, 0, 64, 2, 3]);
  assert.equal(encodedEntry.paintOrder, 4);
  assert.equal(encodedEntry.pageIndex, 0);
  assert.ok(progress.some((event) => event.stage === "raster-encode"));
  assert.ok(progress.some((event) => event.stage === "zip-build"));

  const roundTrip = await parsedData.loadSceneFromParsedDataZip(encodedBytes);
  assert.equal(roundTrip.rasterLayers.length, 1);
  assert.equal(roundTrip.rasterLayers[0].width, width);
  assert.equal(roundTrip.rasterLayers[0].height, height);
  assert.equal(roundTrip.rasterLayers[0].data.byteLength, rgba.byteLength);
  assert.deepEqual(Array.from(roundTrip.rasterLayers[0].matrix), [64, 0, 0, 64, 2, 3]);

  const tinyRgba = new Uint8Array([12, 34, 56, 78]);
  const rawBlob = await zipBuilder.buildParsedDataZip(
    createRasterScene(seedScene, 1, 1, tinyRgba),
    { compression: "store" }
  );
  const rawArchive = await JSZip.loadAsync(await rawBlob.arrayBuffer());
  const rawManifest = JSON.parse(await rawArchive.file("manifest.json").async("string"));
  assert.equal(rawManifest.scene.rasterLayers[0].encoding, "rgba");
  assert.match(rawManifest.scene.rasterLayers[0].file, /\.rgba$/);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    zipBuilder.buildParsedDataZip(scene, { signal: controller.signal }),
    (error) => error?.name === "AbortError"
  );

  await assert.rejects(
    parsedData.loadSceneFromParsedDataZip(
      patchZipEntryUncompressedSize(
        encodedBytes,
        encodedEntry.file,
        768 * 1024 * 1024 + 1
      )
    ),
    /ZIP entry size is invalid or exceeds the memory budget/
  );

  const mismatchedArchive = await JSZip.loadAsync(encodedBytes);
  const mismatchedManifest = structuredClone(encodedManifest);
  mismatchedManifest.scene.rasterLayers[0].width += 1;
  mismatchedArchive.file("manifest.json", JSON.stringify(mismatchedManifest));
  await assert.rejects(
    parsedData.loadSceneFromParsedDataZip(
      await mismatchedArchive.generateAsync({ type: "arraybuffer", compression: "STORE" })
    ),
    /header dimensions do not match its v6 metadata/
  );

  console.log("Synthetic v6 raster archive smoke test passed.");
} finally {
  await viteServer.close();
}
