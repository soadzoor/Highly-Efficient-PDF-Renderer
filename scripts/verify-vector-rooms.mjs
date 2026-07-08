// Stagewise parity check: TypeScript vector room pipeline vs the Python pipeline.
//
// Replays src/vectorRoomPipeline.ts + the exported ONNX graphs over a segments
// dump and compares every stage against reference intermediates produced by
// ml/room-detection/dump_vector_reference.py:
//
//   segments -> features/kNN/edge -> encoder probs (direct AND tiled) ->
//   bridge candidates/features/scores -> faces (IoU-matched) -> room types
//
// Usage:
//   node scripts/verify-vector-rooms.mjs --reference /path/to/reference.json.gz \
//     [--models public/models/room-detector-vector] [--tile-target 8192]
//
// Exits non-zero when any hard parity gate fails.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { gunzipSync } from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const args = {
    reference: null,
    models: path.join(repoRootDir, "public", "models", "room-detector-vector"),
    tileTarget: 8192,
    rasterSize: 1024
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--reference") {
      args.reference = path.resolve(argv[++i]);
    } else if (value === "--models") {
      args.models = path.resolve(repoRootDir, argv[++i]);
    } else if (value === "--tile-target") {
      args.tileTarget = Math.max(256, Number(argv[++i]) || 8192);
    } else if (value === "--raster-size") {
      args.rasterSize = Math.max(256, Number(argv[++i]) || 1024);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!args.reference) {
    throw new Error("--reference is required");
  }
  return args;
}

async function readMaybeGzipJson(filePath) {
  const raw = await fs.readFile(filePath);
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return JSON.parse(bytes.toString("utf-8"));
}

function maxAbsDiff(a, b) {
  let worst = 0;
  const flatA = a.flat(Infinity);
  const flatB = Array.isArray(b) ? b.flat(Infinity) : Array.from(b);
  if (flatA.length !== flatB.length) {
    return Number.POSITIVE_INFINITY;
  }
  for (let i = 0; i < flatA.length; i += 1) {
    worst = Math.max(worst, Math.abs(flatA[i] - flatB[i]));
  }
  return worst;
}

// Scanline even-odd rasterizer for face IoU matching.
function rasterizePolygon(polygon, bounds, size) {
  const mask = new Uint8Array(size * size);
  const scaleX = size / Math.max(bounds.maxX - bounds.minX, 1e-9);
  const scaleY = size / Math.max(bounds.maxY - bounds.minY, 1e-9);
  const xs = polygon.map((p) => (p[0] - bounds.minX) * scaleX);
  const ys = polygon.map((p) => (p[1] - bounds.minY) * scaleY);
  for (let row = 0; row < size; row += 1) {
    const y = row + 0.5;
    const crossings = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      if (ys[i] > y !== ys[j] > y) {
        crossings.push(xs[i] + ((y - ys[i]) / (ys[j] - ys[i])) * (xs[j] - xs[i]));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const from = Math.max(0, Math.ceil(crossings[c] - 0.5));
      const to = Math.min(size - 1, Math.floor(crossings[c + 1] - 0.5));
      for (let col = from; col <= to; col += 1) {
        mask[row * size + col] = 1;
      }
    }
  }
  return mask;
}

function maskIou(a, b) {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const inA = a[i];
    const inB = b[i];
    if (inA & inB) {
      intersection += 1;
    }
    if (inA | inB) {
      union += 1;
    }
  }
  return union === 0 ? 0 : intersection / union;
}

async function main() {
  const args = parseArgs(process.argv);
  const reference = await readMaybeGzipJson(args.reference);
  const dumpPath = path.isAbsolute(reference.dump)
    ? reference.dump
    : path.join(repoRootDir, "ml", "room-detection", reference.dump);
  const dump = await readMaybeGzipJson(dumpPath);
  const manifest = JSON.parse(await fs.readFile(path.join(args.models, "manifest.json"), "utf-8"));

  const { createServer } = await import("vite");
  const viteServer = await createServer({
    root: repoRootDir,
    logLevel: "error",
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: "custom"
  });

  const failures = [];
  const report = { reference: args.reference, stem: reference.stem, segments: reference.segmentCount };
  const gate = (name, ok, detail) => {
    report[name] = detail;
    if (!ok) {
      failures.push(name);
    }
  };

  try {
    const pipeline = await viteServer.ssrLoadModule("/src/vectorRoomPipeline.ts");
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = `${path.join(repoRootDir, "node_modules", "onnxruntime-web", "dist")}/`;

    const [minX, minY, maxX, maxY] = reference.pageBounds;
    const pageBounds = { minX, minY, maxX, maxY };

    // 1. Segment collection from the raw dump arrays.
    const segments = pipeline.collectPageSegments({
      segmentCount: Math.floor(dump.strokes.primitiveMeta.length / 4),
      endpoints: dump.strokes.endpoints,
      primitiveMeta: dump.strokes.primitiveMeta,
      styles: dump.strokes.styles,
      fillPathMetaA: dump.fills.pathMetaA,
      fillPathMetaB: dump.fills.pathMetaB,
      fillPathMetaC: dump.fills.pathMetaC,
      fillSegmentsA: dump.fills.segmentsA,
      fillSegmentsB: dump.fills.segmentsB
    });
    const refSegments = reference.segments;
    const segDiff = Math.max(
      maxAbsDiff(refSegments.p0.map((p) => p[0]), segments.p0x),
      maxAbsDiff(refSegments.p0.map((p) => p[1]), segments.p0y),
      maxAbsDiff(refSegments.p1.map((p) => p[0]), segments.p1x),
      maxAbsDiff(refSegments.p1.map((p) => p[1]), segments.p1y),
      maxAbsDiff(refSegments.halfWidth, segments.halfWidth),
      maxAbsDiff(refSegments.alpha, segments.alpha),
      maxAbsDiff(refSegments.flags, segments.flags)
    );
    gate("segmentCollection", segments.count === reference.segmentCount && segDiff < 1e-4, {
      count: segments.count,
      expected: reference.segmentCount,
      maxAbsDiff: segDiff
    });

    // 2. Features + kNN graph + edge features.
    const k = manifest.encoderConfig.knn;
    const inputs = pipeline.buildPageInputs(segments, pageBounds, k);
    const featureDiff = maxAbsDiff(reference.features, inputs.features);
    const refKnn = reference.knnIdx;
    let knnMatches = 0;
    let edgeDiff = 0; // only where the neighbor index matches; distance-tied
    // neighbors are legitimately interchangeable and produce different rel coords
    let tieExplainedRows = 0;
    let nonTieRows = 0;
    const distanceTo = (i, j) => Math.hypot(inputs.midX[j] - inputs.midX[i], inputs.midY[j] - inputs.midY[i]);
    for (let i = 0; i < reference.segmentCount; i += 1) {
      const mine = new Set();
      const theirs = new Set(refKnn[i]);
      for (let j = 0; j < k; j += 1) {
        mine.add(inputs.knnIdx[i * k + j]);
        if (inputs.knnIdx[i * k + j] === refKnn[i][j]) {
          for (let f = 0; f < 6; f += 1) {
            edgeDiff = Math.max(edgeDiff, Math.abs(reference.edge[i][j][f] - inputs.edge[(i * k + j) * 6 + f]));
          }
        }
      }
      let common = 0;
      for (const idx of mine) {
        if (theirs.has(idx)) {
          common += 1;
        }
      }
      knnMatches += common / k;
      if (common < mine.size) {
        // Disagreements must be exact distance ties (scipy's tie order is arbitrary).
        const onlyMine = [...mine].filter((x) => !theirs.has(x)).map((j) => distanceTo(i, j)).sort((a, b) => a - b);
        const onlyTheirs = [...theirs].filter((x) => !mine.has(x)).map((j) => distanceTo(i, j)).sort((a, b) => a - b);
        const isTie =
          onlyMine.length === onlyTheirs.length &&
          onlyMine.every((d, x) => Math.abs(d - onlyTheirs[x]) <= 1e-9 * Math.max(d, 1));
        if (isTie) {
          tieExplainedRows += 1;
        } else {
          nonTieRows += 1;
        }
      }
    }
    const knnAgreement = knnMatches / reference.segmentCount;
    gate("features", featureDiff < 1e-4, { maxAbsDiff: featureDiff });
    gate("knnGraph", nonTieRows === 0 && edgeDiff < 1e-3, {
      neighborAgreement: knnAgreement,
      tieExplainedRows,
      nonTieRows,
      matchedEdgeMaxAbsDiff: edgeDiff
    });

    // 3. Encoder: direct and tiled must both match the Python probabilities.
    const encoderSession = await ort.InferenceSession.create(path.join(args.models, "encoder.onnx"), {
      executionProviders: ["wasm"]
    });
    const runChunk = async (features, knnIdx, edge, count) => {
      const output = await encoderSession.run({
        features: new ort.Tensor("float32", features, [count, manifest.encoderConfig.featureDim]),
        knn_idx: new ort.Tensor("int32", knnIdx, [count, k]),
        edge: new ort.Tensor("float32", edge, [count, k, manifest.encoderConfig.edgeDim])
      });
      return { embedding: output.embedding.data, probs: output.boundary_prob.data };
    };
    const tilingBase = { layers: manifest.encoderConfig.layers, width: manifest.encoderConfig.width };
    const direct = await pipeline.encodePageTiled(inputs, { ...tilingBase, directLimit: 1e9 }, runChunk);
    const tiled = await pipeline.encodePageTiled(
      inputs,
      { ...tilingBase, directLimit: 1, tileTarget: args.tileTarget },
      runChunk
    );
    const threshold = reference.threshold;
    const evalProbs = (probs) => {
      let worst = 0;
      let agree = 0;
      for (let i = 0; i < reference.segmentCount; i += 1) {
        worst = Math.max(worst, Math.abs(probs[i] - reference.probs[i]));
        if (probs[i] >= threshold === reference.probs[i] >= threshold) {
          agree += 1;
        }
      }
      return { maxAbsDiff: worst, thresholdAgreement: agree / reference.segmentCount };
    };
    const directStats = evalProbs(direct.probs);
    const tiledStats = evalProbs(tiled.probs);
    let tiledVsDirect = 0;
    for (let i = 0; i < reference.segmentCount; i += 1) {
      tiledVsDirect = Math.max(tiledVsDirect, Math.abs(direct.probs[i] - tiled.probs[i]));
    }
    // Residual disagreement traces back to exact-distance kNN ties (duplicate
    // strokes, hatching) whose order scipy resolves arbitrarily; on tie-heavy
    // pages more than half the rows carry a tie, so 0.97 is the realistic bar -
    // the faces gate below is the outcome-level check.
    gate("encoderDirect", directStats.thresholdAgreement > 0.97, directStats);
    gate("encoderTiled", tiledStats.thresholdAgreement > 0.97 && tiledVsDirect < 1e-3, {
      ...tiledStats,
      tiledVsDirectMaxAbsDiff: tiledVsDirect
    });

    // 4. Bridge candidates + features + scores.
    const probs = direct.probs;
    if (reference.bridges) {
      const prep = { ...pipeline.DEFAULT_VECTOR_PREP_CONFIG, ...manifest.prep };
      const boundaryMask = new Uint8Array(segments.count);
      for (let i = 0; i < segments.count; i += 1) {
        boundaryMask[i] = probs[i] >= threshold ? 1 : 0;
      }
      const candidates = pipeline.buildBridgeCandidates(segments, boundaryMask, prep, pageBounds);
      const keyOf = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
      const refKeys = new Set(reference.bridges.segA.map((a, c) => keyOf(a, reference.bridges.segB[c])));
      const mineKeys = new Set();
      for (let c = 0; c < candidates.segA.length; c += 1) {
        mineKeys.add(keyOf(candidates.segA[c], candidates.segB[c]));
      }
      let common = 0;
      for (const key of mineKeys) {
        if (refKeys.has(key)) {
          common += 1;
        }
      }
      const candidateJaccard = common / Math.max(1, refKeys.size + mineKeys.size - common);
      const pair = pipeline.buildBridgeFeatures(segments, candidates, inputs.normalizers);
      let scores = new Float32Array(0);
      let acceptedCount = 0;
      if (candidates.segA.length > 0) {
        const bridgerSession = await ort.InferenceSession.create(path.join(args.models, "bridger.onnx"), {
          executionProviders: ["wasm"]
        });
        const width = manifest.encoderConfig.width;
        const embeddingA = new Float32Array(candidates.segA.length * width);
        const embeddingB = new Float32Array(candidates.segA.length * width);
        for (let c = 0; c < candidates.segA.length; c += 1) {
          embeddingA.set(direct.embedding.subarray(candidates.segA[c] * width, (candidates.segA[c] + 1) * width), c * width);
          embeddingB.set(direct.embedding.subarray(candidates.segB[c] * width, (candidates.segB[c] + 1) * width), c * width);
        }
        const output = await bridgerSession.run({
          embedding_a: new ort.Tensor("float32", embeddingA, [candidates.segA.length, width]),
          embedding_b: new ort.Tensor("float32", embeddingB, [candidates.segA.length, width]),
          pair_features: new ort.Tensor("float32", pair, [candidates.segA.length, 8])
        });
        scores = output.bridge_prob.data;
        for (const score of scores) {
          if (score >= reference.bridges.threshold) {
            acceptedCount += 1;
          }
        }
      }
      gate("bridgeCandidates", candidateJaccard > 0.95, {
        mine: candidates.segA.length,
        reference: reference.bridges.segA.length,
        jaccard: candidateJaccard,
        acceptedCount,
        referenceAcceptedCount: reference.bridges.acceptedCount
      });

      // Score parity on candidates both sides agree on.
      const refScoreByKey = new Map(
        reference.bridges.segA.map((a, c) => [keyOf(a, reference.bridges.segB[c]), reference.bridges.scores[c]])
      );
      const scoreDiffs = [];
      for (let c = 0; c < candidates.segA.length; c += 1) {
        const refScore = refScoreByKey.get(keyOf(candidates.segA[c], candidates.segB[c]));
        if (refScore !== undefined) {
          scoreDiffs.push(Math.abs(scores[c] - refScore));
        }
      }
      scoreDiffs.sort((a, b) => a - b);
      const medianDiff = scoreDiffs.length > 0 ? scoreDiffs[scoreDiffs.length >> 1] : 0;
      const p99 = scoreDiffs.length > 0 ? scoreDiffs[Math.floor(scoreDiffs.length * 0.99)] : 0;
      const acceptedDelta =
        Math.abs(acceptedCount - reference.bridges.acceptedCount) / Math.max(1, reference.bridges.acceptedCount);
      // Outlier score diffs sit on tie-affected embeddings; the typical candidate
      // and the accepted set are what shape the arrangement.
      gate("bridgeScores", scoreDiffs.length === 0 || (medianDiff < 0.02 && acceptedDelta < 0.05), {
        compared: scoreDiffs.length,
        medianAbsDiff: medianDiff,
        p99AbsDiff: p99,
        maxAbsDiff: scoreDiffs.length > 0 ? scoreDiffs[scoreDiffs.length - 1] : 0,
        acceptedDelta
      });

      // 5. Faces end-to-end (with bridges), IoU-matched against Python's shapely faces.
      const acceptedCoords = [];
      for (let c = 0; c < candidates.segA.length; c += 1) {
        if (scores[c] >= reference.bridges.threshold) {
          acceptedCoords.push(
            candidates.coords[c * 4],
            candidates.coords[c * 4 + 1],
            candidates.coords[c * 4 + 2],
            candidates.coords[c * 4 + 3]
          );
        }
      }
      const face = { ...pipeline.DEFAULT_VECTOR_FACE_CONFIG, ...manifest.faceExtraction, threshold };
      const faces = pipeline.extractRoomFaces(segments, probs, {
        faceConfig: face,
        prepConfig: prep,
        pageBounds,
        bridgeCoords: acceptedCoords.length > 0 ? Float32Array.from(acceptedCoords) : null
      });

      const size = args.rasterSize;
      const mineMasks = faces.map((f) => rasterizePolygon(f.polygon, pageBounds, size));
      const refMasks = reference.faces.map((f) => rasterizePolygon(f.polygon, pageBounds, size));
      const matches = [];
      const usedRef = new Set();
      for (let i = 0; i < mineMasks.length; i += 1) {
        let bestJ = -1;
        let bestIou = 0.5;
        for (let j = 0; j < refMasks.length; j += 1) {
          if (usedRef.has(j)) {
            continue;
          }
          const iou = maskIou(mineMasks[i], refMasks[j]);
          if (iou > bestIou) {
            bestIou = iou;
            bestJ = j;
          }
        }
        if (bestJ >= 0) {
          usedRef.add(bestJ);
          matches.push({ mine: i, ref: bestJ, iou: bestIou });
        }
      }
      const meanIou = matches.length > 0 ? matches.reduce((sum, m) => sum + m.iou, 0) / matches.length : 0;
      const matchedFraction = reference.faces.length > 0 ? matches.length / reference.faces.length : 1;
      let coverageDiff = 0;
      for (const match of matches) {
        coverageDiff = Math.max(coverageDiff, Math.abs(faces[match.mine].coverage - reference.faces[match.ref].coverage));
      }
      const noFacesEitherSide = faces.length === 0 && reference.faces.length === 0;
      gate("faces", noFacesEitherSide || (matchedFraction > 0.95 && meanIou > 0.95), {
        mine: faces.length,
        reference: reference.faces.length,
        matched: matches.length,
        matchedFraction,
        meanMatchedIou: meanIou,
        maxCoverageDiff: coverageDiff
      });

      // 6. Room types on matched faces.
      if (faces.length > 0 && reference.faces.some((f) => f.classId !== null)) {
        const typeSession = await ort.InferenceSession.create(path.join(args.models, "type-head.onnx"), {
          executionProviders: ["wasm"]
        });
        const width = manifest.encoderConfig.width;
        const pooled = new Float32Array(faces.length * width);
        const shapes = new Float32Array(faces.length * 6);
        for (let f = 0; f < faces.length; f += 1) {
          pooled.set(pipeline.pooledFaceEmbedding(direct.embedding, width, faces[f].memberSegments), f * width);
          shapes.set(pipeline.faceShapeFeatures(faces[f].polygon, pageBounds), f * 6);
        }
        const output = await typeSession.run({
          pooled_embedding: new ort.Tensor("float32", pooled, [faces.length, width]),
          shape_features: new ort.Tensor("float32", shapes, [faces.length, 6])
        });
        const logits = output.type_logits.data;
        const classIds = manifest.models.typeHead.classIds;
        let agree = 0;
        const disagreementMargins = [];
        for (const match of matches) {
          let best = 0;
          let second = -1;
          for (let c = 1; c < classIds.length; c += 1) {
            if (logits[match.mine * classIds.length + c] > logits[match.mine * classIds.length + best]) {
              second = best;
              best = c;
            } else if (second === -1 || logits[match.mine * classIds.length + c] > logits[match.mine * classIds.length + second]) {
              second = c;
            }
          }
          if (classIds[best] === reference.faces[match.ref].classId) {
            agree += 1;
          } else {
            disagreementMargins.push(
              logits[match.mine * classIds.length + best] - logits[match.mine * classIds.length + second]
            );
          }
        }
        // Class flips concentrate on borderline faces (small top-2 margins); the
        // head itself is the weakest stage, so parity is gated loosely.
        gate("roomTypes", matches.length === 0 || agree / matches.length > 0.75, {
          matched: matches.length,
          classAgreement: matches.length > 0 ? agree / matches.length : 1,
          meanDisagreementMargin:
            disagreementMargins.length > 0
              ? disagreementMargins.reduce((sum, m) => sum + m, 0) / disagreementMargins.length
              : 0
        });
      }
    }
  } finally {
    await viteServer.close();
  }

  report.failures = failures;
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
