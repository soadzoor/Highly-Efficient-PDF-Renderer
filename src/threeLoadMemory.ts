import * as THREE from "three";
import type { VectorScene } from "./pdfVectorExtractor";

interface BufferTally {
  views: Set<ArrayBufferView>;
  buffers: Set<ArrayBufferLike>;
  logicalBytes: number;
  backingBytes: number;
}

// HeprThreePdfObject keeps these handles as ordinary own properties at runtime.
// Inspect their direct texture fields, never their scene/runtime/host state.
const KNOWN_LAYER_HANDLES = [
  "textMaterialLayer", "fillMaterialLayer", "strokeMaterialLayer", "triangleStrokeLayer",
  "gradientMaterialLayer", "rasterMaterialLayer", "vectorLodStrokeLayer", "compactedStrokeLayer",
  "primitiveHighlightLayer", "paintCompositor"
] as const;

function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && "value" in property ? property.value : undefined;
}

function bufferTally(): BufferTally {
  return { views: new Set(), buffers: new Set(), logicalBytes: 0, backingBytes: 0 };
}

function isBuffer(value: unknown): value is ArrayBufferLike {
  return value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer);
}

function recordBuffer(tally: BufferTally, value: unknown): void {
  if (!ArrayBuffer.isView(value) && !isBuffer(value)) return;
  const buffer = ArrayBuffer.isView(value) ? value.buffer : value;
  if (ArrayBuffer.isView(value) && !tally.views.has(value)) {
    tally.views.add(value);
    tally.logicalBytes += value.byteLength;
  }
  if (!tally.buffers.has(buffer)) {
    tally.buffers.add(buffer);
    tally.backingBytes += buffer.byteLength;
  }
}

function pixelBytes(texture: THREE.Texture): number | null {
  // A custom internal format can override the storage implied by format/type.
  if (texture.internalFormat) return null;
  const channels = texture.format === THREE.RedFormat || texture.format === THREE.RedIntegerFormat ||
    texture.format === THREE.AlphaFormat || texture.format === THREE.DepthFormat ? 1
    : texture.format === THREE.RGFormat || texture.format === THREE.RGIntegerFormat ? 2
      : texture.format === THREE.RGBFormat || texture.format === THREE.RGBIntegerFormat ? 3
        : texture.format === THREE.RGBAFormat || texture.format === THREE.RGBAIntegerFormat ? 4 : null;
  if (channels === null) return null;
  switch (texture.type) {
    case THREE.ByteType: case THREE.UnsignedByteType: return channels;
    case THREE.ShortType: case THREE.UnsignedShortType: case THREE.HalfFloatType: return channels * 2;
    case THREE.IntType: case THREE.UnsignedIntType: case THREE.FloatType: return channels * 4;
    case THREE.UnsignedShort4444Type: case THREE.UnsignedShort5551Type: return 2;
    case THREE.UnsignedInt5999Type: return 4;
    default: return null;
  }
}

/**
 * Opt-in, CPU-only snapshot. Count existing payloads without copying them,
 * invoking lazy scene getters, reading pixels or querying a renderer/driver.
 * Byte totals are retained backing buffers, not a browser/process heap reading.
 */
export function describeThreeLoadMemory(root: THREE.Object3D, scene: VectorScene): Record<string, unknown> {
  const all = bufferTally(), scenes = bufferTally(), geometry = bufferTally(), textures = bufferTally();
  const sceneRoots = new Set<object>(), sceneVisited = new Set<object>(), uniformVisited = new Set<object>();
  const geometryIds = new Set<THREE.BufferGeometry>(), attributeSources = new Set<object>();
  const materialIds = new Set<THREE.Material>(), textureIds = new Set<THREE.Texture>();
  const layerHandles = new Set<object>();
  const inspectedNodes = new Set<THREE.Object3D>(), pendingNodes: THREE.Object3D[] = [root];
  let objectNodes = 0, shaderMaterials = 0, sceneAccessorsSkipped = 0;
  let estimatedGpuGeometryBytes = 0, geometrySourcesWithoutCpuArray = 0;
  let estimatedGpuTextureBytes = 0, gpuTextureEstimateCount = 0, gpuTextureUnknownCount = 0;

  const record = (tally: BufferTally, value: unknown): void => {
    recordBuffer(tally, value);
    recordBuffer(all, value);
  };
  const scanScene = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    sceneRoots.add(value);
    const pending: object[] = [value];
    while (pending.length) {
      const entry = pending.pop()!;
      if (sceneVisited.has(entry)) continue;
      sceneVisited.add(entry);
      if (ArrayBuffer.isView(entry) || isBuffer(entry)) { record(scenes, entry); continue; }
      // Scene records are plain data. Do not walk Three objects, DOM nodes,
      // renderer internals, prototypes or parent links found in extensions.
      const prototype = Object.getPrototypeOf(entry);
      if (!Array.isArray(entry) && prototype !== Object.prototype && prototype !== null) continue;
      for (const key of Object.keys(entry)) {
        if (key === "parent") continue;
        const property = Object.getOwnPropertyDescriptor(entry, key)!;
        if (!("value" in property)) { sceneAccessorsSkipped++; continue; }
        if (property.value && typeof property.value === "object") pending.push(property.value);
      }
    }
  };
  const inspectAttribute = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined): void => {
    if (!attribute) return;
    const source = (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
      ? (attribute as THREE.InterleavedBufferAttribute).data : attribute;
    if (attributeSources.has(source)) return;
    attributeSources.add(source);
    if (ArrayBuffer.isView(source.array)) {
      record(geometry, source.array);
      // Distinct BufferAttributes can upload the same CPU view separately;
      // interleaved attributes share one InterleavedBuffer upload.
      estimatedGpuGeometryBytes += source.array.byteLength;
    } else geometrySourcesWithoutCpuArray++;
  };
  const inspectGeometry = (value: THREE.BufferGeometry): void => {
    if (geometryIds.has(value)) return;
    geometryIds.add(value);
    inspectAttribute(value.index);
    for (const attribute of Object.values(value.attributes)) inspectAttribute(attribute);
    for (const attributes of Object.values(value.morphAttributes)) {
      if (attributes) for (const attribute of attributes) inspectAttribute(attribute);
    }
    inspectAttribute(value.indirect);
  };
  const inspectTexture = (texture: THREE.Texture): void => {
    if (textureIds.has(texture)) return;
    textureIds.add(texture);
    const inspectImage = (image: unknown): void => {
      if (ArrayBuffer.isView(image) || isBuffer(image)) { record(textures, image); return; }
      if (Array.isArray(image)) { for (const face of image) inspectImage(face); return; }
      if (!image || typeof image !== "object") return;
      const data = Object.getOwnPropertyDescriptor(image, "data");
      if (data && "value" in data) record(textures, data.value);
    };
    inspectImage(texture.image);
    for (const mipmap of texture.mipmaps) inspectImage(mipmap);
    const flags = texture as unknown as Record<string, unknown>;
    // Render-target allocations, cube/array layouts and implementation-specific
    // formats need renderer knowledge; leave them visibly unestimated.
    if (flags.isRenderTargetTexture || flags.isCubeTexture || flags.isCompressedArrayTexture ||
      flags.isDataArrayTexture || flags.isData3DTexture) { gpuTextureUnknownCount++; return; }
    let bytes: number | null = null;
    if (flags.isCompressedTexture) {
      if (texture.mipmaps.length) {
        bytes = 0;
        for (const mipmap of texture.mipmaps) {
          const data = Object.getOwnPropertyDescriptor(mipmap, "data")?.value;
          if (!ArrayBuffer.isView(data) && !isBuffer(data)) { bytes = null; break; }
          bytes += data.byteLength;
        }
      }
    } else {
      const bytesPerPixel = pixelBytes(texture);
      const levels = texture.mipmaps.length ? texture.mipmaps : [texture.image];
      if (bytesPerPixel !== null) {
        bytes = 0;
        for (const image of levels) {
          const width = (image as { width?: number } | null)?.width;
          const height = (image as { height?: number } | null)?.height;
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width! <= 0 || height! <= 0) {
            bytes = null; break;
          }
          bytes += width! * height! * bytesPerPixel;
        }
        if (bytes !== null && !texture.mipmaps.length && texture.generateMipmaps) {
          let { width, height } = texture.image as { width: number; height: number };
          while (width > 1 || height > 1) {
            width = Math.max(1, Math.floor(width / 2));
            height = Math.max(1, Math.floor(height / 2));
            bytes += width * height * bytesPerPixel;
          }
        }
      }
    }
    if (bytes === null || !Number.isFinite(bytes)) gpuTextureUnknownCount++;
    else { estimatedGpuTextureBytes += bytes; gpuTextureEstimateCount++; }
  };
  const scanUniform = (value: unknown): void => {
    if (!value || typeof value !== "object" || uniformVisited.has(value)) return;
    uniformVisited.add(value);
    if ((value as THREE.Texture).isTexture) { inspectTexture(value as THREE.Texture); return; }
    if (ArrayBuffer.isView(value) || isBuffer(value)) { record(all, value); return; }
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && !(value instanceof THREE.Uniform) && prototype !== Object.prototype && prototype !== null) return;
    for (const key of Object.keys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (key !== "parent" && "value" in property) scanUniform(property.value);
    }
  };
  const inspectMaterial = (material: THREE.Material): void => {
    if (materialIds.has(material)) return;
    materialIds.add(material);
    if ((material as THREE.ShaderMaterial).isShaderMaterial) shaderMaterials++;
    for (const key of Object.keys(material)) {
      const property = Object.getOwnPropertyDescriptor(material, key)!;
      if (!("value" in property)) continue;
      const value = property.value;
      if (value?.isTexture) inspectTexture(value);
      else if (key === "uniforms") scanUniform(value);
    }
  };
  const inspectLayerTextures = (layer: unknown): void => {
    if (!layer || typeof layer !== "object" || layerHandles.has(layer)) return;
    layerHandles.add(layer);
    const inspectDirectTexture = (value: unknown): void => {
      if (ownValue(value, "isTexture") === true) inspectTexture(value as THREE.Texture);
    };
    for (const key of Object.keys(layer)) {
      const value = ownValue(layer, key);
      inspectDirectTexture(value);
      // Dormant pipelines detach their mesh/group while retaining the layer.
      // Queue only these documented roots, with the normal node identity guard.
      if ((key === "mesh" || key === "group") && ownValue(value, "isObject3D") === true) {
        pendingNodes.push(value as THREE.Object3D);
      }
      // Owned texture collections are one level deep. Entries containing
      // materials, TSL state, retained sources or renderer handles are ignored.
      if (Array.isArray(value) || value instanceof Set) {
        for (const texture of value) inspectDirectTexture(texture);
      }
    }
  };
  const inspectNodeLayerTextures = (node: THREE.Object3D): void => {
    for (const name of KNOWN_LAYER_HANDLES) {
      const layer = ownValue(node, name);
      inspectLayerTextures(layer);
      // Two documented resource holders: text's shared glyph resource record,
      // and vector stroke LOD's array of ordinary material stroke layers.
      if (name === "textMaterialLayer") inspectLayerTextures(ownValue(layer, "glyphResources"));
      else if (name === "vectorLodStrokeLayer") {
        const levels = ownValue(layer, "layers");
        if (Array.isArray(levels)) for (const level of levels) inspectLayerTextures(level);
      }
    }
  };

  scanScene(scene);
  const sourceBytes = (root as THREE.Object3D & { sourceBytes?: Uint8Array }).sourceBytes;
  record(all, sourceBytes);
  while (pendingNodes.length) {
    const node = pendingNodes.pop()!;
    if (inspectedNodes.has(node)) continue;
    inspectedNodes.add(node);
    objectNodes++;
    const resource = node as THREE.Object3D & {
      sceneData?: VectorScene; geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[];
      instanceMatrix?: THREE.BufferAttribute; instanceColor?: THREE.BufferAttribute | null; morphTexture?: THREE.Texture | null;
    };
    if (resource.sceneData) scanScene(resource.sceneData);
    if (resource.geometry?.isBufferGeometry) inspectGeometry(resource.geometry);
    const materials = resource.material;
    if (Array.isArray(materials)) for (const material of materials) inspectMaterial(material);
    else if (materials?.isMaterial) inspectMaterial(materials);
    inspectAttribute(resource.instanceMatrix);
    inspectAttribute(resource.instanceColor);
    if (resource.morphTexture) inspectTexture(resource.morphTexture);
    inspectNodeLayerTextures(node);
    for (const child of node.children) pendingNodes.push(child);
  }
  return {
    objectNodes, sceneCount: sceneRoots.size,
    sceneArrayViews: scenes.views.size, sceneLogicalViewBytes: scenes.logicalBytes,
    sceneBackingBuffers: scenes.buffers.size, sceneBackingBytes: scenes.backingBytes, sceneAccessorsSkipped,
    geometryCount: geometryIds.size, geometryAttributeSources: attributeSources.size,
    geometryArrayViews: geometry.views.size, geometryLogicalViewBytes: geometry.logicalBytes,
    geometryBackingBytes: geometry.backingBytes, estimatedGpuGeometryBytes, geometrySourcesWithoutCpuArray,
    materialCount: materialIds.size, shaderMaterialCount: shaderMaterials,
    textureCount: textureIds.size, layerTextureHandleCount: layerHandles.size, textureDataViews: textures.views.size,
    textureDataPayloadBytes: textures.logicalBytes, textureBackingBytes: textures.backingBytes,
    estimatedGpuTextureBytes, gpuTextureEstimateCount, gpuTextureUnknownCount,
    sourceBytesLogicalBytes: sourceBytes?.byteLength ?? 0,
    retainedCpuBackingBuffers: all.buffers.size, retainedCpuBackingBytes: all.backingBytes,
    coverageNotes: [
      "CPU backing buffers are deduplicated globally; category totals overlap. Subviews retain the full backing buffer.",
      "CPU coverage: plain scene records (including page sceneData), geometry arrays, uniform arrays and texture payloads; excludes JS objects, strings, workers, native renderer caches, driver and GPU allocations. Lazy getters are skipped.",
      "Resource discovery covers Object3D children and known Hepr layers' mesh/group roots, including dormant detached roots. Textures cover direct material fields, plain uniform records and known layer handles' direct texture fields/collections (including shared glyph resources and stroke LOD layers). Unknown WebGPU TSL graphs, nested raster caches and renderer-private textures remain excluded.",
      "GPU bytes estimate the footprint if discovered resources are uploaded, including dormant/unuploaded resources; they are not measured allocations. Excludes render targets, cube/array/3D textures, unknown formats, shader programs, alignment and driver overhead. CPU memory coverage is a lower bound."
    ]
  };
}
