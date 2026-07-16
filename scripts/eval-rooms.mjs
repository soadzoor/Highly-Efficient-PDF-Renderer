// Headless room-detection eval harness for the deterministic detector.
//
// Runs src/roomDetector.ts (loaded via Vite SSR so the real TypeScript is exercised)
// over the cached segment dumps in ml/room-detection/data/vector-segments plus text-label
// sidecars when present, and writes one prediction
// JSON per page under .eval/<run>/predictions/. The dependency-free scorer treats TSV
// polygons as incomplete positive labels rather than closed-world ground truth.
//
// Usage:
//   node scripts/eval-rooms.mjs --run det-base --score
//   node scripts/eval-rooms.mjs --run probe --filter "Chino MOB_FLOOR 1" --png
//   node scripts/eval-rooms.mjs --run tweak --opts '{"doorGapFactor":8}' --jobs 4 --score
//   node scripts/eval-rooms.mjs --run live --filter Murietta --from-pdf --png
//   node scripts/eval-rooms.mjs --run example --pdf public/examples/pdfs/plan.pdf --png
//   node scripts/eval-rooms.mjs --run cached --zip public/examples/zips/plan-parsed-data.zip --png
//
// Flags:
//   --run NAME        output folder name under .eval/ (default: "run")
//   --filter SUBSTR   only entries whose "folder/stem" contains SUBSTR (case-insensitive)
//   --split NAME      all | gt | train | val | test | smoke  (default all; gt = train+val+test)
//   --opts JSON       extra RoomDetectionOptions merged into detectRooms()
//   --png             collect debug info and write overlay + region-map PNGs
//   --from-pdf        extract the scene live from pdf-tsv/<folder>/<stem>.pdf instead of the dump
//   --pdf PATH        evaluate one standalone PDF directly (implies --from-pdf)
//   --zip PATH        evaluate one standalone HEPR parsed-data ZIP directly
//   --jobs N          fork N shards (each loads its own Vite server)
//   --score           run the noise-aware dependency-free scorer afterwards
//   --score-args STR  extra args appended to the scorer (e.g. "--resolution 1024 --iou 0.7")

import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { gunzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const segmentsDir = path.resolve(repoRootDir, "ml", "room-detection", "data", "vector-segments");
const textLabelsDir = path.resolve(repoRootDir, "ml", "room-detection", "data", "text-labels");
const splitsPath = path.resolve(repoRootDir, "ml", "room-detection", "vector-splits.json");
const pdfTsvDir = path.resolve(repoRootDir, "pdf-tsv");

function parseArgs(argv) {
  const args = {
    run: "run",
    filter: null,
    split: "all",
    opts: {},
    png: false,
    fromPdf: false,
    pdfPath: null,
    zipPath: null,
    jobs: 1,
    shard: null,
    score: false,
    scoreArgs: []
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--run") {
      args.run = argv[++i];
    } else if (value === "--filter") {
      args.filter = argv[++i];
    } else if (value === "--split") {
      args.split = argv[++i];
    } else if (value === "--opts") {
      args.opts = JSON.parse(argv[++i]);
    } else if (value === "--png") {
      args.png = true;
    } else if (value === "--from-pdf") {
      args.fromPdf = true;
    } else if (value === "--pdf") {
      args.pdfPath = argv[++i];
      args.fromPdf = true;
    } else if (value === "--zip") {
      args.zipPath = argv[++i];
    } else if (value === "--jobs") {
      args.jobs = Math.max(1, Number(argv[++i]) || 1);
    } else if (value === "--shard") {
      const [index, count] = argv[++i].split("/").map(Number);
      args.shard = { index, count };
    } else if (value === "--score") {
      args.score = true;
    } else if (value === "--score-args") {
      args.scoreArgs = argv[++i].split(/\s+/).filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

// Mirrors roomdet.pdf_tsv_dataset.sanitize_stem so prediction filenames join with npz names.
function sanitizeStem(stem) {
  const normalized = stem.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized || "floorplan";
}

async function readJsonGz(filePath) {
  const buffer = await fs.readFile(filePath);
  return JSON.parse(gunzipSync(buffer).toString("utf8"));
}

async function listEntries(args) {
  if (args.zipPath) {
    const zipPath = path.resolve(repoRootDir, args.zipPath);
    const parsedSuffix = /-parsed-data$/i;
    const stem = path.basename(zipPath, path.extname(zipPath)).replace(parsedSuffix, "");
    return [{ folder: "standalone", stem, zipPath }];
  }
  if (args.pdfPath) {
    const pdfPath = path.resolve(repoRootDir, args.pdfPath);
    return [{ folder: "standalone", stem: path.basename(pdfPath, path.extname(pdfPath)), pdfPath }];
  }
  const index = JSON.parse(await fs.readFile(path.join(segmentsDir, "index.json"), "utf8"));
  let entries = index.entries.filter((entry) => entry.status !== "failed" && entry.dump);

  if (args.split !== "all") {
    const splits = JSON.parse(await fs.readFile(splitsPath, "utf8"));
    const wanted = new Set();
    const splitNames = args.split === "gt" ? ["train", "val", "test"] : [args.split];
    for (const name of splitNames) {
      const rows = splits[name];
      if (!Array.isArray(rows)) {
        throw new Error(`Unknown split "${name}" in ${splitsPath}`);
      }
      for (const row of rows) {
        wanted.add(`${row.folder}/${row.stem}`);
      }
    }
    entries = entries.filter((entry) => wanted.has(`${entry.folder}/${entry.stem}`));
  }

  if (args.filter) {
    const needle = args.filter.toLowerCase();
    entries = entries.filter((entry) => `${entry.folder}/${entry.stem}`.toLowerCase().includes(needle));
  }

  if (args.shard) {
    entries = entries.filter((_, index2) => index2 % args.shard.count === args.shard.index);
  }
  return entries;
}

function buildSceneFromDump(dump, labels) {
  const pageBoundsArray = dump.sceneStats.pageBounds;
  const endpoints = new Float32Array(dump.strokes.endpoints);
  return {
    pageCount: 1,
    pageRects: new Float32Array(pageBoundsArray),
    endpoints,
    primitiveMeta: new Float32Array(dump.strokes.primitiveMeta),
    styles: new Float32Array(dump.strokes.styles),
    segmentCount: endpoints.length / 4,
    primitiveBounds: new Float32Array(0), // only read when pageCount > 1
    pageBounds: { minX: pageBoundsArray[0], minY: pageBoundsArray[1], maxX: pageBoundsArray[2], maxY: pageBoundsArray[3] },
    textContent: labels ? labels.labels.map((label) => ({ ...label, pageIndex: 0 })) : undefined
  };
}

function applyMatrix(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

// Ground truth for the PNG overlay only (the scorer reads the canonical npz GT):
// TSV geometryData is PDF user space; the dump's sceneMatrix maps it to scene space.
async function loadTsvGroundTruth(folder, stem, sceneMatrix) {
  const tsvPath = path.join(pdfTsvDir, folder, `${stem}.tsv`);
  let tsv;
  try {
    tsv = await fs.readFile(tsvPath, "utf8");
  } catch {
    return null;
  }
  const lines = tsv.split("\n");
  const header = (lines[0] ?? "").replace(/\r$/, "").split("\t");
  const geometryCol = header.indexOf("geometryData");
  const numberCol = header.indexOf("roomNumber");
  if (geometryCol < 0) {
    return null;
  }
  const rooms = [];
  for (const line of lines.slice(1)) {
    const cells = line.replace(/\r$/, "").split("\t");
    if (cells.length <= geometryCol) {
      continue;
    }
    let points;
    try {
      points = JSON.parse(cells[geometryCol]);
    } catch {
      continue;
    }
    if (!Array.isArray(points) || points.length < 3) {
      continue;
    }
    const polygon = [];
    for (const point of points) {
      const [x, y] = applyMatrix(sceneMatrix, Number(point.x), Number(point.y));
      polygon.push(x, y);
    }
    rooms.push({ roomNumber: numberCol >= 0 ? (cells[numberCol] ?? "").trim() : "", polygon });
  }
  return { rooms };
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function serializeResult(entry, result, detectMs, options) {
  const failureCounts = {};
  for (const failure of result.failedSeeds) {
    failureCounts[failure.reason] = (failureCounts[failure.reason] ?? 0) + 1;
  }
  const pageStats = result.debug?.pageStats?.get(0);
  return {
    folder: entry.folder,
    stem: entry.stem,
    detectMs: Number(detectMs.toFixed(1)),
    seedSource: result.seedSource,
    options,
    rooms: result.rooms.map((room) => ({
      // Preserve the exact Float32 values. Any decimal-place rounding can move two ends
      // of a long shared edge in opposite directions and manufacture a thin crossing.
      polygon: Array.from(room.polygon),
      area: roundTo(room.area, 1),
      confidence: roundTo(room.confidence, 3),
      hasDoorEvidence: room.hasDoorEvidence,
      labelText: room.labelText,
      roomNumber: room.roomNumber,
      labelX: roundTo(room.labelX, 2),
      labelY: roundTo(room.labelY, 2)
    })),
    failedSeeds: result.failedSeeds.map((failure) => ({
      x: roundTo(failure.seed.x, 2),
      y: roundTo(failure.seed.y, 2),
      label: failure.seed.label ?? "",
      reason: failure.reason
    })),
    failureCounts,
    pageStats: pageStats
      ? {
          eligibleSegmentCount: pageStats.eligibleSegmentCount,
          hairlineSegmentCount: pageStats.hairlineSegmentCount,
          totalStrokeLength: roundTo(pageStats.totalStrokeLength, 1),
          wallHalfWidthThreshold: pageStats.wallHalfWidthThreshold,
          wallMedianHalfWidth: pageStats.wallMedianHalfWidth,
          uniformWidthMode: pageStats.uniformWidthMode,
          dominantLongStrokeColorFraction: roundTo(pageStats.dominantLongStrokeColorFraction, 4),
          dominantLongStrokeColorRatio: roundTo(pageStats.dominantLongStrokeColorRatio, 2),
          structuralGeometryRefinementCount: pageStats.structuralGeometryRefinementCount,
          openBayRefinementCount: pageStats.openBayRefinementCount,
          pairedDoorRecoveryCount: pageStats.pairedDoorRecoveryCount,
          wallSegmentCount: pageStats.wallSegmentCount,
          doorArcCandidateSegmentCount: pageStats.doorArcCandidateSegmentCount,
          doorArcSegmentCount: pageStats.doorArcSegmentCount,
          closureCount: pageStats.closureCount,
          containedRoomSuppressionCount: pageStats.containedRoomSuppressionCount,
          geometryRepairCount: pageStats.geometryRepairCount,
          geometryConflictSuppressionCount: pageStats.geometryConflictSuppressionCount,
          doorGapMax: roundTo(pageStats.doorGapMax, 2),
          rasterWidth: pageStats.rasterWidth,
          rasterHeight: pageStats.rasterHeight,
          seedCount: pageStats.seedCount
        }
      : null
  };
}

async function runShard(args, entries) {
  const { createServer } = await import("vite");
  const viteServer = await createServer({
    configFile: false,
    root: repoRootDir,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom"
  });

  const runDir = path.resolve(repoRootDir, ".eval", args.run);
  const predictionsDir = path.join(runDir, "predictions");
  const pngDir = path.join(runDir, "png");
  await fs.mkdir(predictionsDir, { recursive: true });
  if (args.png) {
    await fs.mkdir(pngDir, { recursive: true });
  }

  let failed = 0;
  try {
    const detectorModule = await viteServer.ssrLoadModule("/src/roomDetector.ts");
    const { detectRooms } = detectorModule;
    const png = args.png ? await import("./lib/roomEvalPng.mjs") : null;
    const extractorModule = args.fromPdf ? await viteServer.ssrLoadModule("/src/pdfVectorExtractor.ts") : null;
    if (args.zipPath && typeof globalThis.window === "undefined") {
      globalThis.window = { location: { href: "http://localhost/" } };
    }
    const parsedDataModule = args.zipPath ? await viteServer.ssrLoadModule("/src/parsedDataZip.ts") : null;

    for (const [index, entry] of entries.entries()) {
      const key = `${entry.folder}/${entry.stem}`;
      try {
        let scene;
        let sceneMatrix = null;
        if (entry.zipPath) {
          const bytes = await fs.readFile(entry.zipPath);
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          scene = await parsedDataModule.loadSceneFromParsedDataZip(buffer);
        } else if (args.fromPdf) {
          const pdfPath = entry.pdfPath ?? path.join(pdfTsvDir, entry.folder, `${entry.stem}.pdf`);
          const bytes = await fs.readFile(pdfPath);
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          scene = await extractorModule.extractFirstPageVectors(buffer, { extractTextContent: true });
        } else {
          const dump = await readJsonGz(path.join(segmentsDir, entry.dump));
          const labelsPath = path.join(textLabelsDir, entry.folder, `${entry.stem}.labels.json.gz`);
          const labels = await readJsonGz(labelsPath).catch(() => null);
          scene = buildSceneFromDump(dump, labels);
          sceneMatrix = dump.page?.sceneMatrix ?? null;
        }

        const detectStart = performance.now();
        const result = detectRooms(scene, { collectDebugInfo: args.png, ...args.opts });
        const detectMs = performance.now() - detectStart;

        const safeName = `${sanitizeStem(entry.folder)}__${sanitizeStem(entry.stem)}`;
        const payload = serializeResult(entry, result, detectMs, args.opts);
        await fs.writeFile(path.join(predictionsDir, `${safeName}.json`), JSON.stringify(payload));

        if (png) {
          let groundTruth = null;
          if (sceneMatrix) {
            groundTruth = await loadTsvGroundTruth(entry.folder, entry.stem, sceneMatrix);
          }
          await fs.writeFile(path.join(pngDir, `${safeName}.png`), png.renderResultPng(scene, result, groundTruth));
          const regions = png.renderRegionsPng(result);
          if (regions) {
            await fs.writeFile(path.join(pngDir, `${safeName}_regions.png`), regions);
          }
        }

        console.log(
          JSON.stringify({
            event: "page_done",
            page: key,
            index: index + 1,
            total: entries.length,
            rooms: result.rooms.length,
            failedSeeds: result.failedSeeds.length,
            failureCounts: payload.failureCounts,
            seedSource: result.seedSource,
            detectMs: payload.detectMs
          })
        );
      } catch (error) {
        failed += 1;
        console.log(JSON.stringify({ event: "page_failed", page: key, error: String(error?.stack ?? error) }));
      }
    }
  } finally {
    await viteServer.close();
  }
  return failed;
}

function forkShard(args, shardIndex) {
  return new Promise((resolve, reject) => {
    const forwarded = [
      "--run", args.run,
      "--split", args.split,
      "--shard", `${shardIndex}/${args.jobs}`,
      ...(args.filter ? ["--filter", args.filter] : []),
      ...(Object.keys(args.opts).length > 0 ? ["--opts", JSON.stringify(args.opts)] : []),
      ...(args.png ? ["--png"] : []),
      ...(args.pdfPath ? ["--pdf", args.pdfPath] : []),
      ...(args.zipPath ? ["--zip", args.zipPath] : []),
      ...(args.fromPdf ? ["--from-pdf"] : [])
    ];
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...forwarded], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${shardIndex} exited with ${code}`))));
  });
}

function runScorer(args) {
  return new Promise((resolve, reject) => {
    const predictionsDir = path.resolve(repoRootDir, ".eval", args.run, "predictions");
    const scorerPath = path.resolve(repoRootDir, "scripts", "score-rooms.mjs");
    const child = spawn(process.execPath, [scorerPath, "--predictions", predictionsDir, ...args.scoreArgs], {
      stdio: "inherit",
      cwd: repoRootDir
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`scorer exited with ${code}`))));
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const startTime = Date.now();

  if (args.shard) {
    const entries = await listEntries(args);
    const failed = await runShard(args, entries);
    process.exitCode = failed > 0 ? 1 : 0;
    return;
  }

  const entries = await listEntries(args);
  if (entries.length === 0) {
    throw new Error(`No entries match (split=${args.split}${args.filter ? `, filter=${args.filter}` : ""})`);
  }
  console.log(JSON.stringify({ event: "eval_config", run: args.run, entries: entries.length, split: args.split, opts: args.opts, png: args.png, fromPdf: args.fromPdf, pdf: args.pdfPath, zip: args.zipPath, jobs: args.jobs }));

  if (args.jobs > 1) {
    await Promise.all(Array.from({ length: args.jobs }, (_, index) => forkShard(args, index)));
  } else {
    const failed = await runShard(args, entries);
    if (failed > 0) {
      process.exitCode = 1;
    }
  }

  console.log(JSON.stringify({ event: "eval_complete", run: args.run, totalSeconds: Number(((Date.now() - startTime) / 1000).toFixed(1)) }));

  if (args.score) {
    await runScorer(args);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
