import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { compositePdfPixel, extractPdfGroupPixel, knockoutPdfPixel, pdfMaskValue } = await import("../src/pdfComposite.ts");
  const { compositeScenePaintGraph } = await import("../src/scenePaintCompositor.ts");
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

  function render(roots, paints, backdrop = [1,1,1,1], visible = () => true, failAt = -1) {
    const alive = new Set(); let draws=0;
    render.spans=[];
    const zero = [0,0,0,0];
    const adapter = {
      acquire() { const s={pixel:[...zero]}; alive.add(s); return s; },
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
        const source=op.source?.pixel??zero, shape=op.shape?.pixel??zero, current=op.current?.pixel??zero;
        const stats=op.stats?.pixel??zero, initial=op.initial?.pixel??zero, mask=op.mask?.pixel??zero;
        if(op.operation===0) {
          s.pixel=compositePdfPixel(op.knockout?initial:current,source,PDF_BLEND_MODES[op.blendMode??0]);
          if(op.knockout) s.pixel=knockoutPdfPixel(current,initial,s.pixel,shape[3]);
        } else if(op.operation===1) s.pixel=[source[3]+(1-(op.knockout?shape[3]:source[3]))*stats[0],shape[3]+(1-shape[3])*stats[1],0,1];
        else if(op.operation===2) s.pixel=extractPdfGroupPixel(current,initial,stats[0],(op.opacity??1)*mask[0]);
        else if(op.operation===3) s.pixel=Array(4).fill(stats[1]*(op.alphaIsShape?(op.opacity??1)*mask[0]:1));
        else if(op.operation===4) s.pixel=Array(4).fill(pdfMaskValue(source,op.softMask.subtype,op.softMask.backdrop,op.softMask.transfer));
        else s.pixel=[...source];
      }
    };
    const scene={paintGraph:{roots},drawRuns:paints.map((p,i)=>({kind:"fill",first:i,count:1,blendMode:p.blendMode,optionalContent:p.condition}))};
    try {
      const result=compositeScenePaintGraph(scene,adapter,{pixel:backdrop},visible);
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
  render([g([g([d(0),d(1)])],{knockout:true})],[red,halfBlue]);
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
  assert.throws(()=>render([g([d(0)])],[red],undefined,undefined,1),/synthetic GPU failure/);
  assert(PDF_COMPOSITE_FRAGMENT_GLSL.includes("pdfSetLum"));
  assert(PDF_COMPOSITE_WGSL.includes("fn pdfSetLum"));
  assert(!/\b(?:F|I|V3|V4)\b/.test(PDF_COMPOSITE_WGSL),"shared shader equation placeholders are fully lowered");
  console.log("PDF compositing passed: independent 16-blend comparison, group opacity, non-isolation, knockout, masks and cleanup.");
} finally { hooks.deregister(); }
