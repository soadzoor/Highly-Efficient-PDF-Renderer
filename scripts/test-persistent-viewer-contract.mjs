import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const threeHtml = await readFile(new URL("../three-example.html", import.meta.url), "utf8");
const zipSource = await readFile(new URL("../src/hepShared.ts", import.meta.url), "utf8");

assert.match(
  mainSource,
  /import\s*\{[^}]*\bWebGlFloorplanRenderer\b[^}]*\}\s*from\s*["']\.\/webGlFloorplanRenderer["']/s,
  "the established persistent WebGL renderer must remain the default"
);
assert.match(mainSource, /new\s+WebGlFloorplanRenderer\s*\(/);
assert.match(mainSource, /\bWebGpuFloorplanRenderer\b/);
assert.match(mainSource, /\bcreateCanvasInteractionController\b/);
assert.match(mainSource, /\bcreateBackendSwitcher\b/);
assert.match(mainSource, /\bcreateUiControlManager\b/);
assert.match(
  mainSource,
  /import\s*\{[^}]*\bcomposeVectorScenesInGrid\b[^}]*\}\s*from\s*["']\.\/pdfVectorExtractor["']/s,
  "page scenes must terminate at the existing VectorScene composition boundary"
);
assert.match(
  mainSource,
  /pageScenes\s*=\s*candidate\.displayPageScenes[\s\S]*?scene\s*=\s*composeVectorScenesInGrid\s*\(/,
  "any PDF parser must feed the established VectorScene composition pipeline"
);
assert.match(
  mainSource,
  /\bprebuildVectorStrokeLodRuntime\b[\s\S]*\bprebuildTextLod\b[\s\S]*\.setScene\s*\(/,
  "LOD generation and persistent scene upload must remain intact"
);
const downloadHep = readFunctionBody(mainSource, "downloadHep");
assert.match(downloadHep, /\blet\s+exportScene\s*=\s*scene\s*;/,
  "complete loaded scenes must be reused directly for HEP export");
assert.match(downloadHep, /\bbuildHep\s*\(\s*exportScene\s*,\s*buildOptions\s*\)/,
  "HEP export must serialize the canonical VectorScene");
assert.doesNotMatch(
  downloadHep,
  /\bopenPdf\b|\bparsePdf\b|\bcompilePdfForBatchExport\b/,
  "HEP export must use the shared builder instead of an independent parser"
);
assert.match(mainSource, /pageScenes\s*=\s*candidate\.displayPageScenes/, "large PDFs compose metadata-backed page windows");
assert.match(downloadHep,
  /pageLoader\.loadCompletePageScenes\s*\([\s\S]*?exportScene\s*=\s*prepareSceneForHepRendering\s*\(\s*composeVectorScenesInGrid\s*\([\s\S]*?buildHep\s*\(\s*exportScene/,
  "partial page windows must complete and compose the original document before export");
assert.equal((downloadHep.match(/\bloadCompletePageScenes\s*\(/g) ?? []).length, 1,
  "HEP export completes the live PDF session once");
assert.equal((downloadHep.match(/\bbuildHep\s*\(/g) ?? []).length, 1,
  "HEP export serializes one fast file");
assert.doesNotMatch(downloadHep, /\bbuildHep\s*\(\s*(?:lastLoadedSource|source)\.bytes/,
  "HEP encoding must use the completed scene without reparsing the original PDF");
assert.doesNotMatch(
  mainSource,
  /\brenderHeprPageToCanvas2d\b/,
  "the parser's selective Canvas2D compositor must stay out of the viewer"
);
assert.match(mainSource, /\bloadSceneFromHep\b/);
assert.match(
  zipSource,
  /const\s+PARSED_DATA_FORMAT_VERSION\s*=\s*9\s*;/,
  "HEP v9 retains optional content and replay resources as the viewer/export contract"
);

const backendSelect = readSelect(html, "backend-select");
assert.doesNotMatch(backendSelect.openingTag, /\bdisabled\b/i);
assert.match(backendSelect.content, /<option\s+value="webgl"\s+selected>WebGL(?:2)?<\/option>/i);
assert.match(backendSelect.content, /<option\s+value="webgpu">WebGPU<\/option>/i);

const vectorLodSelect = readSelect(html, "vector-lod-mode");
assert.doesNotMatch(vectorLodSelect.openingTag, /\bdisabled\b/i);
assert.match(vectorLodSelect.content, /<option\s+value="auto"\s+selected>Auto<\/option>/i);

const textLodSelect = readSelect(html, "text-lod-mode");
assert.doesNotMatch(textLodSelect.openingTag, /\bdisabled\b/i);
assert.match(textLodSelect.content, /<option\s+value="auto"\s+selected>Auto<\/option>/i);

for (const [name, document] of [["native", html], ["Three", threeHtml]]) {
  const scanCompression = /<input\b[^>]*\bid=["']compress-scans-checkbox["'][^>]*>/i.exec(document);
  assert.ok(scanCompression, `${name} viewer exposes GPU scan compression`);
  assert.match(scanCompression[0], /\bchecked\b/i, `${name} viewer enables GPU scan compression by default`);
  const pageStreaming = /<input\b[^>]*\bid=["']page-streaming-checkbox["'][^>]*>/i.exec(document);
  assert.ok(pageStreaming, `${name} viewer exposes page streaming`);
  assert.doesNotMatch(pageStreaming[0], /\bchecked\b/i, `${name} viewer defaults to mutually exclusive page loading modes`);
  assert.match(document, /GPU compress scans/);
  assert.doesNotMatch(document, /GPU compress scans\s*\(experimental\)/i,
    `${name} viewer no longer labels GPU scan compression experimental`);
}

console.log("persistent viewer contract passed");

function readSelect(source, id) {
  const match = new RegExp(`(<select\\b[^>]*\\bid=["']${id}["'][^>]*>)([\\s\\S]*?)<\\/select>`, "i").exec(source);
  assert.ok(match, `missing #${id}`);
  return { openingTag: match[1], content: match[2] };
}

function readFunctionBody(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{`, "g").exec(source);
  assert.ok(declaration, `missing ${name}()`);
  const start = declaration.index + declaration[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  assert.fail(`unterminated ${name}()`);
}
