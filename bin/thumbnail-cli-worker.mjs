import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  ExistingOutputError,
  assertNodeCanvasAvailable,
  createProgressLogger,
  existingHepDiffersOnlyInGeneratedAt,
  normalizeRasterFallbackDiagnostic,
  regularOutputExists,
  writeHepBlobAtomically
} from "../PDFtoHEP.js";

/** Compiled Node entry only: no Vite server or source module loader. */
export async function loadPublishedDocumentSession() {
  const [node, container] = await Promise.all([
    import("../dist/lib/node.js"),
    import("../dist/lib/pdf-to-hep-runtime.js")
  ]);
  return { openDocumentSession: node.openDocumentSession, HepArchive: container.HepArchive };
}

/** Generate the pending outputs for one PDF through one reusable parser.
 * Successful artifacts stay committed when a later artifact fails. The
 * coordinator owns discovery, existing-output plans, and child concurrency. */
export async function convertPdfOutputs(item, options, dependencies = {}, report = () => {}) {
  const controller = new AbortController();
  const signal = controller.signal;
  const signalTarget = dependencies.signalTarget ?? process;
  const now = dependencies.now ?? (() => performance.now());
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  const sourceLabel = path.basename(item.pdfPath);
  const prefix = `[${item.fileNumber ?? 1}/${item.fileCount ?? 1}]`;
  let interruptedExitCode = 0;
  let runtime, session, sessionClosing, runtimeClosing;
  let generated = 0, skipped = 0, failed = 0;
  const closeSession = () => session
    ? sessionClosing ??= Promise.resolve().then(() => session.close())
    : Promise.resolve();
  const closeRuntime = () => runtime
    ? runtimeClosing ??= Promise.resolve().then(() => runtime.close?.())
    : Promise.resolve();
  const interrupt = signalName => {
    if (signal.aborted) return;
    interruptedExitCode = signalName === "SIGINT" ? 130 : 143;
    errorLog(`Received ${signalName}; cancelling PDF output generation...`);
    controller.abort(new DOMException("PDF output generation was interrupted.", "AbortError"));
    // Closing an owned Node session terminates a parser even while native
    // Canvas or codec work cannot reach its next cooperative checkpoint.
    void closeSession().catch(() => {});
  };
  const onSigInt = () => interrupt("SIGINT");
  const onSigTerm = () => interrupt("SIGTERM");
  signalTarget.on("SIGINT", onSigInt);
  signalTarget.on("SIGTERM", onSigTerm);
  const artifacts = [...item.artifacts].sort((a, b) => Number(a.kind === "hep") - Number(b.kind === "hep"));
  const emit = (artifact, status, started, extra = {}) => {
    if (status === "generated") generated++;
    else if (status === "skipped") skipped++;
    else failed++;
    report({ type: "pdf-output-artifact", kind: artifact.kind, status,
      outputPath: artifact.outputPath, durationMs: Math.max(0, now() - started), outputBytes: 0, ...extra });
  };
  const diagnostic = value => {
    if (value.severity !== "warning") return;
    const reasons = value.details?.reasons ?? value.details?.reason;
    const fallback = normalizeRasterFallbackDiagnostic({ code: value.code, message: value.message,
      ...(value.pageIndex === undefined ? {} : { pageIndex: value.pageIndex }),
      ...(typeof reasons === "string" && reasons.trim() ? { reason: reasons } : {}) });
    if (fallback) report({ type: "pdf-to-hep-raster-fallback", ...fallback });
    const page = value.pageIndex === undefined ? "" : ` page ${value.pageIndex + 1}`;
    warn(`${sourceLabel}${page}: [${value.code}] ${value.message}`);
  };
  try {
    // Recheck planned outputs before opening a parser. Another process might
    // have completed them after discovery; atomic commits also protect races.
    const pending = [];
    for (const artifact of artifacts) {
      const started = now();
      try {
        let existing;
        for (const candidate of artifact.candidatePaths ?? [artifact.outputPath]) {
          if (await regularOutputExists(candidate)) existing ??= candidate;
        }
        if (!options.force && existing) {
          const actual = { ...artifact, outputPath: existing };
          emit(actual, "skipped", started, { outputBytes: (await stat(existing)).size,
            ...(artifact.kind === "thumbnail" ? { format: path.extname(existing).slice(1) } : {}) });
          log(`${prefix} Skipping existing ${existing}`);
        } else pending.push(artifact);
      } catch (error) {
        emit(artifact, "failed", started, { errorMessage: formatError(error) });
        errorLog(`${prefix} Failed ${artifact.outputPath}: ${formatError(error)}`);
      }
    }
    signal.throwIfAborted();
    if (!pending.length) return failed ? 1 : 3;

    const openStarted = now();
    try {
      await waitForAbort(Promise.resolve().then(() => (dependencies.assertCanvasAvailable ?? assertNodeCanvasAvailable)()), signal);
      const loaded = Promise.resolve().then(() => (dependencies.loadDocumentSession ?? loadPublishedDocumentSession)())
        .then(value => {
          runtime = value;
          if (signal.aborted) void closeRuntime().catch(() => {});
          return value;
        });
      await waitForAbort(loaded, signal);
      signal.throwIfAborted();
      const sourceStats = await stat(item.pdfPath);
      report({ type: "pdf-to-hep-sizes", sourceBytes: sourceStats.size });
      signal.throwIfAborted();
      log(`${prefix} Opening ${item.pdfPath}`);
      const opened = Promise.resolve().then(() => runtime.openDocumentSession(item.pdfPath, {
        signal, password: options.password, iccEngine: options.iccEngine,
        sourceLabel, onDiagnostic: diagnostic
      })).then(value => {
        session = value;
        if (signal.aborted) void closeSession().catch(() => {});
        return value;
      });
      await waitForAbort(opened, signal);
      signal.throwIfAborted();
    } catch (error) {
      if (signal.aborted) throw error;
      for (const artifact of pending) emit(artifact, "failed", openStarted, { errorMessage: formatError(error) });
      errorLog(`${prefix} Failed ${item.pdfPath}: ${formatError(error)}`);
      return 1;
    }

    for (const planned of pending) {
      signal.throwIfAborted();
      const started = now();
      let artifact = planned;
      try {
        let blob, metadata = {};
        if (artifact.kind === "thumbnail") {
          const result = await waitForAbort(Promise.resolve().then(() => session.renderThumbnail({ page: options.thumbnailPage ?? 1,
            maxDimension: options.thumbnailMaxDimension ?? 400,
            format: options.thumbnailFormat ?? artifact.format ?? "webp",
            background: options.thumbnailBackground ?? "#ffffff", signal })), signal);
          signal.throwIfAborted();
          const format = result.blob.type === "image/png" ? "png" : result.blob.type === "image/webp" ? "webp" : undefined;
          if (!format) throw new Error(`Unexpected thumbnail MIME type: ${result.blob.type || "(empty)"}`);
          artifact = { ...artifact, outputPath: thumbnailPathForFormat(artifact.outputPath, format) };
          metadata = { width: result.width, height: result.height, format };
          blob = result.blob;
          if (!options.force && await regularOutputExists(artifact.outputPath)) throw new ExistingOutputError(artifact.outputPath);
        } else if (artifact.kind === "hep") {
          blob = await waitForAbort(Promise.resolve().then(() => session.buildHep({ sourceLabel, signal,
            withVectorLod: options.withVectorLod !== false, withTextLod: options.withTextLod !== false,
            vectorLodPrecision: options.vectorLodPrecision, annotationAppearances: options.annotationAppearances,
            onProgress: createProgressLogger(sourceLabel, item.fileNumber ?? 1, item.fileCount ?? 1, {
              write: message => report({ type: "pdf-to-hep-progress", message })
            }) })), signal);
          signal.throwIfAborted();
          if (options.keepUnchanged && runtime.HepArchive && await existingHepDiffersOnlyInGeneratedAt(
            artifact.outputPath, blob, runtime.HepArchive, signal)) {
            const existing = await stat(artifact.outputPath);
            emit(artifact, "skipped", started, { outputBytes: existing.size });
            log(`${prefix} Kept ${artifact.outputPath}; only its generatedAt timestamp would change`);
            continue;
          }
        } else throw new Error(`Unknown PDF output kind: ${artifact.kind}`);
        signal.throwIfAborted();
        await mkdir(path.dirname(artifact.outputPath), { recursive: true });
        signal.throwIfAborted();
        await writeHepBlobAtomically(artifact.outputPath, blob, Boolean(options.force), signal);
        if (artifact.kind === "thumbnail") await cleanupThumbnailAlternate({ ...options,
          thumbnailFormat: options.thumbnailFormat ?? planned.format ?? "webp" }, artifact.outputPath, warn);
        emit(artifact, "generated", started, { outputBytes: blob.size, ...metadata });
        log(`${prefix} Wrote ${artifact.outputPath} (${blob.size} bytes)`);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof ExistingOutputError) {
          emit(artifact, "skipped", started);
          log(`${prefix} Skipping existing ${artifact.outputPath}`);
        } else {
          emit(artifact, "failed", started, { errorMessage: formatError(error) });
          report({ type: "pdf-to-hep-error", message: formatError(error) });
          errorLog(`${prefix} Failed ${artifact.outputPath}: ${formatError(error)}`);
        }
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    try { await closeSession(); }
    catch (error) {
      if (!signal.aborted) { failed++; errorLog(`${prefix} Could not close the PDF session: ${formatError(error)}`); }
    }
    finally {
      try { await closeRuntime(); }
      catch (error) {
        if (!signal.aborted) { failed++; errorLog(`${prefix} Could not close the PDF runtime: ${formatError(error)}`); }
      }
      finally {
        signalTarget.off("SIGINT", onSigInt);
        signalTarget.off("SIGTERM", onSigTerm);
      }
    }
  }
  if (signal.aborted) return interruptedExitCode || 1;
  return failed ? 1 : generated ? 0 : skipped ? 3 : 0;
}

/** A forced WebP request replaces either encoding of the same logical
 * thumbnail. Call only after its new output has been committed successfully. */
export async function cleanupThumbnailAlternate(options, outputPath, onWarning = console.warn) {
  if (!options.force || (options.thumbnailFormat ?? "webp") !== "webp") return;
  const extension = path.extname(outputPath).toLowerCase();
  if (extension !== ".webp" && extension !== ".png") return;
  const alternate = thumbnailPathForFormat(outputPath, extension === ".png" ? "webp" : "png");
  try {
    if (await regularOutputExists(alternate)) await unlink(alternate);
  } catch (error) {
    onWarning(`Wrote ${outputPath}, but could not remove its previous thumbnail ${alternate}: ${formatError(error)}`);
  }
}

function thumbnailPathForFormat(outputPath, format) {
  const extension = path.extname(outputPath);
  return `${extension ? outputPath.slice(0, -extension.length) : outputPath}.${format}`;
}

function formatError(error) { return error instanceof Error ? error.message : String(error); }

/** Observe late setup results so cancellation never leaves a rejected import
 * unhandled; owners above also release sessions that finish opening late. */
function waitForAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}
