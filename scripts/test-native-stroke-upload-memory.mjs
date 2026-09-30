import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
const globals = Object.fromEntries(["GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage"].map(key => [key, globalThis[key]]));
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
const fields = ["endpoints", "primitiveMeta", "styles", "primitiveBounds"];
try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { sceneStrokeRecords, strokeTextureRows } = await import("../src/strokeRecords.ts");
  const sceneOf = count => Object.assign(createEmptyVectorScene(), {
    segmentCount: count, bounds: { minX: 0, minY: 0, maxX: Math.max(1, count), maxY: 1 }, maxHalfWidth: .1,
    ...Object.fromEntries(fields.map(key => [key, new Float32Array(count * 4)]))
  });
  const recordField = (records, field) => {
    const values = new Float32Array(records.count * 4);
    for (const segment of records.segments) {
      const source = segment.scene[field];
      values.set(source.subarray(0, Math.min(source.length, segment.count * 4)), segment.first * 4);
    }
    return values;
  };

  // Canonical strokes and LOD-only records upload in place. Rows inside one
  // source are views of it; only a row spanning sources, or an incomplete
  // texel, is staged, one row at a time. Missing texels stay zero.
  for (const [counts, width, shortBy = 0] of [[[5, 3], 4], [[8, 8], 4], [[1, 1, 1, 9], 3], [[4, 0, 5], 3],
    [[7, 6], 5, 2], [[40, 37, 3], 6], [[12], 4], [[9, 16], 5]]) {
    let first = 0;
    const segments = counts.map((count, segment) => {
      const scene = sceneOf(count);
      fields.forEach((field, index) => {
        if (segment === counts.length - 1 && shortBy) scene[field] = scene[field].subarray(0, count * 4 - shortBy);
        const bits = new Uint32Array(scene[field].buffer, scene[field].byteOffset, scene[field].length);
        for (let i = 0; i < bits.length; i++) {
          bits[i] = [0x80000000, 0x7fc00001 + segment, 0x3f800001 + i, 0xbf800001 + segment * 7][(i + index) % 4];
        }
      });
      first += count;
      return { first: first - count, count, scene };
    });
    const records = { count: first, segments };
    for (const field of fields) {
      const height = Math.ceil(records.count / width);
      const texture = { width, bpp: 16, destroyed: 0, bytes: new Uint8Array(width * height * 16) };
      for (const upload of strokeTextureRows(records, field, width, 2 * width * 16)) {
        const view = segments.some(segment => segment.scene[field].buffer === upload.data.buffer);
        assert(view || (upload.height === 1 && upload.data.length <= width * 4), `${counts}/${width}: only a boundary row is staged`);
        assert(upload.height <= 2, "row batches follow the byte limit");
        assert.equal(upload.data.length, upload.width * upload.height * 4);
        copy(texture, upload.data, 0, upload.y, upload.width, upload.height);
      }
      verifyBytes(texture, recordField(records, field), `${counts}/${width}: split records upload exact texels`);
    }
  }

  // Texture row boundaries, source subviews, signed zero and NaN payloads must
  // survive exactly; no complete texture may be copied into a staging array.
  for (const count of [0, 1, 17, 257, 300_001]) {
    const scene = sceneOf(count);
    for (const [index, field] of fields.entries()) {
      const backing = new Float32Array(count * 4 + 12);
      scene[field] = backing.subarray(7, 7 + count * 4);
      const bits = new Uint32Array(backing.buffer, scene[field].byteOffset, scene[field].length);
      for (let i = 0; i < bits.length; i++) bits[i] = [0x80000000, 0x7fc00001, 0x3f800001, 0xbf800001][(i + index) % 4];
    }
    const gl = glMock(), renderer = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), { gl });
    const textures = Object.fromEntries(["A", "B", "C", "D"].map(key => [`texture${key}`, gl.createTexture()]));
    const dims = renderer.uploadStrokeTextureSet(sceneStrokeRecords(scene), textures);
    for (const [index, texture] of Object.values(textures).entries()) {
      verifyBytes(texture, scene[fields[index]], `${count} WebGL texels`);
    }
    for (const upload of gl.writes) {
      assert(scene[fields[Object.values(textures).indexOf(upload.texture)]].buffer === upload.data.buffer);
      assert(upload.data.byteLength <= 4 * 1024 * 1024, "WebGL driver submissions have bounded source views");
    }
    const device = gpuMock(), gpu = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), { gpuDevice: device });
    for (const field of fields) {
      const texture = gpu.createFloatTexture(dims.textureWidth, dims.textureHeight, scene[field]);
      verifyBytes(texture, scene[field], `${count} WebGPU texels`);
      const writes = device.writes.filter(write => write.texture === texture);
      for (const write of writes) {
        assert.equal(write.data.buffer, scene[field].buffer, "WebGPU uploads a source view without copying or alignment padding");
        assert(write.data.byteLength <= 4 * 1024 * 1024);
      }
    }
  }

  // Generic float textures also allow a partially populated last texel.
  const device = gpuMock(), gpu = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), { gpuDevice: device });
  const partial = Float32Array.of(1, 2, 3, 4, 5, 6);
  verifyBytes(gpu.createFloatTexture(3, 2, partial), partial, "partial RGBA texel is zero-filled");
  assert.throws(() => gpu.createFloatTexture(1, 1, new Float32Array(5)), /exceeds texture size/);

  for (const [backend, Renderer] of [["WebGL", WebGlFloorplanRenderer], ["WebGPU", WebGpuFloorplanRenderer]]) {
    const gl = glMock(), device = gpuMock();
    const canvas = { width: 100, height: 100, getContext: () => gl };
    const renderer = backend === "WebGL" ? new Renderer(canvas)
      : new Renderer(canvas, device, { configure() {} }, "rgba8unorm");
    renderer.requestFrame = () => {};
    renderer.vectorLodMode = "force";
    const scene = sceneOf(128);
    scene.drawRuns = [{ kind: "stroke", first: 0, count: scene.segmentCount }];
    for (let i = 0; i < scene.segmentCount; i++) {
      scene.endpoints.set([i, 0, i + 1, 0], i * 4);
      scene.primitiveMeta.set([i + 1, 0, 0, 1], i * 4);
      scene.primitiveBounds.set([i, 0, i + 1, 0], i * 4);
      scene.styles.set([.1, .2, .3, .4], i * 4);
    }
    const originals = fields.map(field => scene[field].slice());
    renderer.setScene(scene);
    const checkOrderedReserves = () => {
      for (const field of ["allSegmentIds", "visibleSegmentIds", "segmentMarks", "segmentMinX", "segmentMinY", "segmentMaxX", "segmentMaxY"]) {
        assert.equal(renderer[field].byteLength, 0, `${backend}: ordered scenes need no legacy ${field}`);
      }
      assert.equal(renderer.grid, null);
      if (backend === "WebGPU") {
        assert.equal(renderer.segmentIdBufferAll.size, 4);
        assert.equal(renderer.segmentIdBufferVisible.size, 4);
      }
    };
    checkOrderedReserves();
    const checkShared = () => {
      const levels = backend === "WebGL" ? renderer.vectorLodLevels : renderer.vectorLodLevelResources;
      assert.equal(levels.length, 1, `${backend}: one combined GPU store`);
      const records = renderer.orderedBatches.strokeRecords;
      assert(records.count > scene.segmentCount);
      assert.equal(records.segments[0].scene, scene, `${backend}: canonical strokes upload in place`);
      for (const [index, suffix] of ["A", "B", "C", "D"].entries()) {
        const texture = renderer[`segmentTexture${suffix}`];
        assert.equal(texture, levels[0][`texture${suffix}`], `${backend}: exact and LOD share texture ${suffix}`);
        if (suffix !== "C" || !renderer.primitiveColors?.has("stroke")) {
          verifyBytes(texture, recordField(records, fields[index]), `${backend} combined ${suffix}`);
        }
      }
      assert.equal(levels[0].ownsTextures, false, "LOD cannot destroy the canonical owner's textures");
    };
    checkShared();
    const updates = [{ ref: { kind: "stroke", index: 3 }, color: [1, 0, .75] }];
    renderer.setPrimitiveColorUpdates(updates);
    const checkColor = () => assert.deepEqual([...new Float32Array(renderer.segmentTextureC.bytes.buffer).slice(12, 16)],
      [scene.styles[12], 1, 0, .75], `${backend}: exact prefix color override survives resource changes`);
    checkColor();
    renderer.setVectorLodMode("off");
    checkOrderedReserves();
    renderer.updateVisibleSet();
    assert.equal(renderer.visibleSegmentCount, scene.segmentCount, "ordered visibility owns the full canonical source");
    checkColor();
    verifyBytes(renderer.segmentTextureA, scene.endpoints, `${backend} exact-only upload`);
    renderer.setVectorLodMode("force");
    checkShared(); checkColor();
    renderer.setPrimitiveColorUpdates(updates.map(update => ({ ref: update.ref, color: null })));
    checkShared();
    fields.forEach((field, index) => assert.deepEqual(scene[field], originals[index], "uploading and color edits cannot alter CPU source"));
    const legacy = { ...scene, drawRuns: undefined };
    renderer.setVectorLodMode("off");
    renderer.setScene(legacy);
    assert.equal(renderer.allSegmentIds.length, scene.segmentCount, "legacy scenes restore identity IDs");
    assert.equal(renderer.visibleSegmentIds.length, scene.segmentCount);
    assert.equal(renderer.segmentMarks.length, scene.segmentCount);
    assert.equal(renderer.segmentMinX.length, scene.segmentCount);
    assert(renderer.grid, "legacy exact scenes restore spatial culling");
    assert.deepEqual([...renderer.allSegmentIds], Array.from({ length: scene.segmentCount }, (_, i) => i));
    renderer.setVectorLodMode("force");
    assert.equal(renderer.grid, null, "legacy LOD uses its own culling hierarchy");
    const legacyLevels = backend === "WebGL" ? renderer.vectorLodLevels : renderer.vectorLodLevelResources;
    for (const level of legacyLevels) {
      if (backend === "WebGL") assert.equal(level.visibleSegmentIdsFloat.length, 0);
      else assert.equal(level.visibleSegmentIdBuffer.size, 4);
    }
    if (backend === "WebGL") renderer.updateVisibleSet();
    else renderer.updateStrokeVisibleSet();
    legacyLevels.forEach((level, index) => {
      const runtimeLevel = renderer.vectorLodRuntime.levels[index];
      const count = runtimeLevel.visibleSegmentCount;
      if (backend === "WebGL") assert.deepEqual([...level.visibleSegmentIdsFloat.subarray(0, count)],
        [...runtimeLevel.visibleSegmentIds.subarray(0, count)]);
      else {
        assert(level.visibleSegmentIdBuffer.size >= count * 4);
        assert.equal(level.bindGroup.entries[5].resource.buffer, level.visibleSegmentIdBuffer);
      }
    });
    renderer.setScene(scene);
    checkOrderedReserves(); checkShared();

    // Soft-mask contents and partial knockout spans bypass the ordered plan.
    // They must still address canonical IDs inside the shared texture prefix.
    const composite = { ...scene, paintGraph: { roots: [{ kind: "group", isolated: true,
      knockout: true, alpha: .5, blendMode: "Normal", children: [{ kind: "draw", runIndex: 0 }] }] } };
    renderer.setScene(composite);
    assert(renderer.scenePaintVisibility.requiresCompositing);
    assert.equal(renderer.allSegmentIds.length, scene.segmentCount);
    assert.equal(renderer.visibleSegmentIds.length, 0);
    renderer.orderedRunCuller = null;
    renderer.rasterRenderingEnabled = false;
    const partialRun = { kind: "stroke", first: 3, count: 1 };
    let fallbackDraws = 0;
    if (backend === "WebGL") {
      const originalDraw = renderer.drawStrokeInstances;
      renderer.drawStrokeInstances = (textures, ids, count, _w, _h, _x, _y, _zoom, first) => {
        assert.equal(textures.textureA, renderer.segmentTextureA);
        assert.equal(ids, renderer.allSegmentIdBuffer);
        assert.equal(renderer.allSegmentIds[first], 3); assert.equal(count, 1);
        assert.equal(renderer.vectorClipIndex, -1); fallbackDraws++;
      };
      renderer.paintCompositor = { dispose() {}, render(_scene, _w, _h, draw) { draw([partialRun], false); } };
      assert.equal(renderer.drawSourceOrderedContent(100, 100, 64, 0, 1), 1);
      renderer.drawStrokeInstances = originalDraw;
    } else {
      let strokeBinding;
      const pass = { setPipeline() {}, setBindGroup(index, group) { if (index === 0) strokeBinding = group; },
        draw(_vertices, count, _vertex, first) {
          assert.equal(strokeBinding.entries[1].resource.texture, renderer.segmentTextureA);
          const ids = strokeBinding.entries[5].resource.buffer;
          assert.equal(ids, renderer.segmentIdBufferAll);
          assert.equal(new Uint32Array(ids.bytes.buffer)[first], 3); assert.equal(count, 1);
          assert.equal(renderer.vectorClipIndex, -1); fallbackDraws++;
        } };
      renderer.paintCompositor = { dispose() {}, render(_scene, target, _w, _h, draw) { draw([partialRun], target, false); } };
      assert.equal(renderer.drawSourceOrderedContentIntoPass(pass), 1);
    }
    assert.equal(fallbackDraws, 1, `${backend}: a canonical partial compositor span survives identity-buffer pruning`);
    renderer.setScene(scene);
    checkOrderedReserves(); checkShared();
    const canonical = ["A", "B", "C", "D"].map(key => renderer[`segmentTexture${key}`]);
    renderer.destroyVectorLodResources();
    canonical.forEach(texture => assert.equal(texture.destroyed, 0, "releasing LOD preserves shared canonical textures"));
    renderer.setScene(sceneOf(1));
    renderer.dispose();
    canonical.forEach(texture => assert.equal(texture.destroyed, 1, "shared textures have a single owner"));
  }

  // A growing visible selection replaces only its ID buffer and bind groups,
  // and must do so before encoding even the background's shared clip binding.
  const growthDevice = gpuMock();
  const oldBuffer = growthDevice.createBuffer({ size: 8 });
  const clipTexture = growthDevice.createTexture({ size: { width: 1, height: 1 }, format: "rgba32float" });
  const clipBuffer = growthDevice.createBuffer({ size: 32 });
  const growth = Object.assign(Object.create(WebGpuFloorplanRenderer.prototype), {
    gpuDevice: growthDevice, orderedInstanceBuffer: oldBuffer, orderedInstanceCapacityBytes: 8,
    vectorClipTexture: clipTexture, vectorClipBuffers: [clipBuffer], vectorClipBindGroupLayout: {},
    scene: { ...sceneOf(1), drawRuns: [] }, zoom: 1,
    scenePaintVisibility: { setVisibility() {}, select: value => value },
    orderedBatches: { update: () => true, instanceCount: 3, uintInstances: new Uint32Array(8), batches: [] },
    drawPageBackgroundContentIntoPass() {
      assert.equal(oldBuffer.destroyed, 1, "grow before recording background draws");
      assert.equal(this.vectorClipBindGroups[0].entries[2].resource.buffer, this.orderedInstanceBuffer);
      assert.equal(clipTexture.destroyed, 0); assert.equal(clipBuffer.destroyed, 0);
    }
  });
  growth.drawSourceOrderedContentIntoPass({});
  assert.equal(growth.orderedInstanceCapacityBytes, 32);
  const buffer = growth.orderedInstanceBuffer;
  growth.growOrderedInstanceBuffer(16);
  assert.equal(growth.orderedInstanceBuffer, buffer, "smaller selections reuse capacity");
  console.log("Native stroke upload memory: bit-exact bounded source views, shared GPU ownership, color/mode/scene changes, and ordered buffer growth passed");
} finally {
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  hooks.deregister();
}

function verifyBytes(texture, source, reason) {
  const expected = new Uint8Array(texture.bytes.length);
  expected.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  assert.deepEqual(texture.bytes, expected, reason);
}
function copy(texture, data, x, y, width, height, bytesPerRow = width * texture.bpp) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(texture.destroyed, 0);
  for (let row = 0; row < height; row++) {
    texture.bytes.set(bytes.subarray(row * bytesPerRow, row * bytesPerRow + width * texture.bpp),
      ((y + row) * texture.width + x) * texture.bpp);
  }
}
function resource() {
  return { destroyed: 0, createView() { return { texture: this }; }, destroy() { this.destroyed++; } };
}
function glMock() {
  let texture;
  const methods = {
    writes: [],
    createTexture: resource, deleteTexture(value) { if (value) value.destroy(); },
    bindTexture(_target, value) { texture = value; },
    texImage2D(_target, _level, internal, width, height, _border, _format, type, data) {
      texture.width = width; texture.bpp = type === "FLOAT" ? 16 : 4;
      texture.bytes = new Uint8Array(width * height * texture.bpp);
      if (data) copy(texture, data, 0, 0, width, height);
    },
    texSubImage2D(_target, _level, x, y, width, height, _format, _type, data) {
      methods.writes.push({ texture, data }); copy(texture, data, x, y, width, height);
    }
  };
  return new Proxy(methods, { get(target, name) {
    if (name in target) return target[name];
    if (name.toUpperCase() === name) return name;
    return () => {
      if (name.startsWith("create") || name === "getUniformLocation") return {};
      if (name === "getParameter") return 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
    };
  } });
}
function gpuMock() {
  const device = {
    writes: [], limits: { maxTextureDimension2D: 4096 },
    queue: {
      writeBuffer(buffer, offset, data) {
        assert.equal(buffer.destroyed, 0); assert(offset + data.byteLength <= buffer.size);
        buffer.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
      },
      writeTexture({ texture, origin = [0, 0] }, data, layout, size) {
        device.writes.push({ texture, data });
        copy(texture, data, origin[0], origin[1], size.width ?? size[0], size.height ?? size[1], layout.bytesPerRow);
      }, submit() {}
    },
    createBuffer: descriptor => ({ ...resource(), ...descriptor, bytes: new Uint8Array(descriptor.size) }),
    createTexture(descriptor) {
      const width = descriptor.size.width ?? descriptor.size[0], height = descriptor.size.height ?? descriptor.size[1];
      const bpp = descriptor.format === "rgba32float" ? 16 : descriptor.format === "r8unorm" ? 1 : 4;
      return { ...resource(), width, bpp, bytes: new Uint8Array(width * height * bpp) };
    },
    createShaderModule: descriptor => descriptor, createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor, createSampler: descriptor => descriptor,
    createBindGroup: descriptor => descriptor,
    createRenderPipeline: descriptor => ({ getBindGroupLayout: index => descriptor.layout.bindGroupLayouts[index] })
  };
  return device;
}
