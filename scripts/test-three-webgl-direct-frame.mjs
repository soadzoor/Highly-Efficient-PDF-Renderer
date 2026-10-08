import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { createThreeWebGlDirectFrame } = await import("../src/threeWebGlDirectFrame.ts");
  const { gl, draws, operations } = makeContext();
  const canvas = { width: 128, height: 128, style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} };
  // Exercise the installed renderer, including its private render-state stack,
  // geometry registration, attributes, VAOs, uniforms and target cache.
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.autoClear = true; renderer.sortObjects = true;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  camera.updateMatrixWorld();
  const frame = createThreeWebGlDirectFrame(renderer, camera);
  assert.ok(frame);
  assert.equal(createThreeWebGlDirectFrame(null, camera), null);
  assert.equal(createThreeWebGlDirectFrame({ isWebGLRenderer: true, renderBufferDirect() {} }, camera), null,
    "an arbitrary host does not inherit the installed renderer's direct semantics");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const material = new THREE.RawShaderMaterial({
    vertexShader: "precision highp float; attribute vec3 position; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; void main() { gl_Position=projectionMatrix*modelViewMatrix*vec4(position, 1.0); }",
    fragmentShader: "precision highp float; uniform float uValue; void main() { gl_FragColor=vec4(uValue); }",
    uniforms: { uValue: { value: 1 } }, toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material), scene = new THREE.Scene();
  mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
  const targets = [new THREE.WebGLRenderTarget(16, 16), new THREE.WebGLRenderTarget(32, 32)];
  let before = 0, after = 0, materialBefore = 0, renders = 0;
  const render = renderer.render;
  renderer.render = function(...args) { renders++; return render.apply(this, args); };
  mesh.onBeforeRender = () => { material.uniformsNeedUpdate = true; before++; };
  mesh.onAfterRender = () => after++;
  material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
    materialBefore++; assert.equal(object.modelViewMatrix.elements[12], object.matrixWorld.elements[12]);
  };
  assert.equal(frame.supports([mesh]), true);
  const unsupportedMaterial = new THREE.MeshBasicMaterial();
  assert.equal(frame.supports([new THREE.Mesh(geometry, unsupportedMaterial)]), false);
  const instanced = new THREE.InstancedMesh(geometry, material, 1);
  assert.equal(frame.supports([instanced]), false, "instanceMatrix storage needs its own full object upload");
  assert.throws(() => frame.draw(mesh, scene), /active frame/);
  function replay() {
    for (let index = 0; index < targets.length; index++) {
      renderer.setRenderTarget(targets[index]); renderer.setScissorTest(false);
      material.uniforms.uValue.value = index + 0.25;
      mesh.matrixWorld.makeTranslation(index + 2, 0, 0);
      frame.draw(mesh, scene);
    }
  }
  frame.run([mesh, mesh], replay);
  assert.equal(renders, 1, "two target draws use exactly one full render");
  assert.equal(draws.length, 2, "the inert driver does not add a physical draw or info call");
  assert.equal(renderer.info.render.calls, 2);
  assert.equal(before, 2); assert.equal(after, 2); assert.equal(materialBefore, 2);
  assert.deepEqual(draws.map(draw => draw.uniforms.uValue), [0.25, 1.25]);
  assert.deepEqual(draws.map(draw => draw.uniforms.modelViewMatrix[12]), [2, 3]);
  assert.deepEqual(draws[0].vertex, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.notEqual(draws[0].target, draws[1].target);
  assert.equal(renderer.info.memory.geometries, 2, "shared paint geometry uploads once alongside the driver");
  assert.equal(renderer.getRenderTarget(), null); assert.equal(renderer.autoClear, true); assert.equal(renderer.sortObjects, true);

  geometry.attributes.position.setX(0, 9); geometry.attributes.position.needsUpdate = true;
  draws.length = 0; frame.run([mesh], replay);
  assert.equal(draws[0].vertex[0], 9, "the next projection uploads changed geometry versions");
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([12, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  draws.length = 0; frame.run([mesh], replay);
  assert.equal(draws[0].vertex[0], 12, "attribute replacement invalidates the actual renderer's VAO");
  assert.ok(frame.uploads.every(upload => upload.geometry !== geometry), "pooled upload meshes release borrowed geometry after each frame");

  const instanceGeometry = new THREE.InstancedBufferGeometry();
  instanceGeometry.setAttribute("position", geometry.attributes.position.clone());
  instanceGeometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(Float32Array.of(0, 0, 1, 0), 2));
  instanceGeometry.setIndex([0, 1, 2]); instanceGeometry.instanceCount = 2;
  const instanceMaterial = material.clone(), instancePaint = new THREE.Mesh(instanceGeometry, instanceMaterial);
  instanceMaterial.uniforms.uValue.value = 0.625;
  assert.equal(frame.supports([instancePaint]), true, "PDF instanced geometry uses the supported ordinary Mesh path");
  draws.length = 0;
  frame.run([instancePaint], () => { renderer.setRenderTarget(targets[0]); frame.draw(instancePaint, scene); });
  assert.equal(draws.length, 1); assert.equal(draws[0].count, 3); assert.equal(draws[0].instances, 2);
  assert.equal(draws[0].uniforms.uValue, 0.625, "indexed instanced geometry reaches the installed GL draw backend");
  instanceGeometry.dispose(); instanceMaterial.dispose();

  // Nested composition must finish without poisoning the outer render's camera
  // and program cache. Its following draw samples the updated uniform value.
  const outer = new THREE.Scene(), outside = new THREE.Mesh(geometry, material);
  outside.frustumCulled = false; outer.add(outside); renderer.autoClear = false;
  outside.onBeforeRender = () => {
    outside.onBeforeRender = () => {};
    frame.run([mesh], replay);
    assert.equal(renderer.getRenderTarget(), null);
    material.uniforms.uValue.value = 0.75; material.uniformsNeedUpdate = true;
  };
  draws.length = 0; renderer.render(outer, camera);
  assert.equal(draws.length, 3); assert.equal(draws[2].uniforms.uValue, 0.75); assert.equal(draws[2].target, null);

  // Replay errors are reported only after render cleans its nested state up.
  const expected = new Error("synthetic paint failure");
  const direct = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function(...args) {
    if (args[4] === mesh) throw expected;
    return direct.apply(this, args);
  };
  material.transparent = true; material.side = THREE.DoubleSide; material.forceSinglePass = false;
  const previousAfter = after;
  assert.throws(() => frame.run([mesh], replay), error => error === expected);
  assert.equal(after, previousAfter + 1, "a failed draw still restores its shared per-draw state");
  assert.equal(material.side, THREE.DoubleSide, "a failed double-sided draw restores the borrowed material");
  assert.equal(renderer.getRenderTarget(), null); assert.equal(renderer.sortObjects, true);
  renderer.renderBufferDirect = direct;
  material.transparent = false; material.forceSinglePass = true;
  material.uniformsNeedUpdate = true; draws.length = 0; renderer.render(outer, camera);
  assert.equal(draws.length, 1); assert.equal(draws[0].target, null, "outer rendering remains usable after a caught replay error");

  // Exercise the complete recorded compositor plan against the installed GL
  // renderer, then replay the same plan through the ordinary render fallback.
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const runs = [{ kind: "raster", first: 0, count: 1 }, { kind: "raster", first: 1, count: 1 }];
  const pdf = Object.assign(createEmptyVectorScene(), {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, drawRuns: runs,
    rasterLayers: runs.map(() => ({ width: 1, height: 1, data: Uint8Array.of(255, 255, 255, 255),
      matrix: Float32Array.of(8, 0, 0, 8, 2, 2), opacity: 1 })),
    paintGraph: { roots: runs.map((run, index) => ({ kind: "group", isolated: true, knockout: false,
      alpha: 0.5, blendMode: index ? "Multiply" : "Normal", children: [{ kind: "draw", runIndex: index }] })) }
  });
  const paintMeshes = runs.map((run, index) => {
    const paint = new THREE.Mesh(geometry, material.clone());
    paint.material.uniforms.uValue.value = index + 0.4;
    paint.userData.heprDrawRun = run;
    paint.material.onBeforeRender = () => {};
    return paint;
  });
  const compositor = new ThreePaintCompositor("webgl");
  const project = bounds => ({ x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY });
  operations.length = 0; renders = 0;
  compositor.render(renderer, pdf, paintMeshes, 32, 24, () => true, project);
  assert.equal(renders, 1, "the complete multi-surface compositor plan uses one full render");
  assert.ok(operations.filter(operation => operation.kind === "clear").length > 1);
  assert.ok(operations.some(operation => operation.kind === "clear" && operation.scissorTest),
    "bounded clears retain their physical render-target scissor");
  assert.ok(operations.some(operation => operation.kind === "draw"));
  const directOperations = normalizeOperations(operations);
  const supports = compositor.glDirectFrame.supports;
  compositor.glDirectFrame.supports = () => false;
  operations.length = 0; renders = 0;
  compositor.render(renderer, pdf, paintMeshes, 32, 24, () => true, project);
  assert.ok(renders > 1, "unsupported paints can use the original full-render batches");
  assert.deepEqual(normalizeOperations(operations), directOperations,
    "recorded target reuse, clears, scissors, draw order and values match the full-render fallback");
  compositor.glDirectFrame.supports = supports;
  // One span can contain both material classes. Three's ordinary renderer
  // draws its opaque list first even when a transparent source was queued first.
  const mixed = Object.assign(createEmptyVectorScene(), pdf, { paintGraph: { roots: [{ kind: "group", isolated: true,
    knockout: false, alpha: 0.5, blendMode: "Normal", children: runs.map((_run, index) => ({ kind: "draw", runIndex: index })) }] } });
  paintMeshes[0].material.transparent = true; paintMeshes[0].material.needsUpdate = true;
  const paintOrder = [];
  paintMeshes.forEach((paint, index) => { paint.material.onBeforeRender = () => paintOrder.push(index); });
  operations.length = 0;
  compositor.render(renderer, mixed, paintMeshes, 32, 24, () => true, project);
  assert.deepEqual(paintOrder, [1, 0], "a mixed span draws opaque paint before transparent paint");
  const mixedDirect = normalizeOperations(operations);
  compositor.glDirectFrame.supports = () => false; operations.length = 0; paintOrder.length = 0;
  compositor.render(renderer, mixed, paintMeshes, 32, 24, () => true, project);
  assert.deepEqual(paintOrder, [1, 0]);
  assert.deepEqual(normalizeOperations(operations), mixedDirect, "mixed material spans match Three's full-render lists");
  compositor.dispose(); for (const paint of paintMeshes) paint.material.dispose();

  let geometryDisposals = 0, materialDisposals = 0;
  geometry.addEventListener("dispose", () => geometryDisposals++);
  material.addEventListener("dispose", () => materialDisposals++);
  frame.dispose(); frame.dispose();
  assert.equal(geometryDisposals, 0); assert.equal(materialDisposals, 0);
  assert.equal(frame.supports([mesh]), false);
  assert.equal(renderer.info.memory.geometries, 1, "only the driver's owned geometry is disposed");
  geometry.dispose(); material.dispose(); unsupportedMaterial.dispose(); instanced.dispose();
  for (const target of targets) target.dispose(); renderer.dispose();
  console.log("Three WebGL direct frame: actual renderer uploads, per-draw values, one full render, cache restoration, error recovery and borrowed lifetime passed");
} finally { hooks.deregister(); }

function makeContext() {
  const constants = new Map(), names = new Map(), draws = [], operations = [], buffers = new Map(), uniforms = new Map(), vaoBuffers = new Map();
  let serial = 0, buffer = null, program = null, target = null, vao = null;
  let scissor = [0, 0, 128, 128], scissorTest = false, clearColor = [0, 0, 0, 0];
  const recordDraw = (start, count, instances) => {
    const draw = { start, count, program, target, vertex: buffers.get(vaoBuffers.get(vao)), uniforms: Object.fromEntries(uniforms) };
    if (instances !== undefined) draw.instances = instances;
    draws.push(draw); operations.push({ kind: "draw", ...draw, scissor: [...scissor], scissorTest });
  };
  const gl = new Proxy({
    FLOAT: 0x1406, FLOAT_MAT4: 0x8b5c, FLOAT_VEC3: 0x8b51,
    getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getParameter(parameter) {
      const name = names.get(parameter);
      return name === "VERSION" ? "WebGL 2.0" : name === "VIEWPORT" || name === "SCISSOR_BOX" ? [0, 0, 128, 128]
        : name === "MAX_TEXTURE_SIZE" || name === "MAX_CUBE_MAP_TEXTURE_SIZE" ? 4096
        : name === "MAX_SAMPLES" || name === "SAMPLES" ? 0 : 16;
    },
    getProgramParameter(_program, parameter) {
      const name = names.get(parameter);
      return name === "ACTIVE_UNIFORMS" ? 3 : name === "ACTIVE_ATTRIBUTES" ? 1 : name === "LINK_STATUS" || name === "VALIDATE_STATUS";
    },
    getShaderParameter: () => true, getProgramInfoLog: () => "", getShaderInfoLog: () => "",
    getActiveUniform(_program, index) {
      return [{ name: "uValue", size: 1, type: gl.FLOAT }, { name: "modelViewMatrix", size: 1, type: gl.FLOAT_MAT4 },
        { name: "projectionMatrix", size: 1, type: gl.FLOAT_MAT4 }][index];
    },
    getUniformLocation: (_program, name) => ({ name }),
    getActiveAttrib: () => ({ name: "position", size: 1, type: gl.FLOAT_VEC3 }), getAttribLocation: () => 0,
    uniform1f(location, value) { uniforms.set(location.name, value); },
    uniformMatrix4fv(location, _transpose, value) { uniforms.set(location.name, Array.from(value)); },
    createBuffer: () => ({ id: ++serial }), createTexture: () => ({ id: ++serial }), createFramebuffer: () => ({ id: ++serial }),
    createRenderbuffer: () => ({ id: ++serial }), createShader: () => ({ id: ++serial }), createProgram: () => ({ id: ++serial }),
    createVertexArray: () => ({ id: ++serial }),
    bindBuffer(_type, value) { buffer = value; }, bufferData(_type, array) { buffers.set(buffer, Array.from(array)); },
    bufferSubData(_type, offset, array) {
      const values = buffers.get(buffer);
      for (let index = 0; index < array.length; index++) values[offset / array.BYTES_PER_ELEMENT + index] = array[index];
    },
    bindVertexArray(value) { vao = value; }, vertexAttribPointer() { vaoBuffers.set(vao, buffer); },
    useProgram(value) { program = value; }, bindFramebuffer(_type, value) { target = value; },
    scissor(...value) { scissor = value; },
    clearColor(...value) { clearColor = value; },
    enable(value) { if (value === gl.SCISSOR_TEST) scissorTest = true; },
    disable(value) { if (value === gl.SCISSOR_TEST) scissorTest = false; },
    clear() { operations.push({ kind: "clear", target, color: [...clearColor], scissor: [...scissor], scissorTest }); },
    drawArrays(_mode, start, count) { recordDraw(start, count); },
    drawElements(_mode, count, _type, start) { recordDraw(start, count); },
    drawArraysInstanced(_mode, start, count, instances) { recordDraw(start, count, instances); },
    drawElementsInstanced(_mode, count, _type, start, instances) { recordDraw(start, count, instances); }
  }, { get(object, key) {
    if (key in object) return object[key];
    if (typeof key === "string" && /^[A-Z][A-Z0-9_]*$/.test(key)) {
      if (!constants.has(key)) { const value = 0x1000 + constants.size; constants.set(key, value); names.set(value, key); }
      return constants.get(key);
    }
    return () => {};
  } });
  return { gl, draws, operations };
}

function normalizeOperations(operations) {
  const targets = new Map();
  return operations.map(({ program, target, ...operation }) => {
    if (!targets.has(target)) targets.set(target, targets.size);
    return { ...operation, target: targets.get(target) };
  });
}
