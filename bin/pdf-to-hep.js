#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runPdfToHep } from "../PDFtoHEP.js";
import { loadPublishedHepBuilder } from "./runtime.mjs";

// Always enter the CLI, including when npm invokes it through a .bin symlink.
runPdfToHep(process.argv.slice(2), {
  loadBuilder: loadPublishedHepBuilder,
  workerScriptPath: fileURLToPath(import.meta.url),
  usageCommand: "pdf-to-hep"
}).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error(`PDF-to-HEP conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Run pdf-to-hep --help for usage.");
    process.exitCode = 1;
  }
);
