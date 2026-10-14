import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { convertPdfOutputs } from "../bin/thumbnail-cli-worker.mjs";
import { HepArchive } from "./lib/hepContainer.mjs";

const scratch = await mkdtemp(path.join(tmpdir(), "hepr-thumbnail-cli-worker-"));
let fixtureNumber = 0;
try {
  await bothOutputsShareSession();
  await existingOutputsAvoidParsing();
  await independentFailuresPreserveOutput();
  await pngFallbackUsesActualPath();
  await fallbackReplacementIsAtomic();
  await unchangedHepKeepsExistingBytes();
  await setupFailuresReportPendingArtifacts();
  await cancelBusyArtifact("SIGINT", 130);
  await cancelBusyArtifact("SIGTERM", 143);
  await cancelAfterThumbnail();
  await cancelPendingSetup();
  await cancelPendingLoad();
  console.log("Thumbnail CLI worker: shared session, independent/atomic artifacts, PNG fallback paths, unchanged HEP, setup failures, signal cancellation and late-resource cleanup passed.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

async function fixture(options = {}, overrides = {}) {
  const directory = path.join(scratch, String(++fixtureNumber));
  const pdfPath = path.join(directory, "source.pdf");
  await mkdir(directory);
  await writeFile(pdfPath, "%PDF-fixture");
  const thumbnail = { kind: "thumbnail", outputPath: path.join(directory, "source.webp"), format: "webp" };
  const hep = { kind: "hep", outputPath: path.join(directory, "source.hep") };
  const reports = [], logs = [], warnings = [], errors = [], calls = [];
  const counts = { load: 0, canvas: 0, open: 0, sessionClose: 0, runtimeClose: 0 };
  const signalTarget = new EventEmitter();
  const session = {
    async renderThumbnail(value) { calls.push(["thumbnail", value]); return imageResult(); },
    async buildHep(value) { calls.push(["hep", value]); return new Blob(["canonical-hep"]); },
    async close() { counts.sessionClose++; }
  };
  const runtime = {
    HepArchive,
    async openDocumentSession(source, value) { counts.open++; calls.push(["open", source, value]); return session; },
    async close() { counts.runtimeClose++; }
  };
  const item = { pdfPath, artifacts: [hep, thumbnail], fileNumber: 3, fileCount: 5 };
  const dependencies = {
    signalTarget,
    async assertCanvasAvailable() { counts.canvas++; },
    async loadDocumentSession() { counts.load++; return runtime; },
    log: message => logs.push(message), warn: message => warnings.push(message), error: message => errors.push(message),
    ...overrides
  };
  return { directory, pdfPath, thumbnail, hep, item, session, runtime, counts, calls, reports, logs, warnings, errors,
    signalTarget, options: { output: "both", ...options }, dependencies,
    run() { return convertPdfOutputs(item, this.options, dependencies, value => reports.push(value)); },
    artifacts() { return reports.filter(value => value.type === "pdf-output-artifact"); },
    assertClosed() {
      assert.equal(signalTarget.listenerCount("SIGINT"), 0);
      assert.equal(signalTarget.listenerCount("SIGTERM"), 0);
      assert.equal(counts.sessionClose, counts.open);
      assert.equal(counts.runtimeClose, counts.load);
    }
  };
}

async function bothOutputsShareSession() {
  const f = await fixture({ password: "private", iccEngine: "lcms", annotationAppearances: "forms",
    withVectorLod: false, thumbnailPage: 2, thumbnailMaxDimension: 60, thumbnailBackground: "transparent" });
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.calls.map(value => value[0]), ["open", "thumbnail", "hep"], "a single session prepares the thumbnail before canonical HEP");
  assert.equal(f.counts.open, 1);
  const open = f.calls[0][2], thumbnail = f.calls[1][1], hep = f.calls[2][1];
  assert.equal(open.password, "private"); assert.equal(open.iccEngine, "lcms");
  assert.deepEqual([thumbnail.page, thumbnail.maxDimension, thumbnail.background, thumbnail.format], [2, 60, "transparent", "webp"]);
  assert.equal(thumbnail.signal, open.signal); assert.equal(hep.signal, open.signal);
  assert.equal(hep.withVectorLod, false); assert.equal(hep.withTextLod, true);
  assert.equal(hep.annotationAppearances, "forms");
  assert.equal(await readFile(f.hep.outputPath, "utf8"), "canonical-hep");
  assert.deepEqual(f.artifacts().map(({ kind, status, format, width, height }) => ({ kind, status, format, width, height })), [
    { kind: "thumbnail", status: "generated", format: "webp", width: 8, height: 4 },
    { kind: "hep", status: "generated", format: undefined, width: undefined, height: undefined }
  ]);
  assert(f.artifacts().every(value => value.durationMs >= 0 && value.outputBytes > 0));
  assert(f.reports.some(value => value.type === "pdf-to-hep-sizes" && value.sourceBytes === 12));
  f.assertClosed();
}

async function existingOutputsAvoidParsing() {
  const f = await fixture();
  await writeFile(f.hep.outputPath, "old-hep"); await writeFile(f.thumbnail.outputPath, "old-thumbnail");
  assert.equal(await f.run(), 3);
  assert.deepEqual(f.artifacts().map(value => value.status), ["skipped", "skipped"]);
  assert.equal(f.counts.canvas, 0); assert.equal(f.counts.load, 0); assert.equal(f.counts.open, 0);
  assert.equal(await readFile(f.hep.outputPath, "utf8"), "old-hep");
  f.assertClosed();
  const fallback = await fixture();
  const pngPath = fallback.thumbnail.outputPath.replace(/\.webp$/, ".png");
  fallback.item.artifacts = [{ ...fallback.thumbnail, candidatePaths: [fallback.thumbnail.outputPath, pngPath] }];
  await writeFile(pngPath, "previous-png");
  assert.equal(await fallback.run(), 3);
  assert.equal(fallback.counts.open, 0, "an existing fallback PNG avoids opening the parser");
  assert.deepEqual(fallback.artifacts().map(value => [value.outputPath, value.format, value.outputBytes]),
    [[pngPath, "png", 12]], "skip reports identify the existing encoding and actual file size");
  fallback.assertClosed();
  const partial = await fixture();
  partial.item.artifacts = [partial.hep];
  assert.equal(await partial.run(), 0);
  assert.deepEqual(partial.calls.map(value => value[0]), ["open", "hep"], "omitted thumbnail artifacts do no thumbnail work");
  partial.assertClosed();
}

async function independentFailuresPreserveOutput() {
  const failedThumbnail = await fixture();
  failedThumbnail.session.renderThumbnail = async () => { throw new Error("thumbnail failure"); };
  assert.equal(await failedThumbnail.run(), 1);
  assert.deepEqual(failedThumbnail.artifacts().map(value => [value.kind, value.status]), [["thumbnail", "failed"], ["hep", "generated"]]);
  assert.equal(await readFile(failedThumbnail.hep.outputPath, "utf8"), "canonical-hep");
  failedThumbnail.assertClosed();
  const failedHep = await fixture();
  failedHep.session.buildHep = async () => { throw new Error("canonical failure"); };
  assert.equal(await failedHep.run(), 1);
  assert.deepEqual(failedHep.artifacts().map(value => [value.kind, value.status]), [["thumbnail", "generated"], ["hep", "failed"]]);
  assert.equal(await readFile(failedHep.thumbnail.outputPath, "utf8"), "encoded-image");
  failedHep.assertClosed();
  const failedWrite = await fixture();
  failedWrite.session.renderThumbnail = async () => imageResult("webp", new BrokenBlob(["partial"], { type: "image/webp" }));
  assert.equal(await failedWrite.run(), 1);
  assert.equal(failedWrite.artifacts()[0].status, "failed");
  assert.equal(failedWrite.artifacts()[1].status, "generated");
  assert(!(await readdir(failedWrite.directory)).some(name => name.startsWith(".hepr-")), "failed streaming writes remove temporary files");
  failedWrite.assertClosed();
}

async function pngFallbackUsesActualPath() {
  const f = await fixture(); f.item.artifacts = [f.thumbnail];
  f.session.renderThumbnail = async () => imageResult("png");
  assert.equal(await f.run(), 0);
  const pngPath = f.thumbnail.outputPath.replace(/\.webp$/, ".png");
  assert.equal(await readFile(pngPath, "utf8"), "encoded-image");
  assert.deepEqual(f.artifacts().map(value => [value.outputPath, value.format]), [[pngPath, "png"]]);
  assert(!(await readdir(f.directory)).includes("source.webp"), "PNG bytes never use a WebP extension");
  f.assertClosed();
  const existing = await fixture(); existing.item.artifacts = [existing.thumbnail];
  existing.session.renderThumbnail = async () => imageResult("png");
  await writeFile(existing.thumbnail.outputPath.replace(/\.webp$/, ".png"), "existing-png");
  assert.equal(await existing.run(), 3);
  assert.equal(existing.artifacts()[0].status, "skipped");
  assert.equal(await readFile(existing.thumbnail.outputPath.replace(/\.webp$/, ".png"), "utf8"), "existing-png");
  existing.assertClosed();
}

async function fallbackReplacementIsAtomic() {
  for (const format of ["png", "webp"]) {
    const f = await fixture({ force: true }); f.item.artifacts = [f.thumbnail];
    const pngPath = f.thumbnail.outputPath.replace(/\.webp$/, ".png");
    await writeFile(f.thumbnail.outputPath, "old-webp"); await writeFile(pngPath, "old-png");
    f.session.renderThumbnail = async () => imageResult(format);
    assert.equal(await f.run(), 0);
    assert.deepEqual((await readdir(f.directory)).sort(), [`source.${format}`, "source.pdf"].sort(), "force replaces the logical WebP thumbnail only after successful commit");
    f.assertClosed();
  }
  const failed = await fixture({ force: true }); failed.item.artifacts = [failed.thumbnail];
  const pngPath = failed.thumbnail.outputPath.replace(/\.webp$/, ".png");
  await writeFile(failed.thumbnail.outputPath, "old-webp"); await writeFile(pngPath, "old-png");
  failed.session.renderThumbnail = async () => imageResult("png", new BrokenBlob(["partial"], { type: "image/png" }));
  assert.equal(await failed.run(), 1);
  assert.equal(await readFile(failed.thumbnail.outputPath, "utf8"), "old-webp");
  assert.equal(await readFile(pngPath, "utf8"), "old-png");
  assert(!(await readdir(failed.directory)).some(name => name.startsWith(".hepr-")));
  failed.assertClosed();
  const explicitPng = await fixture({ force: true, thumbnailFormat: "png" });
  explicitPng.item.artifacts = [{ ...explicitPng.thumbnail, outputPath: explicitPng.thumbnail.outputPath.replace(/\.webp$/, ".png"), format: "png" }];
  await writeFile(explicitPng.thumbnail.outputPath, "independent-webp");
  explicitPng.session.renderThumbnail = async () => imageResult("png");
  assert.equal(await explicitPng.run(), 0);
  assert.equal(await readFile(explicitPng.thumbnail.outputPath, "utf8"), "independent-webp", "explicit PNG output preserves independent WebP output");
  explicitPng.assertClosed();
  const racedDirectory = await fixture({ force: true }); racedDirectory.item.artifacts = [racedDirectory.thumbnail];
  racedDirectory.session.renderThumbnail = async () => { await mkdir(racedDirectory.thumbnail.outputPath); return imageResult("png"); };
  assert.equal(await racedDirectory.run(), 0);
  assert.equal(racedDirectory.artifacts()[0].status, "generated", "an alternate cleanup failure preserves the successfully written output");
  assert.equal(racedDirectory.warnings.length, 1, "nonregular alternate paths produce a diagnostic and are preserved");
  assert.equal(await readFile(racedDirectory.thumbnail.outputPath.replace(/\.webp$/, ".png"), "utf8"), "encoded-image");
  racedDirectory.assertClosed();
}

async function unchangedHepKeepsExistingBytes() {
  const f = await fixture({ force: true, keepUnchanged: true }); f.item.artifacts = [f.hep];
  const existing = await hepBytes("2026-01-01T00:00:00.000Z"), candidate = await hepBytes("2026-02-02T00:00:00.000Z");
  await writeFile(f.hep.outputPath, existing);
  f.session.buildHep = async () => new Blob([candidate]);
  assert.equal(await f.run(), 3);
  assert.deepEqual(new Uint8Array(await readFile(f.hep.outputPath)), existing, "timestamp-only output keeps existing bytes");
  assert.equal(f.artifacts()[0].status, "skipped");
  assert.equal(f.artifacts()[0].outputBytes, existing.length);
  f.assertClosed();
}

async function setupFailuresReportPendingArtifacts() {
  const f = await fixture();
  f.runtime.openDocumentSession = async () => { throw new Error("bad PDF password"); };
  assert.equal(await f.run(), 1);
  assert.deepEqual(f.artifacts().map(value => value.status), ["failed", "failed"]);
  assert(f.artifacts().every(value => value.errorMessage === "bad PDF password"));
  f.assertClosed();
  const canvas = await fixture({}, { assertCanvasAvailable: async () => { throw new Error("missing canvas"); } });
  assert.equal(await canvas.run(), 1);
  assert.equal(canvas.counts.load, 0);
  assert.deepEqual(canvas.artifacts().map(value => value.status), ["failed", "failed"]);
  canvas.assertClosed();
}

async function cancelBusyArtifact(signalName, code) {
  const f = await fixture(), entered = deferred(), pending = deferred();
  f.session.renderThumbnail = () => { entered.resolve(); return pending.promise; };
  const result = f.run();
  await entered.promise;
  f.signalTarget.emit(signalName); f.signalTarget.emit(signalName === "SIGINT" ? "SIGTERM" : "SIGINT");
  assert.equal(await withTimeout(result), code, "signals abort pending work without waiting for its result");
  assert.equal(f.counts.sessionClose, 1, "the owned session closes promptly and once");
  assert.deepEqual(f.artifacts(), [], "interrupted artifacts are not incorrectly reported as failed");
  pending.resolve(imageResult()); await tick();
  assert.deepEqual(await readdir(f.directory), ["source.pdf"], "a late result cannot commit cancelled output");
  f.assertClosed();
}

async function cancelAfterThumbnail() {
  const f = await fixture(), entered = deferred(), pending = deferred();
  f.session.buildHep = () => { entered.resolve(); return pending.promise; };
  const result = f.run(); await entered.promise;
  f.signalTarget.emit("SIGTERM");
  assert.equal(await withTimeout(result), 143);
  assert.equal(await readFile(f.thumbnail.outputPath, "utf8"), "encoded-image", "interrupting HEP preserves the completed thumbnail");
  assert.deepEqual(f.artifacts().map(value => [value.kind, value.status]), [["thumbnail", "generated"]]);
  pending.resolve(new Blob(["late-hep"])); await tick();
  assert(!(await readdir(f.directory)).includes("source.hep"));
  f.assertClosed();
}

async function cancelPendingSetup() {
  const f = await fixture(), entered = deferred(), pending = deferred();
  f.runtime.openDocumentSession = () => { f.counts.open++; entered.resolve(); return pending.promise; };
  const result = f.run(); await entered.promise;
  f.signalTarget.emit("SIGINT");
  assert.equal(await withTimeout(result), 130);
  assert.equal(f.counts.sessionClose, 0);
  pending.resolve(f.session); await tick();
  assert.equal(f.counts.sessionClose, 1, "a session that opens after cancellation is released");
  f.assertClosed();
}

async function cancelPendingLoad() {
  const f = await fixture(), entered = deferred(), pending = deferred();
  f.dependencies.loadDocumentSession = () => { f.counts.load++; entered.resolve(); return pending.promise; };
  const result = f.run(); await entered.promise;
  f.signalTarget.emit("SIGTERM");
  assert.equal(await withTimeout(result), 143);
  assert.equal(f.counts.runtimeClose, 0);
  pending.resolve(f.runtime); await tick();
  assert.equal(f.counts.runtimeClose, 1, "a runtime loaded after cancellation is released without opening a PDF");
  assert.equal(f.counts.open, 0);
  f.assertClosed();
}

function imageResult(format = "webp", blob = new Blob(["encoded-image"], { type: `image/${format}` })) {
  return { blob, width: 8, height: 4 };
}
class BrokenBlob extends Blob {
  stream() { return new ReadableStream({ start(controller) { controller.error(new Error("synthetic output stream failure")); } }); }
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function withTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Signal cancellation did not settle.")), 5_000);
    promise.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
  });
}
async function hepBytes(generatedAt) {
  const archive = new HepArchive();
  archive.file("manifest.json", JSON.stringify({ generatedAt, formatVersion: 9 }));
  archive.file("scene.bin", Uint8Array.of(1, 2, 3));
  return archive.generateAsync({ type: "uint8array" });
}
