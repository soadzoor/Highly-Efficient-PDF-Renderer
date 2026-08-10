import assert from "node:assert/strict";

import { createServer } from "vite";

// Middleware mode transforms the TypeScript module without opening a port or
// starting the application development server.
const viteServer = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true }
});

try {
  const { ThreeMaterialRasterLayer } = await viteServer.ssrLoadModule(
    "/src/threeMaterialRasterLayer.ts"
  );

  const rasterLayer = new ThreeMaterialRasterLayer(
    {
      pageRects: new Float32Array([0, 0, 100, 100]),
      pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      rasterLayers: [
        {
          width: 1,
          height: 1,
          data: new Uint8Array([100, 50, 25, 128]),
          matrix: new Float32Array([100, 0, 0, 100, 0, 0]),
          paintOrder: 0,
          pageIndex: 0
        }
      ],
      rasterLayerWidth: 0,
      rasterLayerHeight: 0,
      rasterLayerData: new Uint8Array(0),
      rasterLayerMatrix: new Float32Array([1, 0, 0, 1, 0, 0])
    },
    {
      materialBackend: "webgl",
      pageBackground: [1, 1, 1, 1]
    }
  );

  const entry = rasterLayer.rasterEntries[0];
  assert.ok(entry, "raw raster layer should create a Three.js texture entry");
  assert.equal(entry.resident, false, "raster textures should start dormant");
  assert.equal(entry.mesh.visible, false, "dormant raster meshes should not be submitted");
  assert.deepEqual(
    Array.from(entry.texture.image.data),
    [50, 25, 13, 128],
    "raw straight-alpha pixels should be retained as premultiplied upload data"
  );

  let disposeCount = 0;
  entry.texture.addEventListener("dispose", () => {
    disposeCount += 1;
  });

  const initialTextureVersion = entry.texture.version;
  rasterLayer.setTextureResidency(true);
  assert.equal(entry.resident, true);
  assert.equal(entry.mesh.visible, true);
  assert.ok(
    entry.texture.version > initialTextureVersion,
    "enabling Three.js ownership should schedule a texture upload"
  );

  rasterLayer.setTextureResidency(false);
  assert.equal(entry.resident, false);
  assert.equal(entry.mesh.visible, false);
  assert.equal(disposeCount, 1, "releasing Three.js ownership should dispose its GPU texture");

  rasterLayer.setTextureResidency(false);
  assert.equal(disposeCount, 1, "releasing an already dormant layer should be idempotent");

  const releasedTextureVersion = entry.texture.version;
  rasterLayer.setTextureResidency(true);
  assert.equal(entry.resident, true);
  assert.equal(entry.mesh.visible, true);
  assert.ok(
    entry.texture.version > releasedTextureVersion,
    "reacquiring Three.js ownership should schedule re-upload from retained CPU pixels"
  );

  rasterLayer.dispose();
  assert.equal(disposeCount, 2, "final layer disposal should release the reacquired texture");
} finally {
  await viteServer.close();
}

console.log("Raster texture ownership tests passed");
