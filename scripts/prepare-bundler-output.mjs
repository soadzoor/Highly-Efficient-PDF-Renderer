import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseAst } from "vite";
import { compactShaderComments } from "./lib/compactShaderComments.mjs";

const sourceDir = fileURLToPath(new URL("../src/", import.meta.url));
const outputDir = fileURLToPath(new URL("../dist/bundler/", import.meta.url));

// Shared Node clients expect the historical worker filenames. Keep their
// references inside this module graph too, without loading dist/lib copies.
await writeFile(resolve(outputDir, "pdf-worker.js"), 'import "./pdf/pdfWorkerEntry.js";\n');
await writeFile(resolve(outputDir, "pdf/pdf-worker.js"), 'import "./pdfWorkerEntry.js";\n');

// tsc preserves the module graph and new URL(..., import.meta.url) expressions.
// Add explicit JS extensions and copy referenced assets without running Vite's
// asset/worker transforms: those belong to the consuming application's build.
const files = (await readdir(outputDir, { recursive: true }))
  .filter(name => name.endsWith(".js"))
  .sort();
const assets = new Set();
for (const name of files) {
  const file = resolve(outputDir, name);
  const code = await readFile(file, "utf8");
  const edits = [];
  const dependencies = [];
  walk(parseAst(code), node => {
    const reference = node.type === "ImportExpression" ? node.source
      : ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
        ? node.source : undefined;
    if (typeof reference?.value === "string" && /^\.\.?\//.test(reference.value)) {
      const specifier = reference.value.replace(/\.ts$/, ".js");
      const target = extname(specifier) ? specifier : `${specifier}.js`;
      if (target !== reference.value) edits.push({ start: reference.start, end: reference.end, value: target });
      dependencies.push(fileURLToPath(new URL(target, pathToFileURL(file))));
    }
    if (node.type !== "NewExpression" || node.callee.name !== "URL") return;
    const [url, base] = node.arguments;
    if (typeof url?.value !== "string" || !/^\.\.?\//.test(url.value)) return;
    if (url.value.endsWith(".ts")) {
      const target = url.value.replace(/\.ts$/, ".js");
      edits.push({ start: url.start, end: url.end, value: target });
      dependencies.push(fileURLToPath(new URL(target, pathToFileURL(file))));
    } else if (base && code.slice(base.start, base.end) === "import.meta.url") {
      const asset = fileURLToPath(new URL(url.value, pathToFileURL(file)));
      const assetName = relative(outputDir, asset);
      if (assetName.startsWith("..")) throw new Error(`Asset escapes the bundler output: ${url.value}`);
      if (assetName.endsWith(".js")) dependencies.push(asset);
      else assets.add(assetName);
    }
  });
  await Promise.all(dependencies.map(dependency => access(dependency)));
  let output = code;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + JSON.stringify(edit.value) + output.slice(edit.end);
  }
  await writeFile(file, compactShaderComments(output));
}
for (const name of assets) {
  const destination = resolve(outputDir, name);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(sourceDir, name), destination);
}

console.log(`Prepared ${files.length} bundler modules and ${assets.size} assets.`);

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}
