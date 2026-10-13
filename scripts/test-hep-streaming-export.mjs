import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { extractPdfPageScenes } = await import("../src/pdfVectorExtractor.ts");
  const { createHepRasterPagePreparer } = await import("../src/hepRasterPreparation.ts");
  const { preparedRasterSection } = await import("../src/preparedRasterSections.ts");
  const { decodeRasterLayerTable, SCENE_RASTER_LAYERS_PATH } = await import("../src/hepRasterLayers.ts");

  const pdf = fixturePdf();
  const sections = async (blob) => {
    const archive = await HepArchive.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const hashes = new Map();
    for (const [name, entry] of Object.entries(archive.files)) {
      let bytes = await entry.async("uint8array");
      if (name === "manifest.json") {
        const manifest = JSON.parse(new TextDecoder().decode(bytes));
        delete manifest.generatedAt;
        bytes = new TextEncoder().encode(JSON.stringify(manifest));
      }
      hashes.set(name, createHash("sha256").update(bytes).digest("hex"));
    }
    return { archive, hashes };
  };

  // A PDF export streams larger images page by page; a loaded scene does not.
  const streamed = await sections(await buildHep(pdf.slice(), { compression: "store", withVectorLod: false, withTextLod: false }));
  const { scene } = await loadPdfSceneFromSource(pdf.slice(), {});
  const whole = await sections(await buildHep(scene, { compression: "store", withVectorLod: false, withTextLod: false }));
  assert.deepEqual([...streamed.hashes.keys()].sort(), [...whole.hashes.keys()].sort(), "streaming writes the same sections");
  for (const [name, hash] of whole.hashes) assert.equal(streamed.hashes.get(name), hash, `streamed ${name} matches the whole-scene export`);

  const table = decodeRasterLayerTable(await streamed.archive.file(SCENE_RASTER_LAYERS_PATH).async("uint8array"),
    { maxLayers: 16, maxAtlases: 4, maxDimension: 4096 });
  const large = table.layers.map((layer, index) => ({ ...layer, index })).filter(layer => layer.width === 240);
  assert.equal(large.length, 2, "the photo is painted on both pages");
  assert.equal(large[1].source, large[0].index, "the second page's copy references the first copy's section");
  assert.ok(table.layers.some(layer => layer.width === 220 && (layer.storage === "binary" || layer.storage === "mono")),
    "the two-color image is packed");
  const manifest = JSON.parse(await streamed.archive.file("manifest.json").async("string"));
  assert.equal(manifest.formatVersion, 15);

  // The preparer releases larger pixels as soon as each page is parsed.
  const preparer = createHepRasterPagePreparer();
  const bytes = pdf.slice();
  const pages = await extractPdfPageScenes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {},
    undefined, "transfer", preparer);
  const photos = pages.flatMap(page => page.rasterLayers.filter(layer => layer.width === 240));
  assert.equal(photos.length, 2);
  for (const photo of photos) {
    assert.equal(photo.data.length, 0, "prepared pixels are released");
    assert.ok(preparedRasterSection(photo.data), "a placeholder stands for the encoded section");
  }
  assert.strictEqual(preparedRasterSection(photos[1].data), preparedRasterSection(photos[0].data),
    "identical images across pages share one encoded section");
  const small = pages.flatMap(page => page.rasterLayers.filter(layer => layer.width === 80));
  assert.ok(small.length === 2 && small.every(layer => layer.data.length === 80 * 80 * 4),
    "atlas-sized images keep their pixels for document-wide packing");
  assert.equal(pages[0].rasterLayerData.length, 0, "a page's legacy raster accessor no longer retains released pixels");

  const cancelled = new AbortController();
  cancelled.abort();
  const page = { ...pages[0], rasterLayers: [{ ...small[0], width: 240, height: 180, data: new Uint8Array(240 * 180 * 4) }] };
  await assert.rejects(createHepRasterPagePreparer()(page, cancelled.signal), { name: "AbortError" });
  console.log("HEP streaming export: page-wise image encoding, shared sections, atlas pixels and parity passed");
} finally {
  hooks.deregister();
}

function fixturePdf() {
  const photo = new Uint8Array(240 * 180 * 3);
  for (let y = 0; y < 180; y++) {
    for (let x = 0; x < 240; x++) photo.set([x, y, (x * 3 + y * 5) & 255], (y * 240 + x) * 3);
  }
  const twoColor = new Uint8Array(220 * 160 * 3).fill(255);
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 220; x++) if ((x * 7 + y * 3) % 13 < 4) twoColor.fill(0, (y * 220 + x) * 3, (y * 220 + x) * 3 + 3);
  }
  const small = Uint8Array.from({ length: 80 * 80 * 3 }, (_, index) => (index * 37) & 255);
  const image = (width, height, data) =>
    tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8`, data);
  const resources = "/Resources << /XObject << /Im1 6 0 R /Im2 7 0 R /Im3 8 0 R >> >>";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] ${resources} /Contents 5 0 R >>` },
    { number: 4, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] ${resources} /Contents 9 0 R >>` },
    { number: 5, body: tinyPdfStream("", "q 240 0 0 180 10 10 cm /Im1 Do Q q 220 0 0 160 10 300 cm /Im2 Do Q q 80 0 0 80 400 400 cm /Im3 Do Q") },
    { number: 6, body: image(240, 180, photo) },
    { number: 7, body: image(220, 160, twoColor) },
    { number: 8, body: image(80, 80, small) },
    { number: 9, body: tinyPdfStream("", "q 240 0 0 180 300 30 cm /Im1 Do Q q 80 0 0 80 50 450 cm /Im3 Do Q") }
  ] });
}
