import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const zipSource = await readFile(new URL("../src/hep.ts", import.meta.url), "utf8");

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
  /const\s+pageScenes\s*=\s*await\s+[A-Za-z_$][\w$]*\s*\([\s\S]*?scene\s*=\s*composeVectorScenesInGrid\s*\(/,
  "any PDF parser must feed the established VectorScene composition pipeline"
);
assert.match(
  mainSource,
  /\bprebuildVectorStrokeLodRuntime\b[\s\S]*\bprebuildTextLod\b[\s\S]*\.setScene\s*\(/,
  "LOD generation and persistent scene upload must remain intact"
);
assert.match(
  mainSource,
  /async\s+function\s+downloadHep\b[\s\S]*?\bbuildParsedDataZip\s*\(\s*scene\s*,\s*\{/,
  "HEP export must serialize the already-loaded VectorScene"
);
assert.doesNotMatch(
  readFunctionBody(mainSource, "downloadHep"),
  /\bopenPdf\b|\bparsePdf\b|\bcompilePdfForBatchExport\b/,
  "HEP export must not parse the source PDF a second time or switch data models"
);
assert.doesNotMatch(
  mainSource,
  /\brenderHeprPageToCanvas2d\b/,
  "the parser's selective Canvas2D compositor must stay out of the viewer"
);
assert.match(mainSource, /\bloadSceneFromParsedDataZip\b/);
assert.match(
  zipSource,
  /const\s+PARSED_DATA_FORMAT_VERSION\s*=\s*6\s*;/,
  "the established HEP v6 format must remain the viewer/export contract"
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
