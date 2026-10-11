import assert from "node:assert/strict";
import * as THREE from "three";
import { describeThreeLoadMemory } from "../src/threeLoadMemory.ts";

const backing = new ArrayBuffer(256);
const positions = new Float32Array(backing, 0, 12);
const index = new Uint16Array(backing, 64, 6);
const interleaved = new THREE.InterleavedBuffer(new Float32Array(backing, 80, 12), 6);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("normal", new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
geometry.setAttribute("uv", new THREE.InterleavedBufferAttribute(interleaved, 2, 3));
geometry.setIndex(new THREE.BufferAttribute(index, 1));
const rgbaData = new Uint8Array(backing, 128, 16);
const rgba = new THREE.DataTexture(rgbaData, 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
rgba.generateMipmaps = true;
const floatData = new Float32Array(8);
const float = new THREE.DataTexture(floatData, 2, 1, THREE.RGBAFormat, THREE.FloatType);
const red = new THREE.DataTexture(new Uint16Array(2), 2, 1, THREE.RedFormat, THREE.HalfFloatType);
const compressedData = new Uint8Array(16);
const compressed = new THREE.CompressedTexture([{ width: 4, height: 4, data: compressedData }],
  4, 4, THREE.RGBA_BPTC_Format);
const material = new THREE.ShaderMaterial({ uniforms: {
  map: { value: rgba }, repeated: { value: [rgba, { float, red, compressed }] }
} });
material.map = rgba;
const root = new THREE.Group();
root.add(new THREE.Mesh(geometry, material));
root.add(new THREE.Mesh(geometry, [material, material]));
root.sourceBytes = new Uint8Array(backing, 192, 12);
const scene = { positions, nested: { index, duplicates: [positions, rgbaData] } };
scene.nested.cycle = scene;
scene.excludedThreeNode = root;
Object.defineProperty(scene, "lazyRgba", { enumerable: true, get() { assert.fail("diagnostics must not invoke scene getters"); } });
const page = new THREE.Group();
page.sceneData = { extra: new Uint8Array(backing, 220, 4), nested: scene };
root.add(page);

// Even copying a zero-byte view would indicate the wrong diagnostic strategy.
const originalSlice = ArrayBuffer.prototype.slice;
ArrayBuffer.prototype.slice = () => assert.fail("diagnostics must not copy backing buffers");
let report;
try { report = describeThreeLoadMemory(root, scene); }
finally { ArrayBuffer.prototype.slice = originalSlice; }
assert.equal(report.objectNodes, 4);
assert.equal(report.sceneCount, 2);
assert.equal(report.sceneArrayViews, 4);
assert.equal(report.sceneLogicalViewBytes, 48 + 12 + 16 + 4);
assert.equal(report.sceneBackingBuffers, 1);
assert.equal(report.sceneBackingBytes, 256, "small views retain the full allocation");
assert.equal(report.sceneAccessorsSkipped, 1);
assert.equal(report.geometryCount, 1);
assert.equal(report.geometryAttributeSources, 3, "interleaved attributes share one GPU source");
assert.equal(report.geometryArrayViews, 3);
assert.equal(report.geometryLogicalViewBytes, 48 + 12 + 48);
assert.equal(report.geometryBackingBytes, 256);
assert.equal(report.estimatedGpuGeometryBytes, 48 + 12 + 48);
assert.equal(report.materialCount, 1);
assert.equal(report.shaderMaterialCount, 1);
assert.equal(report.textureCount, 4, "material fields and repeated nested uniforms deduplicate textures");
assert.equal(report.textureDataPayloadBytes, 16 + 32 + 4 + 16);
assert.equal(report.textureBackingBytes, 256 + 32 + 4 + 16);
assert.equal(report.estimatedGpuTextureBytes, 20 + 32 + 4 + 16, "GPU texture estimates honor type, channels, mips and compression");
assert.equal(report.gpuTextureEstimateCount, 4);
assert.equal(report.gpuTextureUnknownCount, 0);
assert.equal(report.sourceBytesLogicalBytes, 12);
assert.equal(report.retainedCpuBackingBuffers, 4);
assert.equal(report.retainedCpuBackingBytes, 256 + 32 + 4 + 16, "all categories share one global backing tally");
assert.match(report.coverageNotes.join(" "), /lower bound/);
assert.doesNotThrow(() => JSON.stringify(report));
assert.equal(rgba.image.data, rgbaData);
assert.equal(geometry.getAttribute("position").array, positions);

// WebGPU node materials hold textures inside TSL graphs rather than uniforms.
// Hepr's layer handles provide the same existing texture identities directly.
const webGpuRoot = new THREE.Group();
webGpuRoot.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
webGpuRoot.sourceBytes = root.sourceBytes;
webGpuRoot.sceneData = scene;
const webGpuPage = new THREE.Group();
webGpuPage.sceneData = page.sceneData;
webGpuRoot.add(webGpuPage);
webGpuRoot.textMaterialLayer = {
  textInstanceTextureA: rgba, textGlyphSegmentTextureA: float,
  glyphResources: { atlasTexture: red, segmentTextureA: float },
  textureList: [rgba, float], scene, renderer: { hiddenTexture: unknownTexture() }
};
webGpuRoot.fillMaterialLayer = { vectorClipTexture: red, ownedTextures: new Set([rgba, red]) };
webGpuRoot.vectorLodStrokeLayer = { layers: [{ segmentTextureA: compressed }] };
webGpuPage.textMaterialLayer = { textInstanceTextureA: rgba, textGlyphSegmentTextureA: float };
Object.defineProperty(webGpuRoot.textMaterialLayer, "lazyTextures", {
  enumerable: true, get() { assert.fail("known layer scans must skip getters"); }
});
webGpuRoot.textMaterialLayer.webGpuState = { value: unknownTexture() };
const webGpuReport = describeThreeLoadMemory(webGpuRoot, scene);
for (const key of ["textureCount", "textureDataPayloadBytes", "textureBackingBytes", "estimatedGpuTextureBytes",
  "retainedCpuBackingBytes", "retainedCpuBackingBuffers"]) {
  assert.equal(webGpuReport[key], report[key], `${key}: known WebGPU layer textures match WebGL uniforms and deduplicate globally`);
}
assert.match(webGpuReport.coverageNotes.join(" "), /Unknown WebGPU TSL graphs/);

const dormantRoot = new THREE.Group(), dormantGeometry = new THREE.BufferGeometry();
const dormantPositions = new Float32Array(12);
dormantGeometry.setAttribute("position", new THREE.BufferAttribute(dormantPositions, 3));
const dormantMesh = new THREE.Mesh(dormantGeometry, new THREE.MeshBasicMaterial({ map: rgba }));
const dormantGroup = new THREE.Group();
dormantGroup.add(dormantMesh);
dormantRoot.textMaterialLayer = { mesh: dormantMesh, textRasterAtlasTexture: rgba };
dormantRoot.fillMaterialLayer = { group: dormantGroup };
// The layer root and its mesh can also be attached children or repeated by
// another retained layer. All paths must describe each resource node once.
const dormantReport = describeThreeLoadMemory(dormantRoot, { dormantPositions });
assert.equal(dormantReport.objectNodes, 3);
assert.equal(dormantReport.geometryCount, 1);
assert.equal(dormantReport.materialCount, 1);
assert.equal(dormantReport.textureCount, 1);
assert.equal(dormantReport.geometryBackingBytes, 48);
assert.equal(dormantReport.retainedCpuBackingBytes, 48 + 256);
dormantRoot.add(dormantGroup);
assert.equal(describeThreeLoadMemory(dormantRoot, { dormantPositions }).objectNodes, 3,
  "attached and detached layer paths share one object identity set");

const other = new THREE.BufferGeometry();
other.setAttribute("position", new THREE.BufferAttribute(positions, 3));
root.add(new THREE.Mesh(other, material));
const duplicateUpload = describeThreeLoadMemory(root, scene);
assert.equal(duplicateUpload.geometryBackingBytes, 256);
assert.equal(duplicateUpload.geometryLogicalViewBytes, report.geometryLogicalViewBytes);
assert.equal(duplicateUpload.estimatedGpuGeometryBytes, report.estimatedGpuGeometryBytes + 48,
  "distinct BufferAttributes can upload the same CPU view independently");

const unknown = new THREE.DataTexture(new Uint8Array(4), 1, 1);
unknown.internalFormat = "RGBA16F";
const target = new THREE.Texture();
target.isRenderTargetTexture = true;
material.uniforms.unknown = { value: [unknown, target] };
const partial = describeThreeLoadMemory(root, scene);
assert.equal(partial.gpuTextureUnknownCount, 2);
assert.equal(partial.estimatedGpuTextureBytes, report.estimatedGpuTextureBytes,
  "unknown/custom storage is reported as missing instead of inventing RGBA8 estimates");

const mipBase = new Uint8Array(64), mipLevel = new Uint8Array(16), uniformData = new Uint8Array(8);
const mipmapped = new THREE.DataTexture(mipBase, 4, 4);
mipmapped.mipmaps = [{ width: 4, height: 4, data: mipBase }, { width: 2, height: 2, data: mipLevel }];
const uniformRoot = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: {
  image: new THREE.Uniform(mipmapped), array: new THREE.Uniform(uniformData)
} }));
const mipReport = describeThreeLoadMemory(uniformRoot, {});
assert.equal(mipReport.textureCount, 1, "THREE.Uniform values are inspected without walking class internals");
assert.equal(mipReport.textureDataPayloadBytes, 80, "base image aliases in explicit mipmaps count once on the CPU");
assert.equal(mipReport.estimatedGpuTextureBytes, 80, "explicit mip levels replace an implicit base upload");
assert.equal(mipReport.retainedCpuBackingBytes, 88, "typed uniform values also retain CPU backing buffers");
console.log("Three load-memory snapshot tests passed.");

function unknownTexture() {
  return new THREE.DataTexture(new Uint8Array(4), 1, 1);
}
