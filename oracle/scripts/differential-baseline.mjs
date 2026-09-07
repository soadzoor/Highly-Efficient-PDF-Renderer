#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  firstJsonDifference,
  hashCanonical,
  sha256Bytes,
  sha256Text,
  stableJson
} from "./lib/canonical.mjs";
import { comparePngBytes } from "./lib/png-diff.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_CORPUS_PATH = fileURLToPath(new URL("../corpus.json", import.meta.url));
const DEFAULT_BASELINE_PATH = fileURLToPath(
  new URL("../baselines/pdfjs-6.1.200", import.meta.url)
);
const DEFAULT_ADAPTER_URL = new URL("./adapters/pdfjs.mjs", import.meta.url).href;
const REPORT_FILE = "report.json";
const REPORT_SCHEMA_VERSION = 1;
const MAX_CHILD_LOG_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RENDER_PIXELS = 128 * 1024 * 1024;

try {
  if (process.argv[2] === "--child") {
    await runChildProcess(process.argv[3]);
  } else {
    await runController(process.argv.slice(2));
  }
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}

async function runController(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  validateOptionCombinations(options);
  const corpus = await loadCorpus(options.corpusPath);
  if (options.validateConfig) {
    process.stdout.write(
      `Oracle corpus is valid: ${corpus.documents.length} tracked PDFs, ` +
      `${formatBytes(corpus.documents.reduce((sum, document) => sum + document.byteLength, 0))}.\n`
    );
    return;
  }

  let baselineReport = null;
  if (!options.write) {
    baselineReport = await readBaselineReport(options.baselinePath);
    if (!options.screenshotPolicyExplicit) {
      options.screenshotPolicy = baselineReport.capture?.screenshotPolicy ?? "representative";
    }
  }

  const selectedDocuments = selectDocuments(corpus.documents, options.documentIds);
  const output = await prepareOutputDirectory(options);
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), "hepr-oracle-work-"));
  let published = false;

  try {
    const currentReport = await collectCorpus({
      corpus,
      documents: selectedDocuments,
      options,
      outputDirectory: output.path,
      workDirectory
    });
    await writeFileAtomic(path.join(output.path, REPORT_FILE), stableJson(currentReport));

    if (options.write) {
      await publishDirectoryAtomically(output.path, options.baselinePath);
      published = true;
      process.stdout.write(
        `Wrote PDF.js ${currentReport.engine.version} oracle baseline for ` +
        `${currentReport.documents.length} documents to ${options.baselinePath}.\n`
      );
      return;
    }

    const comparison = await compareReports({
      baselineReport,
      baselineDirectory: options.baselinePath,
      currentReport,
      currentDirectory: output.path,
      selectedDocumentIds: new Set(selectedDocuments.map((document) => document.id)),
      options
    });
    printComparison(comparison, options);
    if (comparison.errors.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await rm(workDirectory, { force: true, recursive: true });
    if (output.temporary && !published) {
      await rm(output.path, { force: true, recursive: true });
    }
  }
}

async function collectCorpus({ corpus, documents, options, outputDirectory, workDirectory }) {
  const reportDocuments = [];
  let engineIdentity = null;

  for (let documentIndex = 0; documentIndex < documents.length; documentIndex += 1) {
    const document = documents[documentIndex];
    const samples = [];
    let frozenDocument = null;

    for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
      logProgress(
        options,
        `[${documentIndex + 1}/${documents.length}] ${document.id}, sample ` +
          `${sampleIndex + 1}/${options.samples}`
      );
      const key = `${String(documentIndex).padStart(2, "0")}-${String(sampleIndex).padStart(2, "0")}`;
      const specificationPath = path.join(workDirectory, `${key}.spec.json`);
      const resultPath = path.join(workDirectory, `${key}.result.json`);
      const specification = {
        schemaVersion: 1,
        adapterUrl: options.adapterUrl,
        artifactRoot: outputDirectory,
        document,
        maxRenderPixels: options.maxRenderPixels,
        resultPath,
        screenshotPolicy: options.screenshotPolicy,
        screenshotScales: [1, 2],
        writeArtifacts: sampleIndex === 0
      };
      await writeFile(specificationPath, stableJson(specification), { flag: "wx" });

      const startedAt = performance.now();
      await spawnChild(specificationPath);
      const coldProcessWallMs = performance.now() - startedAt;
      const result = JSON.parse(await readFile(resultPath, "utf8"));
      result.metrics.coldProcessWallMs = roundMetric(coldProcessWallMs);

      if (!engineIdentity) {
        engineIdentity = result.engine;
      } else {
        assertNoDifference(engineIdentity, result.engine, `${document.id} engine identity`);
      }

      if (!frozenDocument) {
        frozenDocument = result.document;
      } else {
        assertNoDifference(
          deterministicDocumentView(frozenDocument),
          deterministicDocumentView(result.document),
          `${document.id} changed between measurement samples`
        );
      }
      samples.push(result.metrics);
    }

    reportDocuments.push({
      ...frozenDocument,
      measurements: {
        samples,
        median: aggregateMetrics(samples)
      }
    });
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    engine: engineIdentity,
    corpus: {
      definitionSha256: corpus.definitionSha256,
      expectedDocumentCount: corpus.expectedDocumentCount,
      selectedDocumentCount: documents.length
    },
    capture: {
      screenshotPolicy: options.screenshotPolicy,
      screenshotScales: [1, 2],
      maxRenderPixels: options.maxRenderPixels,
      samples: options.samples,
      normalizedText: "NFC, normalized spaces, collapsed horizontal whitespace",
      semanticChunkSize: 256
    },
    environment: runtimeEnvironment(),
    documents: reportDocuments
  };
}

async function runChildProcess(specificationPath) {
  if (!specificationPath) {
    throw new Error("Internal oracle child is missing its specification path.");
  }
  const specification = JSON.parse(await readFile(specificationPath, "utf8"));
  if (specification.schemaVersion !== 1) {
    throw new Error("Unsupported oracle child specification.");
  }

  const sampler = startMemorySampler();
  const totalStartedAt = performance.now();
  let documentAdapter = null;
  try {
    const adapterStartedAt = performance.now();
    const module = await import(specification.adapterUrl);
    if (typeof module.createEngine !== "function") {
      throw new Error(`Oracle adapter ${specification.adapterUrl} does not export createEngine().`);
    }
    const engine = await module.createEngine({ repositoryRoot: REPOSITORY_ROOT });
    validateEngine(engine, specification.adapterUrl);
    const adapterInitMs = performance.now() - adapterStartedAt;

    const sourceReadStartedAt = performance.now();
    const sourceBuffer = await readFile(specification.document.absolutePath);
    const sourceReadMs = performance.now() - sourceReadStartedAt;
    sampler.sample();

    const sourceHashStartedAt = performance.now();
    const sourceSha256 = sha256Bytes(sourceBuffer);
    const sourceHashMs = performance.now() - sourceHashStartedAt;
    const sourceBytes = new Uint8Array(
      sourceBuffer.buffer,
      sourceBuffer.byteOffset,
      sourceBuffer.byteLength
    );

    const openStartedAt = performance.now();
    documentAdapter = await engine.openDocument({
      bytes: sourceBytes,
      label: specification.document.name,
      sourcePath: specification.document.absolutePath
    });
    validateDocumentAdapter(documentAdapter);
    const openMs = performance.now() - openStartedAt;
    sampler.sample();

    const documentMetadataStartedAt = performance.now();
    const documentMetadata = await documentAdapter.getDocumentMetadata();
    const documentMetadataMs = performance.now() - documentMetadataStartedAt;
    const screenshotPages = chooseScreenshotPages(
      documentAdapter.pageCount,
      specification.screenshotPolicy
    );
    const pages = [];
    const pageTimings = [];
    let pageAnalysisMs = 0;
    let renderMs = 0;

    for (let sourcePageIndex = 0; sourcePageIndex < documentAdapter.pageCount; sourcePageIndex += 1) {
      const pageTiming = { sourcePageIndex, renders: {} };
      const loadStartedAt = performance.now();
      const page = await documentAdapter.getPage(sourcePageIndex);
      validatePageAdapter(page, sourcePageIndex);
      pageTiming.loadMs = roundMetric(performance.now() - loadStartedAt);
      sampler.sample();

      try {
        const metadataStartedAt = performance.now();
        const metadata = await page.getMetadata();
        pageTiming.metadataMs = roundMetric(performance.now() - metadataStartedAt);

        const textStartedAt = performance.now();
        const normalizedText = await page.getNormalizedText();
        if (typeof normalizedText !== "string") {
          throw new Error(`Adapter returned non-string text for page ${sourcePageIndex}.`);
        }
        pageTiming.textMs = roundMetric(performance.now() - textStartedAt);

        const semanticStartedAt = performance.now();
        const semantic = await page.getSemanticSummary();
        pageTiming.semanticMs = roundMetric(performance.now() - semanticStartedAt);
        sampler.sample();

        const textRelativePath = artifactPath(
          "text",
          specification.document.id,
          `page-${padPage(sourcePageIndex)}.txt`
        );
        const textBytes = Buffer.from(normalizedText, "utf8");
        if (specification.writeArtifacts) {
          await writeArtifact(specification.artifactRoot, textRelativePath, textBytes);
        }

        const screenshots = [];
        if (screenshotPages.has(sourcePageIndex)) {
          for (const scale of specification.screenshotScales) {
            const renderStartedAt = performance.now();
            const rendered = await page.renderPng(scale, {
              maxRenderPixels: specification.maxRenderPixels
            });
            const elapsed = performance.now() - renderStartedAt;
            renderMs += elapsed;
            pageTiming.renders[`${scale}x`] = roundMetric(elapsed);
            validateRenderedPng(rendered, sourcePageIndex, scale);
            const screenshotRelativePath = artifactPath(
              "screenshots",
              specification.document.id,
              `page-${padPage(sourcePageIndex)}@${scale}x.png`
            );
            if (specification.writeArtifacts) {
              await writeArtifact(specification.artifactRoot, screenshotRelativePath, rendered.bytes);
            }
            screenshots.push({
              scale,
              width: rendered.width,
              height: rendered.height,
              file: screenshotRelativePath,
              byteLength: rendered.bytes.byteLength,
              sha256: sha256Bytes(rendered.bytes)
            });
            sampler.sample();
          }
        }

        pageAnalysisMs +=
          pageTiming.loadMs + pageTiming.metadataMs + pageTiming.textMs + pageTiming.semanticMs;
        pageTimings.push(pageTiming);
        pages.push({
          sourcePageIndex,
          metadata,
          text: {
            file: textRelativePath,
            byteLength: textBytes.byteLength,
            sha256: sha256Text(normalizedText)
          },
          semantic,
          screenshots
        });
      } finally {
        await page.close();
      }
    }

    await documentAdapter.close();
    documentAdapter = null;
    sampler.sample();
    const totalMs = performance.now() - totalStartedAt;
    const memory = sampler.finish();
    const resourceUsage = process.resourceUsage();
    memory.processMaxRssBytes = normalizeProcessMaxRss(resourceUsage.maxRSS);

    const result = {
      engine: normalizeEngineIdentity(engine.identity),
      document: {
        id: specification.document.id,
        name: specification.document.name,
        relativePath: specification.document.relativePath,
        byteLength: sourceBuffer.byteLength,
        sha256: sourceSha256,
        pageCount: documentAdapter?.pageCount ?? pages.length,
        metadata: documentMetadata,
        pages
      },
      metrics: {
        adapterInitMs: roundMetric(adapterInitMs),
        sourceReadMs: roundMetric(sourceReadMs),
        sourceHashMs: roundMetric(sourceHashMs),
        openMs: roundMetric(openMs),
        documentMetadataMs: roundMetric(documentMetadataMs),
        pageAnalysisMs: roundMetric(pageAnalysisMs),
        parseAndCompileMs: roundMetric(openMs + documentMetadataMs + pageAnalysisMs),
        renderMs: roundMetric(renderMs),
        totalMs: roundMetric(totalMs),
        memory,
        pageTimings
      }
    };
    await writeFileAtomic(specification.resultPath, stableJson(result));
  } finally {
    if (documentAdapter) {
      await documentAdapter.close().catch(() => {});
    }
    sampler.finish();
  }
}

async function compareReports({
  baselineReport,
  baselineDirectory,
  currentReport,
  currentDirectory,
  selectedDocumentIds,
  options
}) {
  const errors = [];
  const warnings = [];
  const visualComparisons = [];

  if (baselineReport.schemaVersion !== REPORT_SCHEMA_VERSION) {
    errors.push(
      `Baseline report schema is ${String(baselineReport.schemaVersion)}; expected ${REPORT_SCHEMA_VERSION}.`
    );
    return { errors, warnings, visualComparisons, performance: null };
  }
  if (baselineReport.corpus?.definitionSha256 !== currentReport.corpus.definitionSha256) {
    errors.push("Tracked corpus definition differs from the frozen baseline.");
  }

  const expectedById = new Map(baselineReport.documents.map((document) => [document.id, document]));
  const actualById = new Map(currentReport.documents.map((document) => [document.id, document]));
  for (const id of selectedDocumentIds) {
    const expected = expectedById.get(id);
    const actual = actualById.get(id);
    if (!expected) {
      errors.push(`${id}: missing from baseline report.`);
      continue;
    }
    if (!actual) {
      errors.push(`${id}: missing from current report.`);
      continue;
    }

    compareDocumentFields(expected, actual, errors);
    await compareDocumentPages({
      expected,
      actual,
      baselineDirectory,
      currentDirectory,
      options,
      errors,
      warnings,
      visualComparisons
    });
  }

  for (const id of actualById.keys()) {
    if (!selectedDocumentIds.has(id)) {
      errors.push(`${id}: current report contains an unrequested document.`);
    }
  }

  const performanceSummary = comparePerformance(
    baselineReport.documents.filter((document) => selectedDocumentIds.has(document.id)),
    currentReport.documents,
    options.enforcePerformance,
    errors,
    warnings
  );
  return { errors, warnings, visualComparisons, performance: performanceSummary };
}

function compareDocumentFields(expected, actual, errors) {
  for (const key of ["name", "relativePath", "byteLength", "sha256", "pageCount"]) {
    if (!Object.is(expected[key], actual[key])) {
      errors.push(`${expected.id}.${key}: expected ${formatValue(expected[key])}, got ${formatValue(actual[key])}.`);
    }
  }
  appendDifference(errors, `${expected.id}.metadata`, expected.metadata, actual.metadata);
}

async function compareDocumentPages({
  expected,
  actual,
  baselineDirectory,
  currentDirectory,
  options,
  errors,
  warnings,
  visualComparisons
}) {
  if (expected.pages.length !== actual.pages.length) {
    errors.push(`${expected.id}.pages: expected ${expected.pages.length}, got ${actual.pages.length}.`);
    return;
  }

  for (let index = 0; index < expected.pages.length; index += 1) {
    const expectedPage = expected.pages[index];
    const actualPage = actual.pages[index];
    const label = `${expected.id}.page[${expectedPage.sourcePageIndex}]`;
    if (expectedPage.sourcePageIndex !== actualPage.sourcePageIndex) {
      errors.push(`${label}: source page index changed to ${actualPage.sourcePageIndex}.`);
      continue;
    }
    appendDifference(errors, `${label}.metadata`, expectedPage.metadata, actualPage.metadata);
    appendDifference(errors, `${label}.text`, expectedPage.text, actualPage.text);
    comparePageSemantics({
      expected: expectedPage.semantic,
      actual: actualPage.semantic,
      label,
      firstPage: index === 0,
      errors,
      warnings
    });

    await verifyArtifact(expectedPage.text, baselineDirectory, `${label}.baseline text`, errors);
    await verifyArtifact(actualPage.text, currentDirectory, `${label}.current text`, errors);

    const expectedScreenshots = new Map(
      expectedPage.screenshots.map((screenshot) => [screenshot.scale, screenshot])
    );
    const actualScreenshots = new Map(
      actualPage.screenshots.map((screenshot) => [screenshot.scale, screenshot])
    );
    for (const scale of [...actualScreenshots.keys()].sort((left, right) => left - right)) {
      const expectedScreenshot = expectedScreenshots.get(scale);
      const actualScreenshot = actualScreenshots.get(scale);
      if (!expectedScreenshot || !actualScreenshot) {
        errors.push(`${label}@${scale}x: screenshot is missing from the baseline report.`);
        continue;
      }
      const expectedBytes = await readVerifiedArtifact(
        expectedScreenshot,
        baselineDirectory,
        `${label}@${scale}x baseline`,
        errors
      );
      const actualBytes = await readVerifiedArtifact(
        actualScreenshot,
        currentDirectory,
        `${label}@${scale}x current`,
        errors
      );
      if (!expectedBytes || !actualBytes) {
        continue;
      }
      if (expectedScreenshot.sha256 === actualScreenshot.sha256) {
        visualComparisons.push({ label: `${label}@${scale}x`, exact: true });
        continue;
      }

      const metrics = await comparePngBytes(expectedBytes, actualBytes, {
        channelTolerance: options.channelTolerance,
        edgeThreshold: options.edgeThreshold
      });
      visualComparisons.push({ label: `${label}@${scale}x`, exact: false, ...metrics });
      if (!metrics.dimensionsMatch) {
        errors.push(
          `${label}@${scale}x: dimensions changed from ` +
          `${metrics.expectedWidth}x${metrics.expectedHeight} to ` +
          `${metrics.actualWidth}x${metrics.actualHeight}.`
        );
      } else if (
        metrics.ssim < options.minimumSsim ||
        metrics.nonEdgeWithinToleranceFraction < options.minimumNonEdgeFraction
      ) {
        errors.push(
          `${label}@${scale}x: SSIM ${metrics.ssim.toFixed(6)} and non-edge within-` +
          `${options.channelTolerance} fraction ` +
          `${(metrics.nonEdgeWithinToleranceFraction * 100).toFixed(4)}% do not meet ` +
          `${options.minimumSsim}/${(options.minimumNonEdgeFraction * 100).toFixed(2)}%.`
        );
      }
    }
  }
}

function comparePageSemantics({ expected, actual, label, firstPage, errors, warnings }) {
  const expectedSchema = semanticSchema(expected);
  const actualSchema = semanticSchema(actual);
  if (expectedSchema === actualSchema) {
    appendDifference(errors, `${label}.semantic`, expected, actual);
    return;
  }

  // PDF.js exposes implementation-specific operator IDs and argument objects;
  // HEPR exposes its page-native ordered program. Equating those hashes would
  // create a false gate. Cross-engine runs therefore validate the complete
  // HEPR summary for shape and determinism, while exact metadata/text gates and
  // thresholded screenshots remain unchanged.
  if (
    expectedSchema === "pdfjs-operator-list-v1" &&
    actualSchema === "hepr-display-program-v7"
  ) {
    const invalid = validateHeprSemanticSummary(actual);
    if (invalid) errors.push(`${label}.semantic: ${invalid}`);
    if (firstPage) {
      warnings.push(
        `${label.slice(0, label.indexOf(".page["))}: semantic hashes are scoped by engine ` +
        `(PDF.js operator list versus HEPR display program); metadata, text, and screenshots ` +
        `remain release-gating comparisons.`
      );
    }
    return;
  }

  errors.push(
    `${label}.semantic.schema: baseline uses ${formatValue(expectedSchema)}, ` +
    `candidate uses ${formatValue(actualSchema)}.`
  );
}

function semanticSchema(summary) {
  return typeof summary?.schema === "string" && summary.schema.length > 0
    ? summary.schema
    : "pdfjs-operator-list-v1";
}

function validateHeprSemanticSummary(summary) {
  if (!summary || typeof summary !== "object") return "HEPR summary is not an object.";
  if (!Number.isSafeInteger(summary.commandCount) || summary.commandCount < 0) {
    return "HEPR commandCount is invalid.";
  }
  if (!summary.histogram || typeof summary.histogram !== "object" || Array.isArray(summary.histogram)) {
    return "HEPR histogram is invalid.";
  }
  const histogramTotal = Object.values(summary.histogram).reduce((total, count) => {
    return total + (Number.isSafeInteger(count) && count >= 0 ? count : Number.NaN);
  }, 0);
  if (histogramTotal !== summary.commandCount) {
    return "HEPR histogram does not total commandCount.";
  }
  if (!summary.resources || typeof summary.resources !== "object" || Array.isArray(summary.resources)) {
    return "HEPR resource counts are invalid.";
  }
  for (const [name, count] of Object.entries(summary.resources)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      return `HEPR resource count ${name} is invalid.`;
    }
  }
  for (const field of [
    "displayProgramSha256",
    "resourceStoreSha256",
    "textGeometrySha256"
  ]) {
    if (typeof summary[field] !== "string" || !/^[0-9a-f]{64}$/.test(summary[field])) {
      return `HEPR ${field} is invalid.`;
    }
  }
  return null;
}

function comparePerformance(expectedDocuments, actualDocuments, enforce, errors, warnings) {
  const actualById = new Map(actualDocuments.map((document) => [document.id, document]));
  const pairs = expectedDocuments
    .map((expected) => ({ expected, actual: actualById.get(expected.id) }))
    .filter((pair) => pair.actual);
  if (pairs.length === 0) {
    return null;
  }

  const expectedParseTimes = pairs.map(({ expected }) => expected.measurements.median.parseAndCompileMs);
  const actualParseTimes = pairs.map(({ actual }) => actual.measurements.median.parseAndCompileMs);
  const parseRatio = safeRatio(median(actualParseTimes), median(expectedParseTimes));
  const perDocumentParseRatios = pairs.map(({ expected, actual }) => ({
    id: expected.id,
    ratio: safeRatio(
      actual.measurements.median.parseAndCompileMs,
      expected.measurements.median.parseAndCompileMs
    )
  }));

  const expectedMemory = pairs.map(
    ({ expected }) => expected.measurements.median.memory.peakRssDeltaBytes
  );
  const actualMemory = pairs.map(
    ({ actual }) => actual.measurements.median.memory.peakRssDeltaBytes
  );
  const memoryRatio = safeRatio(median(actualMemory), median(expectedMemory));
  const tinyPair = [...pairs].sort((left, right) => left.expected.byteLength - right.expected.byteLength)[0];
  const tinyColdStartRatio = safeRatio(
    tinyPair.actual.measurements.median.coldProcessWallMs,
    tinyPair.expected.measurements.median.coldProcessWallMs
  );
  const worstDocument = [...perDocumentParseRatios].sort((left, right) => right.ratio - left.ratio)[0];

  const messages = [];
  if (parseRatio > 0.75) {
    messages.push(`corpus-median parse ratio ${formatRatio(parseRatio)} exceeds 0.750x`);
  }
  if (worstDocument.ratio > 1.1) {
    messages.push(`${worstDocument.id} parse ratio ${formatRatio(worstDocument.ratio)} exceeds 1.100x`);
  }
  if (memoryRatio > 0.75) {
    messages.push(`corpus-median peak parser RSS ratio ${formatRatio(memoryRatio)} exceeds 0.750x`);
  }
  if (tinyColdStartRatio > 1.1) {
    messages.push(
      `${tinyPair.expected.id} cold-process ratio ${formatRatio(tinyColdStartRatio)} exceeds 1.100x`
    );
  }
  if (messages.length > 0) {
    (enforce ? errors : warnings).push(
      `${enforce ? "Performance gate failed" : "Performance gates not enforced"}: ${messages.join("; ")}.`
    );
  }

  return {
    parseRatio,
    memoryRatio,
    tinyDocumentId: tinyPair.expected.id,
    tinyColdStartRatio,
    worstDocument
  };
}

function printComparison(comparison, options) {
  const exact = comparison.visualComparisons.filter((item) => item.exact).length;
  const scored = comparison.visualComparisons.length - exact;
  const output = {
    ok: comparison.errors.length === 0,
    errors: comparison.errors,
    warnings: comparison.warnings,
    visuals: {
      total: comparison.visualComparisons.length,
      exact,
      scored
    },
    performance: comparison.performance
  };
  if (options.json) {
    process.stdout.write(stableJson(output));
    return;
  }

  if (comparison.performance) {
    process.stdout.write(
      `Performance ratios (current/oracle): parse ${formatRatio(comparison.performance.parseRatio)}, ` +
      `peak RSS ${formatRatio(comparison.performance.memoryRatio)}, tiny cold start ` +
      `${formatRatio(comparison.performance.tinyColdStartRatio)}.\n`
    );
  }
  process.stdout.write(
    `Visuals: ${comparison.visualComparisons.length} checked ` +
    `(${exact} byte-identical, ${scored} pixel-scored).\n`
  );
  for (const warning of comparison.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  if (comparison.errors.length === 0) {
    process.stdout.write("Oracle comparison passed.\n");
  } else {
    process.stderr.write(`Oracle comparison failed with ${comparison.errors.length} difference(s):\n`);
    for (const error of comparison.errors.slice(0, 100)) {
      process.stderr.write(`  - ${error}\n`);
    }
    if (comparison.errors.length > 100) {
      process.stderr.write(`  - ... ${comparison.errors.length - 100} more\n`);
    }
  }
}

async function loadCorpus(corpusPath) {
  const corpusBytes = await readFile(corpusPath);
  const corpusConfig = JSON.parse(corpusBytes.toString("utf8"));
  if (corpusConfig.schemaVersion !== 1) {
    throw new Error(`Unsupported oracle corpus schema in ${corpusPath}.`);
  }
  if (!Number.isSafeInteger(corpusConfig.expectedDocumentCount) || corpusConfig.expectedDocumentCount <= 0) {
    throw new Error("Oracle corpus expectedDocumentCount must be a positive integer.");
  }
  if (!Array.isArray(corpusConfig.documents)) {
    throw new Error("Oracle corpus documents must be an array.");
  }
  if (corpusConfig.documents.length !== corpusConfig.expectedDocumentCount) {
    throw new Error(
      `Oracle corpus lists ${corpusConfig.documents.length} documents; expected ` +
      `${corpusConfig.expectedDocumentCount}.`
    );
  }

  const configDirectory = path.dirname(corpusPath);
  const manifestPath = resolveConfiguredPath(configDirectory, corpusConfig.manifest, "manifest");
  const assetRoot = resolveConfiguredPath(configDirectory, corpusConfig.assetRoot, "assetRoot");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.examples)) {
    throw new Error(`Example manifest ${manifestPath} has no examples array.`);
  }
  if (manifest.examples.length !== corpusConfig.expectedDocumentCount) {
    throw new Error(
      `Example manifest contains ${manifest.examples.length} documents; expected exactly ` +
      `${corpusConfig.expectedDocumentCount}. Update oracle/corpus.json deliberately.`
    );
  }

  const manifestById = new Map();
  for (const entry of manifest.examples) {
    if (!entry || typeof entry.id !== "string" || manifestById.has(entry.id)) {
      throw new Error("Example manifest contains a missing or duplicate document id.");
    }
    manifestById.set(entry.id, entry);
  }

  const seenIds = new Set();
  const documents = [];
  for (const tracked of corpusConfig.documents) {
    if (!tracked || typeof tracked.id !== "string" || seenIds.has(tracked.id)) {
      throw new Error("Oracle corpus contains a missing or duplicate document id.");
    }
    seenIds.add(tracked.id);
    const entry = manifestById.get(tracked.id);
    if (!entry) {
      throw new Error(`Tracked document ${tracked.id} is absent from the example manifest.`);
    }
    if (entry.pdf?.sizeBytes !== tracked.sizeBytes) {
      throw new Error(
        `${tracked.id}: manifest size ${String(entry.pdf?.sizeBytes)} differs from pinned ` +
        `${String(tracked.sizeBytes)} bytes.`
      );
    }
    if (typeof entry.pdf?.path !== "string" || typeof entry.name !== "string") {
      throw new Error(`${tracked.id}: example manifest PDF path/name is invalid.`);
    }
    const relativePath = decodeURIComponent(entry.pdf.path);
    const absolutePath = path.resolve(assetRoot, relativePath);
    assertContainedPath(assetRoot, absolutePath, `${tracked.id} PDF`);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.size !== tracked.sizeBytes) {
      throw new Error(
        `${tracked.id}: expected a ${tracked.sizeBytes}-byte file at ${absolutePath}, found ` +
        `${fileStat.isFile() ? `${fileStat.size} bytes` : "a non-file"}.`
      );
    }
    documents.push({
      id: tracked.id,
      name: entry.name,
      relativePath: path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join("/"),
      absolutePath,
      byteLength: tracked.sizeBytes
    });
  }

  const unexpectedIds = [...manifestById.keys()].filter((id) => !seenIds.has(id));
  if (unexpectedIds.length > 0) {
    throw new Error(`Example manifest has untracked PDFs: ${unexpectedIds.join(", ")}.`);
  }
  const definition = documents.map(({ id, name, relativePath, byteLength }) => ({
    id,
    name,
    relativePath,
    byteLength
  }));
  return {
    documents,
    expectedDocumentCount: corpusConfig.expectedDocumentCount,
    definitionSha256: hashCanonical(definition)
  };
}

function parseArguments(argv) {
  const options = {
    adapterUrl: DEFAULT_ADAPTER_URL,
    baselinePath: DEFAULT_BASELINE_PATH,
    channelTolerance: 8,
    corpusPath: DEFAULT_CORPUS_PATH,
    documentIds: [],
    edgeThreshold: 24,
    enforcePerformance: false,
    help: false,
    json: false,
    maxRenderPixels: DEFAULT_MAX_RENDER_PIXELS,
    minimumNonEdgeFraction: 0.995,
    minimumSsim: 0.995,
    outputPath: null,
    samples: 1,
    screenshotPolicy: "representative",
    screenshotPolicyExplicit: false,
    validateConfig: false,
    write: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--write":
        options.write = true;
        break;
      case "--validate-config":
        options.validateConfig = true;
        break;
      case "--enforce-performance":
        options.enforcePerformance = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--adapter":
        options.adapterUrl = resolveAdapterUrl(requireValue(argv, ++index, argument));
        break;
      case "--baseline-dir":
        options.baselinePath = path.resolve(requireValue(argv, ++index, argument));
        break;
      case "--corpus":
        options.corpusPath = path.resolve(requireValue(argv, ++index, argument));
        break;
      case "--document":
        options.documentIds.push(...requireValue(argv, ++index, argument).split(",").filter(Boolean));
        break;
      case "--output":
        options.outputPath = path.resolve(requireValue(argv, ++index, argument));
        break;
      case "--screenshots": {
        const value = requireValue(argv, ++index, argument);
        if (!["none", "representative", "all"].includes(value)) {
          throw new Error("--screenshots must be none, representative, or all.");
        }
        options.screenshotPolicy = value;
        options.screenshotPolicyExplicit = true;
        break;
      }
      case "--samples":
        options.samples = positiveInteger(requireValue(argv, ++index, argument), argument);
        break;
      case "--max-render-pixels":
        options.maxRenderPixels = positiveInteger(requireValue(argv, ++index, argument), argument);
        break;
      case "--ssim-min":
        options.minimumSsim = unitInterval(requireValue(argv, ++index, argument), argument);
        break;
      case "--non-edge-min":
        options.minimumNonEdgeFraction = unitInterval(requireValue(argv, ++index, argument), argument);
        break;
      case "--channel-tolerance":
        options.channelTolerance = integerInRange(
          requireValue(argv, ++index, argument),
          argument,
          0,
          255
        );
        break;
      case "--edge-threshold":
        options.edgeThreshold = integerInRange(
          requireValue(argv, ++index, argument),
          argument,
          0,
          255
        );
        break;
      default:
        throw new Error(`Unknown argument: ${argument}. Run with --help for usage.`);
    }
  }
  return options;
}

function validateOptionCombinations(options) {
  if (options.write && options.adapterUrl !== DEFAULT_ADAPTER_URL) {
    throw new Error("--write only accepts the pinned built-in PDF.js adapter.");
  }
  if (options.write && options.documentIds.length > 0) {
    throw new Error("--write requires the complete tracked corpus; remove --document.");
  }
  if (options.write && options.outputPath) {
    throw new Error("--write publishes to --baseline-dir and cannot be combined with --output.");
  }
  if (options.validateConfig && (options.write || options.outputPath || options.documentIds.length > 0)) {
    throw new Error("--validate-config cannot be combined with collection/output options.");
  }
  if (options.enforcePerformance && options.write) {
    throw new Error("--enforce-performance is only meaningful while comparing a candidate.");
  }
  if (options.enforcePerformance && options.documentIds.length > 0) {
    throw new Error("--enforce-performance requires the complete 14-document corpus.");
  }
  if (options.enforcePerformance && options.samples < 3) {
    throw new Error("--enforce-performance requires at least --samples 3.");
  }
}

function selectDocuments(documents, ids) {
  if (ids.length === 0) {
    return documents;
  }
  const requested = new Set(ids);
  if (requested.size !== ids.length) {
    throw new Error("--document contains duplicate ids.");
  }
  const selected = documents.filter((document) => requested.delete(document.id));
  if (requested.size > 0) {
    throw new Error(`Unknown --document id(s): ${[...requested].join(", ")}.`);
  }
  return selected;
}

async function prepareOutputDirectory(options) {
  if (options.write) {
    const parent = path.dirname(options.baselinePath);
    await mkdir(parent, { recursive: true });
    return {
      path: await mkdtemp(path.join(parent, `.${path.basename(options.baselinePath)}.staging-`)),
      temporary: false
    };
  }
  if (options.outputPath) {
    try {
      await access(options.outputPath);
      throw new Error(`--output path already exists: ${options.outputPath}.`);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await mkdir(options.outputPath, { recursive: true });
    return { path: options.outputPath, temporary: false };
  }
  return {
    path: await mkdtemp(path.join(os.tmpdir(), "hepr-oracle-current-")),
    temporary: true
  };
}

async function readBaselineReport(baselineDirectory) {
  const reportPath = path.join(baselineDirectory, REPORT_FILE);
  try {
    return JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `No oracle baseline exists at ${reportPath}. Run npm run oracle:write explicitly to create it.`
      );
    }
    throw new Error(`Cannot read oracle baseline ${reportPath}: ${formatError(error)}`);
  }
}

async function spawnChild(specificationPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", SCRIPT_PATH, "--child", specificationPath],
      {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk, MAX_CHILD_LOG_BYTES);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk, MAX_CHILD_LOG_BYTES);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Oracle child failed (${signal ? `signal ${signal}` : `exit ${code}`}):\n` +
            `${stderr || stdout || "no child output"}`
          )
        );
      }
    });
  });
}

function startMemorySampler() {
  const start = memorySnapshot();
  const peak = { ...start };
  let finished = false;
  const sample = () => {
    if (finished) return;
    const current = memorySnapshot();
    for (const key of Object.keys(peak)) {
      peak[key] = Math.max(peak[key], current[key]);
    }
  };
  const timer = setInterval(sample, 5);
  timer.unref();
  return {
    sample,
    finish() {
      if (!finished) {
        sample();
        finished = true;
        clearInterval(timer);
      }
      const end = memorySnapshot();
      return {
        start,
        peak,
        end,
        peakRssDeltaBytes: Math.max(0, peak.rssBytes - start.rssBytes),
        peakHeapUsedDeltaBytes: Math.max(0, peak.heapUsedBytes - start.heapUsedBytes)
      };
    }
  };
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers
  };
}

function aggregateMetrics(samples) {
  const numericKeys = [
    "adapterInitMs",
    "sourceReadMs",
    "sourceHashMs",
    "openMs",
    "documentMetadataMs",
    "pageAnalysisMs",
    "parseAndCompileMs",
    "renderMs",
    "totalMs",
    "coldProcessWallMs"
  ];
  const output = {};
  for (const key of numericKeys) {
    output[key] = roundMetric(median(samples.map((sample) => sample[key])));
  }
  const memoryKeys = [
    "peakRssDeltaBytes",
    "peakHeapUsedDeltaBytes",
    "processMaxRssBytes"
  ];
  output.memory = {};
  for (const key of memoryKeys) {
    output.memory[key] = Math.round(median(samples.map((sample) => sample.memory[key])));
  }
  return output;
}

function deterministicDocumentView(document) {
  const { measurements: _measurements, ...deterministic } = document;
  return deterministic;
}

function chooseScreenshotPages(pageCount, policy) {
  if (policy === "none") {
    return new Set();
  }
  if (policy === "all") {
    return new Set(Array.from({ length: pageCount }, (_, index) => index));
  }
  return new Set([0, Math.floor((pageCount - 1) / 2), pageCount - 1]);
}

async function verifyArtifact(descriptor, root, label, errors) {
  await readVerifiedArtifact(descriptor, root, label, errors);
}

async function readVerifiedArtifact(descriptor, root, label, errors) {
  let absolutePath;
  try {
    absolutePath = resolveArtifact(root, descriptor.file);
    const bytes = await readFile(absolutePath);
    if (bytes.byteLength !== descriptor.byteLength) {
      errors.push(`${label}: artifact byte length does not match its report.`);
      return null;
    }
    if (sha256Bytes(bytes) !== descriptor.sha256) {
      errors.push(`${label}: artifact checksum does not match its report.`);
      return null;
    }
    return bytes;
  } catch (error) {
    errors.push(`${label}: cannot read ${absolutePath ?? descriptor.file}: ${formatError(error)}`);
    return null;
  }
}

async function writeArtifact(root, relativePath, bytes) {
  const absolutePath = resolveArtifact(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFileAtomic(absolutePath, bytes);
}

function resolveArtifact(root, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid artifact path: ${String(relativePath)}.`);
  }
  const absolutePath = path.resolve(root, relativePath);
  assertContainedPath(root, absolutePath, "artifact");
  return absolutePath;
}

async function writeFileAtomic(target, contents) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function publishDirectoryAtomically(staging, target) {
  const backup = `${target}.backup-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  try {
    try {
      await rename(target, backup);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(staging, target);
    if (movedExisting) {
      await rm(backup, { force: true, recursive: true });
    }
  } catch (error) {
    if (movedExisting) {
      await rename(backup, target).catch(() => {});
    }
    throw error;
  }
}

function validateEngine(engine, adapterUrl) {
  if (!engine || typeof engine !== "object" || typeof engine.openDocument !== "function") {
    throw new Error(`Oracle adapter ${adapterUrl} createEngine() returned an invalid engine.`);
  }
  normalizeEngineIdentity(engine.identity);
}

function validateDocumentAdapter(document) {
  if (!document || !Number.isSafeInteger(document.pageCount) || document.pageCount <= 0) {
    throw new Error("Oracle adapter returned an invalid page count.");
  }
  for (const method of ["getDocumentMetadata", "getPage", "close"]) {
    if (typeof document[method] !== "function") {
      throw new Error(`Oracle document adapter is missing ${method}().`);
    }
  }
}

function validatePageAdapter(page, sourcePageIndex) {
  if (!page || typeof page !== "object") {
    throw new Error(`Oracle adapter returned an invalid page ${sourcePageIndex}.`);
  }
  for (const method of ["getMetadata", "getNormalizedText", "getSemanticSummary", "renderPng", "close"]) {
    if (typeof page[method] !== "function") {
      throw new Error(`Oracle page ${sourcePageIndex} adapter is missing ${method}().`);
    }
  }
}

function validateRenderedPng(rendered, sourcePageIndex, scale) {
  if (
    !rendered ||
    !Number.isSafeInteger(rendered.width) ||
    !Number.isSafeInteger(rendered.height) ||
    rendered.width <= 0 ||
    rendered.height <= 0 ||
    !(rendered.bytes instanceof Uint8Array)
  ) {
    throw new Error(`Adapter returned an invalid PNG for page ${sourcePageIndex} at ${scale}x.`);
  }
}

function normalizeEngineIdentity(identity) {
  if (!identity || typeof identity.id !== "string" || typeof identity.version !== "string") {
    throw new Error("Oracle adapter engine.identity must contain string id and version fields.");
  }
  return {
    id: identity.id,
    version: identity.version,
    build: typeof identity.build === "string" ? identity.build : null
  };
}

function runtimeEnvironment() {
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem()
  };
}

function appendDifference(errors, label, expected, actual) {
  const difference = firstJsonDifference(expected, actual);
  if (difference) {
    errors.push(
      `${label}${difference.path.slice(1)}: expected ${formatValue(difference.expected)}, ` +
      `got ${formatValue(difference.actual)}.`
    );
  }
}

function assertNoDifference(expected, actual, label) {
  const difference = firstJsonDifference(expected, actual);
  if (difference) {
    throw new Error(
      `${label}${difference.path.slice(1)}: expected ${formatValue(difference.expected)}, ` +
      `got ${formatValue(difference.actual)}.`
    );
  }
}

function resolveConfiguredPath(directory, value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Oracle corpus ${label} must be a non-empty path.`);
  }
  return path.resolve(directory, value);
}

function assertContainedPath(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`${label} path escapes its configured root: ${candidate}.`);
}

function resolveAdapterUrl(value) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return value;
  }
  return pathToFileURL(path.resolve(value)).href;
}

function artifactPath(...segments) {
  return segments.join("/");
}

function padPage(sourcePageIndex) {
  return String(sourcePageIndex).padStart(4, "0");
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) return 0;
  const midpoint = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[midpoint - 1] + finite[midpoint]) / 2 : finite[midpoint];
}

function safeRatio(numerator, denominator) {
  if (denominator === 0) return numerator === 0 ? 1 : Infinity;
  return numerator / denominator;
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeProcessMaxRss(value) {
  return Number.isFinite(value) ? Math.round(value * 1024) : 0;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function integerInRange(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function unitInterval(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be a number from 0 through 1.`);
  }
  return parsed;
}

function requireValue(argv, index, label) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${label} requires a value.`);
  }
  return value;
}

function appendBounded(current, chunk, maximumBytes) {
  const next = current + chunk.toString("utf8");
  return next.length <= maximumBytes ? next : next.slice(next.length - maximumBytes);
}

function formatRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)}x` : "infinite";
}

function formatBytes(value) {
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return String(value);
  return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
}

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function logProgress(options, message) {
  if (!options.json) {
    process.stderr.write(`${message}\n`);
  }
}

function helpText() {
  return `HEPR differential oracle baseline harness

Usage:
  npm run oracle:compare -- [options]
  npm run oracle:write -- [options]

Default behavior is read-only: collect current artifacts in a temporary
directory, compare them with oracle/baselines/pdfjs-6.1.200, then remove the
temporary artifacts. Baselines change only when --write is present.

Options:
  --write                     Atomically replace the complete PDF.js baseline.
  --adapter <module>          Candidate adapter module (compare only).
  --document <id[,id...]>     Compare a subset; repeatable (never with --write).
  --screenshots <mode>        none, representative, or all. Compare defaults to
                              the frozen policy; write defaults to representative.
  --samples <count>           Isolated process samples per document (default: 1).
  --output <new-directory>    Keep current comparison artifacts for inspection.
  --baseline-dir <directory>  Override the baseline directory.
  --corpus <file>             Override oracle/corpus.json.
  --max-render-pixels <count> Per-page/scale hard limit (default: 134217728).
  --ssim-min <0..1>           Visual SSIM floor (default: 0.995).
  --non-edge-min <0..1>       Non-edge pixel pass fraction (default: 0.995).
  --channel-tolerance <0..255> Per-channel tolerance (default: 8).
  --edge-threshold <0..255>   Baseline edge classifier threshold (default: 24).
  --enforce-performance       Enforce 25% parse/RSS gains, <=10% per-document
                              and tiny cold-start regressions.
  --validate-config           Validate the 14-file manifest without parsing PDFs.
  --json                      Emit the comparison summary as JSON.
  -h, --help                  Show this help without loading PDF.js.

The adapter contract and manual release workflow are documented in
oracle/README.md. Corpus runs are intentionally never part of build/test.
`;
}
