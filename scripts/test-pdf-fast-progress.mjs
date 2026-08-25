import assert from "node:assert/strict";

import {
  createLoadProgressReporter,
  formatLoadProgressStage
} from "../src/loadProgress.ts";

assert.equal(formatLoadProgressStage("pdf-fast-check"), "Checking fast PDF path");
assert.equal(formatLoadProgressStage("pdf-fast-decode"), "Decoding PDF vectors");
assert.equal(formatLoadProgressStage("pdf-operators"), "Scanning operators");

const directEvents = [];
const directReporter = createLoadProgressReporter(
  (event) => directEvents.push(event),
  { throttleMs: 0, minDelta: 0 }
);

directReporter.report(0.1, {
  stage: "pdf-fast-check",
  executionPath: "dense-vector-worker",
  sourceType: "pdf",
  unit: "bytes",
  processed: 10,
  total: 100
});
directReporter.report(0.2, {
  stage: "pdf-fast-decode",
  executionPath: "dense-vector-worker",
  sourceType: "pdf",
  unit: "bytes",
  processed: 20,
  total: 100
});

assert.deepEqual(
  directEvents.map(({ stage, executionPath }) => ({ stage, executionPath })),
  [
    { stage: "pdf-fast-check", executionPath: "dense-vector-worker" },
    { stage: "pdf-fast-decode", executionPath: "dense-vector-worker" }
  ]
);

const indeterminateEvents = [];
const indeterminateReporter = createLoadProgressReporter(
  (event) => indeterminateEvents.push(event),
  { throttleMs: 0, minDelta: 0 }
);

await indeterminateReporter.withIndeterminateProgress(Promise.resolve("done"), {
  stage: "pdf-fast-decode",
  executionPath: "dense-vector-worker",
  sourceType: "pdf"
});

assert.ok(indeterminateEvents.length >= 2);
assert.ok(
  indeterminateEvents.every(
    (event) =>
      event.stage === "pdf-fast-decode" &&
      event.executionPath === "dense-vector-worker" &&
      event.sourceType === "pdf"
  )
);

console.log("PDF fast-path progress tests passed.");
