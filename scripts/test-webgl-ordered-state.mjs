import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { WebGlPaintCompositor } = await import("../src/webGlPaintCompositor.ts");

  for (const capacity of [16, 19, 32]) {
    const mock = mockGl(capacity);
    const r = new WebGlFloorplanRenderer({ getContext: () => mock.gl });
    assert.equal(mock.calls.filter(([name, key]) => name === "getParameter" && key === 1).length, 1,
      "sampler capacity is queried once at construction");
    assert.equal(r.orderedDedicatedTextureUnits, capacity >= 19);
    const scene = createEmptyVectorScene();
    scene.segmentCount = scene.fillPathCount = scene.textInstanceCount = 2;
    const kinds = ["stroke", "fill", "text", "stroke", "fill", "text"];
    scene.drawRuns = kinds.map(kind => ({ kind, first: 0, count: 1 }));
    const batches = scene.drawRuns.map(run => ({ ...run, clipIndex: -2 }));
    Object.assign(r, { scene, rasterRenderingEnabled: false, fillPathCount: 2, textInstanceCount: 2,
      orderedInstanceBuffer: { name: "ordered" }, vectorClipTexture: { name: "clips" },
      orderedBatches: { update: () => false, batches },
      vectorLodLevels: [{ textureA: r.segmentTextureA, textureB: r.segmentTextureB,
        textureC: r.segmentTextureC, textureD: r.segmentTextureD, textureWidth: 1, textureHeight: 1 }] });
    const expected = new Map([
      [r.segmentProgram, [["uSegmentTexA", r.segmentTextureA], ["uSegmentTexB", r.segmentTextureB],
        ["uSegmentStyleTex", r.segmentTextureC], ["uSegmentBoundsTex", r.segmentTextureD]]],
      [r.fillProgram, [["uFillPathMetaTexA", r.fillPathMetaTextureA], ["uFillPathMetaTexB", r.fillPathMetaTextureB],
        ["uFillPathMetaTexC", r.fillPathMetaTextureC], ["uFillSegmentTexA", r.fillSegmentTextureA], ["uFillSegmentTexB", r.fillSegmentTextureB]]],
      [r.textProgram, [["uTextInstanceTexA", r.textInstanceTextureA], ["uTextInstanceTexB", r.textInstanceTextureB],
        ["uTextInstanceTexC", r.textInstanceTextureC], ["uTextGlyphMetaTexA", r.textGlyphMetaTextureA],
        ["uTextGlyphMetaTexB", r.textGlyphMetaTextureB], ["uTextGlyphSegmentTexA", r.textGlyphSegmentTextureA],
        ["uTextGlyphSegmentTexB", r.textGlyphSegmentTextureB], ["uTextGlyphRasterMetaTex", r.textGlyphRasterMetaTexture],
        ["uTextRasterAtlasTex", r.textRasterAtlasTexture]]]
    ]);
    const assertPaints = (ordered = true) => {
      for (const paint of mock.paints) {
        for (const [name, texture] of expected.get(paint.program)) {
          assert.equal(paint.textures.get(paint.uniforms.get(name)), texture, `${name} is bound to its own texture`);
        }
        assert.equal(paint.textures.get(paint.uniforms.get("uVectorClipTex")), r.vectorClipTexture);
        assert.equal(paint.uniforms.get("uVectorClipIndex"), ordered ? -2 : 0);
        const location = paint.program === r.segmentProgram ? 1 : paint.program === r.fillProgram ? 3 : 2;
        assert.equal(paint.attributes.get(location).enabled, true);
        assert.equal(paint.attributes.get(location).divisor, 1);
        assert.equal(paint.attributes.get(location).buffer, ordered ? r.orderedInstanceBuffer :
          paint.program === r.segmentProgram ? r.allSegmentIdBuffer : paint.program === r.fillProgram ? r.allFillPathIdBuffer : r.allTextInstanceIdBuffer);
        assert.equal(paint.attributes.get(4).enabled, ordered);
        if (ordered) assert.equal(paint.attributes.get(4).divisor, 1);
      }
    };
    mock.clear();
    r.drawSourceOrderedContent(100, 100, 50, 50, 1);
    assertPaints();
    assert.equal(mock.paints.length, 6);
    assert.equal(mock.calls.filter(([name]) => name === "bindBuffer").length, 6, "one ordered buffer binding per draw");
    assert.equal(mock.calls.filter(([name]) => name === "enableVertexAttribArray").length, 3, "fixed instance attributes remain enabled in their VAOs");
    assert.equal(mock.calls.filter(([name]) => name === "vertexAttribDivisor").length, 3);
    assert.equal(mock.calls.filter(([name, location]) => name === "uniform1f" && location.name === "uPdfShapeOnly").length, 3);
    assert.equal(mock.calls.filter(([name, location]) => name === "uniform1i" && location.name === "uHeprMultiply").length, 3);
    const textureBinds = mock.calls.filter(([name]) => name === "bindTexture").length;
    if (capacity >= 19) assert.equal(textureBinds, 19, "all nineteen textures are bound only once per ordered frame");
    else assert(textureBinds > 19, "the lower-capacity layout safely rebinds overlapping slots");
    mock.clear();
    r.drawSourceOrderedContent(100, 100, 51, 50, 1);
    assertPaints();
    assert.equal(mock.calls.filter(([name]) => name === "bindTexture").length, textureBinds, "new frames do not trust external GL state");

    // Compositing/multiply transitions can change shader flags between uses of
    // one program. Caching by program alone would leave the wrong coverage.
    mock.clear();
    mock.gl.useProgram(r.segmentProgram);
    r.vectorClipIndex = -2;
    for (const [shape, multiply] of [[false, null], [true, null], [true, 0], [false, 1], [false, null]]) {
      r.paintShapeOnly = shape; r.multiplyPass = multiply;
      r.bindVectorClip(r.segmentProgram);
      assert.equal(mock.uniforms.get(r.segmentProgram).get("uPdfShapeOnly"), shape ? 1 : 0);
      assert.equal(mock.uniforms.get(r.segmentProgram).get("uHeprMultiply"), multiply === null ? 0 : 1);
    }
    r.paintShapeOnly = false; r.multiplyPass = null;

    // Legacy drawing still uses its original sampler units and source ID VAOs.
    mock.clear(); r.vectorClipIndex = 0;
    r.drawStrokeInstances(r.vectorLodLevels[0], r.allSegmentIdBuffer, 1, 100, 100, 50, 50, 1);
    r.drawFilledPaths(100, 100, 50, 50, 1, 0, 1);
    r.drawTextInstances(100, 100, 50, 50, 1, undefined, { start: 0, count: 1 });
    assertPaints(false);
    assert.equal(mock.paints[1].uniforms.get("uFillPathMetaTexA"), 7);
    assert.equal(mock.paints[2].uniforms.get("uTextInstanceTexA"), 2);
    assert.equal(mock.paints[2].uniforms.get("uTextRasterAtlasTex"), 13);

    // A compositor's partial canonical span uses the exact IDs, even when
    // the renderer also owns a reordered/LOD instance buffer for whole spans.
    r.orderedBatches.batches = [{ kind: "stroke", first: 1, count: 1, clipIndex: 0 }];
    mock.clear(); r.drawSourceOrderedContent(100, 100, 50, 50, 1);
    assertPaints(false);
    assert.equal(mock.paints[0].attributes.get(1).offset, 4, "canonical fallback indexes the exact stroke ID buffer");

    // An intervening gradient/raster pass can overwrite any of the sampler
    // slots. The ordered path must restore both textures and clip uniforms.
    for (const kind of ["raster", "gradient-fill", "gradient-stroke"]) {
      r.orderedBatches.batches = [batches[0], { kind, first: 0, count: 1, clipIndex: 0 }, ...batches];
      r.rasterRenderingEnabled = true; r.drawPageBackgrounds = () => {};
      const clobber = () => {
        for (let unit = 0; unit < Math.min(capacity, 19); unit++) {
          mock.gl.activeTexture(mock.gl.TEXTURE0 + unit); mock.gl.bindTexture(mock.gl.TEXTURE_2D, { unit });
        }
      };
      r.drawRasterLayerAtIndex = r.drawGradientFillPath = r.drawGradientStrokeRun = clobber;
      mock.clear(); r.drawSourceOrderedContent(100, 100, 50, 50, 1); assertPaints();
    }

    // Native screen/cache frames provide their known target; arbitrary
    // projected frames retain the compositor's shared-context capture path.
    const compositeStates = [];
    r.paintCompositor = { render(...args) { compositeStates.push(args[7]); } };
    scene.paintGraph = { roots: [{ kind: "group", isolated: true, knockout: false, alpha: 0.5,
      blendMode: "Normal", children: [{ kind: "draw", runIndex: 0 }] }] };
    r.scenePaintVisibility = null;
    r.drawSourceOrderedContent(100, 90, 50, 50, 1);
    assert.equal(compositeStates.at(-1).framebuffer, null);
    assert.deepEqual(compositeStates.at(-1).viewport, [0, 0, 100, 90]);
    const cacheFramebuffer = { name: "cache" };
    r.drawSourceOrderedContent(120, 110, 50, 50, 1, cacheFramebuffer);
    assert.equal(compositeStates.at(-1).framebuffer, cacheFramebuffer);
    assert.equal(compositeStates.at(-1).readFramebuffer, cacheFramebuffer);
    assert.deepEqual(compositeStates.at(-1).viewport, [0, 0, 120, 110]);
    r.localToClipRenderingEnabled = true;
    r.drawSourceOrderedContent(100, 90, 50, 50, 1);
    assert.equal(compositeStates.at(-1), undefined);
  }

  const scene = { drawRuns: [{ kind: "fill", first: 0, count: 1 }],
    paintGraph: { roots: [{ kind: "draw", runIndex: 0 }] } };
  const original = { framebuffer: { name: "draw" }, readFramebuffer: { name: "read" },
    viewport: [5, 7, 100, 90], clearColor: [0.1, 0.2, 0.3, 0.4],
    scissor: true, blend: false, depth: true, program: { name: "program" }, vao: { name: "vao" },
    blendFunction: ["ONE", "ZERO", "SRC_ALPHA", "ONE"], blendEquation: ["FUNC_SUBTRACT", "FUNC_ADD"] };
  const owned = { ...original, framebuffer: null, readFramebuffer: null, viewport: [0, 0, 100, 90],
    scissor: false, blend: true, depth: false, program: null, vao: null,
    blendFunction: ["SRC_ALPHA", "ONE_MINUS_SRC_ALPHA", "ONE", "ONE_MINUS_SRC_ALPHA"],
    blendEquation: ["FUNC_ADD", "FUNC_ADD"] };
  for (const knownState of [undefined, owned]) {
    for (const fail of [false, true]) {
      const mock = mockCompositeGl(original);
      const compositor = new WebGlPaintCompositor(mock.gl);
      mock.calls.length = 0;
      const render = () => compositor.render(scene, 100, 90, () => {
        mock.gl.useProgram({ name: "paint" }); mock.gl.bindVertexArray({ name: "paint" });
        if (fail) throw new Error("draw failed");
      }, () => true, null, null, knownState);
      if (fail) assert.throws(render, /draw failed/); else render();
      const queries = mock.calls.filter(([name]) => name === "getParameter" || name === "isEnabled");
      if (knownState) assert.equal(queries.length, 0, "native compositing must not query live GL state");
      else assert(queries.length > 0, "shared-context compositing captures its caller's actual state");
      assert.deepEqual(mock.state, knownState ?? original, "target and render state are restored, including after a draw failure");
      assert.equal(compositor.pool.length, compositor.all.size, "all transient surfaces are returned after success or failure");
      const blits = mock.calls.filter(([name]) => name === "blitFramebuffer");
      const viewport = (knownState ?? original).viewport;
      assert.deepEqual(blits[0].slice(1, 5), [viewport[0], viewport[1], viewport[0] + 100, viewport[1] + 90],
        "backdrop reads the caller's target rectangle");
      compositor.dispose();
    }
  }
  console.log("WebGL ordered state: texture/VAO reuse, paint replay, native compositor query avoidance and shared state restoration passed");
} finally { hooks.deregister(); }

function mockGl(capacity) {
  const calls = [], paints = [], uniforms = new Map(), textures = new Map(), vaos = new Map();
  let active = 0, program, vao, buffer, nextId = 0;
  const attr = index => {
    if (!vaos.has(vao)) vaos.set(vao, new Map());
    const entries = vaos.get(vao);
    if (!entries.has(index)) entries.set(index, { enabled: false, divisor: 0 });
    return entries.get(index);
  };
  const gl = new Proxy({ TEXTURE0: 1000, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 1 }, {
    get(target, name) {
      if (name in target) return target[name];
      if (name.toUpperCase() === name) return name;
      return (...args) => {
        calls.push([name, ...args]);
        if (name.startsWith("create")) return { id: ++nextId };
        if (name === "getParameter") return args[0] === 1 ? capacity : 4096;
        if (name === "getShaderParameter" || name === "getProgramParameter") return true;
        if (name === "getUniformLocation") return { program: args[0], name: args[1] };
        if (name === "useProgram") { program = args[0]; if (!uniforms.has(program)) uniforms.set(program, new Map()); }
        if (name.startsWith("uniform")) { assert.equal(args[0].program, program); uniforms.get(program).set(args[0].name, args[1]); }
        if (name === "activeTexture") { active = args[0] - 1000; assert(active >= 0 && active < capacity); }
        if (name === "bindTexture") textures.set(active, args[1]);
        if (name === "bindVertexArray") vao = args[0];
        if (name === "bindBuffer") buffer = args[1];
        if (name === "enableVertexAttribArray") attr(args[0]).enabled = true;
        if (name === "disableVertexAttribArray") attr(args[0]).enabled = false;
        if (name === "vertexAttribDivisor") attr(args[0]).divisor = args[1];
        if (name === "vertexAttribPointer") Object.assign(attr(args[0]), { buffer, stride: args[4], offset: args[5] });
        if (name === "drawArraysInstanced") paints.push({ program, uniforms: new Map(uniforms.get(program)),
          textures: new Map(textures), attributes: new Map([...vaos.get(vao)].map(([id, value]) => [id, { ...value }])) });
      };
    }
  });
  return { gl, calls, paints, uniforms, clear() { calls.length = paints.length = 0; } };
}

function mockCompositeGl(initial) {
  const state = { ...initial }, calls = [];
  const parameters = { DRAW_FRAMEBUFFER_BINDING: "framebuffer", READ_FRAMEBUFFER_BINDING: "readFramebuffer",
    VIEWPORT: "viewport", COLOR_CLEAR_VALUE: "clearColor", CURRENT_PROGRAM: "program", VERTEX_ARRAY_BINDING: "vao" };
  const capabilities = { SCISSOR_TEST: "scissor", BLEND: "blend", DEPTH_TEST: "depth" };
  const blendParameters = ["BLEND_SRC_RGB", "BLEND_DST_RGB", "BLEND_SRC_ALPHA", "BLEND_DST_ALPHA"];
  const gl = new Proxy({}, { get(_target, name) {
    if (name.toUpperCase() === name) return name;
    return (...args) => {
      calls.push([name, ...args]);
      if (name.startsWith("create")) return {};
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "checkFramebufferStatus") return gl.FRAMEBUFFER_COMPLETE;
      if (name === "getUniformLocation") return {};
      if (name === "getParameter") {
        if (parameters[args[0]]) return state[parameters[args[0]]];
        if (blendParameters.includes(args[0])) return state.blendFunction[blendParameters.indexOf(args[0])];
        if (args[0] === "BLEND_EQUATION_RGB") return state.blendEquation[0];
        if (args[0] === "BLEND_EQUATION_ALPHA") return state.blendEquation[1];
        assert.fail(`unexpected GL query ${args[0]}`);
      }
      if (name === "isEnabled") return state[capabilities[args[0]]];
      if (name === "enable" || name === "disable") state[capabilities[args[0]]] = name === "enable";
      if (name === "viewport") state.viewport = args;
      if (name === "clearColor") state.clearColor = args;
      if (name === "blendFuncSeparate") state.blendFunction = args;
      if (name === "blendEquationSeparate") state.blendEquation = args;
      if (name === "blendEquation") state.blendEquation = [args[0], args[0]];
      if (name === "useProgram") state.program = args[0];
      if (name === "bindVertexArray") state.vao = args[0];
      if (name === "bindFramebuffer") {
        if (args[0] !== gl.READ_FRAMEBUFFER) state.framebuffer = args[1];
        if (args[0] !== gl.DRAW_FRAMEBUFFER) state.readFramebuffer = args[1];
      }
    };
  } });
  return { gl, state, calls };
}
