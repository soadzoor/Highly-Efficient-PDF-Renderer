/**
 * Binary HEP sections for the three scene structures that dominate a
 * clip-heavy document's `manifest.json`.
 *
 * Scene schema v7 wrote `clipPaths`, `drawRuns` and `paintGraph` as JSON inside
 * the manifest. Their shapes are repetitive enough that deflate handles the
 * records well, but clip edges are unique decimal coordinates that it cannot
 * compress: on a 15-page brochure they alone were 1.50 MB of JSON, 0.22 MB
 * stored, 84% of the manifest. v8 moves all three into their own sections and
 * stores coordinates on the same 1/512 fixed-point grid already used for text
 * instance origins, which is ~1/430,000 of a page and far below one device
 * pixel.
 *
 * Every integer here is an unsigned LEB128 varint unless it is called zigzag,
 * in which case it is the signed mapping from `parsedDataVarint`. Floats are
 * little-endian and appear only where a fixed-point grid would round a value
 * that is not a page coordinate: float64 for the plain numbers a scene holds
 * at full precision (group alpha, bounds, mask backdrop) and float32 for mask
 * transfer samples, which are already a Float32Array.
 */

import {
  ByteWriter,
  VarintCursor,
  decodeFixed512DeltaColumnInto,
  encodeFixed512DeltaColumn
} from "./parsedDataVarint";
import { PDF_BLEND_MODES } from "./scenePaintGraph";
import type { ScenePaintGraph, ScenePaintMask, ScenePaintNode } from "./scenePaintGraph";
import type { Bounds, VectorClipPath, VectorDrawRun } from "./pdfVectorExtractor";

export const SCENE_CLIP_PATHS_PATH = "geometry/clip-paths.d512";
export const SCENE_DRAW_RUNS_PATH = "geometry/draw-runs.varint";
export const SCENE_PAINT_GRAPH_PATH = "geometry/paint-graph.varint";

/** Shared with the paint graph and the scene validators. */
const MAX_NODES = 1_000_000;
const MAX_CLIP_PATHS = 1_000_000;
const MAX_CLIP_EDGES = 50_000_000;
const MAX_DEPTH = 64;
const MAX_TRANSFER_SAMPLES = 65_536;

/** Index order is the wire format; never reorder, only append. */
const DRAW_RUN_KINDS: readonly VectorDrawRun["kind"][] = [
  "fill", "stroke", "text", "raster", "gradient-fill", "gradient-stroke"
];

const PAINT_NODE_DRAW = 0;
const PAINT_NODE_GROUP = 1;
const PAINT_NODE_RETAINED = 2;

function fail(section: string, message: string): never {
  throw new Error(`Invalid HEP ${section} section: ${message}.`);
}

function requireIndex(value: unknown, limit: number, section: string, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > limit) {
    fail(section, `${label} is out of range`);
  }
  return value;
}

/* -------------------------------------------------------------- clip paths */

/**
 * `varint pathCount`, then per path `zigzag parent`, `byte fillRule` and
 * `varint edgeCount`; then four `varint` column byte lengths followed by the
 * columns themselves. Each column holds one component of every `[x0, y0, x1,
 * y1]` edge across all paths, delta-coded against the previous edge in the
 * same column, so a rectangular clip costs a handful of bytes.
 */
export function encodeSceneClipPaths(clipPaths: readonly VectorClipPath[]): Uint8Array {
  if (clipPaths.length > MAX_CLIP_PATHS) fail("clip path", "too many clip paths");
  const writer = new ByteWriter(clipPaths.length * 8 + 64);
  writer.writeVarUint32(clipPaths.length);
  let totalEdges = 0;
  for (const clip of clipPaths) {
    if (clip.edges.length % 4 !== 0) fail("clip path", "an edge list is not a whole number of edges");
    totalEdges += clip.edges.length / 4;
    if (totalEdges > MAX_CLIP_EDGES) fail("clip path", "too many clip edges");
    writer.writeZigzagVarint(clip.parent);
    writer.writeByte(clip.fillRule);
    writer.writeVarUint32(clip.edges.length / 4);
  }
  const edges = new Float32Array(totalEdges * 4);
  let offset = 0;
  for (const clip of clipPaths) {
    edges.set(clip.edges, offset);
    offset += clip.edges.length;
  }
  const columns = [0, 1, 2, 3].map(channel => encodeFixed512DeltaColumn(edges, totalEdges, 4, channel));
  for (const column of columns) writer.writeVarUint32(column.length);
  for (const column of columns) writer.writeBytes(column);
  return writer.toUint8Array();
}

export function decodeSceneClipPaths(bytes: Uint8Array): VectorClipPath[] {
  const cursor = new VarintCursor(bytes);
  const pathCount = cursor.readVarUint32();
  if (pathCount > MAX_CLIP_PATHS) fail("clip path", "too many clip paths");
  const parents = new Int32Array(pathCount);
  const fillRules = new Uint8Array(pathCount);
  const edgeCounts = new Uint32Array(pathCount);
  let totalEdges = 0;
  for (let index = 0; index < pathCount; index += 1) {
    parents[index] = cursor.readZigzagVarint();
    const fillRule = cursor.readByte("clip fill rule");
    if (fillRule > 1) fail("clip path", "fill rule must be zero or one");
    fillRules[index] = fillRule;
    edgeCounts[index] = cursor.readVarUint32();
    totalEdges += edgeCounts[index];
    if (totalEdges > MAX_CLIP_EDGES) fail("clip path", "too many clip edges");
    if (parents[index] < -1 || parents[index] >= index) fail("clip path", "parent must reference an earlier path");
  }
  const lengths = [0, 1, 2, 3].map(() => cursor.readVarUint32());
  const columnStart = cursor.byteOffset;
  const declared = lengths.reduce((sum, value) => sum + value, 0);
  if (columnStart + declared !== bytes.length) fail("clip path", "column lengths do not fill the section");
  const edges = new Float32Array(totalEdges * 4);
  let offset = columnStart;
  for (let channel = 0; channel < 4; channel += 1) {
    decodeFixed512DeltaColumnInto(bytes, offset, offset + lengths[channel], edges, totalEdges, 4, channel);
    offset += lengths[channel];
  }
  const clipPaths: VectorClipPath[] = [];
  let edgeOffset = 0;
  for (let index = 0; index < pathCount; index += 1) {
    const floats = edgeCounts[index] * 4;
    clipPaths.push({
      parent: parents[index],
      fillRule: fillRules[index] as 0 | 1,
      edges: edges.slice(edgeOffset, edgeOffset + floats)
    });
    edgeOffset += floats;
  }
  return clipPaths;
}

/* --------------------------------------------------------------- draw runs */

/**
 * `varint runCount`, then one record each: a flags byte holding the kind in
 * bits 0-2 and presence bits for a clip, a visibility condition and Multiply
 * blending, then `zigzag first` delta-coded per kind, `varint count`, and the
 * optional fields. Runs are consecutive ranges within their kind, so the
 * per-kind delta is usually the previous run's length.
 */
export function encodeSceneDrawRuns(drawRuns: readonly VectorDrawRun[]): Uint8Array {
  if (drawRuns.length > MAX_NODES) fail("draw run", "too many draw runs");
  const writer = new ByteWriter(drawRuns.length * 4 + 16);
  writer.writeVarUint32(drawRuns.length);
  const previousFirst = new Int32Array(DRAW_RUN_KINDS.length);
  let previousClip = 0;
  for (const run of drawRuns) {
    const kind = DRAW_RUN_KINDS.indexOf(run.kind);
    if (kind < 0) fail("draw run", `unknown kind ${String(run.kind)}`);
    const hasClip = run.clipIndex !== undefined;
    const hasCondition = run.optionalContent !== undefined;
    writer.writeByte(kind | (hasClip ? 8 : 0) | (hasCondition ? 16 : 0) | (run.blendMode === "Multiply" ? 32 : 0));
    writer.writeZigzagVarint(run.first - previousFirst[kind]);
    previousFirst[kind] = run.first;
    writer.writeVarUint32(run.count);
    if (hasClip) {
      writer.writeZigzagVarint(run.clipIndex! - previousClip);
      previousClip = run.clipIndex!;
    }
    if (hasCondition) writer.writeVarUint32(run.optionalContent!);
  }
  return writer.toUint8Array();
}

export function decodeSceneDrawRuns(bytes: Uint8Array): VectorDrawRun[] {
  const cursor = new VarintCursor(bytes);
  const runCount = cursor.readVarUint32();
  if (runCount > MAX_NODES) fail("draw run", "too many draw runs");
  const previousFirst = new Int32Array(DRAW_RUN_KINDS.length);
  let previousClip = 0;
  const drawRuns: VectorDrawRun[] = [];
  for (let index = 0; index < runCount; index += 1) {
    const flags = cursor.readByte("draw run flags");
    if (flags & 0xc0) fail("draw run", "unsupported flag bits");
    const kind = DRAW_RUN_KINDS[flags & 7];
    if (!kind) fail("draw run", "unknown kind");
    const first = previousFirst[flags & 7] + cursor.readZigzagVarint();
    if (first < 0) fail("draw run", "first is negative");
    previousFirst[flags & 7] = first;
    const run: VectorDrawRun = { kind, first, count: cursor.readVarUint32() };
    if (flags & 8) {
      previousClip += cursor.readZigzagVarint();
      if (previousClip < 0) fail("draw run", "clip index is negative");
      run.clipIndex = previousClip;
    }
    if (flags & 16) run.optionalContent = cursor.readVarUint32();
    if (flags & 32) run.blendMode = "Multiply";
    drawRuns.push(run);
  }
  cursor.expectEnd(SCENE_DRAW_RUNS_PATH);
  return drawRuns;
}

/* ------------------------------------------------------------- paint graph */

/**
 * A pre-order walk. Each node opens with a header byte: kind in bits 0-1, a
 * visibility-condition bit, then kind-specific flags. Draw leaves carry only a
 * delta-coded run index, which is the overwhelming majority of the graph;
 * groups spell out their compositing state in float32 because alpha, bounds
 * and transfer samples are not page coordinates.
 */
export function encodeScenePaintGraph(graph: ScenePaintGraph): Uint8Array {
  const writer = new ByteWriter(4096);
  let nodes = 0;
  let previousRunIndex = 0;
  const writeBounds = (bounds: Bounds): void => {
    writer.writeFloat64(bounds.minX); writer.writeFloat64(bounds.minY);
    writer.writeFloat64(bounds.maxX); writer.writeFloat64(bounds.maxY);
  };
  const writeMask = (mask: ScenePaintMask, depth: number): void => {
    const transfer = mask.transfer;
    if (transfer && transfer.length > MAX_TRANSFER_SAMPLES) fail("paint graph", "mask transfer is too large");
    writer.writeByte((mask.subtype === "Luminosity" ? 1 : 0) | (transfer ? 2 : 0) | (mask.backdrop ? 4 : 0));
    if (transfer) {
      // A transfer curve is already a Float32Array, so float32 is exact here
      // and halves what is otherwise the largest part of a masked group.
      writer.writeVarUint32(transfer.length);
      for (const sample of transfer) writer.writeFloat32(sample);
    }
    if (mask.backdrop) for (const channel of mask.backdrop) writer.writeFloat64(channel);
    writeList(mask.children, depth + 1);
  };
  const writeList = (list: readonly ScenePaintNode[], depth: number): void => {
    if (depth > MAX_DEPTH) fail("paint graph", "nesting is too deep");
    writer.writeVarUint32(list.length);
    for (const node of list) {
      if (++nodes > MAX_NODES) fail("paint graph", "too many nodes");
      const hasCondition = node.optionalContent !== undefined;
      if (node.kind === "draw") {
        writer.writeByte(PAINT_NODE_DRAW | (hasCondition ? 4 : 0));
        writer.writeZigzagVarint(node.runIndex - previousRunIndex);
        previousRunIndex = node.runIndex;
        if (hasCondition) writer.writeVarUint32(node.optionalContent!);
      } else if (node.kind === "retained") {
        writer.writeByte(PAINT_NODE_RETAINED | (hasCondition ? 4 : 0));
        writer.writeVarUint32(node.retainedPage);
        writer.writeVarUint32(node.firstCommand);
        writer.writeVarUint32(node.count);
        writer.writeVarUint32(node.rasterIndex);
        if (hasCondition) writer.writeVarUint32(node.optionalContent!);
      } else {
        const blendMode = PDF_BLEND_MODES.indexOf(node.blendMode);
        if (blendMode < 0) fail("paint graph", `unknown blend mode ${String(node.blendMode)}`);
        writer.writeByte(PAINT_NODE_GROUP | (hasCondition ? 4 : 0) | (node.isolated ? 8 : 0) |
          (node.knockout ? 16 : 0) | (node.bounds ? 32 : 0) | (node.softMask ? 64 : 0) |
          (node.alphaIsShape !== undefined ? 128 : 0));
        writer.writeByte(blendMode);
        writer.writeFloat64(node.alpha);
        if (node.alphaIsShape !== undefined) writer.writeByte(node.alphaIsShape ? 1 : 0);
        if (hasCondition) writer.writeVarUint32(node.optionalContent!);
        if (node.bounds) writeBounds(node.bounds);
        if (node.softMask) writeMask(node.softMask, depth);
        writeList(node.children, depth + 1);
      }
    }
  };
  writeList(graph.roots, 0);
  return writer.toUint8Array();
}

export function decodeScenePaintGraph(bytes: Uint8Array): ScenePaintGraph {
  const cursor = new VarintCursor(bytes);
  let nodes = 0;
  let previousRunIndex = 0;
  const readBounds = (): Bounds => ({
    minX: cursor.readFloat64("paint bounds"), minY: cursor.readFloat64("paint bounds"),
    maxX: cursor.readFloat64("paint bounds"), maxY: cursor.readFloat64("paint bounds")
  });
  const readMask = (depth: number): ScenePaintMask => {
    const flags = cursor.readByte("mask flags");
    if (flags & 0xf8) fail("paint graph", "unsupported mask flag bits");
    const mask: ScenePaintMask = { children: [], subtype: flags & 1 ? "Luminosity" : "Alpha" };
    if (flags & 2) {
      const length = cursor.readVarUint32();
      if (length > MAX_TRANSFER_SAMPLES) fail("paint graph", "mask transfer is too large");
      const transfer = new Float32Array(length);
      for (let index = 0; index < length; index += 1) transfer[index] = cursor.readFloat32("mask transfer");
      mask.transfer = transfer;
    }
    if (flags & 4) {
      mask.backdrop = [cursor.readFloat64("mask backdrop"), cursor.readFloat64("mask backdrop"),
        cursor.readFloat64("mask backdrop")];
    }
    mask.children = readList(depth + 1);
    return mask;
  };
  const readList = (depth: number): ScenePaintNode[] => {
    if (depth > MAX_DEPTH) fail("paint graph", "nesting is too deep");
    const length = cursor.readVarUint32();
    if (length > MAX_NODES) fail("paint graph", "too many nodes");
    const list: ScenePaintNode[] = [];
    for (let index = 0; index < length; index += 1) {
      if (++nodes > MAX_NODES) fail("paint graph", "too many nodes");
      const header = cursor.readByte("paint node header");
      const kind = header & 3;
      const condition = header & 4 ? cursor.readVarUint32.bind(cursor) : null;
      if (kind === PAINT_NODE_DRAW) {
        if (header & 0xf8) fail("paint graph", "unsupported draw flag bits");
        previousRunIndex += cursor.readZigzagVarint();
        if (previousRunIndex < 0) fail("paint graph", "run index is negative");
        const node: ScenePaintNode = { kind: "draw", runIndex: previousRunIndex };
        if (condition) node.optionalContent = condition();
        list.push(node);
      } else if (kind === PAINT_NODE_RETAINED) {
        if (header & 0xf8) fail("paint graph", "unsupported retained flag bits");
        const node: ScenePaintNode = {
          kind: "retained",
          retainedPage: requireIndex(cursor.readVarUint32(), MAX_NODES, "paint graph", "retained page"),
          firstCommand: cursor.readVarUint32(),
          count: cursor.readVarUint32(),
          rasterIndex: cursor.readVarUint32()
        };
        if (condition) node.optionalContent = condition();
        list.push(node);
      } else if (kind === PAINT_NODE_GROUP) {
        const blendMode = PDF_BLEND_MODES[cursor.readByte("blend mode")];
        if (!blendMode) fail("paint graph", "unknown blend mode");
        const alpha = cursor.readFloat64("group alpha");
        const node: ScenePaintNode = {
          kind: "group", children: [], alpha, isolated: (header & 8) !== 0,
          knockout: (header & 16) !== 0, blendMode
        };
        if (header & 128) node.alphaIsShape = cursor.readByte("alpha is shape") !== 0;
        if (condition) node.optionalContent = condition();
        if (header & 32) node.bounds = readBounds();
        if (header & 64) node.softMask = readMask(depth);
        node.children = readList(depth + 1);
        list.push(node);
      } else {
        fail("paint graph", "unknown node kind");
      }
    }
    return list;
  };
  const roots = readList(0);
  cursor.expectEnd(SCENE_PAINT_GRAPH_PATH);
  return { roots };
}
