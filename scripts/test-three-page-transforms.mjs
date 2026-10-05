import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
const hooks = registerHooks({ resolve(s,c,n) { return n(c.parentURL?.includes('/src/') && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s+'.ts' : s,c); } });
const savedDocument = globalThis.document;
let copies = 0;
globalThis.document = { createElement: type => {
  assert.equal(type, 'canvas');
  return { width: 1, height: 1, style: {}, getContext: kind => {
    assert.equal(kind, '2d', 'page views never allocate their own GPU context');
    return { clearRect() {}, drawImage() { copies++; } };
  } };
} };
try {
  const { buildStrokeScene } = await import('../src/strokeSceneBuilder.ts');
  const { composeVectorScenesInGrid } = await import('../src/pdfVectorExtractor.ts');
  const { createThreePdfObject } = await import('../src/threePdfObject.ts');
  const pageScene = (color, mcid) => {
    const scene = buildStrokeScene([{ points: [[0,0],[20,20]], color, width: 1 }]);
    scene.markedContent = { items: [{ pageIndex: 0, sourcePageIndex: 0, mcid, tag: 'Figure' }], ranges: { stroke: Uint32Array.of(0,1,0) } };
    scene.optionalContent={groups:[{id:'drawing',name:'Drawing',defaultVisible:true,locked:false,usedInView:true}],
      conditions:[{kind:'group',groupId:'drawing'}],order:[],radioGroups:[]};
    scene.optionalContent.groups.push({id:'annotation:shared',annotationId:'shared',name:'Shared',defaultVisible:true,locked:true,usedInView:false});
    scene.optionalContent.conditions.push({kind:'group',groupId:'annotation:shared'},{kind:'and',operands:[0,1]});
    scene.drawRuns=[{kind:'stroke',first:0,count:scene.segmentCount,optionalContent:2}];
    const annotation=(id,annotationIndex,rect,extra={})=>({id,sourcePageIndex:mcid,pageIndex:0,annotationIndex,
      subtype:'Square',flags:4,visibleInDefaultView:true,hasAppearance:false,pdfGeometry:{rect},
      bounds:{minX:rect[0],minY:rect[1],maxX:rect[2],maxY:rect[3]},...extra});
    scene.annotations=[annotation('shared',0,[0,0,20,20],{hasAppearance:true,optionalContent:0}),
      annotation(`note-${mcid}`,1,[2,14,4,16])];
    scene.textIndex = { version: 2, pages: [{ text: 'page', charInstance: Int32Array.of(-2,-2,-2,-2), fallbackQuads: Float32Array.of(2,2,4,4) }] };
    return scene;
  };
  const scene = composeVectorScenesInGrid([pageScene('red', 5), pageScene('blue', 6), pageScene('green', 7)], 3);
  const original = structuredClone(scene);
  for (const backend of ['webgl', 'webgpu']) {
    const native = mockNative();
    const pdf = await createThreePdfObject({ scene, sourceLabel: 'pages.hep', sourceKind: 'hep' },
      { rendererType: backend, vectorLod: 'off', textLod: 'off', threeColorCompositing: 'display' }, undefined, undefined, () => native);
    assert.equal(pdf.pageViews, null, 'default document keeps its batched path');
    const fullBackground = pdf.rasterMaterialLayer.group.children[0];
    assert.equal(fullBackground.geometry.instanceCount, 3);
    await assert.rejects(pdf.getPage(-1), RangeError);
    await assert.rejects(pdf.getPage(3), RangeError);
    await assert.rejects(pdf.getPage(.5), RangeError);
    await assert.rejects(pdf.setPagePosition(0,NaN,0,0), RangeError);
    const bad = new THREE.Matrix4(); bad.elements[3] = 1;
    await assert.rejects(pdf.setPageTransform(0,bad), RangeError);
    pdf.setSearchHighlights(pdf.searchText('page'), { currentIndex: 1 });
    pdf.setAnnotationSelection(['shared']); pdf.setAnnotationHover('note-6');
    assert.equal(pdf.getAnnotationPrimitives('shared').length,3,'one annotation id can own appearances on several pages');
    const progress = [];
    const stopProgress = pdf.subscribePagePreparationProgress(value => progress.push(value));
    const [pages, second] = await Promise.all([pdf.getPages(), pdf.getPage(1)]);
    stopProgress();
    assert.deepEqual(progress, [null, 0, 25, 50, 75, 95, null], 'page preparation reports ordered integer progress and ends idle');
    const atlas = pdf.textMaterialLayer.textRasterAtlasTexture;
    let atlasDisposals = 0; atlas.addEventListener('dispose', () => atlasDisposals++);
    assert(pages.every(page => page.textMaterialLayer.textRasterAtlasTexture === atlas), 'page views share the document glyph atlas');
    assert.equal(pdf.pageBatch.textMaterialLayer.textRasterAtlasTexture, atlas, 'shared batches reuse the same glyph atlas');
    assert.equal(second, pages[1]); assert.equal(await pdf.getPage(1), second);
    assert.equal(pages.length, 3); assert(Object.isFrozen(pages));
    assert.equal(native.uploads, 0, 'independent Three resources do not upload native geometry');
    assert.equal(pdf.rasterMaterialLayer.group.visible, false);
    assert.equal(pdf.pageMesh.visible, false, 'the original document depth rectangle cannot occlude moved pages');
    assert(pages.every(page => page.searchHighlightGroup?.visible), 'pre-existing find highlights migrate to pages');
    assert(pages.every(page=>page.primitiveAppearance.getHighlights()?.selectionCount===1),'annotation selection migrates to every page occurrence');
    assert.equal(second.primitiveAppearance.getHighlights().count,5,'metadata annotation hover migrates only to its page');
    const parent = new THREE.Group(); parent.position.set(2,-5,7); parent.rotation.set(.1,.2,.3); parent.add(pdf);
    pdf.position.set(4,3,2); pdf.scale.set(1.2,.8,1);
    for (const [index,page] of pages.entries()) {
      assert.equal(page.pageIndex, index); assert.equal(page.parent,pdf);
      assert.equal(page.sceneData.segmentCount,1);
      assert.equal((await page.getPage(0)),page);
      assert.deepEqual([...page.sceneData.endpoints], [...scene.endpoints.slice(index*4,index*4+4)]);
      assert.equal(page.layerVisibility,pdf.layerVisibility);
    }
    const viewport = { width: 640, height: 480 };
    const host = { isWebGLRenderer: backend === 'webgl', isWebGPURenderer: backend === 'webgpu',
      outputColorSpace: THREE.LinearSRGBColorSpace, capabilities: { maxTextureSize: 16384 },
      getDrawingBufferSize: target => target.set(viewport.width,viewport.height), getPixelRatio: () => 1 };
    const element = { getBoundingClientRect: () => ({ left: 0, top: 0, ...viewport }) };
    host.domElement = element;
    const hostScene = new THREE.Scene(); hostScene.add(parent);
    const untouched = pages[0].matrix.clone();
    await pdf.setPagePosition(1, 0, 35, 15);
    second.rotation.set(.3,-.2,.4); second.scale.set(-1.3,.6,2);
    // Overlapping the first page in its own plane needs page order, which
    // exercises independent page rendering.
    pages[2].position.copy(pages[0].position).add(new THREE.Vector3(8,-6,0));
    for (const camera of [new THREE.PerspectiveCamera(50,640/480,.1,1000), new THREE.OrthographicCamera(-100,100,75,-75,.1,1000)]) {
      camera.position.set(0,0,250); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
      parent.updateMatrixWorld(true);
      hostScene.onBeforeRender(host,hostScene,camera,null);
      assert.equal(pdf.getPageBatchingStats().reason, 'overlapping-page-paints');
      assert.equal(pdf.pageMesh.visible, false);
      assert.deepEqual(pages[0].matrix.elements,untouched.elements,'moving one page leaves its sibling transform unchanged');
      for (const page of pages) {
        const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
          .multiply(page.matrixWorld).multiply(page.dataToLocalMatrix);
        assert.equal(page.materialPipelineActive,true, `${backend}: arbitrary page transforms preserve vector material rendering`);
        assert.deepEqual(page.rasterMaterialLayer.localToClipUniform.elements,projection.elements);
        assert.deepEqual(page.strokeMaterialLayer.localToClipUniform.elements,projection.elements);
      }
      const source = second.sceneData.endpoints;
      const x = (source[0]+source[2])/2, y=(source[1]+source[3])/2;
      const client = pdf.sceneToClientPoint(camera,x,y,element,1);
      const canonical = pdf.clientToScenePoint(camera,client.x,client.y,element);
      assert(Math.hypot(canonical.x-x,canonical.y-y)<1e-8,'document coordinate mapping intersects the transformed page');
      const hit = await pdf.pick({camera,element,clientX:client.x,clientY:client.y,tolerancePx:2,kinds:['stroke']});
      assert.deepEqual(hit?.primitive,{kind:'stroke',index:1},'document picking preserves canonical primitive references');
      assert.deepEqual(hit?.markedContent,{pageIndex:1,sourcePageIndex:0,mcid:6,tag:'Figure'},'document picks report the document page slot');
      const localHit = await second.pick({camera,element,clientX:client.x,clientY:client.y,tolerancePx:2,kinds:['stroke']});
      assert.deepEqual(localHit?.primitive,{kind:'stroke',index:0},'page picking uses its local primitive store');
      assert.deepEqual(localHit?.markedContent,{pageIndex:0,sourcePageIndex:0,mcid:6,tag:'Figure'},'page picks follow the local primitive order');
      assert.equal(second.getPrimitive({kind:'stroke',index:0}).markedContent.mcid,6);
      const pickOptions={camera,element,clientX:client.x,clientY:client.y,tolerancePx:2};
      assert.equal((await pdf.pickAnnotation(pickOptions))?.annotationId,'shared','annotation picking follows independently transformed pages');
      await pdf.setAnnotationVisibility(['shared'],false);
      assert.equal(await pdf.pickAnnotation(pickOptions),null);
      assert.equal((await pdf.pickAnnotation({...pickOptions,includeHidden:true}))?.annotationId,'shared');
      assert(pages.every(page=>page.primitiveAppearance.getHighlights()?.selectionCount===1),'hidden appearance selection persists on all pages');
      await pdf.setAnnotationVisibility(['shared'],true);
    }
    const matrix = new THREE.Matrix4().set(1,.2,0,20, 0,1,.1,5, .3,0,1,12, 0,0,0,1);
    await pdf.setPageTransform(1,matrix);
    assert.equal(second.matrixAutoUpdate,false);
    assert.deepEqual(second.matrix.elements,matrix.elements);
    matrix.elements[12] = 999;
    assert.equal(second.matrix.elements[12],20,'setter takes a detached matrix snapshot');
    const beforeTranslation = second.matrix.clone();
    await pdf.setPagePosition(1,23,8,16);
    beforeTranslation.setPosition(23,8,16);
    assert.deepEqual(second.matrix.elements,beforeTranslation.elements,'position setter preserves a manual sheared matrix');
    assert.equal(second.matrixAutoUpdate,false);
    const camera = new THREE.PerspectiveCamera(50,640/480,.1,1000); camera.position.z=250; camera.updateMatrixWorld(); parent.updateMatrixWorld(true);
    const p = second.sceneData.endpoints;
    const client = second.sceneToClientPoint(camera,(p[0]+p[2])/2,(p[1]+p[3])/2,element);
    const point = second.clientToScenePoint(camera,client.x,client.y,element);
    assert(Math.hypot(point.x-(p[0]+p[2])/2,point.y-(p[1]+p[3])/2)<1e-8,'sheared 3D planes use inverse-transpose normals');
    const matches=pdf.searchText('page'); assert.equal(matches.length,3);
    const b=matches[1].bounds;
    const expectedBox=new THREE.Box3(new THREE.Vector3(b.minX,b.minY,0),new THREE.Vector3(b.maxX,b.maxY,0))
      .applyMatrix4(second.matrix.clone().multiply(second.dataToLocalMatrix));
    assert(Math.abs(matches[1].localBounds.minX-expectedBox.min.x)<1e-8,'document search bounds follow page transforms');
    pdf.setSearchHighlights(matches,{currentIndex:1});
    assert(pages.every(page=>page.searchHighlightGroup?.visible),'find highlights are parented to individual pages');
    pdf.setSelection([{kind:'stroke',index:1}]);
    assert.equal(second.primitiveAppearance.getHighlights().selectionCount,1,'page primitive and annotation selection share one trace');
    assert.deepEqual(second.primitiveAppearance.getSelection(),[{kind:'stroke',index:0}]);
    assert.equal(pages[0].primitiveAppearance.getSelection().length,0);
    pdf.setPrimitiveOverrides([{kind:'stroke',index:1}],{color:'yellow'});
    assert.deepEqual(second.primitiveAppearance.getOverrideColor({kind:'stroke',index:0}),[1,1,0]);
    pdf.clearPrimitiveOverrides();
    assert.equal(second.primitiveAppearance.getOverrideColor({kind:'stroke',index:0}),null);
    await second.setLayerVisibility('drawing',false);
    assert.equal(pdf.isPrimitiveVisible({kind:'stroke',index:1}),false);
    assert(pages.every(page=>!page.isPrimitiveVisible({kind:'stroke',index:0})),'page layer APIs update every page');
    assert(pages.every(page=>page.primitiveAppearance.getHighlights()?.selectionCount!==1),'annotation selection respects PDF layers on every page');
    await pdf.resetLayerVisibility();
    assert(pages.every(page=>page.isPrimitiveVisible({kind:'stroke',index:0})));
    pdf.setPageBackgroundColor(.2,.3,.4,.5);
    assert(pages.every(page=>page.rendererConfig.pageBackground[3]===.5));
    pdf.prepareFrameForThreeRenderer(host,camera);
    assert(pages.every(page=>!page.pageMesh.material.depthWrite),'translucent page backgrounds do not occlude rear pages with an opaque depth rectangle');
    pdf.dispose(); pdf.dispose();
    assert.equal(atlasDisposals, 1, 'the shared glyph atlas is released once, with its last text layer');
    assert.equal(native.disposals,1,'only the document disposes the shared native context');
    assert.equal(pdf.pagePreparation,null,'disposal releases the cached page views');
    assert(pages.every(page=>page.isDisposed && page.parent===null));
    await assert.rejects(pdf.getPages(),error=>error.name==='AbortError');
    assert.deepEqual(scene,original,'public transforms never mutate canonical source geometry');
  }
  // Failed resource preparation leaves the batched object usable and retryable.
  const retry = await createThreePdfObject({scene,sourceLabel:'retry',sourceKind:'hep'},
    {vectorLod:'off',textLod:'off'},undefined,undefined,()=>mockNative());
  const createCanvas=globalThis.document.createElement; let allocations=0;
  globalThis.document.createElement=type=>{if(++allocations===2) throw new Error('allocation failed');return createCanvas(type);};
  await assert.rejects(retry.getPages(),/allocation failed/);
  assert.equal(retry.pageViews,null);assert.equal(retry.pageMesh.visible,true);
  assert.equal(retry.children.some(child=>child.pageOwner===retry),false);
  globalThis.document.createElement=createCanvas;
  const retrying=retry.getPages(); retry.setPageBackgroundColor(.4,.5,.6,.7);
  assert((await retrying).every(page=>page.rendererConfig.pageBackground[3]===.7),'settings changed during preparation are preserved');
  retry.dispose();
  // A layer replay begun before page access must finish before the new views
  // can present; the source default must not overwrite the applied visibility.
  const layered=await createThreePdfObject({scene,sourceLabel:'layer race',sourceKind:'hep'},
    {vectorLod:'off',textLod:'off'},undefined,undefined,()=>mockNative());
  let finishReplay;
  const replayGate=new Promise(resolve=>{finishReplay=resolve;});
  layered.retainedReplay={async prepare(){await replayGate;return null;},dispose(){}};
  const changing=layered.setLayerVisibility('drawing',false);
  let ready=false;
  const preparing=layered.getPages().then(value=>{ready=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(ready,false,'page preparation waits for the pending document layer update');
  finishReplay();await changing;
  assert((await preparing).every(page=>!page.isPrimitiveVisible({kind:'stroke',index:0})));
  layered.dispose();
  // Cancelling a waiter does not cancel another caller's shared preparation.
  const native=mockNative();
  const pdf=await createThreePdfObject({scene,sourceLabel:'cancel',sourceKind:'pdf'}, {vectorLod:'off',textLod:'off'},undefined,undefined,()=>native);
  const controller=new AbortController(); const cancelled=pdf.getPages({signal:controller.signal}); controller.abort(new Error('cancel waiter'));
  await assert.rejects(cancelled,/cancel waiter/);
  assert.equal((await pdf.getPages()).length,3); pdf.dispose();
  const dying=await createThreePdfObject({scene,sourceLabel:'dispose',sourceKind:'hep'}, {vectorLod:'off',textLod:'off'},undefined,undefined,()=>mockNative());
  const pending=dying.getPages(); dying.dispose(); await assert.rejects(pending,error=>error.name==='AbortError');
  console.log('Independent page API: both backends, page transforms, projection/picking, highlights, canonical IDs, shared resources and cancellation passed.');
} finally { hooks.deregister(); globalThis.document=savedDocument; }

function mockNative() {
  let view={cameraCenterX:0,cameraCenterY:0,zoom:1};
  const target={uploads:0,disposals:0,setScene(){this.uploads++;return{};}, getSceneStats:()=>({}),
    dispose(){this.disposals++;},getViewState:()=>({...view}),setViewState(next){view={...next};},
    getPresentedViewState:()=>({...view}),getPresentedFrameSerial:()=>0,
    getRasterLayerUpdates:()=>new Map(),getVectorStrokeLodStats:()=>null,getTextLodStats:()=>null};
  return new Proxy(target,{get:(target,key)=>target[key]??(()=>{})});
}
