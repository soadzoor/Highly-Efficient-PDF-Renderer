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

const MAX_UINT32 = 0xffffffff;

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
  requireIndex(clipPaths.length, MAX_UINT32, "clip path", "path count");
  const writer = new ByteWriter(clipPaths.length * 8 + 64);
  writer.writeVarUint32(clipPaths.length);
  let totalEdges = 0;
  for (const clip of clipPaths) {
    if (clip.edges.length % 4 !== 0) fail("clip path", "an edge list is not a whole number of edges");
    const edgeCount = requireIndex(clip.edges.length / 4, MAX_UINT32, "clip path", "edge count");
    // Every edge needs at least one byte in each u32-sized coordinate column.
    totalEdges = requireIndex(totalEdges + edgeCount, MAX_UINT32, "clip path", "column length");
    writer.writeZigzagVarint(clip.parent);
    writer.writeByte(clip.fillRule);
    writer.writeVarUint32(edgeCount);
  }
  const edges = new Float32Array(totalEdges * 4);
  let offset = 0;
  for (const clip of clipPaths) {
    edges.set(clip.edges, offset);
    offset += clip.edges.length;
  }
  const columns = [0, 1, 2, 3].map(channel => encodeFixed512DeltaColumn(edges, totalEdges, 4, channel));
  for (const column of columns) {
    writer.writeVarUint32(requireIndex(column.length, MAX_UINT32, "clip path", "column length"));
  }
  for (const column of columns) writer.writeBytes(column);
  return writer.toUint8Array();
}

export function decodeSceneClipPaths(bytes: Uint8Array): VectorClipPath[] {
  const cursor = new VarintCursor(bytes);
  const pathCount = cursor.readVarUint32();
  // A record needs at least three bytes, followed by four column lengths.
  // Check the payload before allocating arrays from untrusted counts.
  if (pathCount * 3 + 4 > bytes.length - cursor.byteOffset) fail("clip path", "path records are truncated");
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
    totalEdges = requireIndex(totalEdges + edgeCounts[index], MAX_UINT32, "clip path", "column length");
    if (parents[index] < -1 || parents[index] >= index) fail("clip path", "parent must reference an earlier path");
  }
  const lengths = [0, 1, 2, 3].map(() => cursor.readVarUint32());
  const columnStart = cursor.byteOffset;
  const declared = lengths.reduce((sum, value) => sum + value, 0);
  if (columnStart + declared !== bytes.length) fail("clip path", "column lengths do not fill the section");
  if (lengths.some(length => length < totalEdges)) fail("clip path", "coordinate columns are truncated");
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
  requireIndex(drawRuns.length, MAX_UINT32, "draw run", "run count");
  const writer = new ByteWriter(drawRuns.length * 4 + 16);
  writer.writeVarUint32(drawRuns.length);
  const previousFirst = new Float64Array(DRAW_RUN_KINDS.length);
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

export function decodeSceneDrawRuns(bytes: Uint8Array, grouped = false): VectorDrawRun[] {
  if (grouped) return decodeGroupedSceneDrawRuns(bytes);
  const cursor = new VarintCursor(bytes);
  const runCount = cursor.readVarUint32();
  if (runCount * 3 > bytes.length - cursor.byteOffset) fail("draw run", "run records are truncated");
  const previousFirst = new Float64Array(DRAW_RUN_KINDS.length);
  let previousClip = 0;
  const drawRuns: VectorDrawRun[] = [];
  for (let index = 0; index < runCount; index += 1) {
    const flags = cursor.readByte("draw run flags");
    if (flags & 0xc0) fail("draw run", "unsupported flag bits");
    const kind = DRAW_RUN_KINDS[flags & 7];
    if (!kind) fail("draw run", "unknown kind");
    const first = previousFirst[flags & 7] + cursor.readZigzagVarint();
    requireIndex(first, MAX_UINT32, "draw run", "first");
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

/** Repeated transparency wrappers often have consecutive paints with the same state. */
export function encodeSceneDrawRunsForStorage(drawRuns: readonly VectorDrawRun[]): {
  bytes: Uint8Array; groupedRuns: boolean
} {
  const legacy = encodeSceneDrawRuns(drawRuns);
  const groups: Array<{ first: number; count: number }> = [];
  for (let first = 0; first < drawRuns.length;) {
    const run = drawRuns[first];
    let end = first + 1;
    while (end < drawRuns.length) {
      const next = drawRuns[end], previous = drawRuns[end - 1];
      if (next.kind !== run.kind || next.clipIndex !== run.clipIndex ||
          next.optionalContent !== run.optionalContent || next.blendMode !== run.blendMode ||
          next.first !== previous.first + previous.count) break;
      end++;
    }
    groups.push({ first, count: end - first });
    first = end;
  }
  const writer = new ByteWriter(drawRuns.length + groups.length * 4 + 16);
  writer.writeVarUint32(drawRuns.length);
  writer.writeVarUint32(groups.length);
  const previousEnd = new Float64Array(DRAW_RUN_KINDS.length);
  let previousClip = 0;
  for (const group of groups) {
    const run = drawRuns[group.first], kind = DRAW_RUN_KINDS.indexOf(run.kind);
    const hasClip = run.clipIndex !== undefined, hasCondition = run.optionalContent !== undefined;
    const implicit = run.first === previousEnd[kind];
    writer.writeByte(kind | (hasClip ? 8 : 0) | (hasCondition ? 16 : 0) |
      (run.blendMode === "Multiply" ? 32 : 0) | (implicit ? 64 : 0));
    writer.writeVarUint32(group.count);
    if (!implicit) writer.writeVarUint32(requireIndex(run.first, MAX_UINT32, "draw run", "first"));
    if (hasClip) {
      writer.writeZigzagVarint(run.clipIndex! - previousClip);
      previousClip = run.clipIndex!;
    }
    if (hasCondition) writer.writeVarUint32(run.optionalContent!);
    for (let index = group.first; index < group.first + group.count; index++) {
      writer.writeVarUint32(requireIndex(drawRuns[index].count, MAX_UINT32, "draw run", "count"));
    }
    const last = drawRuns[group.first + group.count - 1];
    previousEnd[kind] = last.first + last.count;
  }
  const bytes = writer.toUint8Array();
  return bytes.length < legacy.length ? { bytes, groupedRuns: true } : { bytes: legacy, groupedRuns: false };
}

/** Shared state plus one count per canonical run; no paint is merged or reordered. */
function decodeGroupedSceneDrawRuns(bytes: Uint8Array): VectorDrawRun[] {
  const cursor = new VarintCursor(bytes);
  const runCount = cursor.readVarUint32(), groupCount = cursor.readVarUint32();
  if (groupCount > runCount || runCount + groupCount * 2 > bytes.length - cursor.byteOffset) {
    fail("draw run", "grouped run records are truncated");
  }
  const previousEnd = new Float64Array(DRAW_RUN_KINDS.length);
  let previousClip = 0;
  const drawRuns: VectorDrawRun[] = [];
  for (let group = 0; group < groupCount; group++) {
    const flags = cursor.readByte("grouped draw run flags"), kind = DRAW_RUN_KINDS[flags & 7];
    if (flags & 128) fail("draw run", "unsupported grouped flag bits");
    if (!kind) fail("draw run", "unknown kind");
    const count = cursor.readVarUint32();
    if (count === 0 || count > runCount - drawRuns.length) fail("draw run", "invalid group length");
    let first = flags & 64 ? previousEnd[flags & 7] : cursor.readVarUint32();
    let clipIndex: number | undefined;
    if (flags & 8) {
      previousClip += cursor.readZigzagVarint();
      clipIndex = requireIndex(previousClip, MAX_UINT32, "draw run", "clip index");
    }
    const optionalContent = flags & 16 ? cursor.readVarUint32() : undefined;
    if (count > bytes.length - cursor.byteOffset) fail("draw run", "group counts are truncated");
    for (let index = 0; index < count; index++) {
      requireIndex(first, MAX_UINT32, "draw run", "first");
      const run: VectorDrawRun = { kind, first, count: cursor.readVarUint32() };
      if (clipIndex !== undefined) run.clipIndex = clipIndex;
      if (optionalContent !== undefined) run.optionalContent = optionalContent;
      if (flags & 32) run.blendMode = "Multiply";
      drawRuns.push(run);
      first += run.count;
      if (first > MAX_UINT32 + 1) fail("draw run", "range end is out of range");
    }
    previousEnd[flags & 7] = first;
  }
  if (drawRuns.length !== runCount) fail("draw run", "group counts do not match run count");
  cursor.expectEnd(SCENE_DRAW_RUNS_PATH);
  return drawRuns;
}

/* ------------------------------------------------------------- paint graph */

/**
 * A pre-order walk. Each node opens with a header byte: kind in bits 0-1, a
 * visibility-condition bit, then kind-specific flags. Draw leaves carry only a
 * delta-coded run index, which is the overwhelming majority of the graph;
 * groups retain alpha and bounds as float64 and mask transfer samples as
 * float32 because these values are not page coordinates.
 */
export function encodeScenePaintGraph(graph: ScenePaintGraph): Uint8Array {
  return encodePaintGraph(graph).bytes;
}

/**
 * Losslessly compress consecutive singleton group wrappers. The group state
 * is shared on disk only; readers restore each original group and draw node,
 * keeping their boundaries available when appearances or visibility change.
 */
export function encodeScenePaintGraphForStorage(graph: ScenePaintGraph, drawRunCount: number): {
  bytes: Uint8Array; repeatedGroups: boolean;
} {
  requireIndex(drawRunCount, MAX_UINT32, "paint graph", "source draw run count");
  return encodePaintGraph(graph, drawRunCount);
}

type PaintGroup = Extract<ScenePaintNode, { kind: "group" }>;

function samePaintGroupState(first: PaintGroup, second: PaintGroup): boolean {
  if (!Object.is(first.alpha, second.alpha) || first.isolated !== second.isolated ||
      first.knockout !== second.knockout || first.blendMode !== second.blendMode ||
      first.optionalContent !== second.optionalContent || first.alphaIsShape !== second.alphaIsShape ||
      !!first.bounds !== !!second.bounds) return false;
  return !first.bounds || !!second.bounds &&
    Object.is(first.bounds.minX, second.bounds.minX) && Object.is(first.bounds.minY, second.bounds.minY) &&
    Object.is(first.bounds.maxX, second.bounds.maxX) && Object.is(first.bounds.maxY, second.bounds.maxY);
}

function encodePaintGraph(graph: ScenePaintGraph, drawRunCount?: number): {
  bytes: Uint8Array; repeatedGroups: boolean;
} {
  const writer = new ByteWriter(4096);
  const activeLists = new Set<readonly ScenePaintNode[]>();
  let previousRunIndex = 0;
  let repeatedRunCount = 0;
  let repeatedGroups = false;
  const writeBounds = (bounds: Bounds): void => {
    writer.writeFloat64(bounds.minX); writer.writeFloat64(bounds.minY);
    writer.writeFloat64(bounds.maxX); writer.writeFloat64(bounds.maxY);
  };
  const writeMask = (mask: ScenePaintMask): void => {
    const transfer = mask.transfer;
    if (transfer) requireIndex(transfer.length, MAX_UINT32, "paint graph", "mask transfer length");
    writer.writeByte((mask.subtype === "Luminosity" ? 1 : 0) | (transfer ? 2 : 0) | (mask.backdrop ? 4 : 0));
    if (transfer) {
      // A transfer curve is already a Float32Array, so float32 is exact here
      // and halves what is otherwise the largest part of a masked group.
      writer.writeVarUint32(transfer.length);
      for (const sample of transfer) writer.writeFloat32(sample);
    }
    if (mask.backdrop) for (const channel of mask.backdrop) writer.writeFloat64(channel);
    writeList(mask.children);
  };
  const writeGroupState = (node: PaintGroup): void => {
    const hasCondition = node.optionalContent !== undefined;
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
    if (node.softMask) writeMask(node.softMask);
  };
  const repeatLength = (list: readonly ScenePaintNode[], index: number): number => {
    if (drawRunCount === undefined || drawRunCount - repeatedRunCount < 2) return 1;
    const node = list[index];
    if (node.kind !== "group" || node.softMask || node.children.length !== 1 ||
        node.children[0].kind !== "draw") return 1;
    const draw = node.children[0];
    if (!Number.isSafeInteger(draw.runIndex) || draw.runIndex < 0 || draw.runIndex >= drawRunCount) return 1;
    let count = 1;
    const available = Math.min(drawRunCount - repeatedRunCount, drawRunCount - draw.runIndex);
    while (count < available && index + count < list.length) {
      const next = list[index + count];
      if (next.kind !== "group" || next.softMask || next.children.length !== 1 ||
          next.children[0].kind !== "draw" || !samePaintGroupState(node, next) ||
          next.children[0].optionalContent !== draw.optionalContent ||
          next.children[0].runIndex !== draw.runIndex + count) break;
      count += 1;
    }
    return count;
  };
  const writeList = (list: readonly ScenePaintNode[]): void => {
    if (activeLists.has(list)) fail("paint graph", "cyclic node lists");
    activeLists.add(list);
    writer.writeVarUint32(requireIndex(list.length, MAX_UINT32, "paint graph", "node count"));
    for (let index = 0; index < list.length; index += 1) {
      const node = list[index];
      const repeatCount = repeatLength(list, index);
      if (repeatCount >= 2 && node.kind === "group" && node.children[0].kind === "draw") {
        writer.writeByte(3);
        writer.writeVarUint32(repeatCount);
        writeGroupState(node);
        const draw = node.children[0];
        writer.writeByte(PAINT_NODE_DRAW | (draw.optionalContent !== undefined ? 4 : 0));
        writer.writeZigzagVarint(draw.runIndex - previousRunIndex);
        if (draw.optionalContent !== undefined) writer.writeVarUint32(draw.optionalContent);
        previousRunIndex = draw.runIndex + repeatCount - 1;
        repeatedRunCount += repeatCount;
        repeatedGroups = true;
        index += repeatCount - 1;
        continue;
      }
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
        writeGroupState(node);
        writeList(node.children);
      }
    }
    activeLists.delete(list);
  };
  writeList(graph.roots);
  return { bytes: writer.toUint8Array(), repeatedGroups };
}

export function decodeScenePaintGraph(bytes: Uint8Array, drawRunCount?: number): ScenePaintGraph {
  if (drawRunCount !== undefined) requireIndex(drawRunCount, MAX_UINT32, "paint graph", "source draw run count");
  const cursor = new VarintCursor(bytes);
  let previousRunIndex = 0;
  let repeatedRunCount = 0;
  const readBounds = (): Bounds => ({
    minX: cursor.readFloat64("paint bounds"), minY: cursor.readFloat64("paint bounds"),
    maxX: cursor.readFloat64("paint bounds"), maxY: cursor.readFloat64("paint bounds")
  });
  const readMask = (): ScenePaintMask => {
    const flags = cursor.readByte("mask flags");
    if (flags & 0xf8) fail("paint graph", "unsupported mask flag bits");
    const mask: ScenePaintMask = { children: [], subtype: flags & 1 ? "Luminosity" : "Alpha" };
    if (flags & 2) {
      const length = cursor.readVarUint32();
      if (length * 4 > bytes.length - cursor.byteOffset) fail("paint graph", "mask transfer is truncated");
      const transfer = new Float32Array(length);
      for (let index = 0; index < length; index += 1) transfer[index] = cursor.readFloat32("mask transfer");
      mask.transfer = transfer;
    }
    if (flags & 4) {
      mask.backdrop = [cursor.readFloat64("mask backdrop"), cursor.readFloat64("mask backdrop"),
        cursor.readFloat64("mask backdrop")];
    }
    mask.children = readList();
    return mask;
  };
  const readGroupState = (header: number): PaintGroup => {
    const blendMode = PDF_BLEND_MODES[cursor.readByte("blend mode")];
    if (!blendMode) fail("paint graph", "unknown blend mode");
    const node: PaintGroup = {
      kind: "group", children: [], alpha: cursor.readFloat64("group alpha"), isolated: (header & 8) !== 0,
      knockout: (header & 16) !== 0, blendMode
    };
    if (header & 128) node.alphaIsShape = cursor.readByte("alpha is shape") !== 0;
    if (header & 4) node.optionalContent = cursor.readVarUint32();
    if (header & 32) node.bounds = readBounds();
    if (header & 64) node.softMask = readMask();
    return node;
  };
  const readList = (): ScenePaintNode[] => {
    const length = cursor.readVarUint32();
    // Literal nodes need at least two bytes each. A v13 repeat may account for
    // at most the remaining canonical draw runs without consuming those bytes.
    const literalMinimum = drawRunCount === undefined ? length : Math.max(0, length - (drawRunCount - repeatedRunCount));
    if (literalMinimum * 2 > bytes.length - cursor.byteOffset) fail("paint graph", "node records are truncated");
    const list: ScenePaintNode[] = [];
    for (let index = 0; index < length; index += 1) {
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
          retainedPage: cursor.readVarUint32(),
          firstCommand: cursor.readVarUint32(),
          count: cursor.readVarUint32(),
          rasterIndex: cursor.readVarUint32()
        };
        if (condition) node.optionalContent = condition();
        list.push(node);
      } else if (kind === PAINT_NODE_GROUP) {
        const node = readGroupState(header);
        node.children = readList();
        list.push(node);
      } else if (kind === 3 && drawRunCount !== undefined) {
        if (header !== 3) fail("paint graph", "unsupported repeated group flag bits");
        const repeatCount = cursor.readVarUint32();
        if (repeatCount < 2 || repeatCount > length - index || repeatCount > drawRunCount - repeatedRunCount) {
          fail("paint graph", "repeated group count exceeds its logical list or source draw runs");
        }
        const groupHeader = cursor.readByte("repeated group header");
        if ((groupHeader & 3) !== PAINT_NODE_GROUP || groupHeader & 64) {
          fail("paint graph", "repeated groups require an unmasked group state");
        }
        const group = readGroupState(groupHeader);
        const drawHeader = cursor.readByte("repeated draw header");
        if ((drawHeader & 3) !== PAINT_NODE_DRAW || drawHeader & 0xf8) {
          fail("paint graph", "invalid repeated draw flags");
        }
        const first = previousRunIndex + cursor.readZigzagVarint();
        if (first < 0 || first + repeatCount > drawRunCount) {
          fail("paint graph", "repeated groups reference unknown source draw runs");
        }
        const drawCondition = drawHeader & 4 ? cursor.readVarUint32() : undefined;
        if (cursor.byteOffset > bytes.length) fail("paint graph", "repeated draw data is truncated");
        repeatedRunCount += repeatCount;
        previousRunIndex = first + repeatCount - 1;
        for (let offset = 0; offset < repeatCount; offset += 1) {
          const draw: ScenePaintNode = { kind: "draw", runIndex: first + offset };
          if (drawCondition !== undefined) draw.optionalContent = drawCondition;
          const node: PaintGroup = { ...group, children: [draw] };
          if (group.bounds) node.bounds = { ...group.bounds };
          list.push(node);
        }
        index += repeatCount - 1;
      } else {
        fail("paint graph", "unknown node kind");
      }
    }
    return list;
  };
  const roots = readList();
  cursor.expectEnd(SCENE_PAINT_GRAPH_PATH);
  return { roots };
}
