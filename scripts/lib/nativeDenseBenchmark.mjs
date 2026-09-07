import { registerHooks } from "node:module";

/** Install the minimal Node compatibility used by browser-oriented source modules. */
export function installNativeDenseBenchmarkRuntime() {
  Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
  Uint8Array.prototype.toHex ??= function toHex() {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
  };
  Uint8Array.prototype.toBase64 ??= function toBase64() {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
  };
  Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
  Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));
}

/** Resolve extensionless local TypeScript imports the same way as the bundler. */
export function registerNativeDenseBenchmarkHooks() {
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL?.includes("/src/") &&
        /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    }
  });
}

export async function loadNativeDenseBenchmarkModules() {
  const [compiler, document, retainedText, worker] = await Promise.all([
    import("../../src/densePdfContentCompiler.ts"),
    import("../../src/nativeDensePdfDocument.ts"),
    import("../../src/nativeDenseRetainedTextCompiler.ts"),
    import("../../src/densePdfFastWorker.ts")
  ]);
  return {
    compileDensePdfContent: compiler.compileDensePdfContent,
    preflightNativeDensePdfDocument: document.preflightNativeDensePdfDocument,
    getNativeDenseSourceDocument: document.getNativeDenseSourceDocument,
    closeNativeDensePdfDocument: document.closeNativeDensePdfDocument,
    compileNativeDenseRetainedTextPage:
      retainedText.compileNativeDenseRetainedTextPage,
    classifyDensePdfTextFormXObjects: worker.classifyDensePdfTextFormXObjects,
    computeDensePdfPageGeometry: worker.computeDensePdfPageGeometry
  };
}

/**
 * Measure the dependency-free structural parser, established dense geometry
 * compiler, and direct native retained-text compiler without involving the
 * viewer, renderer, or a legacy mini-PDF round trip.
 */
export async function runNativeDenseBenchmark(
  pdfBytes,
  modules,
  {
    pages,
    enableSegmentMerge = true,
    enableInvisibleCull = true,
    yieldIntervalMs = 50,
    onProgress
  } = {}
) {
  const totalStartedAt = performance.now();
  const preflightStartedAt = performance.now();
  const preflight = await modules.preflightNativeDensePdfDocument(pdfBytes, {
    ...(pages ? { pages } : {})
  });
  const preflightMs = performance.now() - preflightStartedAt;
  if (!preflight.eligible) {
    return {
      kind: "fallback",
      reason: preflight.reason,
      message: preflight.message,
      preflight,
      timing: {
        preflightMs,
        decodeMs: 0,
        compileMs: 0,
        compileWallMs: 0,
        nativeTextMs: 0,
        totalMs: performance.now() - totalStartedAt
      }
    };
  }

  const document = preflight.document;
  try {
    const sourceDocument = modules.getNativeDenseSourceDocument(document);
    if (!sourceDocument) {
      throw new Error("The native dense preflight did not retain its source document.");
    }

    const compiledPages = [];
    let decodeMs = 0;
    let compileWallMs = 0;
    for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex += 1) {
      const structuralPage = document.pages[pageIndex];
      const geometry = modules.computeDensePdfPageGeometry(structuralPage);
      const pageStartedAt = performance.now();
      const availableTextFormXObjects = await modules.classifyDensePdfTextFormXObjects(
        structuralPage,
        { yieldIntervalMs }
      );
      const decodeTiming = { elapsedMs: 0, decodedBytes: 0, chunkCount: 0 };
      let lastProgressAt = 0;
      const compiled = await modules.compileDensePdfContent(
        measureDecodedContent(structuralPage.decodedContentChunks(), decodeTiming),
        {
          ...geometry,
          fontDependencyKeys: new Map(structuralPage.fontDependencies.map(
            ({ resourceName, dependencyKey }) => [resourceName, dependencyKey]
          )),
          availableExtGStates: structuralPage.availableExtGStates,
          extGStates: structuralPage.extGStates,
          alwaysVisibleOptionalContentProperties:
            structuralPage.alwaysVisibleOptionalContentProperties,
          availableTextFormXObjects,
          enableSegmentMerge,
          enableInvisibleCull,
          yieldIntervalMs,
          onProgress(progress) {
            const now = performance.now();
            const finalizationComplete =
              progress.finalization?.stage === "complete" &&
              progress.finalization.completed >= progress.finalization.total;
            if (now - lastProgressAt < 2_000 && !finalizationComplete) return;
            lastProgressAt = now;
            onProgress?.({
              pageIndex,
              pageCount: document.pages.length,
              sourcePageIndex: structuralPage.sourcePageIndex,
              ...progress
            });
          }
        }
      );
      const pageCompileWallMs = performance.now() - pageStartedAt;
      decodeMs += decodeTiming.elapsedMs;
      compileWallMs += pageCompileWallMs;
      compiledPages.push({
        structuralPage,
        geometry,
        compiled,
        formSummaries: availableTextFormXObjects,
        decodeTiming,
        compileWallMs: pageCompileWallMs
      });
    }

    const hasText = compiledPages.some(({ compiled }) => compiled.textShowOpCount > 0);
    const textScenes = [];
    const nativeTextStartedAt = performance.now();
    if (hasText) {
      for (const { structuralPage, compiled, formSummaries } of compiledPages) {
        textScenes.push(await modules.compileNativeDenseRetainedTextPage(
          sourceDocument,
          sourceDocument.getPage(structuralPage.sourcePageIndex),
          compiled.retainedTextContent,
          compiled.referencedFonts,
          {
            formSummaries,
            extGStates: structuralPage.extGStates,
            alwaysVisibleOptionalContentProperties:
              structuralPage.alwaysVisibleOptionalContentProperties
          }
        ));
      }
    }
    const nativeTextMs = performance.now() - nativeTextStartedAt;

    return {
      kind: "success",
      sourcePageCount: document.sourcePageCount,
      preflight,
      compiledPages,
      textScenes,
      timing: {
        preflightMs,
        decodeMs,
        compileMs: Math.max(0, compileWallMs - decodeMs),
        compileWallMs,
        nativeTextMs,
        totalMs: performance.now() - totalStartedAt
      }
    };
  } finally {
    await modules.closeNativeDensePdfDocument(document);
  }
}

export function summarizeNativeDenseCounts(result) {
  const pages = result.compiledPages;
  const scenes = result.textScenes;
  return {
    operators: sumCompiled(pages, "operatorCount"),
    sourceSegments: sumCompiled(pages, "sourceSegmentCount"),
    mergedSegments: sumCompiled(pages, "mergedSegmentCount"),
    visibleSegments: sumCompiled(pages, "segmentCount"),
    duplicateRemovals: sumCompiled(pages, "discardedDuplicateCount"),
    containedRemovals: sumCompiled(pages, "discardedContainedCount"),
    fillPaths: sumCompiled(pages, "fillPathCount"),
    fillSegments: sumCompiled(pages, "fillSegmentCount"),
    sourceText: sumScenes(scenes, "sourceTextCount"),
    textInstances: sumScenes(scenes, "textInstanceCount"),
    glyphs: sumScenes(scenes, "textGlyphCount"),
    glyphSegments: sumScenes(scenes, "textGlyphSegmentCount")
  };
}

function measureDecodedContent(source, timing) {
  return {
    async *[Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      let completed = false;
      try {
        while (true) {
          const startedAt = performance.now();
          const next = await iterator.next();
          timing.elapsedMs += performance.now() - startedAt;
          if (next.done) {
            completed = true;
            return;
          }
          timing.decodedBytes += next.value.length;
          timing.chunkCount += 1;
          yield next.value;
        }
      } finally {
        if (!completed && typeof iterator.return === "function") {
          await iterator.return();
        }
      }
    }
  };
}

function sumCompiled(pages, property) {
  return pages.reduce((total, page) => total + page.compiled[property], 0);
}

function sumScenes(scenes, property) {
  return scenes.reduce((total, scene) => total + scene[property], 0);
}
