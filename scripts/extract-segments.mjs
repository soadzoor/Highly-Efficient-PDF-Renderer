// Headless segment dump for the vector-native room-detection pipeline.
//
// Walks the pdf-tsv corpus, runs src/pdfVectorExtractor.ts on page 1 of every PDF
// (same code path the browser demo uses, so training data matches inference exactly)
// and writes one gzipped JSON per PDF with stroke segments, fill-outline segments and
// the PDF-user-space -> scene-space matrix needed to map TSV ground truth.
//
// Usage:
//   node scripts/extract-segments.mjs --root pdf-tsv --out ml/room-detection/data/vector-segments
//   node scripts/extract-segments.mjs --only "kp/1345 N Vermont_L6 MOB 01.pdf"   (smoke test)
//
// The extractor is loaded through Vite SSR so its TypeScript + top-level await work in Node.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");

const DUMP_VERSION = 1;
const COORD_DECIMALS = 4;
const STYLE_DECIMALS = 6;

function parseArgs(argv) {
  const args = {
    root: path.resolve(repoRootDir, "pdf-tsv"),
    out: path.resolve(repoRootDir, "ml", "room-detection", "data", "vector-segments"),
    only: null,
    force: false,
    logSeconds: 10
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--root") {
      args.root = path.resolve(repoRootDir, argv[++i]);
    } else if (value === "--out") {
      args.out = path.resolve(repoRootDir, argv[++i]);
    } else if (value === "--only") {
      args.only = argv[++i];
    } else if (value === "--force") {
      args.force = true;
    } else if (value === "--log-seconds") {
      args.logSeconds = Math.max(1, Number(argv[++i]) || 10);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

async function listPdfFiles(root, only) {
  const entries = [];
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`--root is not a directory: ${root}`);
  }
  const topLevel = await fs.readdir(root, { withFileTypes: true });
  for (const entry of topLevel) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      entries.push({ folder: ".", pdfPath: path.join(root, entry.name) });
    } else if (entry.isDirectory()) {
      const children = await fs.readdir(path.join(root, entry.name), { withFileTypes: true });
      for (const child of children) {
        if (child.isFile() && child.name.toLowerCase().endsWith(".pdf")) {
          entries.push({ folder: entry.name, pdfPath: path.join(root, entry.name, child.name) });
        }
      }
    }
  }
  entries.sort((a, b) => a.pdfPath.localeCompare(b.pdfPath));
  if (only) {
    const needle = only.toLowerCase();
    return entries.filter((entry) => path.relative(root, entry.pdfPath).toLowerCase().includes(needle));
  }
  return entries;
}

function multiplyMatrices(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function applyMatrix(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function normalizeRotationDegrees(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

// Mirrors buildPageMatrix in src/pdfVectorExtractor.ts (Y-up scene space).
function buildSceneMatrix(page) {
  const rotation = normalizeRotationDegrees(page.rotate);
  const viewport = page.getViewport({ scale: 1, rotation, dontFlip: false });
  const transform = viewport.transform;
  if (!Array.isArray(transform) || transform.length < 6) {
    return { rotation, viewport, sceneMatrix: [1, 0, 0, 1, 0, 0] };
  }
  const base = transform.slice(0, 6).map(Number);
  const sceneMatrix = Number.isFinite(Number(viewport.height))
    ? multiplyMatrices([1, 0, 0, -1, 0, Number(viewport.height)], base)
    : base;
  return { rotation, viewport, sceneMatrix };
}

function transformedViewBounds(viewBox, matrix) {
  const corners = [
    applyMatrix(matrix, viewBox[0], viewBox[1]),
    applyMatrix(matrix, viewBox[2], viewBox[1]),
    applyMatrix(matrix, viewBox[2], viewBox[3]),
    applyMatrix(matrix, viewBox[0], viewBox[3])
  ];
  return [
    Math.min(...corners.map((point) => point[0])),
    Math.min(...corners.map((point) => point[1])),
    Math.max(...corners.map((point) => point[0])),
    Math.max(...corners.map((point) => point[1]))
  ];
}

function roundArray(values, decimals) {
  const factor = 10 ** decimals;
  const result = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    result[i] = Math.round(values[i] * factor) / factor;
  }
  return result;
}

// primitiveMeta packs (p2x, p2y, primitiveType, styleMeta); only styleMeta needs
// extra precision because it encodes alpha + flags*2.
function roundPrimitiveMeta(values) {
  const result = new Array(values.length);
  const coordFactor = 10 ** COORD_DECIMALS;
  const styleFactor = 10 ** STYLE_DECIMALS;
  for (let i = 0; i < values.length; i += 4) {
    result[i] = Math.round(values[i] * coordFactor) / coordFactor;
    result[i + 1] = Math.round(values[i + 1] * coordFactor) / coordFactor;
    result[i + 2] = values[i + 2];
    result[i + 3] = Math.round(values[i + 3] * styleFactor) / styleFactor;
  }
  return result;
}

function boundsToArray(bounds) {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

async function main() {
  const args = parseArgs(process.argv);
  const entries = await listPdfFiles(args.root, args.only);
  if (entries.length === 0) {
    throw new Error(`No PDFs found under ${args.root}${args.only ? ` matching ${args.only}` : ""}`);
  }

  console.log(
    JSON.stringify({
      event: "extract_segments_config",
      root: args.root,
      out: args.out,
      pdfCount: entries.length,
      force: args.force
    })
  );

  const { createServer } = await import("vite");
  const viteServer = await createServer({
    root: repoRootDir,
    logLevel: "error",
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: "custom"
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const indexEntries = [];
  const startTime = Date.now();
  try {
    const extractorModule = await viteServer.ssrLoadModule("/src/pdfVectorExtractor.ts");
    const { extractFirstPageVectors } = extractorModule;
    if (typeof extractFirstPageVectors !== "function") {
      throw new Error("extractFirstPageVectors not found in src/pdfVectorExtractor.ts");
    }
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const standardFontDataUrl = `${path.join(repoRootDir, "node_modules", "pdfjs-dist", "standard_fonts")}/`;

    for (const [index, entry] of entries.entries()) {
      const relativePdf = path.relative(repoRootDir, entry.pdfPath);
      const stem = path.basename(entry.pdfPath, path.extname(entry.pdfPath));
      const outputDir = path.join(args.out, entry.folder);
      const outputPath = path.join(outputDir, `${stem}.segments.json.gz`);
      const percent = (((index + 1) / entries.length) * 100).toFixed(1);

      if (!args.force) {
        const exists = await fs
          .stat(outputPath)
          .then(() => true)
          .catch(() => false);
        if (exists) {
          skipped += 1;
          console.log(
            JSON.stringify({
              event: "file_skipped",
              file: index + 1,
              files: entries.length,
              percent: Number(percent),
              pdf: relativePdf,
              reason: "exists"
            })
          );
          indexEntries.push({ folder: entry.folder, stem, dump: path.relative(args.out, outputPath), status: "existing" });
          continue;
        }
      }

      const fileStart = Date.now();
      try {
        const pdfBytes = await fs.readFile(entry.pdfPath);
        const pdfData = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);

        let lastProgressLog = Date.now();
        const scene = await extractFirstPageVectors(pdfData.slice(0), {
          onProgress: (progress) => {
            const now = Date.now();
            if (now - lastProgressLog >= args.logSeconds * 1000) {
              lastProgressLog = now;
              console.log(
                JSON.stringify({
                  event: "file_progress",
                  file: index + 1,
                  files: entries.length,
                  pdf: relativePdf,
                  extractPercent: Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100)
                })
              );
            }
          }
        });

        // Page metadata (view box, rotation, scene matrix) via pdf.js directly.
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(pdfData),
          disableFontFace: true,
          fontExtraProperties: true,
          verbosity: 0,
          standardFontDataUrl
        });
        const pdfDocument = await loadingTask.promise;
        let pageMeta;
        try {
          const page = await pdfDocument.getPage(1);
          const viewBox = Array.isArray(page.view) ? page.view.slice(0, 4).map(Number) : [0, 0, 1, 1];
          const { rotation, viewport, sceneMatrix } = buildSceneMatrix(page);
          pageMeta = {
            pageCount: Number(pdfDocument.numPages) || 1,
            viewBox,
            rotation,
            viewportTransform: Array.isArray(viewport.transform) ? viewport.transform.slice(0, 6).map(Number) : null,
            viewportWidth: Number(viewport.width),
            viewportHeight: Number(viewport.height),
            sceneMatrix
          };
        } finally {
          await loadingTask.destroy();
        }

        // Sanity: view box mapped through sceneMatrix must match the scene's page bounds.
        const mappedBounds = transformedViewBounds(pageMeta.viewBox, pageMeta.sceneMatrix);
        const sceneBounds = boundsToArray(scene.pageBounds);
        const boundsMismatch = mappedBounds.some((value, i) => Math.abs(value - sceneBounds[i]) > 1e-3);

        const payload = {
          version: DUMP_VERSION,
          stem,
          folder: entry.folder,
          sourcePdf: relativePdf,
          generatedAt: new Date().toISOString(),
          extractOptions: { maxPages: 1, enableSegmentMerge: true, enableInvisibleCull: true },
          page: pageMeta,
          boundsMismatch,
          sceneStats: {
            segmentCount: scene.segmentCount,
            sourceSegmentCount: scene.sourceSegmentCount,
            mergedSegmentCount: scene.mergedSegmentCount,
            fillPathCount: scene.fillPathCount,
            fillSegmentCount: scene.fillSegmentCount,
            pathCount: scene.pathCount,
            operatorCount: scene.operatorCount,
            imagePaintOpCount: scene.imagePaintOpCount,
            textInstanceCount: scene.textInstanceCount,
            maxHalfWidth: scene.maxHalfWidth,
            pageBounds: sceneBounds,
            bounds: boundsToArray(scene.bounds),
            discardedTransparentCount: scene.discardedTransparentCount,
            discardedDegenerateCount: scene.discardedDegenerateCount,
            discardedDuplicateCount: scene.discardedDuplicateCount,
            discardedContainedCount: scene.discardedContainedCount
          },
          strokes: {
            // Per segment i: endpoints[4i..] = (x0, y0, x1, y1) scene space,
            // primitiveMeta[4i..] = (p2x, p2y, type 0=line|1=quadratic, alpha + flags*2
            //   with flags 1=hairline 2=roundCap 4=clipped),
            // styles[4i..] = (halfWidth, r, g, b) with colors in 0..1.
            endpoints: roundArray(scene.endpoints, COORD_DECIMALS),
            primitiveMeta: roundPrimitiveMeta(scene.primitiveMeta),
            styles: roundArray(scene.styles, STYLE_DECIMALS)
          },
          fills: {
            // Per path p: pathMetaA[4p..] = (segmentStart, primitiveCount, minX, minY),
            // pathMetaB[4p..] = (maxX, maxY, colorR, colorG),
            // pathMetaC[4p..] = (fillRule, hasCompanionStroke, colorB, alpha).
            // Per fill segment s: segmentsA[4s..] = (x0, y0, x1|cx, y1|cy),
            // segmentsB[4s..] = (x1, y1, type 0=line|1=quadratic, 0).
            pathMetaA: roundArray(scene.fillPathMetaA, COORD_DECIMALS),
            pathMetaB: roundArray(scene.fillPathMetaB, STYLE_DECIMALS),
            pathMetaC: roundArray(scene.fillPathMetaC, STYLE_DECIMALS),
            segmentsA: roundArray(scene.fillSegmentsA, COORD_DECIMALS),
            segmentsB: roundArray(scene.fillSegmentsB, COORD_DECIMALS)
          }
        };

        await fs.mkdir(outputDir, { recursive: true });
        const gzipped = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
        await fs.writeFile(outputPath, gzipped);

        processed += 1;
        const elapsed = (Date.now() - startTime) / 1000;
        const perFile = elapsed / (index + 1);
        console.log(
          JSON.stringify({
            event: "file_complete",
            file: index + 1,
            files: entries.length,
            percent: Number(percent),
            pdf: relativePdf,
            segments: scene.segmentCount,
            fillSegments: scene.fillSegmentCount,
            fillPaths: scene.fillPathCount,
            boundsMismatch,
            bytes: gzipped.length,
            fileSeconds: Number(((Date.now() - fileStart) / 1000).toFixed(2)),
            eta: formatDuration(perFile * (entries.length - index - 1))
          })
        );
        indexEntries.push({
          folder: entry.folder,
          stem,
          dump: path.relative(args.out, outputPath),
          sourcePdf: relativePdf,
          segments: scene.segmentCount,
          fillSegments: scene.fillSegmentCount,
          boundsMismatch,
          status: "written"
        });
      } catch (error) {
        failed += 1;
        console.log(
          JSON.stringify({
            event: "file_failed",
            file: index + 1,
            files: entries.length,
            percent: Number(percent),
            pdf: relativePdf,
            error: String(error && error.message ? error.message : error)
          })
        );
        indexEntries.push({ folder: entry.folder, stem, sourcePdf: relativePdf, status: "failed" });
      }
    }

    await fs.mkdir(args.out, { recursive: true });
    await fs.writeFile(
      path.join(args.out, "index.json"),
      `${JSON.stringify({ version: DUMP_VERSION, generatedAt: new Date().toISOString(), root: path.relative(repoRootDir, args.root), entries: indexEntries }, null, 2)}\n`
    );
  } finally {
    await viteServer.close();
  }

  console.log(
    JSON.stringify({
      event: "extract_segments_complete",
      processed,
      skipped,
      failed,
      totalSeconds: Number(((Date.now() - startTime) / 1000).toFixed(1))
    })
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
