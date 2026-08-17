import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");

const sourcePaths = {
  example: "src/three-example.ts",
  object: "src/threePdfObject.ts",
  colorSpace: "src/threeWebGpuColorSpace.ts",
  raster: "src/threeWebGpuRasterMaterial.ts",
  fill: "src/threeWebGpuFillMaterial.ts",
  stroke: "src/threeWebGpuStrokeMaterial.ts",
  text: "src/threeWebGpuTextMaterial.ts",
  gradient: "src/threeWebGpuGradientMaterial.ts"
};

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(sourcePaths).map(async ([name, relativePath]) => [
      name,
      await readFile(path.resolve(repoRootDir, relativePath), "utf8")
    ])
  )
);

assertThreeExampleContract(sources.example);
assertColorHelperVariants(sources.colorSpace);
assertWebGpuMaterialFamilies(sources);
assertThreeObjectContract(sources.object);
assertBlendReferenceMath();

console.log("Three color-compositing parity regression tests passed");

function assertThreeExampleContract(source) {
  const webGlFactory = extractFunction(source, "createWebGlThreeRenderer");
  const webGpuFactory = extractFunction(source, "createWebGpuThreeRenderer");
  const rendererConfiguration = extractFunction(source, "configureThreeRenderer");
  const objectOptions = extractFunction(source, "readThreeObjectOptions");

  for (const [backend, factory] of [["WebGL", webGlFactory], ["WebGPU", webGpuFactory]]) {
    assert.match(
      factory,
      /antialias\s*:\s*false/,
      `the Three ${backend} example must stay single-sample like the native analytic-AA renderer`
    );
    assert.doesNotMatch(
      factory,
      /antialias\s*:\s*true/,
      `the Three ${backend} example must not add MSAA coverage on top of HEPR analytic AA`
    );
  }

  assert.match(
    source,
    /THREE\.LinearSRGBColorSpace/,
    "the Three example must expose a direct display-value WebGPU output path"
  );
  assert.match(
    source,
    /THREE\.SRGBColorSpace/,
    "the Three WebGL example must retain its sRGB output contract"
  );

  assertBackendConfiguration(
    webGlFactory,
    rendererConfiguration,
    "webgl",
    "SRGBColorSpace"
  );
  assertBackendConfiguration(
    webGpuFactory,
    rendererConfiguration,
    "webgpu",
    "LinearSRGBColorSpace"
  );

  assert.match(
    objectOptions,
    /threeColorCompositing\s*:\s*["']display["']/,
    "the Three example must request display-space PDF compositing"
  );
}

function assertBackendConfiguration(factory, configuration, backend, expectedColorSpace) {
  const expectedPattern = new RegExp(`THREE\\.${expectedColorSpace}`);
  if (expectedPattern.test(factory)) {
    return;
  }

  assert.match(
    factory,
    new RegExp(`configureThreeRenderer\\s*\\([\\s\\S]*?["']${backend}["']`),
    `the ${backend} renderer factory must identify its backend to shared configuration`
  );

  assert.match(
    configuration,
    expectedPattern,
    `shared renderer configuration must contain ${expectedColorSpace} for ${backend}`
  );

  const backendIndex = configuration.search(new RegExp(`["']${backend}["']`, "i"));
  const colorSpaceIndex = configuration.search(expectedPattern);
  assert.ok(
    backendIndex >= 0 && colorSpaceIndex >= 0,
    `${backend} renderer configuration must pair its backend with ${expectedColorSpace}`
  );
}

function assertColorHelperVariants(source) {
  const wgslDefinitions = extractWgslDefinitions(source);
  assert.ok(
    wgslDefinitions.length >= 2,
    "Three WebGPU color handling must provide separate linear and display WGSL helpers"
  );

  const linearHelper = wgslDefinitions.find(({ context, body }) =>
    /linear/i.test(context) && /pow\s*\(/.test(body) && /12\.92/.test(body) && /2\.4/.test(body)
  );
  assert.ok(
    linearHelper,
    "the linear-compositing helper must decode display/sRGB components into linear values"
  );

  const displayHelper = wgslDefinitions.find(({ context, body }) =>
    /display/i.test(context) &&
    !/pow\s*\(|12\.92|2\.4/.test(body) &&
    /return\s+(?:color|safeColor|clamp\s*\(\s*color\b)/.test(body)
  );
  assert.ok(
    displayHelper,
    "the display-compositing helper must preserve display values without applying a transfer curve"
  );

  assert.match(
    source,
    /colorCompositing/i,
    "the helper module must select its WGSL implementation from the compositing contract"
  );
  assert.match(
    source,
    /["']display["']/,
    "the helper selector must recognize display-space compositing"
  );
}

function assertWebGpuMaterialFamilies(sourceMap) {
  const families = ["raster", "fill", "stroke", "text", "gradient"];
  for (const family of families) {
    const source = sourceMap[family];
    assert.match(
      source,
      /threeColorCompositing|colorCompositing/,
      `the Three WebGPU ${family} material must receive the color-compositing contract`
    );
    assert.match(
      source,
      /threeWebGpu[^\n]*(?:Color|Output|Working)|(?:Color|Output|Working)[^\n]*threeWebGpu/,
      `the Three WebGPU ${family} material must select a shared PDF output-color helper`
    );
  }

  assert.match(
    sourceMap.raster,
    /OneFactor/,
    "the WebGPU raster path must retain premultiplied-alpha blending"
  );
  assert.match(
    sourceMap.raster,
    /OneMinusSrcAlphaFactor/,
    "the WebGPU raster path must composite premultiplied display pixels over its destination"
  );
}

function assertThreeObjectContract(source) {
  assert.match(
    source,
    /threeColorCompositing\??\s*:/,
    "Three object options must expose the PDF color-compositing contract"
  );
  assert.match(
    source,
    /threeColorCompositing\s*:\s*[\s\S]{0,160}(?:threeColorCompositing|["']linear["'])/,
    "Three object options must be normalized into renderer configuration"
  );

  const fallbackTexture = extractFunction(source, "createRenderCanvasTexture");
  assert.match(
    fallbackTexture,
    /THREE\.NoColorSpace/,
    "display-composited native fallback canvases must not be decoded a second time"
  );
  assert.match(
    fallbackTexture,
    /THREE\.SRGBColorSpace/,
    "linear-composited native fallback canvases must retain normal sRGB texture decoding"
  );
  assert.match(
    fallbackTexture,
    /threeColorCompositing|colorCompositing|display/i,
    "fallback texture color space must follow the compositing mode"
  );

  const directColorWindow = findWindowsAround(source, "THREE.LinearSRGBColorSpace", 900)
    .find((window) => /highlight|overlay/i.test(window) && /set(?:RGB|Hex)\s*\(/.test(window));
  assert.ok(
    directColorWindow,
    "display-space WebGPU overlays must store their visible colors as direct components"
  );
  assert.match(
    directColorWindow,
    /threeColorCompositing|colorCompositing|display/i,
    "direct overlay colors must only be used by the display-compositing path"
  );

  const hostGuard = [
    extractFunction(source, "hostUsesMaterialBackend"),
    extractFunction(source, "hostColorCompositingMatches")
  ].join("\n");
  assert.match(
    hostGuard,
    /threeColorCompositing|colorCompositing|display/i,
    "material-host compatibility must account for display-space compositing"
  );
  assert.match(
    hostGuard,
    /outputColorSpace/,
    "the display-space material path must validate its host output color space"
  );
  assert.match(
    hostGuard,
    /THREE\.LinearSRGBColorSpace/,
    "display-space WebGPU materials require a direct LinearSRGB host target"
  );
  assert.match(
    hostGuard,
    /THREE\.SRGBColorSpace/,
    "linear-composited WebGPU materials require Three's normal sRGB output target"
  );
}

function assertBlendReferenceMath() {
  const coverage = 0.5;
  const displaySpaceResult = 1 - coverage;
  const previousLinearResult = linearToSrgb(1 - coverage);
  const displayContractResult = 1 - coverage;

  assert.equal(displaySpaceResult, 0.5);
  assert.ok(
    Math.abs(previousLinearResult - 0.7353569830524495) < 1e-12,
    "the former linear blend should demonstrate the observed ~0.735 bright edge"
  );
  assert.equal(
    displayContractResult,
    displaySpaceResult,
    "display-space WebGPU compositing must match the three existing direct-output paths"
  );
}

function linearToSrgb(value) {
  const safeValue = Math.max(0, Math.min(1, value));
  return safeValue <= 0.0031308
    ? safeValue * 12.92
    : 1.055 * safeValue ** (1 / 2.4) - 0.055;
}

function extractWgslDefinitions(source) {
  const definitions = [];
  const marker = "TSL.wgslFn";
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex < 0) {
      break;
    }
    const templateStart = source.indexOf("`", markerIndex + marker.length);
    if (templateStart < 0) {
      break;
    }
    const templateEnd = findTemplateEnd(source, templateStart);
    if (templateEnd < 0) {
      break;
    }
    definitions.push({
      context: source.slice(Math.max(0, markerIndex - 220), markerIndex),
      body: source.slice(templateStart + 1, templateEnd)
    });
    searchFrom = templateEnd + 1;
  }
  return definitions;
}

function findTemplateEnd(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "`") {
      return index;
    }
  }
  return -1;
}

function extractFunction(source, name) {
  const declarationPattern = new RegExp(
    `\\b(?:function|private|protected|public)\\s+${escapeRegExp(name)}\\s*\\(`
  );
  const declarationMatch = declarationPattern.exec(source);
  assert.ok(declarationMatch, `expected to find the ${name}() declaration`);
  const declarationIndex = declarationMatch.index;
  const bodyStart = source.indexOf("{", declarationIndex);
  assert.notEqual(bodyStart, -1, `expected ${name}() to have a body`);
  const bodyEnd = findMatchingBrace(source, bodyStart);
  assert.notEqual(bodyEnd, -1, `expected ${name}() to have balanced braces`);
  return source.slice(declarationIndex, bodyEnd + 1);
}

function findMatchingBrace(source, start) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findWindowsAround(source, needle, radius) {
  const windows = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const index = source.indexOf(needle, searchFrom);
    if (index < 0) {
      break;
    }
    windows.push(
      source.slice(
        Math.max(0, index - radius),
        Math.min(source.length, index + needle.length + radius)
      )
    );
    searchFrom = index + needle.length;
  }
  assert.ok(windows.length > 0, `expected to find ${needle}`);
  return windows;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
