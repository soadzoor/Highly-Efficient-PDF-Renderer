import type { HepArchive } from "./hepContainer";

export interface GradientMeshArrays {
  gradientMeshRanges?: Uint32Array;
  gradientMeshPositions?: Float32Array;
  gradientMeshColors?: Float32Array;
  gradientMeshIndices?: Uint32Array;
}
interface GradientMeshScene extends GradientMeshArrays { gradientCount: number; gradientMetaA: Float32Array }
interface MeshManifest { rangesFile: string; positionsFile: string; colorsFile: string; indicesFile: string; vertexCount: number; indexCount: number }
const MAX_UINT32 = 0xffffffff;
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function validateGradientMesh(scene: GradientMeshScene): void {
  const { gradientMeshRanges: ranges, gradientMeshPositions: positions, gradientMeshColors: colors, gradientMeshIndices: indices } = scene;
  const present = [ranges, positions, colors, indices].filter(value => value !== undefined).length;
  if (present === 0) {
    for (let index = 0; index < scene.gradientCount; index++) if (scene.gradientMetaA[index * 4] === 2) throw new Error("Missing gradient mesh resources.");
    return;
  }
  if (!(ranges instanceof Uint32Array) || !(positions instanceof Float32Array) || !(colors instanceof Float32Array) || !(indices instanceof Uint32Array) ||
      ranges.length !== scene.gradientCount * 2 || positions.length % 2 || colors.length !== positions.length * 2 || indices.length % 3 ||
      positions.byteLength > MAX_UINT32 || colors.byteLength > MAX_UINT32 || indices.byteLength > MAX_UINT32 || !positions.every(Number.isFinite) ||
      !colors.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Invalid gradient mesh resources.");
  const vertices = positions.length / 2;
  if (indices.some(index => index >= vertices)) throw new Error("Gradient mesh references an unknown vertex.");
  for (let index = 0; index < scene.gradientCount; index++) {
    const first = ranges[index * 2], count = ranges[index * 2 + 1];
    if (first % 3 || count % 3 || first > indices.length || count > indices.length - first ||
        (scene.gradientMetaA[index * 4] === 2 ? count === 0 : count !== 0)) throw new Error("Invalid gradient mesh range.");
  }
}

export function writeHepGradientMesh(archive: HepArchive, scene: GradientMeshScene): MeshManifest | undefined {
  validateGradientMesh(scene);
  if (!scene.gradientMeshRanges) return undefined;
  const manifest: MeshManifest = { rangesFile: "mesh/gradient-ranges.u32", positionsFile: "mesh/gradient-positions.f32",
    colorsFile: "mesh/gradient-colors.f32", indicesFile: "mesh/gradient-indices.u32",
    vertexCount: scene.gradientMeshPositions!.length / 2, indexCount: scene.gradientMeshIndices!.length };
  const write = (file: string, values: Uint32Array | Float32Array): void => {
    if (littleEndian) archive.file(file, new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    else {
      const bytes = new Uint8Array(values.byteLength), view = new DataView(bytes.buffer);
      for (let index = 0; index < values.length; index++) {
        if (values instanceof Float32Array) view.setFloat32(index * 4, values[index], true);
        else view.setUint32(index * 4, values[index], true);
      }
      archive.file(file, bytes);
    }
  };
  write(manifest.rangesFile, scene.gradientMeshRanges); write(manifest.positionsFile, scene.gradientMeshPositions!);
  write(manifest.colorsFile, scene.gradientMeshColors!); write(manifest.indicesFile, scene.gradientMeshIndices!);
  return manifest;
}

export async function readHepGradientMesh(archive: HepArchive, value: unknown, gradientCount: number, signal?: AbortSignal): Promise<GradientMeshArrays> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object") throw new Error("Invalid gradient mesh section.");
  const meta = value as MeshManifest;
  if (!Number.isSafeInteger(meta.vertexCount) || meta.vertexCount < 0 || meta.vertexCount * 16 > MAX_UINT32 ||
      !Number.isSafeInteger(meta.indexCount) || meta.indexCount < 0 || meta.indexCount * 4 > MAX_UINT32 || meta.indexCount % 3 ||
      ![meta.rangesFile, meta.positionsFile, meta.colorsFile, meta.indicesFile].every(file => typeof file === "string" && file)) throw new Error("Invalid gradient mesh section metadata.");
  const read = async <T extends Float32Array | Uint32Array>(file: string, length: number, constructor: {new(buffer: ArrayBuffer): T}): Promise<T> => {
    signal?.throwIfAborted();
    const entry = archive.file(file);
    if (!entry || entry.uncompressedSize !== length * 4) throw new Error("Missing or incorrectly sized gradient mesh payload.");
    const buffer = await entry.async("arraybuffer"); signal?.throwIfAborted();
    if (!littleEndian) {
      const bytes = new Uint8Array(buffer);
      for (let index = 0; index < bytes.length; index += 4) {
        const a = bytes[index], b = bytes[index + 1]; bytes[index] = bytes[index + 3]; bytes[index + 1] = bytes[index + 2]; bytes[index + 2] = b; bytes[index + 3] = a;
      }
    }
    return new constructor(buffer);
  };
  return { gradientMeshRanges: await read(meta.rangesFile, gradientCount * 2, Uint32Array),
    gradientMeshPositions: await read(meta.positionsFile, meta.vertexCount * 2, Float32Array),
    gradientMeshColors: await read(meta.colorsFile, meta.vertexCount * 4, Float32Array),
    gradientMeshIndices: await read(meta.indicesFile, meta.indexCount, Uint32Array) };
}
