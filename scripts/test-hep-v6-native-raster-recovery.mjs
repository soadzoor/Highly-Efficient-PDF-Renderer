// Old source-PDF recovery archives must fail before attempting any PDF parsing.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { HepArchive } from "./lib/hepContainer.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const archive = new HepArchive();
  archive.file("manifest.json", JSON.stringify({ formatVersion: 6, sourcePdfFile: "source/source.pdf", scene: { imagePaintOpCount: 1 } }));
  archive.file("source/source.pdf", "%PDF-invalid-source-must-never-be-parsed");
  await assert.rejects(loadSceneFromHep(await archive.generateAsync({ type: "arraybuffer" })),
    /format v6 is not supported.*expected v\d+.*Re-export/);
  console.log("HEP v6 source-recovery archives are rejected without parsing their embedded PDF.");
} finally { hooks.deregister(); }
