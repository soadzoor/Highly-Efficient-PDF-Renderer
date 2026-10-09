import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ScenePrimitivePicker, getScenePrimitive, isScenePrimitiveVisible } = await import("../src/scenePrimitives.ts");
  const { validateScenePaintGraph, planScenePaintPasses, normalizeScenePaintGraph,
    scenePaintSpanSegments, scenePaintNodeBounds } = await import("../src/scenePaintGraph.ts");
  const rect = (x0,y0,x1,y1) => [[x0,y0,x1,y0],[x1,y0,x1,y1],[x1,y1,x0,y1],[x0,y1,x0,y0]];
  const fill = (scene, edges, rgb = [1,1,1], alpha = 1, condition) => {
    const first = scene.fillSegmentCount, index = scene.fillPathCount++;
    const append = (old, values) => Float32Array.from([...old, ...values]);
    scene.fillSegmentCount += edges.length;
    scene.fillSegmentsA = append(scene.fillSegmentsA, edges.flat());
    scene.fillSegmentsB = append(scene.fillSegmentsB, edges.flatMap(e=>[e[2],e[3],0,0]));
    scene.fillPathMetaA = append(scene.fillPathMetaA,[first,edges.length,0,0]);
    scene.fillPathMetaB = append(scene.fillPathMetaB,[10,10,rgb[0],rgb[1]]);
    scene.fillPathMetaC = append(scene.fillPathMetaC,[1,0,rgb[2],alpha]);
    scene.drawRuns.push({kind:"fill",first:index,count:1,...(condition===undefined?{}:{optionalContent:condition})});
    return {kind:"draw",runIndex:index};
  };
  const group = (children, extra={}) => ({kind:"group", children, isolated:true, knockout:false, blendMode:"Normal",alpha:1,...extra});
  const scene = () => Object.assign(createEmptyVectorScene(),{drawRuns:[],pageCount:1,pageRects:Float32Array.of(0,0,10,10),optionalContent:{groups:[{id:"A",name:"A",defaultVisible:false,locked:false,usedInView:true}],conditions:[{kind:"group",groupId:"A"}],order:[],radioGroups:[]}});
  const query = (x,y,extra={}) => ({point:{x,y},clientPoint:{x,y},project:p=>p,unproject:p=>p,tolerancePx:0,...extra});
  {
    const s=scene();
    let node=fill(s,rect(0,0,10,10));
    for(let depth=0;depth<70;depth++) node=group([node],{alpha:0.99});
    s.paintGraph={roots:[node]};
    validateScenePaintGraph(s);
    const passes=planScenePaintPasses(s,()=>true);
    assert.equal(passes.filter(pass=>pass.kind==="begin-group").length,70);
    assert.equal(passes.filter(pass=>pass.kind==="draw").length,1,"deep groups retain their leaf paint");
    let normalized=normalizeScenePaintGraph(s)[0], depth=0;
    while(normalized.kind==="group") { depth++; normalized=normalized.children[0]; }
    assert.equal(depth,70);
    assert.ok(scenePaintSpanSegments(s)[0]>0,"deep paints are assigned a compositor span");
    assert.ok(scenePaintNodeBounds(s).nodes.size>70,"deep group bounds are measured");
    node.children=[node];
    assert.throws(()=>validateScenePaintGraph(s),/cyclic/,"removing nesting ceilings preserves cycle rejection");
  }
  {
    const s=scene(), bottom=fill(s,rect(0,0,10,10)), content=fill(s,rect(0,0,10,10)), mask=fill(s,[...rect(0,0,10,10),...rect(3,3,7,7)]);
    s.paintGraph={roots:[bottom,group([content],{softMask:{children:[mask],subtype:"Alpha"}})]};
    validateScenePaintGraph(s);
    const picker=new ScenePrimitivePicker(s);
    assert.equal((await picker.pick(query(1,1))).primitive.index,1,"mask-only paint is never the selected primitive");
    assert.equal((await picker.pick(query(5,5))).primitive.index,0,"mask holes reveal underlying geometry");
    assert.equal(isScenePrimitiveVisible(s,{kind:"fill",index:2},()=>true),false);
  }
  {
    const s=scene(), bottom=fill(s,rect(0,0,10,10)), content=fill(s,rect(0,0,10,10)), mask=fill(s,rect(0,0,10,10),[0,0,0],1,0);
    s.paintGraph={roots:[bottom,group([content],{optionalContent:0,softMask:{children:[mask],subtype:"Luminosity"}})]};
    const picker=new ScenePrimitivePicker(s), identity=picker.index;
    assert.equal((await picker.pick(query(5,5))).primitive.index,0,"ancestor condition hides a run without its own condition");
    const indexed=picker.index;
    assert.equal((await picker.pick(query(5,5,{isConditionVisible:()=>true}))).primitive.index,0,"black luminosity mask hides its owner");
    assert.equal((await picker.pick(query(5,5,{isConditionVisible:()=>true,resolveColor:(ref,rgb)=>ref.index===2?[1,1,1]:rgb}))).primitive.index,1,"display color overrides affect luminosity");
    assert.equal(picker.index,indexed,"visibility and masks reuse the hierarchy");
    assert.deepEqual(getScenePrimitive(s,{kind:"fill",index:1}).optionalContent.layerIds,["A"]);
  }
  {
    const s=scene(), bottom=fill(s,rect(0,0,10,10)), content=fill(s,rect(0,0,10,10)), mask=fill(s,rect(0,0,10,10));
    s.paintGraph={roots:[bottom,group([content],{softMask:{children:[mask],subtype:"Alpha",transfer:Float32Array.of(1,0)}})]};
    assert.equal((await new ScenePrimitivePicker(s).pick(query(5,5))).primitive.index,0,"transfer functions affect alpha eligibility");
    const z=scene(), b=fill(z,rect(0,0,10,10)), c=fill(z,rect(0,0,10,10));
    z.paintGraph={roots:[b,group([c],{alpha:0})]};
    assert.equal((await new ScenePrimitivePicker(z).pick(query(5,5))).primitive.index,0,"zero-alpha groups cannot cover lower objects");
  }
  {
    const s=scene(), first=fill(s,rect(0,0,10,10)), second=fill(s,rect(0,0,10,10));
    s.paintGraph={roots:[second,first]};
    assert.equal((await new ScenePrimitivePicker(s).pick(query(5,5))).primitive.index,0,"graph order takes precedence over storage indices");
  }
  for (const kind of ["stroke","text","raster","gradient-fill"]) {
    const s=scene(), bottom=fill(s,rect(0,0,10,10)), content=fill(s,rect(0,0,10,10));
    if (kind==="stroke") Object.assign(s,{segmentCount:1,endpoints:Float32Array.of(0,2,4,2),primitiveMeta:Float32Array.of(4,2,0,1),styles:Float32Array.of(1,1,1,1),primitiveBounds:Float32Array.of(0,1,4,3)});
    if (kind==="text") {
      const edges=rect(0,0,2,2);
      Object.assign(s,{textInstanceCount:1,textGlyphCount:1,textGlyphSegmentCount:4,textInstanceA:Float32Array.of(2,0,0,2),textInstanceB:Float32Array.of(0,0,0,0),textInstanceC:Float32Array.of(1,1,1,1),textGlyphMetaA:Float32Array.of(0,4,0,0),textGlyphMetaB:Float32Array.of(2,2,0,0),textGlyphSegmentsA:Float32Array.from(edges.flat()),textGlyphSegmentsB:Float32Array.from(edges.flatMap(e=>[e[2],e[3],0,0]))});
    }
    if (kind==="raster") s.rasterLayers=[{width:2,height:1,data:Uint8Array.of(255,255,255,255,255,255,255,0),matrix:Float32Array.of(10,0,0,10,0,0),paintOrder:0,pageIndex:0}];
    if (kind==="gradient-fill") {
      const edges=rect(0,0,10,10);
      Object.assign(s,{gradientCount:1,gradientFillPathCount:1,gradientFillSegmentCount:4,gradientMetaA:new Float32Array(4),gradientMetaB:Float32Array.of(1,0,0,1),gradientMetaC:new Float32Array(4),gradientMetaD:Float32Array.of(10,0,0,0),gradientMetaE:new Float32Array(4),gradientLut:new Uint8Array(4096),gradientFillPaintMeta:Float32Array.of(0,-1,0,0),gradientFillPathMetaA:Float32Array.of(0,4,0,0),gradientFillPathMetaB:Float32Array.of(10,10,0,0),gradientFillPathMetaC:Float32Array.of(0,0,0,1),gradientFillSegmentsA:Float32Array.from(edges.flat()),gradientFillSegmentsB:Float32Array.from(edges.flatMap(e=>[e[2],e[3],0,0]))});
      for (let i=0;i<1024;i++) s.gradientLut.set([255,255,255,i<512?255:0],i*4);
    }
    const maskIndex=s.drawRuns.length; s.drawRuns.push({kind,first:0,count:1});
    s.paintGraph={roots:[bottom,group([content],{softMask:{children:[{kind:"draw",runIndex:maskIndex}],subtype:"Alpha"}})]};
    const picker=new ScenePrimitivePicker(s);
    assert.equal((await picker.pick(query(2,2))).primitive.index,1,`${kind} mask geometry covers its owner`);
    assert.equal((await picker.pick(query(9,9))).primitive.index,0,`${kind} transparent or empty mask geometry reveals lower content`);
  }
  {
    const s=scene(), bottom=fill(s,rect(0,0,10,10)), content=fill(s,rect(0,0,10,10)), white=fill(s,rect(0,0,10,10));
    s.rasterLayers=[{width:1,height:1,data:Uint8Array.of(255,255,255,255),opacity:0,matrix:Float32Array.of(10,0,0,10,0,0),paintOrder:0,pageIndex:0}];
    s.drawRuns.push({kind:"raster",first:0,count:1});
    s.paintGraph={roots:[bottom,group([content],{softMask:{children:[group([white,{kind:"draw",runIndex:3}],{knockout:true})],subtype:"Alpha"}})]};
    assert.equal((await new ScenePrimitivePicker(s).pick(query(5,5))).primitive.index,0,"zero-opacity image retains shape and knocks out earlier mask paint");
  }
  {
    const s=scene(), bottom=fill(s,rect(0,0,10,10)), content=fill(s,rect(0,0,10,10));
    s.rasterLayers=[{width:2,height:1,data:Uint8Array.of(255,255,255,255,0,0,0,0),matrix:Float32Array.of(10,0,0,10,0,0),paintOrder:0,pageIndex:0}];
    s.drawRuns.push({kind:"raster",first:0,count:1});
    const transfer=Float32Array.from({length:1024},(_,i)=>i/1023>.4?1:0);
    s.paintGraph={roots:[bottom,group([content],{softMask:{children:[{kind:"draw",runIndex:2}],subtype:"Luminosity",transfer}})]};
    assert.equal((await new ScenePrimitivePicker(s).pick(query(5,5))).primitive.index,1,"raster RGB is premultiplied before bilinear sampling, preserving edge luminosity");
  }
  console.log("Paint graph queries passed: masks, holes, visibility, transfer, style, hierarchy reuse and order.");
} finally { hooks.deregister(); }
