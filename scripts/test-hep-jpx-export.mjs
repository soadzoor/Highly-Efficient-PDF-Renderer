import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const [{ buildHep }, { loadSceneFromHep }, { HepArchive }, { createEmptyVectorScene }, sections,
    { createHepRasterPagePreparer }, fingerprints, { decodeBundledJpx }] = await Promise.all([
    import("../src/hepBuilder.ts"), import("../src/hepReader.ts"), import("../src/hepContainer.ts"),
    import("../src/emptyVectorScene.ts"), import("../src/hepRasterLayers.ts"),
    import("../src/hepRasterPreparation.ts"), import("../src/sourceJpxRaster.ts"), import("../src/pdf/nativeJpxCodec.ts")
  ]);
  const width = 16400, height = 2;
  const encoded = new Uint8Array(await readFile(new URL("./fixtures/codecs/rgb-wide-16400x2.jp2", import.meta.url)));
  const decoded = await decodeBundledJpx({ codec: "jpeg2000", width, height, components: 3,
    bitsPerComponent: 8, imageMask: false, encoded, globals: new Uint8Array(), decodeParameters: {} }, Number.MAX_SAFE_INTEGER);
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    data.set(decoded.samples.subarray(pixel * 3, pixel * 3 + 3), pixel * 4); data[pixel * 4 + 3] = 255;
  }
  const sourceJpx = { width, height, components: 3, encoded,
    rgbaHash: fingerprints.hashSourceJpxRgba(data, width, height), encodedHash: fingerprints.hashSourceJpxEncoded(encoded) };
  const layer = { width, height, data, sourceJpx, matrix: Float32Array.of(width, 0, 0, -height, 0, height),
    paintOrder: 0, pageIndex: 0, interpolate: true };
  const sceneOf = layers => ({ ...createEmptyVectorScene(), rasterLayers: layers,
    pageRects: Float32Array.of(0, 0, width, height * 3), pageTextRanges: Uint32Array.of(0, 0),
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height * 3 },
    pageBounds: { minX: 0, minY: 0, maxX: width, maxY: height * 3 },
    rasterLayerWidth: width, rasterLayerHeight: height, rasterLayerData: layers[0].data,
    rasterLayerMatrix: layers[0].matrix, imagePaintOpCount: layers.length,
    drawRuns: [{ kind: "raster", first: 0, count: layers.length }] });
  const read = async blob => {
    const bytes = await blob.arrayBuffer(), archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    const table = sections.decodeRasterLayerTable(await archive.file(sections.SCENE_RASTER_LAYERS_PATH).async("uint8array"),
      { maxLayers: 10, maxAtlases: 10, maxDimension: 0x7fffffff });
    return { archive, manifest, table, scene: await loadSceneFromHep(bytes), byteLength: bytes.byteLength };
  };
  const pair = sceneOf([layer, { ...layer, paintOrder: 1, matrix: Float32Array.of(width, 0, 0, -height, 0, height * 2) }]);
  const canonical = structuredClone(pair);
  const direct = await read(await buildHep(pair));
  assert.equal(direct.manifest.formatVersion, 16);
  assert.deepEqual(direct.table.layers.map(x => [x.storage, x.source]), [["jpx", undefined], ["jpx", 0]]);
  assert.equal(direct.archive.file("raster/layer-0.rgba"), null, "a retained source writes no empty RGBA companion");
  assert.equal(direct.archive.file("raster/layer-1.jpx"), null, "shared source placements store one compressed image");
  assert(direct.byteLength < data.length / 4, "an oversized photograph retains its original compact codestream");
  assert.deepEqual(direct.scene.rasterLayers[0].data, data);
  assert.equal(direct.scene.rasterLayers[0].data, direct.scene.rasterLayers[1].data);
  assert.deepEqual(direct.scene.rasterLayers[0].sourceJpx.encoded, encoded);
  assert.deepEqual(pair, canonical, "export preserves source pixels and metadata");
  const reexport = await read(await buildHep(direct.scene));
  assert.equal(reexport.table.layers[0].storage, "jpx", "loaded originals remain reusable on re-export");
  assert.deepEqual(reexport.scene.rasterLayers[0].data, data);

  const streaming = structuredClone(pair);
  await createHepRasterPagePreparer()(streaming);
  assert.equal(streaming.rasterLayers[0].data.length, 0, "page preparation releases canonical RGBA storage");
  const prepared = await read(await buildHep(streaming));
  assert.equal(prepared.manifest.formatVersion, 16);
  assert.equal(prepared.table.layers[1].source, 0);
  assert.deepEqual(prepared.scene.rasterLayers[0].data, data);

  for (const change of [
    altered => { altered.data[0] ^= 255; },
    altered => { altered.sourceJpx.encoded[altered.sourceJpx.encoded.length - 3] ^= 255; },
    altered => { altered.sourceJpx.width--; }
  ]) {
    const altered = structuredClone(layer); change(altered);
    const result = await read(await buildHep(sceneOf([altered])));
    assert.equal(result.table.layers[0].storage, "png", "edited pixels or provenance use ordinary oversized-image encoding");
    assert.deepEqual(result.scene.rasterLayers[0].data, altered.data, "edits survive the fallback export exactly");
  }
  const raw = await read(await buildHep(sceneOf([layer]), { encodeRasterImages: false }));
  assert.equal(raw.table.layers[0].storage, "rgba", "explicit raw-image export remains authoritative");

  // Real PDF worker transport: a shared image must survive first-page transfer
  // without detaching the registry's original codestream for the second page.
  const pdf = makePdf(encoded, width, height);
  const workerExport = await read(await buildHep(pdf, { withVectorLod: false, withTextLod: false }));
  assert.equal(workerExport.manifest.formatVersion, 16);
  assert.equal(workerExport.table.layers.length, 2);
  assert.deepEqual(workerExport.table.layers.map(x => [x.storage, x.source]), [["jpx", undefined], ["jpx", 0]]);
  workerExport.scene.rasterLayers.forEach(x => {
    assert.deepEqual(x.data, data); assert.deepEqual(x.sourceJpx.encoded, encoded);
    assert.equal(x.width, width); assert.equal(x.height, height); assert.notEqual(x.interpolate, false);
  });
  console.log("JPX export: oversized source retention, exact round trip, shared sections, streaming, mutation fallback and repeated-page worker transfer passed.");
} finally { hooks.deregister(); }

function makePdf(encoded, width, height) {
  const stream = (dictionary, bytes) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
    bytes, Buffer.from("\nendstream")]);
  const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + width + " " + height +
    "] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", page, page,
    stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Interpolate true`, encoded),
    stream("", Buffer.from(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`))];
  const parts = [Buffer.from("%PDF-1.7\n")], offsets = [0];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body), Buffer.from("\nendobj\n")]);
    parts.push(part); length += part.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset =>
    `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${length}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}
