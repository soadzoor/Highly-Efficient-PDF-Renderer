import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { compositePdfPixel, extractPdfGroupPixel, knockoutPdfPixel, pdfMaskValue } = await import("../src/pdfComposite.ts");
  const { compositeScenePaintGraph, pdfCompositeScissorRect } = await import("../src/scenePaintCompositor.ts");
  const { PDF_BLEND_MODES } = await import("../src/scenePaintGraph.ts");
  const { PDF_COMPOSITE_FRAGMENT_GLSL, PDF_COMPOSITE_WGSL } = await import("../src/pdfCompositeShaders.ts");
  const close = (actual, expected, tolerance = 1e-7) => actual.forEach((v, i) => assert(Math.abs(v - expected[i]) <= tolerance,
    `channel ${i}: ${v} != ${expected[i]}`));
  close(compositePdfPixel([0,0,1,1],[0.5,0,0,0.5]),[0.5,0,0.5,1]);
  // Independent Canvas implementation checks every blend against alpha-aware pixel output.
  const operations = ["source-over","multiply","screen","overlay","darken","lighten","color-dodge","color-burn",
    "hard-light","soft-light","difference","exclusion","hue","saturation","color","luminosity"];
  for (let i = 0; i < PDF_BLEND_MODES.length; i++) {
    const canvas = createCanvas(1,1), ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(64,128,192,0.8)"; ctx.fillRect(0,0,1,1);
    ctx.globalCompositeOperation = operations[i]; ctx.fillStyle = "rgba(192,96,32,0.6)"; ctx.fillRect(0,0,1,1);
    const reference = [...ctx.getImageData(0,0,1,1).data].map(v => v/255);
    const actual = compositePdfPixel([64/255*0.8,128/255*0.8,192/255*0.8,0.8], [192/255*0.6,96/255*0.6,32/255*0.6,0.6], PDF_BLEND_MODES[i]);
    close(actual, [reference[0]*reference[3],reference[1]*reference[3],reference[2]*reference[3],reference[3]], 3/255);
  }

  render.blending = false;
  function render(roots, paints, backdrop = [1,1,1,1], visible = () => true, failAt = -1, selected = null) {
    const alive = new Set(); let draws=0;
    render.spans=[]; render.passes=0; render.surfaces=0;
    const zero = [0,0,0,0], one = [1,1,1,1];
    const adapter = {
      blendsPasses: render.blending,
      acquire() { render.surfaces++; const s={pixel:[...zero]}; alive.add(s); return s; },
      release(s) { assert(alive.delete(s),"surface released exactly once"); },
      clear(s,c=zero) { s.pixel=[...c]; },
      copy(a,b) { b.pixel=[...a.pixel]; },
      draw(runs,s,shapeOnly) {
        if (++draws===failAt) throw Error("synthetic GPU failure");
        render.spans.push(runs.length);
        for(const run of runs) for(let i=run.first;i<run.first+run.count;i++) {
          const paint=paints[i];
          s.pixel=compositePdfPixel(s.pixel,shapeOnly?[paint.shape,paint.shape,paint.shape,paint.shape]:paint.color);
        }
      },
      pass(op,s) {
        render.passes++;
        const source=op.source?.pixel??zero, shape=op.shape?.pixel??zero, current=op.current?.pixel??zero;
        const stats=op.stats?.pixel??zero, initial=op.initial?.pixel??zero, mask=op.mask?.pixel??one;
        // An isolated group layer is its own extracted layer, so its opacity and
        // soft mask are a uniform scale of premultiplied color applied on the way in.
        const src=op.isolated?source.map(v=>v*(op.opacity??1)*mask[0]):source;
        if(op.operation===0) {
          s.pixel=compositePdfPixel(op.knockout?initial:current,src,PDF_BLEND_MODES[op.blendMode??0]);
          if(op.knockout) s.pixel=knockoutPdfPixel(current,initial,s.pixel,shape[3]);
        } else if(op.operation===1) s.pixel=[src[3]+(1-(op.knockout?shape[3]:src[3]))*stats[0],shape[3]+(1-shape[3])*stats[1],0,1];
        else if(op.operation===2) s.pixel=extractPdfGroupPixel(current,initial,stats[0],(op.opacity??1)*mask[0]);
        else if(op.operation===3) s.pixel=Array(4).fill(stats[1]*(op.alphaIsShape?(op.opacity??1)*mask[0]:1));
        else if(op.operation===4) s.pixel=Array(4).fill(pdfMaskValue(source,op.softMask.subtype,op.softMask.backdrop,op.softMask.transfer));
        // Operation 6 hands the layer to a blending destination, which performs
        // the premultiplied source-over operation 0 would have computed.
        else if(op.operation===6) s.pixel=src.map((v,i)=>i===3?v+s.pixel[3]*(1-src[3]):v+s.pixel[i]*(1-src[3]));
        else s.pixel=[...source];
      }
    };
    const scene={paintGraph:{roots},drawRuns:paints.map((p,i)=>({kind:"fill",first:i,count:1,blendMode:p.blendMode,optionalContent:p.condition}))};
    try {
      const result=compositeScenePaintGraph(scene,adapter,{pixel:backdrop},visible,selected);
      const pixel=[...result.pixel]; adapter.release(result); assert.equal(alive.size,0); return pixel;
    } catch(error) { assert.equal(alive.size,0,"failed frame releases transient resources"); throw error; }
  }
  const d=i=>({kind:"draw",runIndex:i});
  const g=(children,extra={})=>({kind:"group",children,alpha:1,isolated:true,knockout:false,blendMode:"Normal",...extra});
  const red={color:[1,0,0,1],shape:1}, blue={color:[0,0,1,1],shape:1}, halfBlue={color:[0,0,0.5,0.5],shape:1};
  close(render([g([d(0),d(1)],{alpha:0.5})],[red,blue]),[0.5,0.5,1,1],1e-7);
  close(render([g([d(0),d(1)],{knockout:true})],[red,halfBlue]),[0.5,0.5,1,1]);
  close(render([g([d(0),d(1)])],[red,halfBlue]),[0.5,0,0.5,1]);
  // Source-over is associative, so an uninterrupted Normal-blend span composites
  // once for the whole span instead of once per draw run. The pixel assertions
  // above and below are what prove the batched union stays equivalent.
  // Adjacent same-kind paints over a contiguous range also reach the adapter as
  // one range, and without a knockout in the tree the shape pass is never read.
  assert.deepEqual(render.spans,[1],"a Normal-blend span batches into a single coalesced color draw");
  close(render([g([d(0),d(1)])],[red,{...halfBlue,blendMode:"Multiply"}]),
    compositePdfPixel(compositePdfPixel([0,0,0,0],red.color),halfBlue.color,"Multiply"));
  assert.deepEqual(render.spans,[1,1],"a non-Normal blend ends the span and composites on its own");
  render([g([d(0),d(1)],{knockout:true})],[red,halfBlue]);
  assert.deepEqual(render.spans,[1,1,1,1],"knockout groups keep compositing object by object, shape included");
  // Only a knockout reads geometric shape, so a nested group inside one keeps
  // rendering its own shape surface while an ordinary tree never pays for it.
  // A knockout's immediate children are the units that knock each other out, so
  // splicing a pass-through group into one would change which paints replace
  // which. The union inside the inner group must survive as one object.
  close(render([g([g([d(0),d(1)])],{knockout:true})],[red,halfBlue]),[0.5,0,0.5,1]);
  assert.deepEqual(render.spans,[1,1],"a group under a knockout still renders its span's shape");
  // A hidden paint leaves a hole, so the neighbours either side stay separate
  // ranges inside the same submission instead of merging across the gap.
  close(render([g([d(0),d(1),d(2)])],[red,{...halfBlue,condition:0},blue],undefined,id=>id!==0),[0,0,1,1]);
  assert.deepEqual(render.spans,[2],"coalescing never bridges a hidden optional-content paint");
  close(render([g([d(0),d(1)],{knockout:true})],[red,{color:[0,0,0,0],shape:1}]),[1,1,1,1]);
  // A non-isolated group's first Multiply observes the initial gray backdrop.
  close(render([g([d(0)],{isolated:false})],[{...red,blendMode:"Multiply"}],[0.5,0.5,0.5,1]),[0.5,0,0,1]);
  close(render([g([d(0)])],[{...red,blendMode:"Multiply"}],[0.5,0.5,0.5,1]),[1,0,0,1]);
  const mask={children:[d(1)],subtype:"Luminosity",transfer:new Float32Array([1,0])};
  close(render([g([d(0)],{softMask:mask})],[red,{color:[0,1,0,1],shape:1}]),[1,0.59,0.59,1]);
  close(render([g([d(0)])],[{...red,condition:0}],undefined,id=>id===undefined),[1,1,1,1]);
  // Every surface covers the viewport, so a paint the caller culled out of view
  // contributes nothing and drops out exactly like a hidden one.
  close(render([g([d(0),d(1),d(2)])],[red,halfBlue,blue],undefined,undefined,-1,Uint8Array.of(1,0,1)),[0,0,1,1]);
  assert.deepEqual(render.spans,[2],"culling leaves a hole rather than merging across the dropped paint");
  // A group with nothing left to paint composites to nothing under any blend
  // mode or knockout, so it costs neither surfaces nor passes.
  const nested=[g([d(0)]),g([d(1)],{blendMode:"Multiply",alpha:0.25,softMask:{children:[d(1)],subtype:"Alpha"}})];
  const emptied=render(nested,[red,blue],undefined,undefined,-1,Uint8Array.of(1,0));
  const cost={spans:render.spans,passes:render.passes,surfaces:render.surfaces};
  close(emptied,render([g([d(0)])],[red]));
  assert.deepEqual(cost,{spans:render.spans,passes:render.passes,surfaces:render.surfaces},
    "an emptied group costs exactly what leaving it out of the graph would");
  // A pass-through group - opaque, unmasked, Normal-blend and non-knockout -
  // paints exactly where its parent would, so it is spliced away: it costs no
  // surface and no pass, and leaves its parent one uninterrupted span.
  close(render([g([d(0)]),d(1)],[red,halfBlue]),[0.5,0,0.5,1]);
  assert.deepEqual({spans:render.spans,passes:render.passes,surfaces:render.surfaces},
    {spans:[1],passes:0,surfaces:1},"a pass-through group costs nothing and never breaks a span");
  // An isolated source-over group accumulates into one surface, so its own alpha
  // is the group alpha and its opacity scales that surface inside the composite
  // that reads it - no separate alpha accumulator, no extraction pass.
  close(render([g([d(0),d(1)],{alpha:0.5})],[red,blue]),[0.5,0.5,1,1]);
  assert.deepEqual({spans:render.spans,passes:render.passes},{spans:[1],passes:1},
    "group opacity rides into the composite instead of costing an extraction pass");
  // Isolation is immaterial to a subtree that only paints source-over, so a
  // non-isolated group of ordinary paints takes the same single-surface path.
  close(render([g([d(0),d(1)],{alpha:0.5,isolated:false})],[red,blue]),[0.5,0.5,1,1]);
  assert.deepEqual({spans:render.spans,passes:render.passes},{spans:[1],passes:1},
    "a source-over-only group needs no backdrop copy, isolated or not");
  assert.throws(()=>render([g([d(0)])],[red],undefined,undefined,1),/synthetic GPU failure/);
  // Bounding a pass is only ever an optimization: it must cover everything the
  // pass can change, with slack for coverage that bleeds past the geometry.
  const project = bounds => ({ x: bounds.minX, y: bounds.minY,
    width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY });
  const rect = (bounds, project_ = project, vw = 100, vh = 100, sw = 100, sh = 100) =>
    pdfCompositeScissorRect(bounds, project_, vw, vh, sw, sh);
  assert.deepEqual(rect({ minX: 20, minY: 30, maxX: 40, maxY: 50 }), { x: 18, y: 28, width: 24, height: 24 },
    "a bounded pass covers its rectangle plus a margin for coverage");
  assert.equal(rect({ minX: 0, minY: 0, maxX: 100, maxY: 100 }), null, "a rectangle covering the surface is no restriction");
  assert.equal(rect(undefined), null, "no bounds is no restriction");
  assert.equal(rect({ minX: -Infinity, minY: 0, maxX: 10, maxY: 10 }), null, "an unbounded paint is no restriction");
  assert.equal(rect({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, null), null, "no projection is no restriction");
  assert.equal(rect({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, () => null), null, "a projection may decline");
  assert.deepEqual(rect({ minX: -50, minY: -50, maxX: 10, maxY: 10 }), { x: 0, y: 0, width: 12, height: 12 },
    "a rectangle reaching off-surface is clamped to it");
  assert.deepEqual(rect({ minX: 200, minY: 200, maxX: 210, maxY: 210 }), { x: 100, y: 100, width: 0, height: 0 },
    "a rectangle entirely off-surface covers nothing");
  // Composite surfaces shrink under the memory budget; a rectangle scales with them.
  assert.deepEqual(rect({ minX: 20, minY: 30, maxX: 40, maxY: 50 }, project, 100, 100, 50, 50),
    { x: 9, y: 14, width: 12, height: 12 }, "a reduced surface scales the rectangle with it");
  // A destination that blends computes source-over itself, so a Normal
  // composite is one pass over the layer instead of a backdrop copy read back.
  // Every pixel above must come out the same either way.
  const withoutBlending = [];
  const cases = [
    [[g([d(0),d(1)],{alpha:0.5})],[red,blue]],
    [[g([d(0),d(1)])],[red,halfBlue]],
    [[g([d(0)],{isolated:false})],[{...red,blendMode:"Multiply"}],[0.5,0.5,0.5,1]],
    [[g([d(0)],{softMask:{children:[d(1)],subtype:"Luminosity",transfer:new Float32Array([1,0])}})],
      [red,{color:[0,1,0,1],shape:1}]],
    [[g([d(0),d(1)],{knockout:true})],[red,halfBlue]]
  ];
  for (const [roots, paints, backdropColor] of cases) withoutBlending.push(render(roots, paints, backdropColor));
  render.blending = true;
  cases.forEach(([roots, paints, backdropColor], index) => {
    close(render(roots, paints, backdropColor), withoutBlending[index], 1e-7);
  });
  close(render([g([d(0)]),d(1)],[red,halfBlue]),[0.5,0,0.5,1]);
  assert.deepEqual({passes:render.passes,surfaces:render.surfaces},{passes:0,surfaces:1},
    "a pass-through group still costs nothing when the destination blends");
  render.blending = false;
  assert(PDF_COMPOSITE_FRAGMENT_GLSL.includes("pdfSetLum"));
  assert(PDF_COMPOSITE_WGSL.includes("fn pdfSetLum"));
  assert(!/\b(?:F|I|V3|V4)\b/.test(PDF_COMPOSITE_WGSL),"shared shader equation placeholders are fully lowered");
  console.log("PDF compositing passed: independent 16-blend comparison, group opacity, non-isolation, knockout, masks and cleanup.");
} finally { hooks.deregister(); }
