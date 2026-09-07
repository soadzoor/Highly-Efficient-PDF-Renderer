import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deliberately explicit: no servers, browser automation, corpus benchmarks,
// PDF-to-HEP batch conversion, or optional oracle installation in the PR gate.
const suites = [
  "document-loading",
  "public-load-cancellation",
  "persistent-viewer-contract",
  "pdf-compiler-boundary",
  "native-parser-boundary",
  "optional-node-canvas",
  "native-pdf-core",
  "native-document-semantics",
  "native-source-range-edge-cases",
  "native-parser-fuzz",
  "pdf-session",
  "pdf-session-worker",
  "native-content-compiler",
  "native-vector-page",
  "native-composite-lifetime",
  "native-composite-reuse",
  "native-resource-reuse",
  "native-text-clip-index",
  "scene-statistics",
  "text-parser-work",
  "text-search",
  "text-lod-core",
  "ordered-gradient-paint",
  "deferred-renderer-api",
  "room-overlay-page-matrix",
  "vector-stroke-clip-lod"
];
const root = fileURLToPath(new URL("../", import.meta.url));
const startedAt = performance.now();
const failures = [];
for (const suite of suites) {
  if (performance.now() - startedAt > 10 * 60_000) {
    failures.push("fast suite exceeded its ten-minute total budget");
    break;
  }
  console.log(`\n[fast test] ${suite}`);
  const outcome = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", `scripts/test-${suite}.mjs`], {
      cwd: root,
      stdio: "inherit"
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve(error.message);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve(timedOut ? "exceeded 60 seconds" : code === 0 ? null : `exit ${code ?? signal}`);
    });
  });
  if (outcome) failures.push(`${suite}: ${outcome}`);
}
if (failures.length) {
  console.error(`\nFast tests failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`\n${suites.length} fast suites passed in ${((performance.now() - startedAt) / 1000).toFixed(1)}s.`);
}
