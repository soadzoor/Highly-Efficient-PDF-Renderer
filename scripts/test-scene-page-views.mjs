import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(s,c,n) { return n(c.parentURL?.includes('/src/') && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s+'.ts' : s,c); } });
try {
  const { buildStrokeScene }=await import('../src/strokeSceneBuilder.ts');
  const { composeVectorScenesInGrid }=await import('../src/pdfVectorExtractor.ts');
  const { ScenePageViews, validatePagePrimitiveRanges, PAGE_PRIMITIVE_KINDS }=await import('../src/scenePageViews.ts');
  const { buildHep }=await import('../src/hepBuilder.ts');
  const { loadSceneFromHep }=await import('../src/hep.ts');
  const { validateVectorDrawRuns }=await import('../src/vectorDrawOrder.ts');
  const { validateScenePaintGraph }=await import('../src/scenePaintGraph.ts');
  const { getScenePrimitive }=await import('../src/scenePrimitives.ts');
  const f=values=>Float32Array.from(values);
  const makePage=(index)=>{
    const scene=buildStrokeScene([{points:[[1,1],[9,9]],color:index?'blue':'red',width:1}]);
    scene.pageRects=f([0,0,10,10]);scene.pageBounds={minX:0,minY:0,maxX:10,maxY:10};scene.bounds={...scene.pageBounds};
    const corners=[[0,0],[10,0],[10,10],[0,10]];
    Object.assign(scene,{
      fillPathCount:1,fillSegmentCount:4,fillPathMetaA:f([0,4,0,0]),fillPathMetaB:f([10,10,0,0]),fillPathMetaC:f([1,0,0,.5]),
      fillSegmentsA:f(corners.flatMap(([x,y])=>[x,y,x,y])),fillSegmentsB:f(corners.flatMap((_,i)=>[...corners[(i+1)%4],0,0])),
      textInstanceCount:1,sourceTextCount:1,textInPageCount:1,textGlyphCount:1,textGlyphSegmentCount:4,
      textInstanceA:f([1,0,0,1]),textInstanceB:f([2,2,0,1]),textInstanceC:f([0,0,0,1]),textClipRects:f([0,0,10,10]),
      textGlyphMetaA:f([0,4,0,0]),textGlyphMetaB:f([10,10,0,0]),
      textGlyphSegmentsA:f(corners.flatMap(([x,y])=>[x,y,x,y])),textGlyphSegmentsB:f(corners.flatMap((_,i)=>[...corners[(i+1)%4],0,0])),
      pageTextRanges:Uint32Array.of(0,1),textIndex:{version:2,pages:[{text:'A',charInstance:Int32Array.of(0),fallbackQuads:new Float32Array(0)}]},
      gradientCount:1,gradientMetaA:f([0,0,0,0]),gradientMetaB:f([1,0,0,1]),gradientMetaC:f([0,0,0,0]),gradientMetaD:f([10,0,0,0]),gradientMetaE:f([0,0,0,0]),
      gradientLut:new Uint8Array(4096).fill(255),gradientFillPathCount:1,gradientFillSegmentCount:4,
      gradientFillPathMetaA:f([0,4,0,0]),gradientFillPathMetaB:f([10,10,0,0]),gradientFillPathMetaC:f([0,0,0,1]),gradientFillPaintMeta:f([0,-1,4,0]),
      gradientStrokeRunCount:1,gradientStrokeSegmentCount:1,gradientStrokeRunMetaA:f([0,1,0,-1]),gradientStrokeRunMetaB:f([5,0,0,0]),
      gradientStrokeEndpoints:scene.endpoints.slice(),gradientStrokePrimitiveMeta:scene.primitiveMeta.slice(),
      gradientStrokePrimitiveBounds:scene.primitiveBounds.slice(),gradientStrokeStyles:scene.styles.slice(),
      rasterLayers:[{width:1,height:1,data:Uint8Array.of(index,0,0,255),matrix:f([10,0,0,10,0,0]),opacity:.6,pageIndex:0,paintOrder:2}],
      clipPaths:[{parent:-1,fillRule:0,edges:f(corners.flatMap(([x,y],i)=>[x,y,...corners[(i+1)%4]]))},
        {parent:0,fillRule:0,edges:f([1,1,9,1,9,1,9,9,9,9,1,9,1,9,1,1])}],
      pdfPages:[{pageIndex:0,sourcePageIndex:index+4,pdfToScene:[1,0,0,1,0,0]}],
      annotations:[{pageIndex:0,id:`a${index}`,sourcePageIndex:index+4,annotationIndex:0,subtype:'Link',pdfGeometry:{rect:[1,1,3,3]},
        bounds:{minX:1,minY:1,maxX:3,maxY:3},flags:0,visibleInDefaultView:true,hasAppearance:false}],
      drawRuns:PAGE_PRIMITIVE_KINDS.map(kind=>({kind,first:0,count:1,clipIndex:1}))
    });
    scene.gradientFillSegmentsA=scene.fillSegmentsA.slice();scene.gradientFillSegmentsB=scene.fillSegmentsB.slice();
    scene.paintGraph={roots:[{kind:'group',alpha:.7,isolated:true,knockout:false,blendMode:'Normal',
      children:scene.drawRuns.slice(0,-1).map((_,runIndex)=>({kind:'draw',runIndex})),
      softMask:{subtype:'Alpha',children:[{kind:'draw',runIndex:scene.drawRuns.length-1}]}}]};
    return scene;
  };
  const source=composeVectorScenesInGrid([makePage(0),makePage(1)],2);
  const canonical=structuredClone(source), partition=new ScenePageViews(source);
  validatePagePrimitiveRanges(source);
  for(let page=0;page<2;page++){
    const view=partition.extract(page),scene=view.scene;
    validatePagePrimitiveRanges(scene);validateVectorDrawRuns(scene);validateScenePaintGraph(scene);
    assert.equal(scene.pageCount,1);assert.equal(scene.pageRects.length,4);
    for(const kind of PAGE_PRIMITIVE_KINDS){
      assert.deepEqual([...view.primitives[kind]],[page],`${kind} retains its canonical document ID`);
      assert.deepEqual(partition.localRef(view,{kind,index:page}),{kind,index:0});
      assert.equal(partition.localRef(view,{kind,index:1-page}),null);
      const local=getScenePrimitive(scene,{kind,index:0}),original=getScenePrimitive(source,{kind,index:page});
      assert.deepEqual(local.bounds,original.bounds,`${kind}: exact canonical geometry survives compaction`);
      assert.equal(local.pageIndex,0);
    }
    assert.equal(scene.paintGraph.roots[0].softMask.children[0].runIndex,5,'soft mask paint references are remapped with their page');
    assert.equal(scene.clipPaths.length,2);assert.equal(scene.clipPaths[1].parent,0);
    assert(scene.drawRuns.every(run=>run.clipIndex===1));
    assert.deepEqual([...scene.textIndex.pages[0].charInstance],[0]);
    assert.equal(scene.textInstanceB[2],0);assert.equal(scene.textInstanceB[3],1);
    for (const key of ['textInstanceA','textInstanceC']) {
      assert.equal(scene[key].buffer,source[key].buffer,'contiguous immutable page text shares document storage');
      assert.equal(scene[key].byteOffset,source[key].byteOffset+page*16);
      assert.equal(scene[key].length,4);
    }
    assert.notEqual(scene.textInstanceB.buffer,source.textInstanceB.buffer,'page-local clip remapping owns its text array');
    assert.equal(scene.textGlyphMetaA[0],0);assert.equal(scene.fillPathMetaA[0],0);
    for (const key of ['textGlyphMetaA','textGlyphMetaB','textGlyphSegmentsA','textGlyphSegmentsB'])
      assert.equal(scene[key],source[key],'pages share the immutable document glyph store and its atlas');
    assert.equal(scene.textGlyphCount,source.textGlyphCount);
    assert.equal(scene.gradientFillPaintMeta[0],0);assert.equal(scene.gradientFillPaintMeta[3],0);
    assert.equal(scene.gradientStrokeRunMetaA[2],0);assert.equal(scene.gradientStrokeRunMetaB[1],0);
    assert.equal(scene.pdfPages[0].sourcePageIndex,page+4);assert.equal(scene.pdfPages[0].pageIndex,0);
    assert.equal(scene.annotations[0].id,`a${page}`);assert.equal(scene.annotations[0].pageIndex,0);
    assert.equal(scene.rasterLayers[0].data,source.rasterLayers[page].data,'immutable image pixels are shared');
  }
  assert.deepEqual(source,canonical,'extraction never edits the source');
  const unclipped={...source,textInstanceB:source.textInstanceB.slice(),textClipRects:undefined};
  for(let i=3;i<unclipped.textInstanceB.length;i+=4)unclipped.textInstanceB[i]=0;
  const unclippedPartition=new ScenePageViews(unclipped);
  for(let page=0;page<2;page++)for(const key of ['textInstanceA','textInstanceB','textInstanceC']){
    const local=unclippedPartition.extract(page).scene[key];
    assert.equal(local.buffer,unclipped[key].buffer,'unclipped text shares every contiguous instance store');
    assert.equal(local.byteOffset,unclipped[key].byteOffset+page*16);
    assert.deepEqual(local,unclipped[key].slice(page*4,page*4+4));
  }
  const shortText={...unclipped,textInstanceA:unclipped.textInstanceA.slice(0,4)};
  const padded=new ScenePageViews(shortText).extract(1).scene.textInstanceA;
  assert.notEqual(padded.buffer,shortText.textInstanceA.buffer,'undersized stores keep the copying fallback');
  assert.deepEqual([...padded],[0,0,0,0]);
  const interleaved={...unclipped,pagePrimitiveRanges:undefined,pageTextRanges:Uint32Array.of(0,4,1,2),
    textInstanceCount:4,sourceTextCount:4,textInPageCount:4,textIndex:null,drawRuns:undefined,clipPaths:undefined,paintGraph:undefined};
  for(const key of ['textInstanceA','textInstanceB','textInstanceC'])interleaved[key]=f([...unclipped[key],...unclipped[key]]);
  const scattered=new ScenePageViews(interleaved).extract(0);
  assert.deepEqual([...scattered.primitives.text],[0,3],'legacy ownership can select noncontiguous text');
  for(const key of ['textInstanceA','textInstanceB','textInstanceC']){
    assert.notEqual(scattered.scene[key].buffer,interleaved[key].buffer,'noncontiguous text is compacted into private storage');
    assert.deepEqual([...scattered.scene[key]],[...interleaved[key].subarray(0,4),...interleaved[key].subarray(12,16)]);
  }
  const nested=composeVectorScenesInGrid([source,source],2);
  assert.equal(nested.pageCount,4);validatePagePrimitiveRanges(nested);
  assert.equal(composeVectorScenesInGrid([nested],1).pageCount,4);
  for(let page=0;page<4;page++) for(const kind of PAGE_PRIMITIVE_KINDS)
    assert.deepEqual([...new ScenePageViews(nested).extract(page).primitives[kind]],[page]);
  // Exact ownership must win even when source content extends into another page.
  const overflow=structuredClone(source);
  overflow.primitiveBounds.set(overflow.primitiveBounds.subarray(4,8),0);
  assert.deepEqual([...new ScenePageViews(overflow).extract(0).primitives.stroke],[0]);
  const malformed={...source,pagePrimitiveRanges:source.pagePrimitiveRanges.slice()};malformed.pagePrimitiveRanges[1]++;
  assert.throws(()=>new ScenePageViews(malformed),RangeError);
  assert.throws(()=>partition.extract(-1),RangeError);assert.throws(()=>partition.extract(2),RangeError);

  // Exact ownership is persisted in a synthetic scene HEP; no PDF conversion.
  const simple=composeVectorScenesInGrid([buildStrokeScene([{points:[[0,0],[10,10]]}]),buildStrokeScene([{points:[[0,0],[20,20]]}])],2);
  const blob=await buildHep(simple,{compression:'store'});
  const restored=await loadSceneFromHep(await blob.arrayBuffer());
  assert.deepEqual(restored.pagePrimitiveRanges,simple.pagePrimitiveRanges);
  assert.deepEqual([...new ScenePageViews(restored).extract(1).primitives.stroke],[1]);
  const legacy={...source,pagePrimitiveRanges:undefined};const warnings=[];const warn=console.warn;
  try{console.warn=message=>warnings.push(message);const pages=new ScenePageViews(legacy);
    assert.deepEqual([...pages.extract(0).primitives.stroke],[0]);assert.deepEqual([...pages.extract(1).primitives.fill],[1]);
    assert.deepEqual(warnings,[],'paint inside its page rectangle is inferred exactly without a warning');
    // Paint reaching past its nearest page may belong to a neighbor.
    const bounds=legacy.primitiveBounds.slice();bounds[0]=legacy.pageRects[0]-50;
    new ScenePageViews({...legacy,primitiveBounds:bounds});
  }finally{console.warn=warn;}
  assert.equal(warnings.length,1,'ambiguous legacy ownership is diagnosed once');
  assert.match(warnings[0],/1 stroke\/fill primitive\(s\) reach past their nearest page/);
  console.log('Scene page views: all paint kinds, shared contiguous text, compact references, clips/graphs, annotations, source preservation and HEP round trip passed.');
}finally{hooks.deregister();}
