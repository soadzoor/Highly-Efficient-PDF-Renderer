import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceDir = fileURLToPath(new URL("../../src/", import.meta.url));
const packageDir = fileURLToPath(new URL("../../dist/bundler/", import.meta.url));
const loaded = new Set();
const within = (directory, file) => {
  const name = relative(directory, file);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};

// Reuse the existing material regressions against emitted package modules.
// Their own TypeScript extension hooks remain valid, but no source module may
// enter this graph, including through a nested import or fallback resolution.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^(?:\.{1,2}\/|\/|file:)/.test(specifier)) {
      const url = new URL(specifier, context.parentURL ?? new URL("../../", import.meta.url));
      if (url.protocol === "file:") {
        const file = fileURLToPath(url);
        if (within(sourceDir, file)) {
          const name = relative(sourceDir, file);
          const extension = extname(name);
          const target = extension === ".ts" ? name.slice(0, -3) + ".js"
            : extension ? name : name + ".js";
          return nextResolve(pathToFileURL(resolve(packageDir, target)).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) {
      const file = fileURLToPath(url);
      assert(!within(sourceDir, file), `Built material tests loaded a source module: ${file}`);
      if (within(packageDir, file)) loaded.add(relative(packageDir, file).split(sep).join("/"));
    }
    return nextLoad(url, context);
  }
});

process.once("beforeExit", () => {
  assert(loaded.size > 0, "The shader regression must exercise emitted package modules.");
  for (const name of (process.env.HEPR_BUILT_EXPECTED_MODULES ?? "").split(",").filter(Boolean)) {
    assert(loaded.has(name), `The shader regression did not load emitted ${name}.`);
  }
});
