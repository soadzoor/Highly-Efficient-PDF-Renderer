import type { HepArchive } from "./hepContainer";
import { ByteWriter, VarintCursor } from "./parsedDataVarint";
import type { VectorScene } from "./pdfVectorExtractor";
import {
  PRIMITIVE_KINDS,
  STRUCTURE_LIMITS,
  scenePrimitiveCount,
  validateSceneStructure,
  type SceneContentItemRanges
} from "./structureData";

export const HEP_STRUCTURE_PATH = "structure/structure.json";
export const HEP_CONTENT_RANGES_PATH = "structure/content-ranges.varint";
export const MAX_HEP_STRUCTURE_BYTES = 64 * 1024 * 1024;

export interface HepStructureDescriptor {
  file: string;
  rangesFile: string;
  version: 1;
  itemCount: number;
  elementCount: number;
  rangeCount: number;
}

/** Content items and elements as JSON; per-kind primitive ranges as a varint stream. */
export function writeHepStructure(archive: HepArchive, scene: VectorScene): HepStructureDescriptor | undefined {
  if (scene.markedContent === undefined && scene.structureElements === undefined) return undefined;
  validateSceneStructure(scene);
  const items = scene.markedContent?.items ?? [], elements = scene.structureElements ?? [];
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, items, elements }));
  if (bytes.length > MAX_HEP_STRUCTURE_BYTES) throw new Error("Structure metadata exceeds the HEP section limit.");
  archive.file(HEP_STRUCTURE_PATH, bytes);
  // Per kind, in PRIMITIVE_KINDS order: the range count, then each range's gap
  // from the previous range's end, its length and its item.
  const writer = new ByteWriter(4096);
  let rangeCount = 0;
  for (const kind of PRIMITIVE_KINDS) {
    const values = scene.markedContent?.ranges[kind] ?? new Uint32Array(0);
    writer.writeVarUint32(values.length / 3);
    let end = 0;
    for (let offset = 0; offset < values.length; offset += 3) {
      writer.writeVarUint32(values[offset] - end);
      writer.writeVarUint32(values[offset + 1]);
      writer.writeVarUint32(values[offset + 2]);
      end = values[offset] + values[offset + 1];
    }
    rangeCount += values.length / 3;
  }
  archive.file(HEP_CONTENT_RANGES_PATH, writer.toUint8Array());
  return { file: HEP_STRUCTURE_PATH, rangesFile: HEP_CONTENT_RANGES_PATH, version: 1,
    itemCount: items.length, elementCount: elements.length, rangeCount };
}

export async function readHepStructure(archive: HepArchive, descriptor: unknown, scene: VectorScene,
  signal?: AbortSignal): Promise<void> {
  if (descriptor === undefined) return;
  const meta = descriptor as Partial<Record<keyof HepStructureDescriptor, unknown>>;
  const count = (value: unknown, limit: number): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= limit;
  if (!meta || typeof meta !== "object" || meta.file !== HEP_STRUCTURE_PATH || meta.rangesFile !== HEP_CONTENT_RANGES_PATH ||
      meta.version !== 1 || !count(meta.itemCount, STRUCTURE_LIMITS.items) || !count(meta.elementCount, STRUCTURE_LIMITS.elements) ||
      !count(meta.rangeCount, STRUCTURE_LIMITS.ranges)) {
    throw new Error("Invalid HEP structure descriptor.");
  }
  const read = async (path: string): Promise<Uint8Array> => {
    signal?.throwIfAborted();
    const entry = archive.file(path);
    if (!entry) throw new Error("Missing HEP structure section.");
    const bytes = await entry.async("uint8array");
    if (bytes.length > MAX_HEP_STRUCTURE_BYTES) throw new Error("Structure metadata exceeds the HEP section limit.");
    signal?.throwIfAborted();
    return bytes;
  };
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await read(HEP_STRUCTURE_PATH)));
  if (!data || data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.elements) ||
      data.items.length !== meta.itemCount || data.elements.length !== meta.elementCount) {
    throw new Error("HEP structure does not match its manifest entry.");
  }
  const mismatch = (): never => { throw new Error("HEP structure ranges do not match the scene."); };
  const cursor = new VarintCursor(await read(HEP_CONTENT_RANGES_PATH));
  const ranges: SceneContentItemRanges = {};
  let total = 0;
  for (const kind of PRIMITIVE_KINDS) {
    const rangeCount = cursor.readVarUint32();
    if ((total += rangeCount) > meta.rangeCount) mismatch();
    if (rangeCount === 0) continue;
    const primitives = scenePrimitiveCount(scene, kind), values = new Uint32Array(rangeCount * 3);
    let end = 0;
    for (let range = 0; range < rangeCount; range++) {
      const first = end + cursor.readVarUint32(), length = cursor.readVarUint32(), item = cursor.readVarUint32();
      // Checked before storing, so an oversized value cannot wrap into range.
      if (first + length > primitives || item >= data.items.length) mismatch();
      values.set([first, length, item], range * 3);
      end = first + length;
    }
    ranges[kind] = values;
  }
  cursor.expectEnd(HEP_CONTENT_RANGES_PATH);
  if (total !== meta.rangeCount) mismatch();
  // Structure validation must preserve packed scans' lazy RGBA compatibility getters.
  const candidate = Object.assign(Object.defineProperties({}, Object.getOwnPropertyDescriptors(scene)), {
    markedContent: data.items.length || total ? { items: data.items, ranges } : undefined,
    structureElements: data.elements.length ? data.elements : undefined }) as VectorScene;
  validateSceneStructure(candidate);
  if (candidate.markedContent) scene.markedContent = candidate.markedContent;
  if (candidate.structureElements) scene.structureElements = candidate.structureElements;
}
