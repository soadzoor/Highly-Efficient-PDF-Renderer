import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(repositoryRoot, "src");
const legacyCompilerPath = path.join(sourceRoot, "densePdfContentCompiler.ts");
const nativeCompilerPath = path.join(sourceRoot, "pdf/nativeContentCompiler.ts");

const expectedLegacyConsumers = [
  "src/densePdfFastWorker.ts",
  "src/densePdfFastWorkerClient.ts",
  "src/nativeDenseRetainedTextCompiler.ts"
];
const exclusiveLegacyConsumers = [
  "src/densePdfFastWorker.ts",
  "src/densePdfFastWorkerClient.ts"
];
const requiredNativeConsumers = [
  "src/densePdfPageData.ts",
  "src/pdf/nativeFormGeometry.ts",
  "src/pdf/nativeFormPrograms.ts",
  "src/pdfSession.ts"
];

await assertCompilerImportBoundary();
await assertWorkerIsTypeChecked();
await assertCompilerRuntimeBoundary();
await assertDirectVectorBoundary();

console.log("PDF compiler boundary contract passed");

async function assertCompilerImportBoundary() {
  const legacyConsumers = new Set();
  const nativeConsumers = new Set();

  for (const filePath of await listTypeScriptFiles(sourceRoot)) {
    const source = await readFile(filePath, "utf8");
    for (const specifier of readModuleSpecifiers(source)) {
      const compiler = compilerKind(specifier);
      if (!compiler) continue;
      const consumer = normalizeRepositoryPath(filePath);
      (compiler === "legacy" ? legacyConsumers : nativeConsumers).add(consumer);
    }
  }

  assert.deepEqual(
    [...legacyConsumers].sort(),
    expectedLegacyConsumers,
    "only the established dense path and retained-text compatibility bridge may import the legacy compiler"
  );
  for (const consumer of requiredNativeConsumers) {
    assert.ok(
      nativeConsumers.has(consumer),
      `${consumer} must import pdf/nativeContentCompiler`
    );
  }
  for (const consumer of exclusiveLegacyConsumers) {
    assert.equal(
      nativeConsumers.has(consumer),
      false,
      `${consumer} must not import the native compiler`
    );
  }
}

async function assertWorkerIsTypeChecked() {
  const configPath = path.join(repositoryRoot, "tsconfig.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const worker = "src/densePdfFastWorker.ts";
  const explicitFiles = config.files ?? [];
  const includePatterns = config.include ?? (config.files ? [] : ["**/*"]);
  const excludePatterns = config.exclude ?? ["node_modules", "bower_components", "jspm_packages"];
  const explicitlyIncluded = explicitFiles.some((pattern) => matchesConfigPath(pattern, worker));
  const includedByPattern = includePatterns.some((pattern) => matchesConfigPath(pattern, worker));
  const excludedByPattern = excludePatterns.some((pattern) => matchesConfigPath(pattern, worker));
  assert.ok(
    explicitlyIncluded || (includedByPattern && !excludedByPattern),
    "tsconfig.json must include densePdfFastWorker.ts so compiler ABI drift fails type-checking"
  );
}

async function assertCompilerRuntimeBoundary() {
  const [legacyCompiler, nativeCompiler] = await Promise.all([
    import(pathToFileURL(legacyCompilerPath).href),
    import(pathToFileURL(nativeCompilerPath).href)
  ]);
  const content = new TextEncoder().encode("0 0 m 10 10 l S\n");
  const options = {
    pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    enableSegmentMerge: false,
    enableInvisibleCull: false
  };

  const legacyResult = await legacyCompiler.compileDensePdfContent(content, options);
  assert.ok(legacyResult.retainedTextContent instanceof Uint8Array);
  assert.equal(typeof legacyResult.dependencyOpCount, "number");
  assert.ok(Array.isArray(legacyResult.dependencyKeys));
  assert.equal("paintRuns" in legacyResult, false);

  const nativeResult = await nativeCompiler.compileDensePdfContent(content, {
    ...options,
    preservePaintOrder: true
  });
  assert.ok(nativeResult.paintRuns instanceof Uint32Array);
  assert.ok(Array.isArray(nativeResult.paintRunCompositeStates));
  assert.equal("retainedTextContent" in nativeResult, false);
  assert.equal("dependencyKeys" in nativeResult, false);
  assert.equal(typeof nativeCompiler.DensePdfResourceLimitError, "function");
  assert.equal(legacyCompiler.DensePdfResourceLimitError, undefined);
}

async function assertDirectVectorBoundary() {
  const sessionSource = await readFile(path.join(sourceRoot, "pdfSession.ts"), "utf8");
  const body = readMethodBody(sessionSource, "compileVectorPageUnlocked");
  assert.match(
    body,
    /preparePageCompilation\([\s\S]*?\btrue\b[\s\S]*?\)/,
    "the native VectorScene path must request the legacy-renderer compiler sidecar"
  );
  assert.match(
    body,
    /\bbuildNativeVectorPage\s*\(/,
    "the native parser must terminate directly at the existing VectorScene ABI"
  );
  assert.doesNotMatch(
    body,
    /\b(?:createHeprPageDataFromDense|NativePageTextAccumulator|compileNativeFormPrograms|compileNativeType3Programs|compileNativeCompositingPrograms|validateHeprPageData)\b/,
    "the direct VectorScene path must not construct the alternate page-native graph"
  );
}

async function listTypeScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTypeScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

function readModuleSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

function compilerKind(specifier) {
  const moduleName = specifier.split("/").at(-1)?.replace(/\.ts$/, "");
  if (moduleName === "densePdfContentCompiler") return "legacy";
  if (moduleName === "nativeContentCompiler") return "native";
  return null;
}

function normalizeRepositoryPath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function readMethodBody(source, methodName) {
  const declaration = new RegExp(
    `(?:private\\s+)?async\\s+${methodName}\\s*\\([^)]*\\)\\s*:[^{]+\\{`,
    "g"
  ).exec(source);
  assert.ok(declaration, `missing ${methodName}()`);
  const start = declaration.index + declaration[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  assert.fail(`unterminated ${methodName}()`);
}

function matchesConfigPath(pattern, filePath) {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  const normalizedFile = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!/[?*]/.test(normalizedPattern)) {
    return normalizedFile === normalizedPattern || normalizedFile.startsWith(`${normalizedPattern}/`);
  }
  let expression = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === "*" && normalizedPattern[index + 1] === "*") {
      index += 1;
      if (normalizedPattern[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else {
        expression += ".*";
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`).test(normalizedFile);
}
