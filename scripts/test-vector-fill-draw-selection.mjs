import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";
import { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL } from "../src/fillCoverageShaders.ts";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { vectorFillDrawData, VectorFillDrawSelection, fillDrawColorTexels } = await import("../src/vectorFillDrawSelection.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { primitiveColorTexels } = await import("../src/nativePrimitiveColors.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const { MixedVectorBatches } = await import("../src/mixedVectorBatches.ts");
  const polygon = points => points.map((p, i) => ({ p0: p, p1: p, p2: points[(i + 1) % points.length], curve: 0 }));
  const rect = (x, y, w, h, reverse = false) => polygon((reverse
    ? [[x,y],[x,y+h],[x+w,y+h],[x+w,y]] : [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]));
  const sceneOf = (paths, rule = 0, alpha = 0.4) => {
    const scene = createEmptyVectorScene(), a = [], b = [], ma = [], mb = [], mc = [];
    for (const path of paths) {
      const xs = path.flatMap(s => [s.p0[0], s.p1[0], s.p2[0]]), ys = path.flatMap(s => [s.p0[1], s.p1[1], s.p2[1]]);
      ma.push(a.length / 4, path.length, Math.min(...xs), Math.min(...ys));
      mb.push(Math.max(...xs), Math.max(...ys), .2, .3); mc.push(rule, 0, .4, alpha);
      for (const s of path) { a.push(...s.p0, ...s.p1); b.push(...s.p2, s.curve, 0); }
    }
    return Object.assign(scene, { fillPathCount: paths.length, fillSegmentCount: a.length / 4,
      fillSegmentsA: Float32Array.from(a), fillSegmentsB: Float32Array.from(b),
      fillPathMetaA: Float32Array.from(ma), fillPathMetaB: Float32Array.from(mb), fillPathMetaC: Float32Array.from(mc),
      drawRuns: [{ kind: "fill", first: 0, count: paths.length }] });
  };
  const idsOf = plan => Array.from({ length: plan.instanceCount }, (_, i) => plan.uintInstances[i * 2]);
  const sparse = sceneOf([[...rect(0,0,2,3), ...rect(100,80,3,4), ...rect(102,81,1,1,true)]]);
  const original = structuredClone(sparse), data = vectorFillDrawData(sparse);
  assert(data.parts.has(0), "distant shapes get tighter renderer-only paths");
  assert.strictEqual(data.segmentsA, sparse.fillSegmentsA, "decomposition borrows original edges without duplicating the scene");
  assert.strictEqual(vectorFillDrawData(sparse), data, "unchanged scene preparation is cached");
  const plan = new VectorOrderedBatches(sparse, null, data);
  plan.update(sparse.drawRuns, 1);
  assert.equal(plan.instanceCount, 2, "a hole stays with its containing contour");
  assert(idsOf(plan).every(id => id >= sparse.fillPathCount));
  assert.deepEqual(sparse, original, "canonical geometry, counts and paint ranges remain untouched");
  assert.equal(plan.batches.length, 1, "parts retain one compatible instanced draw");
  assert.equal(plan.scheduledSpanRunCount(0, 0), 1, "compositor membership counts source paints");
  assert.equal(plan.update(sparse.drawRuns, .75), false, "unchanged AA bucket reuses the instance upload");
  plan.update(sparse.drawRuns,1,{minX:40,minY:30,maxX:60,maxY:50},null);
  assert.deepEqual(idsOf(plan),[0],"an unknown compositor footprint retains whole fills without changing scheduling scale");
  plan.update(sparse.drawRuns,1);
  assert(plan.update(sparse.drawRuns, 128));
  assert.deepEqual(idsOf(plan), [0], "overlapping AA footprints restore the whole compound fill");
  for (const units of [null, NaN, Infinity, 0, -1]) {
    plan.update(sparse.drawRuns, units);
    assert.deepEqual(idsOf(plan), [0], "unknown projected scales retain canonical drawing");
  }

  for (const paths of [
    [[...rect(0,0,10,10), ...rect(2,2,3,3,true)]],
    [[...rect(0,0,10,10), ...rect(5,5,10,10)]],
    [[...rect(0,0,2,2), ...rect(2,0,2,2)]]
  ]) assert.equal(vectorFillDrawData(sceneOf(paths, 1)).parts.size, 0, "holes, overlap and touching bounds are not separated");
  const open = sceneOf([[...rect(0,0,2,2).slice(0,3), ...rect(100,100,2,2)]]);
  assert.equal(vectorFillDrawData(open).parts.size, 0, "open contours retain their winding domain");
  const curved = sceneOf([[...rect(0,0,2,2),
    {p0:[100,100],p1:[-20,100],p2:[100,102],curve:1},
    {p0:[100,102],p1:[100,100],p2:[100,100],curve:0}]]);
  const curvedData = vectorFillDrawData(curved);
  assert(curvedData.parts.has(0));
  for (const parts of curvedData.parts.get(0)) {
    for (let id = parts.first; id < parts.first + parts.count; id++) {
      const o = id * 4;
      if (curvedData.pathMetaA[o] === 4) assert.equal(curvedData.pathMetaA[o + 2], -20, "groups include quadratic control hulls");
    }
  }

  // Close neighbours merge at smaller scales while distant shapes remain split.
  const neighbours = sceneOf([[...rect(0,0,1,1), ...rect(4,0,1,1), ...rect(1000,0,1,1)]]);
  const neighbourPlan = new VectorOrderedBatches(neighbours, null);
  neighbourPlan.update(neighbours.drawRuns, .125); assert.equal(neighbourPlan.instanceCount, 3);
  neighbourPlan.update(neighbours.drawRuns, 1); assert.equal(neighbourPlan.instanceCount, 2);
  neighbourPlan.update(neighbours.drawRuns, 1024); assert.deepEqual(idsOf(neighbourPlan), [0]);

  const fallback = vectorFillDrawData(sparse, sparse.fillPathCount);
  assert.equal(fallback.parts.size, 0, "optional decomposition respects actual texture capacity");
  const fallbackPlan = new VectorOrderedBatches(sparse, null, fallback);
  fallbackPlan.update(sparse.drawRuns, 1); assert.deepEqual(idsOf(fallbackPlan), [0]);

  // Compare original and split drawing with the shipped GLSL and WGSL coverage
  // functions, including translucent paths, holes and pixels crossing edges.
  for (const [language, shader] of [["GLSL", evaluateGlsl(FILL_COVERAGE_GLSL)], ["WGSL", evaluateWgsl(FILL_COVERAGE_WGSL)]]) {
    const vec = p => ({ x:p[0], y:p[1] });
    const render = (d, ids, x, y, units) => {
      let alpha = 0;
      for (const id of ids) {
        const o = id * 4, margin = units * (d.pathMetaC[o] < 0 ? 1 : .5);
        if (x < d.pathMetaA[o+2]-margin || x > d.pathMetaB[o]+margin ||
            y < d.pathMetaA[o+3]-margin || y > d.pathMetaB[o+1]+margin) continue;
        let winding = 0;
        const box = {x:x-units/2,y:y-units/2,z:1/units,w:1/units};
        for (let s = d.pathMetaA[o]; s < d.pathMetaA[o]+d.pathMetaA[o+1]; s++) {
          const i=s*4;
          winding += shader.heprSegmentCoverage(vec(d.segmentsA.subarray(i,i+2)), vec(d.segmentsA.subarray(i+2,i+4)),
            vec(d.segmentsB.subarray(i,i+2)), d.segmentsB[i+2]>=1, box, 0, 1);
        }
        const rule = d.pathMetaC[o] < 0 ? -d.pathMetaC[o]-1 : d.pathMetaC[o];
        const a = shader.heprFillCoverage(winding, rule===1)*d.pathMetaC[o+3];
        alpha = a+alpha*(1-a);
      }
      return alpha;
    };
    for (const rule of [0,1]) {
      const fixture = sceneOf([[...rect(0,0,4,4), ...rect(1,1,2,2,true), ...rect(100,80,3,4)]], rule);
      const d = vectorFillDrawData(fixture), p = new VectorOrderedBatches(fixture,null,d);
      for (const units of [.125,1,4,16,128]) {
        p.update(fixture.drawRuns,units);
        for (const [cx,cy] of [[0,0],[1,1],[2,2],[4,3],[50,40],[100,80],[103,84]]) {
          for (const dx of [-.49,-.1,.23,.51]) for (const dy of [-.51,.13,.49]) {
            const x=cx+dx*units,y=cy+dy*units;
            assert(Math.abs(render(d,[0],x,y,units)-render(d,idsOf(p),x,y,units))<1e-6,
              `${language} split ${rule ? "even-odd" : "nonzero"} coverage preserves holes, AA and opacity`);
          }
        }
      }
    }
  }

  // Select individual fills within one giant canonical run, and retain an AA
  // fringe just outside the view instead of testing unpadded centres.
  const many = sceneOf(Array.from({length:2048},(_,i)=>rect(i*10,0,1,1)));
  const manyPlan = new VectorOrderedBatches(many,null), view={minX:0,minY:0,maxX:20,maxY:10};
  manyPlan.update(many.drawRuns,1,view);
  assert(manyPlan.instanceCount<40, "large runs no longer force every offscreen fill through the vertex shader");
  assert.equal(manyPlan.culledFillCount,2048-manyPlan.instanceCount);
  assert(idsOf(manyPlan).includes(0));
  assert.equal(manyPlan.update(many.drawRuns,1,{...view,minX:10,maxX:30}),false, "small pans reuse guarded selections");
  assert(manyPlan.update(many.drawRuns,1,{...view,minX:10000,maxX:10020}));
  assert(idsOf(manyPlan).every(id=>id>900), "large pans refresh the fine selection");
  manyPlan.update(many.drawRuns,1,null); assert.equal(manyPlan.instanceCount,2048, "unknown views restore all fills");
  const fringe=sceneOf([rect(-2,0,1,1)]),fringePlan=new VectorOrderedBatches(fringe,null);
  fringePlan.update(fringe.drawRuns,1,view); assert.equal(fringePlan.instanceCount,1);
  fringePlan.update(fringe.drawRuns,1,{...view,minX:10,maxX:20}); assert.equal(fringePlan.instanceCount,0);
  const selection=new VectorFillDrawSelection(vectorFillDrawData(many));
  selection.update(1,view); assert.equal(selection.update(1,view),false);

  const colors=fillDrawColorTexels(data,primitiveColorTexels(sparse,{ref:{kind:"fill",index:0},color:[.7,.8,.9]}));
  const expected=2*(data.pathCount-data.canonicalCount+1);
  assert.equal(colors.length,expected,"recoloring reaches every possible contour variant");
  for(const patch of colors){const meta=patch.kind==="fillB"?data.pathMetaB:data.pathMetaC;
    assert.deepEqual(Array.from(patch.pixels.slice(0,2)),Array.from(meta.slice(patch.index*4,patch.index*4+2)),"GPU metadata survives color changes");}
  assert.deepEqual(sparse,original);

  plan.update(sparse.drawRuns,1);
  const renderer=Object.assign(Object.create(WebGlFloorplanRenderer.prototype),{fillDrawData:data,fillProgram:{},
    vectorClipIndex:-2,lastFillDrawFirst:0,orderedBatches:plan});
  assert.deepEqual(renderer.describeDrawSource(renderer.fillProgram,plan.instanceCount).ids,[0,0],"GPU reports keep canonical source IDs");
  const mixed=new MixedVectorBatches();mixed.update(plan);
  assert.equal(mixed.batches[0].count,2,"mixed batching forwards the selected fill instances");

  // Exercise real texture uploads and color-update entry points without a GL
  // context or browser. Each possible variant must receive the override/reset.
  const textures=new Map(),uploads=[];let bound;
  const gl={getParameter:()=>64,bindTexture(_target,texture){bound=texture;},texParameteri(){},
    texImage2D(...args){textures.set(bound,args[8].slice());},activeTexture(){},
    texSubImage2D(_target,_level,x,y,w,_h,_format,_type,pixels){uploads.push({texture:bound,index:y*8+x,count:w,pixels:pixels.slice()});}};
  const uploader=Object.assign(Object.create(WebGlFloorplanRenderer.prototype),{gl,
    fillPathMetaTextureA:"a",fillPathMetaTextureB:"b",fillPathMetaTextureC:"c",fillSegmentTextureA:"sa",fillSegmentTextureB:"sb"});
  uploader.uploadFillPaths(sparse);
  assert.deepEqual(textures.get("a").slice(0,data.pathCount*4),data.pathMetaA,"uploaded textures contain the additional contour records");
  for(const Renderer of [WebGlFloorplanRenderer,WebGpuFloorplanRenderer]){
    uploads.length=0;
    const r=Object.assign(Object.create(Renderer.prototype),{scene:sparse,fillDrawData:data,fillCoverageMetadata:data,
      gl,gpuDevice:{queue:{writeTexture(target,pixels,_layout,size){uploads.push({texture:target.texture,index:target.origin[1]*8+target.origin[0],count:size[0],pixels:pixels.slice()});}}},
      fillPathMetaTextureWidth:8,fillPathMetaTextureB:"b",fillPathMetaTextureC:"c",orderedBatches:plan,
      vectorLodLevels:[],vectorLodLevelResources:[],destroyVectorMinifyResources(){},requestFrame(){}});
    for(const color of [[.7,.8,.9],null]){
      uploads.length=0;r.setPrimitiveColorUpdates([{ref:{kind:"fill",index:0},color}]);
      for(const texture of ["b","c"]){
        const changed=new Set();
        for(const upload of uploads.filter(u=>u.texture===texture))for(let i=0;i<upload.count;i++)changed.add(upload.index+i);
        assert.equal(changed.size,data.pathCount,"native color updates reach original and all derived records");
      }
    }
  }
  assert.deepEqual(sparse,original,"native uploads and recoloring preserve canonical scene bytes");
  console.log("Sparse compound fills preserve winding, holes, opacity, AA, canonical IDs, colors, capacity fallback and guarded per-fill culling.");
} finally { hooks.deregister(); }
