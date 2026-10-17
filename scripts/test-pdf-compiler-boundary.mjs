import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(repositoryRoot, "src");
const legacyCompilerPath = path.join(sourceRoot, "densePdfContentCompiler.ts");
const nativeCompilerPath = path.join(sourceRoot, "pdf/nativeContentCompiler.ts");

const requiredNativeConsumers = [
  "src/densePdfPageData.ts",
  "src/pdf/nativeFormGeometry.ts",
  "src/pdf/nativeFormPrograms.ts",
  "src/pdfSession.ts"
];

await assertCompilerImportBoundary();
await assertCompilerRuntimeBoundary();
await assertDirectVectorBoundary();

console.log("PDF compiler boundary contract passed");
hooks.deregister();

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

  assert.deepEqual([...legacyConsumers], [], "the native compiler is the only PDF content compiler");
  for (const consumer of requiredNativeConsumers) {
    assert.ok(
      nativeConsumers.has(consumer),
      `${consumer} must import pdf/nativeContentCompiler`
    );
  }
}

async function assertCompilerRuntimeBoundary() {
  await assert.rejects(access(legacyCompilerPath), "the separate dense-vector compiler stays removed");
  const nativeCompiler = await import(pathToFileURL(nativeCompilerPath).href);
  const content = new TextEncoder().encode("0 0 m 10 10 l S\n");
  const options = {
    pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    enableSegmentMerge: false,
    enableInvisibleCull: false
  };

  const nativeResult = await nativeCompiler.compileDensePdfContent(content, {
    ...options,
    output: "display-program"
  });
  assert.ok(nativeResult.paintRuns instanceof Uint32Array);
  assert.ok(Array.isArray(nativeResult.paintRunCompositeStates));
  assert.equal("retainedTextContent" in nativeResult, false);
  assert.equal(typeof nativeCompiler.DensePdfResourceLimitError, "function");
}

async function assertDirectVectorBoundary() {
  const sessionSource = await readFile(path.join(sourceRoot, "pdfSession.ts"), "utf8");
  const wrapper = readMethodBody(sessionSource, "compileVectorPageUnlocked");
  assert.match(wrapper, /this\.compileVectorPageContentUnlocked\(/,
    "annotation metadata wraps the existing direct vector compilation path");
  const body = readMethodBody(sessionSource, "compileVectorPageContentUnlocked");
  assert.match(
    body,
    /preparePageCompilation\([\s\S]*?"vector-scene"[\s\S]*?\)/,
    "the native VectorScene path must request VectorScene compiler data"
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
