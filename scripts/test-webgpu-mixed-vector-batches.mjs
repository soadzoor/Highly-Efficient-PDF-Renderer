import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
const previous = Object.fromEntries(["GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage"].map(key => [key, globalThis[key]]));
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
try {
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { MIXED_VECTOR_WGPU_VARYING_COMPONENTS, MIXED_VECTOR_WGPU_VARYING_VARIABLES } =
    await import("../src/nativeWebGpuMixedVectorShaders.ts");
  const create = () => {
    const device = makeDevice();
    const renderer = new WebGpuFloorplanRenderer({}, device, { configure() {}, unconfigure() {} }, "rgba8unorm");
    renderer.requestFrame = () => { device.frames++; };
    renderer.drawPageBackgroundContentIntoPass = () => {};
    const batches = [
      { kind: "stroke", first: 0, count: 2, clipIndex: -2 },
      { kind: "fill", first: 2, count: 1, clipIndex: -2 },
      { kind: "text", first: 0, count: 1, clipIndex: -1 },
      { kind: "stroke", first: 3, count: 1, clipIndex: -2 },
      { kind: "fill", first: 4, count: 1, clipIndex: -2 }
    ];
    const plan = { batches, batchSegments: [0, 0, 0, 0, 0], revision: 1, instanceCount: 5,
      uintInstances: Uint32Array.of(16777217, 5, 2, 1, 8, 2, 3, 3, 9, 4), update: () => false };
    renderer.orderedBatches = plan;
    renderer.scene = { drawRuns: batches };
    renderer.scenePaintVisibility = { setVisibility() {}, select: runs => runs, requiresCompositing: false };
    renderer.vectorClipBindGroups = [{ clip: -2 }, { clip: -1 }];
    renderer.vectorClipBuffers = [device.createBuffer({ size: 32 }), device.createBuffer({ size: 32 })];
    renderer.strokeBindGroupAll = { kind: "stroke" };
    renderer.fillBindGroup = { kind: "fill" };
    renderer.textBindGroup = { kind: "text" };
    for (const name of ["segmentTextureA", "segmentTextureB", "segmentTextureC", "segmentTextureD",
      "fillPathMetaTextureA", "fillPathMetaTextureB", "fillPathMetaTextureC", "fillSegmentTextureA", "fillSegmentTextureB", "vectorClipTexture"]) {
      renderer[name] = device.createTexture({ name });
    }
    return { renderer, device, plan };
  };

  {
    const { renderer, device, plan } = create();
    assert.equal(renderer.mixedVectorPipeline, null, "construction leaves the optional pipeline uncompiled");
    assert.equal(submit(renderer).draws.length, 5, "separate draws remain available during asynchronous compilation");
    assert.equal(device.asyncPipelines.length, 1);
    await settle();
    const pipeline = renderer.mixedVectorPipeline;
    assert(pipeline);
    const shader = pipeline.descriptor.vertex.module.code;
    const functionNames = [...shader.matchAll(/\bfn (\w+)\(/g)].map(match => match[1]);
    assert.equal(new Set(functionNames).size, functionNames.length, "shared helpers have one definition");
    assert.doesNotMatch(shader, /uOrderedInstances|uSegmentIds|@vertex\s+fn Mixed|@fragment\s+fn Mixed/);
    assert.equal((shader.match(/@vertex/g) ?? []).length, 1);
    assert.equal((shader.match(/@fragment/g) ?? []).length, 1);
    const output = shader.match(/struct MixedVectorData \{([\s\S]*?)\};/)[1];
    assert.equal((output.match(/@location/g) ?? []).length, MIXED_VECTOR_WGPU_VARYING_VARIABLES);
    assert.equal(MIXED_VECTOR_WGPU_VARYING_COMPONENTS, 27);
    assert.match(output, /@interpolate\(flat\) indices: vec3i/, "fill addresses and path IDs retain integer precision");
    const fragment = shader.slice(shader.lastIndexOf("@fragment"));
    assert(fragment.indexOf("dpdx(") < fragment.indexOf("if (inData.kind"));
    assert.equal((shader.match(/dpdx\(/g) ?? []).length, 1);
    assert.equal((shader.match(/dpdy\(/g) ?? []).length, 1);
    const stroke = { position: vec(1, 2, 3, 4), local: vec(5, 6), color: vec(.1, .2, .3), alpha: .4,
      vectorClipIndex: 7, p0: vec(8, 9), p1: vec(10, 11), p2: vec(12, 13),
      halfWidth: 14, aaWorld: 15, primitiveType: -3, hasClipBounds: 1, clipBounds: vec(16, 17, 18, 19) };
    const fill = { position: vec(20, 21, 22, 23), local: vec(24, 25), color: vec(.6, .7, .8), alpha: .9,
      vectorClipIndex: 26, pathIndex: 16777221, origin: vec(35, 36),
      fillRule: 1, signedArea: -.25, boundsMax: vec(37, 38), segmentStart: 16777217, segmentCount: 16777219 };
    for (const [kind, original] of [[0, stroke], [1, fill]]) {
      const packed = executeWrapper(shader, "vsMain", { uMixedInstances: [0, 0, kind], uCamera: { fillCells: vec(0, 0, 1, 1) },
        MixedStrokeDataVertex: () => stroke, MixedFillDataVertex: () => fill }, [0, 0]);
      const restored = executeWrapper(shader, "fsMain", {
        MixedStrokeDataFragment: value => value, MixedFillDataFragment: value => value }, [packed]);
      for (const [name, expected] of Object.entries(original)) {
        if (name !== "position") assert.deepEqual(restored[name], expected, `${name} survives the shared ${kind ? "fill" : "stroke"} payload`);
      }
      const disabled = executeWrapper(shader, "vsMain", { uMixedInstances: [0, 0, kind],
        uCamera: { fillCells: kind ? vec(0, 0, 1, 0) : vec(0, 0, 0, 1) },
        MixedStrokeDataVertex: () => assert.fail("disabled vectors must not fetch stroke geometry"),
        MixedFillDataVertex: () => assert.fail("disabled vectors must not fetch fill geometry") }, [0, 0]);
      assert.deepEqual(disabled.position, vec(-2, -2, 0, 1), "disabled vectors leave the viewport before texture reads");
    }
    for (const pattern of [/heprStrokeLodAlpha\(alpha, inData.primitiveType\)/,
      /heprStrokeQuadWorldPosition\(/, /heprCellWinding\(cells/, /heprSegmentCoverage\(primitiveA.xy/,
      /heprVectorClip\(inData.local, inData.vectorClipIndex, uVectorClipTex\)/]) assert.match(shader, pattern);
    const entries = pipeline.descriptor.layout.bindGroupLayouts[0].entries;
    assert.equal(entries.length, 10);
    assert.deepEqual(entries.slice(1).map(entry => entry.visibility), [1, 1, 1, 1, 1, 1, 1, 2, 2],
      "fill segment stores are fragment-only after lazy header loading");
    assert.equal(pipeline.descriptor.layout.bindGroupLayouts[1], renderer.vectorClipBindGroupLayout);
    assert.equal(pipeline.descriptor.fragment.targets[0].blend.color.srcFactor, "src-alpha");
    const submitted = submit(renderer);
    assert.equal(submitted.strokes, 3);
    assert.deepEqual(submitted.draws.map(draw => [draw.pipeline === pipeline ? "mixed" : "text", draw.args]),
      [["mixed", [4, 3, 0, 0]], ["text", [4, 1, 0, 0]], ["mixed", [4, 2, 0, 3]]],
      "mixed ranges preserve the intervening text paint and original instance order");
    const buffer = renderer.mixedVectorInstanceBuffer;
    assert.deepEqual(device.writes.find(write => write.buffer === buffer).values,
      Uint32Array.of(16777217, 5, 0, 2, 1, 0, 8, 2, 1, 3, 3, 0, 9, 4, 1));
    assert.equal(submitted.draws[0].groups[1].entries[2].resource.buffer, buffer);
    assert.equal(submitted.draws[1].groups[1], renderer.vectorClipBindGroups[1]);
    const writeCount = device.writes.length, bindCount = device.bindGroups.length;
    submit(renderer);
    assert.equal(device.writes.length, writeCount, "stationary selections reuse the uploaded triples");
    assert.equal(device.bindGroups.length, bindCount, "stationary selections reuse both bind groups");
    renderer.setMixedVectorBatchingEnabled(false);
    assert.equal(renderer.getMixedVectorBatchingEnabled(), false);
    assert.equal(submit(renderer).draws.length, 5);
    renderer.setMixedVectorBatchingEnabled(true);
    assert.equal(submit(renderer).draws.length, 3);
    assert.equal(device.writes.length, writeCount, "comparison toggles retain the cached instance store");
    plan.uintInstances[0] = 16777219; plan.revision++;
    submit(renderer);
    assert.equal(device.writes.at(-1).values[0], 16777219, "same-count LOD changes invalidate the upload");
    const oldClipGroup = renderer.mixedVectorClipBindGroup;
    renderer.vectorClipTexture = device.createTexture({ name: "replacement clips" });
    submit(renderer);
    assert.notEqual(renderer.mixedVectorClipBindGroup, oldClipGroup, "scene texture replacement refreshes binding views");
    renderer.fillRenderingEnabled = false;
    assert.equal(submit(renderer).draws.length, 3, "one-kind comparisons retain their single mixed ranges");
    assert.equal(renderer.getFillRenderingEnabled(), false);
    assert.equal(renderer.getStrokeRenderingEnabled(), true);
    assert.match(shader, /out.kind == 0u && uCamera.fillCells.z < 0.5/);
    assert.match(shader, /out.kind != 0u && uCamera.fillCells.w < 0.5/);
    renderer.fillRenderingEnabled = true;
    renderer.destroyMixedVectorInstances();
    assert(buffer.destroyed, "scene replacement releases the old instance buffer");
    submit(renderer);
    assert.notEqual(renderer.mixedVectorInstanceBuffer, buffer);
    const replacement = renderer.mixedVectorInstanceBuffer;
    renderer.dispose();
    assert(replacement.destroyed, "renderer disposal releases mixed resources");
  }
  for (const failure of ["limits", "pipeline", "allocation"]) {
    const { renderer, device } = create();
    if (failure === "limits") device.limits.maxSampledTexturesPerShaderStage = 6;
    if (failure === "pipeline") device.failPipeline = true;
    const warnings = [], warn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      submit(renderer); await settle();
      if (failure === "allocation") device.failBuffer = true;
      assert.equal(submit(renderer).draws.length, 5, `${failure} preserves the separate drawing path`);
      assert.equal(warnings.length, 1, `${failure} emits one fallback diagnostic`);
      submit(renderer);
      assert.equal(warnings.length, 1);
    } finally { console.warn = warn; renderer.dispose(); }
  }
  for (const failure of [null, "validation", "out-of-memory"]) {
    const { renderer, device } = create();
    const scopes = [];
    device.pushErrorScope = scope => scopes.push(scope);
    device.popErrorScope = () => Promise.resolve(scopes.pop() === device.scopeFailure ? new Error("synthetic asynchronous GPU error") : null);
    submit(renderer); await settle();
    device.scopeFailure = failure;
    const warnings = [], warn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      assert.equal(submit(renderer).draws.length, 5, "new resources wait for GPU validation before use");
      assert.equal(submit(renderer).draws.length, 5, "pending validation keeps the original draw path active");
      await settle();
      assert.equal(submit(renderer).draws.length, failure ? 5 : 3);
      assert.equal(warnings.length, failure ? 1 : 0);
      assert.equal(scopes.length, 0, "validation and allocation scopes remain balanced");
      if (failure) assert.equal(renderer.mixedVectorInstanceBuffer, null, "invalid asynchronous resources are released");
    } finally { console.warn = warn; renderer.dispose(); }
  }
  {
    const { renderer, device } = create();
    submit(renderer); renderer.dispose(); await settle();
    assert.equal(renderer.mixedVectorPipeline, null, "late asynchronous compilation cannot revive disposed resources");
    assert.equal(device.frames, 0);
  }
  console.log("Native WebGPU mixed vectors: shader contract, ordered dispatch, integer IDs, clipping, caching, comparison toggles, fallback and cleanup passed.");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  hooks.deregister();
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); }

function submit(renderer) {
  const draws = [], groups = [];
  let pipeline;
  const strokes = renderer.drawSourceOrderedContentIntoPass({
    setPipeline(value) { pipeline = value; },
    setBindGroup(index, value) { groups[index] = value; },
    draw(...args) { draws.push({ pipeline, groups: groups.slice(), args }); }
  });
  return { draws, strokes };
}

function makeDevice() {
  const device = {
    limits: { maxTextureDimension2D: 2048, maxSampledTexturesPerShaderStage: 16 },
    writes: [], bindGroups: [], asyncPipelines: [], frames: 0,
    queue: { writeTexture() {}, writeBuffer(buffer, offset, values) { device.writes.push({ buffer, offset, values: values.slice() }); } },
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createSampler: descriptor => descriptor,
    createBindGroup(descriptor) { this.bindGroups.push(descriptor); return descriptor; },
    createRenderPipeline: descriptor => ({ descriptor }),
    async createRenderPipelineAsync(descriptor) {
      this.asyncPipelines.push(descriptor);
      if (this.failPipeline) throw new Error("synthetic mixed pipeline failure");
      return { descriptor };
    },
    createBuffer(descriptor) {
      if (this.failBuffer) throw new Error("synthetic mixed allocation failure");
      return { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
    },
    createTexture(descriptor) {
      return { descriptor, createView() { return { texture: this }; }, destroy() {} };
    },
    destroy() {}
  };
  return device;
}

// Execute the actual generated union wrappers, independently of the existing
// analytic coverage helpers. This verifies every packed field in both kinds.
function executeWrapper(source, name, scope, args) {
  const start = source.lastIndexOf(`fn ${name}(`), open = source.indexOf("{", start);
  let end = open + 1, depth = 1;
  while (depth) { if (source[end] === "{") depth++; if (source[end] === "}") depth--; end++; }
  const body = source.slice(open + 1, end - 1)
    .replace(/let footprint = max\([\s\S]*?vec2f\(1e-4\)\);/, "let footprint = vec2f(1, 1);")
    .replace(/\bvar (\w+): \w+;/g, "let $1 = {};")
    .replace(/\b(\d+)u\b/g, "$1");
  const context = { vec2f: vec, vec2i: vec, vec3i: vec, vec4f: vec,
    dpdx: () => vec(1, 0), dpdy: () => vec(0, 1), ...scope };
  const parameters = name === "vsMain" ? ["vertexIndex", "instanceIndex"] : ["inData"];
  return new Function(...Object.keys(context), ...parameters, body)(...Object.values(context), ...args);
}

function vec(...values) {
  return new Proxy(values.flatMap(value => Array.isArray(value) ? [...value] : [value]), { get(target, key) {
    if (typeof key === "string" && /^[xyzw]{1,4}$/.test(key)) {
      const result = [...key].map(component => target["xyzw".indexOf(component)]);
      return key.length === 1 ? result[0] : vec(...result);
    }
    return Reflect.get(target, key);
  } });
}
